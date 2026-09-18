import { eq, and } from "drizzle-orm";
import { db } from "../../db/client.js";
import { taskAssignees, type TaskAssignee, type Task } from "../../db/schema.js";
import { canAccessVoid } from "../../authorization/capabilities.js";
import { findTaskById } from "./tasks.js";
import { recordTaskActivity } from "./taskActivity.js";
import { createNotification } from "../notification/notifications.js";
import { findVoidById } from "../void/voids.js";

export type AssignTaskResult =
  { ok: true; task: Task } | { ok: false; reason: "task_not_found" | "user_not_eligible" };

/**
 * C8: an active assignment (`assignee_active = true`) may only be created
 * for a User eligible to access the Task's Void at assignment time —
 * `canAccessVoid` itself now also requires an active Organization
 * Membership (authorization/capabilities.ts), so this one check covers
 * both halves of C8's stated invariant.
 */
export async function assignTask(
  taskId: string,
  userId: string,
  actorId: string,
): Promise<AssignTaskResult> {
  const task = await findTaskById(taskId);
  if (!task || task.deletedAt) return { ok: false, reason: "task_not_found" as const };

  if (!(await canAccessVoid(userId, task.voidId))) {
    return { ok: false, reason: "user_not_eligible" as const };
  }

  return db.transaction(async (tx) => {
    // Upsert: reassigning a User whose prior assignment was flagged
    // inactive by a member removal (D17) reactivates that same row rather
    // than erroring on the (task_id, user_id) primary key.
    await tx
      .insert(taskAssignees)
      .values({ taskId, userId, assigneeActive: true })
      .onConflictDoUpdate({
        target: [taskAssignees.taskId, taskAssignees.userId],
        set: { assigneeActive: true, assignedAt: new Date() },
      });

    await recordTaskActivity(tx, {
      taskId,
      actorId,
      field: "assignees",
      oldValue: null,
      newValue: `assigned:${userId}`,
    });

    // D39: "task assigned to you" — skipped for self-assignment, which
    // isn't news to the person doing it. organizationId is included so the
    // notification-bell UI can build a `/orgs/:orgId/voids/:voidId` link
    // without having to be rendered inside that Organization's route
    // context already (the bell is global, in AppShell).
    if (userId !== actorId) {
      const voidRow = await findVoidById(task.voidId);
      await createNotification(tx, {
        userId,
        type: "task_assigned",
        payload: {
          taskId,
          voidId: task.voidId,
          organizationId: voidRow?.organizationId,
          assignedBy: actorId,
        },
      });
    }

    return { ok: true as const, task };
  });
}

export type UnassignTaskResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * A deliberate unassignment removes the row entirely — distinct from D17's
 * removal-triggered `assignee_active = false` flip, which preserves the row
 * as history. There's nothing to preserve here: the assignee was never
 * removed from the Organization, someone just decided they're not working
 * on this Task.
 */
export async function unassignTask(
  taskId: string,
  userId: string,
  actorId: string,
): Promise<UnassignTaskResult> {
  return db.transaction(async (tx) => {
    const result = await tx
      .delete(taskAssignees)
      .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
      .returning();
    if (result.length === 0) return { ok: false, reason: "not_found" as const };

    await recordTaskActivity(tx, {
      taskId,
      actorId,
      field: "assignees",
      oldValue: `assigned:${userId}`,
      newValue: null,
    });
    return { ok: true as const };
  });
}

export async function listAssigneesForTask(taskId: string): Promise<TaskAssignee[]> {
  return db.select().from(taskAssignees).where(eq(taskAssignees.taskId, taskId));
}
