import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * D39 notification-generation coverage for the three event types wired
 * into existing mutations (task assignment, role change, comment mention)
 * plus the notificationRouter's list/markRead/markAllRead procedures.
 * "invited" is covered in invitation.test.ts, where it's generated.
 */
describe("Notifications (D39)", () => {
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

  it("task assignment notifies the assignee, but not on self-assignment", async () => {
    const { client: ownerClient, userId: ownerId } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });
    const task = await ownerClient.task.create.mutate({
      voidId: voidRow.id,
      title: "T",
      x: 0,
      y: 0,
    });

    const { client: editorClient, userId: editorId } = await signupAndLogin("editor@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: editorId,
      role: "editor",
    });

    // Self-assignment by the owner: no notification.
    await ownerClient.task.assign.mutate({ taskId: task.id, userId: ownerId });
    expect(await ownerClient.notification.countUnread.query()).toBe(0);

    // Assigning the editor: they get notified.
    await ownerClient.task.assign.mutate({ taskId: task.id, userId: editorId });
    expect(await editorClient.notification.countUnread.query()).toBe(1);
    const list = await editorClient.notification.list.query();
    expect(list[0]).toMatchObject({ type: "task_assigned", readAt: null });
  });

  it("role change notifies the affected member", async () => {
    const { client: ownerClient } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { client: memberClient, userId: memberId } = await signupAndLogin("member2@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    await ownerClient.organization.updateMemberRole.mutate({
      organizationId: org.id,
      userId: memberId,
      role: "admin",
    });

    const list = await memberClient.notification.list.query();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: "role_changed" });
  });

  it("@mention in a comment notifies an eligible mentioned user, and no one else", async () => {
    const { client: ownerClient } = await signupAndLogin("owner3@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });
    const task = await ownerClient.task.create.mutate({
      voidId: voidRow.id,
      title: "T",
      x: 0,
      y: 0,
    });

    const { client: editorClient, userId: editorId } = await signupAndLogin("editor3@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: editorId, role: "member" });
    await ownerClient.void.grantAccess.mutate({
      voidId: voidRow.id,
      userId: editorId,
      role: "editor",
    });

    // A registered user with no access to this Void — mentioning them must not notify them.
    await signupAndLogin("noaccess3@example.com");

    await ownerClient.task.addComment.mutate({
      taskId: task.id,
      body: "cc @editor3@example.com and @noaccess3@example.com and @nobody@example.com",
    });

    const editorNotifications = await editorClient.notification.list.query();
    expect(editorNotifications).toHaveLength(1);
    expect(editorNotifications[0]).toMatchObject({ type: "mentioned" });

    const { client: noAccessClient } = await signupAndLogin("noaccess3@example.com");
    expect(await noAccessClient.notification.countUnread.query()).toBe(0);
  });

  it("markRead and markAllRead only affect the caller's own notifications", async () => {
    const { client: ownerClient } = await signupAndLogin("owner4@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const { client: memberClient, userId: memberId } = await signupAndLogin("member4@example.com");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: memberId, role: "member" });

    await ownerClient.organization.updateMemberRole.mutate({
      organizationId: org.id,
      userId: memberId,
      role: "admin",
    });
    await ownerClient.organization.updateMemberRole.mutate({
      organizationId: org.id,
      userId: memberId,
      role: "member",
    });

    const list = await memberClient.notification.list.query();
    expect(list).toHaveLength(2);

    // A stranger cannot mark someone else's notification read.
    const { client: strangerClient } = await signupAndLogin("stranger4@example.com");
    await expect(
      strangerClient.notification.markRead.mutate({ notificationId: list[0]!.id }),
    ).rejects.toThrow(TRPCClientError);

    await memberClient.notification.markRead.mutate({ notificationId: list[0]!.id });
    expect(await memberClient.notification.countUnread.query()).toBe(1);

    await memberClient.notification.markAllRead.mutate();
    expect(await memberClient.notification.countUnread.query()).toBe(0);
  });
});
