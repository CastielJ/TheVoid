import { useCanvasStore } from "./store";
import { rectAnchor, type Rect } from "./edgeGeometry";
import { linkTypeColor } from "./edgeStyle";
import {
  COMPACT_TASK_WIDTH,
  EXPANDED_TASK_WIDTH,
  EXPANDED_TASK_HEIGHT_FALLBACK,
  compactTaskHeightFor,
} from "./taskFootprint";
import type { TaskSummary } from "./TaskCard";

/**
 * Third feature pass — Task-to-Task connection arrows. Rendered as an SVG
 * sibling to the Group/Task divs, inside the same world-transform
 * container CanvasViewport.tsx already wraps them in, so it pans/zooms for
 * free without any coordinate translation of its own — every point below
 * is a raw world coordinate.
 */
export function EdgeLayer({ summaryByTaskId }: { summaryByTaskId: Map<string, TaskSummary> }) {
  const edges = useCanvasStore((s) => s.edges);
  const tasks = useCanvasStore((s) => s.tasks);
  const expandedTaskIds = useCanvasStore((s) => s.expandedTaskIds);
  const measuredFootprints = useCanvasStore((s) => s.measuredFootprints);
  const isSelected = useCanvasStore((s) => s.isSelected);
  const select = useCanvasStore((s) => s.select);
  const isPendingDeletion = useCanvasStore((s) => s.isPendingDeletion);

  function resolveRect(taskId: string): Rect | null {
    const task = tasks.get(taskId);
    if (!task) return null;
    const measured = measuredFootprints.get(taskId);
    if (measured) return { x: task.x, y: task.y, width: measured.width, height: measured.height };
    if (expandedTaskIds.has(taskId)) {
      return {
        x: task.x,
        y: task.y,
        width: EXPANDED_TASK_WIDTH,
        height: EXPANDED_TASK_HEIGHT_FALLBACK,
      };
    }
    return {
      x: task.x,
      y: task.y,
      width: COMPACT_TASK_WIDTH,
      height: compactTaskHeightFor(summaryByTaskId.get(taskId)),
    };
  }

  return (
    <svg
      style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }}
    >
      <defs>
        <marker
          id="void-edge-arrow-flow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 Z" fill="var(--color-edge-flow)" />
        </marker>
        <marker
          id="void-edge-arrow-dependency"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 Z" fill="var(--color-edge-dependency)" />
        </marker>
      </defs>
      {[...edges.values()].map((edge) => {
        const sourceRect = resolveRect(edge.sourceTaskId);
        const targetRect = resolveRect(edge.targetTaskId);
        // A task the edge references may momentarily be absent client-side
        // (e.g. its own removal hasn't propagated to this edge yet) — skip
        // rendering rather than draw a dangling arrow to nowhere.
        if (!sourceRect || !targetRect) return null;

        const sourceCenter = {
          x: sourceRect.x + sourceRect.width / 2,
          y: sourceRect.y + sourceRect.height / 2,
        };
        const targetCenter = {
          x: targetRect.x + targetRect.width / 2,
          y: targetRect.y + targetRect.height / 2,
        };
        const start = rectAnchor(sourceRect, targetCenter.x, targetCenter.y);
        const end = rectAnchor(targetRect, sourceCenter.x, sourceCenter.y);

        const selected = isSelected("edge", edge.id);
        const pending = isPendingDeletion("edge", edge.id);
        const stroke = selected ? "var(--canvas-selection-border)" : linkTypeColor(edge.type);
        const markerId =
          edge.type === "dependency" ? "void-edge-arrow-dependency" : "void-edge-arrow-flow";

        const d = `M${start.x},${start.y} L${end.x},${end.y}`;
        return (
          <g key={edge.id} style={{ opacity: pending ? 0.4 : 1 }}>
            {/* Wide invisible hit-path — a 1-2px visible stroke is impractical to click precisely. */}
            <path
              d={d}
              stroke="transparent"
              strokeWidth={16}
              fill="none"
              style={{ pointerEvents: pending ? "none" : "stroke", cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                select({ kind: "edge", id: edge.id }, e.shiftKey);
              }}
            />
            <path
              d={d}
              stroke={stroke}
              strokeWidth={selected ? 3 : 2}
              strokeDasharray={edge.type === "dependency" ? "6 4" : undefined}
              fill="none"
              markerEnd={`url(#${markerId})`}
              style={{ pointerEvents: "none" }}
            />
          </g>
        );
      })}
    </svg>
  );
}
