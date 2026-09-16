import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { useSession } from "../../app/session";
import { AuthLayout } from "./AuthLayout";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";

/**
 * Public route: the backend's verifyEmail procedure has existed since the
 * MVP but had no frontend consumer at all — this is that consumer. Doesn't
 * require an active session (verification is meaningful whether or not the
 * visitor is currently logged in on this device).
 */
export function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { refetch } = useSession();
  const token = new URLSearchParams(location.search).get("token") ?? "";

  const verify = trpc.auth.verifyEmail.useMutation();
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (attempted || !token) return;
    setAttempted(true);
    verify.mutate(
      { token },
      {
        onSuccess: () => {
          refetch();
          setTimeout(() => navigate("/orgs"), 1400);
        },
      },
    );
    // `verify`/`navigate`/`refetch` deliberately excluded: stable identities,
    // and `attempted` is set synchronously above (re-running for it would be circular).
  }, [token]);

  return (
    <AuthLayout>
      <Card className="void-panel-in" style={{ width: "min(380px, 100%)", textAlign: "center" }}>
        {!token && <p style={{ margin: 0 }}>This verification link is missing its token.</p>}
        {token && verify.isPending && (
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>Verifying your email…</p>
        )}
        {verify.isSuccess && (
          <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
            <p style={{ margin: 0, fontWeight: 500 }}>Email verified — redirecting…</p>
          </>
        )}
        {verify.isError && (
          <>
            <p role="alert" style={{ color: "var(--color-danger)", fontSize: 14 }}>
              {verify.error.message}
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
