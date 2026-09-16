import { useRef } from "react";
import { trpc } from "../trpc/client";
import { useCanvasStore } from "./store";
import type { Task } from "../trpc/types";

const DRAG_THRESHOLD_PX = 3;

export function TaskCard({
  task,
  zoom,
  onOpen,
}: {
  task: Task;
  zoom: number;
  onOpen: (taskId: string) => void;
}) {
  const isSelected = useCanvasStore((s) => s.isSelected("task", task.id));
  const select = useCanvasStore((s) => s.select);
  const setLocalPosition = useCanvasStore((s) => s.setLocalPosition);
  const applyTask = useCanvasStore((s) => s.applyTask);
  const move = trpc.task.move.useMutation({ onSuccess: (updated) => applyTask(updated) });

  const dragState = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    startWorldX: number;
    startWorldY: number;
    moved: boolean;
  } | null>(null);

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = {
      pointerId: e.pointerId,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startWorldX: task.x,
      startWorldY: task.y,
      moved: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = (e.clientX - drag.startScreenX) / zoom;
    const dy = (e.clientY - drag.startScreenY) / zoom;
    if (
      !drag.moved &&
      Math.hypot(e.clientX - drag.startScreenX, e.clientY - drag.startScreenY) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    drag.moved = true;
    setLocalPosition("task", task.id, drag.startWorldX + dx, drag.startWorldY + dy);
  }

  function handlePointerUp(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragState.current = null;
    if (drag.moved) {
      const current = useCanvasStore.getState().tasks.get(task.id);
      if (current) move.mutate({ taskId: task.id, x: current.x, y: current.y });
    } else {
      select({ kind: "task", id: task.id }, e.shiftKey);
    }
  }

  return (
    <div
      data-testid="task-card"
      data-task-id={task.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpen(task.id);
      }}
      style={{
        position: "absolute",
        left: task.x,
        top: task.y,
        width: 220,
        minHeight: 96,
        background: "var(--canvas-surface)",
        border: `1px solid ${isSelected ? "var(--canvas-selection-border)" : "var(--canvas-border)"}`,
        boxShadow: isSelected ? "0 0 0 3px var(--canvas-selection)" : "var(--shadow-sm)",
        borderRadius: "var(--radius-md)",
        padding: 12,
        color: "var(--canvas-text)",
        cursor: "grab",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{task.title}</span>
        {task.priority && (
          <span
            title={task.priority}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              marginTop: 4,
              background: `var(--color-priority-${task.priority})`,
            }}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: `var(--color-status-${task.status})`,
            fontWeight: 500,
          }}
        >
          {task.status.replace("_", " ")}
        </span>
        {task.dueDate && (
          <span style={{ fontSize: 11, color: "var(--canvas-text-muted)" }}>{task.dueDate}</span>
        )}
      </div>
    </div>
  );
}
