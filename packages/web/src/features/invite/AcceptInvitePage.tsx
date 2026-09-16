import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { useSession } from "../../app/session";
import { AuthLayout } from "../auth/AuthLayout";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { FullPageStatus } from "../../app/ProtectedRoute";

/**
 * Public route (not behind ProtectedRoute — implementation-plan.md §2
 * Phase 7's "invite-acceptance UI"): an unauthenticated visitor is sent to
 * login/signup with this exact path+query preserved via router state
 * (LoginPage/SignupPage's redirectTo), landing back here to complete
 * acceptance rather than at the generic /orgs default.
 */
export function AcceptInvitePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading } = useSession();
  const token = new URLSearchParams(location.search).get("token") ?? "";

  const accept = trpc.invitation.accept.useMutation();
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!user || attempted || !token) return;
    setAttempted(true);
    accept.mutate(
      { token },
      {
        onSuccess: (result) => {
          setTimeout(() => navigate(`/orgs/${result.organizationId}`), 1200);
        },
      },
    );
    // `accept`/`attempted`/`navigate` deliberately excluded: `accept` is a
    // stable mutation-object identity, `attempted` is set synchronously
    // above (re-running this effect for it would be circular), and
    // `navigate` doesn't change.
  }, [user, token]);

  if (isLoading) return <FullPageStatus text="Loading…" />;

  if (!token) {
    return (
      <AuthLayout>
        <Card style={{ width: 360 }}>
          <p>This invitation link is missing its token.</p>
        </Card>
      </AuthLayout>
    );
  }

  if (!user) {
    const redirectTo = location.pathname + location.search;
    return (
      <AuthLayout>
        <Card style={{ width: 360, textAlign: "center" }}>
          <p>Log in or create an account to accept this invitation.</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <Link to="/login" state={{ redirectTo }}>
              <Button>Log in</Button>
            </Link>
            <Link to="/signup" state={{ redirectTo }}>
              <Button variant="secondary">Sign up</Button>
            </Link>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card style={{ width: 360, textAlign: "center" }}>
        {accept.isPending && <p>Accepting invitation…</p>}
        {accept.isSuccess && <p>Welcome aboard — redirecting…</p>}
        {accept.isError && (
          <>
            <p role="alert" style={{ color: "var(--color-danger)" }}>
              {accept.error.message}
            </p>
            <Button variant="secondary" onClick={() => navigate("/orgs")}>
              Go to your organizations
            </Button>
          </>
        )}
      </Card>
    </AuthLayout>
  );
}
