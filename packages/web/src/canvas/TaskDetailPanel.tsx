import { useEffect, useState } from "react";
import { trpc } from "../trpc/client";
import { useCanvasStore } from "./store";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

const STATUS_OPTIONS = ["todo", "in_progress", "done", "blocked"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;

export function TaskDetailPanel({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useCanvasStore((s) => s.tasks.get(taskId));
  const applyTask = useCanvasStore((s) => s.applyTask);
  const removeTask = useCanvasStore((s) => s.removeTask);
  const voidId = useCanvasStore((s) => s.voidId);

  const utils = trpc.useUtils();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [tagsText, setTagsText] = useState((task?.tags ?? []).join(", "));

  useEffect(() => {
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setTagsText((task?.tags ?? []).join(", "));
  }, [task?.id]);

  const update = trpc.task.update.useMutation({
    onSuccess: (updated) => applyTask(updated),
  });
  const deleteTask = trpc.task.delete.useMutation({
    onSuccess: () => {
      removeTask(taskId);
      onClose();
    },
  });
  const duplicateTask = trpc.task.duplicate.useMutation({
    onSuccess: (created) => applyTask(created),
  });

  const assignees = trpc.task.listAssignees.useQuery({ taskId });
  const grants = trpc.void.listAccessGrants.useQuery(
    { voidId: voidId! },
    { enabled: Boolean(voidId), retry: false },
  );
  // A Void's access grants can target a Team, not just a User directly
  // (D14) — eligible assignees must include every member of any granted
  // Team, or a Manager could never assign a Task to someone whose access
  // comes entirely through Team membership (the common case for a
  // Team-associated Void).
  const teamGrantIds = [
    ...new Set((grants.data ?? []).filter((g) => g.teamId).map((g) => g.teamId!)),
  ];
  const teamMemberQueries = trpc.useQueries((t) =>
    teamGrantIds.map((teamId) => t.team.listMembers({ teamId })),
  );

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

  const eligibleUserIds = new Set(
    (grants.data ?? []).filter((g) => g.userId).map((g) => g.userId!),
  );
  // Team-membership queries are also the only source of email addresses
  // available here (direct user-grants carry no email) — used to render
  // human-readable names instead of raw UUIDs wherever we have one.
  const emailByUserId = new Map<string, string>();
  for (const query of teamMemberQueries) {
    for (const member of query.data ?? []) {
      eligibleUserIds.add(member.userId);
      emailByUserId.set(member.userId, member.email);
    }
  }
  const assignedUserIds = new Set(
    (assignees.data ?? []).filter((a) => a.assigneeActive).map((a) => a.userId),
  );
  const candidateUserIds = [...eligibleUserIds].filter((id) => !assignedUserIds.has(id));

  if (!task) return null;

  return (
    <aside
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        background: "var(--canvas-surface)",
        borderLeft: "1px solid var(--canvas-border)",
        color: "var(--canvas-text)",
        overflowY: "auto",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
      data-testid="task-detail-panel"
      role="complementary"
      aria-label="Task details"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <input
          aria-label="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && update.mutate({ taskId, title })}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--canvas-text)",
            fontSize: 17,
            fontWeight: 600,
            width: "100%",
          }}
        />
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            color: "var(--canvas-text-muted)",
            fontSize: 18,
          }}
        >
          ×
        </button>
      </div>

      <textarea
        aria-label="Description"
        value={description}
        placeholder="Description…"
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() =>
          description !== (task.description ?? "") &&
          update.mutate({ taskId, description: description || null })
        }
        rows={3}
        style={{
          background: "var(--canvas-bg)",
          border: "1px solid var(--canvas-border)",
          borderRadius: "var(--radius-sm)",
          color: "var(--canvas-text)",
          padding: 8,
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Status">
          <select
            aria-label="Status"
            value={task.status}
            onChange={(e) =>
              update.mutate({ taskId, status: e.target.value as (typeof STATUS_OPTIONS)[number] })
            }
            style={selectStyle}
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
                priority: (e.target.value || null) as (typeof PRIORITY_OPTIONS)[number] | null,
              })
            }
            style={selectStyle}
          >
            <option value="">—</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
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
          style={selectStyle}
        />
      </Field>

      <Field label="Tags (comma-separated)">
        <Input
          aria-label="Tags (comma-separated)"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          onBlur={() =>
            update.mutate({
              taskId,
              tags: tagsText
                .split(",")
                .map((t: string) => t.trim())
                .filter(Boolean),
            })
          }
          style={{
            background: "var(--canvas-bg)",
            color: "var(--canvas-text)",
            borderColor: "var(--canvas-border)",
          }}
        />
      </Field>

      <section>
        <SectionTitle>Assignees</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {assignees.data
            ?.filter((a) => a.assigneeActive)
            .map((a) => (
              <div key={a.userId} style={rowStyle}>
                <span style={{ fontSize: 13 }}>
                  {emailByUserId.get(a.userId) ?? `${a.userId.slice(0, 8)}…`}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => unassign.mutate({ taskId, userId: a.userId })}
                >
                  Remove
                </Button>
              </div>
            ))}
          {assignees.data?.some((a) => !a.assigneeActive) && (
            <p style={{ fontSize: 12, color: "var(--canvas-text-muted)" }}>
              (some assignees are inactive — the member left the Organization)
            </p>
          )}
        </div>
        {grants.isSuccess && candidateUserIds.length > 0 && (
          <select
            aria-label="Assign someone"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) assign.mutate({ taskId, userId: e.target.value });
              e.target.value = "";
            }}
            style={{ ...selectStyle, marginTop: 8 }}
          >
            <option value="">Assign someone…</option>
            {candidateUserIds.map((id) => (
              <option key={id} value={id}>
                {emailByUserId.get(id) ?? `${id.slice(0, 8)}…`}
              </option>
            ))}
          </select>
        )}
        {grants.isError && (
          <p style={{ fontSize: 12, color: "var(--canvas-text-muted)" }}>
            Only a Void Manager can assign people to Tasks.
          </p>
        )}
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
            style={{ ...selectStyle, flex: 1 }}
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
            placeholder="Write a comment…"
            style={{ ...selectStyle, flex: 1 }}
          />
          <Button type="submit" variant="secondary">
            Send
          </Button>
        </form>
      </section>

      <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 12 }}>
        <Button variant="secondary" onClick={() => duplicateTask.mutate({ taskId })}>
          Duplicate
        </Button>
        <Button variant="danger" onClick={() => deleteTask.mutate({ taskId })}>
          Delete
        </Button>
      </div>
    </aside>
  );
}

const selectStyle: React.CSSProperties = {
  background: "var(--canvas-bg)",
  border: "1px solid var(--canvas-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--canvas-text)",
  padding: "6px 8px",
  fontSize: 13,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
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
