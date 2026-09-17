import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { groups, tasks, voids, type Group } from "../../db/schema.js";

// Same structural-typing pattern as domains/audit/auditLog.ts /
// domains/task/taskActivity.ts: callers pass their own `tx` so this joins
// the caller's transaction (always called from within one — never opens its
// own).
type DbClient = Pick<typeof db, "select" | "update">;

/**
 * Second feature pass — Groups switched from client-settable width/height
 * (manual drag-resize) to fully server-computed, auto-sized bounds: a Group
 * auto-grows/shrinks to fit its member Tasks. TASK_BBOX_* mirrors the
 * frontend's TASK_FOOTPRINT_COMPACT (packages/web/src/canvas/spatialIndex.ts)
 * — the server has no per-client expand-state knowledge, so it always uses
 * the compact/smaller footprint for this math (a user's own live drag state
 * is shown via a separate client-only "ghost preview", never this server
 * value).
 */
const TASK_BBOX_WIDTH = 220;
const TASK_BBOX_HEIGHT = 96;
const GROUP_PADDING = 24;
export const GROUP_MIN_WIDTH = 280;
export const GROUP_MIN_HEIGHT = 160;

export interface CreateGroupInput {
  voidId: string;
  name: string;
  x: number;
  y: number;
}

/** A brand-new Group has no member Tasks yet — starts at the minimum size. */
export async function createGroup(input: CreateGroupInput): Promise<Group> {
  const [group] = await db
    .insert(groups)
    .values({ ...input, width: GROUP_MIN_WIDTH, height: GROUP_MIN_HEIGHT })
    .returning();
  return group!;
}

/**
 * Recomputes a Group's bounds as a tight bounding box over its member Tasks'
 * positions plus fixed padding — both size AND position (x/y), so the box
 * stays correctly anchored rather than only ever growing from a stale
 * corner. An empty Group shrinks to the minimum size and keeps its current
 * x/y (it doesn't vanish or jump to the origin). Always called from within
 * the caller's own transaction (task create/move/delete/duplicate, or
 * group.create's — though create has no members yet, see createGroup above).
 */
export async function recomputeGroupBounds(tx: DbClient, groupId: string): Promise<Group> {
  const memberTasks = await tx
    .select({ x: tasks.x, y: tasks.y })
    .from(tasks)
    .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)));

  if (memberTasks.length === 0) {
    const [updated] = await tx
      .update(groups)
      .set({
        width: GROUP_MIN_WIDTH,
        height: GROUP_MIN_HEIGHT,
        version: sql`${groups.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(groups.id, groupId))
      .returning();
    return updated!;
  }

  const minX = Math.min(...memberTasks.map((t) => t.x));
  const minY = Math.min(...memberTasks.map((t) => t.y));
  const maxX = Math.max(...memberTasks.map((t) => t.x + TASK_BBOX_WIDTH));
  const maxY = Math.max(...memberTasks.map((t) => t.y + TASK_BBOX_HEIGHT));

  const x = minX - GROUP_PADDING;
  const y = minY - GROUP_PADDING;
  const width = Math.max(GROUP_MIN_WIDTH, maxX - minX + GROUP_PADDING * 2);
  const height = Math.max(GROUP_MIN_HEIGHT, maxY - minY + GROUP_PADDING * 2);

  const [updated] = await tx
    .update(groups)
    .set({ x, y, width, height, version: sql`${groups.version} + 1`, updatedAt: new Date() })
    .where(eq(groups.id, groupId))
    .returning();
  return updated!;
}

export async function findGroupById(groupId: string): Promise<Group | null> {
  const [row] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  return row ?? null;
}

/**
 * Groups belonging to a Void — joins through Void so a soft-deleted Void's
 * Groups become unreachable without any per-Group `deleted_at` write
 * (architecture.md §6.2's O(1)-delete design).
 */
export async function listGroupsForVoid(voidId: string): Promise<Group[]> {
  return db
    .select({ group: groups })
    .from(groups)
    .innerJoin(voids, eq(groups.voidId, voids.id))
    .where(sql`${groups.voidId} = ${voidId} AND ${voids.deletedAt} IS NULL`)
    .then((rows) => rows.map((r) => r.group));
}

// width/height are deliberately absent — size is fully server-owned via
// recomputeGroupBounds now, no longer a client-settable field (the manual
// drag-resize handle is removed from the frontend, second feature pass).
export interface UpdateGroupInput {
  name?: string;
  x?: number;
  y?: number;
}

/** `void_id` is never part of this input — a Group's Void is immutable after creation. */
export async function updateGroup(groupId: string, input: UpdateGroupInput): Promise<Group | null> {
  const [group] = await db
    .update(groups)
    .set({ ...input, version: sql`${groups.version} + 1`, updatedAt: new Date() })
    .where(eq(groups.id, groupId))
    .returning();
  return group ?? null;
}

export async function deleteGroup(groupId: string): Promise<void> {
  await db.delete(groups).where(eq(groups.id, groupId));
}
