import { create } from "zustand";
import type { Task, Group } from "../trpc/types";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "evicted" | "deleted";

export type SelectionEntry = { kind: "task"; id: string } | { kind: "group"; id: string };

export interface GroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasState {
  voidId: string | null;
  tasks: Map<string, Task>;
  groups: Map<string, Group>;
  camera: { x: number; y: number; zoom: number };
  selection: Map<string, SelectionEntry>;
  connectionStatus: ConnectionStatus;

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

  // Client-only, ephemeral "if dropped here, this Group would resize to..."
  // preview — never the real persisted group.width/height. Keyed by groupId;
  // cleared on drag end.
  previewGroupBounds: Map<string, GroupBounds>;
  setPreviewGroupBounds: (groupId: string, bounds: GroupBounds) => void;
  clearPreviewGroupBounds: () => void;

  hydrate: (voidId: string, tasks: Task[], groups: Group[]) => void;
  applyTask: (task: Task) => void;
  removeTask: (id: string) => void;
  applyGroup: (group: Group) => void;
  removeGroup: (id: string) => void;
  /** Local-only override during drag, bypassing version bookkeeping entirely — overwritten once the move mutation resolves. */
  setLocalPosition: (kind: "task" | "group", id: string, x: number, y: number) => void;

  setCamera: (camera: { x: number; y: number; zoom: number }) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;

  select: (entry: SelectionEntry, additive: boolean) => void;
  setSelection: (entries: SelectionEntry[]) => void;
  clearSelection: () => void;
  isSelected: (kind: "task" | "group", id: string) => boolean;
}

function selectionKey(entry: SelectionEntry): string {
  return `${entry.kind}:${entry.id}`;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  voidId: null,
  tasks: new Map(),
  groups: new Map(),
  camera: { x: 0, y: 0, zoom: 1 },
  selection: new Map(),
  connectionStatus: "connecting",
  expandedTaskIds: new Set(),
  draggingTaskId: null,
  previewGroupBounds: new Map(),

  toggleExpanded: (taskId) =>
    set((state) => {
      const expandedTaskIds = new Set(state.expandedTaskIds);
      if (expandedTaskIds.has(taskId)) expandedTaskIds.delete(taskId);
      else expandedTaskIds.add(taskId);
      return { expandedTaskIds };
    }),
  isExpanded: (taskId) => get().expandedTaskIds.has(taskId),

  setDraggingTaskId: (taskId) => set({ draggingTaskId: taskId }),

  setPreviewGroupBounds: (groupId, bounds) =>
    set((state) => {
      const previewGroupBounds = new Map(state.previewGroupBounds);
      previewGroupBounds.set(groupId, bounds);
      return { previewGroupBounds };
    }),
  clearPreviewGroupBounds: () => set({ previewGroupBounds: new Map() }),

  hydrate: (voidId, tasks, groups) =>
    set({
      voidId,
      tasks: new Map(tasks.map((t) => [t.id, t])),
      groups: new Map(groups.map((g) => [g.id, g])),
      selection: new Map(),
      expandedTaskIds: new Set(),
      draggingTaskId: null,
      previewGroupBounds: new Map(),
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
