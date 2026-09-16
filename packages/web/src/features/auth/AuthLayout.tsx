export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>Void</div>
      {children}
    </div>
  );
}
