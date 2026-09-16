import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { groups, voids, type Group } from "../../db/schema.js";

export interface CreateGroupInput {
  voidId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function createGroup(input: CreateGroupInput): Promise<Group> {
  const [group] = await db.insert(groups).values(input).returning();
  return group!;
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

export interface UpdateGroupInput {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
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
