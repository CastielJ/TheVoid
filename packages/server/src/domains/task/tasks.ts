import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  tasks,
  groups,
  checklistItems,
  taskAssignees,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "../../db/schema.js";
import { recordTaskActivity } from "./taskActivity.js";
import { listAccessibleVoids } from "../void/voids.js";

export interface CreateTaskInput {
  voidId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  tags?: string[];
  groupId?: string | null;
  x: number;
  y: number;
}

export type CreateTaskResult =
  { ok: true; task: Task } | { ok: false; reason: "group_not_in_void" };

/** Enforces C3: Task.group_id, when set, must belong to the same Void as the Task. */
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

  const [task] = await db
    .insert(tasks)
    .values({
      voidId: input.voidId,
      groupId: input.groupId ?? null,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate,
      tags: input.tags,
      x: input.x,
      y: input.y,
      createdBy: creatorUserId,
    })
    .returning();

  return { ok: true as const, task: task! };
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
  tags?: string[] | null;
}

/** Content fields only — position/grouping go through moveTask below. */
export async function updateTask(
  taskId: string,
  input: UpdateTaskInput,
  actorId: string,
): Promise<Task | null> {
  const existing = await findTaskById(taskId);
  if (!existing || existing.deletedAt) return null;

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
  { ok: true; task: Task } | { ok: false; reason: "not_found" | "group_not_in_void" };

/** Position and Group membership only. Enforces C3 the same way createTask does. */
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

    return { ok: true as const, task: updated! };
  });
}

export type DeleteTaskResult = { ok: true } | { ok: false; reason: "not_found" };

export async function deleteTask(taskId: string): Promise<DeleteTaskResult> {
  const existing = await findTaskById(taskId);
  if (!existing || existing.deletedAt) return { ok: false, reason: "not_found" as const };
  await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
  return { ok: true as const };
}

export type DuplicateTaskResult = { ok: true; task: Task } | { ok: false; reason: "not_found" };

/**
 * ID5: new ID; copies title/description/priority/tags/group_id/checklist
 * items (reset unchecked); does NOT copy assignees, comments, or activity
 * history; status resets to default (`todo`). Same-Void only (D56) — this
 * function has no target-Void parameter at all.
 */
export async function duplicateTask(taskId: string, actorId: string): Promise<DuplicateTaskResult> {
  const existing = await findTaskById(taskId);
  if (!existing || existing.deletedAt) return { ok: false, reason: "not_found" as const };

  return db.transaction(async (tx) => {
    const [newTask] = await tx
      .insert(tasks)
      .values({
        voidId: existing.voidId,
        groupId: existing.groupId,
        title: existing.title,
        description: existing.description,
        priority: existing.priority,
        tags: existing.tags,
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
          taskId: newTask!.id,
          label: item.label,
          isComplete: false,
          position: item.position,
        })),
      );
    }

    return { ok: true as const, task: newTask! };
  });
}
