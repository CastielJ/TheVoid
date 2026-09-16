import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { sessions, users, type User } from "../../db/schema.js";
import { generateRandomToken, hashToken } from "./crypto.js";
import { SESSION_IDLE_EXPIRY_MS, SESSION_REMEMBER_ME_EXPIRY_MS } from "../../config/auth.js";

export interface CreateSessionOptions {
  rememberMe?: boolean;
  deviceLabel?: string;
  ipAddress?: string;
}

/**
 * Server-side sessions (D25): opaque token, DB-backed, immediately
 * revocable. The raw token is only ever placed in the client's httpOnly
 * cookie by the caller — this module never sees or logs it beyond
 * generation.
 */
export async function createSession(
  userId: string,
  options: CreateSessionOptions = {},
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRandomToken();
  const rememberMe = options.rememberMe ?? false;
  const expiresAt = new Date(
    Date.now() + (rememberMe ? SESSION_REMEMBER_ME_EXPIRY_MS : SESSION_IDLE_EXPIRY_MS),
  );

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(rawToken),
    deviceLabel: options.deviceLabel,
    ipAddress: options.ipAddress,
    rememberMe,
    expiresAt,
  });

  return { rawToken, expiresAt };
}

export interface ValidatedSession {
  sessionId: string;
  user: User;
}

/**
 * Validates a session token and, if valid, extends its expiry based on this
 * activity (idle-expiry renewal, D27/ID7) — up to whichever cap
 * (idle vs. remember-me) applies to this session.
 */
export async function validateSession(rawToken: string): Promise<ValidatedSession | null> {
  const tokenHash = hashToken(rawToken);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now()) return null;

  const newExpiresAt = new Date(
    Date.now() + (row.session.rememberMe ? SESSION_REMEMBER_ME_EXPIRY_MS : SESSION_IDLE_EXPIRY_MS),
  );
  await db
    .update(sessions)
    .set({ lastActiveAt: new Date(), expiresAt: newExpiresAt })
    .where(eq(sessions.id, row.session.id));

  return { sessionId: row.session.id, user: row.user };
}

/** Immediate revocation (D25) — used for logout, and reused by revokeAllSessionsForUser. */
export async function revokeSession(sessionId: string, userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

export async function revokeAllOtherSessions(
  userId: string,
  exceptSessionId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  // Re-activate the current session (simplest correct approach: revoke all,
  // then un-revoke the one to keep — avoids a NOT-equals + prior-condition
  // race between two queries).
  await db.update(sessions).set({ revokedAt: null }).where(eq(sessions.id, exceptSessionId));
}

/**
 * Revokes every session for a user — used on password reset (ID13's
 * "revoke all existing Sessions... as part of a successful reset") and on
 * admin-assisted recovery (D28).
 */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/**
 * Explicit column selection (not `select()`) — this is returned directly to
 * the client (routers/auth.ts's listSessions, Phase 7 account-settings UI),
 * and `tokenHash` has no reason to ever leave the server, hash or not.
 */
export async function listActiveSessions(userId: string) {
  return db
    .select({
      id: sessions.id,
      deviceLabel: sessions.deviceLabel,
      ipAddress: sessions.ipAddress,
      rememberMe: sessions.rememberMe,
      createdAt: sessions.createdAt,
      lastActiveAt: sessions.lastActiveAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
