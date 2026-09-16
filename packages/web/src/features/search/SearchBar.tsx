import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../../trpc/client";

const DEBOUNCE_MS = 250;

/**
 * D43: global search scoped to the current Organization. Selecting a
 * result navigates to the object's Void and centers the camera on its
 * persisted coordinates (CanvasPage/CanvasViewport's focusTarget prop).
 */
export function SearchBar({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const results = trpc.search.search.useQuery(
    { organizationId: orgId, query: debounced },
    { enabled: debounced.trim().length > 0 },
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(result: NonNullable<typeof results.data>[number]) {
    setOpen(false);
    setQuery("");
    navigate(`/orgs/${orgId}/voids/${result.voidId}`, {
      state: {
        focusX: result.x,
        focusY: result.y,
        focusTaskId: result.type === "task" ? result.id : undefined,
      },
    });
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: 260 }}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search tasks & groups…"
        aria-label="Search"
        style={{
          width: "100%",
          padding: "6px 10px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border-strong)",
          fontSize: 13,
        }}
      />
      {open && debounced.trim() && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 20,
          }}
        >
          {results.data?.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, color: "var(--color-text-muted)" }}>
              No results.
            </div>
          )}
          {results.data?.map((r) => (
            <button
              key={`${r.type}:${r.id}`}
              onClick={() => handleSelect(r)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                background: "none",
                border: "none",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <div style={{ fontSize: 13 }}>{r.title}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                {r.type === "task" ? "Task" : "Group"} · {r.voidName}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
