import type { FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { SESSION_COOKIE_NAME } from "../config/auth.js";
import { validateSession } from "../domains/auth/sessions.js";
import { canAccessVoid } from "../authorization/capabilities.js";
import { isAllowedOrigin } from "../csrf.js";
import { subscribe, unsubscribeSocket, type RealtimeSocket } from "./channels.js";
import { logger } from "../logger.js";

// Close codes in the 4000-4999 application-defined range.
const CLOSE_ORIGIN_NOT_ALLOWED = 4003;
const CLOSE_UNAUTHENTICATED = 4001;

interface ClientMessage {
  type: "subscribe" | "unsubscribe";
  voidId?: string;
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as Record<string, unknown>).type;
  return type === "subscribe" || type === "unsubscribe";
}

async function handleClientMessage(
  socket: RealtimeSocket,
  userId: string,
  data: Buffer | string,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    socket.send(JSON.stringify({ type: "error", message: "Invalid message." }));
    return;
  }
  if (!isClientMessage(parsed)) {
    socket.send(JSON.stringify({ type: "error", message: "Invalid message type." }));
    return;
  }

  if (parsed.type === "unsubscribe") {
    unsubscribeSocket(socket);
    socket.send(JSON.stringify({ type: "unsubscribed" }));
    return;
  }

  // subscribe (D34): re-checks the current Void-level permission at
  // subscribe time, not just at connection/login — the same check that
  // runs on every reconnect (ID13) runs here identically.
  const voidId = parsed.voidId;
  if (!voidId) {
    socket.send(JSON.stringify({ type: "error", message: "voidId is required." }));
    return;
  }
  const allowed = await canAccessVoid(userId, voidId);
  if (!allowed) {
    socket.send(JSON.stringify({ type: "error", code: "FORBIDDEN", voidId }));
    return;
  }

  subscribe(voidId, userId, socket);
  socket.send(JSON.stringify({ type: "subscribed", voidId }));
}

/**
 * Registers the `/ws` route. Session/permission auth happens here, not via
 * Fastify hooks, since browsers' native WebSocket API can't set custom
 * headers — cookies are all we have, and checking them post-upgrade
 * (closing on failure) is the standard pattern for WS auth. The cookie
 * header is parsed directly via `@fastify/cookie`'s own `parse` export
 * rather than reading the `request.cookies` decorator that plugin sets up
 * for ordinary HTTP requests — that decorator is populated by an onRequest
 * hook, and this route's upgrade request doesn't reliably go through the
 * same hook chain, so parsing the raw header here is both simpler and more
 * robust than depending on hook-ordering for a WS route. Origin is checked
 * for the same reason the HTTP CSRF hook exists (csrf.ts) but doesn't
 * itself cover this route (a WS upgrade is a GET request, which that hook
 * intentionally skips).
 */
export function registerRealtimeHandler(app: FastifyInstance): void {
  app.get("/ws", { websocket: true }, (socket, request) => {
    // Registered synchronously, before any `await` below, so a message the
    // client sends immediately after connecting can never race ahead of
    // this listener and be silently dropped while the async auth check
    // (a real DB round-trip via validateSession) is still in flight —
    // messages that arrive before authentication completes are queued and
    // flushed once it does.
    let userId: string | null = null;
    let closed = false;
    const pendingMessages: (Buffer | string)[] = [];

    socket.on("message", (data: Buffer | string) => {
      if (userId === null) {
        pendingMessages.push(data);
        return;
      }
      handleClientMessage(socket, userId, data).catch((err: unknown) => {
        logger.error({ err }, "Error handling WebSocket message");
      });
    });

    socket.on("close", () => {
      closed = true;
      unsubscribeSocket(socket);
    });

    socket.on("error", (err: Error) => {
      logger.warn({ err }, "WebSocket connection error");
      unsubscribeSocket(socket);
    });

    void (async () => {
      try {
        if (!isAllowedOrigin(request.headers.origin)) {
          socket.close(CLOSE_ORIGIN_NOT_ALLOWED, "Origin not allowed");
          return;
        }

        const cookies = fastifyCookie.parse(request.headers.cookie ?? "");
        const rawToken = cookies[SESSION_COOKIE_NAME];
        const session = rawToken ? await validateSession(rawToken) : null;
        if (!session) {
          socket.close(CLOSE_UNAUTHENTICATED, "Unauthenticated");
          return;
        }
        if (closed) return; // connection dropped while the DB round-trip was in flight

        userId = session.user.id;
        for (const data of pendingMessages.splice(0)) {
          await handleClientMessage(socket, userId, data);
        }
      } catch (err) {
        logger.error({ err }, "Error establishing WebSocket connection");
        socket.close(1011, "Internal error");
      }
    })();
  });
}
