import { useToastStore, type ToastVariant } from "./toastStore";

const variantBackground: Record<ToastVariant, string> = {
  error: "var(--color-danger)",
  info: "var(--color-surface-raised)",
  success: "var(--color-success)",
};

const variantColor: Record<ToastVariant, string> = {
  error: "#fff",
  info: "var(--color-text)",
  success: "#fff",
};

/**
 * Mounted once at the app root (App.tsx) — reachable from every route,
 * including CanvasPage, which renders its own header instead of AppShell.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismissToast = useToastStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 1000,
        maxWidth: 360,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="void-fade-in"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: variantBackground[t.variant],
            color: variantColor[t.variant],
            fontSize: 13,
            boxShadow: "var(--shadow-md)",
          }}
        >
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="void-icon-btn"
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              fontSize: 14,
              flexShrink: 0,
              opacity: 0.85,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
