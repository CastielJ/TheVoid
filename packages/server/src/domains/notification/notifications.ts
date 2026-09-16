import { eq, and, isNull, desc } from "drizzle-orm";
import type { db } from "../../db/client.js";
import { db as dbClient } from "../../db/client.js";
import { notifications, type NotificationType } from "../../db/schema.js";

// Same "join the caller's transaction" pattern as writeAuditLog
// (domains/audit/auditLog.ts) — notification creation is a side effect of
// the triggering mutation (task assignment, mention, invitation, role
// change), not a separately-committed step, so a rollback of the mutation
// must also roll back the notification.
type DbClient = Pick<typeof db, "insert">;

export interface CreateNotificationEntry {
  userId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
}

export async function createNotification(
  tx: DbClient,
  entry: CreateNotificationEntry,
): Promise<void> {
  await tx.insert(notifications).values(entry);
}

export async function listNotificationsForUser(userId: string, limit = 50) {
  return dbClient
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const rows = await dbClient
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows.length;
}

export type MarkNotificationReadResult = { ok: true } | { ok: false; reason: "not_found" };

/** Ownership-checked: a notification may only be marked read by its own recipient. */
export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<MarkNotificationReadResult> {
  const result = await dbClient
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning();
  if (result.length === 0) return { ok: false, reason: "not_found" as const };
  return { ok: true as const };
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await dbClient
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
