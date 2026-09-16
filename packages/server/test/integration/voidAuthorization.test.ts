import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { pool, db } from "../../src/db/client.js";
import { memberships, voids } from "../../src/db/schema.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createTeam } from "../../src/domains/team/teams.js";
import { addTeamMember, setTeamLead } from "../../src/domains/team/teamMemberships.js";
import { createVoid, deleteVoid } from "../../src/domains/void/voids.js";
import { grantVoidAccess } from "../../src/domains/void/voidAccessGrants.js";
import {
  getVoidRole,
  canAccessVoid,
  canEditVoid,
  canManageVoidAccess,
  canDeleteVoid,
  canCreateVoidForTeam,
} from "../../src/authorization/capabilities.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Tier 1 coverage (implementation-plan.md §9 Phase 3): the C1 regression —
 * an Org Admin/Owner with no VoidAccessGrant must be denied access to a
 * private Void — plus getVoidRole's resolution order, the A1/A2 default-
 * grant logic, cross-Team Team-Lead scoping, and the ID1 deletion exception.
 */
describe("Void authorization (architecture.md §3, corrected per C1)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("C1 regression: an Org Owner with no VoidAccessGrant is denied access to another member's private Void", async () => {
    const owner = await createUser("owner@example.com");
    const member = await createUser("member@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });

    const result = await createVoid(org.id, "Member's private Void", null, member.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    // The creator (Member) can access it (A2: creator becomes Manager)...
    expect(await canAccessVoid(member.id, result.void.id)).toBe(true);
    // ...but the Org Owner — despite outranking Member at the org level —
    // has no VoidAccessGrant here and must be denied, full stop.
    expect(await canAccessVoid(owner.id, result.void.id)).toBe(false);
    expect(await getVoidRole(owner.id, result.void.id)).toBeNull();
  });

  it("A2: the creator of a private (Team-less) Void becomes its Manager by default", async () => {
    const owner = await createUser("owner2@example.com");
    const org = await createOrganization(owner.id, "Acme");

    const result = await createVoid(org.id, "Personal Void", null, owner.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(await getVoidRole(owner.id, result.void.id)).toBe("manager");
    expect(await canManageVoidAccess(owner.id, result.void.id)).toBe(true);
  });

  it("A1 (generalized): the creator of a Team-associated Void becomes its Manager directly, while the Team gets a default Editor grant", async () => {
    const owner = await createUser("owner3@example.com");
    const lead = await createUser("lead3@example.com");
    const regularMember = await createUser("regular3@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db.insert(memberships).values([
      { organizationId: org.id, userId: lead.id, role: "member" },
      { organizationId: org.id, userId: regularMember.id, role: "member" },
    ]);
    const team = await createTeam(org.id, "Engineering", owner.id);
    await addTeamMember(team.id, lead.id, owner.id);
    await setTeamLead(team.id, lead.id, true, owner.id);
    await addTeamMember(team.id, regularMember.id, owner.id);

    const result = await createVoid(org.id, "Team Void", team.id, lead.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    // Creator (Team Lead) gets a direct Manager grant.
    expect(await getVoidRole(lead.id, result.void.id)).toBe("manager");
    // Direct grant wins outright over the Team's own grant (resolution order).
    // A plain Team member with no direct grant gets the Team's default role.
    expect(await getVoidRole(regularMember.id, result.void.id)).toBe("editor");
    expect(await canEditVoid(regularMember.id, result.void.id)).toBe(true);
    expect(await canManageVoidAccess(regularMember.id, result.void.id)).toBe(false);
  });

  it("canCreateVoidForTeam (and therefore Void creation) is scoped to the Team Lead's own Team, not other Teams", async () => {
    const owner = await createUser("owner4@example.com");
    const leadOfA = await createUser("lead4@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: leadOfA.id, role: "member" });
    const teamA = await createTeam(org.id, "Engineering", owner.id);
    const teamB = await createTeam(org.id, "Design", owner.id);
    await addTeamMember(teamA.id, leadOfA.id, owner.id);
    await setTeamLead(teamA.id, leadOfA.id, true, owner.id);

    expect(await canCreateVoidForTeam(leadOfA.id, teamA.id)).toBe(true);
    expect(await canCreateVoidForTeam(leadOfA.id, teamB.id)).toBe(false);
  });

  it("getVoidRole returns the highest role among a user's Team-derived grants when they belong to multiple Teams with grants on the same Void", async () => {
    const owner = await createUser("owner5@example.com");
    const person = await createUser("person5@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });
    const teamA = await createTeam(org.id, "Engineering", owner.id);
    const teamB = await createTeam(org.id, "Design", owner.id);
    await addTeamMember(teamA.id, person.id, owner.id);
    await addTeamMember(teamB.id, person.id, owner.id);

    const result = await createVoid(org.id, "Shared Void", null, owner.id);
    if (!result.ok) throw new Error("unreachable");

    await grantVoidAccess(result.void.id, { teamId: teamA.id }, "viewer", owner.id);
    await grantVoidAccess(result.void.id, { teamId: teamB.id }, "manager", owner.id);

    expect(await getVoidRole(person.id, result.void.id)).toBe("manager");
  });

  it("a deleted Void is authorization-inaccessible even to a Manager with an existing grant (architecture.md §6.2)", async () => {
    const owner = await createUser("owner6@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "Doomed Void", null, owner.id);
    if (!result.ok) throw new Error("unreachable");

    expect(await canAccessVoid(owner.id, result.void.id)).toBe(true);
    await deleteVoid(result.void.id, owner.id);

    expect(await canAccessVoid(owner.id, result.void.id)).toBe(false);
    expect(await getVoidRole(owner.id, result.void.id)).toBeNull();

    // The grant row itself is left intact, undeleted, for potential future
    // restoration (ID16) — it's just not honored while the Void is deleted.
    const [voidRow] = await db.select().from(voids).where(eq(voids.id, result.void.id));
    expect(voidRow?.deletedAt).not.toBeNull();
  });

  it("ID1: an Org Admin/Owner with no VoidAccessGrant can still delete a Void (the one explicit exception to C1)", async () => {
    const owner = await createUser("owner7@example.com");
    const member = await createUser("member7@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });

    const result = await createVoid(org.id, "Member's Void", null, member.id);
    if (!result.ok) throw new Error("unreachable");

    // Confirm the C1 baseline still holds: no content access for the Owner.
    expect(await canAccessVoid(owner.id, result.void.id)).toBe(false);
    // ...but deletion authority is explicitly carved out (ID1).
    expect(await canDeleteVoid(owner.id, result.void.id)).toBe(true);

    const deleteResult = await deleteVoid(result.void.id, owner.id);
    expect(deleteResult.ok).toBe(true);
  });

  it("canDeleteVoid is false for a plain member with no grant and no org management role", async () => {
    const owner = await createUser("owner8@example.com");
    const bystander = await createUser("bystander8@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: bystander.id, role: "member" });

    const result = await createVoid(org.id, "Owner's Void", null, owner.id);
    if (!result.ok) throw new Error("unreachable");

    expect(await canDeleteVoid(bystander.id, result.void.id)).toBe(false);
  });
});
