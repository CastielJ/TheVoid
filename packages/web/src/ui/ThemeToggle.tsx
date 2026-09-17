import { useTheme } from "../app/theme";

/**
 * Second feature pass — sun/moon light/dark toggle. Lives once, in the new
 * left panel (app/LeftPanel.tsx) — no duplicate copy elsewhere, to avoid
 * state-sync duplication. Cycles light -> dark -> system -> light (rather
 * than a plain two-state switch) so "system" stays reachable without a
 * separate control.
 */
export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();

  function cycle() {
    if (preference === "light") setPreference("dark");
    else if (preference === "dark") setPreference("system");
    else setPreference("light");
  }

  const label =
    preference === "system"
      ? `System (currently ${resolved})`
      : preference === "light"
        ? "Light"
        : "Dark";

  return (
    <button
      type="button"
      onClick={cycle}
      className="void-icon-btn"
      aria-label={`Theme: ${label}. Click to change.`}
      title={`Theme: ${label}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "8px 10px",
        background: "none",
        border: "none",
        color: "var(--color-text)",
        fontSize: 13,
      }}
    >
      <span key={resolved} className="void-theme-icon" style={{ fontSize: 16 }} aria-hidden="true">
        {resolved === "dark" ? "🌙" : "☀️"}
      </span>
      <span>{label}</span>
    </button>
  );
}
