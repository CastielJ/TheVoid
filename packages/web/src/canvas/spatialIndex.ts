import type { Bounds } from "./camera";

/**
 * Client-side grid-bucket spatial index (docs/architecture.md §6, D59;
 * docs/decisions.md "Phase 6 Kickoff Notes" — grid-bucket chosen over a
 * quadtree at MVP's ~1,000-2,000-object target). Rebuilt on every render
 * where the object set changed (O(n), trivial at this scale) and queried on
 * every viewport-bounds change (O(visible buckets)) — this is the
 * "fast viewport query" mechanism driving virtualization, not a
 * persistently-maintained incremental structure.
 */
export const BUCKET_SIZE = 512;

// Fixed approximate footprints used only for bucket placement so a card
// whose center is just outside the viewport but whose edge overlaps it
// isn't culled — not the actual rendered size. Second feature pass: two
// footprints instead of one, since a Task's card now has a compact (default)
// and an expanded (inline-editing) state with meaningfully different sizes —
// looked up per-task by expand state at the CanvasViewport call site.
export const TASK_FOOTPRINT_COMPACT = { width: 240, height: 110 };
export const TASK_FOOTPRINT_EXPANDED = { width: 340, height: 460 };

export interface SpatialObject {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

function bucketKey(bx: number, by: number): string {
  return `${bx},${by}`;
}

export function buildSpatialIndex(objects: SpatialObject[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const obj of objects) {
    const width = obj.width ?? TASK_FOOTPRINT_COMPACT.width;
    const height = obj.height ?? TASK_FOOTPRINT_COMPACT.height;
    const minBX = Math.floor(obj.x / BUCKET_SIZE);
    const maxBX = Math.floor((obj.x + width) / BUCKET_SIZE);
    const minBY = Math.floor(obj.y / BUCKET_SIZE);
    const maxBY = Math.floor((obj.y + height) / BUCKET_SIZE);
    for (let bx = minBX; bx <= maxBX; bx++) {
      for (let by = minBY; by <= maxBY; by++) {
        const key = bucketKey(bx, by);
        const list = index.get(key);
        if (list) list.push(obj.id);
        else index.set(key, [obj.id]);
      }
    }
  }
  return index;
}

/** `margin` (world units) grows the query rect so objects just off-screen mount before they'd pop in. */
export function queryVisible(
  index: Map<string, string[]>,
  viewport: Bounds,
  margin = BUCKET_SIZE,
): Set<string> {
  const minBX = Math.floor((viewport.minX - margin) / BUCKET_SIZE);
  const maxBX = Math.floor((viewport.maxX + margin) / BUCKET_SIZE);
  const minBY = Math.floor((viewport.minY - margin) / BUCKET_SIZE);
  const maxBY = Math.floor((viewport.maxY + margin) / BUCKET_SIZE);

  const result = new Set<string>();
  for (let bx = minBX; bx <= maxBX; bx++) {
    for (let by = minBY; by <= maxBY; by++) {
      const list = index.get(bucketKey(bx, by));
      if (list) for (const id of list) result.add(id);
    }
  }
  return result;
}
