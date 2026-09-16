import { randomBytes, createHash } from "node:crypto";

/**
 * Token generation/hashing shared by sessions.ts and tokens.ts.
 *
 * Session/AuthToken tokens are already high-entropy random values (256
 * bits), unlike passwords — a deterministic fast hash (SHA-256) is the
 * standard, appropriate choice for these (exact-match lookup by hash, no
 * offline brute-force concern given the entropy), as opposed to Argon2id
 * which is specifically for low-entropy secrets a human chose
 * (docs/architecture.md §8).
 */
export function generateRandomToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
