import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { voidAccessGrants, teamMemberships, type VoidAccessGrantRole } from "../db/schema.js";
import { getActiveMembership } from "../domains/organization/memberships.js";
import { findTeamById } from "../domains/team/teams.js";
import { getTeamMembership } from "../domains/team/teamMemberships.js";
import { findVoidById } from "../domains/void/voids.js";
import { findVoidAccessGrantById } from "../domains/void/voidAccessGrants.js";
import { findGroupById } from "../domains/group/groups.js";
import { findTaskById } from "../domains/task/tasks.js";
import { findChecklistItemById } from "../domains/task/checklistItems.js";
import { findCommentById } from "../domains/task/comments.js";
import { findInvitationById } from "../domains/invitation/invitations.js";

/**
 * Capability-based authorization engine (architecture.md §3, corrected per
 * C1: Org Admin/Owner never automatically bypass Void access). Every
 * function here queries current database state directly on every call — no
 * caching layer (implementation-plan.md §4's reaffirmed non-regression
 * rule: introducing caching later is itself a new security-sensitive
 * decision, not a quiet performance tweak).
 *
 * Every tRPC procedure that needs a capability check calls it via the
 * `requireCapability` middleware helper (trpc.ts) rather than importing and
 * calling a function inline, so no procedure grows its own ad hoc role
 * check (Non-negotiable #8).
 */

export async function canManageOrganization(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const membership = await getActiveMembership(userId, organizationId);
  return membership?.role === "owner" || membership?.role === "admin";
}

/**
 * Child-resource wrapper (same pattern as canManageVoidAccessForGrant
 * below): `invitation.revoke`'s input is an invitationId, not an
 * organizationId — resolving the parent Organization server-side prevents
 * a client from claiming management access to Org A while revoking an
 * invitation that actually belongs to Org B.
 */
export async function canManageOrganizationForInvitation(
  userId: string,
  invitationId: string,
): Promise<boolean> {
  const invitation = await findInvitationById(invitationId);
  if (!invitation) return false;
  return canManageOrganization(userId, invitation.organizationId);
}

/**
 * Owner-only — org deletion/transfer are the "destructive Owner-only
 * actions" an Admin does not get (docs/decisions.md, "Owner: full org
 * control including billing and org deletion/transfer; Admin: member/team/
 * settings management; not billing/destructive Owner-only actions").
 */
export async function canTransferOwnership(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const membership = await getActiveMembership(userId, organizationId);
  return membership?.role === "owner";
}

export async function canManageTeam(userId: string, teamId: string): Promise<boolean> {
  const team = await findTeamById(teamId);
  if (!team) return false;
  if (await canManageOrganization(userId, team.organizationId)) return true;
  const teamMembership = await getTeamMembership(userId, teamId);
  return teamMembership?.isTeamLead === true;
}

/**
 * Same rule as canManageTeam (architecture.md §3: "Team Lead (own Team) or
 * org Admin/Owner"). Kept as its own named capability — it gates a
 * conceptually different action (Void creation, Phase 3) — even though the
 * logic currently coincides with canManageTeam.
 */
export async function canCreateVoidForTeam(userId: string, teamId: string): Promise<boolean> {
  return canManageTeam(userId, teamId);
}

// --- Void-scoped capabilities (architecture.md §3, corrected per C1) --------
// Fully real as of Phase 3. Resolution order for getVoidRole (architecture.md
// §3): (1) a direct VoidAccessGrant on this user wins outright; (2) else the
// highest role among this user's Team-derived grants; (3) else no access —
// regardless of Organization role. A deleted Void is unconditionally
// inaccessible (architecture.md §6.2), checked before any grant lookup.

const voidRoleRank: Record<VoidAccessGrantRole, number> = { viewer: 1, editor: 2, manager: 3 };

export async function getVoidRole(
  userId: string,
  voidId: string,
): Promise<VoidAccessGrantRole | null> {
  const voidRow = await findVoidById(voidId);
  if (!voidRow || voidRow.deletedAt) return null;

  // Phase 4 addendum (docs/decisions.md): a User who no longer has an
  // active Membership in the Void's Organization has no access at all,
  // regardless of any VoidAccessGrant row — member removal (D17) only
  // explicitly ends Membership/TeamMembership, never touches
  // VoidAccessGrant rows, so without this check a removed member's old
  // *direct* grant (not Team-derived, so nothing about ending Team
  // membership would touch it) would silently keep working forever.
  const membership = await getActiveMembership(userId, voidRow.organizationId);
  if (!membership) return null;

  const [direct] = await db
    .select()
    .from(voidAccessGrants)
    .where(and(eq(voidAccessGrants.voidId, voidId), eq(voidAccessGrants.userId, userId)))
    .limit(1);
  if (direct) return direct.role;

  const teamGrants = await db
    .select({ role: voidAccessGrants.role })
    .from(voidAccessGrants)
    .innerJoin(teamMemberships, eq(teamMemberships.teamId, voidAccessGrants.teamId))
    .where(and(eq(voidAccessGrants.voidId, voidId), eq(teamMemberships.userId, userId)));
  if (teamGrants.length === 0) return null;

  return teamGrants.reduce<VoidAccessGrantRole>(
    (best, g) => (voidRoleRank[g.role] > voidRoleRank[best] ? g.role : best),
    teamGrants[0]!.role,
  );
}

export async function canAccessVoid(userId: string, voidId: string): Promise<boolean> {
  return (await getVoidRole(userId, voidId)) !== null;
}

export async function canEditVoid(userId: string, voidId: string): Promise<boolean> {
  const role = await getVoidRole(userId, voidId);
  return role === "editor" || role === "manager";
}

export async function canManageVoidAccess(userId: string, voidId: string): Promise<boolean> {
  return (await getVoidRole(userId, voidId)) === "manager";
}

/**
 * ID1 (docs/decisions.md): Void deletion permission is Void Manager **or**
 * Organization Admin/Owner — an explicitly recorded exception to C1's "no
 * automatic Void-access bypass," scoped narrowly to deletion (an org-
 * governance action over resources within the org), not general Void
 * access. Uses a raw Void lookup (not getVoidRole) so the Org-Admin path
 * still resolves even though the Void itself may already be soft-deleted.
 */
export async function canDeleteVoid(userId: string, voidId: string): Promise<boolean> {
  const voidRow = await findVoidById(voidId);
  if (!voidRow) return false;
  if (await canManageOrganization(userId, voidRow.organizationId)) return true;
  return canManageVoidAccess(userId, voidId);
}

// --- Capability wrappers for child resources ---------------------------------
// Group/VoidAccessGrant mutations take a groupId/grantId, not a voidId, in
// their input. Resolving the parent Void server-side (rather than trusting a
// client-supplied voidId alongside groupId/grantId) prevents a client from
// claiming edit access to Void A while acting on a Group/grant that actually
// belongs to Void B.

export async function canAccessVoidForGroup(userId: string, groupId: string): Promise<boolean> {
  const group = await findGroupById(groupId);
  if (!group) return false;
  return canAccessVoid(userId, group.voidId);
}

export async function canEditVoidForGroup(userId: string, groupId: string): Promise<boolean> {
  const group = await findGroupById(groupId);
  if (!group) return false;
  return canEditVoid(userId, group.voidId);
}

export async function canManageVoidAccessForGrant(
  userId: string,
  grantId: string,
): Promise<boolean> {
  const grant = await findVoidAccessGrantById(grantId);
  if (!grant) return false;
  return canManageVoidAccess(userId, grant.voidId);
}

// D15: "Tasks inherit permission entirely from their Void" — view follows
// canAccessVoid (Viewer+), create/edit/delete/assign follows canEditVoid
// (Editor+), resolved through the Task's actual voidId, never trusted from
// client input (same rationale as the Group wrappers above).

export async function canAccessVoidForTask(userId: string, taskId: string): Promise<boolean> {
  const task = await findTaskById(taskId);
  if (!task) return false;
  return canAccessVoid(userId, task.voidId);
}

export async function canEditVoidForTask(userId: string, taskId: string): Promise<boolean> {
  const task = await findTaskById(taskId);
  if (!task) return false;
  return canEditVoid(userId, task.voidId);
}

/**
 * ChecklistItem mutations take an itemId, not a taskId — resolve through
 * the item to its Task's Void, same pattern as the Group/Task wrappers.
 */
export async function canEditVoidForChecklistItem(
  userId: string,
  itemId: string,
): Promise<boolean> {
  const item = await findChecklistItemById(itemId);
  if (!item) return false;
  return canEditVoidForTask(userId, item.taskId);
}

/**
 * ID3: the comment author may edit their own comment — an authorship rule,
 * not conditioned on the author's *current* Void-level role (ID3 doesn't
 * say a since-downgraded Editor loses the ability to edit their own past
 * comments). Still requires the author to be able to access the Void at
 * all, so someone who has lost all access entirely cannot edit through this
 * path either. **Flagged as an assumption, not a literal decision** — same
 * status as Phase 3's default-Team-grant-role note.
 */
export async function canEditComment(userId: string, commentId: string): Promise<boolean> {
  const comment = await findCommentById(commentId);
  if (!comment || comment.authorId !== userId) return false;
  const task = await findTaskById(comment.taskId);
  if (!task) return false;
  return canAccessVoid(userId, task.voidId);
}

/**
 * ID3: the author may delete their own comment; a Void Manager may
 * additionally delete (not edit) any comment for moderation.
 */
export async function canDeleteComment(userId: string, commentId: string): Promise<boolean> {
  const comment = await findCommentById(commentId);
  if (!comment) return false;
  const task = await findTaskById(comment.taskId);
  if (!task) return false;

  if (comment.authorId === userId) return canAccessVoid(userId, task.voidId);
  return canManageVoidAccess(userId, task.voidId);
}
