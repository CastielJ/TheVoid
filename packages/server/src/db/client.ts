import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";

/**
 * Single shared connection pool for the process. Phase 0 has no schema yet
 * (see db/schema.ts) — this module exists so the connection itself can be
 * verified (docs/implementation-plan.md Phase 0 milestone) before any
 * domain tables exist.
 */
export const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool);

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query("SELECT 1");
}
