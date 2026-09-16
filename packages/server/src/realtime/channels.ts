import { logger } from "../logger.js";

/**
 * Minimal structural shape this module needs from a `ws` WebSocket instance
 * — deliberately not importing `ws`'s own types here. `@fastify/websocket`
 * depends on `ws` itself and Fastify route handlers get it inferred
 * automatically, but `ws` is not a direct dependency of @void/server, and
 * pnpm's strict isolation (docs/decisions.md, Phase 1 notes) means a direct
 * type import of a transitive dependency isn't reliably resolvable. A small
 * structural interface sidesteps that entirely.
 */
export interface RealtimeSocket {
  readyState: number;
  readonly OPEN: number;
  send(data: string, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
}

/**
 * One WebSocket channel per Void (`void:{voidId}`, architecture.md §5),
 * joined only after a permission check. A single connection holds at most
 * one active subscription at a time — the product model only ever has one
 * Void open on a User's canvas at once (Phase 6) — so subscribing again
 * simply moves the connection to the new channel.
 */
export interface Subscriber {
  socket: RealtimeSocket;
  userId: string;
  voidId: string;
}

const channels = new Map<string, Set<Subscriber>>();
const subscriptionBySocket = new Map<RealtimeSocket, Subscriber>();

export function subscribe(voidId: string, userId: string, socket: RealtimeSocket): Subscriber {
  unsubscribeSocket(socket);

  const subscriber: Subscriber = { socket, userId, voidId };
  let channel = channels.get(voidId);
  if (!channel) {
    channel = new Set();
    channels.set(voidId, channel);
  }
  channel.add(subscriber);
  subscriptionBySocket.set(socket, subscriber);
  return subscriber;
}

export function unsubscribeSocket(socket: RealtimeSocket): void {
  const subscriber = subscriptionBySocket.get(socket);
  if (!subscriber) return;

  const channel = channels.get(subscriber.voidId);
  channel?.delete(subscriber);
  if (channel && channel.size === 0) channels.delete(subscriber.voidId);
  subscriptionBySocket.delete(socket);
}

export function getSubscribersForVoid(voidId: string): Subscriber[] {
  return Array.from(channels.get(voidId) ?? []);
}

/** Scans every channel — fine at MVP connection-count scale (D59); revisit only if profiling says otherwise. */
export function getSubscriptionsForUser(userId: string): Subscriber[] {
  const result: Subscriber[] = [];
  for (const channel of channels.values()) {
    for (const subscriber of channel) {
      if (subscriber.userId === userId) result.push(subscriber);
    }
  }
  return result;
}

export function broadcastToVoid(voidId: string, message: unknown): void {
  const payload = JSON.stringify(message);
  for (const subscriber of getSubscribersForVoid(voidId)) {
    if (subscriber.socket.readyState === subscriber.socket.OPEN) {
      subscriber.socket.send(payload, (err) => {
        if (err) logger.warn({ err, voidId, userId: subscriber.userId }, "WebSocket send failed");
      });
    }
  }
}
