import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE_NAME } from "../../config/auth.js";
import { env } from "../../config/env.js";

export function setSessionCookie(reply: FastifyReply, rawToken: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax", // paired with Origin-header validation, not a CSRF token (ID9)
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

export function getSessionCookie(req: FastifyRequest): string | undefined {
  return req.cookies[SESSION_COOKIE_NAME];
}
