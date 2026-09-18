export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Where the ray from `rect`'s center toward (`towardX`, `towardY`) exits
 * `rect`'s boundary — the "nearest edge/side" anchor an arrow should start/
 * end at, rather than a raw corner. A closed-form rectangle/ray
 * intersection (no iteration), O(1) per edge even at scale.
 */
export function rectAnchor(rect: Rect, towardX: number, towardY: number): Point {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
  return { x: cx + dx * scale, y: cy + dy * scale };
}
