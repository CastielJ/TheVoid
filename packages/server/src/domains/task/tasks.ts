import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  tasks,
  groups,
  checklistItems,
  taskAssignees,
  comments,
  taskTags,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type Group,
} from "../../db/schema.js";
import { recordTaskActivity } from "./taskActivity.js";
import { listAccessibleVoids } from "../void/voids.js";
import { copyTaskTags } from "../tag/tags.js";
import { recomputeGroupBounds } from "../group/groups.js";
import { deleteTaskLinksForTask, findIncompleteDependencySources } from "./taskLinks.js";

export interface CreateTaskInput {
  voidId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  groupId?: string | null;
  x: number;
  y: number;
}

export type CreateTaskResult =
  { ok: true; task: Task; recomputedGroup?: Group } | { ok: false; reason: "group_not_in_void" };

/**
 * Enforces C3: Task.group_id, when set, must belong to the same Void as the
 * Task. `recomputedGroup` (when a Group's bounds actually changed as a side
 * effect) is surfaced back to the router so it can broadcast a
 * `group.updated` realtime event — otherwise no client, including the
 * acting one, would ever learn the server auto-resized that Group, since
 * this mutation's own response only carries the Task.
 */
export async function createTask(
  input: CreateTaskInput,
  creatorUserId: string,
): Promise<CreateTaskResult> {
  if (input.groupId) {
    const [group] = await db.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
    if (!group || group.voidId !== input.voidId) {
      return { ok: false, reason: "group_not_in_void" as const };
    }
  }

  const { task, recomputedGroup } = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(tasks)
      .values({
        voidId: input.voidId,
        groupId: input.groupId ?? null,
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate,
        x: input.x,
        y: input.y,
        createdBy: creatorUserId,
      })
      .returning();

    const recomputedGroup = input.groupId
      ? await recomputeGroupBounds(tx, input.groupId)
      : undefined;

    return { task: inserted!, recomputedGroup };
  });

  return { ok: true as const, task, recomputedGroup };
}

/** Raw lookup — does not filter `deleted_at` (mirrors domains/void/voids.js's findVoidById). */
export async function findTaskById(taskId: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return row ?? null;
}

export async function listTasksForVoid(voidId: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.voidId, voidId), isNull(tasks.deletedAt)));
}

export interface TaskSummary {
  taskId: string;
  checklistCount: number;
  checklistDoneCount: number;
  commentCount: number;
  tagCount: number;
  assigneeCount: number;
}

/**
 * Second feature pass — the compact TaskCard's count-only badges (checklist/
 * comments/tags/assignees) come from here, one batched call per Void load,
 * instead of each visible card independently querying its own counts (which
 * would multiply the request count with the number of simultaneously
 * visible cards while zoomed out — the exact regression this function
 * exists to avoid). Fixed query count (5) regardless of how many Tasks are
 * in the Void.
 */
export async function listTaskSummariesForVoid(voidId: string): Promise<TaskSummary[]> {
  const voidTasks = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.voidId, voidId), isNull(tasks.deletedAt)));
  const taskIds = voidTasks.map((t) => t.id);
  if (taskIds.length === 0) return [];

  const [checklistRows, commentRows, tagRows, assigneeRows] = await Promise.all([
    db
      .select({
        taskId: checklistItems.taskId,
        total: sql<number>`count(*)`,
        done: sql<number>`count(*) filter (where ${checklistItems.isComplete})`,
      })
      .from(checklistItems)
      .where(inArray(checklistItems.taskId, taskIds))
      .groupBy(checklistItems.taskId),
    db
      .select({ taskId: comments.taskId, total: sql<number>`count(*)` })
      .from(comments)
      .where(and(inArray(comments.taskId, taskIds), isNull(comments.deletedAt)))
      .groupBy(comments.taskId),
    db
      .select({ taskId: taskTags.taskId, total: sql<number>`count(*)` })
      .from(taskTags)
      .where(inArray(taskTags.taskId, taskIds))
      .groupBy(taskTags.taskId),
    db
      .select({ taskId: taskAssignees.taskId, total: sql<number>`count(*)` })
      .from(taskAssignees)
      .where(and(inArray(taskAssignees.taskId, taskIds), eq(taskAssignees.assigneeActive, true)))
      .groupBy(taskAssignees.taskId),
  ]);

  const checklistMap = new Map(checklistRows.map((r) => [r.taskId, r]));
  const commentMap = new Map(commentRows.map((r) => [r.taskId, Number(r.total)]));
  const tagMap = new Map(tagRows.map((r) => [r.taskId, Number(r.total)]));
  const assigneeMap = new Map(assigneeRows.map((r) => [r.taskId, Number(r.total)]));

  return taskIds.map((taskId) => ({
    taskId,
    checklistCount: Number(checklistMap.get(taskId)?.total ?? 0),
    checklistDoneCount: Number(checklistMap.get(taskId)?.done ?? 0),
    commentCount: commentMap.get(taskId) ?? 0,
    tagCount: tagMap.get(taskId) ?? 0,
    assigneeCount: assigneeMap.get(taskId) ?? 0,
  }));
}

/**
 * D44 My Tasks: active assignments across every Void `userId` can currently
 * access within `organizationId` — scoped through `listAccessibleVoids`
 * (not just "every Task row with an assignee_active row for this user")
 * so a Task in a Void the User has since lost access to never leaks in,
 * consistent with how every other cross-Void listing in this codebase is
 * authorization-scoped.
 */
export async function listMyTasks(userId: string, organizationId: string): Promise<Task[]> {
  const accessibleVoids = await listAccessibleVoids(userId, organizationId);
  if (accessibleVoids.length === 0) return [];
  const voidIds = accessibleVoids.map((v) => v.id);

  const assignedTaskIds = db
    .select({ taskId: taskAssignees.taskId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.userId, userId), eq(taskAssignees.assigneeActive, true)));

  return db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.voidId, voidIds),
        isNull(tasks.deletedAt),
        inArray(tasks.id, assignedTaskIds),
      ),
    );
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority | null;
  dueDate?: string | null;
}

/**
 * Thrown before the transaction opens, so a blocked "done" never produces
 * a partial write. Deliberately leaves updateTask's own `Task | null`
 * return type unchanged (a broader result-object refactor would ripple
 * through every existing caller/test) — the router catches this and maps
 * it to a BAD_REQUEST with a specific message instead.
 */
export class DependencyNotSatisfiedError extends Error {
  constructor(public readonly blockingTaskIds: string[]) {
    super("This Task depends on an incomplete Task and cannot be marked done.");
  }
}

/** Content fields only — position/grouping go through moveTask below. */
export async function updateTask(
  taskId: string,
  input: UpdateTaskInput,
  actorId: string,
): Promise<Task | null> {
  const existing = await findTaskById(taskId);
  if (!existing || existing.deletedAt) return null;

  if (input.status === "done" && existing.status !== "done") {
    const blockingTaskIds = await findIncompleteDependencySources(taskId);
    if (blockingTaskIds.length > 0) throw new DependencyNotSatisfiedError(blockingTaskIds);
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tasks)
      .set({ ...input, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning();

    if (input.status !== undefined && input.status !== existing.status) {
      await recordTaskActivity(tx, {
        taskId,
        actorId,
        field: "status",
        oldValue: existing.status,
        newValue: input.status,
      });
    }
    if (input.priority !== undefined && input.priority !== existing.priority) {
      await recordTaskActivity(tx, {
        taskId,
        actorId,
        field: "priority",
        oldValue: existing.priority,
        newValue: input.priority,
      });
    }
    if (input.dueDate !== undefined && input.dueDate !== existing.dueDate) {
      await recordTaskActivity(tx, {
        taskId,
        actorId,
        field: "due_date",
        oldValue: existing.dueDate,
        newValue: input.dueDate,
      });
    }

    return updated!;
  });
}

export interface MoveTaskInput {
  x?: number;
  y?: number;
  groupId?: string | null;
}

export type MoveTaskResult =
  | { ok: true; task: Task; recomputedGroups: Group[] }
  | { ok: false; reason: "not_found" | "group_not_in_void" };

/**
 * Position and Group membership only. Enforces C3 the same way createTask
 * does. `recomputedGroups` — see createTask's docstring on why this is
 * surfaced back to the router for a realtime broadcast.
 */
export async function moveTask(
  taskId: string,
  input: MoveTaskInput,
  actorId: string,
): Promise<MoveTaskResult> {
  const existing = await findTaskById(taskId);
  if (!existing || existing.deletedAt) return { ok: false, reason: "not_found" as const };

  if (input.groupId) {
    const [group] = await db.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
    if (!group || group.voidId !== existing.voidId) {
      return { ok: false, reason: "group_not_in_void" as const };
    }
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tasks)
      .set({
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))
      .returning();

    if (input.groupId !== undefined && input.groupId !== existing.groupId) {
      await recordTaskActivity(tx, {
        taskId,
        actorId,
        field: "group_id",
        oldValue: existing.groupId,
        newValue: input.groupId,
      });
    }

    // Group auto-sizing (second feature pass): a position change or a
    // group-membership change both potentially affect a Group's bounding
    // box. Recompute whichever Group(s) actually changed membership or
    // could have grown/shrunk from this move — the former Group (if the
    // Task left it) and the current Group (if it's in one, whether that's
    // new or unchanged, since x/y may have moved within it).
    const recomputedGroups: Group[] = [];
    const finalGroupId = input.groupId !== undefined ? input.groupId : existing.groupId;
    if (input.groupId !== undefined && existing.groupId && existing.groupId !== finalGroupId) {
      recomputedGroups.push(await recomputeGroupBounds(tx, existing.groupId));
    }
    if (finalGroupId) {
      recomputedGroups.push(await recomputeGroupBounds(tx, finalGroupId));
    }

    return { ok: true as const, task: updated!, recomputedGroups };
  });
}

export type DeleteTaskResult =
  | { ok: true; recomputedGroup?: Group; deletedLinkIds: string[] }
  | { ok: false; reason: "not_found" };

/**
 * Takes the already-fetched row rather than a taskId — every call site
 * already had to fetch it first (to resolve the Void for the realtime
 * broadcast, or simply to 404 on a missing Task), so re-fetching the same
 * row here was a pure redundant round trip.
 *
 * Also the real, live-path cascade for TaskLinks: the `onDelete: "cascade"`
 * FK on task_links is a dormant safety net (like voids.parentVoidId's) —
 * Task deletion is always this soft-delete, never a hard row DELETE, so
 * without this explicit step every other connected client would keep a
 * dangling arrow pointing at a Task that just disappeared for them.
 */
export async function deleteTask(existing: Task): Promise<DeleteTaskResult> {
  if (existing.deletedAt) return { ok: false, reason: "not_found" as const };
  const { recomputedGroup, deletedLinkIds } = await db.transaction(async (tx) => {
    await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, existing.id));
    const recomputedGroup = existing.groupId
      ? await recomputeGroupBounds(tx, existing.groupId)
      : undefined;
    const deletedLinkIds = await deleteTaskLinksForTask(tx, existing.id);
    return { recomputedGroup, deletedLinkIds };
  });
  return { ok: true as const, recomputedGroup, deletedLinkIds };
}

export type DuplicateTaskResult =
  { ok: true; task: Task; recomputedGroup?: Group } | { ok: false; reason: "not_found" };

/**
 * ID5: new ID; copies title/description/priority/tags/group_id/checklist
 * items (reset unchecked); does NOT copy assignees, comments, or activity
 * history; status resets to default (`todo`). Same-Void only (D56) — this
 * function has no target-Void parameter at all. Tags are copied as the same
 * shared Tag associations (copyTaskTags), never new Tag rows, since Tags
 * are Organization-scoped shared vocabulary, not per-Task data.
 */
export async function duplicateTask(taskId: string, actorId: string): Promise<DuplicateTaskResult> {
  const existing = await findTaskById(taskId);
  if (!existing || existing.deletedAt) return { ok: false, reason: "not_found" as const };

  const { newTask, recomputedGroup } = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(tasks)
      .values({
        voidId: existing.voidId,
        groupId: existing.groupId,
        title: existing.title,
        description: existing.description,
        priority: existing.priority,
        // Small offset so the copy doesn't render exactly on top of the original.
        x: existing.x + 20,
        y: existing.y + 20,
        createdBy: actorId,
      })
      .returning();

    const items = await tx.select().from(checklistItems).where(eq(checklistItems.taskId, taskId));
    if (items.length > 0) {
      await tx.insert(checklistItems).values(
        items.map((item) => ({
          taskId: inserted!.id,
          label: item.label,
          isComplete: false,
          position: item.position,
        })),
      );
    }

    const recomputedGroup = existing.groupId
      ? await recomputeGroupBounds(tx, existing.groupId)
      : undefined;

    return { newTask: inserted!, recomputedGroup };
  });

  await copyTaskTags(taskId, newTask.id);

  return { ok: true as const, task: newTask, recomputedGroup };
}
