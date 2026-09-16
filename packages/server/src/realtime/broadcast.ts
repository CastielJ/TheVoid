import { broadcastToVoid } from "./channels.js";

/**
 * The exact event set from architecture.md §5 — D32 scopes live sync to
 * Task/Group create/update/move/delete plus void.deleted (§6.2); nothing
 * else (e.g. ChecklistItem/Comment changes) is broadcast in MVP.
 */
export type RealtimeEventType =
  | "task.created"
  | "task.updated"
  | "task.moved"
  | "task.deleted"
  | "group.created"
  | "group.updated"
  | "group.deleted"
  | "void.deleted";

/**
 * The single shared "mutate → broadcast" wrapper (implementation-plan.md
 * §6's New Decision) — every mutating voidRouter/groupRouter/taskRouter
 * procedure calls this as its last step, after the DB write has committed,
 * so the publish step can't be accidentally skipped when a new procedure is
 * added later.
 */
export function publishVoidEvent(voidId: string, type: RealtimeEventType, payload: unknown): void {
  broadcastToVoid(voidId, { type, voidId, payload, publishedAt: new Date().toISOString() });
}
