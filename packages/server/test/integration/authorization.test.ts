import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { removeMember } from "../../src/domains/organization/memberships.js";
import { createVoid } from "../../src/domains/void/voids.js";
import { grantVoidAccess } from "../../src/domains/void/voidAccessGrants.js";
import {
  canManageOrganization,
  canTransferOwnership,
  canCreateChildVoid,
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

  it("canCreateChildVoid is true for the org Owner/Admin and for a Manager on the parent Void, false otherwise (third feature pass: Team merged into Void)", async () => {
    const owner = await createUser("owner3@example.com");
    const managerUser = await createUser("manager3@example.com");
    const regular = await createUser("regular3@example.com");
    const stranger = await createUser("stranger3@example.com");

    const org = await createOrganization(owner.id, "Acme");
    const parentResult = await createVoid(org.id, "Engineering", null, "private", owner.id);
    if (!parentResult.ok) throw new Error("unreachable");
    const parent = parentResult.void;

    // managerUser and regular must be org members before being granted
    // access to the parent Void (C3). Phase 2 has no invitation flow yet,
    // so memberships are seeded via the domain layer directly for this
    // test's setup only.
    await db.insert(memberships).values([
      { organizationId: org.id, userId: managerUser.id, role: "member", status: "active" },
      { organizationId: org.id, userId: regular.id, role: "member", status: "active" },
    ]);

    await grantVoidAccess(parent.id, managerUser.id, "manager", owner.id);
    await grantVoidAccess(parent.id, regular.id, "editor", owner.id);

    expect(await canCreateChildVoid(owner.id, parent.id)).toBe(true); // org Owner
    expect(await canCreateChildVoid(managerUser.id, parent.id)).toBe(true); // Manager on this Void
    expect(await canCreateChildVoid(regular.id, parent.id)).toBe(false); // plain Editor
    expect(await canCreateChildVoid(stranger.id, parent.id)).toBe(false); // not org member at all
  });

  it("canCreateChildVoid is false for a Manager scoped to a different Void (no cross-Void authority)", async () => {
    const owner = await createUser("owner4@example.com");
    const managerOfA = await createUser("manager4@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const parentAResult = await createVoid(org.id, "Engineering", null, "private", owner.id);
    const parentBResult = await createVoid(org.id, "Design", null, "private", owner.id);
    if (!parentAResult.ok || !parentBResult.ok) throw new Error("unreachable");
    const parentA = parentAResult.void;
    const parentB = parentBResult.void;

    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: managerOfA.id, role: "member", status: "active" });
    await grantVoidAccess(parentA.id, managerOfA.id, "manager", owner.id);

    expect(await canCreateChildVoid(managerOfA.id, parentA.id)).toBe(true);
    expect(await canCreateChildVoid(managerOfA.id, parentB.id)).toBe(false);
  });

  it("canCreateChildVoid returns false for a nonexistent parent Void", async () => {
    const owner = await createUser("owner5@example.com");
    expect(await canCreateChildVoid(owner.id, "00000000-0000-0000-0000-000000000000")).toBe(false);
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
