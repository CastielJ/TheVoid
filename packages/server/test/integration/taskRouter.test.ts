import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Router-level coverage for taskRouter's requireCapability wiring — the
 * Tier-1 "Viewer cannot mutate, Editor/Manager can" test called for in
 * implementation-plan.md §2 Phase 4, plus cross-Void isolation for the
 * checklist/comment child-resource wrappers.
 */
describe("taskRouter (requireCapability wiring)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function signupAndLogin(email: string) {
    const { client } = createTestClient(app);
    const username = email
      .split("@")[0]!
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .padEnd(3, "0");
    await client.auth.signup.mutate({
      email,
      username,
      visibleName: email.split("@")[0]!,
      password: "correct-horse-battery",
    });
    await client.auth.login.mutate({ email, password: "correct-horse-battery" });
    const me = await client.auth.me.query();
    return { client, userId: me.id };
  }

  it("a Viewer can read a Task but cannot create/update/delete/assign", async () => {
    const { client: ownerClient } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { client: viewerClient, userId: viewerId } = await signupAndLogin("viewer@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: viewerId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: viewerId,
      role: "viewer",
    });

    const task = await ownerClient.task.create.mutate({
      voidId: voidRow.id,
      title: "Task",
      x: 0,
      y: 0,
    });

    await expect(viewerClient.task.get.query({ taskId: task.id })).resolves.toMatchObject({
      id: task.id,
    });
    await expect(
      viewerClient.task.create.mutate({ voidId: voidRow.id, title: "Intruder Task", x: 0, y: 0 }),
    ).rejects.toThrow(TRPCClientError);
    await expect(
      viewerClient.task.update.mutate({ taskId: task.id, title: "Hijacked" }),
    ).rejects.toThrow(TRPCClientError);
    await expect(viewerClient.task.delete.mutate({ taskId: task.id })).rejects.toThrow(
      TRPCClientError,
    );
    await expect(
      viewerClient.task.assign.mutate({ taskId: task.id, userId: viewerId }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("an Editor can create/update/assign/comment; assigning an ineligible user is rejected (C8)", async () => {
    const { client: ownerClient } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { client: editorClient, userId: editorId } = await signupAndLogin("editor2@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: editorId,
      role: "editor",
    });

    const task = await editorClient.task.create.mutate({
      voidId: voidRow.id,
      title: "Task",
      x: 0,
      y: 0,
    });
    await expect(
      editorClient.task.update.mutate({ taskId: task.id, status: "in_progress" }),
    ).resolves.toMatchObject({ status: "in_progress" });

    const { userId: outsiderId } = await signupAndLogin("outsider2@example.com");
    await expect(
      editorClient.task.assign.mutate({ taskId: task.id, userId: outsiderId }),
    ).rejects.toThrow(TRPCClientError);

    await expect(
      editorClient.task.assign.mutate({ taskId: task.id, userId: editorId }),
    ).resolves.toEqual({ ok: true });

    const comment = await editorClient.task.addComment.mutate({ taskId: task.id, body: "Hello" });
    expect(comment.authorId).toBe(editorId);
  });

  it("cross-Void checklist-item access is FORBIDDEN even with Editor access to a different Void", async () => {
    const { client: ownerClient } = await signupAndLogin("owner3@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidA = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void A" });
    const voidB = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void B" });
    const taskInB = await ownerClient.task.create.mutate({
      voidId: voidB.id,
      title: "T",
      x: 0,
      y: 0,
    });
    const itemInB = await ownerClient.task.addChecklistItem.mutate({
      taskId: taskInB.id,
      label: "Item",
    });

    const { client: editorClient, userId: editorId } = await signupAndLogin("editor3@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidA.id,
      userId: editorId,
      role: "editor",
    });

    await expect(
      editorClient.task.toggleChecklistItem.mutate({ itemId: itemInB.id, isComplete: true }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("duplicate creates an independent Task copy in the same Void", async () => {
    const { client: ownerClient } = await signupAndLogin("owner4@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });
    const task = await ownerClient.task.create.mutate({
      voidId: voidRow.id,
      title: "Original",
      x: 0,
      y: 0,
    });

    const duplicate = await ownerClient.task.duplicate.mutate({ taskId: task.id });
    expect(duplicate.id).not.toBe(task.id);
    expect(duplicate.title).toBe("Original");
    expect(duplicate.voidId).toBe(voidRow.id);
  });

  it("D44 listMine: only active assignments in Voids the caller can currently access appear", async () => {
    const { client: ownerClient } = await signupAndLogin("owner5@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { client: editorClient, userId: editorId } = await signupAndLogin("editor5@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    const grant = await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: editorId,
      role: "editor",
    });

    const assigned = await ownerClient.task.create.mutate({
      voidId: voidRow.id,
      title: "Assigned to editor",
      x: 0,
      y: 0,
    });
    const unassigned = await ownerClient.task.create.mutate({
      voidId: voidRow.id,
      title: "Not assigned",
      x: 0,
      y: 0,
    });
    await ownerClient.task.assign.mutate({ taskId: assigned.id, userId: editorId });

    let mine = await editorClient.task.listMine.query({ organizationId: org.id });
    expect(mine.map((t) => t.id)).toEqual([assigned.id]);
    expect(mine.map((t) => t.id)).not.toContain(unassigned.id);

    // Losing Void access must also remove the Task from My Tasks, even
    // though the underlying assignment row is untouched by the revoke.
    await ownerClient.void.revokeAccess.mutate({ grantId: grant.id });
    mine = await editorClient.task.listMine.query({ organizationId: org.id });
    expect(mine).toHaveLength(0);
  });
});
