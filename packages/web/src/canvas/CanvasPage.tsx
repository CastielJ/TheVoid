import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { trpc } from "../trpc/client";
import { useVoidRealtime } from "../realtime/useVoidRealtime";
import { useCanvasStore } from "./store";
import { CanvasViewport } from "./CanvasViewport";
import { CanvasCreationPanel } from "./CanvasCreationPanel";
import { Button } from "../ui/Button";
import { FullPageStatus } from "../app/ProtectedRoute";
import { useLeftPanel } from "../app/LeftPanelContext";
import { recordVoidVisit } from "../app/recentVoids";

const STATUS_LABEL: Record<string, string> = {
  connecting: "Connecting…",
  connected: "",
  reconnecting: "Reconnecting…",
  evicted: "",
  deleted: "",
};

export function CanvasPage() {
  const { orgId, voidId } = useParams<{ orgId: string; voidId: string }>();
  if (!orgId || !voidId) throw new Error("orgId and voidId params are required");
  const navigate = useNavigate();
  const location = useLocation();
  const focusState = location.state as
    { focusX?: number; focusY?: number; focusTaskId?: string } | null | undefined;

  const [terminalMessage, setTerminalMessage] = useState<string | null>(null);
  // Page-local state, deliberately not in the Zustand canvas store — the
  // store holds shared/synced object state, not transient per-visit UI state.
  const [creationRequest, setCreationRequest] = useState<{
    world: { x: number; y: number };
    screen: { x: number; y: number };
  } | null>(null);

  const onEvicted = useCallback(
    () => setTerminalMessage("Your access to this Void was revoked."),
    [],
  );
  const onVoidDeleted = useCallback(() => setTerminalMessage("This Void was deleted."), []);
  const onForbidden = useCallback(
    () => setTerminalMessage("You do not have access to this Void."),
    [],
  );

  useVoidRealtime(voidId, { onEvicted, onVoidDeleted, onForbidden });

  const connectionStatus = useCanvasStore((s) => s.connectionStatus);
  const setCamera = useCanvasStore((s) => s.setCamera);

  const savedCamera = trpc.void.getCamera.useQuery({ voidId });
  useEffect(() => {
    if (savedCamera.data) {
      setCamera({ x: savedCamera.data.x, y: savedCamera.data.y, zoom: savedCamera.data.zoom });
    }
    // Only apply once, when the saved value first arrives — afterward the
    // camera is owned by user interaction, not this query. Deliberately
    // depends on savedCamera.data alone, not setCamera (a stable Zustand
    // setter identity).
  }, [savedCamera.data]);

  const voidInfo = trpc.void.get.useQuery({ voidId });
  // Third feature pass — breadcrumb for a nested Void ("Team"); empty array
  // for a top-level Void, in which case the breadcrumb is just this Void's
  // own name with nothing ahead of it.
  const ancestors = trpc.void.getAncestors.useQuery({ voidId });
  const { toggle } = useLeftPanel();

  useEffect(() => {
    if (voidInfo.data) {
      recordVoidVisit({ voidId, organizationId: orgId, name: voidInfo.data.name });
    }
  }, [voidInfo.data, voidId, orgId]);

  // Jump-to-object navigation (D43 search, D44 My Tasks) used to open the
  // now-removed side panel; it now expands the Task inline instead, once
  // it's actually present in the hydrated store (may not be on the very
  // first render).
  const tasks = useCanvasStore((s) => s.tasks);
  const appliedFocusTaskId = useRef<string | null>(null);
  useEffect(() => {
    const focusTaskId = focusState?.focusTaskId;
    if (!focusTaskId || appliedFocusTaskId.current === focusTaskId) return;
    if (!tasks.has(focusTaskId)) return;
    appliedFocusTaskId.current = focusTaskId;
    useCanvasStore.getState().toggleExpanded(focusTaskId);
  }, [focusState?.focusTaskId, tasks]);

  if (terminalMessage) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "var(--canvas-bg)",
          color: "var(--canvas-text)",
        }}
      >
        <p>{terminalMessage}</p>
        <Button onClick={() => navigate(`/orgs/${orgId}`)}>Back to organization</Button>
      </div>
    );
  }

  if (connectionStatus === "connecting") return <FullPageStatus text="Loading Void…" />;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          height: 48,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          background: "var(--canvas-surface)",
          borderBottom: "1px solid var(--canvas-border)",
          color: "var(--canvas-text)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={toggle}
            aria-label="Open panel"
            className="void-icon-btn"
            style={{
              background: "none",
              border: "none",
              color: "var(--canvas-text-muted)",
              fontSize: 16,
              padding: 4,
            }}
          >
            ☰
          </button>
          <Button variant="ghost" onClick={() => navigate(`/orgs/${orgId}`)}>
            ←
          </Button>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 14,
              minWidth: 0,
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {ancestors.data?.map((a) => (
              <span key={a.id} style={{ display: "contents" }}>
                <button
                  onClick={() => navigate(`/orgs/${orgId}/voids/${a.id}`)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--canvas-text-muted)",
                    fontSize: 14,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {a.name}
                </button>
                <span style={{ color: "var(--canvas-text-muted)" }}>/</span>
              </span>
            ))}
            <span style={{ fontWeight: 500 }}>{voidInfo.data?.name ?? "Void"}</span>
          </div>
          {STATUS_LABEL[connectionStatus] && (
            <span style={{ fontSize: 12, color: "var(--canvas-text-muted)" }}>
              {STATUS_LABEL[connectionStatus]}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 12, color: "var(--canvas-text-muted)" }}>
            Double-click anywhere to create
          </span>
          <button
            onClick={() => navigate(`/orgs/${orgId}/voids/${voidId}/settings`)}
            aria-label="Void settings"
            className="void-icon-btn"
            style={{
              background: "none",
              border: "none",
              color: "var(--canvas-text-muted)",
              fontSize: 16,
              padding: 4,
            }}
          >
            ⚙
          </button>
        </div>
      </header>

      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <CanvasViewport
          voidId={voidId}
          onBackgroundDoubleClick={(world, screen) => {
            setCreationRequest({ world, screen });
          }}
          focusTarget={
            focusState?.focusX !== undefined && focusState.focusY !== undefined
              ? { x: focusState.focusX, y: focusState.focusY }
              : null
          }
        />
        {creationRequest && (
          <CanvasCreationPanel
            voidId={voidId}
            worldPosition={creationRequest.world}
            screenPosition={creationRequest.screen}
            onClose={() => setCreationRequest(null)}
          />
        )}
      </div>
    </div>
  );
}
