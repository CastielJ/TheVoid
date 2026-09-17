import { useEffect, useRef, useState } from "react";
import { taskPriorityValues, taskPriorityLabels, type TaskPriority } from "@void/shared";
import { trpc } from "../trpc/client";
import { useCanvasStore } from "./store";
import { Button } from "../ui/Button";
import { TagPicker } from "./TagPicker";
import type { Task, Group } from "../trpc/types";

type Choice = "task" | "group" | null;

/**
 * Double-click-anywhere-on-canvas creation flow (post-launch refinement
 * pass) — replaces the old "+ Task"/"+ Group" toolbar buttons, which always
 * created at a fixed offset from the camera's top-left corner rather than
 * where the user actually clicked. Positioned in screen-space at the
 * moment of the double-click (like a context menu) — deliberately not
 * re-projected as the camera pans/zooms while open, to avoid the panel
 * drifting out from under a still-forming click.
 */
export function CanvasCreationPanel({
  voidId,
  worldPosition,
  screenPosition,
  onClose,
}: {
  voidId: string;
  worldPosition: { x: number; y: number };
  screenPosition: { x: number; y: number };
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<Choice>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const groups = useCanvasStore((s) => s.groups);
  const applyTask = useCanvasStore((s) => s.applyTask);
  const applyGroup = useCanvasStore((s) => s.applyGroup);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    // Deferred so the double-click that opened this panel doesn't itself
    // register as an "outside" click and close it immediately.
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 0);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
      clearTimeout(timer);
    };
  }, [onClose]);

  // D38: Group membership is explicit FK, computed once at creation time —
  // never continuously re-derived from geometry afterward.
  function findEnclosingGroupId(): string | undefined {
    for (const g of groups.values()) {
      if (
        worldPosition.x >= g.x &&
        worldPosition.x <= g.x + g.width &&
        worldPosition.y >= g.y &&
        worldPosition.y <= g.y + g.height
      ) {
        return g.id;
      }
    }
    return undefined;
  }

  const left = Math.min(screenPosition.x, window.innerWidth - 300);
  const top = Math.min(screenPosition.y, window.innerHeight - 320);

  return (
    <div
      ref={containerRef}
      className="void-pop-in"
      style={{
        position: "absolute",
        left,
        top,
        width: 280,
        background: "var(--canvas-surface)",
        border: "1px solid var(--canvas-border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-lg)",
        color: "var(--canvas-text)",
        padding: 14,
        zIndex: 40,
        transformOrigin: "top left",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {choice === null && (
        <div>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 12,
              textTransform: "uppercase",
              color: "var(--canvas-text-muted)",
            }}
          >
            Create here
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button style={{ flex: 1 }} onClick={() => setChoice("task")}>
              Task
            </Button>
            <Button variant="secondary" style={{ flex: 1 }} onClick={() => setChoice("group")}>
              Group
            </Button>
          </div>
        </div>
      )}

      {choice === "task" && (
        <TaskCreateForm
          voidId={voidId}
          worldPosition={worldPosition}
          groupId={findEnclosingGroupId()}
          onCreated={(task) => {
            applyTask(task);
            onClose();
          }}
          onBack={() => setChoice(null)}
        />
      )}

      {choice === "group" && (
        <GroupCreateForm
          voidId={voidId}
          worldPosition={worldPosition}
          onCreated={(group) => {
            applyGroup(group);
            onClose();
          }}
          onBack={() => setChoice(null)}
        />
      )}
    </div>
  );
}

function TaskCreateForm({
  voidId,
  worldPosition,
  groupId,
  onCreated,
  onBack,
}: {
  voidId: string;
  worldPosition: { x: number; y: number };
  groupId: string | undefined;
  onCreated: (task: Task) => void;
  onBack: () => void;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [tagNames, setTagNames] = useState<string[]>([]);
  const create = trpc.task.create.useMutation({ onSuccess: (t) => onCreated(t) });

  return (
    <form
      className="void-fade-in"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        create.mutate({
          voidId,
          title: title.trim(),
          priority: priority || undefined,
          tagNames: tagNames.length > 0 ? tagNames : undefined,
          groupId,
          x: worldPosition.x,
          y: worldPosition.y,
        });
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <input
        aria-label="Task title"
        autoFocus
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title…"
        style={formInputStyle}
      />
      <select
        aria-label="Priority"
        value={priority}
        onChange={(e) => setPriority(e.target.value as TaskPriority | "")}
        style={formInputStyle}
      >
        <option value="">No priority</option>
        {taskPriorityValues.map((p) => (
          <option key={p} value={p}>
            {taskPriorityLabels[p]}
          </option>
        ))}
      </select>
      <TagPicker voidId={voidId} selected={tagNames} onChange={setTagNames} />
      {groupId && (
        <p style={{ fontSize: 11, color: "var(--canvas-text-muted)", margin: 0 }}>
          Will be added to this Group.
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={create.isPending} style={{ flex: 1 }}>
          Create Task
        </Button>
      </div>
    </form>
  );
}

function GroupCreateForm({
  voidId,
  worldPosition,
  onCreated,
  onBack,
}: {
  voidId: string;
  worldPosition: { x: number; y: number };
  onCreated: (group: Group) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [tagNames, setTagNames] = useState<string[]>([]);
  const create = trpc.group.create.useMutation({ onSuccess: (g) => onCreated(g) });

  return (
    <form
      className="void-fade-in"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        // Second feature pass: Groups are auto-sized server-side
        // (recomputeGroupBounds) — width/height are no longer client-settable.
        // A brand-new empty Group starts at GROUP_MIN_WIDTH/HEIGHT (280x160,
        // domains/group/groups.ts); center the click point within that.
        create.mutate({
          voidId,
          name: name.trim(),
          tagNames: tagNames.length > 0 ? tagNames : undefined,
          x: worldPosition.x - 140,
          y: worldPosition.y - 80,
        });
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <input
        aria-label="Group name"
        autoFocus
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name…"
        style={formInputStyle}
      />
      <TagPicker voidId={voidId} selected={tagNames} onChange={setTagNames} />
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={create.isPending} style={{ flex: 1 }}>
          Create Group
        </Button>
      </div>
    </form>
  );
}

const formInputStyle: React.CSSProperties = {
  background: "var(--canvas-bg)",
  border: "1px solid var(--canvas-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--canvas-text)",
  padding: "7px 9px",
  fontSize: 13,
  width: "100%",
};
