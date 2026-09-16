import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { tags, taskTags, groupTags, tasks, groups, voids, type Tag } from "../../db/schema.js";

/**
 * Post-launch refinement pass — Organization-scoped Tags (reusable across
 * every Void in an Organization, not duplicated per-Void). A Tag is a plain
 * data row: its existence never grants access to anything, and creating/
 * using one is gated by the caller's ordinary Editor+ capability on the
 * specific Task/Group being tagged (canEditVoidForTask/canEditVoidForGroup,
 * checked by the router before these functions are ever called) — there is
 * no separate "manage tags" capability, and a Tag can never be used to
 * reach a Void the caller doesn't already have edit access to.
 */

export async function findOrCreateTag(
  organizationId: string,
  name: string,
  actorUserId: string,
): Promise<Tag> {
  const trimmed = name.trim();

  const [existing] = await db
    .select()
    .from(tags)
    .where(
      and(eq(tags.organizationId, organizationId), sql`lower(${tags.name}) = lower(${trimmed})`),
    )
    .limit(1);
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(tags)
      .values({ organizationId, name: trimmed, createdBy: actorUserId })
      .returning();
    return created!;
  } catch {
    // Lost a race against a concurrent findOrCreateTag call for the same
    // name — the unique (organizationId, lower(name)) index is the real
    // safety net; fall back to the row the other request just created.
    const [raceWinner] = await db
      .select()
      .from(tags)
      .where(
        and(eq(tags.organizationId, organizationId), sql`lower(${tags.name}) = lower(${trimmed})`),
      )
      .limit(1);
    if (!raceWinner) throw new Error("Failed to find or create tag");
    return raceWinner;
  }
}

export async function listOrgTags(organizationId: string): Promise<Tag[]> {
  return db.select().from(tags).where(eq(tags.organizationId, organizationId)).orderBy(tags.name);
}

function uniqueNonEmpty(names: string[]): string[] {
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];
}

/**
 * Resolves the Task's Void -> Organization server-side (never accepts an
 * organizationId from the caller), find-or-creates each named tag under
 * that Organization, and replaces the Task's full tag set — matching the
 * old `tasks.tags` text[] column's full-replace semantics. Every Tag
 * involved is either already scoped to the resolved organizationId or
 * newly created under it, so a Tag from a different Organization can never
 * end up attached to this Task.
 */
export async function assignTagsToTask(
  taskId: string,
  tagNames: string[],
  actorUserId: string,
): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error("Task not found");
  const [voidRow] = await db.select().from(voids).where(eq(voids.id, task.voidId)).limit(1);
  if (!voidRow) throw new Error("Void not found");

  const resolvedTags = await Promise.all(
    uniqueNonEmpty(tagNames).map((name) =>
      findOrCreateTag(voidRow.organizationId, name, actorUserId),
    ),
  );

  await db.transaction(async (tx) => {
    await tx.delete(taskTags).where(eq(taskTags.taskId, taskId));
    if (resolvedTags.length > 0) {
      await tx.insert(taskTags).values(resolvedTags.map((t) => ({ taskId, tagId: t.id })));
    }
  });
}

/** Same reasoning as assignTagsToTask, for Groups. */
export async function assignTagsToGroup(
  groupId: string,
  tagNames: string[],
  actorUserId: string,
): Promise<void> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) throw new Error("Group not found");
  const [voidRow] = await db.select().from(voids).where(eq(voids.id, group.voidId)).limit(1);
  if (!voidRow) throw new Error("Void not found");

  const resolvedTags = await Promise.all(
    uniqueNonEmpty(tagNames).map((name) =>
      findOrCreateTag(voidRow.organizationId, name, actorUserId),
    ),
  );

  await db.transaction(async (tx) => {
    await tx.delete(groupTags).where(eq(groupTags.groupId, groupId));
    if (resolvedTags.length > 0) {
      await tx.insert(groupTags).values(resolvedTags.map((t) => ({ groupId, tagId: t.id })));
    }
  });
}

export async function listTagsForTask(taskId: string): Promise<Tag[]> {
  const rows = await db
    .select({
      id: tags.id,
      organizationId: tags.organizationId,
      name: tags.name,
      createdBy: tags.createdBy,
      createdAt: tags.createdAt,
    })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(eq(taskTags.taskId, taskId));
  return rows;
}

export async function listTagsForGroup(groupId: string): Promise<Tag[]> {
  const rows = await db
    .select({
      id: tags.id,
      organizationId: tags.organizationId,
      name: tags.name,
      createdBy: tags.createdBy,
      createdAt: tags.createdAt,
    })
    .from(groupTags)
    .innerJoin(tags, eq(tags.id, groupTags.tagId))
    .where(eq(groupTags.groupId, groupId));
  return rows;
}

/**
 * ID5: duplicateTask copies the Task's tag associations onto the new Task —
 * same Tag IDs, never new Tag rows, since tags are shared Organization
 * vocabulary.
 */
export async function copyTaskTags(sourceTaskId: string, newTaskId: string): Promise<void> {
  const existing = await db
    .select({ tagId: taskTags.tagId })
    .from(taskTags)
    .where(eq(taskTags.taskId, sourceTaskId));
  if (existing.length === 0) return;
  await db.insert(taskTags).values(existing.map((t) => ({ taskId: newTaskId, tagId: t.tagId })));
}
