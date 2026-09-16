import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { pool, db } from "../../src/db/client.js";
import { memberships, teamMemberships } from "../../src/db/schema.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createTeam, findTeamById, deleteTeam } from "../../src/domains/team/teams.js";
import {
  addTeamMember,
  removeTeamMember,
  setTeamLead,
  getTeamMembership,
} from "../../src/domains/team/teamMemberships.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

describe("Team & TeamMembership domain (implementation-plan.md Phase 2)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("addTeamMember rejects a user with no active Membership in the Team's Organization (C3)", async () => {
    const owner = await createUser("owner@example.com");
    const outsider = await createUser("outsider@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const team = await createTeam(org.id, "Engineering", owner.id);

    const result = await addTeamMember(team.id, outsider.id, owner.id);
    expect(result).toEqual({ ok: false, reason: "user_not_org_member" });

    const row = await getTeamMembership(outsider.id, team.id);
    expect(row).toBeNull();
  });

  it("addTeamMember succeeds for an active org member and rejects a duplicate add", async () => {
    const owner = await createUser("owner2@example.com");
    const member = await createUser("member2@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });
    const team = await createTeam(org.id, "Engineering", owner.id);

    const first = await addTeamMember(team.id, member.id, owner.id);
    expect(first).toEqual({ ok: true });

    const second = await addTeamMember(team.id, member.id, owner.id);
    expect(second).toEqual({ ok: false, reason: "already_member" });
  });

  it("setTeamLead flips is_team_lead; multiple Team Leads are allowed (ID6)", async () => {
    const owner = await createUser("owner3@example.com");
    const memberA = await createUser("memberA3@example.com");
    const memberB = await createUser("memberB3@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db.insert(memberships).values([
      { organizationId: org.id, userId: memberA.id, role: "member" },
      { organizationId: org.id, userId: memberB.id, role: "member" },
    ]);
    const team = await createTeam(org.id, "Engineering", owner.id);
    await addTeamMember(team.id, memberA.id, owner.id);
    await addTeamMember(team.id, memberB.id, owner.id);

    await setTeamLead(team.id, memberA.id, true, owner.id);
    await setTeamLead(team.id, memberB.id, true, owner.id);

    expect((await getTeamMembership(memberA.id, team.id))?.isTeamLead).toBe(true);
    expect((await getTeamMembership(memberB.id, team.id))?.isTeamLead).toBe(true);
  });

  it("removeTeamMember removes the row and returns not_found for a non-member", async () => {
    const owner = await createUser("owner4@example.com");
    const member = await createUser("member4@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });
    const team = await createTeam(org.id, "Engineering", owner.id);
    await addTeamMember(team.id, member.id, owner.id);

    const removed = await removeTeamMember(team.id, member.id, owner.id);
    expect(removed).toEqual({ ok: true });
    expect(await getTeamMembership(member.id, team.id)).toBeNull();

    const again = await removeTeamMember(team.id, member.id, owner.id);
    expect(again).toEqual({ ok: false, reason: "not_found" });
  });

  it("deleteTeam cascades TeamMembership rows", async () => {
    const owner = await createUser("owner5@example.com");
    const member = await createUser("member5@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });
    const team = await createTeam(org.id, "Engineering", owner.id);
    await addTeamMember(team.id, member.id, owner.id);

    await deleteTeam(team.id, owner.id);

    expect(await findTeamById(team.id)).toBeNull();
    const rows = await db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, team.id), eq(teamMemberships.userId, member.id)));
    expect(rows).toHaveLength(0);
  });
});
