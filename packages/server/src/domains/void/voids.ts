import { eq, and, isNull, isNotNull, or, exists, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { voids, voidAccessGrants, teams, teamMemberships, type Void } from "../../db/schema.js";
import { writeAuditLog } from "../audit/auditLog.js";
import { getUsersDisplayInfo, type UserDisplayInfo } from "../auth/users.js";

export interface VoidWithTeamGrants {
  void: Void;
  teamIds: string[];
}

/**
 * Second feature pass — powers the new left-panel Teams/Voids tree. A Void
 * granted to more than one Team (already fully supported structurally by
 * voidAccessGrants — a Void can have grants to multiple Teams
 * simultaneously) needs to render once per Team it's granted to, with a
 * "shared" badge — this returns each accessible Void alongside every
 * teamId that currently has a grant on it (not just Teams the caller
 * belongs to), in one aggregate query rather than N+1 per-Void lookups.
 */
export async function listAccessibleVoidsWithTeamGrants(
  userId: string,
  organizationId: string,
): Promise<VoidWithTeamGrants[]> {
  const accessibleVoids = await listAccessibleVoids(userId, organizationId);
  if (accessibleVoids.length === 0) return [];

  const voidIds = accessibleVoids.map((v) => v.id);
  const grantRows = await db
    .select({ voidId: voidAccessGrants.voidId, teamId: voidAccessGrants.teamId })
    .from(voidAccessGrants)
    .where(and(inArray(voidAccessGrants.voidId, voidIds), isNotNull(voidAccessGrants.teamId)));

  const teamIdsByVoidId = new Map<string, string[]>();
  for (const row of grantRows) {
    const list = teamIdsByVoidId.get(row.voidId) ?? [];
    list.push(row.teamId!);
    teamIdsByVoidId.set(row.voidId, list);
  }

  return accessibleVoids.map((v) => ({ void: v, teamIds: teamIdsByVoidId.get(v.id) ?? [] }));
}

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

/**
 * Post-launch refinement pass — powers the assignee search picker. Unifies
 * direct VoidAccessGrant users and Team-derived access into one deduped,
 * human-readable-identity list, fixing the previous gap where a direct
 * grant with no Team membership had no email/display source at all (it
 * rendered as a truncated UUID client-side). Authorization-scoped exactly
 * like listAccessibleVoids: never returns a user without current access to
 * this specific Void.
 */
export async function listEligibleMembersForVoid(
  voidId: string,
  query?: string,
): Promise<UserDisplayInfo[]> {
  const direct = await db
    .select({ userId: voidAccessGrants.userId })
    .from(voidAccessGrants)
    .where(and(eq(voidAccessGrants.voidId, voidId), isNotNull(voidAccessGrants.userId)));

  const teamDerived = await db
    .select({ userId: teamMemberships.userId })
    .from(voidAccessGrants)
    .innerJoin(teamMemberships, eq(teamMemberships.teamId, voidAccessGrants.teamId))
    .where(eq(voidAccessGrants.voidId, voidId));

  const userIds = [
    ...new Set(
      [...direct.map((d) => d.userId), ...teamDerived.map((t) => t.userId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  if (userIds.length === 0) return [];

  const displayInfoMap = await getUsersDisplayInfo(userIds);
  let results = [...displayInfoMap.values()];

  const trimmedQuery = query?.trim().toLowerCase();
  if (trimmedQuery) {
    results = results.filter(
      (r) =>
        r.username.toLowerCase().includes(trimmedQuery) ||
        r.visibleName.toLowerCase().includes(trimmedQuery),
    );
  }

  return results.sort((a, b) => a.visibleName.localeCompare(b.visibleName));
}
