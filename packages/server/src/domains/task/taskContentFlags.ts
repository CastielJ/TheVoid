import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { checklistItems, comments, taskTags, taskAssignees } from "../../db/schema.js";

/**
 * Third feature pass — whether a Task's compact card shows the badges row
 * (checklist/comment/tag/assignee counts), for `recomputeGroupBounds`'s
 * per-task height math. This mirrors exactly the four tables
 * `listTaskSummariesForVoid` (domains/task/tasks.ts) counts from — the two
 * live in separate files (that one needs full counts + whole-void scope,
 * this one only needs a boolean + an arbitrary task-id subset, so sharing
 * one query shape isn't a clean fit) but MUST stay in sync on which tables
 * count as "has badges": drifting apart here is exactly the bug class this
 * function exists to prevent (a Group under-computing its height because
 * the server's notion of "this task has a badges row" silently diverged
 * from the client's).
 */
export async function listTaskIdsWithBadges(taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();

  const [checklistRows, commentRows, tagRows, assigneeRows] = await Promise.all([
    db
      .selectDistinct({ taskId: checklistItems.taskId })
      .from(checklistItems)
      .where(inArray(checklistItems.taskId, taskIds)),
    db
      .selectDistinct({ taskId: comments.taskId })
      .from(comments)
      .where(and(inArray(comments.taskId, taskIds), isNull(comments.deletedAt))),
    db
      .selectDistinct({ taskId: taskTags.taskId })
      .from(taskTags)
      .where(inArray(taskTags.taskId, taskIds)),
    db
      .selectDistinct({ taskId: taskAssignees.taskId })
      .from(taskAssignees)
      .where(and(inArray(taskAssignees.taskId, taskIds), eq(taskAssignees.assigneeActive, true))),
  ]);

  const withBadges = new Set<string>();
  for (const { taskId } of checklistRows) withBadges.add(taskId);
  for (const { taskId } of commentRows) withBadges.add(taskId);
  for (const { taskId } of tagRows) withBadges.add(taskId);
  for (const { taskId } of assigneeRows) withBadges.add(taskId);
  return withBadges;
}
