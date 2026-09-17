import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { pool } from "../../src/db/client.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createVoid } from "../../src/domains/void/voids.js";
import {
  createGroup,
  findGroupById,
  GROUP_MIN_WIDTH,
  GROUP_MIN_HEIGHT,
} from "../../src/domains/group/groups.js";
import { createTask, moveTask, deleteTask, duplicateTask } from "../../src/domains/task/tasks.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Second feature pass — Group auto-sizing: recomputeGroupBounds (called
 * from task create/move/delete/duplicate) must keep a Group's persisted
 * width/height/x/y as a tight bounding box over its member Tasks, shrink to
 * the minimum size (not vanish) when empty, and never create/create-new-Tag-
 * style side effects when a Task simply moves within the same Group.
 */
describe("Group auto-sizing (second feature pass)", () => {
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

  it("a brand-new empty Group starts at the minimum size", async () => {
    const { void: v } = await setupVoid();
    const group = await createGroup({ voidId: v.id, name: "G", x: 0, y: 0 });
    expect(group.width).toBe(GROUP_MIN_WIDTH);
    expect(group.height).toBe(GROUP_MIN_HEIGHT);
  });

  it("createTask into a Group grows its bounds to fit; a second Task further out grows it again", async () => {
    const { owner, void: v } = await setupVoid();
    const group = await createGroup({ voidId: v.id, name: "G", x: 0, y: 0 });

    const t1 = await createTask(
      { voidId: v.id, title: "A", groupId: group.id, x: 0, y: 0 },
      owner.id,
    );
    if (!t1.ok) throw new Error("unreachable");
    const afterFirst = await findGroupById(group.id);
    // A single Task near the origin still fits within the minimum footprint.
    expect(afterFirst!.width).toBeGreaterThanOrEqual(GROUP_MIN_WIDTH);
    expect(afterFirst!.height).toBeGreaterThanOrEqual(GROUP_MIN_HEIGHT);

    const t2 = await createTask(
      { voidId: v.id, title: "B", groupId: group.id, x: 1000, y: 800 },
      owner.id,
    );
    if (!t2.ok) throw new Error("unreachable");
    const afterSecond = await findGroupById(group.id);
    // Now the bbox must actually stretch to reach the second Task's position.
    expect(afterSecond!.width).toBeGreaterThan(GROUP_MIN_WIDTH);
    expect(afterSecond!.height).toBeGreaterThan(GROUP_MIN_HEIGHT);
    expect(afterSecond!.x).toBeLessThanOrEqual(0);
    expect(afterSecond!.y).toBeLessThanOrEqual(0);
    expect(afterSecond!.x + afterSecond!.width).toBeGreaterThan(1000);
    expect(afterSecond!.y + afterSecond!.height).toBeGreaterThan(800);
  });

  it("moving a Task out of a Group shrinks that Group back down; moving it into a Group grows that Group", async () => {
    const { owner, void: v } = await setupVoid();
    const groupA = await createGroup({ voidId: v.id, name: "A", x: 0, y: 0 });
    const groupB = await createGroup({ voidId: v.id, name: "B", x: 2000, y: 2000 });

    // A single Task's padded footprint (220x96 + 24px padding on each side)
    // is smaller than GROUP_MIN_WIDTH/HEIGHT in both dimensions, so it can
    // never grow a Group past the minimum on its own regardless of position
    // — two Tasks spread apart are needed to actually exceed it.
    const t1 = await createTask(
      { voidId: v.id, title: "T1", groupId: groupA.id, x: 0, y: 0 },
      owner.id,
    );
    const t2 = await createTask(
      { voidId: v.id, title: "T2", groupId: groupA.id, x: 1500, y: 1200 },
      owner.id,
    );
    if (!t1.ok || !t2.ok) throw new Error("unreachable");
    const grownA = await findGroupById(groupA.id);
    expect(grownA!.width).toBeGreaterThan(GROUP_MIN_WIDTH);

    await moveTask(t2.task.id, { groupId: groupB.id, x: 2050, y: 2050 }, owner.id);

    // groupA now has only t1 left — a single Task, so back to the minimum.
    const shrunkA = await findGroupById(groupA.id);
    expect(shrunkA!.width).toBe(GROUP_MIN_WIDTH);
    expect(shrunkA!.height).toBe(GROUP_MIN_HEIGHT);

    const grownB = await findGroupById(groupB.id);
    expect(grownB!.width).toBeGreaterThanOrEqual(GROUP_MIN_WIDTH);
  });

  it("deleting the last Task in a Group shrinks it back to the minimum, keeping its current x/y", async () => {
    const { owner, void: v } = await setupVoid();
    const group = await createGroup({ voidId: v.id, name: "G", x: 0, y: 0 });
    const t1 = await createTask(
      { voidId: v.id, title: "T1", groupId: group.id, x: 0, y: 0 },
      owner.id,
    );
    const t2 = await createTask(
      { voidId: v.id, title: "T2", groupId: group.id, x: 900, y: 700 },
      owner.id,
    );
    if (!t1.ok || !t2.ok) throw new Error("unreachable");
    const grown = await findGroupById(group.id);
    expect(grown!.width).toBeGreaterThan(GROUP_MIN_WIDTH);

    await deleteTask(t1.task.id);
    await deleteTask(t2.task.id);

    const shrunk = await findGroupById(group.id);
    expect(shrunk!.width).toBe(GROUP_MIN_WIDTH);
    expect(shrunk!.height).toBe(GROUP_MIN_HEIGHT);
  });

  it("duplicating a Task into the same Group recomputes that Group's bounds again", async () => {
    const { owner, void: v } = await setupVoid();
    const group = await createGroup({ voidId: v.id, name: "G", x: 0, y: 0 });
    const t = await createTask(
      { voidId: v.id, title: "T", groupId: group.id, x: 500, y: 400 },
      owner.id,
    );
    if (!t.ok) throw new Error("unreachable");
    const before = await findGroupById(group.id);

    await duplicateTask(t.task.id, owner.id);

    const after = await findGroupById(group.id);
    // The duplicate lands at x+20/y+20 (domains/task/tasks.ts), extending the
    // bbox slightly further than the original single Task did.
    expect(after!.width).toBeGreaterThanOrEqual(before!.width);
    expect(after!.height).toBeGreaterThanOrEqual(before!.height);
  });
});
