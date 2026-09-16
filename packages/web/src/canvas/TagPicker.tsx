import { useMemo, useRef, useState } from "react";
import { trpc } from "../trpc/client";

/**
 * Organization-scoped tag picker (post-launch refinement pass). Purely a
 * "current list of tag name strings" editor — actual find-or-create/persist
 * happens server-side inline through task.update/group.update's
 * `tagNames` (see domains/tag/tags.ts), not through a separate create call
 * here. `onChange` fires immediately on every add/remove; the caller
 * decides whether that means "save now" (TaskDetailPanel, GroupDetailPanel)
 * or "hold until the creation form submits" (CanvasCreationPanel).
 */
export function TagPicker({
  voidId,
  selected,
  onChange,
}: {
  voidId: string;
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  const existingTags = trpc.tag.list.useQuery({ voidId });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const selectedLower = new Set(selected.map((s) => s.toLowerCase()));
    return (existingTags.data ?? [])
      .map((t) => t.name)
      .filter((name) => !selectedLower.has(name.toLowerCase()))
      .filter((name) => (q ? name.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [existingTags.data, query, selected]);

  const exactMatchExists = (existingTags.data ?? []).some(
    (t) => t.name.toLowerCase() === query.trim().toLowerCase(),
  );

  function addTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (selected.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setQuery("");
      return;
    }
    onChange([...selected, trimmed]);
    setQuery("");
  }

  function removeTag(name: string) {
    onChange(selected.filter((s) => s !== name));
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          padding: "6px 8px",
          background: "var(--canvas-bg)",
          border: "1px solid var(--canvas-border)",
          borderRadius: "var(--radius-sm)",
          minHeight: 34,
        }}
      >
        {selected.map((name) => (
          <span
            key={name}
            className="void-fade-in"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              padding: "3px 6px 3px 8px",
              borderRadius: 999,
              background: "rgba(99, 102, 241, 0.16)",
              color: "var(--canvas-text)",
            }}
          >
            {name}
            <button
              type="button"
              aria-label={`Remove tag ${name}`}
              onClick={() => removeTag(name)}
              style={{
                background: "none",
                border: "none",
                color: "var(--canvas-text-muted)",
                cursor: "pointer",
                fontSize: 13,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          aria-label="Add a tag"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(query);
            }
          }}
          placeholder={selected.length === 0 ? "Add tags…" : ""}
          style={{
            flex: 1,
            minWidth: 80,
            background: "transparent",
            border: "none",
            color: "var(--canvas-text)",
            fontSize: 13,
            outline: "none",
          }}
        />
      </div>

      {open && (query.trim().length > 0 || suggestions.length > 0) && (
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
            overflow: "hidden",
            transformOrigin: "top left",
          }}
        >
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(name)}
              style={suggestionButtonStyle}
            >
              {name}
            </button>
          ))}
          {query.trim().length > 0 && !exactMatchExists && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(query)}
              style={{ ...suggestionButtonStyle, color: "var(--color-accent)" }}
            >
              Create "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const suggestionButtonStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "7px 10px",
  background: "none",
  border: "none",
  color: "var(--canvas-text)",
  fontSize: 13,
  cursor: "pointer",
};
