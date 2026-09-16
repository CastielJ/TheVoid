import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { pool, db } from "../../src/db/client.js";
import { memberships, voidAccessGrants } from "../../src/db/schema.js";
import { createUser } from "../../src/domains/auth/users.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createTeam } from "../../src/domains/team/teams.js";
import { addTeamMember } from "../../src/domains/team/teamMemberships.js";
import {
  createVoid,
  findVoidById,
  updateVoidName,
  deleteVoid,
  listAccessibleVoids,
} from "../../src/domains/void/voids.js";
import {
  grantVoidAccess,
  revokeVoidAccessGrant,
  listVoidAccessGrants,
} from "../../src/domains/void/voidAccessGrants.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

describe("Void & VoidAccessGrant domain (implementation-plan.md Phase 3)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("createVoid rejects a Team that does not belong to the target Organization (C3)", async () => {
    const owner = await createUser("owner@example.com");
    const otherOwner = await createUser("otherOwner@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const otherOrg = await createOrganization(otherOwner.id, "Globex");
    const otherOrgTeam = await createTeam(otherOrg.id, "Engineering", otherOwner.id);

    const result = await createVoid(org.id, "Cross-org Void", otherOrgTeam.id, owner.id);
    expect(result).toEqual({ ok: false, reason: "team_not_in_organization" });
  });

  it("updateVoidName renames the Void and writes an audit log", async () => {
    const owner = await createUser("owner2@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "Original Name", null, owner.id);
    if (!result.ok) throw new Error("unreachable");

    await updateVoidName(result.void.id, "New Name", owner.id);
    const updated = await findVoidById(result.void.id);
    expect(updated?.name).toBe("New Name");
  });

  it("deleteVoid is idempotent-safe: deleting an already-deleted Void returns not_found", async () => {
    const owner = await createUser("owner3@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "Void", null, owner.id);
    if (!result.ok) throw new Error("unreachable");

    const first = await deleteVoid(result.void.id, owner.id);
    expect(first).toEqual({ ok: true });
    const second = await deleteVoid(result.void.id, owner.id);
    expect(second).toEqual({ ok: false, reason: "not_found" });
  });

  it("listAccessibleVoids returns direct- and Team-derived-accessible Voids, excludes deleted and inaccessible ones", async () => {
    const owner = await createUser("owner4@example.com");
    const person = await createUser("person4@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });
    const team = await createTeam(org.id, "Engineering", owner.id);
    await addTeamMember(team.id, person.id, owner.id);

    const directVoid = await createVoid(org.id, "Direct Access Void", null, owner.id);
    const teamVoid = await createVoid(org.id, "Team Void", team.id, owner.id);
    const inaccessibleVoid = await createVoid(org.id, "Inaccessible Void", null, owner.id);
    const deletedVoid = await createVoid(org.id, "Deleted Void", null, owner.id);
    if (!directVoid.ok || !teamVoid.ok || !inaccessibleVoid.ok || !deletedVoid.ok) {
      throw new Error("unreachable");
    }

    await grantVoidAccess(directVoid.void.id, { userId: person.id }, "viewer", owner.id);
    await grantVoidAccess(deletedVoid.void.id, { userId: person.id }, "viewer", owner.id);
    await deleteVoid(deletedVoid.void.id, owner.id);

    const accessible = await listAccessibleVoids(person.id, org.id);
    const accessibleIds = accessible.map((v) => v.id).sort();
    expect(accessibleIds).toEqual([directVoid.void.id, teamVoid.void.id].sort());
  });

  it("Phase 8 tenant isolation: listAccessibleVoids never returns another Organization's Void, even for a User with access in both", async () => {
    const person = await createUser("person4b@example.com");
    const ownerA = await createUser("ownerA4b@example.com");
    const ownerB = await createUser("ownerB4b@example.com");
    const orgA = await createOrganization(ownerA.id, "Org A");
    const orgB = await createOrganization(ownerB.id, "Org B");
    await db.insert(memberships).values([
      { organizationId: orgA.id, userId: person.id, role: "member" },
      { organizationId: orgB.id, userId: person.id, role: "member" },
    ]);

    const voidInA = await createVoid(orgA.id, "Void A", null, ownerA.id);
    const voidInB = await createVoid(orgB.id, "Void B", null, ownerB.id);
    if (!voidInA.ok || !voidInB.ok) throw new Error("unreachable");
    await grantVoidAccess(voidInA.void.id, { userId: person.id }, "viewer", ownerA.id);
    await grantVoidAccess(voidInB.void.id, { userId: person.id }, "viewer", ownerB.id);

    const accessibleInA = await listAccessibleVoids(person.id, orgA.id);
    expect(accessibleInA.map((v) => v.id)).toEqual([voidInA.void.id]);

    const accessibleInB = await listAccessibleVoids(person.id, orgB.id);
    expect(accessibleInB.map((v) => v.id)).toEqual([voidInB.void.id]);
  });

  it("grantVoidAccess rejects a User target with no active Membership in the Void's Organization (C3)", async () => {
    const owner = await createUser("owner5@example.com");
    const outsider = await createUser("outsider5@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "Void", null, owner.id);
    if (!result.ok) throw new Error("unreachable");

    const grantResult = await grantVoidAccess(
      result.void.id,
      { userId: outsider.id },
      "viewer",
      owner.id,
    );
    expect(grantResult).toEqual({ ok: false, reason: "target_not_in_organization" });
  });

  it("grantVoidAccess rejects a Team target that does not belong to the Void's Organization (C3)", async () => {
    const owner = await createUser("owner6@example.com");
    const otherOwner = await createUser("otherOwner6@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const otherOrg = await createOrganization(otherOwner.id, "Globex");
    const otherOrgTeam = await createTeam(otherOrg.id, "Engineering", otherOwner.id);

    const result = await createVoid(org.id, "Void", null, owner.id);
    if (!result.ok) throw new Error("unreachable");

    const grantResult = await grantVoidAccess(
      result.void.id,
      { teamId: otherOrgTeam.id },
      "editor",
      owner.id,
    );
    expect(grantResult).toEqual({ ok: false, reason: "target_not_in_organization" });
  });

  it("grantVoidAccess upserts: re-granting an existing target updates its role rather than duplicating the row", async () => {
    const owner = await createUser("owner7@example.com");
    const person = await createUser("person7@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });
    const result = await createVoid(org.id, "Void", null, owner.id);
    if (!result.ok) throw new Error("unreachable");

    await grantVoidAccess(result.void.id, { userId: person.id }, "viewer", owner.id);
    await grantVoidAccess(result.void.id, { userId: person.id }, "editor", owner.id);

    const rows = await db
      .select()
      .from(voidAccessGrants)
      .where(
        and(eq(voidAccessGrants.voidId, result.void.id), eq(voidAccessGrants.userId, person.id)),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("editor");
  });

  it("revokeVoidAccessGrant removes the grant row", async () => {
    const owner = await createUser("owner8@example.com");
    const person = await createUser("person8@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });
    const result = await createVoid(org.id, "Void", null, owner.id);
    if (!result.ok) throw new Error("unreachable");

    const grantResult = await grantVoidAccess(
      result.void.id,
      { userId: person.id },
      "viewer",
      owner.id,
    );
    if (!grantResult.ok) throw new Error("unreachable");

    const revoked = await revokeVoidAccessGrant(grantResult.grant.id, owner.id);
    expect(revoked).toEqual({ ok: true });

    const grants = await listVoidAccessGrants(result.void.id);
    // Only the creator's own Manager grant remains.
    expect(grants).toHaveLength(1);
    expect(grants[0]?.userId).toBe(owner.id);
  });
});
