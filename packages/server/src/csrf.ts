import type { FastifyInstance } from "fastify";
import { env } from "./config/env.js";

/**
 * CSRF protection (docs/decisions.md ID9): SameSite=Lax session cookies
 * (domains/auth/cookies.ts) plus strict Origin-header validation on all
 * state-changing requests — not a separate CSRF token system. There's no
 * cross-origin form-post surface (tRPC traffic is same-origin fetch/
 * WebSocket only), so this is sufficient without token issuance/rotation.
 */
const allowedOrigins = new Set(
  env.CLIENT_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

export function isAllowedOrigin(origin: string | undefined): boolean {
  return origin !== undefined && allowedOrigins.has(origin);
}

export function registerCsrfProtection(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
      return;
    }

    if (!isAllowedOrigin(request.headers.origin)) {
      reply.code(403).send({ error: "Origin not allowed" });
    }
  });
}
