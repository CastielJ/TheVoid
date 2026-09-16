import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { errorReporter } from "./errorReporting.js";

/**
 * The actual process entrypoint (dev/start scripts point here, not at
 * app.ts) — keeps "build the app" (app.ts, imported by tests) separate from
 * "run the app as a listening process" (this file, never imported by tests).
 */
async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    logger.info(`Server listening on port ${env.PORT}`);
  } catch (err) {
    errorReporter.captureException(err);
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

void main();
