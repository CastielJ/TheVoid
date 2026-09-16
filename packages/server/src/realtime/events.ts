import { EventEmitter } from "node:events";
import { canAccessVoid } from "../authorization/capabilities.js";
import {
  getSubscribersForVoid,
  getSubscriptionsForUser,
  unsubscribeSocket,
  type Subscriber,
} from "./channels.js";
import { logger } from "../logger.js";

/**
 * WebSocket permission-eviction mechanism (ID10): event-driven, not polled.
 * An in-process event emitter is sufficient at MVP scale (single Node
 * process, D51) — no external message bus.
 */
const realtimeEvents = new EventEmitter();

/**
 * Emitted whenever a `VoidAccessGrant` for this Void changes (grant or
 * revoke) or the Void itself is deleted — anything that could have reduced
 * someone's access to it.
 */
export function emitVoidAccessChanged(voidId: string): void {
  realtimeEvents.emit("void-access-changed", voidId);
}

/**
 * Emitted whenever a User's Organization Membership changes in a way that
 * could affect their access to *any* Void — currently, member removal
 * (D17). Broader than emitVoidAccessChanged because removing a member can
 * invalidate access across every Void they held a direct grant on at once
 * (the Phase 4 getVoidRole fix — docs/decisions.md — means Membership
 * status now affects every Void's access resolution, not just grants
 * themselves), and enumerating every affected voidId ahead of time isn't
 * worth it versus just re-checking this user's actual live subscriptions.
 */
export function emitUserAccessChanged(userId: string): void {
  realtimeEvents.emit("user-access-changed", userId);
}

async function evictIfNoLongerAllowed(subscriber: Subscriber): Promise<void> {
  const stillAllowed = await canAccessVoid(subscriber.userId, subscriber.voidId);
  if (stillAllowed) return;

  unsubscribeSocket(subscriber.socket);
  if (subscriber.socket.readyState === subscriber.socket.OPEN) {
    subscriber.socket.send(JSON.stringify({ type: "evicted", voidId: subscriber.voidId }));
    subscriber.socket.close();
  }
  logger.info(
    { userId: subscriber.userId, voidId: subscriber.voidId },
    "WebSocket subscriber evicted",
  );
}

realtimeEvents.on("void-access-changed", (voidId: string) => {
  for (const subscriber of getSubscribersForVoid(voidId)) {
    evictIfNoLongerAllowed(subscriber).catch((err: unknown) => {
      logger.error({ err, voidId }, "Error evicting WebSocket subscriber (void-access-changed)");
    });
  }
});

realtimeEvents.on("user-access-changed", (userId: string) => {
  for (const subscriber of getSubscriptionsForUser(userId)) {
    evictIfNoLongerAllowed(subscriber).catch((err: unknown) => {
      logger.error({ err, userId }, "Error evicting WebSocket subscriber (user-access-changed)");
    });
  }
});
