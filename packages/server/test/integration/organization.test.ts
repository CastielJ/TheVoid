import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { pool, db } from "../../src/db/client.js";
import { memberships, voids, voidAccessGrants, auditLogs } from "../../src/db/schema.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import {
  getActiveMembership,
  updateMemberRole,
  removeMember,
  transferOwnership,
} from "../../src/domains/organization/memberships.js";
import { createVoid } from "../../src/domains/void/voids.js";
import { grantVoidAccess } from "../../src/domains/void/voidAccessGrants.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

describe("Organization & Membership domain (implementation-plan.md Phase 2)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("createOrganization makes the creator the Owner via a Membership row (C7)", async () => {
    const user = await createUser("founder@example.com");
    const org = await createOrganization(user.id, "Acme");

    const membership = await getActiveMembership(user.id, org.id);
    expect(membership?.role).toBe("owner");
    expect(membership?.status).toBe("active");
  });

  it("updateMemberRole cannot change the Owner's role (must use transferOwnership)", async () => {
    const owner = await createUser("owner@example.com");
    const org = await createOrganization(owner.id, "Acme");

    const result = await updateMemberRole(org.id, owner.id, "admin", owner.id);
    expect(result).toEqual({ ok: false, reason: "cannot_change_owner_role" });
  });

  it("updateMemberRole promotes a member to admin and writes an audit log (ID15)", async () => {
    const owner = await createUser("owner2@example.com");
    const member = await createUser("member2@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });

    const result = await updateMemberRole(org.id, member.id, "admin", owner.id);
    expect(result).toEqual({ ok: true });

    const membership = await getActiveMembership(member.id, org.id);
    expect(membership?.role).toBe("admin");

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.organizationId, org.id), eq(auditLogs.eventType, "member.role_changed")),
      );
    expect(log?.targetId).toBe(member.id);
    expect(log?.actorId).toBe(owner.id);
  });

  it("removeMember refuses to remove the Owner", async () => {
    const owner = await createUser("owner3@example.com");
    const org = await createOrganization(owner.id, "Acme");

    const result = await removeMember(org.id, owner.id, owner.id);
    expect(result).toEqual({ ok: false, reason: "cannot_remove_owner" });
  });

  it("removeMember ends the Membership and all of the member's Void access grants in the org (D17)", async () => {
    const owner = await createUser("owner4@example.com");
    const member = await createUser("member4@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });

    const teamResult = await createVoid(org.id, "Engineering", null, "private", owner.id);
    if (!teamResult.ok) throw new Error("unreachable");
    const team = teamResult.void;
    await grantVoidAccess(team.id, member.id, "editor", owner.id);

    const result = await removeMember(org.id, member.id, owner.id);
    expect(result).toEqual({ ok: true });

    expect(await getActiveMembership(member.id, org.id)).toBeNull();

    const remainingGrant = await db
      .select()
      .from(voidAccessGrants)
      .where(and(eq(voidAccessGrants.voidId, team.id), eq(voidAccessGrants.userId, member.id)));
    expect(remainingGrant).toHaveLength(0);

    // The Void itself, and the other member's rows, are otherwise untouched.
    const [stillVoid] = await db.select().from(voids).where(eq(voids.id, team.id));
    expect(stillVoid).toBeDefined();
  });

  it("transferOwnership demotes the current owner and promotes the target atomically (C7)", async () => {
    const owner = await createUser("owner5@example.com");
    const member = await createUser("member5@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });

    const result = await transferOwnership(org.id, member.id, owner.id);
    expect(result).toEqual({ ok: true });

    expect((await getActiveMembership(member.id, org.id))?.role).toBe("owner");
    expect((await getActiveMembership(owner.id, org.id))?.role).toBe("admin");

    // Exactly one active owner exists at all times — the DB-level invariant
    // this relies on (db/schema.ts's partial unique index) didn't reject it.
    const owners = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, org.id),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active"),
        ),
      );
    expect(owners).toHaveLength(1);
  });

  it("transferOwnership rejects a target who is not an active member", async () => {
    const owner = await createUser("owner6@example.com");
    const stranger = await createUser("stranger6@example.com");
    const org = await createOrganization(owner.id, "Acme");

    const result = await transferOwnership(org.id, stranger.id, owner.id);
    expect(result).toEqual({ ok: false, reason: "target_not_active_member" });
  });

  it("transferOwnership rejects transferring to the current owner", async () => {
    const owner = await createUser("owner7@example.com");
    const org = await createOrganization(owner.id, "Acme");

    const result = await transferOwnership(org.id, owner.id, owner.id);
    expect(result).toEqual({ ok: false, reason: "already_owner" });
  });

  it("concurrent ownership-transfer attempts cannot produce zero or two active owners", async () => {
    const owner = await createUser("owner8@example.com");
    const candidateA = await createUser("candidateA8@example.com");
    const candidateB = await createUser("candidateB8@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db.insert(memberships).values([
      { organizationId: org.id, userId: candidateA.id, role: "member" },
      { organizationId: org.id, userId: candidateB.id, role: "member" },
    ]);

    const [resultA, resultB] = await Promise.all([
      transferOwnership(org.id, candidateA.id, owner.id),
      transferOwnership(org.id, candidateB.id, owner.id),
    ]);

    // transferOwnership demotes "whoever currently holds ownership," not a
    // caller-pinned expected-owner (there's no compare-and-swap requirement
    // documented for this operation, and D33 already establishes
    // last-write-wins as this app's general conflict philosophy) — so both
    // concurrent calls may legitimately succeed, one demoting the other's
    // result. What C7 actually requires is that this can never corrupt data:
    // no committed intermediate state has zero or two active owners.
    expect(resultA.ok || resultB.ok).toBe(true);

    const owners = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, org.id),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active"),
        ),
      );
    expect(owners).toHaveLength(1);
  });

  it("the partial unique index itself rejects a second concurrently-active owner (C7, DB-level)", async () => {
    const owner = await createUser("owner9@example.com");
    const candidate = await createUser("candidate9@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: candidate.id, role: "member" });

    // Bypass the application-level transaction entirely: promote candidate
    // to owner directly while the original owner row is still active/owner.
    // This proves the database constraint (not just the application logic)
    // makes a two-owner state impossible to commit.
    await expect(
      db.update(memberships).set({ role: "owner" }).where(eq(memberships.userId, candidate.id)),
    ).rejects.toThrow();
  });
});
