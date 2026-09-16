import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { trpc } from "../trpc/client";
import { useVoidRealtime } from "../realtime/useVoidRealtime";
import { useCanvasStore } from "./store";
import { CanvasViewport } from "./CanvasViewport";
import { TaskDetailPanel } from "./TaskDetailPanel";
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
  const applyTask = useCanvasStore((s) => s.applyTask);
  const applyGroup = useCanvasStore((s) => s.applyGroup);

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

  const createTask = trpc.task.create.useMutation({ onSuccess: (t) => applyTask(t) });
  const createGroup = trpc.group.create.useMutation({ onSuccess: (g) => applyGroup(g) });

  function handleAddTask() {
    const { camera } = useCanvasStore.getState();
    createTask.mutate({ voidId: voidId!, title: "New Task", x: camera.x + 80, y: camera.y + 80 });
  }

  function handleAddGroup() {
    const { camera } = useCanvasStore.getState();
    createGroup.mutate({
      voidId: voidId!,
      name: "New Group",
      x: camera.x + 60,
      y: camera.y + 60,
      width: 320,
      height: 220,
    });
  }

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
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={handleAddGroup}>
            + Group
          </Button>
          <Button onClick={handleAddTask}>+ Task</Button>
        </div>
      </header>

      <div style={{ position: "relative", flex: 1 }}>
        <CanvasViewport
          voidId={voidId}
          onOpenTask={setOpenTaskId}
          focusTarget={
            focusState?.focusX !== undefined && focusState.focusY !== undefined
              ? { x: focusState.focusX, y: focusState.focusY }
              : null
          }
        />
        {openTaskId && <TaskDetailPanel taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
      </div>
    </div>
  );
}
