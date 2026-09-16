export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: "var(--space-4)",
        position: "relative",
        overflow: "hidden",
        background: "var(--color-bg)",
        backgroundImage:
          "radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.10), transparent 55%), radial-gradient(var(--color-border) 1px, transparent 1px)",
        backgroundSize: "auto, 28px 28px",
      }}
    >
      <div
        className="void-fade-in"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: -0.5,
          color: "var(--color-text)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 35% 30%, var(--color-accent), var(--color-accent-hover) 70%)",
            boxShadow: "0 0 0 5px rgba(99, 102, 241, 0.12)",
          }}
        />
        Void
      </div>
      <div
        className="void-fade-in"
        style={{ animationDelay: "40ms", animationFillMode: "backwards" }}
      >
        {children}
      </div>
    </div>
  );
}
