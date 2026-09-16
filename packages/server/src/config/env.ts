import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SENTRY_DSN: z.string().optional().default(""),
  // Origin-header validation for CSRF protection (docs/decisions.md ID9) —
  // no separate CSRF token; state-changing requests must come from exactly
  // this origin. Comma-separated to allow web dev server + same-origin prod.
  CLIENT_ORIGINS: z.string().default("http://localhost:5173"),
});

/**
 * Validated once at process start. Fails fast with a clear error instead of
 * letting an unset/malformed env var surface as a confusing runtime error
 * later (e.g. deep inside a DB call).
 */
export const env = envSchema.parse(process.env);
export type Env = typeof env;
