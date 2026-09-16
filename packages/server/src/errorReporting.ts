import { logger } from "./logger.js";
import { env } from "./config/env.js";

/**
 * Provider-agnostic error-reporting interface, mirroring the EmailSender
 * pattern (docs/architecture.md §2 / decisions.md ID12): domain code never
 * imports a vendor SDK directly. The concrete provider (Sentry or
 * equivalent, per D61) is intentionally not wired in yet — no account/DSN
 * exists. This no-op-to-log implementation is swapped for a real Sentry (or
 * equivalent) adapter at deployment-preparation time, alongside the hosting
 * and email-provider choices (both also open per decisions.md).
 */
export interface ErrorReporter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
}

class LoggingErrorReporter implements ErrorReporter {
  captureException(error: unknown, context?: Record<string, unknown>): void {
    logger.error({ err: error, ...context }, "Unhandled error captured");
  }
}

// SENTRY_DSN is validated as optional in env.ts; when unset (local dev,
// and currently everywhere, since no Sentry project exists yet) we fall
// back to logging only, rather than failing to start.
export const errorReporter: ErrorReporter = new LoggingErrorReporter();

if (!env.SENTRY_DSN) {
  logger.warn(
    "SENTRY_DSN is not set — errors will be logged locally only, not sent to an error-tracking service. " +
      "This is expected until a Sentry (or equivalent) project is created (docs/decisions.md, hosting/vendor items).",
  );
}
