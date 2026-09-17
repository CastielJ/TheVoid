import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";
import { Card } from "../../ui/Card";
import { AuthLayout } from "./AuthLayout";
import { useSession } from "../../app/session";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Set by pages that need the user to authenticate first and come straight
  // back (e.g. AcceptInvitePage) — falls back to the default landing page.
  const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo ?? "/orgs";
  const { refetch } = useSession();
  const [identifier, setIdentifier] = useState(
    (location.state as { email?: string } | null)?.email ?? "",
  );
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const login = trpc.auth.login.useMutation();
  const verify2FA = trpc.auth.verify2FA.useMutation();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await login.mutateAsync({ identifier, password });
      if (result.requiresTwoFactor) {
        setChallengeToken(result.challengeToken);
        return;
      }
      refetch();
      navigate(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    try {
      await verify2FA.mutateAsync({ challengeToken, code });
      refetch();
      navigate(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code.");
    }
  }

  if (challengeToken) {
    return (
      <AuthLayout>
        <Card className="void-panel-in" style={{ width: "min(360px, 100%)" }}>
          <h1 style={{ fontSize: 20, marginTop: 0, marginBottom: 4 }}>Two-factor code</h1>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 0 }}>
            Enter the 6-digit code from your authenticator app.
          </p>
          <form onSubmit={handleVerify}>
            <FormField label="6-digit code" htmlFor="code">
              <Input
                id="code"
                inputMode="numeric"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </FormField>
            {error && (
              <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, marginTop: -8 }}>
                {error}
              </p>
            )}
            <Button type="submit" loading={verify2FA.isPending} style={{ width: "100%" }}>
              Verify
            </Button>
          </form>
          <button
            type="button"
            onClick={() => {
              setChallengeToken(null);
              setError(null);
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              fontSize: 13,
              padding: 0,
              cursor: "pointer",
            }}
          >
            ← Back to login
          </button>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card style={{ width: "min(360px, 100%)" }}>
        <h1 style={{ fontSize: 20, marginTop: 0, marginBottom: 4 }}>Log in</h1>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 0 }}>
          Welcome back.
        </p>
        <form onSubmit={handleLogin}>
          <FormField label="Email or username" htmlFor="identifier">
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              required
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </FormField>
          <FormField label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {error && (
            <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, marginTop: -8 }}>
              {error}
            </p>
          )}
          <Button type="submit" loading={login.isPending} style={{ width: "100%" }}>
            Log in
          </Button>
        </form>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 0 }}>
          No account?{" "}
          <Link to="/signup" state={{ redirectTo }}>
            Sign up
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
