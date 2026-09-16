export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Screen-space (viewport pixels, origin top-left) -> world-space coordinates. */
export function screenToWorld(
  camera: Camera,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: camera.x + screenX / camera.zoom,
    y: camera.y + screenY / camera.zoom,
  };
}

export function worldToScreen(
  camera: Camera,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return {
    x: (worldX - camera.x) * camera.zoom,
    y: (worldY - camera.y) * camera.zoom,
  };
}

/** CSS transform placing the world-space content layer relative to the camera. */
export function worldLayerTransform(camera: Camera): string {
  return `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The world-space rectangle currently visible given a viewport's pixel size. */
export function viewportWorldBounds(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): Bounds {
  const topLeft = screenToWorld(camera, 0, 0);
  const bottomRight = screenToWorld(camera, viewportWidth, viewportHeight);
  return { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y };
}

/** Zoom while keeping the world point currently under (screenX, screenY) fixed on screen. */
export function zoomAt(camera: Camera, screenX: number, screenY: number, nextZoom: number): Camera {
  const clamped = clampZoom(nextZoom);
  const worldBefore = screenToWorld(camera, screenX, screenY);
  const x = worldBefore.x - screenX / clamped;
  const y = worldBefore.y - screenY / clamped;
  return { x, y, zoom: clamped };
}
