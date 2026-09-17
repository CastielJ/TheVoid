import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { pool, db } from "../../src/db/client.js";
import { memberships, voids } from "../../src/db/schema.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createVoid, deleteVoid } from "../../src/domains/void/voids.js";
import { grantVoidAccess } from "../../src/domains/void/voidAccessGrants.js";
import {
  getVoidRole,
  canAccessVoid,
  canEditVoid,
  canManageVoidAccess,
  canDeleteVoid,
} from "../../src/authorization/capabilities.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Tier 1 coverage (implementation-plan.md §9 Phase 3): the C1 regression —
 * an Org Admin/Owner with no VoidAccessGrant must be denied access to a
 * private Void — plus getVoidRole's resolution order, the A2 default-grant
 * logic, and the ID1 deletion exception. Third feature pass: canCreateChildVoid
 * coverage lives in authorization.test.ts alongside the other capability
 * functions (Team merged into Void, so there's no more Team-derived grant
 * branch in getVoidRole to test here).
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

    const result = await createVoid(org.id, "Member's private Void", null, "private", member.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    // The creator (Member) can access it (A2: creator becomes Manager)...
    expect(await canAccessVoid(member.id, result.void.id)).toBe(true);
    // ...but the Org Owner — despite outranking Member at the org level —
    // has no VoidAccessGrant here and must be denied, full stop.
    expect(await canAccessVoid(owner.id, result.void.id)).toBe(false);
    expect(await getVoidRole(owner.id, result.void.id)).toBeNull();
  });

  it("A2: the creator of a private top-level Void becomes its Manager by default", async () => {
    const owner = await createUser("owner2@example.com");
    const org = await createOrganization(owner.id, "Acme");

    const result = await createVoid(org.id, "Personal Void", null, "private", owner.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(await getVoidRole(owner.id, result.void.id)).toBe("manager");
    expect(await canManageVoidAccess(owner.id, result.void.id)).toBe(true);
  });

  it('the creator of a child Void ("Team") becomes its Manager directly — no membership is inherited from the parent Void', async () => {
    const owner = await createUser("owner3@example.com");
    const creator = await createUser("creator3@example.com");
    const parentMember = await createUser("parentmember3@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db.insert(memberships).values([
      { organizationId: org.id, userId: creator.id, role: "member" },
      { organizationId: org.id, userId: parentMember.id, role: "member" },
    ]);
    const parentResult = await createVoid(org.id, "Engineering", null, "private", owner.id);
    if (!parentResult.ok) throw new Error("unreachable");
    const parent = parentResult.void;
    await grantVoidAccess(parent.id, creator.id, "manager", owner.id);
    await grantVoidAccess(parent.id, parentMember.id, "editor", owner.id);

    const childResult = await createVoid(org.id, "Team Void", parent.id, "private", creator.id);
    expect(childResult.ok).toBe(true);
    if (!childResult.ok) throw new Error("unreachable");

    // Creator gets a direct Manager grant on the child they made.
    expect(await getVoidRole(creator.id, childResult.void.id)).toBe("manager");
    // Nothing is inherited from the parent — a fellow parent member with no
    // direct grant on the child has no access to it at all.
    expect(await getVoidRole(parentMember.id, childResult.void.id)).toBeNull();
    expect(await canEditVoid(parentMember.id, childResult.void.id)).toBe(false);
  });

  it("a deleted Void is authorization-inaccessible even to a Manager with an existing grant (architecture.md §6.2)", async () => {
    const owner = await createUser("owner6@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const result = await createVoid(org.id, "Doomed Void", null, "private", owner.id);
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

    const result = await createVoid(org.id, "Member's Void", null, "private", member.id);
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

    const result = await createVoid(org.id, "Owner's Void", null, "private", owner.id);
    if (!result.ok) throw new Error("unreachable");

    expect(await canDeleteVoid(bystander.id, result.void.id)).toBe(false);
  });
});
