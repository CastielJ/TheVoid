import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  memberships,
  voidAccessGrants,
  users,
  voids,
  tasks,
  taskAssignees,
  organizations,
  type Membership,
} from "../../db/schema.js";
import { writeAuditLog } from "../audit/auditLog.js";
import { recordTaskActivity } from "../task/taskActivity.js";
import { createNotification } from "../notification/notifications.js";

export async function getActiveMembership(
  userId: string,
  organizationId: string,
): Promise<Membership | null> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Organizations `userId` currently belongs to (active Membership) — the
 * frontend's entry point for "which orgs can this person even see" (there
 * is no other discovery path pre-Phase-7 invitations). Ungated by design,
 * same reasoning as `void.list`: scoped to the caller by construction.
 */
export async function listOrganizationsForUser(userId: string) {
  const rows = await db
    .select({ organization: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
  return rows.map(({ organization, role }) => ({ ...organization, role }));
}

export async function listActiveMembers(organizationId: string) {
  return db
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active")));
}

export type UpdateMemberRoleResult =
  { ok: true } | { ok: false; reason: "not_found" | "cannot_change_owner_role" };

/** Ownership is never set here — see transferOwnership below (C7). */
export async function updateMemberRole(
  organizationId: string,
  targetUserId: string,
  newRole: "admin" | "member",
  actorId: string,
): Promise<UpdateMemberRoleResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, targetUserId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!target) return { ok: false, reason: "not_found" as const };
    if (target.role === "owner") return { ok: false, reason: "cannot_change_owner_role" as const };
    if (target.role === newRole) return { ok: true as const };

    await tx.update(memberships).set({ role: newRole }).where(eq(memberships.id, target.id));
    await writeAuditLog(tx, {
      organizationId,
      actorId,
      eventType: "member.role_changed",
      targetType: "user",
      targetId: targetUserId,
      metadata: { previousRole: target.role, newRole },
    });
    await createNotification(tx, {
      userId: targetUserId,
      type: "role_changed",
      payload: { organizationId, previousRole: target.role, newRole },
    });
    return { ok: true as const };
  });
}

export type RemoveMemberResult =
  { ok: true } | { ok: false; reason: "not_found" | "cannot_remove_owner" };

/**
 * D17: Membership ends, this Organization's Void access grants end (third
 * feature pass: a "Team membership" is now just a VoidAccessGrant on some
 * child Void, so ending it is a plain grant-deletion instead of a separate
 * teamMemberships table). Access was already blocked the instant Membership
 * flips to "removed" regardless of any lingering grant row (getVoidRole
 * requires an active Membership before ever consulting a grant), but
 * deleting the rows here keeps every Void's member listing accurate rather
 * than showing a removed member who can no longer actually access anything.
 * Task assignments remain associated with the former member but are flagged
 * inactive (C8/D17 interaction) — for a manager to later reassign, not
 * silently dropped. All other data/history stays intact.
 */
export async function removeMember(
  organizationId: string,
  targetUserId: string,
  actorId: string,
): Promise<RemoveMemberResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, targetUserId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!target) return { ok: false, reason: "not_found" as const };
    if (target.role === "owner") return { ok: false, reason: "cannot_remove_owner" as const };

    await tx
      .update(memberships)
      .set({ status: "removed", removedAt: new Date() })
      .where(eq(memberships.id, target.id));

    const orgVoidIds = tx
      .select({ id: voids.id })
      .from(voids)
      .where(eq(voids.organizationId, organizationId));
    await tx
      .delete(voidAccessGrants)
      .where(
        and(
          eq(voidAccessGrants.userId, targetUserId),
          inArray(voidAccessGrants.voidId, orgVoidIds),
        ),
      );

    // D17/C8: flip this member's active assignments across the whole
    // Organization to inactive — never delete the row, so a manager can see
    // and later reassign the work.
    const orgTaskIds = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.voidId, orgVoidIds));
    const flippedAssignments = await tx
      .update(taskAssignees)
      .set({ assigneeActive: false })
      .where(
        and(
          eq(taskAssignees.userId, targetUserId),
          eq(taskAssignees.assigneeActive, true),
          inArray(taskAssignees.taskId, orgTaskIds),
        ),
      )
      .returning({ taskId: taskAssignees.taskId });
    for (const { taskId } of flippedAssignments) {
      await recordTaskActivity(tx, {
        taskId,
        actorId,
        field: "assignees",
        oldValue: `active:${targetUserId}`,
        newValue: `inactive:${targetUserId}`,
      });
    }

    await writeAuditLog(tx, {
      organizationId,
      actorId,
      eventType: "member.removed",
      targetType: "user",
      targetId: targetUserId,
    });
    return { ok: true as const };
  });
}

export type TransferOwnershipResult =
  | { ok: true }
  | { ok: false; reason: "no_active_owner" | "already_owner" | "target_not_active_member" };

/**
 * C7: a single transaction — demote the current owner's Membership, then
 * promote the target's. `FOR UPDATE` on the current-owner row serializes
 * concurrent transfer attempts; the partial unique index (db/schema.ts)
 * makes a zero/two-active-owner intermediate state impossible to commit
 * even if this locking were somehow bypassed.
 */
export async function transferOwnership(
  organizationId: string,
  newOwnerUserId: string,
  actorId: string,
): Promise<TransferOwnershipResult> {
  return db.transaction(async (tx) => {
    const [currentOwner] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active"),
        ),
      )
      .for("update")
      .limit(1);
    if (!currentOwner) return { ok: false, reason: "no_active_owner" as const };
    if (currentOwner.userId === newOwnerUserId)
      return { ok: false, reason: "already_owner" as const };

    const [target] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, newOwnerUserId),
          eq(memberships.status, "active"),
        ),
      )
      .for("update")
      .limit(1);
    if (!target) return { ok: false, reason: "target_not_active_member" as const };

    await tx.update(memberships).set({ role: "admin" }).where(eq(memberships.id, currentOwner.id));
    await tx.update(memberships).set({ role: "owner" }).where(eq(memberships.id, target.id));

    await writeAuditLog(tx, {
      organizationId,
      actorId,
      eventType: "organization.ownership_transferred",
      targetType: "user",
      targetId: newOwnerUserId,
      metadata: { previousOwnerId: currentOwner.userId },
    });
    return { ok: true as const };
  });
}
