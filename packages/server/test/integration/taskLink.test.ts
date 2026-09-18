import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { pool } from "../../src/db/client.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createVoid } from "../../src/domains/void/voids.js";
import {
  createTask,
  deleteTask,
  findTaskById,
  updateTask,
  DependencyNotSatisfiedError,
} from "../../src/domains/task/tasks.js";
import {
  createTaskLink,
  findTaskLinkById,
  deleteTaskLink,
  findIncompleteDependencySources,
} from "../../src/domains/task/taskLinks.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

describe("TaskLink domain (third feature pass — task-to-task connections)", () => {
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
    const voidResult = await createVoid(org.id, "Void", null, "private", owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    return { owner, org, void: voidResult.void };
  }

  async function makeTask(voidId: string, ownerId: string, title: string) {
    const result = await createTask({ voidId, title, x: 0, y: 0 }, ownerId);
    if (!result.ok) throw new Error("unreachable");
    return result.task;
  }

  it("rejects linking a Task to itself", async () => {
    const { owner, void: v } = await setupVoid();
    const t = await makeTask(v.id, owner.id, "T");
    const result = await createTaskLink(
      { sourceTaskId: t.id, targetTaskId: t.id, type: "flow" },
      owner.id,
    );
    expect(result).toEqual({ ok: false, reason: "self_loop" });
  });

  it("rejects linking Tasks that belong to different Voids", async () => {
    const { owner, org, void: voidA } = await setupVoid();
    const voidB = await createVoid(org.id, "Void B", null, "private", owner.id);
    if (!voidB.ok) throw new Error("unreachable");
    const a = await makeTask(voidA.id, owner.id, "A");
    const b = await makeTask(voidB.void.id, owner.id, "B");

    const result = await createTaskLink(
      { sourceTaskId: a.id, targetTaskId: b.id, type: "flow" },
      owner.id,
    );
    expect(result).toEqual({ ok: false, reason: "cross_void" });
  });

  it("rejects a duplicate (source, target, type) connection", async () => {
    const { owner, void: v } = await setupVoid();
    const a = await makeTask(v.id, owner.id, "A");
    const b = await makeTask(v.id, owner.id, "B");

    const first = await createTaskLink(
      { sourceTaskId: a.id, targetTaskId: b.id, type: "flow" },
      owner.id,
    );
    expect(first.ok).toBe(true);

    const duplicate = await createTaskLink(
      { sourceTaskId: a.id, targetTaskId: b.id, type: "flow" },
      owner.id,
    );
    expect(duplicate).toEqual({ ok: false, reason: "duplicate" });
  });

  it("allows a flow AND a dependency link on the same ordered pair, and the reverse direction as a distinct row", async () => {
    const { owner, void: v } = await setupVoid();
    const a = await makeTask(v.id, owner.id, "A");
    const b = await makeTask(v.id, owner.id, "B");

    const flow = await createTaskLink(
      { sourceTaskId: a.id, targetTaskId: b.id, type: "flow" },
      owner.id,
    );
    const dependency = await createTaskLink(
      { sourceTaskId: a.id, targetTaskId: b.id, type: "dependency" },
      owner.id,
    );
    const reverse = await createTaskLink(
      { sourceTaskId: b.id, targetTaskId: a.id, type: "flow" },
      owner.id,
    );

    expect(flow.ok).toBe(true);
    expect(dependency.ok).toBe(true);
    expect(reverse.ok).toBe(true);
  });

  it("deleteTaskLink removes the row", async () => {
    const { owner, void: v } = await setupVoid();
    const a = await makeTask(v.id, owner.id, "A");
    const b = await makeTask(v.id, owner.id, "B");
    const created = await createTaskLink(
      { sourceTaskId: a.id, targetTaskId: b.id, type: "flow" },
      owner.id,
    );
    if (!created.ok) throw new Error("unreachable");

    await deleteTaskLink(created.taskLink.id);
    expect(await findTaskLinkById(created.taskLink.id)).toBeNull();
  });

  it("deleting either endpoint Task cascades: the TaskLink row is removed and its id is reported", async () => {
    const { owner, void: v } = await setupVoid();
    const a = await makeTask(v.id, owner.id, "A");
    const b = await makeTask(v.id, owner.id, "B");
    const created = await createTaskLink(
      { sourceTaskId: a.id, targetTaskId: b.id, type: "flow" },
      owner.id,
    );
    if (!created.ok) throw new Error("unreachable");

    const existingA = await findTaskById(a.id);
    if (!existingA) throw new Error("unreachable");
    const result = await deleteTask(existingA);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.deletedLinkIds).toEqual([created.taskLink.id]);
    expect(await findTaskLinkById(created.taskLink.id)).toBeNull();
  });

  it("findIncompleteDependencySources ignores flow links and links where the source is already done", async () => {
    const { owner, void: v } = await setupVoid();
    const source = await makeTask(v.id, owner.id, "Source");
    const target = await makeTask(v.id, owner.id, "Target");
    const flowSource = await makeTask(v.id, owner.id, "Flow source");

    await createTaskLink(
      { sourceTaskId: flowSource.id, targetTaskId: target.id, type: "flow" },
      owner.id,
    );
    expect(await findIncompleteDependencySources(target.id)).toEqual([]);

    await createTaskLink(
      { sourceTaskId: source.id, targetTaskId: target.id, type: "dependency" },
      owner.id,
    );
    expect(await findIncompleteDependencySources(target.id)).toEqual([source.id]);

    await updateTask(source.id, { status: "done" }, owner.id);
    expect(await findIncompleteDependencySources(target.id)).toEqual([]);
  });

  it("updateTask blocks marking a Task done while a dependency source isn't done, then allows it once satisfied", async () => {
    const { owner, void: v } = await setupVoid();
    const source = await makeTask(v.id, owner.id, "Source");
    const target = await makeTask(v.id, owner.id, "Target");
    await createTaskLink(
      { sourceTaskId: source.id, targetTaskId: target.id, type: "dependency" },
      owner.id,
    );

    await expect(updateTask(target.id, { status: "done" }, owner.id)).rejects.toThrow(
      DependencyNotSatisfiedError,
    );

    await updateTask(source.id, { status: "done" }, owner.id);
    const updated = await updateTask(target.id, { status: "done" }, owner.id);
    expect(updated?.status).toBe("done");
  });

  it("updateTask only checks the dependency rule on the transition INTO done, not on a re-save of an already-done Task", async () => {
    const { owner, void: v } = await setupVoid();
    const source = await makeTask(v.id, owner.id, "Source");
    const target = await makeTask(v.id, owner.id, "Target");
    await createTaskLink(
      { sourceTaskId: source.id, targetTaskId: target.id, type: "dependency" },
      owner.id,
    );
    await updateTask(source.id, { status: "done" }, owner.id);
    await updateTask(target.id, { status: "done" }, owner.id);

    // The source becomes un-done again after the fact — re-saving the
    // already-done target with status: "done" again must not re-trigger
    // the block, since it isn't a real todo/in_progress -> done transition.
    await updateTask(source.id, { status: "todo" }, owner.id);
    await expect(updateTask(target.id, { status: "done" }, owner.id)).resolves.toMatchObject({
      status: "done",
    });
  });
});
