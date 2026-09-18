import { describe, expect, it, beforeEach } from "vitest";
import { useCanvasStore } from "./store";
import type { Task, Group, Edge } from "../trpc/types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    voidId: "void-1",
    groupId: null,
    title: "Task",
    description: null,
    status: "todo",
    priority: null,
    dueDate: null,
    x: 0,
    y: 0,
    version: 1,
    createdBy: "user-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Task;
}

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: "group-1",
    voidId: "void-1",
    name: "Group",
    x: 0,
    y: 0,
    width: 280,
    height: 160,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Group;
}

function makeEdge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: "edge-1",
    voidId: "void-1",
    sourceTaskId: "task-1",
    targetTaskId: "task-2",
    type: "flow",
    version: 1,
    createdBy: "user-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Edge;
}

beforeEach(() => {
  useCanvasStore.setState({
    voidId: "void-1",
    tasks: new Map(),
    groups: new Map(),
    edges: new Map(),
    selection: new Map(),
    pendingDeletionIds: new Set(),
    linkArmed: false,
    armedSourceTaskId: null,
    linkDraft: null,
    activeLinkType: "flow",
  });
});

describe("pendingDeletionIds", () => {
  it("marks and clears a Task as pending deletion", () => {
    const { markPendingDeletion, clearPendingDeletion, isPendingDeletion } =
      useCanvasStore.getState();

    expect(isPendingDeletion("task", "t1")).toBe(false);
    markPendingDeletion("task", "t1");
    expect(isPendingDeletion("task", "t1")).toBe(true);
    clearPendingDeletion("task", "t1");
    expect(isPendingDeletion("task", "t1")).toBe(false);
  });

  it("marks and clears a Group as pending deletion independently of a Task with the same id", () => {
    const { markPendingDeletion, isPendingDeletion } = useCanvasStore.getState();

    markPendingDeletion("task", "shared-id");
    expect(isPendingDeletion("task", "shared-id")).toBe(true);
    expect(isPendingDeletion("group", "shared-id")).toBe(false);
  });

  it("clearing an id that was never marked is a no-op", () => {
    const { clearPendingDeletion, isPendingDeletion } = useCanvasStore.getState();
    expect(() => clearPendingDeletion("task", "never-marked")).not.toThrow();
    expect(isPendingDeletion("task", "never-marked")).toBe(false);
  });

  it("tracks multiple pending ids independently", () => {
    const { markPendingDeletion, clearPendingDeletion, isPendingDeletion } =
      useCanvasStore.getState();
    markPendingDeletion("task", "a");
    markPendingDeletion("task", "b");
    clearPendingDeletion("task", "a");
    expect(isPendingDeletion("task", "a")).toBe(false);
    expect(isPendingDeletion("task", "b")).toBe(true);
  });

  it("also covers the 'edge' kind (third feature pass)", () => {
    const { markPendingDeletion, clearPendingDeletion, isPendingDeletion } =
      useCanvasStore.getState();
    expect(isPendingDeletion("edge", "edge-1")).toBe(false);
    markPendingDeletion("edge", "edge-1");
    expect(isPendingDeletion("edge", "edge-1")).toBe(true);
    clearPendingDeletion("edge", "edge-1");
    expect(isPendingDeletion("edge", "edge-1")).toBe(false);
  });
});

describe("Task Link creation UX state (third feature pass)", () => {
  it("armLinking/disarmLinking toggle linkArmed and reset armedSourceTaskId", () => {
    const { armLinking, disarmLinking, setArmedSource } = useCanvasStore.getState();
    armLinking();
    expect(useCanvasStore.getState().linkArmed).toBe(true);
    expect(useCanvasStore.getState().armedSourceTaskId).toBeNull();

    setArmedSource("task-1");
    expect(useCanvasStore.getState().armedSourceTaskId).toBe("task-1");

    disarmLinking();
    expect(useCanvasStore.getState().linkArmed).toBe(false);
    expect(useCanvasStore.getState().armedSourceTaskId).toBeNull();
  });

  it("startLinkDraft/updateLinkDraft/clearLinkDraft manage the drag-to-connect preview", () => {
    const { startLinkDraft, updateLinkDraft, clearLinkDraft } = useCanvasStore.getState();
    startLinkDraft("task-1", "dependency", 100, 200);
    expect(useCanvasStore.getState().linkDraft).toEqual({
      sourceTaskId: "task-1",
      type: "dependency",
      sourceScreenX: 100,
      sourceScreenY: 200,
      pointerScreenX: 100,
      pointerScreenY: 200,
      hoverTargetId: null,
    });

    updateLinkDraft(150, 250, "task-2");
    expect(useCanvasStore.getState().linkDraft).toMatchObject({
      pointerScreenX: 150,
      pointerScreenY: 250,
      hoverTargetId: "task-2",
      sourceTaskId: "task-1",
    });

    clearLinkDraft();
    expect(useCanvasStore.getState().linkDraft).toBeNull();
  });

  it("updateLinkDraft is a no-op when there is no active draft", () => {
    const { updateLinkDraft } = useCanvasStore.getState();
    expect(() => updateLinkDraft(1, 2, null)).not.toThrow();
    expect(useCanvasStore.getState().linkDraft).toBeNull();
  });

  it("hydrate resets linkArmed/armedSourceTaskId/linkDraft", () => {
    const { armLinking, setArmedSource, startLinkDraft, hydrate } = useCanvasStore.getState();
    armLinking();
    setArmedSource("task-1");
    startLinkDraft("task-1", "flow", 0, 0);

    hydrate("void-1", [], [], []);
    expect(useCanvasStore.getState().linkArmed).toBe(false);
    expect(useCanvasStore.getState().armedSourceTaskId).toBeNull();
    expect(useCanvasStore.getState().linkDraft).toBeNull();
  });
});

describe("applyTask version guard", () => {
  it("applies a Task with a newer version", () => {
    const { applyTask } = useCanvasStore.getState();
    applyTask(makeTask({ version: 1, title: "first" }));
    applyTask(makeTask({ version: 2, title: "second" }));
    expect(useCanvasStore.getState().tasks.get("task-1")?.title).toBe("second");
  });

  it("ignores a Task update with a stale (lower) version", () => {
    const { applyTask } = useCanvasStore.getState();
    applyTask(makeTask({ version: 5, title: "current" }));
    applyTask(makeTask({ version: 2, title: "stale" }));
    expect(useCanvasStore.getState().tasks.get("task-1")?.title).toBe("current");
  });
});

describe("removeTask", () => {
  it("is a no-op when the Task is already absent (idempotent, WS-echo safe)", () => {
    const { removeTask } = useCanvasStore.getState();
    expect(() => removeTask("does-not-exist")).not.toThrow();
    expect(useCanvasStore.getState().tasks.size).toBe(0);
  });

  it("removes the Task and its selection entry", () => {
    const { applyTask, select, removeTask } = useCanvasStore.getState();
    applyTask(makeTask());
    select({ kind: "task", id: "task-1" }, false);
    removeTask("task-1");
    expect(useCanvasStore.getState().tasks.has("task-1")).toBe(false);
    expect(useCanvasStore.getState().isSelected("task", "task-1")).toBe(false);
  });
});

describe("liveDragPosition (third feature pass: drag-perf decoupling)", () => {
  it("does not mutate the tasks/groups Maps, unlike setLocalPosition", () => {
    const { applyTask, setLiveDragPosition, setLocalPosition } = useCanvasStore.getState();
    applyTask(makeTask({ x: 0, y: 0 }));
    const tasksBefore = useCanvasStore.getState().tasks;

    setLiveDragPosition("task", "task-1", 999, 999);
    expect(useCanvasStore.getState().tasks).toBe(tasksBefore);
    expect(useCanvasStore.getState().tasks.get("task-1")?.x).toBe(0);
    expect(useCanvasStore.getState().liveDragPosition).toEqual({
      kind: "task",
      id: "task-1",
      x: 999,
      y: 999,
    });

    setLocalPosition("task", "task-1", 999, 999);
    expect(useCanvasStore.getState().tasks).not.toBe(tasksBefore);
    expect(useCanvasStore.getState().tasks.get("task-1")?.x).toBe(999);
  });

  it("clearLiveDragPosition resets it to null without touching tasks/groups", () => {
    const { setLiveDragPosition, clearLiveDragPosition } = useCanvasStore.getState();
    setLiveDragPosition("group", "group-1", 10, 20);
    expect(useCanvasStore.getState().liveDragPosition).not.toBeNull();
    clearLiveDragPosition();
    expect(useCanvasStore.getState().liveDragPosition).toBeNull();
  });
});

describe("applyGroup version guard and removeGroup", () => {
  it("ignores a stale Group update", () => {
    const { applyGroup } = useCanvasStore.getState();
    applyGroup(makeGroup({ version: 3, name: "current" }));
    applyGroup(makeGroup({ version: 1, name: "stale" }));
    expect(useCanvasStore.getState().groups.get("group-1")?.name).toBe("current");
  });

  it("removeGroup is a no-op when already absent", () => {
    const { removeGroup } = useCanvasStore.getState();
    expect(() => removeGroup("does-not-exist")).not.toThrow();
  });
});

describe("applyEdge version guard and removeEdge (third feature pass)", () => {
  it("applies an Edge and ignores a stale (lower-version) update, mirroring applyTask/applyGroup", () => {
    const { applyEdge } = useCanvasStore.getState();
    applyEdge(makeEdge({ version: 3, type: "dependency" }));
    applyEdge(makeEdge({ version: 1, type: "flow" }));
    expect(useCanvasStore.getState().edges.get("edge-1")?.type).toBe("dependency");
  });

  it("removeEdge is a no-op when already absent (idempotent, WS-echo safe)", () => {
    const { removeEdge } = useCanvasStore.getState();
    expect(() => removeEdge("does-not-exist")).not.toThrow();
    expect(useCanvasStore.getState().edges.size).toBe(0);
  });

  it("removeEdge removes the Edge and its selection entry", () => {
    const { applyEdge, select, removeEdge } = useCanvasStore.getState();
    applyEdge(makeEdge());
    select({ kind: "edge", id: "edge-1" }, false);
    removeEdge("edge-1");
    expect(useCanvasStore.getState().edges.has("edge-1")).toBe(false);
    expect(useCanvasStore.getState().isSelected("edge", "edge-1")).toBe(false);
  });
});

describe("measuredFootprints", () => {
  it("sets and clears a Task's measured footprint", () => {
    const { setMeasuredFootprint, clearMeasuredFootprint } = useCanvasStore.getState();
    setMeasuredFootprint("task-1", { width: 320, height: 512 });
    expect(useCanvasStore.getState().measuredFootprints.get("task-1")).toEqual({
      width: 320,
      height: 512,
    });
    clearMeasuredFootprint("task-1");
    expect(useCanvasStore.getState().measuredFootprints.has("task-1")).toBe(false);
  });

  it("clearing an unmeasured Task is a no-op", () => {
    const { clearMeasuredFootprint } = useCanvasStore.getState();
    expect(() => clearMeasuredFootprint("never-measured")).not.toThrow();
  });
});
