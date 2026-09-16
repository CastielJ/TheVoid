import { useState } from "react";
import { trpc } from "../trpc/client";

/**
 * Searchable "Search members..." -> "Alex Johnson (@alex)" picker (post-
 * launch refinement pass) — replaces raw-UUID/email dropdowns. Backed by
 * void.listEligibleMembers, which is itself authorization-scoped (never
 * returns a user without current access to this Void), so nothing extra is
 * needed here beyond excluding already-assigned users client-side.
 */
export function AssigneePicker({
  voidId,
  excludeUserIds,
  onSelect,
}: {
  voidId: string;
  excludeUserIds: string[];
  onSelect: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const excluded = new Set(excludeUserIds);

  const results = trpc.void.listEligibleMembers.useQuery(
    { voidId, query: query.trim() || undefined },
    { enabled: open },
  );

  const filtered = (results.data ?? []).filter((m) => !excluded.has(m.userId));

  return (
    <div style={{ position: "relative" }}>
      <input
        aria-label="Search members…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search members…"
        style={{
          width: "100%",
          background: "var(--canvas-bg)",
          border: "1px solid var(--canvas-border)",
          borderRadius: "var(--radius-sm)",
          color: "var(--canvas-text)",
          padding: "6px 8px",
          fontSize: 13,
        }}
      />
      {open && (
        <div
          className="void-pop-in"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--canvas-surface)",
            border: "1px solid var(--canvas-border)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "var(--shadow-md)",
            zIndex: 30,
            maxHeight: 220,
            overflowY: "auto",
            transformOrigin: "top left",
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--canvas-text-muted)" }}>
              {results.isLoading ? "Searching…" : "No eligible members found."}
            </div>
          )}
          {filtered.map((m) => (
            <button
              key={m.userId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(m.userId);
                setQuery("");
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                background: "none",
                border: "none",
                color: "var(--canvas-text)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {m.visibleName}{" "}
              <span style={{ color: "var(--canvas-text-muted)" }}>@{m.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
