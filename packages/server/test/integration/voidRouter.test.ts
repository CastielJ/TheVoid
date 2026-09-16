import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Router-level coverage for voidRouter/groupRouter's requireCapability
 * wiring, exercised over the real tRPC wire protocol — including the
 * cross-void Group authorization case that's easy to get wrong (a client
 * cannot borrow edit access to one Void to act on another Void's Group).
 */
describe("voidRouter & groupRouter (requireCapability wiring)", () => {
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
    await client.auth.signup.mutate({ email, password: "correct-horse-battery" });
    await client.auth.login.mutate({ email, password: "correct-horse-battery" });
    const me = await client.auth.me.query();
    return { client, userId: me.id };
  }

  it("void.create requires active Organization membership; a non-member is FORBIDDEN", async () => {
    const { client: ownerClient } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    const { client: strangerClient } = await signupAndLogin("stranger@example.com");

    await expect(
      strangerClient.void.create.mutate({ organizationId: org.id, name: "Intruder Void" }),
    ).rejects.toThrow(TRPCClientError);

    await expect(
      ownerClient.void.create.mutate({ organizationId: org.id, name: "Owner's Void" }),
    ).resolves.toMatchObject({ name: "Owner's Void" });
  });

  it("void.create with a teamId additionally requires canCreateVoidForTeam", async () => {
    const { client: ownerClient } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const team = await ownerClient.team.create.mutate({
      organizationId: org.id,
      name: "Engineering",
    });

    const { client: memberClient, userId: memberId } = await signupAndLogin("member2@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    // A plain member (not the Team Lead, not an org Admin/Owner) cannot
    // create a Void for this Team.
    await expect(
      memberClient.void.create.mutate({
        organizationId: org.id,
        name: "Team Void",
        teamId: team.id,
      }),
    ).rejects.toThrow(TRPCClientError);

    // The Owner can (canManageOrganization satisfies canCreateVoidForTeam).
    await expect(
      ownerClient.void.create.mutate({
        organizationId: org.id,
        name: "Team Void",
        teamId: team.id,
      }),
    ).resolves.toMatchObject({ name: "Team Void" });
  });

  it("a Viewer-role grant permits void.get but not group.create (Editor+ required)", async () => {
    const { client: ownerClient } = await signupAndLogin("owner3@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { client: viewerClient, userId: viewerId } = await signupAndLogin("viewer3@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: viewerId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: viewerId,
      role: "viewer",
    });

    await expect(viewerClient.void.get.query({ voidId: voidRow.id })).resolves.toMatchObject({
      id: voidRow.id,
    });
    await expect(
      viewerClient.group.create.mutate({
        voidId: voidRow.id,
        name: "G",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("cross-Void Group edit is FORBIDDEN even when the caller has Editor access to a different Void", async () => {
    const { client: ownerClient } = await signupAndLogin("owner4@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidA = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void A" });
    const voidB = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void B" });
    const groupInB = await ownerClient.group.create.mutate({
      voidId: voidB.id,
      name: "Group in B",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const { client: editorClient, userId: editorId } = await signupAndLogin("editor4@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    // Editor access to Void A only — not Void B.
    await ownerClient.void.grantAccess.mutate({
      voidId: voidA.id,
      userId: editorId,
      role: "editor",
    });

    await expect(
      editorClient.group.update.mutate({ groupId: groupInB.id, name: "Hijacked" }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("void.delete: an Org Owner with no grant may still delete (ID1); a plain member with no grant may not", async () => {
    const { client: ownerClient } = await signupAndLogin("owner5@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    const { client: memberClient, userId: memberId } = await signupAndLogin("member5@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });
    const memberVoid = await memberClient.void.create.mutate({
      organizationId: org.id,
      name: "Private",
    });

    await expect(memberClient.void.get.query({ voidId: memberVoid.id })).resolves.toBeDefined();
    // A different plain member (no grant, no org management role) cannot delete it.
    const { client: bystanderClient, userId: bystanderId } =
      await signupAndLogin("bystander5@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: bystanderId, role: "member" });
    await expect(bystanderClient.void.delete.mutate({ voidId: memberVoid.id })).rejects.toThrow(
      TRPCClientError,
    );

    // The Owner, despite no grant, can (ID1).
    await expect(ownerClient.void.delete.mutate({ voidId: memberVoid.id })).resolves.toEqual({
      ok: true,
    });
  });

  it("revokeAccess resolves authorization through the grant's own Void, and removes the grant", async () => {
    const { client: ownerClient } = await signupAndLogin("owner6@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { userId: personId } = await signupAndLogin("person6@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: personId, role: "member" });
    const grant = await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: personId,
      role: "viewer",
    });

    await expect(ownerClient.void.revokeAccess.mutate({ grantId: grant.id })).resolves.toEqual({
      ok: true,
    });

    const grants = await ownerClient.void.listAccessGrants.query({ voidId: voidRow.id });
    expect(grants.find((g) => g.id === grant.id)).toBeUndefined();
  });

  it("D31: camera state is personal and per-Void — saved by one user is invisible to another", async () => {
    const { client: ownerClient } = await signupAndLogin("owner7@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { client: editorClient, userId: editorId } = await signupAndLogin("editor7@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: editorId,
      role: "editor",
    });

    await expect(ownerClient.void.getCamera.query({ voidId: voidRow.id })).resolves.toBeNull();

    await ownerClient.void.saveCamera.mutate({ voidId: voidRow.id, x: 100, y: 200, zoom: 1.5 });
    await editorClient.void.saveCamera.mutate({ voidId: voidRow.id, x: -50, y: 0, zoom: 0.8 });

    await expect(ownerClient.void.getCamera.query({ voidId: voidRow.id })).resolves.toMatchObject({
      x: 100,
      y: 200,
      zoom: 1.5,
    });
    await expect(editorClient.void.getCamera.query({ voidId: voidRow.id })).resolves.toMatchObject({
      x: -50,
      y: 0,
      zoom: 0.8,
    });

    // A later save overwrites, it does not create a second row/history entry.
    await ownerClient.void.saveCamera.mutate({ voidId: voidRow.id, x: 999, y: 999, zoom: 2 });
    await expect(ownerClient.void.getCamera.query({ voidId: voidRow.id })).resolves.toMatchObject({
      x: 999,
      y: 999,
      zoom: 2,
    });
  });
});
