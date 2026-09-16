import {
  createUser as createUserWithIdentity,
  generateUsernameFromEmail,
} from "../../src/domains/auth/users.js";
import type { User } from "../../src/db/schema.js";

/**
 * Test-only convenience wrapper — most integration tests only care about
 * having *a* valid User row to reference (as an owner/member/assignee/etc.),
 * not about exercising username/visibleName specifically, so this derives
 * both from the email the same way requestMagicLink's auto-create path does
 * (generateUsernameFromEmail), rather than requiring every one of the ~90
 * call sites across this test suite to spell out a username/visibleName
 * that they never actually assert on. Tests that DO care about identity
 * fields (signup flow, username uniqueness, display propagation) call the
 * real domain `createUser` directly with explicit values instead of this
 * helper.
 */
export async function createUser(email: string, passwordHash?: string): Promise<User> {
  const username = await generateUsernameFromEmail(email);
  const visibleName = email.split("@")[0] || "Test User";
  return createUserWithIdentity({ email, username, visibleName, passwordHash });
}
