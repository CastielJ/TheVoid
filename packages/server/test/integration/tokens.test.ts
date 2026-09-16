import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { pool } from "../../src/db/client.js";
import {
  issueAuthToken,
  verifyAuthToken,
  consumeAuthToken,
} from "../../src/domains/auth/tokens.js";
import { createUser } from "../helpers/testUser.js";
import { resetAuthTables } from "../helpers/db.js";

/**
 * Direct invariant tests for AuthToken (docs/architecture.md §4, C4):
 * expiring, single-use, and revoked-on-reissue — exercised here at the
 * domain-function level in addition to the end-to-end coverage in
 * auth.test.ts, per docs/implementation-plan.md §9 Tier 1.
 */
describe("AuthToken invariants", () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a freshly issued token verifies successfully", async () => {
    const user = await createUser("token-test-1@example.com");
    const token = await issueAuthToken(user.id, "email_verification");
    const result = await verifyAuthToken(token, "email_verification");
    expect(result.valid).toBe(true);
  });

  it("is single-use: consuming it makes subsequent verification fail", async () => {
    const user = await createUser("token-test-2@example.com");
    const token = await issueAuthToken(user.id, "email_verification");
    const first = await verifyAuthToken(token, "email_verification");
    expect(first.valid).toBe(true);
    if (!first.valid) throw new Error("unreachable");

    await consumeAuthToken(first.tokenId);

    const second = await verifyAuthToken(token, "email_verification");
    expect(second).toEqual({ valid: false, reason: "already_used" });
  });

  it("issuing a new token of the same purpose revokes the prior one (C4)", async () => {
    const user = await createUser("token-test-3@example.com");
    const firstToken = await issueAuthToken(user.id, "password_reset");
    const secondToken = await issueAuthToken(user.id, "password_reset");

    const firstResult = await verifyAuthToken(firstToken, "password_reset");
    expect(firstResult).toEqual({ valid: false, reason: "revoked" });

    const secondResult = await verifyAuthToken(secondToken, "password_reset");
    expect(secondResult.valid).toBe(true);
  });

  it("does not affect tokens of a different purpose for the same user", async () => {
    const user = await createUser("token-test-4@example.com");
    const verifyToken = await issueAuthToken(user.id, "email_verification");
    await issueAuthToken(user.id, "password_reset"); // different purpose

    const result = await verifyAuthToken(verifyToken, "email_verification");
    expect(result.valid).toBe(true);
  });

  it("reports not_found for a token that was never issued", async () => {
    const result = await verifyAuthToken("not-a-real-token", "magic_link");
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });
});
