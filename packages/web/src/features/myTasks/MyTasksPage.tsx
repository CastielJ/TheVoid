import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { AppShell } from "../../app/AppShell";
import { Card } from "../../ui/Card";

type SortKey = "dueDate" | "priority" | "status";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

/** D44: cross-Void, sortable/filterable list of Tasks assigned to the current User within this Organization. */
export function MyTasksPage() {
  const { orgId } = useParams<{ orgId: string }>();
  if (!orgId) throw new Error("orgId param is required");
  const navigate = useNavigate();

  const tasks = trpc.task.listMine.useQuery({ organizationId: orgId });
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const filtered = useMemo(() => {
    let rows = tasks.data ?? [];
    if (statusFilter) rows = rows.filter((t) => t.status === statusFilter);
    return [...rows].sort((a, b) => {
      if (sortKey === "dueDate") return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
      if (sortKey === "priority") {
        return (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9);
      }
      return a.status.localeCompare(b.status);
    });
  }, [tasks.data, sortKey, statusFilter]);

  return (
    <AppShell orgId={orgId}>
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div>
          <Link to={`/orgs/${orgId}`} style={{ fontSize: 13 }}>
            ← Organization
          </Link>
          <h1 style={{ fontSize: 22, marginTop: 4 }}>My Tasks</h1>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            Sort by{" "}
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="dueDate">Due date</option>
              <option value="priority">Priority</option>
              <option value="status">Status</option>
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            Status{" "}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((task) => (
            <Card
              key={task.id}
              onClick={() =>
                navigate(`/orgs/${orgId}/voids/${task.voidId}`, {
                  state: { focusX: task.x, focusY: task.y, focusTaskId: task.id },
                })
              }
              style={{
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{task.title}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  {STATUS_LABEL[task.status]}
                  {task.priority ? ` · ${task.priority}` : ""}
                  {task.dueDate ? ` · due ${task.dueDate}` : ""}
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
              No Tasks assigned to you{statusFilter ? " with this status" : ""}.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
