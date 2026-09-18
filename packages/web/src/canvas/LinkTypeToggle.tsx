import { useCanvasStore } from "./store";
import { linkTypeColor } from "./edgeStyle";
import { Button } from "../ui/Button";
import type { TaskLinkType } from "../trpc/types";

const OPTIONS: { type: TaskLinkType; label: string }[] = [
  { type: "flow", label: "Flow" },
  { type: "dependency", label: "Dependency" },
];

/**
 * Third feature pass — Task Link creation toolbar (CanvasPage.tsx's
 * header). `activeLinkType` feeds BOTH creation paths (drag a connector
 * handle off any TaskCard, or arm this "Connect" button for a click-
 * source/click-target flow) — one selector, no duplicated type UI.
 */
export function LinkTypeToggle() {
  const activeLinkType = useCanvasStore((s) => s.activeLinkType);
  const setActiveLinkType = useCanvasStore((s) => s.setActiveLinkType);
  const linkArmed = useCanvasStore((s) => s.linkArmed);
  const armLinking = useCanvasStore((s) => s.armLinking);
  const disarmLinking = useCanvasStore((s) => s.disarmLinking);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          display: "flex",
          border: "1px solid var(--canvas-border)",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
        }}
      >
        {OPTIONS.map((opt) => {
          const active = activeLinkType === opt.type;
          return (
            <button
              key={opt.type}
              onClick={() => setActiveLinkType(opt.type)}
              aria-pressed={active}
              style={{
                border: "none",
                background: active ? linkTypeColor(opt.type) : "transparent",
                color: active ? "#fff" : "var(--canvas-text-muted)",
                fontSize: 12,
                padding: "5px 10px",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <Button
        variant={linkArmed ? "primary" : "secondary"}
        style={{ padding: "5px 10px", fontSize: 12 }}
        onClick={() => (linkArmed ? disarmLinking() : armLinking())}
      >
        {linkArmed ? "Cancel connecting" : "Connect Tasks"}
      </Button>
    </div>
  );
}
