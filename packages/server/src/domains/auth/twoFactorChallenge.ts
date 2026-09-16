import { randomBytes } from "node:crypto";

/**
 * Short-lived "password verified, awaiting TOTP code" handshake between
 * `auth.login` and `auth.verify2FA`. Deliberately NOT a 4th AuthToken
 * purpose (architecture.md §4 scopes AuthToken to email_verification /
 * magic_link / password_reset specifically) and deliberately NOT persisted
 * — this is pure in-process handshake state with a ~5 minute lifetime; a
 * server restart mid-login just means the user logs in again, which is an
 * acceptable, non-data-losing outcome, consistent with keeping the
 * in-memory rate limiter (rateLimit.ts) similarly unpersisted for MVP.
 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const challenges = new Map<string, { userId: string; expiresAt: number }>();

export function createPendingTwoFactorChallenge(userId: string): string {
  const token = randomBytes(32).toString("hex");
  challenges.set(token, { userId, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return token;
}

export function consumePendingTwoFactorChallenge(token: string): string | null {
  const entry = challenges.get(token);
  if (!entry) return null;
  challenges.delete(token); // single-use regardless of outcome
  if (entry.expiresAt < Date.now()) return null;
  return entry.userId;
}

setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of challenges) {
      if (entry.expiresAt < now) challenges.delete(key);
    }
  },
  10 * 60 * 1000,
).unref();
