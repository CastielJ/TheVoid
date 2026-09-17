import { eq, and, isNull, ne, or, exists, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  voids,
  voidAccessGrants,
  memberships,
  type Void,
  type VoidVisibility,
} from "../../db/schema.js";
import { writeAuditLog } from "../audit/auditLog.js";
import { getUsersDisplayInfo, type UserDisplayInfo } from "../auth/users.js";

export type CreateVoidResult =
  | { ok: true; void: Void }
  | { ok: false; reason: "parent_not_found" | "parent_not_in_organization" };

/**
 * Third feature pass — Void is a self-referencing hierarchy: a "Team" is
 * just a Void with `parentVoidId` set (imagine a subdirectory). The creator
 * always receives a direct Manager grant on the Void they just created — no
 * automatic membership beyond that; members of a fresh child Void are added
 * explicitly afterward via the member-management UI (`grantVoidAccess`),
 * not inherited from the parent. Enforces C3: `parentVoidId`, if set, must
 * resolve to a real, non-deleted Void in the same Organization.
 */
export async function createVoid(
  organizationId: string,
  name: string,
  parentVoidId: string | null,
  visibility: VoidVisibility,
  creatorUserId: string,
): Promise<CreateVoidResult> {
  return db.transaction(async (tx) => {
    if (parentVoidId) {
      const [parent] = await tx.select().from(voids).where(eq(voids.id, parentVoidId)).limit(1);
      if (!parent || parent.deletedAt) return { ok: false, reason: "parent_not_found" as const };
      if (parent.organizationId !== organizationId) {
        return { ok: false, reason: "parent_not_in_organization" as const };
      }
    }

    const [voidRow] = await tx
      .insert(voids)
      .values({ organizationId, parentVoidId, visibility, name, createdBy: creatorUserId })
      .returning();

    await tx.insert(voidAccessGrants).values({
      voidId: voidRow!.id,
      userId: creatorUserId,
      role: "manager",
      grantedBy: creatorUserId,
    });

    await writeAuditLog(tx, {
      organizationId,
      actorId: creatorUserId,
      eventType: "void.created",
      targetType: "void",
      targetId: voidRow!.id,
      metadata: { name, parentVoidId, visibility },
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

export async function updateVoidVisibility(
  voidId: string,
  visibility: VoidVisibility,
  actorId: string,
): Promise<void> {
  const voidRow = await findVoidById(voidId);
  if (!voidRow || voidRow.deletedAt) return;
  await db.transaction(async (tx) => {
    await tx.update(voids).set({ visibility }).where(eq(voids.id, voidId));
    await writeAuditLog(tx, {
      organizationId: voidRow.organizationId,
      actorId,
      eventType: "void.visibility_changed",
      targetType: "void",
      targetId: voidId,
      metadata: { visibility },
    });
  });
}

export type DeleteVoidResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * Soft-delete only (ID1/ID16) — Groups/Tasks beneath this Void are not
 * touched; they become unreachable via the Void-level exclusion instead
 * (an O(1) delete regardless of Void size). Child Voids (Teams nested under
 * this one) are NOT cascade-soft-deleted either — same rationale, and they
 * become unreachable in listings once their own ancestor chain hits a
 * deleted Void (listChildVoids/listVoidAncestors both check `deletedAt`).
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

function accessibleCondition(userId: string) {
  return exists(
    db
      .select()
      .from(voidAccessGrants)
      .where(and(eq(voidAccessGrants.voidId, voids.id), eq(voidAccessGrants.userId, userId))),
  );
}

/**
 * Voids in `organizationId` that `userId` can currently access via a direct
 * grant — excluding deleted Voids (architecture.md §6.2's standard query-
 * exclusion default). Third feature pass: no more Team-derived branch —
 * every grant is already a plain per-user grant.
 */
export async function listAccessibleVoids(userId: string, organizationId: string): Promise<Void[]> {
  return db
    .select()
    .from(voids)
    .where(
      and(
        eq(voids.organizationId, organizationId),
        isNull(voids.deletedAt),
        accessibleCondition(userId),
      ),
    );
}

export interface VoidWithMembership extends Void {
  /** Powers the left-panel tree's "show a join button at all" decision. */
  isMember: boolean;
}

async function withMembership(rows: Void[], userId: string): Promise<VoidWithMembership[]> {
  if (rows.length === 0) return [];
  const grantRows = await db
    .select({ voidId: voidAccessGrants.voidId })
    .from(voidAccessGrants)
    .where(
      and(
        inArray(
          voidAccessGrants.voidId,
          rows.map((r) => r.id),
        ),
        eq(voidAccessGrants.userId, userId),
      ),
    );
  const memberVoidIds = new Set(grantRows.map((g) => g.voidId));
  return rows.map((r) => ({ ...r, isMember: memberVoidIds.has(r.id) }));
}

/**
 * Third feature pass — the single choke point for "which top-level Voids in
 * this Organization can this user see" (visibility: public/private/
 * invisible), the root-level counterpart to `listChildVoids` below — a
 * top-level Void is really just "a child of the Organization itself," so it
 * gets the exact same discovery rule: visible unless `invisible`, in which
 * case only a directly-granted user sees it. Powers `OrgDashboardPage`'s
 * Voids list and the left panel tree's root level; `isMember` distinguishes
 * "I can open this" from "I can see this exists and request to join."
 */
export async function listTopLevelAccessibleVoids(
  userId: string,
  organizationId: string,
): Promise<VoidWithMembership[]> {
  const rows = await db
    .select()
    .from(voids)
    .where(
      and(
        eq(voids.organizationId, organizationId),
        isNull(voids.parentVoidId),
        isNull(voids.deletedAt),
        or(ne(voids.visibility, "invisible"), accessibleCondition(userId)),
      ),
    );
  return withMembership(rows, userId);
}

/**
 * The nested-child counterpart to `listTopLevelAccessibleVoids` above — same
 * discovery rule (visible unless invisible-and-ungranted), scoped to a
 * specific parent Void instead of the Organization root.
 */
export async function listChildVoids(
  parentVoidId: string,
  userId: string,
): Promise<VoidWithMembership[]> {
  const rows = await db
    .select()
    .from(voids)
    .where(
      and(
        eq(voids.parentVoidId, parentVoidId),
        isNull(voids.deletedAt),
        or(ne(voids.visibility, "invisible"), accessibleCondition(userId)),
      ),
    );
  return withMembership(rows, userId);
}

/**
 * Walks `parentVoidId` up to the root, root-first, for breadcrumb
 * navigation. Depth capped defensively — the schema has no cycle
 * prevention beyond application-level discipline (createVoid always
 * validates the parent exists before insert, so a cycle should never form,
 * but an unbounded walk would hang the request if one ever did).
 */
export async function listVoidAncestors(voidId: string): Promise<Void[]> {
  const chain: Void[] = [];
  let currentId: string | null = voidId;
  for (let depth = 0; depth < 10 && currentId; depth++) {
    const current = await findVoidById(currentId);
    if (!current) break;
    if (current.id !== voidId) chain.push(current);
    currentId = current.parentVoidId;
  }
  return chain.reverse();
}

/**
 * Post-launch refinement pass — powers the assignee search picker: which
 * users can plausibly be assigned a Task in this Void. Third feature pass:
 * simplified to plain grant holders only (the old Team-derived branch is
 * gone — a Team's members are already just per-user grants on that Void).
 */
export async function listEligibleMembersForVoid(
  voidId: string,
  query?: string,
): Promise<UserDisplayInfo[]> {
  const grants = await db
    .select({ userId: voidAccessGrants.userId })
    .from(voidAccessGrants)
    .where(eq(voidAccessGrants.voidId, voidId));
  if (grants.length === 0) return [];

  const displayInfoMap = await getUsersDisplayInfo(grants.map((g) => g.userId));
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

/**
 * Third feature pass — the "Add member" picker for a Void's settings page:
 * active Organization members who do NOT already hold a grant on this
 * Void. Distinct from listEligibleMembersForVoid above (which answers "who
 * can I assign a Task to" — current members only); this answers "who could
 * I grant access to" — everyone else in the Org.
 */
export async function listOrganizationMembersEligibleForGrant(
  voidId: string,
  query?: string,
): Promise<UserDisplayInfo[]> {
  const voidRow = await findVoidById(voidId);
  if (!voidRow) return [];

  const existingGrantUserIds = db
    .select({ userId: voidAccessGrants.userId })
    .from(voidAccessGrants)
    .where(eq(voidAccessGrants.voidId, voidId));

  const orgMembers = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(eq(memberships.organizationId, voidRow.organizationId), eq(memberships.status, "active")),
    );

  const alreadyGranted = new Set((await existingGrantUserIds).map((g) => g.userId));
  const eligibleUserIds = orgMembers.map((m) => m.userId).filter((id) => !alreadyGranted.has(id));
  if (eligibleUserIds.length === 0) return [];

  const displayInfoMap = await getUsersDisplayInfo(eligibleUserIds);
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
