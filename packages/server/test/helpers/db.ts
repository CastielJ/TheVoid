import { sql } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { resetRateLimitState } from "../../src/domains/auth/rateLimit.js";

/**
 * Test isolation: truncate identity tables between tests (void_test DB
 * only), and clear the in-memory rate limiter (rateLimit.ts) — it's
 * process-lifetime state by design, so without this, later test files would
 * spuriously trip earlier files' limits since every `app.inject()` request
 * shares one fake IP.
 */
export async function resetAuthTables(): Promise<void> {
  resetRateLimitState();
  await db.execute(
    sql`TRUNCATE TABLE users, sessions, auth_tokens, totp_backup_codes RESTART IDENTITY CASCADE`,
  );
}

/**
 * Test isolation for Phase 2 (Organizations/Teams/Membership), Phase 3
 * (Voids/Groups/Access Grants), Phase 4 (Tasks), and Phase 7 (Invitations,
 * Notifications) — most of these always cascade from Organization/Team/User
 * anyway, but are listed explicitly for clarity, consistent with this
 * file's existing style.
 */
export async function resetOrgTables(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE organizations, memberships, teams, team_memberships, audit_logs, voids, void_access_grants, groups, tasks, task_assignees, checklist_items, comments, task_activities, invitations, notifications RESTART IDENTITY CASCADE`,
  );
}
