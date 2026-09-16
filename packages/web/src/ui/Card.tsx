export function Card({
  children,
  style,
  onClick,
  onKeyDown,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  // A Card with an onClick is used throughout as a clickable navigation
  // row (org/void/task lists) — a plain <div onClick> is invisible to
  // keyboard and screen-reader users (WCAG 2.1.1/4.1.2). Rather than
  // requiring every call site to remember role/tabIndex/onKeyDown, Card
  // adds them itself whenever onClick is present.
  const interactive = Boolean(onClick);
  return (
    <div
      {...rest}
      onClick={onClick}
      role={interactive ? "button" : rest.role}
      tabIndex={interactive ? 0 : rest.tabIndex}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          (onClick as React.MouseEventHandler<HTMLDivElement>)(
            e as unknown as React.MouseEvent<HTMLDivElement>,
          );
        }
      }}
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-sm)",
        padding: "var(--space-4)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
