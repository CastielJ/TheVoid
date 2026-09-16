import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { teams, type Team } from "../../db/schema.js";
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
