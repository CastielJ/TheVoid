import { create } from "zustand";
import type { Task, Group, Edge, TaskLinkType } from "../trpc/types";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "evicted" | "deleted";

export type SelectableKind = "task" | "group" | "edge";
export type SelectionEntry =
  { kind: "task"; id: string } | { kind: "group"; id: string } | { kind: "edge"; id: string };

export interface GroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Footprint {
  width: number;
  height: number;
}

interface CanvasState {
  voidId: string | null;
  tasks: Map<string, Task>;
  groups: Map<string, Group>;
  edges: Map<string, Edge>;
  camera: { x: number; y: number; zoom: number };
  selection: Map<string, SelectionEntry>;
  connectionStatus: ConnectionStatus;

  // Third feature pass: a Task's real rendered size while expanded (an
  // expanded card's height is content-dependent — TASK_FOOTPRINT_EXPANDED
  // in spatialIndex.ts is an approximation for bucket-placement only).
  // Reported by TaskCard via a ResizeObserver while expanded, cleared on
  // collapse/unmount. EdgeLayer's anchor math prefers this when present,
  // falling back to the fixed compact/expanded constants otherwise.
  measuredFootprints: Map<string, Footprint>;
  setMeasuredFootprint: (taskId: string, size: Footprint) => void;
  clearMeasuredFootprint: (taskId: string) => void;

  // Third feature pass — Task Links ("arrows") creation UX. `activeLinkType`
  // is a persistent, always-visible toolbar toggle (default "flow") that
  // feeds BOTH creation paths below — it is not an "armed"/modal state.
  activeLinkType: TaskLinkType;
  setActiveLinkType: (type: TaskLinkType) => void;

  // Fallback creation path: a toolbar button arms click-source-then-click-
  // target mode. `armedSourceTaskId` is set on the first click; both are
  // cleared on completion, Escape, or a second click on the same Task.
  linkArmed: boolean;
  armedSourceTaskId: string | null;
  armLinking: () => void;
  disarmLinking: () => void;
  setArmedSource: (taskId: string) => void;

  // Primary creation path: dragging a connector handle off a TaskCard.
  // Screen-space, not world-space — the live preview line renders in a
  // position:fixed overlay using raw client coordinates, so no camera/
  // world conversion is needed; the source anchor is captured once at
  // drag-start (the source card doesn't move during this gesture).
  linkDraft: {
    sourceTaskId: string;
    type: TaskLinkType;
    sourceScreenX: number;
    sourceScreenY: number;
    pointerScreenX: number;
    pointerScreenY: number;
    hoverTargetId: string | null;
  } | null;
  startLinkDraft: (
    sourceTaskId: string,
    type: TaskLinkType,
    screenX: number,
    screenY: number,
  ) => void;
  updateLinkDraft: (screenX: number, screenY: number, hoverTargetId: string | null) => void;
  clearLinkDraft: () => void;

  // Second feature pass: which Tasks are showing their expanded (inline-
  // editing) state — client-only UI state, never persisted/server-synced,
  // reset whenever the Void is (re)hydrated.
  expandedTaskIds: Set<string>;
  toggleExpanded: (taskId: string) => void;
  isExpanded: (taskId: string) => boolean;

  // A Task currently being dragged (position updates live during the drag,
  // via setLocalPosition already) — tracked separately so CanvasViewport can
  // derive the drag-over-Group ghost-preview bounds without lifting
  // TaskCard's whole pointer-capture drag handler up.
  draggingTaskId: string | null;
  setDraggingTaskId: (taskId: string | null) => void;

  // Third feature pass: an in-flight drag's live position, updated on every
  // pointermove — deliberately kept OUT of `tasks`/`groups` (unlike
  // setLocalPosition below) so CanvasViewport's spatial-index memo, which
  // depends on those Maps' identity, doesn't rebuild over every object on
  // every single drag frame. Only the dragged card itself reads this;
  // every other card's selector returns null on every call (referentially
  // stable), so only the dragged card re-renders. Committed into the real
  // Map via setLocalPosition exactly once, at drag-end.
  liveDragPosition: { kind: "task" | "group"; id: string; x: number; y: number } | null;
  setLiveDragPosition: (kind: "task" | "group", id: string, x: number, y: number) => void;
  clearLiveDragPosition: () => void;

  // Client-only, ephemeral "if dropped here, this Group would resize to..."
  // preview — never the real persisted group.width/height. Keyed by groupId;
  // cleared on drag end.
  previewGroupBounds: Map<string, GroupBounds>;
  setPreviewGroupBounds: (groupId: string, bounds: GroupBounds) => void;
  clearPreviewGroupBounds: () => void;

  hydrate: (voidId: string, tasks: Task[], groups: Group[], edges: Edge[]) => void;
  applyTask: (task: Task) => void;
  removeTask: (id: string) => void;
  applyGroup: (group: Group) => void;
  removeGroup: (id: string) => void;
  applyEdge: (edge: Edge) => void;
  removeEdge: (id: string) => void;
  /** Local-only override during drag, bypassing version bookkeeping entirely — overwritten once the move mutation resolves. */
  setLocalPosition: (kind: "task" | "group", id: string, x: number, y: number) => void;

  // Third feature pass: tracks which Tasks/Groups have a delete mutation
  // in flight so the card/box can show a spinner and stay on screen until
  // the server confirms, instead of vanishing optimistically. Keyed with
  // the same selectionKey scheme as `selection` below — deliberately not a
  // second key format. Marking/clearing an absent id is a no-op, mirroring
  // removeTask/removeGroup's existing idempotent-on-repeat-call discipline
  // (a delete's own onSuccess and this store's other callers should never
  // need to guard against double-clearing).
  pendingDeletionIds: Set<string>;
  markPendingDeletion: (kind: SelectableKind, id: string) => void;
  clearPendingDeletion: (kind: SelectableKind, id: string) => void;
  isPendingDeletion: (kind: SelectableKind, id: string) => boolean;

  setCamera: (camera: { x: number; y: number; zoom: number }) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;

  select: (entry: SelectionEntry, additive: boolean) => void;
  setSelection: (entries: SelectionEntry[]) => void;
  clearSelection: () => void;
  isSelected: (kind: SelectableKind, id: string) => boolean;
}

function selectionKey(entry: SelectionEntry): string {
  return `${entry.kind}:${entry.id}`;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  voidId: null,
  tasks: new Map(),
  groups: new Map(),
  edges: new Map(),
  camera: { x: 0, y: 0, zoom: 1 },
  selection: new Map(),
  connectionStatus: "connecting",
  expandedTaskIds: new Set(),
  draggingTaskId: null,
  liveDragPosition: null,
  previewGroupBounds: new Map(),
  pendingDeletionIds: new Set(),
  measuredFootprints: new Map(),

  setMeasuredFootprint: (taskId, size) =>
    set((state) => {
      const measuredFootprints = new Map(state.measuredFootprints);
      measuredFootprints.set(taskId, size);
      return { measuredFootprints };
    }),

  clearMeasuredFootprint: (taskId) =>
    set((state) => {
      if (!state.measuredFootprints.has(taskId)) return {};
      const measuredFootprints = new Map(state.measuredFootprints);
      measuredFootprints.delete(taskId);
      return { measuredFootprints };
    }),

  activeLinkType: "flow",
  setActiveLinkType: (type) => set({ activeLinkType: type }),

  linkArmed: false,
  armedSourceTaskId: null,
  armLinking: () => set({ linkArmed: true, armedSourceTaskId: null }),
  disarmLinking: () => set({ linkArmed: false, armedSourceTaskId: null }),
  setArmedSource: (taskId) => set({ armedSourceTaskId: taskId }),

  linkDraft: null,
  startLinkDraft: (sourceTaskId, type, screenX, screenY) =>
    set({
      linkDraft: {
        sourceTaskId,
        type,
        sourceScreenX: screenX,
        sourceScreenY: screenY,
        pointerScreenX: screenX,
        pointerScreenY: screenY,
        hoverTargetId: null,
      },
    }),
  updateLinkDraft: (screenX, screenY, hoverTargetId) =>
    set((state) => {
      if (!state.linkDraft) return {};
      return {
        linkDraft: {
          ...state.linkDraft,
          pointerScreenX: screenX,
          pointerScreenY: screenY,
          hoverTargetId,
        },
      };
    }),
  clearLinkDraft: () => set({ linkDraft: null }),

  toggleExpanded: (taskId) =>
    set((state) => {
      const expandedTaskIds = new Set(state.expandedTaskIds);
      if (expandedTaskIds.has(taskId)) expandedTaskIds.delete(taskId);
      else expandedTaskIds.add(taskId);
      return { expandedTaskIds };
    }),
  isExpanded: (taskId) => get().expandedTaskIds.has(taskId),

  setDraggingTaskId: (taskId) => set({ draggingTaskId: taskId }),

  setLiveDragPosition: (kind, id, x, y) => set({ liveDragPosition: { kind, id, x, y } }),
  clearLiveDragPosition: () => set({ liveDragPosition: null }),

  setPreviewGroupBounds: (groupId, bounds) =>
    set((state) => {
      const previewGroupBounds = new Map(state.previewGroupBounds);
      previewGroupBounds.set(groupId, bounds);
      return { previewGroupBounds };
    }),
  clearPreviewGroupBounds: () => set({ previewGroupBounds: new Map() }),

  hydrate: (voidId, tasks, groups, edges) =>
    set({
      voidId,
      tasks: new Map(tasks.map((t) => [t.id, t])),
      groups: new Map(groups.map((g) => [g.id, g])),
      edges: new Map(edges.map((e) => [e.id, e])),
      selection: new Map(),
      expandedTaskIds: new Set(),
      draggingTaskId: null,
      liveDragPosition: null,
      previewGroupBounds: new Map(),
      pendingDeletionIds: new Set(),
      measuredFootprints: new Map(),
      linkArmed: false,
      armedSourceTaskId: null,
      linkDraft: null,
    }),

  applyTask: (task) =>
    set((state) => {
      const existing = state.tasks.get(task.id);
      if (existing && existing.version > task.version) return {};
      const tasks = new Map(state.tasks);
      tasks.set(task.id, task);
      return { tasks };
    }),

  removeTask: (id) =>
    set((state) => {
      if (!state.tasks.has(id)) return {};
      const tasks = new Map(state.tasks);
      tasks.delete(id);
      const selection = new Map(state.selection);
      selection.delete(selectionKey({ kind: "task", id }));
      return { tasks, selection };
    }),

  applyGroup: (group) =>
    set((state) => {
      const existing = state.groups.get(group.id);
      if (existing && existing.version > group.version) return {};
      const groups = new Map(state.groups);
      groups.set(group.id, group);
      return { groups };
    }),

  removeGroup: (id) =>
    set((state) => {
      if (!state.groups.has(id)) return {};
      const groups = new Map(state.groups);
      groups.delete(id);
      const selection = new Map(state.selection);
      selection.delete(selectionKey({ kind: "group", id }));
      return { groups, selection };
    }),

  applyEdge: (edge) =>
    set((state) => {
      const existing = state.edges.get(edge.id);
      if (existing && existing.version > edge.version) return {};
      const edges = new Map(state.edges);
      edges.set(edge.id, edge);
      return { edges };
    }),

  removeEdge: (id) =>
    set((state) => {
      if (!state.edges.has(id)) return {};
      const edges = new Map(state.edges);
      edges.delete(id);
      const selection = new Map(state.selection);
      selection.delete(selectionKey({ kind: "edge", id }));
      return { edges, selection };
    }),

  setLocalPosition: (kind, id, x, y) =>
    set((state) => {
      if (kind === "task") {
        const existing = state.tasks.get(id);
        if (!existing) return {};
        const tasks = new Map(state.tasks);
        tasks.set(id, { ...existing, x, y });
        return { tasks };
      }
      const existing = state.groups.get(id);
      if (!existing) return {};
      const groups = new Map(state.groups);
      groups.set(id, { ...existing, x, y });
      return { groups };
    }),

  markPendingDeletion: (kind, id) =>
    set((state) => {
      const pendingDeletionIds = new Set(state.pendingDeletionIds);
      pendingDeletionIds.add(selectionKey({ kind, id }));
      return { pendingDeletionIds };
    }),

  clearPendingDeletion: (kind, id) =>
    set((state) => {
      const key = selectionKey({ kind, id });
      if (!state.pendingDeletionIds.has(key)) return {};
      const pendingDeletionIds = new Set(state.pendingDeletionIds);
      pendingDeletionIds.delete(key);
      return { pendingDeletionIds };
    }),

  isPendingDeletion: (kind, id) => get().pendingDeletionIds.has(selectionKey({ kind, id })),

  setCamera: (camera) => set({ camera }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  select: (entry, additive) =>
    set((state) => {
      const selection = additive ? new Map(state.selection) : new Map<string, SelectionEntry>();
      selection.set(selectionKey(entry), entry);
      return { selection };
    }),

  setSelection: (entries) => set({ selection: new Map(entries.map((e) => [selectionKey(e), e])) }),

  clearSelection: () => set({ selection: new Map() }),

  isSelected: (kind, id) => get().selection.has(selectionKey({ kind, id })),
}));
