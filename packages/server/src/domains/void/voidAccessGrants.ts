import { eq, and } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  voidAccessGrants,
  memberships,
  type VoidAccessGrant,
  type VoidAccessGrantRole,
} from "../../db/schema.js";
import { writeAuditLog } from "../audit/auditLog.js";
import { findVoidById } from "./voids.js";
import { getUsersDisplayInfo, type UserDisplayInfo } from "../auth/users.js";

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

export interface VoidAccessGrantWithUser {
  grant: VoidAccessGrant;
  user: UserDisplayInfo;
}

/**
 * Third feature pass — the members panel needs role + display info per
 * grant in one call rather than a second round trip (same pattern the old
 * `team.listMembers` router used). Silently drops a grant whose user has no
 * resolvable display info (should never happen — userId is a required FK —
 * but keeps this defensive rather than throwing on a data inconsistency).
 */
export async function listVoidAccessGrantsWithUsers(
  voidId: string,
): Promise<VoidAccessGrantWithUser[]> {
  const grants = await listVoidAccessGrants(voidId);
  if (grants.length === 0) return [];
  const displayInfoMap = await getUsersDisplayInfo(grants.map((g) => g.userId));
  return grants
    .map((grant) => {
      const user = displayInfoMap.get(grant.userId);
      return user ? { grant, user } : null;
    })
    .filter((row): row is VoidAccessGrantWithUser => row !== null);
}

export type GrantVoidAccessResult =
  | { ok: true; grant: VoidAccessGrant }
  | { ok: false; reason: "void_not_found" | "target_not_in_organization" };

/**
 * Grant-or-update-role (upsert): there is no separate "update grant role"
 * procedure, so re-granting an existing user simply changes their role.
 * Enforces C3: the target User must belong to the same Organization as the
 * Void. Third feature pass: every grant is now a plain per-user grant —
 * Team merged into Void, so "grant to a whole Team" is no longer a separate
 * case (a Team's own members are just per-user grants on that child Void).
 */
export async function grantVoidAccess(
  voidId: string,
  userId: string,
  role: VoidAccessGrantRole,
  actorId: string,
): Promise<GrantVoidAccessResult> {
  const voidRow = await findVoidById(voidId);
  if (!voidRow || voidRow.deletedAt) return { ok: false, reason: "void_not_found" as const };

  return db.transaction(async (tx) => {
    const [membership] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, voidRow.organizationId),
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!membership) return { ok: false, reason: "target_not_in_organization" as const };

    const [grant] = await tx
      .insert(voidAccessGrants)
      .values({ voidId, userId, role, grantedBy: actorId })
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
      targetId: userId,
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
      targetType: "user",
      targetId: grant.userId,
      metadata: { voidId: grant.voidId, role: grant.role },
    });
    return { ok: true as const };
  });
}
