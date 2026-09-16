import { hash, verify } from "@node-rs/argon2";
import { createHash } from "node:crypto";
import { MIN_PASSWORD_LENGTH } from "../../config/auth.js";
import { logger } from "../../logger.js";

/** docs/decisions.md D22: Argon2id, never plaintext, no forced complexity/rotation rules. */
export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, { algorithm: 2 /* Argon2id */ });
}

export async function verifyPassword(hashValue: string, plaintext: string): Promise<boolean> {
  return verify(hashValue, plaintext);
}

export function validatePasswordLength(plaintext: string): { valid: boolean; message?: string } {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  return { valid: true };
}

/**
 * Breached-password check via the Have I Been Pwned k-anonymity API
 * (D22: "where practical"). Only a 5-character SHA-1 prefix is sent —
 * the full password/hash never leaves the server. Fails OPEN (treats as
 * "not found") on any network/API error rather than blocking signup/reset
 * on a third-party outage — this is a defense-in-depth check, not the
 * primary password-security control (Argon2id + length are).
 */
export async function isPasswordBreached(plaintext: string): Promise<boolean> {
  try {
    const sha1 = createHash("sha1").update(plaintext).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "HIBP breach check returned non-OK status; failing open",
      );
      return false;
    }
    const body = await response.text();
    return body.split("\n").some((line) => line.trim().startsWith(suffix));
  } catch (err) {
    logger.warn(
      { err },
      "HIBP breach check failed; failing open (not blocking on third-party outage)",
    );
    return false;
  }
}
