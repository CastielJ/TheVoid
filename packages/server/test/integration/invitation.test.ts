import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships, notifications, invitations } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";
import {
  createInvitation,
  listPendingInvitations,
  revokeInvitation,
  acceptInvitation,
} from "../../src/domains/invitation/invitations.js";

/**
 * Domain-level coverage for D16's invitation lifecycle: create/revoke/
 * accept/expiry, plus the "invited" notification (D39) firing only when the
 * invitee already has an account. Router-level requireCapability wiring is
 * covered separately in invitationRouter.test.ts.
 */
describe("Invitation lifecycle (D16)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function signupAndLogin(email: string) {
    const { client } = createTestClient(app);
    const username = email
      .split("@")[0]!
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .padEnd(3, "0");
    await client.auth.signup.mutate({
      email,
      username,
      visibleName: email.split("@")[0]!,
      password: "correct-horse-battery",
    });
    await client.auth.login.mutate({ email, password: "correct-horse-battery" });
    const me = await client.auth.me.query();
    return { client, userId: me.id };
  }

  it("creates a pending invitation, and re-inviting the same email supersedes the prior one", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    const first = await createInvitation(org.id, "invitee@example.com", "member", ownerId);
    expect(first.ok).toBe(true);

    const second = await createInvitation(org.id, "invitee@example.com", "admin", ownerId);
    expect(second.ok).toBe(true);

    const pending = await listPendingInvitations(org.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ email: "invitee@example.com", role: "admin" });
  });

  it("rejects inviting someone who is already an active member", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { userId: memberId } = await signupAndLogin("member2@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    const result = await createInvitation(org.id, "member2@example.com", "member", ownerId);
    expect(result).toEqual({ ok: false, reason: "already_member" });
  });

  it("fires an 'invited' notification only when the invitee already has an account", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner3@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    // No account yet for this email — no notification possible.
    await createInvitation(org.id, "brandnew@example.com", "member", ownerId);
    const noAccountNotifications = await db.select().from(notifications);
    expect(noAccountNotifications).toHaveLength(0);

    // Existing account — notification fires.
    const { userId: existingUserId } = await signupAndLogin("existing3@example.com");
    await createInvitation(org.id, "existing3@example.com", "member", ownerId);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, existingUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "invited" });
  });

  it("accept: succeeds when the accepting account's email matches, creates an active Membership", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner4@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { userId: inviteeId } = await signupAndLogin("invitee4@example.com");

    const created = await createInvitation(org.id, "invitee4@example.com", "member", ownerId);
    if (!created.ok) throw new Error("expected ok");

    const result = await acceptInvitation(created.rawToken, inviteeId, "invitee4@example.com");
    expect(result).toEqual({ ok: true, organizationId: org.id });

    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, inviteeId));
    expect(membership).toMatchObject({ organizationId: org.id, role: "member", status: "active" });
  });

  it("accept: rejects when the accepting account's email doesn't match the invitation", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner5@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { userId: strangerId } = await signupAndLogin("stranger5@example.com");

    const created = await createInvitation(org.id, "invitee5@example.com", "member", ownerId);
    if (!created.ok) throw new Error("expected ok");

    const result = await acceptInvitation(created.rawToken, strangerId, "stranger5@example.com");
    expect(result).toEqual({ ok: false, reason: "wrong_account" });

    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, strangerId));
    expect(membership).toBeUndefined();
  });

  it("accept: rejects an already-consumed or revoked token", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner6@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { userId: inviteeId } = await signupAndLogin("invitee6@example.com");

    const created = await createInvitation(org.id, "invitee6@example.com", "member", ownerId);
    if (!created.ok) throw new Error("expected ok");

    await acceptInvitation(created.rawToken, inviteeId, "invitee6@example.com");
    const secondAttempt = await acceptInvitation(
      created.rawToken,
      inviteeId,
      "invitee6@example.com",
    );
    expect(secondAttempt).toEqual({ ok: false, reason: "not_found" });
  });

  it("revoke: a pending invitation is revoked and excluded from listPendingInvitations; a revoked token can't be accepted", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner7@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { userId: inviteeId } = await signupAndLogin("invitee7@example.com");

    const created = await createInvitation(org.id, "invitee7@example.com", "member", ownerId);
    if (!created.ok) throw new Error("expected ok");

    const revoked = await revokeInvitation(created.invitation.id, ownerId);
    expect(revoked).toEqual({ ok: true });

    expect(await listPendingInvitations(org.id)).toHaveLength(0);

    const acceptResult = await acceptInvitation(
      created.rawToken,
      inviteeId,
      "invitee7@example.com",
    );
    expect(acceptResult).toEqual({ ok: false, reason: "not_found" });
  });

  it("accept: an expired invitation is rejected and lazily transitions to 'expired'", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner8@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { userId: inviteeId } = await signupAndLogin("invitee8@example.com");

    const created = await createInvitation(org.id, "invitee8@example.com", "member", ownerId);
    if (!created.ok) throw new Error("expected ok");
    // Simulate expiry directly (no scheduled job in MVP flips this on its own).
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, created.invitation.id));

    const result = await acceptInvitation(created.rawToken, inviteeId, "invitee8@example.com");
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(await listPendingInvitations(org.id)).toHaveLength(0);
  });
});
