import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

/**
 * D43 global search, and the "Standing architecture principle (Round 5)"
 * that search passes through the same authorization layer as direct Void
 * access — the Tier-1-adjacent test here is specifically that a result for
 * a Void the caller cannot access must never appear, not just that
 * matching results are found.
 */
describe("Search (D43)", () => {
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

  it("finds Tasks by title/description and Groups by name, scoped to accessible Voids only", async () => {
    const { client: ownerClient } = await signupAndLogin("owner@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });

    const accessibleVoid = await ownerClient.void.create.mutate({
      organizationId: org.id,
      name: "Accessible",
    });
    await ownerClient.task.create.mutate({
      voidId: accessibleVoid.id,
      title: "Redesign onboarding flow",
      x: 0,
      y: 0,
    });
    await ownerClient.task.create.mutate({
      voidId: accessibleVoid.id,
      title: "Unrelated task",
      description: "mentions onboarding somewhere in the body",
      x: 0,
      y: 0,
    });
    await ownerClient.group.create.mutate({
      voidId: accessibleVoid.id,
      name: "Onboarding sprint",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    // A private Void owned by a different user — must never appear in the owner's results.
    const { client: otherClient } = await signupAndLogin("other@example.com");
    await db.insert(memberships).values({
      organizationId: org.id,
      userId: (await otherClient.auth.me.query()).id,
      role: "member",
    });
    const inaccessibleVoid = await otherClient.void.create.mutate({
      organizationId: org.id,
      name: "Private",
    });
    await otherClient.task.create.mutate({
      voidId: inaccessibleVoid.id,
      title: "Onboarding secret task",
      x: 0,
      y: 0,
    });

    const results = await ownerClient.search.search.query({
      organizationId: org.id,
      query: "onboarding",
    });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.voidId === accessibleVoid.id)).toBe(true);
    expect(results.some((r) => r.type === "group" && r.title === "Onboarding sprint")).toBe(true);
  });

  it("returns an empty array for a blank query, never a full unfiltered listing", async () => {
    const { client: ownerClient } = await signupAndLogin("owner2@example.com");
    const org = await ownerClient.organization.create.mutate({ name: "Acme" });
    const voidRow = await ownerClient.void.create.mutate({ organizationId: org.id, name: "Void" });
    await ownerClient.task.create.mutate({ voidId: voidRow.id, title: "Something", x: 0, y: 0 });

    expect(await ownerClient.search.search.query({ organizationId: org.id, query: "   " })).toEqual(
      [],
    );
  });
});
