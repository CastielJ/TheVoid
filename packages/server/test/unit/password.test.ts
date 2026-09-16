import { describe, expect, it, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  validatePasswordLength,
  isPasswordBreached,
} from "../../src/domains/auth/password.js";

describe("password hashing (Argon2id, D22)", () => {
  it("hashes and verifies a matching password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).not.toBe("correct-horse-battery-staple");
    await expect(verifyPassword(hash, "correct-horse-battery-staple")).resolves.toBe(true);
  });

  it("rejects a non-matching password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword(hash, "wrong-password-entirely")).resolves.toBe(false);
  });

  it("never stores the plaintext in the hash output", async () => {
    const hash = await hashPassword("my-super-secret-password-123");
    expect(hash).not.toContain("my-super-secret-password-123");
  });
});

describe("password length policy (D22: >=12 chars, no forced complexity)", () => {
  it("rejects passwords shorter than the minimum", () => {
    expect(validatePasswordLength("short12345").valid).toBe(false); // 10 chars
  });

  it("accepts a 12+ character password with no complexity requirements", () => {
    expect(validatePasswordLength("aaaaaaaaaaaa").valid).toBe(true);
  });
});

describe("breached-password check (D22, HIBP k-anonymity, fail-open)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("reports breached when the API returns the password's own suffix", async () => {
    const sha1 = createHash("sha1")
      .update("test-password-for-breach-check")
      .digest("hex")
      .toUpperCase();
    const suffix = sha1.slice(5);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `${suffix}:1\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:2`,
    } as Response);

    await expect(isPasswordBreached("test-password-for-breach-check")).resolves.toBe(true);
  });

  it("reports not-breached when no returned suffix matches", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:2",
    } as Response);
    await expect(isPasswordBreached("some-unbreached-password-xyz")).resolves.toBe(false);
  });

  it("fails open (returns false) when the API is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(isPasswordBreached("whatever-password-123")).resolves.toBe(false);
  });

  it("fails open when the API returns a non-OK status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(isPasswordBreached("whatever-password-123")).resolves.toBe(false);
  });
});
