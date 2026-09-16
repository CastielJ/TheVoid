import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { env } from "./config/env.js";
import { errorReporter } from "./errorReporting.js";
import { checkDatabaseConnection } from "./db/client.js";
import { appRouter } from "./routers/root.js";
import { createContext } from "./trpc.js";
import { registerCsrfProtection } from "./csrf.js";
import { registerRealtimeHandler } from "./realtime/handler.js";
// Registers the void/user-access-changed eviction listeners as a side
// effect of import (realtime/events.ts) — no separate "start" call needed.
import "./realtime/events.js";

/**
 * Builds (but does not start) the Fastify app. Kept separate from process
 * startup (see server.ts) so tests can build and exercise the app via
 * `app.inject()` without ever binding a port.
 *
 * Fastify is given its own logger config (mirroring logger.ts's settings)
 * rather than the shared `logger` instance directly — passing a standalone
 * pino instance via `loggerInstance` hits a real type-incompatibility
 * between pino's `Logger` type and Fastify's `FastifyBaseLogger` interface
 * (missing `msgPrefix`) that surfaces at typecheck time. `app.log` and the
 * module-level `logger` export end up configured identically either way.
 */
export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "test" ? "silent" : "info",
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    genReqId: () => crypto.randomUUID(),
  });

  // Session cookie parsing (domains/auth/cookies.ts) — no signing secret
  // needed here since the cookie value is itself an opaque, unguessable,
  // server-validated token (D25); signing would protect a value the client
  // isn't supposed to be able to construct meaningfully anyway.
  await app.register(fastifyCookie);

  registerCsrfProtection(app);

  await app.register(fastifyWebsocket);
  registerRealtimeHandler(app);

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ error, path }: { error: unknown; path?: string }) {
        errorReporter.captureException(error, { trpcPath: path });
      },
    },
  });

  app.get("/health", async () => {
    await checkDatabaseConnection();
    return { status: "ok" };
  });

  return app;
}
