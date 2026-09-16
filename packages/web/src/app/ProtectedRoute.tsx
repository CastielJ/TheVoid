import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "./session";

export function ProtectedRoute() {
  const { user, isLoading } = useSession();

  if (isLoading) return <FullPageStatus text="Loading…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function FullPageStatus({ text }: { text: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-muted)",
        fontSize: 14,
      }}
    >
      {text}
    </div>
  );
}
