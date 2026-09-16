import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { pool, db } from "../../src/db/client.js";
import { memberships, taskActivities } from "../../src/db/schema.js";
import { createUser } from "../../src/domains/auth/users.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { removeMember } from "../../src/domains/organization/memberships.js";
import { createVoid } from "../../src/domains/void/voids.js";
import { grantVoidAccess } from "../../src/domains/void/voidAccessGrants.js";
import { createTask, findTaskById } from "../../src/domains/task/tasks.js";
import {
  assignTask,
  unassignTask,
  listAssigneesForTask,
} from "../../src/domains/task/taskAssignees.js";
import { canAccessVoid } from "../../src/authorization/capabilities.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Tier 1 coverage (implementation-plan.md §9 Phase 4): C8's eligibility
 * invariant and its D17 interaction (member removal flips assignments to
 * inactive), plus the authorization gap this phase surfaced and fixed — a
 * removed Organization member's stale direct VoidAccessGrant must not keep
 * working (see docs/decisions.md Phase 4 Execution Notes).
 */
describe("Task assignment: C8 eligibility & D17 interaction", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("C8: cannot actively-assign a User with no access to the Task's Void", async () => {
    const owner = await createUser("owner@example.com");
    const outsider = await createUser("outsider@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    const task = await createTask({ voidId: voidResult.void.id, title: "T", x: 0, y: 0 }, owner.id);
    if (!task.ok) throw new Error("unreachable");

    const result = await assignTask(task.task.id, outsider.id, owner.id);
    expect(result).toEqual({ ok: false, reason: "user_not_eligible" });
    expect(await listAssigneesForTask(task.task.id)).toHaveLength(0);
  });

  it("C8: a User with Void access can be actively assigned, recording an 'assignees' activity entry", async () => {
    const owner = await createUser("owner2@example.com");
    const person = await createUser("person2@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    await grantVoidAccess(voidResult.void.id, { userId: person.id }, "editor", owner.id);
    const task = await createTask({ voidId: voidResult.void.id, title: "T", x: 0, y: 0 }, owner.id);
    if (!task.ok) throw new Error("unreachable");

    const result = await assignTask(task.task.id, person.id, owner.id);
    expect(result).toEqual({ ok: true });

    const assignees = await listAssigneesForTask(task.task.id);
    expect(assignees).toHaveLength(1);
    expect(assignees[0]?.assigneeActive).toBe(true);

    const activity = await db
      .select()
      .from(taskActivities)
      .where(and(eq(taskActivities.taskId, task.task.id), eq(taskActivities.field, "assignees")));
    expect(activity).toHaveLength(1);
  });

  it("unassignTask removes the row entirely (distinct from the D17 inactive-flag path)", async () => {
    const owner = await createUser("owner3@example.com");
    const person = await createUser("person3@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: person.id, role: "member" });
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    await grantVoidAccess(voidResult.void.id, { userId: person.id }, "editor", owner.id);
    const task = await createTask({ voidId: voidResult.void.id, title: "T", x: 0, y: 0 }, owner.id);
    if (!task.ok) throw new Error("unreachable");

    await assignTask(task.task.id, person.id, owner.id);
    const result = await unassignTask(task.task.id, person.id, owner.id);
    expect(result).toEqual({ ok: true });
    expect(await listAssigneesForTask(task.task.id)).toHaveLength(0);
  });

  it("D17/C8: removing a member flips their active assignments to inactive (never deletes them), across every Task in the Organization, and logs 'assignees' activity", async () => {
    const owner = await createUser("owner4@example.com");
    const member = await createUser("member4@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });
    const voidA = await createVoid(org.id, "Void A", null, owner.id);
    const voidB = await createVoid(org.id, "Void B", null, owner.id);
    if (!voidA.ok || !voidB.ok) throw new Error("unreachable");
    await grantVoidAccess(voidA.void.id, { userId: member.id }, "editor", owner.id);
    await grantVoidAccess(voidB.void.id, { userId: member.id }, "editor", owner.id);
    const taskA = await createTask({ voidId: voidA.void.id, title: "TA", x: 0, y: 0 }, owner.id);
    const taskB = await createTask({ voidId: voidB.void.id, title: "TB", x: 0, y: 0 }, owner.id);
    if (!taskA.ok || !taskB.ok) throw new Error("unreachable");

    await assignTask(taskA.task.id, member.id, owner.id);
    await assignTask(taskB.task.id, member.id, owner.id);

    const removeResult = await removeMember(org.id, member.id, owner.id);
    expect(removeResult).toEqual({ ok: true });

    const assigneesA = await listAssigneesForTask(taskA.task.id);
    const assigneesB = await listAssigneesForTask(taskB.task.id);
    // Rows persist (never deleted) but are flagged inactive.
    expect(assigneesA).toHaveLength(1);
    expect(assigneesA[0]?.assigneeActive).toBe(false);
    expect(assigneesB).toHaveLength(1);
    expect(assigneesB[0]?.assigneeActive).toBe(false);

    // Task data itself is otherwise untouched (D17: "all other data/history stays intact").
    const rawTaskA = await findTaskById(taskA.task.id);
    expect(rawTaskA?.title).toBe("TA");
    expect(rawTaskA?.deletedAt).toBeNull();

    const inactiveActivity = await db
      .select()
      .from(taskActivities)
      .where(
        and(
          eq(taskActivities.taskId, taskA.task.id),
          eq(taskActivities.newValue, `inactive:${member.id}`),
        ),
      );
    expect(inactiveActivity).toHaveLength(1);
  });

  it("Phase 4 fix: a removed member's stale direct VoidAccessGrant no longer grants access (getVoidRole now checks active Membership)", async () => {
    const owner = await createUser("owner5@example.com");
    const member = await createUser("member5@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: member.id, role: "member" });
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    await grantVoidAccess(voidResult.void.id, { userId: member.id }, "editor", owner.id);

    expect(await canAccessVoid(member.id, voidResult.void.id)).toBe(true);

    await removeMember(org.id, member.id, owner.id);

    // The VoidAccessGrant row itself is untouched (D17 never mentions
    // revoking it) — but access is still correctly denied because the
    // Membership backing it is gone.
    expect(await canAccessVoid(member.id, voidResult.void.id)).toBe(false);
  });
});
