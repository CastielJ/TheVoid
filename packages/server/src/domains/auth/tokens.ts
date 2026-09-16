import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { authTokens } from "../../db/schema.js";
import { generateRandomToken, hashToken } from "./crypto.js";
import { AUTH_TOKEN_EXPIRY_MS, type AuthTokenPurpose } from "../../config/auth.js";

/**
 * AuthToken lifecycle (docs/architecture.md §4, decisions.md ID12/C4):
 * cryptographically random, hashed at rest, purpose-scoped, expiring,
 * single-use, and revoked/superseded when a newer token of the same
 * purpose is issued for the same user.
 */
export async function issueAuthToken(userId: string, purpose: AuthTokenPurpose): Promise<string> {
  // Revoke any prior outstanding token of this purpose for this user first
  // (C4's stated invariant — prevents multiple simultaneously-valid
  // reset/magic-link tokens).
  await db
    .update(authTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        isNull(authTokens.revokedAt),
      ),
    );

  const rawToken = generateRandomToken();
  const expiresAt = new Date(Date.now() + AUTH_TOKEN_EXPIRY_MS[purpose]);

  await db.insert(authTokens).values({
    userId,
    purpose,
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

  return rawToken;
}

export type VerifyTokenResult =
  | { valid: true; userId: string; tokenId: string }
  | { valid: false; reason: "not_found" | "expired" | "already_used" | "revoked" };

/**
 * Verifies a token without consuming it — used where the caller needs to
 * confirm validity before performing a side effect (e.g. showing a "set new
 * password" form only after the reset token checks out).
 */
export async function verifyAuthToken(
  rawToken: string,
  purpose: AuthTokenPurpose,
): Promise<VerifyTokenResult> {
  const tokenHash = hashToken(rawToken);
  const [record] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.purpose, purpose)))
    .limit(1);

  if (!record) return { valid: false, reason: "not_found" };
  if (record.revokedAt) return { valid: false, reason: "revoked" };
  if (record.consumedAt) return { valid: false, reason: "already_used" };
  if (record.expiresAt.getTime() < Date.now()) return { valid: false, reason: "expired" };

  return { valid: true, userId: record.userId, tokenId: record.id };
}

/** Marks a verified token consumed — enforces single-use (D16/architecture.md §4). */
export async function consumeAuthToken(tokenId: string): Promise<void> {
  await db.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, tokenId));
}
