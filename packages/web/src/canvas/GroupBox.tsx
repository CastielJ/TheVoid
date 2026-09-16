import { useRef } from "react";
import { trpc } from "../trpc/client";
import { useCanvasStore } from "./store";
import type { Group } from "../trpc/types";

const MIN_SIZE = 80;

export function GroupBox({
  group,
  zoom,
  onOpen,
}: {
  group: Group;
  zoom: number;
  onOpen: (groupId: string) => void;
}) {
  const isSelected = useCanvasStore((s) => s.isSelected("group", group.id));
  const select = useCanvasStore((s) => s.select);
  const setLocalPosition = useCanvasStore((s) => s.setLocalPosition);
  const applyGroup = useCanvasStore((s) => s.applyGroup);
  const update = trpc.group.update.useMutation({ onSuccess: (updated) => applyGroup(updated) });

  const dragState = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    startWorldX: number;
    startWorldY: number;
    moved: boolean;
  } | null>(null);
  const resizeState = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = {
      pointerId: e.pointerId,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startWorldX: group.x,
      startWorldY: group.y,
      moved: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = (e.clientX - drag.startScreenX) / zoom;
    const dy = (e.clientY - drag.startScreenY) / zoom;
    if (!drag.moved && Math.hypot(e.clientX - drag.startScreenX, e.clientY - drag.startScreenY) < 3)
      return;
    drag.moved = true;
    setLocalPosition("group", group.id, drag.startWorldX + dx, drag.startWorldY + dy);
  }

  function handlePointerUp(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragState.current = null;
    if (drag.moved) {
      const current = useCanvasStore.getState().groups.get(group.id);
      if (current) update.mutate({ groupId: group.id, x: current.x, y: current.y });
    } else {
      select({ kind: "group", id: group.id }, e.shiftKey);
    }
  }

  function handleResizeDown(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    resizeState.current = {
      pointerId: e.pointerId,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startWidth: group.width,
      startHeight: group.height,
    };
  }

  function handleResizeMove(e: React.PointerEvent) {
    const resize = resizeState.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    const dx = (e.clientX - resize.startScreenX) / zoom;
    const dy = (e.clientY - resize.startScreenY) / zoom;
    const width = Math.max(MIN_SIZE, resize.startWidth + dx);
    const height = Math.max(MIN_SIZE, resize.startHeight + dy);
    applyGroup({ ...group, width, height });
  }

  function handleResizeUp(e: React.PointerEvent) {
    const resize = resizeState.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    resizeState.current = null;
    const current = useCanvasStore.getState().groups.get(group.id);
    if (current) update.mutate({ groupId: group.id, width: current.width, height: current.height });
  }

  return (
    <div
      data-testid="group-box"
      data-group-id={group.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpen(group.id);
      }}
      style={{
        position: "absolute",
        left: group.x,
        top: group.y,
        width: group.width,
        height: group.height,
        border: `1.5px dashed ${isSelected ? "var(--canvas-selection-border)" : "var(--canvas-border-strong)"}`,
        borderRadius: "var(--radius-lg)",
        background: isSelected ? "var(--canvas-selection)" : "transparent",
        cursor: "grab",
        userSelect: "none",
        touchAction: "none",
        transition:
          "border-color var(--motion-fast) var(--ease-standard), background-color var(--motion-fast) var(--ease-standard)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: -22,
          left: 0,
          fontSize: 12,
          color: "var(--canvas-text-muted)",
          fontWeight: 500,
        }}
      >
        {group.name}
      </span>
      <div
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeUp}
        style={{
          position: "absolute",
          right: -6,
          bottom: -6,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "var(--canvas-selection-border)",
          cursor: "nwse-resize",
          opacity: isSelected ? 1 : 0,
        }}
      />
    </div>
  );
}
