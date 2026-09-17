import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  teamJoinRequests,
  teamMemberships,
  memberships,
  users,
  type TeamJoinRequest,
} from "../../db/schema.js";
import { findTeamById } from "./teams.js";
import { getTeamMembership } from "./teamMemberships.js";
import { getActiveMembership } from "../organization/memberships.js";
import { writeAuditLog } from "../audit/auditLog.js";
import { createNotification } from "../notification/notifications.js";

/**
 * Second feature pass — join-request workflow for a `private` Team, modeled
 * directly on domains/invitation/invitations.ts's shape (create/list/decide,
 * notifications on both ends) rather than a new pattern. A `public` Team
 * never generates rows here — joining a public Team still only happens via
 * the existing Team Lead/Org Admin addTeamMember path (confirmed with the
 * user: "public" only changes visibility, not how joining works).
 */

export type CreateTeamJoinRequestResult =
  | { ok: true; request: TeamJoinRequest }
  | {
      ok: false;
      reason:
        "team_not_found" | "not_private" | "not_org_member" | "already_member" | "already_pending";
    };

async function notifyTeamLeadsOrOrgAdmins(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  teamId: string,
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const leads = await tx
    .select({ userId: teamMemberships.userId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.isTeamLead, true)));

  let recipientIds = leads.map((l) => l.userId);
  if (recipientIds.length === 0) {
    // No Team Lead set — reuse canManageTeam's own fallback (Org Owner/Admin)
    // rather than re-deriving a separate notion of "who manages this team."
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
    await createNotification(tx, { userId, type: "team_join_requested", payload });
  }
}

export async function createTeamJoinRequest(
  teamId: string,
  userId: string,
): Promise<CreateTeamJoinRequestResult> {
  const team = await findTeamById(teamId);
  if (!team) return { ok: false, reason: "team_not_found" as const };
  if (team.visibility !== "private") return { ok: false, reason: "not_private" as const };

  const orgMembership = await getActiveMembership(userId, team.organizationId);
  if (!orgMembership) return { ok: false, reason: "not_org_member" as const };

  const existingTeamMembership = await getTeamMembership(userId, teamId);
  if (existingTeamMembership) return { ok: false, reason: "already_member" as const };

  try {
    return await db.transaction(async (tx) => {
      const [request] = await tx.insert(teamJoinRequests).values({ teamId, userId }).returning();

      await notifyTeamLeadsOrOrgAdmins(tx, teamId, team.organizationId, {
        teamId,
        organizationId: team.organizationId,
        requestId: request!.id,
        requesterUserId: userId,
      });

      return { ok: true as const, request: request! };
    });
  } catch {
    // Lost a race against a concurrent requestJoin call for the same
    // Team+User — the partial unique (teamId, userId) WHERE pending index is
    // the real safety net (mirrors findOrCreateTag's race-retry pattern).
    return { ok: false, reason: "already_pending" as const };
  }
}

export async function listPendingJoinRequestsForTeam(teamId: string) {
  return db
    .select({ request: teamJoinRequests, user: users })
    .from(teamJoinRequests)
    .innerJoin(users, eq(teamJoinRequests.userId, users.id))
    .where(and(eq(teamJoinRequests.teamId, teamId), eq(teamJoinRequests.status, "pending")));
}

export async function listTeamJoinRequestsForUser(userId: string): Promise<TeamJoinRequest[]> {
  return db.select().from(teamJoinRequests).where(eq(teamJoinRequests.userId, userId));
}

export async function findTeamJoinRequestById(requestId: string): Promise<TeamJoinRequest | null> {
  const [row] = await db
    .select()
    .from(teamJoinRequests)
    .where(eq(teamJoinRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

export type DecideTeamJoinRequestResult =
  { ok: true } | { ok: false; reason: "not_found" | "already_decided" };

export async function decideTeamJoinRequest(
  requestId: string,
  decision: "accepted" | "denied",
  actorId: string,
): Promise<DecideTeamJoinRequestResult> {
  const request = await findTeamJoinRequestById(requestId);
  if (!request) return { ok: false, reason: "not_found" as const };
  if (request.status !== "pending") return { ok: false, reason: "already_decided" as const };

  const team = await findTeamById(request.teamId);
  if (!team) return { ok: false, reason: "not_found" as const };

  await db.transaction(async (tx) => {
    await tx
      .update(teamJoinRequests)
      .set({ status: decision, decidedBy: actorId, decidedAt: new Date() })
      .where(eq(teamJoinRequests.id, requestId));

    if (decision === "accepted") {
      // Idempotent insert, matching addTeamMember's own style — a second
      // accept (already guarded against by the pending-status check above,
      // but kept defensive) would still not duplicate the membership.
      await tx
        .insert(teamMemberships)
        .values({ teamId: request.teamId, userId: request.userId })
        .onConflictDoNothing();
    }

    await writeAuditLog(tx, {
      organizationId: team.organizationId,
      actorId,
      eventType:
        decision === "accepted" ? "team_join_request.accepted" : "team_join_request.denied",
      targetType: "team_join_request",
      targetId: requestId,
      metadata: { teamId: request.teamId, userId: request.userId },
    });

    await createNotification(tx, {
      userId: request.userId,
      type: decision === "accepted" ? "team_join_approved" : "team_join_denied",
      payload: { teamId: request.teamId, organizationId: team.organizationId },
    });
  });

  return { ok: true as const };
}
