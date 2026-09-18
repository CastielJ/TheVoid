import { eq, and, or, ne, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { taskLinks, tasks, voids, type TaskLink, type TaskLinkType } from "../../db/schema.js";
import { findTaskById } from "./tasks.js";

type DbClient = Pick<typeof db, "delete">;

export interface CreateTaskLinkInput {
  sourceTaskId: string;
  targetTaskId: string;
  type: TaskLinkType;
}

export type CreateTaskLinkResult =
  | { ok: true; taskLink: TaskLink }
  | {
      ok: false;
      reason: "self_loop" | "source_not_found" | "target_not_found" | "cross_void" | "duplicate";
    };

/**
 * Directionality: `sourceTaskId` is the Task that must finish first,
 * `targetTaskId` the one that follows/depends on it — same convention for
 * both "flow" (source = earlier step) and "dependency" (source =
 * prerequisite) types. Mirrors createTask's C3 same-Void check (never
 * trusts a client-supplied voidId — resolved from the source Task once
 * both endpoints are confirmed to share one).
 */
export async function createTaskLink(
  input: CreateTaskLinkInput,
  actorId: string,
): Promise<CreateTaskLinkResult> {
  if (input.sourceTaskId === input.targetTaskId) {
    return { ok: false, reason: "self_loop" as const };
  }

  const [source, target] = await Promise.all([
    findTaskById(input.sourceTaskId),
    findTaskById(input.targetTaskId),
  ]);
  if (!source || source.deletedAt) return { ok: false, reason: "source_not_found" as const };
  if (!target || target.deletedAt) return { ok: false, reason: "target_not_found" as const };
  if (source.voidId !== target.voidId) return { ok: false, reason: "cross_void" as const };

  try {
    const [inserted] = await db
      .insert(taskLinks)
      .values({
        voidId: source.voidId,
        sourceTaskId: input.sourceTaskId,
        targetTaskId: input.targetTaskId,
        type: input.type,
        createdBy: actorId,
      })
      .returning();
    return { ok: true as const, taskLink: inserted! };
  } catch {
    // The (sourceTaskId, targetTaskId, type) unique index is the real
    // safety net against a double-drag/double-click creating the same
    // arrow twice — same bare-catch convention as tags.ts's
    // findOrCreateTag race handling.
    return { ok: false, reason: "duplicate" as const };
  }
}

export async function findTaskLinkById(id: string): Promise<TaskLink | null> {
  const [row] = await db.select().from(taskLinks).where(eq(taskLinks.id, id)).limit(1);
  return row ?? null;
}

/** Joins through Void so a soft-deleted Void's links become unreachable, mirroring listGroupsForVoid. */
export async function listTaskLinksForVoid(voidId: string): Promise<TaskLink[]> {
  return db
    .select({ taskLink: taskLinks })
    .from(taskLinks)
    .innerJoin(voids, eq(taskLinks.voidId, voids.id))
    .where(sql`${taskLinks.voidId} = ${voidId} AND ${voids.deletedAt} IS NULL`)
    .then((rows) => rows.map((r) => r.taskLink));
}

export async function deleteTaskLink(id: string): Promise<void> {
  await db.delete(taskLinks).where(eq(taskLinks.id, id));
}

/**
 * Direct (non-transitive) incoming "dependency" sources that are not yet
 * done — the dependency-completion-gate rule's data source (updateTask in
 * tasks.ts). Deliberately does not walk the graph transitively: a cycle
 * just means neither Task in it can be marked done until a user deletes an
 * edge, a self-resolving mistake rather than something worth a graph
 * traversal for.
 */
export async function findIncompleteDependencySources(taskId: string): Promise<string[]> {
  const rows = await db
    .select({ id: tasks.id })
    .from(taskLinks)
    .innerJoin(tasks, eq(taskLinks.sourceTaskId, tasks.id))
    .where(
      and(
        eq(taskLinks.targetTaskId, taskId),
        eq(taskLinks.type, "dependency"),
        ne(tasks.status, "done"),
        isNull(tasks.deletedAt),
      ),
    );
  return rows.map((r) => r.id);
}

/** Called from deleteTask's own transaction — the real, live-path cascade (the FK is a dormant safety net only). */
export async function deleteTaskLinksForTask(tx: DbClient, taskId: string): Promise<string[]> {
  const deleted = await tx
    .delete(taskLinks)
    .where(or(eq(taskLinks.sourceTaskId, taskId), eq(taskLinks.targetTaskId, taskId)))
    .returning({ id: taskLinks.id });
  return deleted.map((r) => r.id);
}
