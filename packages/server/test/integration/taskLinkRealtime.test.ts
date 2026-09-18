import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { openWebSocket, waitForMessage } from "../helpers/ws.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Realtime coverage for TaskLink create/delete, mirroring realtime.test.ts's
 * "two subscribed clients see each other's mutations live" pattern — plus
 * the cascade case (deleting a linked Task's endpoint) that would have
 * caught the dormant-FK-only mistake if it had been missed.
 */
describe("Realtime layer — TaskLink (third feature pass)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
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
    const { client, cookieJar } = createTestClient(app);
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
    return { client, userId: me.id, cookie: cookieJar.cookie! };
  }

  async function setupSubscribedPair() {
    const { client: ownerClient, cookie: ownerCookie } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { userId: editorId, cookie: editorCookie } = await signupAndLogin("editor@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: editorId,
      role: "editor",
    });

    const wsOwner = await openWebSocket(app, ownerCookie);
    const wsEditor = await openWebSocket(app, editorCookie);
    wsOwner.send(JSON.stringify({ type: "subscribe", voidId: voidRow.id }));
    wsEditor.send(JSON.stringify({ type: "subscribe", voidId: voidRow.id }));
    await waitForMessage(wsOwner); // "subscribed" ack
    await waitForMessage(wsEditor);

    return { ownerClient, voidRow, wsOwner, wsEditor };
  }

  it("two subscribed clients both see taskLink.created live", async () => {
    const { ownerClient, voidRow, wsOwner, wsEditor } = await setupSubscribedPair();
    const a = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "A", x: 0, y: 0 });
    await waitForMessage(wsOwner);
    await waitForMessage(wsEditor);
    const b = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "B", x: 0, y: 0 });
    await waitForMessage(wsOwner);
    await waitForMessage(wsEditor);

    const created = ownerClient.taskLink.create.mutate({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      type: "flow",
    });
    const [ownerEvent, editorEvent] = await Promise.all([
      waitForMessage(wsOwner),
      waitForMessage(wsEditor),
      created,
    ]);

    expect(ownerEvent).toMatchObject({ type: "taskLink.created", voidId: voidRow.id });
    expect(ownerEvent.payload).toMatchObject({ sourceTaskId: a.id, targetTaskId: b.id });
    expect(editorEvent).toMatchObject({ type: "taskLink.created", voidId: voidRow.id });
  });

  it("two subscribed clients both see taskLink.deleted on an explicit delete", async () => {
    const { ownerClient, voidRow, wsOwner, wsEditor } = await setupSubscribedPair();
    const a = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "A", x: 0, y: 0 });
    await waitForMessage(wsOwner);
    await waitForMessage(wsEditor);
    const b = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "B", x: 0, y: 0 });
    await waitForMessage(wsOwner);
    await waitForMessage(wsEditor);
    const link = await ownerClient.taskLink.create.mutate({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      type: "flow",
    });
    await waitForMessage(wsOwner);
    await waitForMessage(wsEditor);

    const deleted = ownerClient.taskLink.delete.mutate({ taskLinkId: link.id });
    const [ownerEvent, editorEvent] = await Promise.all([
      waitForMessage(wsOwner),
      waitForMessage(wsEditor),
      deleted,
    ]);

    expect(ownerEvent).toMatchObject({
      type: "taskLink.deleted",
      voidId: voidRow.id,
      payload: { taskLinkId: link.id },
    });
    expect(editorEvent).toMatchObject({
      type: "taskLink.deleted",
      voidId: voidRow.id,
      payload: { taskLinkId: link.id },
    });
  });

  it("deleting a linked Task's endpoint broadcasts both task.deleted AND taskLink.deleted to every subscriber", async () => {
    const { ownerClient, voidRow, wsOwner, wsEditor } = await setupSubscribedPair();
    const a = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "A", x: 0, y: 0 });
    await waitForMessage(wsOwner);
    await waitForMessage(wsEditor);
    const b = await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "B", x: 0, y: 0 });
    await waitForMessage(wsOwner);
    await waitForMessage(wsEditor);
    const link = await ownerClient.taskLink.create.mutate({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      type: "flow",
    });
    await waitForMessage(wsOwner);
    await waitForMessage(wsEditor);

    const deleted = ownerClient.task.delete.mutate({ taskId: a.id });
    const [ownerFirst, ownerSecond, editorFirst, editorSecond] = await Promise.all([
      waitForMessage(wsOwner),
      waitForMessage(wsOwner),
      waitForMessage(wsEditor),
      waitForMessage(wsEditor),
      deleted,
    ]);

    const ownerTypes = [ownerFirst.type, ownerSecond.type];
    const editorTypes = [editorFirst.type, editorSecond.type];
    expect(ownerTypes).toContain("task.deleted");
    expect(ownerTypes).toContain("taskLink.deleted");
    expect(editorTypes).toContain("task.deleted");
    expect(editorTypes).toContain("taskLink.deleted");
    const ownerLinkDeleted = [ownerFirst, ownerSecond].find((m) => m.type === "taskLink.deleted");
    expect(ownerLinkDeleted.payload).toEqual({ taskLinkId: link.id });
  });
});
