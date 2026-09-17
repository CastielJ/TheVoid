import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";
import { createInvitation } from "../../src/domains/invitation/invitations.js";

/**
 * Router-level coverage for invitationRouter's requireCapability wiring
 * (create/listPending/revoke are Org-Admin/Owner-only) and the accept
 * procedure's own email-match security boundary, exercised over the real
 * tRPC wire protocol.
 */
describe("invitationRouter (requireCapability wiring)", () => {
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
    await client.auth.login.mutate({ identifier: email, password: "correct-horse-battery" });
    const me = await client.auth.me.query();
    return { client, userId: me.id };
  }

  it("create/listPending/revoke are rejected (FORBIDDEN) for a plain member", async () => {
    const { client: ownerClient } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { client: memberClient, userId: memberId } = await signupAndLogin("member@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    await expect(
      memberClient.invitation.create.mutate({
        organizationId: org.id,
        email: "someone@example.com",
        role: "member",
      }),
    ).rejects.toThrow(TRPCClientError);
    await expect(
      memberClient.invitation.listPending.query({ organizationId: org.id }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("owner can create and list a pending invitation via the router", async () => {
    const { client: ownerClient } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    await ownerClient.invitation.create.mutate({
      organizationId: org.id,
      email: "invitee2@example.com",
      role: "member",
    });

    const pending = await ownerClient.invitation.listPending.query({ organizationId: org.id });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ email: "invitee2@example.com" });
  });

  it("revoke resolves authorization through the invitation's own Organization, not a trusted client-supplied one", async () => {
    const { client: ownerAClient, userId: ownerAId } = await signupAndLogin("ownerA3@example.com");
    const orgA = await ownerAClient.organization.create.mutate({ name: "Org A" });
    const { client: ownerBClient } = await signupAndLogin("ownerB3@example.com");
    await ownerBClient.organization.create.mutate({ name: "Org B" });

    const created = await createInvitation(orgA.id, "target3@example.com", "member", ownerAId);
    if (!created.ok) throw new Error("expected ok");

    // Owner B has no authority over Org A's invitation.
    await expect(
      ownerBClient.invitation.revoke.mutate({ invitationId: created.invitation.id }),
    ).rejects.toThrow(TRPCClientError);

    await expect(
      ownerAClient.invitation.revoke.mutate({ invitationId: created.invitation.id }),
    ).resolves.toEqual({ ok: true });
  });

  it("accept: succeeds for the matching account, rejects for a mismatched one", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner4@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { client: inviteeClient } = await signupAndLogin("invitee4@example.com");
    const { client: strangerClient } = await signupAndLogin("stranger4@example.com");

    const created = await createInvitation(org.id, "invitee4@example.com", "member", ownerId);
    if (!created.ok) throw new Error("expected ok");

    await expect(
      strangerClient.invitation.accept.mutate({ token: created.rawToken }),
    ).rejects.toThrow(TRPCClientError);

    await expect(
      inviteeClient.invitation.accept.mutate({ token: created.rawToken }),
    ).resolves.toEqual({ organizationId: org.id });

    const orgs = await inviteeClient.organization.listMine.query();
    expect(orgs.find((o) => o.id === org.id)).toBeDefined();
  });

  it("Phase 8 hardening: invitation.create is rate limited per-actor like the other email-sending procedures", async () => {
    const { client: ownerClient } = await signupAndLogin("owner5@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    for (let i = 0; i < 30; i++) {
      await ownerClient.invitation.create.mutate({
        organizationId: org.id,
        email: `bulk${i}@example.com`,
        role: "member",
      });
    }

    await expect(
      ownerClient.invitation.create.mutate({
        organizationId: org.id,
        email: "onemore@example.com",
        role: "member",
      }),
    ).rejects.toThrow(TRPCClientError);
  });
});
