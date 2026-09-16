import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Router-level coverage for teamRouter's requireCapability wiring —
 * specifically the Team Lead scoping invariant called out as a required
 * test in implementation-plan.md §2 Phase 2 ("a Team Lead cannot manage a
 * Team they don't lead").
 */
describe("teamRouter (requireCapability wiring, Team Lead scoping)", () => {
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

  it("only an org Owner/Admin can create a Team", async () => {
    const { client: ownerClient } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    const { client: memberClient, userId: memberId } = await signupAndLogin("member@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    await expect(
      memberClient.team.create.mutate({ organizationId: org.id, name: "Engineering" }),
    ).rejects.toThrow(TRPCClientError);

    await expect(
      ownerClient.team.create.mutate({ organizationId: org.id, name: "Engineering" }),
    ).resolves.toMatchObject({ organizationId: org.id, name: "Engineering" });
  });

  it("a Team Lead can manage their own Team but is FORBIDDEN from managing a different Team", async () => {
    const { client: ownerClient } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    const { client: leadClient, userId: leadId } = await signupAndLogin("lead2@example.com");
    await db.insert(memberships).values({ organizationId: org.id, userId: leadId, role: "member" });

    const teamA = await ownerClient.team.create.mutate({
      organizationId: org.id,
      name: "Engineering",
    });
    const teamB = await ownerClient.team.create.mutate({ organizationId: org.id, name: "Design" });

    await ownerClient.team.addMember.mutate({ teamId: teamA.id, userId: leadId });
    await ownerClient.team.setTeamLead.mutate({
      teamId: teamA.id,
      userId: leadId,
      isTeamLead: true,
    });

    // Own Team: allowed.
    await expect(
      leadClient.team.update.mutate({ teamId: teamA.id, name: "Engineering Renamed" }),
    ).resolves.toEqual({ ok: true });

    // A different Team in the same Org: forbidden — no cross-Team authority.
    await expect(
      leadClient.team.update.mutate({ teamId: teamB.id, name: "Hijacked" }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("addMember surfaces the C3 invariant (user must belong to the Team's Organization) as BAD_REQUEST", async () => {
    const { client: ownerClient } = await signupAndLogin("owner3@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const team = await ownerClient.team.create.mutate({
      organizationId: org.id,
      name: "Engineering",
    });

    const { userId: outsiderId } = await signupAndLogin("outsider3@example.com");

    await expect(
      ownerClient.team.addMember.mutate({ teamId: team.id, userId: outsiderId }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("list is visible to any active Organization member, and rejected for a non-member", async () => {
    const { client: ownerClient } = await signupAndLogin("owner4@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    await ownerClient.team.create.mutate({ organizationId: org.id, name: "Engineering" });

    const { client: memberClient, userId: memberId } = await signupAndLogin("member4@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    await expect(memberClient.team.list.query({ organizationId: org.id })).resolves.toMatchObject([
      { name: "Engineering" },
    ]);

    const { client: strangerClient } = await signupAndLogin("stranger4@example.com");
    await expect(strangerClient.team.list.query({ organizationId: org.id })).rejects.toThrow(
      TRPCClientError,
    );
  });

  it("Phase 8 tenant isolation: team.list for one Organization never returns another Organization's Teams", async () => {
    const { client: ownerAClient } = await signupAndLogin("ownerA5@example.com");
    const orgA = await ownerAClient.organization.create.mutate({ name: "Org A" });
    await ownerAClient.team.create.mutate({ organizationId: orgA.id, name: "Team A" });

    const { client: ownerBClient } = await signupAndLogin("ownerB5@example.com");
    const orgB = await ownerBClient.organization.create.mutate({ name: "Org B" });
    await ownerBClient.team.create.mutate({ organizationId: orgB.id, name: "Team B" });

    const teamsInA = await ownerAClient.team.list.query({ organizationId: orgA.id });
    expect(teamsInA.map((t) => t.name)).toEqual(["Team A"]);

    const teamsInB = await ownerBClient.team.list.query({ organizationId: orgB.id });
    expect(teamsInB.map((t) => t.name)).toEqual(["Team B"]);
  });
});
