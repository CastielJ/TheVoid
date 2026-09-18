import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows an inline spinner and disables the button — for an in-flight mutation. */
  loading?: boolean;
}

const base: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  borderRadius: "var(--radius-sm)" as unknown as string,
  padding: "8px 14px",
  fontSize: 14,
  fontWeight: 500,
  border: "1px solid transparent",
  transition:
    "background-color var(--motion-fast) var(--ease-standard), border-color var(--motion-fast) var(--ease-standard), transform var(--motion-fast) var(--ease-standard), box-shadow var(--motion-fast) var(--ease-standard)",
};

const variants: Record<Variant, React.CSSProperties> = {
  primary: {
    // accent-hover, not accent — white text on plain accent is ~4.47:1,
    // just under WCAG's 4.5:1 threshold (tokens.css).
    background: "var(--color-accent-hover)",
    color: "var(--color-accent-text)",
  },
  secondary: {
    background: "var(--color-surface)",
    color: "var(--color-text)",
    borderColor: "var(--color-border-strong)",
  },
  danger: {
    background: "var(--color-danger)",
    color: "#fff",
  },
  ghost: {
    background: "transparent",
    color: "var(--color-text-muted)",
  },
};

export function Button({
  variant = "primary",
  style,
  disabled,
  loading,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...rest}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className="void-btn"
      style={{
        ...base,
        ...variants[variant],
        opacity: isDisabled ? 0.6 : 1,
        cursor: isDisabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 13,
        height: 13,
        borderRadius: "50%",
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        opacity: 0.85,
        animation: "void-spin 0.7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}
