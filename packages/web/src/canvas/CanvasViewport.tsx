import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../trpc/client";
import { useCanvasStore, type SelectionEntry } from "./store";
import {
  clampZoom,
  screenToWorld,
  viewportWorldBounds,
  worldLayerTransform,
  zoomAt,
} from "./camera";
import { buildSpatialIndex, queryVisible, TASK_FOOTPRINT } from "./spatialIndex";
import { TaskCard } from "./TaskCard";
import { GroupBox } from "./GroupBox";

const WASD_SPEED_WORLD_PER_SEC = 700;
const CAMERA_SAVE_DEBOUNCE_MS = 800;

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}

export function CanvasViewport({
  voidId,
  onOpenTask,
  onOpenGroup,
  onBackgroundDoubleClick,
  focusTarget,
}: {
  voidId: string;
  onOpenTask: (taskId: string) => void;
  onOpenGroup: (groupId: string) => void;
  /** World + screen coordinates of a double-click on empty canvas background. */
  onBackgroundDoubleClick: (
    world: { x: number; y: number },
    screen: { x: number; y: number },
  ) => void;
  /** Jump-to-object navigation (D43: search, My Tasks) — world coordinates to center the camera on once, when the viewport is ready. */
  focusTarget?: { x: number; y: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const camera = useCanvasStore((s) => s.camera);
  const setCamera = useCanvasStore((s) => s.setCamera);
  const tasks = useCanvasStore((s) => s.tasks);
  const groups = useCanvasStore((s) => s.groups);
  const setSelection = useCanvasStore((s) => s.setSelection);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const selection = useCanvasStore((s) => s.selection);
  const removeTask = useCanvasStore((s) => s.removeTask);
  const removeGroup = useCanvasStore((s) => s.removeGroup);
  const applyTask = useCanvasStore((s) => s.applyTask);

  const deleteTask = trpc.task.delete.useMutation();
  const deleteGroup = trpc.group.delete.useMutation();
  const duplicateTask = trpc.task.duplicate.useMutation({ onSuccess: (t) => applyTask(t) });
  const saveCamera = trpc.void.saveCamera.useMutation();

  // --- container sizing -----------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // --- jump-to-object navigation (D43 search, D44 My Tasks) ------------------
  // Applied once per distinct target, and only once the viewport has a real
  // size to center against (zero on the very first render) — re-keying the
  // effect on the target's coordinates (rather than object identity) means a
  // second click on the same result doesn't re-trigger, which is fine: the
  // camera is already there.
  const appliedFocusKey = useRef<string | null>(null);
  useEffect(() => {
    if (!focusTarget || size.width === 0) return;
    const key = `${focusTarget.x},${focusTarget.y}`;
    if (appliedFocusKey.current === key) return;
    appliedFocusKey.current = key;
    setCamera({
      x: focusTarget.x - size.width / 2,
      y: focusTarget.y - size.height / 2,
      zoom: 1,
    });
    // Deliberately keyed on primitive coordinates, not setCamera (a stable Zustand setter identity).
  }, [focusTarget?.x, focusTarget?.y, size.width, size.height]);

  // --- camera persistence (debounced, D31) -----------------------------------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveCamera.mutate({ voidId, x: camera.x, y: camera.y, zoom: camera.zoom });
    }, CAMERA_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // saveCamera's mutation-object identity is stable across renders, so it's deliberately left out of the deps list.
  }, [camera.x, camera.y, camera.zoom, voidId]);

  // --- virtualization ---------------------------------------------------------
  const taskIndex = useMemo(
    () =>
      buildSpatialIndex(
        [...tasks.values()].map((t) => ({ id: t.id, x: t.x, y: t.y, ...TASK_FOOTPRINT })),
      ),
    [tasks],
  );
  const groupIndex = useMemo(
    () =>
      buildSpatialIndex(
        [...groups.values()].map((g) => ({
          id: g.id,
          x: g.x,
          y: g.y,
          width: g.width,
          height: g.height,
        })),
      ),
    [groups],
  );
  const viewport = viewportWorldBounds(camera, size.width, size.height);
  const visibleTaskIds = useMemo(() => queryVisible(taskIndex, viewport), [taskIndex, viewport]);
  const visibleGroupIds = useMemo(() => queryVisible(groupIndex, viewport), [groupIndex, viewport]);

  // --- pan / selection-box drag -----------------------------------------------
  const panState = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const selectionBoxState = useRef<{
    pointerId: number;
    startWorld: { x: number; y: number };
  } | null>(null);
  const [selectionBoxScreen, setSelectionBoxScreen] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  // Two simultaneous touch pointers => pinch-zoom (D57); tracked by pointerId.
  const activeTouches = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{
    startDistance: number;
    startZoom: number;
    midpoint: { x: number; y: number };
  } | null>(null);

  function screenPointFromEvent(e: React.PointerEvent): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Only called once `activeTouches.current.size === 2` has just been verified by the caller. */
  function twoActiveTouches(): [{ x: number; y: number }, { x: number; y: number }] {
    const [a, b] = [...activeTouches.current.values()];
    return [a!, b!];
  }

  function handleBackgroundPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "touch") {
      activeTouches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activeTouches.current.size === 2) {
        const [a, b] = twoActiveTouches();
        pinchState.current = {
          startDistance: Math.hypot(a.x - b.x, a.y - b.y),
          startZoom: camera.zoom,
          midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
        panState.current = null;
        return;
      }
    }
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);

    if (e.shiftKey) {
      const screenPoint = screenPointFromEvent(e);
      selectionBoxState.current = {
        pointerId: e.pointerId,
        startWorld: screenToWorld(camera, screenPoint.x, screenPoint.y),
      };
      setSelectionBoxScreen({ x: screenPoint.x, y: screenPoint.y, w: 0, h: 0 });
      return;
    }

    panState.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  }

  function handleBackgroundPointerMove(e: React.PointerEvent) {
    if (e.pointerType === "touch" && activeTouches.current.has(e.pointerId)) {
      activeTouches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchState.current && activeTouches.current.size === 2) {
        const [a, b] = twoActiveTouches();
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const nextZoom =
          pinchState.current.startZoom * (distance / pinchState.current.startDistance);
        const rect = containerRef.current!.getBoundingClientRect();
        setCamera(
          zoomAt(
            camera,
            pinchState.current.midpoint.x - rect.left,
            pinchState.current.midpoint.y - rect.top,
            clampZoom(nextZoom),
          ),
        );
        return;
      }
    }

    const pan = panState.current;
    if (pan && pan.pointerId === e.pointerId) {
      const dx = (e.clientX - pan.lastX) / camera.zoom;
      const dy = (e.clientY - pan.lastY) / camera.zoom;
      panState.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      setCamera({ x: camera.x - dx, y: camera.y - dy, zoom: camera.zoom });
      return;
    }

    const box = selectionBoxState.current;
    if (box && box.pointerId === e.pointerId) {
      const screenPoint = screenPointFromEvent(e);
      // Camera doesn't change during a shift-drag box, so re-deriving the
      // start corner's screen position from its fixed world position here
      // (rather than caching a screen value) is safe and avoids a second ref.
      const startInScreen = {
        x: (box.startWorld.x - camera.x) * camera.zoom,
        y: (box.startWorld.y - camera.y) * camera.zoom,
      };
      setSelectionBoxScreen({
        x: Math.min(startInScreen.x, screenPoint.x),
        y: Math.min(startInScreen.y, screenPoint.y),
        w: Math.abs(screenPoint.x - startInScreen.x),
        h: Math.abs(screenPoint.y - startInScreen.y),
      });
    }
  }

  function handleBackgroundPointerUp(e: React.PointerEvent) {
    if (e.pointerType === "touch") {
      activeTouches.current.delete(e.pointerId);
      if (activeTouches.current.size < 2) pinchState.current = null;
    }

    if (panState.current?.pointerId === e.pointerId) {
      panState.current = null;
      return;
    }

    const box = selectionBoxState.current;
    if (box && box.pointerId === e.pointerId) {
      selectionBoxState.current = null;
      const screenPoint = screenPointFromEvent(e);
      const endWorld = screenToWorld(camera, screenPoint.x, screenPoint.y);
      const rect = {
        minX: Math.min(box.startWorld.x, endWorld.x),
        minY: Math.min(box.startWorld.y, endWorld.y),
        maxX: Math.max(box.startWorld.x, endWorld.x),
        maxY: Math.max(box.startWorld.y, endWorld.y),
      };
      const entries: SelectionEntry[] = [];
      for (const t of tasks.values()) {
        if (
          t.x < rect.maxX &&
          t.x + TASK_FOOTPRINT.width > rect.minX &&
          t.y < rect.maxY &&
          t.y + TASK_FOOTPRINT.height > rect.minY
        ) {
          entries.push({ kind: "task", id: t.id });
        }
      }
      for (const g of groups.values()) {
        if (
          g.x < rect.maxX &&
          g.x + g.width > rect.minX &&
          g.y < rect.maxY &&
          g.y + g.height > rect.minY
        ) {
          entries.push({ kind: "group", id: g.id });
        }
      }
      setSelectionBoxScreen(null);
      setSelection(entries);
      return;
    }

    // Plain click on empty background (no pan movement, no box) clears selection.
    clearSelection();
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const nextZoom = camera.zoom * Math.exp(-e.deltaY * 0.001);
    setCamera(zoomAt(camera, e.clientX - rect.left, e.clientY - rect.top, nextZoom));
  }

  // --- WASD ---------------------------------------------------------------
  const heldKeys = useRef<Set<string>>(new Set());
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      if (!hovering) return;
      if (["w", "a", "s", "d"].includes(e.key.toLowerCase()))
        heldKeys.current.add(e.key.toLowerCase());
    }
    function onKeyUp(e: KeyboardEvent) {
      heldKeys.current.delete(e.key.toLowerCase());
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [hovering]);

  useEffect(() => {
    let raf: number;
    let last = performance.now();
    function tick(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      if (heldKeys.current.size > 0) {
        const state = useCanvasStore.getState();
        let dx = 0;
        let dy = 0;
        if (heldKeys.current.has("w")) dy -= 1;
        if (heldKeys.current.has("s")) dy += 1;
        if (heldKeys.current.has("a")) dx -= 1;
        if (heldKeys.current.has("d")) dx += 1;
        if (dx !== 0 || dy !== 0) {
          const length = Math.hypot(dx, dy);
          const step = (WASD_SPEED_WORLD_PER_SEC * dt) / length;
          setCamera({
            x: state.camera.x + dx * step,
            y: state.camera.y + dy * step,
            zoom: state.camera.zoom,
          });
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally run once: reads live camera state via getState() each frame instead of depending on it.
  }, []);

  // --- delete / copy-paste (D56) ------------------------------------------
  const clipboard = useRef<string[]>([]);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const current = useCanvasStore.getState().selection;
        for (const entry of current.values()) {
          if (entry.kind === "task") {
            deleteTask.mutate({ taskId: entry.id });
            removeTask(entry.id);
          } else {
            deleteGroup.mutate({ groupId: entry.id });
            removeGroup(entry.id);
          }
        }
        clearSelection();
      }

      const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c";
      const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v";
      if (isCopy) {
        clipboard.current = [...useCanvasStore.getState().selection.values()]
          .filter((entry) => entry.kind === "task")
          .map((entry) => entry.id);
      }
      if (isPaste && clipboard.current.length > 0) {
        for (const taskId of clipboard.current) duplicateTask.mutate({ taskId });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Mutation-object identities are stable across renders, so deps are intentionally left empty.
  }, []);

  const handleOpenTask = useCallback((taskId: string) => onOpenTask(taskId), [onOpenTask]);
  const handleOpenGroup = useCallback((groupId: string) => onOpenGroup(groupId), [onOpenGroup]);

  function handleBackgroundDoubleClick(e: React.MouseEvent) {
    // Only the background itself, never a bubbled double-click from a
    // TaskCard/GroupBox (both stopPropagation their own onDoubleClick) or
    // any other child element.
    if (e.target !== e.currentTarget) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = screenToWorld(camera, screenPoint.x, screenPoint.y);
    // Container-relative, not raw window coordinates — the creation panel
    // renders position:absolute inside this same container (CanvasPage), so
    // its `left`/`top` must be relative to that container's origin, not the
    // browser window's.
    onBackgroundDoubleClick(world, screenPoint);
  }

  return (
    <div
      ref={containerRef}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handleBackgroundPointerMove}
      onPointerUp={handleBackgroundPointerUp}
      onDoubleClick={handleBackgroundDoubleClick}
      onWheel={handleWheel}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "var(--canvas-bg)",
        backgroundImage: "radial-gradient(var(--canvas-grid-dot) 1px, transparent 1px)",
        backgroundSize: `${32 * camera.zoom}px ${32 * camera.zoom}px`,
        backgroundPosition: `${-camera.x * camera.zoom}px ${-camera.y * camera.zoom}px`,
        touchAction: "none",
      }}
      data-testid="canvas-viewport"
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transformOrigin: "0 0",
          transform: worldLayerTransform(camera),
        }}
      >
        {[...groups.values()]
          .filter((g) => visibleGroupIds.has(g.id))
          .map((g) => (
            <GroupBox key={g.id} group={g} zoom={camera.zoom} onOpen={handleOpenGroup} />
          ))}
        {[...tasks.values()]
          .filter((t) => visibleTaskIds.has(t.id))
          .map((t) => (
            <TaskCard key={t.id} task={t} zoom={camera.zoom} onOpen={handleOpenTask} />
          ))}
      </div>

      {selectionBoxScreen && (
        <div
          style={{
            position: "absolute",
            left: selectionBoxScreen.x,
            top: selectionBoxScreen.y,
            width: selectionBoxScreen.w,
            height: selectionBoxScreen.h,
            border: "1px solid var(--canvas-selection-border)",
            background: "var(--canvas-selection)",
            pointerEvents: "none",
          }}
        />
      )}

      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          fontSize: 11,
          color: "var(--canvas-text-muted)",
        }}
      >
        {tasks.size} tasks · {groups.size} groups · {selection.size} selected
      </div>
    </div>
  );
}
