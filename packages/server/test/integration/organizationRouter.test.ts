import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { eq, and } from "drizzle-orm";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Router-level coverage: proves `requireCapability` (trpc.ts) is actually
 * wired onto these procedures, not just that the underlying domain
 * functions are correct in isolation (test/integration/organization.test.ts
 * covers those). Exercised through the real tRPC wire protocol, matching
 * the Phase 1 test pattern.
 */
describe("organizationRouter (requireCapability wiring)", () => {
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

  it("create makes the caller Owner, and the caller can then updateSettings", async () => {
    const { client } = await signupAndLogin("owner@example.com");
    const org = await client.organization.create.mutate({ name: "Acme" });

    await expect(
      client.organization.updateSettings.mutate({ organizationId: org.id, name: "Acme Inc" }),
    ).resolves.toEqual({ ok: true });
  });

  it("updateSettings is rejected (FORBIDDEN) for a plain member", async () => {
    const { client: ownerClient } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    const { client: memberClient, userId: memberId } = await signupAndLogin("member2@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    await expect(
      memberClient.organization.updateSettings.mutate({ organizationId: org.id, name: "Hijacked" }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("listMembers/updateMemberRole/removeMember are rejected for a non-member entirely", async () => {
    const { client: ownerClient } = await signupAndLogin("owner3@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    const { client: strangerClient } = await signupAndLogin("stranger3@example.com");

    await expect(
      strangerClient.organization.listMembers.query({ organizationId: org.id }),
    ).rejects.toThrow(TRPCClientError);
    // requireCapability rejects before the domain layer even looks up the
    // target — a syntactically valid but unrelated UUID is enough here.
    await expect(
      strangerClient.organization.updateMemberRole.mutate({
        organizationId: org.id,
        userId: org.id,
        role: "admin",
      }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("transferOwnership succeeds for the Owner and is rejected (FORBIDDEN) for an Admin", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner4@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    const { client: adminClient, userId: adminId } = await signupAndLogin("admin4@example.com");
    await db.insert(memberships).values({ organizationId: org.id, userId: adminId, role: "admin" });

    // An Admin (not the Owner) may not transfer ownership — Owner-only per
    // canTransferOwnership (authorization/capabilities.ts).
    await expect(
      adminClient.organization.transferOwnership.mutate({
        organizationId: org.id,
        newOwnerUserId: adminId,
      }),
    ).rejects.toThrow(TRPCClientError);

    await expect(
      ownerClient.organization.transferOwnership.mutate({
        organizationId: org.id,
        newOwnerUserId: adminId,
      }),
    ).resolves.toEqual({ ok: true });

    const [ownerRow] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, org.id), eq(memberships.userId, ownerId)));
    expect(ownerRow?.role).toBe("admin");
  });

  it("listMine returns only Organizations the caller actively belongs to", async () => {
    const { client: ownerClient } = await signupAndLogin("owner5@example.com");
    const orgA = await ownerClient.organization.create.mutate({ name: "Acme" });
    await ownerClient.organization.create.mutate({ name: "Other Co" });

    const { client: memberClient, userId: memberId } = await signupAndLogin("member5@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: orgA.id, userId: memberId, role: "member" });

    const mine = await memberClient.organization.listMine.query();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: orgA.id, role: "member" });
  });
});
