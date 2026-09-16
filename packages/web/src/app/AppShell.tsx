import { Link, useNavigate } from "react-router-dom";
import { trpc } from "../trpc/client";
import { useSession } from "./session";
import { Button } from "../ui/Button";
import { SearchBar } from "../features/search/SearchBar";
import { NotificationBell } from "../features/notification/NotificationBell";

export function AppShell({
  children,
  orgId,
}: {
  children: React.ReactNode;
  /** Present when rendered within an Organization's context — gates Search/My Tasks, both Organization-scoped. */
  orgId?: string;
}) {
  const navigate = useNavigate();
  const { user, refetch } = useSession();
  const logout = trpc.auth.logout.useMutation();

  async function handleLogout() {
    await logout.mutateAsync();
    refetch();
    navigate("/login");
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-5)",
          height: 56,
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          flexShrink: 0,
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Link
            to="/orgs"
            style={{
              fontWeight: 600,
              fontSize: 16,
              color: "var(--color-text)",
              textDecoration: "none",
            }}
          >
            Void
          </Link>
          {orgId && (
            <Link to={`/orgs/${orgId}/my-tasks`} style={{ fontSize: 13 }}>
              My Tasks
            </Link>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {orgId && <SearchBar orgId={orgId} />}
          <NotificationBell />
          <Link to="/account" style={{ fontSize: 13 }}>
            Account
          </Link>
          {user && (
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              {user.visibleName} <span style={{ opacity: 0.7 }}>@{user.username}</span>
            </span>
          )}
          <Button variant="ghost" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>
      <main style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>{children}</main>
    </div>
  );
}
