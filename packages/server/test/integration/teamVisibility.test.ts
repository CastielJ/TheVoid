import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Second feature pass — three-tier Team visibility (public/private/
 * invisible). The core invariant under test: an invisible Team must be
 * absent from team.list for a non-member, and present for a member — and
 * since team.list is the single choke point every listing surface reads
 * through (domains/team/teams.ts's listVisibleTeamsForOrganization), this is
 * also what makes invisible-Team enforcement apply "everywhere,
 * consistently" per the confirmed requirement, without needing a second
 * test file per surface.
 */
describe("Team visibility (second feature pass)", () => {
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

  it("a public Team (the default) is visible to every active Organization member", async () => {
    const { client: ownerClient } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const team = await ownerClient.team.create.mutate({
      organizationId: org.id,
      name: "Engineering",
    });
    expect(team.visibility).toBe("public");

    const { client: memberClient, userId: memberId } = await signupAndLogin("member@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    const list = await memberClient.team.list.query({ organizationId: org.id });
    expect(list.map((t) => t.name)).toEqual(["Engineering"]);
  });

  it("an invisible Team is absent from team.list for a non-member, present for a member", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const team = await ownerClient.team.create.mutate({
      organizationId: org.id,
      name: "Secret Ops",
    });
    await ownerClient.team.updateVisibility.mutate({ teamId: team.id, visibility: "invisible" });

    const { client: outsiderClient, userId: outsiderId } =
      await signupAndLogin("outsider2@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: outsiderId, role: "member" });
    expect(await outsiderClient.team.list.query({ organizationId: org.id })).toEqual([]);

    // Creating a Team (an Org-management action, gated by canManageOrganization)
    // does not itself add the creator as a teamMemberships row — visibility
    // is strictly "only actual members see it," with no implicit exception
    // for whoever created it. The Owner needs to actually join to see it here.
    expect(await ownerClient.team.list.query({ organizationId: org.id })).toEqual([]);
    await ownerClient.team.addMember.mutate({ teamId: team.id, userId: ownerId });
    const ownerList = await ownerClient.team.list.query({ organizationId: org.id });
    expect(ownerList.map((t) => t.name)).toEqual(["Secret Ops"]);

    // Add the outsider as an actual member — now it becomes visible to them too.
    await ownerClient.team.addMember.mutate({ teamId: team.id, userId: outsiderId });
    const outsiderListAfter = await outsiderClient.team.list.query({ organizationId: org.id });
    expect(outsiderListAfter.map((t) => t.name)).toEqual(["Secret Ops"]);
  });

  it("a private Team is visible to all Org members (just not freely joinable)", async () => {
    const { client: ownerClient } = await signupAndLogin("owner3@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const team = await ownerClient.team.create.mutate({ organizationId: org.id, name: "Design" });
    await ownerClient.team.updateVisibility.mutate({ teamId: team.id, visibility: "private" });

    const { client: memberClient, userId: memberId } = await signupAndLogin("member3@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    const list = await memberClient.team.list.query({ organizationId: org.id });
    expect(list.map((t) => t.name)).toEqual(["Design"]);
  });

  it("updateVisibility: a Team Lead can set their own Team's visibility; a plain member cannot", async () => {
    const { client: ownerClient } = await signupAndLogin("owner4@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const team = await ownerClient.team.create.mutate({ organizationId: org.id, name: "Eng" });

    const { client: leadClient, userId: leadId } = await signupAndLogin("lead4@example.com");
    await db.insert(memberships).values({ organizationId: org.id, userId: leadId, role: "member" });
    await ownerClient.team.addMember.mutate({ teamId: team.id, userId: leadId });
    await ownerClient.team.setTeamLead.mutate({
      teamId: team.id,
      userId: leadId,
      isTeamLead: true,
    });

    await expect(
      leadClient.team.updateVisibility.mutate({ teamId: team.id, visibility: "private" }),
    ).resolves.toEqual({ ok: true });

    const { client: strangerClient } = await signupAndLogin("stranger4@example.com");
    await expect(
      strangerClient.team.updateVisibility.mutate({ teamId: team.id, visibility: "public" }),
    ).rejects.toThrow(TRPCClientError);
  });
});
