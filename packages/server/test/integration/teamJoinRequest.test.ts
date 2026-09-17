import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Second feature pass — join-request workflow for a `private` Team: create/
 * accept/deny, notifications on both ends, duplicate-pending rejected, and
 * only a Team Lead/Org Admin may list/decide (authorization-first, matching
 * this codebase's established test priority).
 */
describe("Team join requests (second feature pass)", () => {
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

  async function setupPrivateTeam(ownerEmail: string, teamName: string) {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin(ownerEmail);
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const team = await ownerClient.team.create.mutate({ organizationId: org.id, name: teamName });
    await ownerClient.team.updateVisibility.mutate({ teamId: team.id, visibility: "private" });
    return { ownerClient, ownerId, org, team };
  }

  it("requestJoin rejects a non-Org-member, then succeeds once they're an Org member, and notifies the Team Lead", async () => {
    const { ownerClient, org, team } = await setupPrivateTeam("owner@example.com", "Design");

    const { client: requesterClient, userId: requesterId } =
      await signupAndLogin("req@example.com");
    await expect(requesterClient.team.requestJoin.mutate({ teamId: team.id })).rejects.toThrow(
      TRPCClientError,
    );

    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: requesterId, role: "member" });
    await expect(requesterClient.team.requestJoin.mutate({ teamId: team.id })).resolves.toEqual({
      ok: true,
    });

    // No Team Lead set — falls back to notifying Org Owner/Admins (the Owner here).
    const list = await ownerClient.notification.list.query();
    expect(list.some((n) => n.type === "team_join_requested")).toBe(true);
  });

  it("a duplicate pending request is rejected", async () => {
    const { org, team } = await setupPrivateTeam("owner2@example.com", "Design");
    const { client: requesterClient, userId: requesterId } =
      await signupAndLogin("req2@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: requesterId, role: "member" });

    await requesterClient.team.requestJoin.mutate({ teamId: team.id });
    await expect(requesterClient.team.requestJoin.mutate({ teamId: team.id })).rejects.toThrow(
      TRPCClientError,
    );
  });

  it("only a Team Lead/Org Admin can list or decide join requests; deciding adds the member and notifies them", async () => {
    const { ownerClient, org, team } = await setupPrivateTeam("owner3@example.com", "Design");
    const { client: requesterClient, userId: requesterId } =
      await signupAndLogin("req3@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: requesterId, role: "member" });
    await requesterClient.team.requestJoin.mutate({ teamId: team.id });

    const { client: strangerClient } = await signupAndLogin("stranger3@example.com");
    await expect(strangerClient.team.listJoinRequests.query({ teamId: team.id })).rejects.toThrow(
      TRPCClientError,
    );

    const pending = await ownerClient.team.listJoinRequests.query({ teamId: team.id });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.userId).toBe(requesterId);

    await expect(
      strangerClient.team.decideJoinRequest.mutate({
        requestId: pending[0]!.id,
        decision: "accepted",
      }),
    ).rejects.toThrow(TRPCClientError);

    await ownerClient.team.decideJoinRequest.mutate({
      requestId: pending[0]!.id,
      decision: "accepted",
    });

    const members = await ownerClient.team.listMembers.query({ teamId: team.id });
    expect(members.some((m) => m.userId === requesterId)).toBe(true);

    const requesterNotifications = await requesterClient.notification.list.query();
    expect(requesterNotifications.some((n) => n.type === "team_join_approved")).toBe(true);
  });

  it("denying a request notifies the requester and does not add them as a member", async () => {
    const { ownerClient, org, team } = await setupPrivateTeam("owner4@example.com", "Design");
    const { client: requesterClient, userId: requesterId } =
      await signupAndLogin("req4@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: requesterId, role: "member" });
    await requesterClient.team.requestJoin.mutate({ teamId: team.id });

    const [pending] = await ownerClient.team.listJoinRequests.query({ teamId: team.id });
    await ownerClient.team.decideJoinRequest.mutate({ requestId: pending!.id, decision: "denied" });

    const members = await ownerClient.team.listMembers.query({ teamId: team.id });
    expect(members.some((m) => m.userId === requesterId)).toBe(false);

    const requesterNotifications = await requesterClient.notification.list.query();
    expect(requesterNotifications.some((n) => n.type === "team_join_denied")).toBe(true);

    // A denied request can be re-requested (only *pending* requests are unique).
    await expect(requesterClient.team.requestJoin.mutate({ teamId: team.id })).resolves.toEqual({
      ok: true,
    });
  });

  it("requestJoin against a public Team is rejected — public only changes visibility, joining still requires a Team Lead/Admin", async () => {
    const { client: ownerClient } = await signupAndLogin("owner5@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const team = await ownerClient.team.create.mutate({ organizationId: org.id, name: "Design" });

    const { client: requesterClient, userId: requesterId } =
      await signupAndLogin("req5@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: requesterId, role: "member" });

    await expect(requesterClient.team.requestJoin.mutate({ teamId: team.id })).rejects.toThrow(
      TRPCClientError,
    );
  });
});
