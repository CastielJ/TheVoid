import { memo, useEffect, useRef, useState } from "react";
import { taskPriorityValues, taskPriorityLabels } from "@void/shared";
import { trpc } from "../trpc/client";
import { useCanvasStore } from "./store";
import { Button } from "../ui/Button";
import { TagPicker } from "./TagPicker";
import { AssigneePicker } from "./AssigneePicker";
import type { Task } from "../trpc/types";

const DRAG_THRESHOLD_PX = 3;
const STATUS_OPTIONS = ["todo", "in_progress", "done", "blocked"] as const;

export interface TaskSummary {
  taskId: string;
  checklistCount: number;
  checklistDoneCount: number;
  commentCount: number;
  tagCount: number;
  assigneeCount: number;
}

/**
 * Second feature pass — replaces the old fixed-size card + double-click-
 * opens-a-side-panel model entirely. Two states: compact (default — title,
 * a done/undone toggle, priority dot, status/due date, and count-only
 * badges sourced from a batched summary query, never a per-card fetch) and
 * expanded (click to toggle — inlines everything TaskDetailPanel used to
 * render: description, status/priority/due date, tags, assignees,
 * checklist, comments, duplicate/delete). Full-content queries only run
 * once expanded (`enabled: isExpanded`), keeping the default render path
 * cheap for the ~1,500-task virtualization target.
 */
/**
 * Performance pass: no longer takes `zoom` as a prop (previously forced a
 * re-render of every visible card on every camera pan/zoom tick, since the
 * value genuinely changes every frame) — drag math reads the current zoom
 * fresh from the store inside the handler instead. Combined with
 * React.memo, a card now only re-renders when its own task/summary/expand/
 * selection state actually changes.
 */
export const TaskCard = memo(function TaskCard({
  task,
  summary,
}: {
  task: Task;
  summary: TaskSummary | undefined;
}) {
  const isSelected = useCanvasStore((s) => s.isSelected("task", task.id));
  const isExpanded = useCanvasStore((s) => s.isExpanded(task.id));
  const toggleExpanded = useCanvasStore((s) => s.toggleExpanded);
  const select = useCanvasStore((s) => s.select);
  const setLocalPosition = useCanvasStore((s) => s.setLocalPosition);
  const setDraggingTaskId = useCanvasStore((s) => s.setDraggingTaskId);
  const applyTask = useCanvasStore((s) => s.applyTask);
  const removeTask = useCanvasStore((s) => s.removeTask);
  const voidId = useCanvasStore((s) => s.voidId);
  const utils = trpc.useUtils();

  const move = trpc.task.move.useMutation({ onSuccess: (updated) => applyTask(updated) });
  const update = trpc.task.update.useMutation({ onSuccess: (updated) => applyTask(updated) });
  const deleteTask = trpc.task.delete.useMutation({ onSuccess: () => removeTask(task.id) });
  const duplicateTask = trpc.task.duplicate.useMutation({
    onSuccess: (created) => applyTask(created),
  });

  const dragState = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    startWorldX: number;
    startWorldY: number;
    moved: boolean;
  } | null>(null);

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = {
      pointerId: e.pointerId,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startWorldX: task.x,
      startWorldY: task.y,
      moved: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const zoom = useCanvasStore.getState().camera.zoom;
    const dx = (e.clientX - drag.startScreenX) / zoom;
    const dy = (e.clientY - drag.startScreenY) / zoom;
    if (
      !drag.moved &&
      Math.hypot(e.clientX - drag.startScreenX, e.clientY - drag.startScreenY) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    if (!drag.moved) setDraggingTaskId(task.id);
    drag.moved = true;
    setLocalPosition("task", task.id, drag.startWorldX + dx, drag.startWorldY + dy);
  }

  function handlePointerUp(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragState.current = null;
    if (drag.moved) {
      setDraggingTaskId(null);
      const current = useCanvasStore.getState().tasks.get(task.id);
      if (current) move.mutate({ taskId: task.id, x: current.x, y: current.y });
    } else {
      select({ kind: "task", id: task.id }, e.shiftKey);
      toggleExpanded(task.id);
    }
  }

  function toggleDone(e: React.MouseEvent) {
    e.stopPropagation();
    update.mutate({ taskId: task.id, status: task.status === "done" ? "todo" : "done" });
  }

  return (
    <div
      data-testid="task-card"
      data-task-id={task.id}
      onPointerDown={isExpanded ? undefined : handlePointerDown}
      onPointerMove={isExpanded ? undefined : handlePointerMove}
      onPointerUp={isExpanded ? undefined : handlePointerUp}
      style={{
        position: "absolute",
        left: task.x,
        top: task.y,
        width: isExpanded ? 320 : 220,
        background: "var(--canvas-surface)",
        border: `1px solid ${isSelected ? "var(--canvas-selection-border)" : "var(--canvas-border)"}`,
        boxShadow: isSelected ? "0 0 0 3px var(--canvas-selection)" : "var(--shadow-sm)",
        borderRadius: "var(--radius-md)",
        color: "var(--canvas-text)",
        userSelect: "none",
        touchAction: "none",
        zIndex: isExpanded ? 10 : undefined,
        cursor: isExpanded ? "default" : "grab",
        transition:
          "border-color var(--motion-fast) var(--ease-standard), box-shadow var(--motion-fast) var(--ease-standard), width var(--motion-base) var(--ease-standard)",
      }}
    >
      <CardHeader
        task={task}
        isExpanded={isExpanded}
        onToggleDone={toggleDone}
        onDragPointerDown={isExpanded ? handlePointerDown : undefined}
        onDragPointerMove={isExpanded ? handlePointerMove : undefined}
        onDragPointerUp={isExpanded ? handlePointerUp : undefined}
        onCollapse={() => toggleExpanded(task.id)}
        onCommitTitle={(title) => update.mutate({ taskId: task.id, title })}
      />

      {!isExpanded && <CompactBody task={task} summary={summary} />}

      {isExpanded && voidId && (
        <ExpandedBody
          task={task}
          voidId={voidId}
          update={update}
          onDelete={() => deleteTask.mutate({ taskId: task.id })}
          onDuplicate={() => duplicateTask.mutate({ taskId: task.id })}
          onSetTagNames={(tagNames) => {
            update.mutate({ taskId: task.id, tagNames });
            utils.task.listSummaries.invalidate({ voidId });
          }}
        />
      )}
    </div>
  );
});

function CardHeader({
  task,
  isExpanded,
  onToggleDone,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
  onCollapse,
  onCommitTitle,
}: {
  task: Task;
  isExpanded: boolean;
  onToggleDone: (e: React.MouseEvent) => void;
  onDragPointerDown?: (e: React.PointerEvent) => void;
  onDragPointerMove?: (e: React.PointerEvent) => void;
  onDragPointerUp?: (e: React.PointerEvent) => void;
  onCollapse: () => void;
  onCommitTitle: (title: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.id, task.title]);

  return (
    <div
      onPointerDown={onDragPointerDown}
      onPointerMove={onDragPointerMove}
      onPointerUp={onDragPointerUp}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: 12,
        paddingBottom: isExpanded ? 8 : 12,
        cursor: isExpanded ? "grab" : undefined,
      }}
    >
      <input
        type="checkbox"
        checked={task.status === "done"}
        onChange={() => {}}
        onClick={onToggleDone}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={task.status === "done" ? "Mark as not done" : "Mark as done"}
        style={{ marginTop: 3, flexShrink: 0, cursor: "pointer" }}
      />
      {isExpanded ? (
        <input
          aria-label="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={() => title.trim() && title !== task.title && onCommitTitle(title)}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            color: "var(--canvas-text)",
            fontSize: 14,
            fontWeight: 600,
            minWidth: 0,
          }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.3,
            textDecoration: task.status === "done" ? "line-through" : "none",
            opacity: task.status === "done" ? 0.6 : 1,
          }}
        >
          {task.title}
        </span>
      )}
      {task.priority && (
        <span
          title={task.priority}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            marginTop: 5,
            background: `var(--color-priority-${task.priority})`,
          }}
        />
      )}
      {isExpanded && (
        <button
          onClick={onCollapse}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Collapse"
          className="void-icon-btn"
          style={{
            background: "none",
            border: "none",
            color: "var(--canvas-text-muted)",
            fontSize: 16,
            flexShrink: 0,
            marginTop: -2,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function CompactBody({ task, summary }: { task: Task; summary: TaskSummary | undefined }) {
  const badges: string[] = [];
  if (summary?.checklistCount)
    badges.push(`☑ ${summary.checklistDoneCount}/${summary.checklistCount}`);
  if (summary?.commentCount) badges.push(`💬 ${summary.commentCount}`);
  if (summary?.tagCount) badges.push(`🏷 ${summary.tagCount}`);
  if (summary?.assigneeCount) badges.push(`👤 ${summary.assigneeCount}`);

  return (
    <div style={{ padding: "0 12px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontSize: 11,
            color: `var(--color-status-${task.status})`,
            fontWeight: 500,
          }}
        >
          {task.status.replace("_", " ")}
        </span>
        {task.dueDate && (
          <span style={{ fontSize: 11, color: "var(--canvas-text-muted)" }}>{task.dueDate}</span>
        )}
      </div>
      {badges.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 8,
            fontSize: 11,
            color: "var(--canvas-text-muted)",
          }}
        >
          {badges.map((b) => (
            <span key={b}>{b}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpandedBody({
  task,
  voidId,
  update,
  onDelete,
  onDuplicate,
  onSetTagNames,
}: {
  task: Task;
  voidId: string;
  update: ReturnType<typeof trpc.task.update.useMutation>;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetTagNames: (tagNames: string[]) => void;
}) {
  const taskId = task.id;
  const utils = trpc.useUtils();
  const [description, setDescription] = useState(task.description ?? "");
  useEffect(() => setDescription(task.description ?? ""), [task.id, task.description]);

  const assignees = trpc.task.listAssignees.useQuery({ taskId });
  const tags = trpc.task.listTags.useQuery({ taskId });
  const members = trpc.void.listEligibleMembers.useQuery({ voidId });
  const memberByUserId = new Map((members.data ?? []).map((m) => [m.userId, m]));

  const assign = trpc.task.assign.useMutation({
    onSuccess: () => utils.task.listAssignees.invalidate({ taskId }),
  });
  const unassign = trpc.task.unassign.useMutation({
    onSuccess: () => utils.task.listAssignees.invalidate({ taskId }),
  });

  const checklist = trpc.task.listChecklistItems.useQuery({ taskId });
  const addChecklistItem = trpc.task.addChecklistItem.useMutation({
    onSuccess: () => utils.task.listChecklistItems.invalidate({ taskId }),
  });
  const toggleChecklistItem = trpc.task.toggleChecklistItem.useMutation({
    onSuccess: () => utils.task.listChecklistItems.invalidate({ taskId }),
  });
  const deleteChecklistItem = trpc.task.deleteChecklistItem.useMutation({
    onSuccess: () => utils.task.listChecklistItems.invalidate({ taskId }),
  });
  const [newChecklistLabel, setNewChecklistLabel] = useState("");

  const comments = trpc.task.listComments.useQuery({ taskId });
  const addComment = trpc.task.addComment.useMutation({
    onSuccess: () => {
      setNewComment("");
      return utils.task.listComments.invalidate({ taskId });
    },
  });
  const [newComment, setNewComment] = useState("");

  const activeAssigneeIds = (assignees.data ?? [])
    .filter((a) => a.assigneeActive)
    .map((a) => a.userId);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        padding: "0 12px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        cursor: "default",
      }}
    >
      <textarea
        aria-label="Description"
        value={description}
        placeholder="Description…"
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() =>
          description !== (task.description ?? "") &&
          update.mutate({ taskId, description: description || null })
        }
        rows={2}
        style={{ ...fieldStyle, resize: "vertical" }}
      />

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Status">
          <select
            aria-label="Status"
            value={task.status}
            onChange={(e) =>
              update.mutate({ taskId, status: e.target.value as (typeof STATUS_OPTIONS)[number] })
            }
            style={fieldStyle}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select
            aria-label="Priority"
            value={task.priority ?? ""}
            onChange={(e) =>
              update.mutate({
                taskId,
                priority: (e.target.value || null) as (typeof taskPriorityValues)[number] | null,
              })
            }
            style={fieldStyle}
          >
            <option value="">—</option>
            {taskPriorityValues.map((p) => (
              <option key={p} value={p}>
                {taskPriorityLabels[p]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Due date">
        <input
          aria-label="Due date"
          type="date"
          value={task.dueDate ?? ""}
          onChange={(e) => update.mutate({ taskId, dueDate: e.target.value || null })}
          style={fieldStyle}
        />
      </Field>

      <Field label="Tags">
        <TagPicker
          voidId={voidId}
          selected={(tags.data ?? []).map((t) => t.name)}
          onChange={onSetTagNames}
        />
      </Field>

      <section>
        <SectionTitle>Assignees</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {assignees.data
            ?.filter((a) => a.assigneeActive)
            .map((a) => {
              const member = memberByUserId.get(a.userId);
              return (
                <div key={a.userId} style={rowStyle}>
                  <span style={{ fontSize: 13 }}>
                    {member
                      ? `${member.visibleName} (@${member.username})`
                      : `${a.userId.slice(0, 8)}…`}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => unassign.mutate({ taskId, userId: a.userId })}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
        </div>
        <div style={{ marginTop: 8 }}>
          <AssigneePicker
            voidId={voidId}
            excludeUserIds={activeAssigneeIds}
            onSelect={(userId) => assign.mutate({ taskId, userId })}
          />
        </div>
      </section>

      <section>
        <SectionTitle>Checklist</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {checklist.data?.map((item) => (
            <label key={item.id} style={{ ...rowStyle, cursor: "pointer" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={item.isComplete}
                  onChange={(e) =>
                    toggleChecklistItem.mutate({ itemId: item.id, isComplete: e.target.checked })
                  }
                />
                <span
                  style={{
                    textDecoration: item.isComplete ? "line-through" : "none",
                    fontSize: 13,
                    opacity: item.isComplete ? 0.6 : 1,
                  }}
                >
                  {item.label}
                </span>
              </span>
              <button
                onClick={() => deleteChecklistItem.mutate({ itemId: item.id })}
                aria-label={`Delete checklist item: ${item.label}`}
                style={{ background: "none", border: "none", color: "var(--canvas-text-muted)" }}
              >
                ×
              </button>
            </label>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newChecklistLabel.trim()) return;
            addChecklistItem.mutate({ taskId, label: newChecklistLabel.trim() });
            setNewChecklistLabel("");
          }}
          style={{ display: "flex", gap: 6, marginTop: 6 }}
        >
          <input
            aria-label="New checklist item"
            value={newChecklistLabel}
            onChange={(e) => setNewChecklistLabel(e.target.value)}
            placeholder="Add item…"
            style={{ ...fieldStyle, flex: 1 }}
          />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      </section>

      <section>
        <SectionTitle>Comments</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {comments.data?.map((c) => (
            <div
              key={c.id}
              style={{ fontSize: 13, background: "var(--canvas-bg)", borderRadius: 6, padding: 8 }}
            >
              {c.body}
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newComment.trim()) return;
            addComment.mutate({ taskId, body: newComment.trim() });
          }}
          style={{ display: "flex", gap: 6, marginTop: 6 }}
        >
          <input
            aria-label="Write a comment"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Write a comment… (@username to mention)"
            style={{ ...fieldStyle, flex: 1 }}
          />
          <Button type="submit" variant="secondary">
            Send
          </Button>
        </form>
      </section>

      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="secondary" onClick={onDuplicate}>
          Duplicate
        </Button>
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  background: "var(--canvas-bg)",
  border: "1px solid var(--canvas-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--canvas-text)",
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--canvas-text-muted)", textTransform: "uppercase" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 12,
        textTransform: "uppercase",
        color: "var(--canvas-text-muted)",
        margin: "0 0 8px",
      }}
    >
      {children}
    </h3>
  );
}
