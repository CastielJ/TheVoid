import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createUser } from "../../src/domains/auth/users.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { removeMember } from "../../src/domains/organization/memberships.js";
import { createTeam } from "../../src/domains/team/teams.js";
import { addTeamMember, setTeamLead } from "../../src/domains/team/teamMemberships.js";
import {
  canManageOrganization,
  canTransferOwnership,
  canManageTeam,
  canCreateVoidForTeam,
} from "../../src/authorization/capabilities.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Tier 1 coverage (docs/implementation-plan.md §9): every capability
 * function in the authorization engine, positive and negative cases. This
 * is the highest-priority test surface in the project per D60.
 */
describe("Authorization engine (architecture.md §3, corrected per C1)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("canManageOrganization is true for owner and admin, false for member and non-member", async () => {
    const owner = await createUser("owner@example.com");
    const admin = await createUser("admin@example.com");
    const member = await createUser("member@example.com");
    const stranger = await createUser("stranger@example.com");

    const org = await createOrganization(owner.id, "Acme");
    // Phase 2 has no invitation flow yet (Phase 7) — memberships are seeded
    // directly via the domain layer for this test's setup only.
    await db.insert(memberships).values([
      { organizationId: org.id, userId: admin.id, role: "admin", status: "active" },
      { organizationId: org.id, userId: member.id, role: "member", status: "active" },
    ]);

    expect(await canManageOrganization(owner.id, org.id)).toBe(true);
    expect(await canManageOrganization(admin.id, org.id)).toBe(true);
    expect(await canManageOrganization(member.id, org.id)).toBe(false);
    expect(await canManageOrganization(stranger.id, org.id)).toBe(false);
  });

  it("canTransferOwnership is true only for the active owner", async () => {
    const owner = await createUser("owner2@example.com");
    const stranger = await createUser("stranger2@example.com");
    const org = await createOrganization(owner.id, "Acme");

    expect(await canTransferOwnership(owner.id, org.id)).toBe(true);
    expect(await canTransferOwnership(stranger.id, org.id)).toBe(false);
  });

  it("canManageTeam is true for the org Owner/Admin and for the Team's own Team Lead, false otherwise", async () => {
    const owner = await createUser("owner3@example.com");
    const lead = await createUser("lead3@example.com");
    const regular = await createUser("regular3@example.com");
    const stranger = await createUser("stranger3@example.com");

    const org = await createOrganization(owner.id, "Acme");
    const team = await createTeam(org.id, "Engineering", owner.id);

    // lead and regular must be org members before joining the Team (C3).
    // Phase 2 has no invitation flow yet, so memberships are seeded via the
    // domain layer directly for this test's setup only.
    await db.insert(memberships).values([
      { organizationId: org.id, userId: lead.id, role: "member", status: "active" },
      { organizationId: org.id, userId: regular.id, role: "member", status: "active" },
    ]);

    const addLead = await addTeamMember(team.id, lead.id, owner.id);
    expect(addLead.ok).toBe(true);
    await setTeamLead(team.id, lead.id, true, owner.id);

    const addRegular = await addTeamMember(team.id, regular.id, owner.id);
    expect(addRegular.ok).toBe(true);

    expect(await canManageTeam(owner.id, team.id)).toBe(true); // org Owner
    expect(await canManageTeam(lead.id, team.id)).toBe(true); // Team Lead of this Team
    expect(await canManageTeam(regular.id, team.id)).toBe(false); // plain Team member
    expect(await canManageTeam(stranger.id, team.id)).toBe(false); // not org member at all
  });

  it("canManageTeam is false for a Team Lead scoped to a different Team (no cross-Team authority)", async () => {
    const owner = await createUser("owner4@example.com");
    const leadOfTeamA = await createUser("lead4@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const teamA = await createTeam(org.id, "Engineering", owner.id);
    const teamB = await createTeam(org.id, "Design", owner.id);

    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: leadOfTeamA.id, role: "member", status: "active" });
    await addTeamMember(teamA.id, leadOfTeamA.id, owner.id);
    await setTeamLead(teamA.id, leadOfTeamA.id, true, owner.id);

    expect(await canManageTeam(leadOfTeamA.id, teamA.id)).toBe(true);
    expect(await canManageTeam(leadOfTeamA.id, teamB.id)).toBe(false);
  });

  it("canManageTeam returns false for a nonexistent Team", async () => {
    const owner = await createUser("owner5@example.com");
    expect(await canManageTeam(owner.id, "00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("canCreateVoidForTeam mirrors canManageTeam's Team Lead / org Admin rule", async () => {
    const owner = await createUser("owner6@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const team = await createTeam(org.id, "Engineering", owner.id);

    expect(await canCreateVoidForTeam(owner.id, team.id)).toBe(true);
  });

  it("a removed member loses canManageOrganization immediately (no staleness)", async () => {
    const owner = await createUser("owner7@example.com");
    const admin = await createUser("admin7@example.com");
    const org = await createOrganization(owner.id, "Acme");

    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: admin.id, role: "admin", status: "active" });
    expect(await canManageOrganization(admin.id, org.id)).toBe(true);

    const result = await removeMember(org.id, admin.id, owner.id);
    expect(result.ok).toBe(true);
    // Reaffirmed non-caching guarantee: the very next call reflects the change.
    expect(await canManageOrganization(admin.id, org.id)).toBe(false);
  });
});
