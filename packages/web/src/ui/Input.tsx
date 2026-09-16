import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { hasError, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      {...props}
      style={{
        padding: "9px 11px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${hasError ? "var(--color-danger)" : "var(--color-border-strong)"}`,
        background: "var(--color-surface)",
        color: "var(--color-text)",
        fontSize: 14,
        width: "100%",
        transition:
          "border-color var(--motion-fast) var(--ease-standard), box-shadow var(--motion-fast) var(--ease-standard)",
        ...props.style,
      }}
    />
  );
});

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)" }}
      >
        {label}
      </label>
      {children}
      {error ? (
        <span role="alert" style={{ fontSize: 12, color: "var(--color-danger)" }}>
          {error}
        </span>
      ) : (
        hint && <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{hint}</span>
      )}
    </div>
  );
}
