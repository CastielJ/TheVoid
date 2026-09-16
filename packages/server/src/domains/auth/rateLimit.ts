import { TRPCError } from "@trpc/server";
import { logger } from "../../logger.js";

/**
 * Rate limiting for auth-sensitive procedures (D29). Fastify-route-level
 * limiting on the single batched /trpc endpoint can't distinguish "login"
 * from "listSessions" in the same HTTP request, so this is implemented as
 * per-procedure tRPC middleware instead, keyed by (IP, procedure).
 *
 * In-memory, single-process (docs/decisions.md: same reasoning as D25's
 * explicit rejection of Redis "purely because sessions exist" — add shared
 * storage only if/when horizontal scaling actually requires it, not
 * preemptively). Fixed-window with a lockout period is a simpler MVP
 * substitute for full exponential backoff, still satisfying D29's
 * "temporary lockout after repeated failures" requirement.
 */
interface WindowState {
  count: number;
  windowResetAt: number;
}

const buckets = new Map<string, WindowState>();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export function checkRateLimit(key: string, options: RateLimitOptions): void {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.windowResetAt < now) {
    buckets.set(key, { count: 1, windowResetAt: now + options.windowMs });
    return;
  }

  existing.count += 1;
  if (existing.count > options.max) {
    const retryAfterSeconds = Math.ceil((existing.windowResetAt - now) / 1000);
    logger.warn({ key, count: existing.count }, "Rate limit exceeded");
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many attempts. Try again in ${retryAfterSeconds}s.`,
    });
  }
}

/**
 * Test-only escape hatch: the limiter is intentionally process-lifetime,
 * in-memory state (see module doc above), which is correct for production
 * but means it otherwise accumulates across every test file in one `vitest
 * run` process — since all requests share one fake IP via `app.inject()`,
 * later test files would spuriously hit earlier files' limits. Exported
 * here (not just usable via a private reset) so `test/helpers/db.ts` can
 * clear it alongside the DB between tests, keeping each test's rate-limit
 * window independent of run order.
 */
export function resetRateLimitState(): void {
  buckets.clear();
}

// Periodic cleanup so the map doesn't grow unbounded over a long-running process.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, state] of buckets) {
      if (state.windowResetAt < now) buckets.delete(key);
    }
  },
  10 * 60 * 1000,
).unref();
