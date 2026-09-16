import { eq, and, isNull, or, exists, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { voids, voidAccessGrants, teams, teamMemberships, type Void } from "../../db/schema.js";
import { writeAuditLog } from "../audit/auditLog.js";

export type CreateVoidResult =
  { ok: true; void: Void } | { ok: false; reason: "team_not_in_organization" };

/**
 * Void creation (architecture.md §4, D14, A1/A2 — generalized, see
 * docs/decisions.md Phase 3 Execution Notes): the creator always receives a
 * direct Manager grant on the Void they just created. If `teamId` is set,
 * the Team additionally receives a default Editor grant (D14's "visible to
 * that Team by default"), implemented as an actual grant since Void access
 * has no other mechanism (C1/Non-negotiable #4). Enforces C3: `teamId`, if
 * set, must belong to the same Organization as the Void.
 */
export async function createVoid(
  organizationId: string,
  name: string,
  teamId: string | null,
  creatorUserId: string,
): Promise<CreateVoidResult> {
  return db.transaction(async (tx) => {
    if (teamId) {
      const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).limit(1);
      if (!team || team.organizationId !== organizationId) {
        return { ok: false, reason: "team_not_in_organization" as const };
      }
    }

    const [voidRow] = await tx
      .insert(voids)
      .values({ organizationId, teamId, name, createdBy: creatorUserId })
      .returning();

    await tx.insert(voidAccessGrants).values({
      voidId: voidRow!.id,
      userId: creatorUserId,
      role: "manager",
      grantedBy: creatorUserId,
    });
    if (teamId) {
      await tx.insert(voidAccessGrants).values({
        voidId: voidRow!.id,
        teamId,
        role: "editor",
        grantedBy: creatorUserId,
      });
    }

    await writeAuditLog(tx, {
      organizationId,
      actorId: creatorUserId,
      eventType: "void.created",
      targetType: "void",
      targetId: voidRow!.id,
      metadata: { name, teamId },
    });

    return { ok: true as const, void: voidRow! };
  });
}

/**
 * Raw lookup — does NOT filter `deleted_at` (architecture.md §6.2's query-
 * exclusion default applies to listing/search, not to this internal
 * lookup). Authorization (authorization/capabilities.ts) relies on seeing
 * `deletedAt` itself to correctly deny access to a deleted Void.
 */
export async function findVoidById(voidId: string): Promise<Void | null> {
  const [row] = await db.select().from(voids).where(eq(voids.id, voidId)).limit(1);
  return row ?? null;
}

export async function updateVoidName(voidId: string, name: string, actorId: string): Promise<void> {
  const voidRow = await findVoidById(voidId);
  if (!voidRow || voidRow.deletedAt) return;
  await db.transaction(async (tx) => {
    await tx.update(voids).set({ name }).where(eq(voids.id, voidId));
    await writeAuditLog(tx, {
      organizationId: voidRow.organizationId,
      actorId,
      eventType: "void.updated",
      targetType: "void",
      targetId: voidId,
      metadata: { name },
    });
  });
}

export type DeleteVoidResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * Soft-delete only (ID1/ID16) — Groups/Tasks beneath this Void are not
 * touched; they become unreachable via the Void-level exclusion instead
 * (an O(1) delete regardless of Void size).
 */
export async function deleteVoid(voidId: string, actorId: string): Promise<DeleteVoidResult> {
  const voidRow = await findVoidById(voidId);
  if (!voidRow || voidRow.deletedAt) return { ok: false, reason: "not_found" as const };

  return db.transaction(async (tx) => {
    await tx.update(voids).set({ deletedAt: new Date() }).where(eq(voids.id, voidId));
    await writeAuditLog(tx, {
      organizationId: voidRow.organizationId,
      actorId,
      eventType: "void.deleted",
      targetType: "void",
      targetId: voidId,
    });
    return { ok: true as const };
  });
}

/**
 * Voids in `organizationId` that `userId` can currently access — via a
 * direct grant or a grant on any Team they belong to — excluding deleted
 * Voids (architecture.md §6.2's standard query-exclusion default).
 */
export async function listAccessibleVoids(userId: string, organizationId: string): Promise<Void[]> {
  const userTeamIds = db
    .select({ id: teamMemberships.teamId })
    .from(teamMemberships)
    .where(eq(teamMemberships.userId, userId));

  return db
    .select()
    .from(voids)
    .where(
      and(
        eq(voids.organizationId, organizationId),
        isNull(voids.deletedAt),
        or(
          exists(
            db
              .select()
              .from(voidAccessGrants)
              .where(
                and(eq(voidAccessGrants.voidId, voids.id), eq(voidAccessGrants.userId, userId)),
              ),
          ),
          exists(
            db
              .select()
              .from(voidAccessGrants)
              .where(
                and(
                  eq(voidAccessGrants.voidId, voids.id),
                  inArray(voidAccessGrants.teamId, userTeamIds),
                ),
              ),
          ),
        ),
      ),
    );
}
