import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { checkRateLimit } from "../../src/domains/auth/rateLimit.js";

describe("rate limiting (D29)", () => {
  it("allows requests under the max within the window", () => {
    const key = `test-${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      expect(() => checkRateLimit(key, { windowMs: 60_000, max: 5 })).not.toThrow();
    }
  });

  it("throws TOO_MANY_REQUESTS once the max is exceeded within the window", () => {
    const key = `test-${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, { windowMs: 60_000, max: 3 });
    }
    expect(() => checkRateLimit(key, { windowMs: 60_000, max: 3 })).toThrow(TRPCError);
  });

  it("resets the count in a new window", async () => {
    const key = `test-${crypto.randomUUID()}`;
    checkRateLimit(key, { windowMs: 50, max: 1 });
    expect(() => checkRateLimit(key, { windowMs: 50, max: 1 })).toThrow(TRPCError);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(() => checkRateLimit(key, { windowMs: 50, max: 1 })).not.toThrow();
  });

  it("tracks separate keys independently", () => {
    const keyA = `test-a-${crypto.randomUUID()}`;
    const keyB = `test-b-${crypto.randomUUID()}`;
    checkRateLimit(keyA, { windowMs: 60_000, max: 1 });
    expect(() => checkRateLimit(keyB, { windowMs: 60_000, max: 1 })).not.toThrow();
  });
});
