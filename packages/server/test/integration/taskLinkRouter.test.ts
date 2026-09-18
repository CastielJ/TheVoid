import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Router-level coverage for taskLinkRouter's requireCapability wiring,
 * mirroring taskRouter.test.ts's "Viewer cannot mutate, Editor can" shape,
 * plus the cross-Void case at the capability layer specifically (rejected
 * before the domain's own cross_void check would ever be reached).
 */
describe("taskLinkRouter (requireCapability wiring)", () => {
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
    await client.auth.login.mutate({ identifier: email, password: "correct-horse-battery" });
    const me = await client.auth.me.query();
    return { client, userId: me.id };
  }

  it("a Viewer can list TaskLinks but cannot create or delete one", async () => {
    const { client: ownerClient } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });
    const a = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "A", x: 0, y: 0 });
    const b = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "B", x: 0, y: 0 });
    const link = await ownerClient.taskLink.create.mutate({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      type: "flow",
    });

    const { client: viewerClient, userId: viewerId } = await signupAndLogin("viewer@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: viewerId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: viewerId,
      role: "viewer",
    });

    await expect(viewerClient.taskLink.list.query({ voidId: voidRow.id })).resolves.toMatchObject([
      { id: link.id },
    ]);
    await expect(
      viewerClient.taskLink.create.mutate({
        sourceTaskId: a.id,
        targetTaskId: b.id,
        type: "dependency",
      }),
    ).rejects.toThrow(TRPCClientError);
    await expect(viewerClient.taskLink.delete.mutate({ taskLinkId: link.id })).rejects.toThrow(
      TRPCClientError,
    );
  });

  it("an Editor can create and delete a TaskLink between two Tasks in the same Void", async () => {
    const { client: ownerClient } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });
    const a = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "A", x: 0, y: 0 });
    const b = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "B", x: 0, y: 0 });

    const { client: editorClient, userId: editorId } = await signupAndLogin("editor2@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: editorId,
      role: "editor",
    });

    const link = await editorClient.taskLink.create.mutate({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      type: "flow",
    });
    expect(link.sourceTaskId).toBe(a.id);
    expect(link.targetTaskId).toBe(b.id);

    await expect(editorClient.taskLink.delete.mutate({ taskLinkId: link.id })).resolves.toEqual({
      ok: true,
    });
  });

  it("cross-Void create is rejected at the capability layer, not the domain's cross_void check — an Editor on Void A only cannot link a Task in Void A to one in Void B", async () => {
    const { client: ownerClient } = await signupAndLogin("owner3@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidA = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void A" });
    const voidB = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void B" });
    const a = await ownerClient.task.create.mutate({ voidId: voidA.id, title: "A", x: 0, y: 0 });
    const b = await ownerClient.task.create.mutate({ voidId: voidB.id, title: "B", x: 0, y: 0 });

    const { client: editorClient, userId: editorId } = await signupAndLogin("editor3@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    // Editor access to Void A only — not Void B.
    await ownerClient.void.grantAccess.mutate({
      voidId: voidA.id,
      userId: editorId,
      role: "editor",
    });

    await expect(
      editorClient.taskLink.create.mutate({ sourceTaskId: a.id, targetTaskId: b.id, type: "flow" }),
    ).rejects.toThrow(TRPCClientError);
  });
});
