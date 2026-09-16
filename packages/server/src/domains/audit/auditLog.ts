import type { db } from "../../db/client.js";
import { auditLogs } from "../../db/schema.js";

// Structurally compatible with both `db` and any `tx` passed into
// `db.transaction(async (tx) => ...)` — callers pass whichever one they're
// already using for the state mutation, so this insert joins the same
// transaction rather than running independently.
type DbClient = Pick<typeof db, "insert">;

export interface AuditLogEntry {
  organizationId: string;
  actorId: string | null;
  eventType: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Transactional audit logging (docs/decisions.md ID15, architecture.md
 * AuditLog section): for security-sensitive mutations, the state change and
 * this AuditLog row must commit or roll back together — never independently.
 * Callers achieve this simply by passing their `tx` here instead of `db`.
 */
export async function writeAuditLog(tx: DbClient, entry: AuditLogEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId,
    actorId: entry.actorId,
    eventType: entry.eventType,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
  });
}
