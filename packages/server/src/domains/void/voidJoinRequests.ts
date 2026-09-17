import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  voidJoinRequests,
  voidAccessGrants,
  memberships,
  users,
  type VoidJoinRequest,
  type VoidAccessGrantRole,
} from "../../db/schema.js";
import { findVoidById } from "./voids.js";
import { getActiveMembership } from "../organization/memberships.js";
import { writeAuditLog } from "../audit/auditLog.js";
import { createNotification } from "../notification/notifications.js";

/**
 * Third feature pass — join-request workflow for a `private` Void (at any
 * nesting depth), modeled directly on domains/invitation/invitations.ts's
 * shape (create/list/decide, notifications on both ends). Renamed from the
 * second pass's Team-only teamJoinRequests now that Team no longer exists
 * as a separate entity (a Team is just a child Void). A `public` Void never
 * generates rows here — joining a public Void still only happens via a
 * Manager/Org Admin granting access directly.
 */

export type CreateVoidJoinRequestResult =
  | { ok: true; request: VoidJoinRequest }
  | {
      ok: false;
      reason:
        "void_not_found" | "not_private" | "not_org_member" | "already_member" | "already_pending";
    };

async function notifyManagersOrOrgAdmins(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  voidId: string,
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const managers = await tx
    .select({ userId: voidAccessGrants.userId })
    .from(voidAccessGrants)
    .where(and(eq(voidAccessGrants.voidId, voidId), eq(voidAccessGrants.role, "manager")));

  let recipientIds = managers.map((m) => m.userId);
  if (recipientIds.length === 0) {
    // No Manager grant on this Void — reuse canCreateChildVoid's own
    // fallback (Org Owner/Admin) rather than re-deriving a separate notion
    // of "who manages this Void."
    const admins = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          inArray(memberships.role, ["owner", "admin"]),
        ),
      );
    recipientIds = admins.map((a) => a.userId);
  }

  for (const userId of recipientIds) {
    await createNotification(tx, { userId, type: "void_join_requested", payload });
  }
}

export async function createVoidJoinRequest(
  voidId: string,
  userId: string,
): Promise<CreateVoidJoinRequestResult> {
  const voidRow = await findVoidById(voidId);
  if (!voidRow || voidRow.deletedAt) return { ok: false, reason: "void_not_found" as const };
  if (voidRow.visibility !== "private") return { ok: false, reason: "not_private" as const };

  const orgMembership = await getActiveMembership(userId, voidRow.organizationId);
  if (!orgMembership) return { ok: false, reason: "not_org_member" as const };

  const [existingGrant] = await db
    .select()
    .from(voidAccessGrants)
    .where(and(eq(voidAccessGrants.voidId, voidId), eq(voidAccessGrants.userId, userId)))
    .limit(1);
  if (existingGrant) return { ok: false, reason: "already_member" as const };

  try {
    return await db.transaction(async (tx) => {
      const [request] = await tx.insert(voidJoinRequests).values({ voidId, userId }).returning();

      await notifyManagersOrOrgAdmins(tx, voidId, voidRow.organizationId, {
        voidId,
        organizationId: voidRow.organizationId,
        requestId: request!.id,
        requesterUserId: userId,
      });

      return { ok: true as const, request: request! };
    });
  } catch {
    // Lost a race against a concurrent requestJoin call for the same
    // Void+User — the partial unique (voidId, userId) WHERE pending index
    // is the real safety net (mirrors findOrCreateTag's race-retry pattern).
    return { ok: false, reason: "already_pending" as const };
  }
}

export async function listPendingJoinRequestsForVoid(voidId: string) {
  return db
    .select({ request: voidJoinRequests, user: users })
    .from(voidJoinRequests)
    .innerJoin(users, eq(voidJoinRequests.userId, users.id))
    .where(and(eq(voidJoinRequests.voidId, voidId), eq(voidJoinRequests.status, "pending")));
}

export async function listVoidJoinRequestsForUser(userId: string): Promise<VoidJoinRequest[]> {
  return db.select().from(voidJoinRequests).where(eq(voidJoinRequests.userId, userId));
}

export async function findVoidJoinRequestById(requestId: string): Promise<VoidJoinRequest | null> {
  const [row] = await db
    .select()
    .from(voidJoinRequests)
    .where(eq(voidJoinRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

export type DecideVoidJoinRequestResult =
  { ok: true } | { ok: false; reason: "not_found" | "already_decided" | "role_required" };

/**
 * Third feature pass — the deciding Manager explicitly picks the granted
 * role on accept (viewer/editor/manager), not a fixed default (confirmed
 * with the user). `role` is required when `decision === "accepted"` and
 * ignored otherwise.
 */
export async function decideVoidJoinRequest(
  requestId: string,
  decision: "accepted" | "denied",
  role: VoidAccessGrantRole | null,
  actorId: string,
): Promise<DecideVoidJoinRequestResult> {
  const request = await findVoidJoinRequestById(requestId);
  if (!request) return { ok: false, reason: "not_found" as const };
  if (request.status !== "pending") return { ok: false, reason: "already_decided" as const };
  if (decision === "accepted" && !role) return { ok: false, reason: "role_required" as const };

  const voidRow = await findVoidById(request.voidId);
  if (!voidRow) return { ok: false, reason: "not_found" as const };

  await db.transaction(async (tx) => {
    await tx
      .update(voidJoinRequests)
      .set({
        status: decision,
        decidedBy: actorId,
        decidedAt: new Date(),
        grantedRole: decision === "accepted" ? role : null,
      })
      .where(eq(voidJoinRequests.id, requestId));

    if (decision === "accepted") {
      // Idempotent upsert, matching grantVoidAccess's own style — a second
      // accept (already guarded against by the pending-status check above,
      // but kept defensive) would still not duplicate the grant.
      await tx
        .insert(voidAccessGrants)
        .values({ voidId: request.voidId, userId: request.userId, role: role!, grantedBy: actorId })
        .onConflictDoUpdate({
          target: [voidAccessGrants.voidId, voidAccessGrants.userId],
          set: { role: role!, grantedBy: actorId },
        });
    }

    await writeAuditLog(tx, {
      organizationId: voidRow.organizationId,
      actorId,
      eventType:
        decision === "accepted" ? "void_join_request.accepted" : "void_join_request.denied",
      targetType: "void_join_request",
      targetId: requestId,
      metadata: { voidId: request.voidId, userId: request.userId, role },
    });

    await createNotification(tx, {
      userId: request.userId,
      type: decision === "accepted" ? "void_join_approved" : "void_join_denied",
      payload: { voidId: request.voidId, organizationId: voidRow.organizationId },
    });
  });

  return { ok: true as const };
}
