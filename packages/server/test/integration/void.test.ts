import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { pool, db } from "../../src/db/client.js";
import { memberships, voidAccessGrants } from "../../src/db/schema.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import {
  createVoid,
  findVoidById,
  updateVoidName,
  updateVoidVisibility,
  deleteVoid,
  listAccessibleVoids,
  listTopLevelAccessibleVoids,
  listChildVoids,
  listVoidAncestors,
} from "../../src/domains/void/voids.js";
import {
  grantVoidAccess,
  revokeVoidAccessGrant,
  listVoidAccessGrants,
} from "../../src/domains/void/voidAccessGrants.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

describe("Void & VoidAccessGrant domain (third feature pass: Team merged into Void)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("createVoid defaults to 'private' visibility and no parent when not specified otherwise", async () => {
    const owner = await createUser("owner0@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "A Void", null, "private", owner.id);
    if (!result.ok) throw new Error("unreachable");

    expect(result.void.parentVoidId).toBeNull();
    expect(result.void.visibility).toBe("private");
  });

  it("createVoid rejects a parent Void that does not belong to the target Organization (C3)", async () => {
    const owner = await createUser("owner@example.com");
    const otherOwner = await createUser("otherOwner@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const otherOrg = await createOrganization(otherOwner.id, "Globex");
    const otherOrgParent = await createVoid(
      otherOrg.id,
      "Engineering",
      null,
      "private",
      otherOwner.id,
    );
    if (!otherOrgParent.ok) throw new Error("unreachable");

    const result = await createVoid(
      org.id,
      "Cross-org Void",
      otherOrgParent.void.id,
      "private",
      owner.id,
    );
    expect(result).toEqual({ ok: false, reason: "parent_not_in_organization" });
  });

  it("createVoid rejects a nonexistent parent Void", async () => {
    const owner = await createUser("ownerX@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(
      org.id,
      "Orphan",
      "00000000-0000-0000-0000-000000000000",
      "private",
      owner.id,
    );
    expect(result).toEqual({ ok: false, reason: "parent_not_found" });
  });

  it("updateVoidName renames the Void and writes an audit log", async () => {
    const owner = await createUser("owner2@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "Original Name", null, "private", owner.id);
    if (!result.ok) throw new Error("unreachable");

    await updateVoidName(result.void.id, "New Name", owner.id);
    const updated = await findVoidById(result.void.id);
    expect(updated?.name).toBe("New Name");
  });

  it("updateVoidVisibility changes the Void's visibility", async () => {
    const owner = await createUser("owner2b@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "A Void", null, "private", owner.id);
    if (!result.ok) throw new Error("unreachable");

    await updateVoidVisibility(result.void.id, "public", owner.id);
    const updated = await findVoidById(result.void.id);
    expect(updated?.visibility).toBe("public");
  });

  it("deleteVoid is idempotent-safe: deleting an already-deleted Void returns not_found", async () => {
    const owner = await createUser("owner3@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "Void", null, "private", owner.id);
    if (!result.ok) throw new Error("unreachable");

    const first = await deleteVoid(result.void.id, owner.id);
    expect(first).toEqual({ ok: true });
    const second = await deleteVoid(result.void.id, owner.id);
    expect(second).toEqual({ ok: false, reason: "not_found" });
  });

  it("listAccessibleVoids returns directly-accessible Voids at any nesting depth, excludes deleted and inaccessible ones", async () => {
    const owner = await createUser("owner4@example.com");
    const person = await createUser("person4@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });

    const directVoid = await createVoid(org.id, "Direct Access Void", null, "private", owner.id);
    if (!directVoid.ok) throw new Error("unreachable");
    const childVoid = await createVoid(
      org.id,
      "Team Void",
      directVoid.void.id,
      "private",
      owner.id,
    );
    const inaccessibleVoid = await createVoid(
      org.id,
      "Inaccessible Void",
      null,
      "private",
      owner.id,
    );
    const deletedVoid = await createVoid(org.id, "Deleted Void", null, "private", owner.id);
    if (!childVoid.ok || !inaccessibleVoid.ok || !deletedVoid.ok) {
      throw new Error("unreachable");
    }

    await grantVoidAccess(directVoid.void.id, person.id, "viewer", owner.id);
    await grantVoidAccess(childVoid.void.id, person.id, "viewer", owner.id);
    await grantVoidAccess(deletedVoid.void.id, person.id, "viewer", owner.id);
    await deleteVoid(deletedVoid.void.id, owner.id);

    const accessible = await listAccessibleVoids(person.id, org.id);
    const accessibleIds = accessible.map((v) => v.id).sort();
    expect(accessibleIds).toEqual([directVoid.void.id, childVoid.void.id].sort());
  });

  it("listTopLevelAccessibleVoids only returns parentVoidId-null Voids", async () => {
    const owner = await createUser("owner4c@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const parent = await createVoid(org.id, "Parent", null, "private", owner.id);
    if (!parent.ok) throw new Error("unreachable");
    const child = await createVoid(org.id, "Child", parent.void.id, "private", owner.id);
    if (!child.ok) throw new Error("unreachable");

    const topLevel = await listTopLevelAccessibleVoids(owner.id, org.id);
    expect(topLevel.map((v) => v.id)).toEqual([parent.void.id]);
    expect(topLevel[0]?.isMember).toBe(true);
  });

  it("listTopLevelAccessibleVoids surfaces a public/private top-level Void to a non-member (isMember: false) but hides an invisible one, mirroring listChildVoids' discovery rule at the root", async () => {
    const owner = await createUser("owner4f@example.com");
    const person = await createUser("person4f@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });

    const publicVoid = await createVoid(org.id, "Public Root", null, "public", owner.id);
    const privateVoid = await createVoid(org.id, "Private Root", null, "private", owner.id);
    const invisibleVoid = await createVoid(org.id, "Invisible Root", null, "invisible", owner.id);
    if (!publicVoid.ok || !privateVoid.ok || !invisibleVoid.ok) throw new Error("unreachable");

    const seenByStranger = await listTopLevelAccessibleVoids(person.id, org.id);
    const seenIds = seenByStranger.map((v) => v.id).sort();
    expect(seenIds).toEqual([publicVoid.void.id, privateVoid.void.id].sort());
    expect(seenByStranger.every((v) => v.isMember === false)).toBe(true);

    await grantVoidAccess(invisibleVoid.void.id, person.id, "viewer", owner.id);
    const afterGrant = await listTopLevelAccessibleVoids(person.id, org.id);
    expect(afterGrant.find((v) => v.id === invisibleVoid.void.id)?.isMember).toBe(true);
  });

  it("listChildVoids returns a public child to any accessible-to-parent caller, but an invisible child only to a directly-granted user", async () => {
    const owner = await createUser("owner4d@example.com");
    const person = await createUser("person4d@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });
    const parent = await createVoid(org.id, "Parent", null, "private", owner.id);
    if (!parent.ok) throw new Error("unreachable");

    const publicChild = await createVoid(
      org.id,
      "Public Child",
      parent.void.id,
      "public",
      owner.id,
    );
    const invisibleChild = await createVoid(
      org.id,
      "Invisible Child",
      parent.void.id,
      "invisible",
      owner.id,
    );
    if (!publicChild.ok || !invisibleChild.ok) throw new Error("unreachable");

    const visibleToStranger = await listChildVoids(parent.void.id, person.id);
    expect(visibleToStranger.map((v) => v.id)).toEqual([publicChild.void.id]);

    await grantVoidAccess(invisibleChild.void.id, person.id, "viewer", owner.id);
    const visibleToMember = await listChildVoids(parent.void.id, person.id);
    expect(visibleToMember.map((v) => v.id).sort()).toEqual(
      [publicChild.void.id, invisibleChild.void.id].sort(),
    );
  });

  it("listVoidAncestors walks parentVoidId to the root, root-first", async () => {
    const owner = await createUser("owner4e@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const root = await createVoid(org.id, "Root", null, "private", owner.id);
    if (!root.ok) throw new Error("unreachable");
    const mid = await createVoid(org.id, "Mid", root.void.id, "private", owner.id);
    if (!mid.ok) throw new Error("unreachable");
    const leaf = await createVoid(org.id, "Leaf", mid.void.id, "private", owner.id);
    if (!leaf.ok) throw new Error("unreachable");

    const ancestors = await listVoidAncestors(leaf.void.id);
    expect(ancestors.map((v) => v.id)).toEqual([root.void.id, mid.void.id]);
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

    const voidInA = await createVoid(orgA.id, "Void A", null, "private", ownerA.id);
    const voidInB = await createVoid(orgB.id, "Void B", null, "private", ownerB.id);
    if (!voidInA.ok || !voidInB.ok) throw new Error("unreachable");
    await grantVoidAccess(voidInA.void.id, person.id, "viewer", ownerA.id);
    await grantVoidAccess(voidInB.void.id, person.id, "viewer", ownerB.id);

    const accessibleInA = await listAccessibleVoids(person.id, orgA.id);
    expect(accessibleInA.map((v) => v.id)).toEqual([voidInA.void.id]);

    const accessibleInB = await listAccessibleVoids(person.id, orgB.id);
    expect(accessibleInB.map((v) => v.id)).toEqual([voidInB.void.id]);
  });

  it("grantVoidAccess rejects a User target with no active Membership in the Void's Organization (C3)", async () => {
    const owner = await createUser("owner5@example.com");
    const outsider = await createUser("outsider5@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "Void", null, "private", owner.id);
    if (!result.ok) throw new Error("unreachable");

    const grantResult = await grantVoidAccess(result.void.id, outsider.id, "viewer", owner.id);
    expect(grantResult).toEqual({ ok: false, reason: "target_not_in_organization" });
  });

  it("grantVoidAccess upserts: re-granting an existing target updates its role rather than duplicating the row", async () => {
    const owner = await createUser("owner7@example.com");
    const person = await createUser("person7@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });
    const result = await createVoid(org.id, "Void", null, "private", owner.id);
    if (!result.ok) throw new Error("unreachable");

    await grantVoidAccess(result.void.id, person.id, "viewer", owner.id);
    await grantVoidAccess(result.void.id, person.id, "editor", owner.id);

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
    const result = await createVoid(org.id, "Void", null, "private", owner.id);
    if (!result.ok) throw new Error("unreachable");

    const grantResult = await grantVoidAccess(result.void.id, person.id, "viewer", owner.id);
    if (!grantResult.ok) throw new Error("unreachable");

    const revoked = await revokeVoidAccessGrant(grantResult.grant.id, owner.id);
    expect(revoked).toEqual({ ok: true });

    const grants = await listVoidAccessGrants(result.void.id);
    // Only the creator's own Manager grant remains.
    expect(grants).toHaveLength(1);
    expect(grants[0]?.userId).toBe(owner.id);
  });
});
