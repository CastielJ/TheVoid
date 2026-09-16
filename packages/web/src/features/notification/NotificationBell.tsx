import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../../trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@void/server";

type Notification = inferRouterOutputs<AppRouter>["notification"]["list"][number];

const POLL_INTERVAL_MS = 30_000;

/**
 * D40: in-app inbox/bell only, no push/email for general notifications.
 * Polled rather than pushed over the existing WebSocket — that channel is
 * scoped to one open Void's Task/Group events (D32); notifications are
 * cross-Void and user-scoped, a different concern not worth widening the
 * realtime protocol for for an MVP inbox.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const unread = trpc.notification.countUnread.useQuery(undefined, {
    refetchInterval: POLL_INTERVAL_MS,
  });
  const list = trpc.notification.list.useQuery(undefined, { enabled: open });
  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      utils.notification.countUnread.invalidate();
      utils.notification.list.invalidate();
    },
  });
  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.countUnread.invalidate();
      utils.notification.list.invalidate();
    },
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(notification: Notification) {
    if (!notification.readAt) markRead.mutate({ notificationId: notification.id });
    setOpen(false);
    const payload = notification.payload as Record<string, unknown>;
    if (
      (notification.type === "task_assigned" || notification.type === "mentioned") &&
      typeof payload.voidId === "string" &&
      typeof payload.organizationId === "string"
    ) {
      navigate(`/orgs/${payload.organizationId}/voids/${payload.voidId}`, {
        state: { focusTaskId: payload.taskId },
      });
      return;
    }
    if (
      (notification.type === "invited" || notification.type === "role_changed") &&
      typeof payload.organizationId === "string"
    ) {
      navigate(`/orgs/${payload.organizationId}`);
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        style={{
          position: "relative",
          background: "none",
          border: "none",
          fontSize: 18,
          cursor: "pointer",
          padding: 4,
        }}
      >
        🔔
        {Boolean(unread.data) && unread.data! > 0 && (
          <span
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              background: "var(--color-danger)",
              color: "#fff",
              borderRadius: "50%",
              fontSize: 10,
              lineHeight: "16px",
              minWidth: 16,
              height: 16,
              textAlign: "center",
              padding: "0 3px",
            }}
          >
            {unread.data}
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            width: 320,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            maxHeight: 400,
            overflowY: "auto",
            zIndex: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 12px",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>Notifications</span>
            <button
              onClick={() => markAllRead.mutate()}
              style={{
                background: "none",
                border: "none",
                fontSize: 12,
                color: "var(--color-accent-hover)",
              }}
            >
              Mark all read
            </button>
          </div>
          {list.data?.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, color: "var(--color-text-muted)" }}>
              No notifications yet.
            </div>
          )}
          {list.data?.map((n) => (
            <button
              key={n.id}
              onClick={() => handleSelect(n)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                background: n.readAt ? "none" : "var(--color-bg)",
                border: "none",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <div style={{ fontSize: 13 }}>{describeNotification(n)}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                {new Date(n.createdAt).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function describeNotification(n: Notification): string {
  switch (n.type) {
    case "task_assigned":
      return "You were assigned a Task.";
    case "mentioned":
      return "You were mentioned in a comment.";
    case "invited":
      return "You were invited to an Organization.";
    case "role_changed":
      return "Your role changed.";
    default:
      return "New notification.";
  }
}
