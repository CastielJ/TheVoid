import { memo, useEffect, useRef, useState } from "react";
import { trpc } from "../trpc/client";
import { useCanvasStore } from "./store";
import { TagPicker } from "./TagPicker";
import type { Group } from "../trpc/types";

/**
 * Second feature pass — Groups are now auto-sized server-side
 * (recomputeGroupBounds); the manual resize handle is gone. Editing (rename
 * + tags) is inline in the header instead of opening a side panel: the name
 * becomes a click-to-edit input, and a small tag toggle reveals a TagPicker
 * — both trivial enough that a full expand/collapse card state (like
 * TaskCard's) isn't warranted here.
 *
 * Performance pass: no `zoom` prop (drag math reads it fresh from the store
 * instead) + React.memo, matching TaskCard — a Group only re-renders on
 * camera pan/zoom if it's the one currently showing a live drag-preview.
 */
export const GroupBox = memo(function GroupBox({
  group,
  voidId,
  previewBounds,
}: {
  group: Group;
  voidId: string;
  /** Live "if a dragged Task were dropped here, the Group would resize to..." preview — client-only, never the real persisted bounds. */
  previewBounds?: { x: number; y: number; width: number; height: number } | undefined;
}) {
  const isSelected = useCanvasStore((s) => s.isSelected("group", group.id));
  const select = useCanvasStore((s) => s.select);
  const setLocalPosition = useCanvasStore((s) => s.setLocalPosition);
  const applyGroup = useCanvasStore((s) => s.applyGroup);
  const utils = trpc.useUtils();
  const update = trpc.group.update.useMutation({ onSuccess: (updated) => applyGroup(updated) });
  const tags = trpc.group.listTags.useQuery({ groupId: group.id }, { enabled: isSelected });
  const setTagNames = trpc.group.update.useMutation({
    onSuccess: (updated) => {
      applyGroup(updated);
      utils.group.listTags.invalidate({ groupId: group.id });
    },
  });

  const [editingName, setEditingName] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [name, setName] = useState(group.name);
  useEffect(() => setName(group.name), [group.id, group.name]);

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
      startWorldX: group.x,
      startWorldY: group.y,
      moved: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const zoom = useCanvasStore.getState().camera.zoom;
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

  return (
    <>
      {previewBounds && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: previewBounds.x,
            top: previewBounds.y,
            width: previewBounds.width,
            height: previewBounds.height,
            border: "1.5px dashed var(--canvas-selection-border)",
            borderRadius: "var(--radius-lg)",
            background: "var(--canvas-selection)",
            opacity: 0.6,
            pointerEvents: "none",
          }}
        />
      )}
      <div
        data-testid="group-box"
        data-group-id={group.id}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
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
            "border-color var(--motion-fast) var(--ease-standard), background-color var(--motion-fast) var(--ease-standard), left var(--motion-base) var(--ease-standard), top var(--motion-base) var(--ease-standard), width var(--motion-base) var(--ease-standard), height var(--motion-base) var(--ease-standard)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -24,
            left: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {editingName ? (
            <input
              aria-label="Group name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={() => {
                setEditingName(false);
                if (name.trim() && name !== group.name) {
                  update.mutate({ groupId: group.id, name: name.trim() });
                }
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              style={{
                fontSize: 12,
                fontWeight: 500,
                background: "var(--canvas-surface)",
                border: "1px solid var(--canvas-border-strong)",
                borderRadius: "var(--radius-sm)",
                color: "var(--canvas-text)",
                padding: "2px 6px",
                width: 160,
              }}
            />
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingName(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                background: "none",
                border: "none",
                color: "var(--canvas-text-muted)",
                fontSize: 12,
                fontWeight: 500,
                padding: 0,
                cursor: "text",
              }}
            >
              {group.name}
            </button>
          )}
          {isSelected && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowTagPicker((v) => !v);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Edit tags"
              className="void-icon-btn"
              style={{
                background: "none",
                border: "none",
                color: "var(--canvas-text-muted)",
                fontSize: 11,
              }}
            >
              🏷
            </button>
          )}
        </div>

        {showTagPicker && isSelected && (
          <div
            className="void-pop-in"
            onPointerDown={(e) => e.stopPropagation()}
            style={{ position: "absolute", top: -24, left: 170, width: 200, zIndex: 20 }}
          >
            <TagPicker
              voidId={voidId}
              selected={(tags.data ?? []).map((t) => t.name)}
              onChange={(tagNames) => setTagNames.mutate({ groupId: group.id, tagNames })}
            />
          </div>
        )}
      </div>
    </>
  );
});
