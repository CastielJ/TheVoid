import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { pool, db } from "../../src/db/client.js";
import { taskActivities } from "../../src/db/schema.js";
import { createUser } from "../../src/domains/auth/users.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createVoid } from "../../src/domains/void/voids.js";
import { createGroup } from "../../src/domains/group/groups.js";
import {
  createTask,
  findTaskById,
  listTasksForVoid,
  updateTask,
  moveTask,
  deleteTask,
  duplicateTask,
} from "../../src/domains/task/tasks.js";
import {
  addChecklistItem,
  listChecklistItemsForTask,
} from "../../src/domains/task/checklistItems.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

describe("Task domain (implementation-plan.md Phase 4)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function setupVoid() {
    const owner = await createUser(`owner-${Math.random()}@example.com`);
    const org = await createOrganization(owner.id, "Acme");
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    return { owner, org, void: voidResult.void };
  }

  it("createTask rejects a Group that does not belong to the same Void (C3)", async () => {
    const { owner, void: voidA } = await setupVoid();
    const orgResult = await createOrganization(owner.id, "Other Org for owner");
    const voidB = await createVoid(orgResult.id, "Void B", null, owner.id);
    if (!voidB.ok) throw new Error("unreachable");
    const groupInB = await createGroup({
      voidId: voidB.void.id,
      name: "G",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const result = await createTask(
      { voidId: voidA.id, title: "Task", groupId: groupInB.id, x: 0, y: 0 },
      owner.id,
    );
    expect(result).toEqual({ ok: false, reason: "group_not_in_void" });
  });

  it("createTask succeeds with a Group belonging to the same Void", async () => {
    const { owner, void: v } = await setupVoid();
    const group = await createGroup({ voidId: v.id, name: "G", x: 0, y: 0, width: 10, height: 10 });

    const result = await createTask(
      { voidId: v.id, title: "Task", groupId: group.id, x: 5, y: 5 },
      owner.id,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.task.groupId).toBe(group.id);
    expect(result.task.status).toBe("todo");
    expect(result.task.version).toBe(1);
  });

  it("updateTask records TaskActivity for status/priority/due_date changes only (ID4), not title/description/tags", async () => {
    const { owner, void: v } = await setupVoid();
    const created = await createTask({ voidId: v.id, title: "Original", x: 0, y: 0 }, owner.id);
    if (!created.ok) throw new Error("unreachable");

    const updated = await updateTask(
      created.task.id,
      { title: "Renamed", status: "in_progress", priority: "high", dueDate: "2026-12-01" },
      owner.id,
    );
    expect(updated?.version).toBe(2);

    const activity = await db
      .select()
      .from(taskActivities)
      .where(eq(taskActivities.taskId, created.task.id));
    const fields = activity.map((a) => a.field).sort();
    expect(fields).toEqual(["due_date", "priority", "status"]);
  });

  it("moveTask rejects moving into a Group from a different Void (C3) and records group_id activity on success", async () => {
    const { owner, void: v } = await setupVoid();
    const otherOrg = await createOrganization(owner.id, "Other");
    const otherVoid = await createVoid(otherOrg.id, "Other Void", null, owner.id);
    if (!otherVoid.ok) throw new Error("unreachable");
    const foreignGroup = await createGroup({
      voidId: otherVoid.void.id,
      name: "G",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const ownGroup = await createGroup({
      voidId: v.id,
      name: "G",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const created = await createTask({ voidId: v.id, title: "T", x: 0, y: 0 }, owner.id);
    if (!created.ok) throw new Error("unreachable");

    const rejected = await moveTask(created.task.id, { groupId: foreignGroup.id }, owner.id);
    expect(rejected).toEqual({ ok: false, reason: "group_not_in_void" });

    const accepted = await moveTask(
      created.task.id,
      { x: 99, y: 100, groupId: ownGroup.id },
      owner.id,
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error("unreachable");
    expect(accepted.task.x).toBe(99);
    expect(accepted.task.groupId).toBe(ownGroup.id);

    const activity = await db
      .select()
      .from(taskActivities)
      .where(eq(taskActivities.taskId, created.task.id));
    expect(activity.some((a) => a.field === "group_id")).toBe(true);
  });

  it("deleteTask is soft-delete: excluded from listTasksForVoid but still resolvable by findTaskById", async () => {
    const { owner, void: v } = await setupVoid();
    const created = await createTask({ voidId: v.id, title: "T", x: 0, y: 0 }, owner.id);
    if (!created.ok) throw new Error("unreachable");

    expect(await listTasksForVoid(v.id)).toHaveLength(1);
    const result = await deleteTask(created.task.id);
    expect(result).toEqual({ ok: true });

    expect(await listTasksForVoid(v.id)).toHaveLength(0);
    const raw = await findTaskById(created.task.id);
    expect(raw?.deletedAt).not.toBeNull();
  });

  it("duplicateTask (ID5): new ID, copies title/description/priority/tags/group_id/checklist (reset unchecked), resets status, does not copy assignees/comments/activity", async () => {
    const { owner, void: v } = await setupVoid();
    const group = await createGroup({ voidId: v.id, name: "G", x: 0, y: 0, width: 10, height: 10 });
    const created = await createTask(
      {
        voidId: v.id,
        title: "Original",
        description: "Desc",
        priority: "urgent",
        tags: ["a", "b"],
        groupId: group.id,
        x: 10,
        y: 10,
      },
      owner.id,
    );
    if (!created.ok) throw new Error("unreachable");
    await updateTask(created.task.id, { status: "done" }, owner.id);
    await addChecklistItem(created.task.id, "Item 1");
    await addChecklistItem(created.task.id, "Item 2");

    const duplicated = await duplicateTask(created.task.id, owner.id);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) throw new Error("unreachable");

    expect(duplicated.task.id).not.toBe(created.task.id);
    expect(duplicated.task.title).toBe("Original");
    expect(duplicated.task.description).toBe("Desc");
    expect(duplicated.task.priority).toBe("urgent");
    expect(duplicated.task.tags).toEqual(["a", "b"]);
    expect(duplicated.task.groupId).toBe(group.id);
    // Status resets to default, not copied from the (now 'done') original.
    expect(duplicated.task.status).toBe("todo");

    const items = await listChecklistItemsForTask(duplicated.task.id);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.isComplete === false)).toBe(true);

    const dupActivity = await db
      .select()
      .from(taskActivities)
      .where(eq(taskActivities.taskId, duplicated.task.id));
    expect(dupActivity).toHaveLength(0);
  });
});
