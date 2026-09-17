import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  teamMemberships,
  teams,
  memberships,
  users,
  type TeamMembership,
} from "../../db/schema.js";
import { writeAuditLog } from "../audit/auditLog.js";
import { findTeamById } from "./teams.js";

export async function getTeamMembership(
  userId: string,
  teamId: string,
): Promise<TeamMembership | null> {
  const [row] = await db
    .select()
    .from(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Second feature pass — powers the left-panel Teams/Voids tree's "is the
 * current user already a member of this Team" check (to decide whether to
 * show a join button at all), batched across every visible Team in one
 * query rather than one getTeamMembership call per Team.
 */
export async function listTeamIdsUserIsMemberOf(
  userId: string,
  teamIds: string[],
): Promise<Set<string>> {
  if (teamIds.length === 0) return new Set();
  const rows = await db
    .select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.userId, userId), inArray(teamMemberships.teamId, teamIds)));
  return new Set(rows.map((r) => r.teamId));
}

export async function listTeamMembers(teamId: string) {
  return db
    .select({ teamMembership: teamMemberships, user: users })
    .from(teamMemberships)
    .innerJoin(users, eq(teamMemberships.userId, users.id))
    .where(eq(teamMemberships.teamId, teamId));
}

export type AddTeamMemberResult =
  { ok: true } | { ok: false; reason: "team_not_found" | "user_not_org_member" | "already_member" };

/**
 * C3 invariant: a Team's members must belong to the Team's Organization
 * (i.e. have an active Membership there) — enforced here at the application
 * layer per architecture.md §4.1's recommendation for this low-frequency,
 * already-gated admin action.
 */
export async function addTeamMember(
  teamId: string,
  userId: string,
  actorId: string,
): Promise<AddTeamMemberResult> {
  return db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) return { ok: false, reason: "team_not_found" as const };

    const [orgMembership] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, team.organizationId),
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!orgMembership) return { ok: false, reason: "user_not_org_member" as const };

    const [existing] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
      .limit(1);
    if (existing) return { ok: false, reason: "already_member" as const };

    await tx.insert(teamMemberships).values({ teamId, userId });
    await writeAuditLog(tx, {
      organizationId: team.organizationId,
      actorId,
      eventType: "team.member_added",
      targetType: "user",
      targetId: userId,
      metadata: { teamId },
    });
    return { ok: true as const };
  });
}

export type RemoveTeamMemberResult = { ok: true } | { ok: false; reason: "not_found" };

export async function removeTeamMember(
  teamId: string,
  userId: string,
  actorId: string,
): Promise<RemoveTeamMemberResult> {
  const team = await findTeamById(teamId);
  if (!team) return { ok: false, reason: "not_found" as const };

  return db.transaction(async (tx) => {
    const result = await tx
      .delete(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
      .returning();
    if (result.length === 0) return { ok: false, reason: "not_found" as const };

    await writeAuditLog(tx, {
      organizationId: team.organizationId,
      actorId,
      eventType: "team.member_removed",
      targetType: "user",
      targetId: userId,
      metadata: { teamId },
    });
    return { ok: true as const };
  });
}

export type SetTeamLeadResult = { ok: true } | { ok: false; reason: "not_found" };

export async function setTeamLead(
  teamId: string,
  userId: string,
  isTeamLead: boolean,
  actorId: string,
): Promise<SetTeamLeadResult> {
  const team = await findTeamById(teamId);
  if (!team) return { ok: false, reason: "not_found" as const };

  return db.transaction(async (tx) => {
    const result = await tx
      .update(teamMemberships)
      .set({ isTeamLead })
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
      .returning();
    if (result.length === 0) return { ok: false, reason: "not_found" as const };

    await writeAuditLog(tx, {
      organizationId: team.organizationId,
      actorId,
      eventType: "team.lead_changed",
      targetType: "user",
      targetId: userId,
      metadata: { teamId, isTeamLead },
    });
    return { ok: true as const };
  });
}
