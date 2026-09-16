import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users, type User } from "../../db/schema.js";

// Post-launch refinement pass: stable mention/search/lookup identifier.
// Lowercase-normalized on write, matching the existing `email` convention —
// server-side validation here is authoritative; any client-side pattern
// check is a UX convenience only.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return user;
}

export async function findUserById(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username.toLowerCase()))
    .limit(1);
  return user;
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const existing = await findUserByUsername(username);
  return existing !== undefined;
}

/**
 * Derives a valid, unique username from an email address — used when an
 * account is created without one being explicitly collected (magic-link
 * signup, D19: a brand-new user can sign up via magic link with no password
 * step at all, and now no username/visibleName step either). Normalizes to
 * the USERNAME_PATTERN shape and de-dupes with a numeric suffix, mirroring
 * the one-time SQL backfill migration's logic for pre-existing rows — the
 * user can rename their visibleName (not username) later from Account
 * settings.
 */
export async function generateUsernameFromEmail(email: string): Promise<string> {
  const localPart = email.split("@")[0] ?? "";
  let base = localPart
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
  if (base.length < 3) base = base.padEnd(3, "0");

  let candidate = base;
  let suffix = 1;
  while (await isUsernameTaken(candidate)) {
    suffix += 1;
    const suffixText = String(suffix);
    candidate = `${base.slice(0, Math.max(3, 20 - suffixText.length - 1))}_${suffixText}`;
  }
  return candidate;
}

export interface CreateUserInput {
  email: string;
  username: string;
  visibleName: string;
  passwordHash?: string;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      username: input.username.toLowerCase(),
      visibleName: input.visibleName,
      passwordHash: input.passwordHash,
    })
    .returning();
  if (!user) throw new Error("Failed to create user");
  return user;
}

export async function markEmailVerified(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function updatePassword(userId: string, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function updateVisibleName(userId: string, visibleName: string): Promise<void> {
  await db.update(users).set({ visibleName, updatedAt: new Date() }).where(eq(users.id, userId));
}

export interface UserDisplayInfo {
  userId: string;
  username: string;
  visibleName: string;
  email: string;
}

/**
 * Single shared identity-resolution utility (post-launch refinement pass) —
 * replaces what used to be ad hoc, per-caller email lookups scattered across
 * taskAssignees/comments/MembersPanel. Returns a Map so callers can look up
 * by userId directly; missing ids (e.g. a since-deleted user) are simply
 * absent from the map rather than throwing.
 */
export async function getUsersDisplayInfo(
  userIds: string[],
): Promise<Map<string, UserDisplayInfo>> {
  if (userIds.length === 0) return new Map();
  const uniqueIds = [...new Set(userIds)];
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      visibleName: users.visibleName,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, uniqueIds));

  const map = new Map<string, UserDisplayInfo>();
  for (const row of rows) {
    map.set(row.id, {
      userId: row.id,
      username: row.username,
      visibleName: row.visibleName,
      email: row.email,
    });
  }
  return map;
}
