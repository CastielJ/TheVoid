import { eq, and, or, ne, exists } from "drizzle-orm";
import { db } from "../../db/client.js";
import { teams, teamMemberships, type Team, type TeamVisibility } from "../../db/schema.js";
import { writeAuditLog } from "../audit/auditLog.js";

export async function createTeam(
  organizationId: string,
  name: string,
  actorId: string,
): Promise<Team> {
  return db.transaction(async (tx) => {
    const [team] = await tx.insert(teams).values({ organizationId, name }).returning();
    await writeAuditLog(tx, {
      organizationId,
      actorId,
      eventType: "team.created",
      targetType: "team",
      targetId: team!.id,
      metadata: { name },
    });
    return team!;
  });
}

export async function findTeamById(teamId: string): Promise<Team | null> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  return team ?? null;
}

export async function listTeamsForOrganization(organizationId: string): Promise<Team[]> {
  return db.select().from(teams).where(eq(teams.organizationId, organizationId));
}

/**
 * Second feature pass — the single choke point for "which Teams can this
 * user see" (visibility: public/private/invisible). Every existing caller of
 * listTeamsForOrganization is meant to switch to this one instead, so
 * invisible-Team enforcement applies everywhere Teams are listed (the
 * Void-creation Team picker included), not just the new left-panel tree —
 * confirmed with the user as "everywhere, consistently."
 */
export async function listVisibleTeamsForOrganization(
  organizationId: string,
  userId: string,
): Promise<Team[]> {
  return db
    .select({ team: teams })
    .from(teams)
    .where(
      and(
        eq(teams.organizationId, organizationId),
        or(
          ne(teams.visibility, "invisible"),
          exists(
            db
              .select()
              .from(teamMemberships)
              .where(and(eq(teamMemberships.teamId, teams.id), eq(teamMemberships.userId, userId))),
          ),
        ),
      ),
    )
    .then((rows) => rows.map((r) => r.team));
}

export async function updateTeamName(teamId: string, name: string, actorId: string): Promise<void> {
  const team = await findTeamById(teamId);
  if (!team) return;
  await db.transaction(async (tx) => {
    await tx.update(teams).set({ name }).where(eq(teams.id, teamId));
    await writeAuditLog(tx, {
      organizationId: team.organizationId,
      actorId,
      eventType: "team.updated",
      targetType: "team",
      targetId: teamId,
      metadata: { name },
    });
  });
}

export async function updateTeamVisibility(
  teamId: string,
  visibility: TeamVisibility,
  actorId: string,
): Promise<void> {
  const team = await findTeamById(teamId);
  if (!team) return;
  await db.transaction(async (tx) => {
    await tx.update(teams).set({ visibility }).where(eq(teams.id, teamId));
    await writeAuditLog(tx, {
      organizationId: team.organizationId,
      actorId,
      eventType: "team.visibility_changed",
      targetType: "team",
      targetId: teamId,
      metadata: { visibility },
    });
  });
}

export async function deleteTeam(teamId: string, actorId: string): Promise<void> {
  const team = await findTeamById(teamId);
  if (!team) return;
  await db.transaction(async (tx) => {
    // Cascades TeamMembership rows via the FK's onDelete: "cascade".
    await tx.delete(teams).where(eq(teams.id, teamId));
    await writeAuditLog(tx, {
      organizationId: team.organizationId,
      actorId,
      eventType: "team.deleted",
      targetType: "team",
      targetId: teamId,
      metadata: { name: team.name },
    });
  });
}
