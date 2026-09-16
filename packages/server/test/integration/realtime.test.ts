import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { openWebSocket, waitForMessage, noMessageWithin, waitForClose } from "../helpers/ws.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * Phase 5 (implementation-plan.md §2): the realtime layer's Tier-1 tests —
 * a permission-revocation-mid-session eviction, and the milestone "two
 * clients subscribed to the same Void see each other's mutations live" —
 * plus WS-specific auth/origin checks this phase added.
 */
describe("Realtime layer (WebSocket)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    // injectWS dispatches the simulated upgrade directly against the
    // server, bypassing the readiness handling app.inject() does
    // internally for ordinary HTTP requests — without this, the very
    // first WS connection in the suite can race plugin/route registration.
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
    await client.auth.signup.mutate({ email, password: "correct-horse-battery" });
    await client.auth.login.mutate({ email, password: "correct-horse-battery" });
    const me = await client.auth.me.query();
    return { client, userId: me.id, cookie: cookieJar.cookie! };
  }

  it("rejects a connection with no valid session (close code 4001)", async () => {
    const ws = await openWebSocket(app);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("ID13: a reconnect attempt with a since-revoked session is refused, not silently allowed back in", async () => {
    const { client, cookie } = await signupAndLogin("revoked@example.com");
    await client.auth.logout.mutate(); // revokes the session server-side; the cookie itself is still the same stale value

    const ws = await openWebSocket(app, cookie);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("rejects a connection from a disallowed Origin (close code 4003)", async () => {
    const { cookie } = await signupAndLogin("origin@example.com");
    const ws = await app.injectWS("/ws", {
      headers: { origin: "https://evil.example.com", cookie },
    });
    const { code } = await waitForClose(ws);
    expect(code).toBe(4003);
  });

  it("subscribing to a Void without access returns a FORBIDDEN error and does not subscribe", async () => {
    const { client: ownerClient } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { cookie } = await signupAndLogin("stranger@example.com");
    const ws = await openWebSocket(app, cookie);
    ws.send(JSON.stringify({ type: "subscribe", voidId: voidRow.id }));
    const message = await waitForMessage(ws);
    expect(message).toMatchObject({ type: "error", code: "FORBIDDEN" });
  });

  it("two subscribed clients see each other's Task/Group mutations live (D32 milestone)", async () => {
    const { client: ownerClient, cookie: ownerCookie } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { userId: editorId, cookie: editorCookie } = await signupAndLogin("editor2@example.com");
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

    const created = ownerClient.task.create.mutate({
      voidId: voidRow.id,
      title: "Live Task",
      x: 0,
      y: 0,
    });
    const [ownerEvent, editorEvent] = await Promise.all([
      waitForMessage(wsOwner),
      waitForMessage(wsEditor),
      created,
    ]);

    expect(ownerEvent).toMatchObject({ type: "task.created", voidId: voidRow.id });
    expect(ownerEvent.payload.title).toBe("Live Task");
    expect(editorEvent).toMatchObject({ type: "task.created", voidId: voidRow.id });

    const group = await ownerClient.group.create.mutate({
      voidId: voidRow.id,
      name: "G",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const groupEvent = await waitForMessage(wsEditor);
    expect(groupEvent).toMatchObject({ type: "group.created", voidId: voidRow.id });
    expect(groupEvent.payload.id).toBe(group.id);
  });

  it("D33: concurrent Task moves resolve to the last accepted write's version, broadcast as task.moved", async () => {
    const { client: ownerClient, cookie: ownerCookie } = await signupAndLogin("owner3@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });
    const task = await ownerClient.task.create.mutate({
      voidId: voidRow.id,
      title: "T",
      x: 0,
      y: 0,
    });

    const ws = await openWebSocket(app, ownerCookie);
    ws.send(JSON.stringify({ type: "subscribe", voidId: voidRow.id }));
    await waitForMessage(ws);

    await Promise.all([
      ownerClient.task.move.mutate({ taskId: task.id, x: 10, y: 10 }),
      ownerClient.task.move.mutate({ taskId: task.id, x: 20, y: 20 }),
    ]);

    const first = await waitForMessage(ws);
    const second = await waitForMessage(ws);
    expect(first.type).toBe("task.moved");
    expect(second.type).toBe("task.moved");
    // Server-assigned version strictly increases; no lost/duplicate update.
    expect(second.payload.version).toBeGreaterThan(first.payload.version);

    const finalState = await ownerClient.task.get.query({ taskId: task.id });
    expect(finalState.version).toBe(second.payload.version);
    expect([10, 20]).toContain(finalState.x);
  });

  it("ID10: revoking a subscriber's VoidAccessGrant mid-session evicts them promptly, and they stop receiving further events", async () => {
    const { client: ownerClient, cookie: ownerCookie } = await signupAndLogin("owner4@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { userId: editorId, cookie: editorCookie } = await signupAndLogin("editor4@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    const grant = await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: editorId,
      role: "editor",
    });

    const wsEditor = await openWebSocket(app, editorCookie);
    wsEditor.send(JSON.stringify({ type: "subscribe", voidId: voidRow.id }));
    await waitForMessage(wsEditor); // "subscribed"

    await ownerClient.void.revokeAccess.mutate({ grantId: grant.id });

    const evicted = await waitForMessage(wsEditor);
    expect(evicted).toMatchObject({ type: "evicted", voidId: voidRow.id });
    const closed = await waitForClose(wsEditor);
    expect(closed.code).toBeDefined();

    // Further mutations to the Void must not reach the now-evicted client.
    const wsOwnerObserver = await openWebSocket(app, ownerCookie);
    wsOwnerObserver.send(JSON.stringify({ type: "subscribe", voidId: voidRow.id }));
    await waitForMessage(wsOwnerObserver);
    await ownerClient.task.create.mutate({
      voidId: voidRow.id,
      title: "After eviction",
      x: 0,
      y: 0,
    });
    await waitForMessage(wsOwnerObserver); // owner (still subscribed) does receive it
  });

  it("§6.2/ID10: Void deletion broadcasts void.deleted then evicts all subscribers", async () => {
    const { client: ownerClient, cookie: ownerCookie } = await signupAndLogin("owner5@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const ws = await openWebSocket(app, ownerCookie);
    ws.send(JSON.stringify({ type: "subscribe", voidId: voidRow.id }));
    await waitForMessage(ws);

    await ownerClient.void.delete.mutate({ voidId: voidRow.id });

    const deletedEvent = await waitForMessage(ws);
    expect(deletedEvent).toMatchObject({ type: "void.deleted", voidId: voidRow.id });
    const evictedEvent = await waitForMessage(ws);
    expect(evictedEvent).toMatchObject({ type: "evicted", voidId: voidRow.id });
  });

  it("D17/ID10: removing an Organization member evicts their active WebSocket subscriptions across the Organization", async () => {
    const { client: ownerClient } = await signupAndLogin("owner6@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const { userId: memberId, cookie: memberCookie } = await signupAndLogin("member6@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: memberId,
      role: "editor",
    });

    const wsMember = await openWebSocket(app, memberCookie);
    wsMember.send(JSON.stringify({ type: "subscribe", voidId: voidRow.id }));
    await waitForMessage(wsMember);

    await ownerClient.organization.removeMember.mutate({
      organizationId: org.id,
      userId: memberId,
    });

    const evicted = await waitForMessage(wsMember);
    expect(evicted).toMatchObject({ type: "evicted", voidId: voidRow.id });
  });

  it("unsubscribe stops delivery without closing the connection", async () => {
    const { client: ownerClient, cookie: ownerCookie } = await signupAndLogin("owner7@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });

    const ws = await openWebSocket(app, ownerCookie);
    ws.send(JSON.stringify({ type: "subscribe", voidId: voidRow.id }));
    await waitForMessage(ws);

    ws.send(JSON.stringify({ type: "unsubscribe" }));
    await waitForMessage(ws); // "unsubscribed" ack

    await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "T", x: 0, y: 0 });
    const receivedNothing = await noMessageWithin(ws, 500);
    expect(receivedNothing).toBe(true);
  });
});
