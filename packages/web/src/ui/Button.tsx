import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const base: React.CSSProperties = {
  borderRadius: "var(--radius-sm)" as unknown as string,
  padding: "8px 14px",
  fontSize: 14,
  fontWeight: 500,
  border: "1px solid transparent",
  transition: "background-color 0.12s ease, border-color 0.12s ease",
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

export function Button({ variant = "primary", style, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        ...base,
        ...variants[variant],
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    />
  );
}
