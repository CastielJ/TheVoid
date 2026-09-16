import { useEffect, useRef } from "react";
import { trpc } from "../trpc/client";
import { useCanvasStore } from "../canvas/store";
import type { Task, Group } from "../trpc/types";

type ServerMessage =
  | { type: "subscribed"; voidId: string }
  | { type: "unsubscribed" }
  | { type: "error"; code?: string; message?: string; voidId?: string }
  | { type: "evicted"; voidId: string }
  | {
      type: "task.created" | "task.updated" | "task.moved";
      voidId: string;
      payload: Task;
    }
  | { type: "task.deleted"; voidId: string; payload: { taskId: string } }
  | { type: "group.created" | "group.updated"; voidId: string; payload: Group }
  | { type: "group.deleted"; voidId: string; payload: { groupId: string } }
  | { type: "void.deleted"; voidId: string; payload: { voidId: string } };

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000];

export interface VoidRealtimeCallbacks {
  onEvicted: () => void;
  onVoidDeleted: () => void;
  onForbidden: () => void;
}

/**
 * Owns the WebSocket lifecycle for the currently-open Void and keeps the
 * canvas store current (architecture.md §6/§6.1). Reconnect and initial
 * load share one code path deliberately: hydration only ever happens in
 * response to a "subscribed" ack, whether that's the first connection or a
 * reconnect after network loss — "discard and re-hydrate from a fresh
 * query," never an attempt to patch/merge.
 */
export function useVoidRealtime(voidId: string, callbacks: VoidRealtimeCallbacks): void {
  const utils = trpc.useUtils();
  const applyTask = useCanvasStore((s) => s.applyTask);
  const removeTask = useCanvasStore((s) => s.removeTask);
  const applyGroup = useCanvasStore((s) => s.applyGroup);
  const removeGroup = useCanvasStore((s) => s.removeGroup);
  const hydrate = useCanvasStore((s) => s.hydrate);
  const setConnectionStatus = useCanvasStore((s) => s.setConnectionStatus);

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let terminal = false;
    let hasConnectedBefore = false;

    async function handleSubscribed() {
      const [tasks, groups] = await Promise.all([
        utils.task.list.fetch({ voidId }),
        utils.group.list.fetch({ voidId }),
      ]);
      hydrate(voidId, tasks, groups);
      setConnectionStatus("connected");
      reconnectAttempt = 0;
    }

    function scheduleReconnect() {
      if (terminal) return;
      setConnectionStatus("reconnecting");
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    }

    function connect() {
      setConnectionStatus(hasConnectedBefore ? "reconnecting" : "connecting");
      socket = new WebSocket(wsUrl());

      socket.addEventListener("open", () => {
        hasConnectedBefore = true;
        socket?.send(JSON.stringify({ type: "subscribe", voidId }));
      });

      socket.addEventListener("message", (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as ServerMessage;
        switch (message.type) {
          case "subscribed":
            void handleSubscribed();
            return;
          case "error":
            if (message.code === "FORBIDDEN") {
              terminal = true;
              callbacksRef.current.onForbidden();
              socket?.close();
            }
            return;
          case "evicted":
            terminal = true;
            setConnectionStatus("evicted");
            callbacksRef.current.onEvicted();
            return;
          case "void.deleted":
            terminal = true;
            setConnectionStatus("evicted");
            callbacksRef.current.onVoidDeleted();
            return;
          case "task.created":
          case "task.updated":
          case "task.moved":
            applyTask(message.payload);
            return;
          case "task.deleted":
            removeTask(message.payload.taskId);
            return;
          case "group.created":
          case "group.updated":
            applyGroup(message.payload);
            return;
          case "group.deleted":
            removeGroup(message.payload.groupId);
            return;
        }
      });

      socket.addEventListener("close", () => {
        if (!terminal) scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        socket?.close();
      });
    }

    connect();

    return () => {
      terminal = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
    // utils/store setters are stable identities; only voidId should retrigger the connection.
  }, [voidId]);
}
