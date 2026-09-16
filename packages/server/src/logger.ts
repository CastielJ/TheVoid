import pino from "pino";
import { env } from "./config/env.js";

/**
 * Structured logging from Phase 0 onward (docs/decisions.md D61). Every
 * request-scoped log line should be built via `logger.child({ requestId,
 * userId, organizationId })` (docs/implementation-plan.md §10) once those
 * identifiers exist (starting Phase 1/2) — this base logger has no request
 * context yet since no requests carry identity in Phase 0.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
