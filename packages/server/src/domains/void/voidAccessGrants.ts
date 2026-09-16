import { eq, and } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  voidAccessGrants,
  teams,
  memberships,
  type VoidAccessGrant,
  type VoidAccessGrantRole,
} from "../../db/schema.js";
import { writeAuditLog } from "../audit/auditLog.js";
import { findVoidById } from "./voids.js";

export async function findVoidAccessGrantById(grantId: string): Promise<VoidAccessGrant | null> {
  const [row] = await db
    .select()
    .from(voidAccessGrants)
    .where(eq(voidAccessGrants.id, grantId))
    .limit(1);
  return row ?? null;
}

export async function listVoidAccessGrants(voidId: string) {
  return db.select().from(voidAccessGrants).where(eq(voidAccessGrants.voidId, voidId));
}

export type GrantTarget = { teamId: string } | { userId: string };

export type GrantVoidAccessResult =
  | { ok: true; grant: VoidAccessGrant }
  | { ok: false; reason: "void_not_found" | "target_not_in_organization" };

/**
 * Grant-or-update-role (upsert): there is no separate "update grant role"
 * procedure (implementation-plan.md §6's router table), so re-granting an
 * existing target simply changes its role. Enforces C3: the target Team or
 * User must belong to the same Organization as the Void.
 */
export async function grantVoidAccess(
  voidId: string,
  target: GrantTarget,
  role: VoidAccessGrantRole,
  actorId: string,
): Promise<GrantVoidAccessResult> {
  const voidRow = await findVoidById(voidId);
  if (!voidRow || voidRow.deletedAt) return { ok: false, reason: "void_not_found" as const };

  return db.transaction(async (tx) => {
    if ("teamId" in target) {
      const [team] = await tx.select().from(teams).where(eq(teams.id, target.teamId)).limit(1);
      if (!team || team.organizationId !== voidRow.organizationId) {
        return { ok: false, reason: "target_not_in_organization" as const };
      }

      const [grant] = await tx
        .insert(voidAccessGrants)
        .values({ voidId, teamId: target.teamId, role, grantedBy: actorId })
        .onConflictDoUpdate({
          target: [voidAccessGrants.voidId, voidAccessGrants.teamId],
          set: { role, grantedBy: actorId },
        })
        .returning();

      await writeAuditLog(tx, {
        organizationId: voidRow.organizationId,
        actorId,
        eventType: "void.access_granted",
        targetType: "team",
        targetId: target.teamId,
        metadata: { voidId, role },
      });
      return { ok: true as const, grant: grant! };
    }

    const [membership] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, voidRow.organizationId),
          eq(memberships.userId, target.userId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!membership) return { ok: false, reason: "target_not_in_organization" as const };

    const [grant] = await tx
      .insert(voidAccessGrants)
      .values({ voidId, userId: target.userId, role, grantedBy: actorId })
      .onConflictDoUpdate({
        target: [voidAccessGrants.voidId, voidAccessGrants.userId],
        set: { role, grantedBy: actorId },
      })
      .returning();

    await writeAuditLog(tx, {
      organizationId: voidRow.organizationId,
      actorId,
      eventType: "void.access_granted",
      targetType: "user",
      targetId: target.userId,
      metadata: { voidId, role },
    });
    return { ok: true as const, grant: grant! };
  });
}

export type RevokeVoidAccessResult = { ok: true } | { ok: false; reason: "not_found" };

export async function revokeVoidAccessGrant(
  grantId: string,
  actorId: string,
): Promise<RevokeVoidAccessResult> {
  const grant = await findVoidAccessGrantById(grantId);
  if (!grant) return { ok: false, reason: "not_found" as const };
  const voidRow = await findVoidById(grant.voidId);
  if (!voidRow) return { ok: false, reason: "not_found" as const };

  return db.transaction(async (tx) => {
    await tx.delete(voidAccessGrants).where(eq(voidAccessGrants.id, grantId));
    await writeAuditLog(tx, {
      organizationId: voidRow.organizationId,
      actorId,
      eventType: "void.access_revoked",
      targetType: grant.teamId ? "team" : "user",
      targetId: grant.teamId ?? grant.userId ?? undefined,
      metadata: { voidId: grant.voidId, role: grant.role },
    });
    return { ok: true as const };
  });
}
