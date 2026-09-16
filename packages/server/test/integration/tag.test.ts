import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { pool } from "../../src/db/client.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createVoid } from "../../src/domains/void/voids.js";
import { createTask } from "../../src/domains/task/tasks.js";
import {
  findOrCreateTag,
  assignTagsToTask,
  listTagsForTask,
  listOrgTags,
} from "../../src/domains/tag/tags.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Post-launch refinement pass — Organization-scoped Tags (D-addendum: see
 * docs/decisions.md). Covers the invariants the Plan-validation pass
 * specifically flagged: case-insensitive per-Org dedup, no duplicate Tag
 * rows for the same name reused across Tasks in the same Org, and no
 * cross-Organization sharing despite two Orgs happening to use the same
 * tag name.
 */
describe("Tag domain (post-launch refinement pass)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function setupVoid(orgName: string) {
    const owner = await createUser(`owner-${Math.random()}@example.com`);
    const org = await createOrganization(owner.id, orgName);
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    return { owner, org, void: voidResult.void };
  }

  it("findOrCreateTag is idempotent and case-insensitive within an Organization", async () => {
    const { owner, org } = await setupVoid("Acme");

    const first = await findOrCreateTag(org.id, "Urgent", owner.id);
    const second = await findOrCreateTag(org.id, "urgent", owner.id);
    const third = await findOrCreateTag(org.id, "  URGENT  ", owner.id);

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(await listOrgTags(org.id)).toHaveLength(1);
  });

  it("assigning the same tag name to two different Tasks in the same Void reuses one Tag row, not two", async () => {
    const { owner, org, void: v } = await setupVoid("Acme");
    const taskA = await createTask({ voidId: v.id, title: "A", x: 0, y: 0 }, owner.id);
    const taskB = await createTask({ voidId: v.id, title: "B", x: 0, y: 0 }, owner.id);
    if (!taskA.ok || !taskB.ok) throw new Error("unreachable");

    await assignTagsToTask(taskA.task.id, ["shared-tag"], owner.id);
    await assignTagsToTask(taskB.task.id, ["shared-tag"], owner.id);

    expect(await listOrgTags(org.id)).toHaveLength(1);
    const tagsOnA = await listTagsForTask(taskA.task.id);
    const tagsOnB = await listTagsForTask(taskB.task.id);
    expect(tagsOnA[0]!.id).toBe(tagsOnB[0]!.id);
  });

  it("the same tag name in two different Organizations creates two separate Tag rows — never shared cross-org", async () => {
    const orgA = await setupVoid("Org A");
    const orgB = await setupVoid("Org B");

    const tagA = await findOrCreateTag(orgA.org.id, "roadmap", orgA.owner.id);
    const tagB = await findOrCreateTag(orgB.org.id, "roadmap", orgB.owner.id);

    expect(tagA.id).not.toBe(tagB.id);
    expect(tagA.organizationId).toBe(orgA.org.id);
    expect(tagB.organizationId).toBe(orgB.org.id);
  });

  it("assignTagsToTask replaces the full tag set (matching the old text[] column's full-replace semantics)", async () => {
    const { owner, void: v } = await setupVoid("Acme");
    const task = await createTask({ voidId: v.id, title: "T", x: 0, y: 0 }, owner.id);
    if (!task.ok) throw new Error("unreachable");

    await assignTagsToTask(task.task.id, ["a", "b"], owner.id);
    expect((await listTagsForTask(task.task.id)).map((t) => t.name).sort()).toEqual(["a", "b"]);

    await assignTagsToTask(task.task.id, ["c"], owner.id);
    expect((await listTagsForTask(task.task.id)).map((t) => t.name)).toEqual(["c"]);

    await assignTagsToTask(task.task.id, [], owner.id);
    expect(await listTagsForTask(task.task.id)).toHaveLength(0);
  });
});
