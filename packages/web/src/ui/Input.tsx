import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return (
      <input
        ref={ref}
        {...props}
        style={{
          padding: "8px 10px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          fontSize: 14,
          width: "100%",
          ...props.style,
        }}
      />
    );
  },
);

export function FormField({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
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
      {error && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>}
    </div>
  );
}
