import { eq, max } from "drizzle-orm";
import { db } from "../../db/client.js";
import { checklistItems, type ChecklistItem } from "../../db/schema.js";

export async function listChecklistItemsForTask(taskId: string): Promise<ChecklistItem[]> {
  return db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))
    .orderBy(checklistItems.position);
}

export async function addChecklistItem(taskId: string, label: string): Promise<ChecklistItem> {
  const [row] = await db
    .select({ maxPosition: max(checklistItems.position) })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId));
  const nextPosition = (row?.maxPosition ?? -1) + 1;

  const [item] = await db
    .insert(checklistItems)
    .values({ taskId, label, position: nextPosition })
    .returning();
  return item!;
}

export async function findChecklistItemById(itemId: string): Promise<ChecklistItem | null> {
  const [row] = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.id, itemId))
    .limit(1);
  return row ?? null;
}

export async function toggleChecklistItem(
  itemId: string,
  isComplete: boolean,
): Promise<ChecklistItem | null> {
  const [item] = await db
    .update(checklistItems)
    .set({ isComplete })
    .where(eq(checklistItems.id, itemId))
    .returning();
  return item ?? null;
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  await db.delete(checklistItems).where(eq(checklistItems.id, itemId));
}
