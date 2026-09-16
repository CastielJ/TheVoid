import { test, expect, type Page } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @void/server's config/env.ts loads its own .env via `dotenv/config`,
// which resolves relative to process.cwd() — that's packages/server when
// its dev script runs it (pnpm --filter sets cwd to the target package),
// but packages/web when this spec file's own process runs it (`playwright
// test` is invoked with cwd = packages/web, which has no .env of its own).
// Loading it explicitly here, before the dynamic imports below, ensures
// DATABASE_URL/SESSION_SECRET are already set by the time config/env.ts's
// own (now-redundant) dotenv call runs — dotenv never overwrites existing
// process.env values, so there's no conflict either way.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../server/.env") });

// Deep relative imports into @void/server's own source (not its published
// type-only entry point, src/index.ts) — the same pattern the vitest
// integration suite uses for its own test helpers, just reached across a
// package boundary here. Dynamic (not static) so they evaluate after the
// dotenv.config() call above — static imports would be hoisted and
// evaluated before any of this file's own top-level statements, including
// that call, which would defeat the point. Node resolves each import
// relative to the file that declares it, so @void/server's own
// dependencies (pg) resolve correctly via packages/server/node_modules
// regardless of which package's test runner initiated the import —
// deliberately using the raw `pool` (plain SQL) rather than drizzle's query
// builder here, since the latter would require adding drizzle-orm as a
// direct dependency of @void/web just for this one lookup (pnpm's strict
// isolation, docs/decisions.md).
const { db, pool } = await import("../../server/src/db/client.js");
const { memberships } = await import("../../server/src/db/schema.js");
const { resetAuthTables, resetOrgTables } = await import("../../server/test/helpers/db.js");

/**
 * D60's critical-path journey, driven end-to-end through real UI for the
 * first time (implementation-plan.md §2 Phase 6) — with one deliberate
 * exception: the "invite member" step is seeded directly via the same
 * backend test helper pattern the vitest integration suite uses, not real
 * UI, because the email-invitation flow (D16) is Phase 7 scope. See
 * docs/decisions.md "Phase 6 Kickoff Notes" for the full resolution — this
 * is a tracked follow-up, to be replaced with a real UI step once Phase 7
 * ships. Every other step (signup, org, Team, Void, Group, Task, assign,
 * authorized access, unauthorized denial) is driven through the browser.
 */
test.beforeEach(async () => {
  await resetOrgTables();
  await resetAuthTables();
});

async function signup(page: Page, email: string): Promise<void> {
  await page.goto("/signup");
  await page.fill("#email", email);
  await page.fill("#password", "correct-horse-battery");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/orgs");
}

test("signup -> org -> invite(seeded) -> team -> void -> group -> task -> assign -> authorized access -> unauthorized denial", async ({
  browser,
}) => {
  const stamp = Date.now();
  const ownerEmail = `owner-${stamp}@example.com`;
  const memberEmail = `member-${stamp}@example.com`;
  const strangerEmail = `stranger-${stamp}@example.com`;

  // --- 1. signup (Owner) ----------------------------------------------------
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signup(ownerPage, ownerEmail);

  // --- 2. create org ----------------------------------------------------------
  await ownerPage.fill("#org-name", "Acme E2E");
  await ownerPage.click('button:has-text("Create")');
  await ownerPage.waitForURL("**/orgs/*");
  const orgId = new URL(ownerPage.url()).pathname.split("/").pop()!;
  await expect(ownerPage.getByRole("heading", { name: "Acme E2E" })).toBeVisible();

  // A second, independent user account — its own browser context/session.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await signup(memberPage, memberEmail);

  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();
  await signup(strangerPage, strangerEmail);

  // --- 3. invite (seeded — see module docstring) -------------------------------
  const {
    rows: [memberUser],
  } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [memberEmail]);
  await db
    .insert(memberships)
    .values({ organizationId: orgId, userId: memberUser!.id, role: "member" });

  // --- 4. create Team, add the member to it ------------------------------------
  await ownerPage.fill("#team-name", "Engineering");
  await ownerPage.click('button:has-text("Create Team")');
  await expect(ownerPage.getByTestId("team-name")).toHaveText("Engineering");
  await ownerPage.click('a:has-text("Manage")');
  await ownerPage.waitForURL("**/teams/*");
  await expect(ownerPage.getByLabel("Add organization member")).toContainText(memberEmail);
  await ownerPage.getByLabel("Add organization member").selectOption({ label: memberEmail });
  await ownerPage.click('button:has-text("Add")');
  await expect(ownerPage.getByText(memberEmail)).toBeVisible();

  // --- 5. create Void, associated with that Team (D14 default Team grant) -----
  await ownerPage.goto(`/orgs/${orgId}`);
  await ownerPage.fill("#void-name", "Product Roadmap");
  // team.list resolves asynchronously after mount — wait for the option to
  // actually exist before selecting it, rather than racing the fetch.
  await expect(ownerPage.getByLabel("Team (optional)")).toContainText("Engineering");
  await ownerPage.getByLabel("Team (optional)").selectOption({ label: "Engineering" });
  await ownerPage.click('button:has-text("Create Void")');
  await ownerPage.waitForURL("**/voids/*");
  const voidUrl = ownerPage.url();
  await ownerPage.waitForSelector('[data-testid="canvas-viewport"]');

  // --- 6. create a Group -------------------------------------------------------
  await ownerPage.click('button:has-text("+ Group")');
  await expect(ownerPage.locator('[data-testid="group-box"]')).toBeVisible();

  // --- 7. create a Task --------------------------------------------------------
  await ownerPage.click('button:has-text("+ Task")');
  await expect(ownerPage.locator('[data-testid="task-card"]')).toBeVisible();

  // --- 8. assign the Task to the member ----------------------------------------
  await ownerPage.dblclick('[data-testid="task-card"]');
  await ownerPage.waitForSelector('[data-testid="task-detail-panel"]');
  await expect(ownerPage.getByLabel("Assign someone")).toContainText(memberEmail);
  await ownerPage.getByLabel("Assign someone").selectOption({ label: memberEmail });
  await expect(
    ownerPage.locator('[data-testid="task-detail-panel"]').getByText(memberEmail),
  ).toBeVisible();

  // --- 9. authorized user (the member, via their Team's default grant) can access/edit it ---
  await memberPage.goto(voidUrl);
  await memberPage.waitForSelector('[data-testid="canvas-viewport"]');
  await expect(memberPage.locator('[data-testid="task-card"]')).toBeVisible();
  await memberPage.dblclick('[data-testid="task-card"]');
  await memberPage.waitForSelector('[data-testid="task-detail-panel"]');
  await memberPage.getByLabel("Status").selectOption("in_progress");
  await expect(memberPage.getByLabel("Status")).toHaveValue("in_progress");
  // The edit is live for the Owner too (D32), confirming it actually persisted server-side.
  await expect(ownerPage.getByLabel("Status")).toHaveValue("in_progress");

  // --- 10. unauthorized user cannot access it -----------------------------------
  await strangerPage.goto(voidUrl);
  await expect(strangerPage.getByText("You do not have access to this Void.")).toBeVisible();
});
