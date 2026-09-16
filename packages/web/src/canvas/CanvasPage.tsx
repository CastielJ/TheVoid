import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { trpc } from "../trpc/client";
import { useVoidRealtime } from "../realtime/useVoidRealtime";
import { useCanvasStore } from "./store";
import { CanvasViewport } from "./CanvasViewport";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { GroupDetailPanel } from "./GroupDetailPanel";
import { CanvasCreationPanel } from "./CanvasCreationPanel";
import { Button } from "../ui/Button";
import { FullPageStatus } from "../app/ProtectedRoute";

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
  const [openTaskId, setOpenTaskId] = useState<string | null>(focusState?.focusTaskId ?? null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  // Page-local state, deliberately not in the Zustand canvas store — same
  // reasoning as openTaskId/openGroupId above (the store holds shared/
  // synced object state, not transient UI panel state).
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
          <Button variant="ghost" onClick={() => navigate(`/orgs/${orgId}`)}>
            ←
          </Button>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{voidInfo.data?.name ?? "Void"}</span>
          {STATUS_LABEL[connectionStatus] && (
            <span style={{ fontSize: 12, color: "var(--canvas-text-muted)" }}>
              {STATUS_LABEL[connectionStatus]}
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: "var(--canvas-text-muted)" }}>
          Double-click anywhere to create
        </span>
      </header>

      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <CanvasViewport
          voidId={voidId}
          onOpenTask={(taskId) => {
            setOpenGroupId(null);
            setCreationRequest(null);
            setOpenTaskId(taskId);
          }}
          onOpenGroup={(groupId) => {
            setOpenTaskId(null);
            setCreationRequest(null);
            setOpenGroupId(groupId);
          }}
          onBackgroundDoubleClick={(world, screen) => {
            setOpenTaskId(null);
            setOpenGroupId(null);
            setCreationRequest({ world, screen });
          }}
          focusTarget={
            focusState?.focusX !== undefined && focusState.focusY !== undefined
              ? { x: focusState.focusX, y: focusState.focusY }
              : null
          }
        />
        {openTaskId && <TaskDetailPanel taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
        {openGroupId && (
          <GroupDetailPanel groupId={openGroupId} onClose={() => setOpenGroupId(null)} />
        )}
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
