import { useEffect, useState } from "react";
import { trpc } from "../trpc/client";
import { useCanvasStore } from "./store";
import { Button } from "../ui/Button";
import { TagPicker } from "./TagPicker";

/**
 * Post-launch refinement pass — Groups previously had no edit UI at all
 * (create + drag/resize only). Mirrors TaskDetailPanel's structure/styling:
 * a fixed right-side panel, opened on double-click, page-local open-state
 * in CanvasPage (not the Zustand store), same panel-entrance motion.
 */
export function GroupDetailPanel({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const group = useCanvasStore((s) => s.groups.get(groupId));
  const applyGroup = useCanvasStore((s) => s.applyGroup);
  const removeGroup = useCanvasStore((s) => s.removeGroup);
  const voidId = useCanvasStore((s) => s.voidId);

  const utils = trpc.useUtils();
  const [name, setName] = useState(group?.name ?? "");
  useEffect(() => setName(group?.name ?? ""), [group?.id]);

  const update = trpc.group.update.useMutation({ onSuccess: (updated) => applyGroup(updated) });
  const deleteGroup = trpc.group.delete.useMutation({
    onSuccess: () => {
      removeGroup(groupId);
      onClose();
    },
  });

  const tags = trpc.group.listTags.useQuery({ groupId });
  const setTagNames = trpc.group.update.useMutation({
    onSuccess: (updated) => {
      applyGroup(updated);
      utils.group.listTags.invalidate({ groupId });
    },
  });

  if (!group) return null;

  return (
    <aside
      className="void-panel-in"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 340,
        background: "var(--canvas-surface)",
        borderLeft: "1px solid var(--canvas-border)",
        color: "var(--canvas-text)",
        overflowY: "auto",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
      data-testid="group-detail-panel"
      role="complementary"
      aria-label="Group details"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <input
          aria-label="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== group.name && update.mutate({ groupId, name })}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--canvas-text)",
            fontSize: 17,
            fontWeight: 600,
            width: "100%",
          }}
        />
        <button
          onClick={onClose}
          aria-label="Close"
          className="void-icon-btn"
          style={{
            background: "none",
            border: "none",
            color: "var(--canvas-text-muted)",
            fontSize: 18,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{ fontSize: 11, color: "var(--canvas-text-muted)", textTransform: "uppercase" }}
        >
          Tags
        </span>
        {voidId && (
          <TagPicker
            voidId={voidId}
            selected={(tags.data ?? []).map((t) => t.name)}
            onChange={(names) => setTagNames.mutate({ groupId, tagNames: names })}
          />
        )}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 12 }}>
        <Button variant="danger" onClick={() => deleteGroup.mutate({ groupId })}>
          Delete group
        </Button>
      </div>
    </aside>
  );
}
