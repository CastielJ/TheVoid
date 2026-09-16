import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 6 (docs/implementation-plan.md §2): Tier-3 critical-path E2E only
 * (D60) — not exhaustive canvas-interaction coverage. Spins up the real
 * Fastify server and Vite dev server against the same Postgres database the
 * vitest integration suite uses (packages/server/.env has no separate test
 * database — see packages/server/vitest.config.ts's own comment on this);
 * each test resets its own data via the same truncate-based helpers the
 * integration tests use, so this is consistent with the existing project
 * convention, not a new one.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @void/server dev",
      url: "http://localhost:3000/trpc/ping",
      cwd: "..",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @void/web dev",
      url: "http://localhost:5173",
      cwd: "..",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
