import { eq, and, gt } from "drizzle-orm";
import { db } from "../../db/client.js";
import { invitations, memberships, type Invitation, type InvitationRole } from "../../db/schema.js";
import { generateRandomToken, hashToken } from "../auth/crypto.js";
import { INVITATION_EXPIRY_MS } from "../../config/auth.js";
import { getActiveMembership } from "../organization/memberships.js";
import { findUserByEmail } from "../auth/users.js";
import { writeAuditLog } from "../audit/auditLog.js";
import { createNotification } from "../notification/notifications.js";

export type CreateInvitationResult =
  { ok: true; invitation: Invitation; rawToken: string } | { ok: false; reason: "already_member" };

/**
 * D16: unique, single-use, revocable, ~7-day expiry. Mirrors
 * issueAuthToken's "revoke any prior outstanding one first" pattern
 * (domains/auth/tokens.ts) rather than a partial-unique-index-plus-conflict
 * approach — simpler, and consistent with an existing precedent in this
 * codebase for "at most one live token per target."
 */
export async function createInvitation(
  organizationId: string,
  rawEmail: string,
  role: InvitationRole,
  invitedByUserId: string,
): Promise<CreateInvitationResult> {
  const email = rawEmail.toLowerCase();

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    const membership = await getActiveMembership(existingUser.id, organizationId);
    if (membership) return { ok: false, reason: "already_member" as const };
  }

  return db.transaction(async (tx) => {
    await tx
      .update(invitations)
      .set({ status: "revoked" })
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          eq(invitations.email, email),
          eq(invitations.status, "pending"),
        ),
      );

    const rawToken = generateRandomToken();
    const [invitation] = await tx
      .insert(invitations)
      .values({
        organizationId,
        email,
        role,
        tokenHash: hashToken(rawToken),
        invitedBy: invitedByUserId,
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_MS),
      })
      .returning();

    await writeAuditLog(tx, {
      organizationId,
      actorId: invitedByUserId,
      eventType: "invitation.created",
      targetType: "invitation",
      targetId: invitation!.id,
      metadata: { email, role },
    });

    // D39: only fires if the invitee already has an account — otherwise the
    // email itself (sent by the caller, see routers/invitation.ts) is the
    // only signal they get until they sign up.
    if (existingUser) {
      await createNotification(tx, {
        userId: existingUser.id,
        type: "invited",
        payload: { organizationId, invitationId: invitation!.id, role },
      });
    }

    return { ok: true as const, invitation: invitation!, rawToken };
  });
}

/** Pending AND not yet expired — an expired-but-still-`pending`-stored row (no scheduled job flips it) is not "pending" for display purposes. */
export async function listPendingInvitations(organizationId: string): Promise<Invitation[]> {
  return db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, new Date()),
      ),
    );
}

export async function findInvitationById(invitationId: string): Promise<Invitation | null> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1);
  return row ?? null;
}

export type RevokeInvitationResult = { ok: true } | { ok: false; reason: "not_found" };

export async function revokeInvitation(
  invitationId: string,
  actorId: string,
): Promise<RevokeInvitationResult> {
  const invitation = await findInvitationById(invitationId);
  if (!invitation || invitation.status !== "pending")
    return { ok: false, reason: "not_found" as const };

  return db.transaction(async (tx) => {
    await tx.update(invitations).set({ status: "revoked" }).where(eq(invitations.id, invitationId));
    await writeAuditLog(tx, {
      organizationId: invitation.organizationId,
      actorId,
      eventType: "invitation.revoked",
      targetType: "invitation",
      targetId: invitationId,
      metadata: { email: invitation.email },
    });
    return { ok: true as const };
  });
}

export type AcceptInvitationResult =
  | { ok: true; organizationId: string }
  | { ok: false; reason: "not_found" | "expired" | "wrong_account" };

/**
 * The accepting User's own session email must match the invitation's target
 * email — otherwise a different logged-in User could consume someone
 * else's invite link (the token alone proves "possession of the email
 * link," not "is the invited person," since links can be forwarded).
 */
export async function acceptInvitation(
  rawToken: string,
  acceptingUserId: string,
  acceptingUserEmail: string,
): Promise<AcceptInvitationResult> {
  const tokenHash = hashToken(rawToken);
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  if (!invitation || invitation.status !== "pending") {
    return { ok: false, reason: "not_found" as const };
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    await db
      .update(invitations)
      .set({ status: "expired" })
      .where(eq(invitations.id, invitation.id));
    return { ok: false, reason: "expired" as const };
  }
  if (invitation.email !== acceptingUserEmail.toLowerCase()) {
    return { ok: false, reason: "wrong_account" as const };
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(memberships)
      .values({
        organizationId: invitation.organizationId,
        userId: acceptingUserId,
        role: invitation.role,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId],
        set: { role: invitation.role, status: "active", removedAt: null },
      });

    await tx
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));

    await writeAuditLog(tx, {
      organizationId: invitation.organizationId,
      actorId: acceptingUserId,
      eventType: "invitation.accepted",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { email: invitation.email, role: invitation.role },
    });
  });

  return { ok: true as const, organizationId: invitation.organizationId };
}
