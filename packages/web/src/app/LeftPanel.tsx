import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLeftPanel } from "./LeftPanelContext";
import { ThemeToggle } from "../ui/ThemeToggle";
import { VoidTree } from "../features/void/VoidTree";
import { getRecentVoids } from "./recentVoids";

const SHORTCUTS: [string, string][] = [
  ["W A S D", "Pan the canvas"],
  ["Scroll / pinch", "Zoom"],
  ["Shift + drag", "Box-select"],
  ["Double-click", "Create here"],
  ["Delete / Backspace", "Delete selection"],
  ["Ctrl/Cmd + C, V", "Copy, paste Tasks"],
];

/**
 * Second feature pass — the left panel's UI, rendered once at the App root
 * (see App.tsx) so it's reachable from every page, including CanvasPage
 * (which has its own header, not AppShell's). Content: theme toggle, recent
 * Voids, a static keyboard-shortcuts reference, and the Teams/Voids tree
 * (only when the current URL is inside an Organization's context).
 */
export function LeftPanel() {
  const { open, close } = useLeftPanel();
  const location = useLocation();
  const navigate = useNavigate();

  const organizationId = useMemo(() => {
    const match = location.pathname.match(/^\/orgs\/([^/]+)/);
    return match && match[1] !== "" ? match[1]! : null;
  }, [location.pathname]);

  const recentVoids = useMemo(() => (open ? getRecentVoids() : []), [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={close}
        className="void-fade-in"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.25)",
          zIndex: 40,
        }}
      />
      <aside
        className="void-panel-in-left"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: 300,
          background: "var(--color-surface)",
          borderRight: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 41,
          overflowY: "auto",
          padding: "16px 16px 24px",
          transformOrigin: "top left",
        }}
        role="complementary"
        aria-label="Void panel"
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Void</span>
          <button
            onClick={close}
            aria-label="Close panel"
            className="void-icon-btn"
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              fontSize: 18,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginTop: 8 }}>
          <ThemeToggle />
        </div>

        {recentVoids.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
                margin: "0 0 4px",
              }}
            >
              Recent
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {recentVoids.map((v) => (
                <button
                  key={v.voidId}
                  onClick={() => {
                    close();
                    navigate(`/orgs/${v.organizationId}/voids/${v.voidId}`);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--color-text-muted)",
                    fontSize: 12,
                    padding: "3px 0",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {organizationId && <VoidTree organizationId={organizationId} />}

        <div style={{ marginTop: 16 }}>
          <h3
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              color: "var(--color-text-muted)",
              margin: "0 0 4px",
            }}
          >
            Canvas shortcuts
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {SHORTCUTS.map(([keys, desc]) => (
              <div
                key={keys}
                style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}
              >
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text)" }}>
                  {keys}
                </span>
                <span style={{ color: "var(--color-text-muted)" }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
