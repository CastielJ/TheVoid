import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "../../trpc/client";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";
import { Card } from "../../ui/Card";
import { AuthLayout } from "./AuthLayout";
import { useSession } from "../../app/session";

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

function errorCode(err: unknown): string | undefined {
  if (err instanceof TRPCClientError) return (err.data as { code?: string } | null)?.code;
  return undefined;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo ?? "/orgs";
  const { refetch } = useSession();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [visibleName, setVisibleName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  // A breach was reported for the password currently in the field — shown
  // as an explicit warning + "Use anyway" override, never silently rejected.
  const [breachWarning, setBreachWarning] = useState(false);

  const signup = trpc.auth.signup.useMutation();
  const login = trpc.auth.login.useMutation();

  async function submit(acknowledgeBreach: boolean) {
    setError(null);
    try {
      await signup.mutateAsync({ email, username, visibleName, password, acknowledgeBreach });
      setBreachWarning(false);
      // Login gate does not require email verification (see routers/auth.ts) —
      // signing up immediately establishes a session, same as most SaaS onboarding.
      const result = await login.mutateAsync({ email, password });
      if (result.requiresTwoFactor) {
        navigate("/login", { state: { email, redirectTo } });
        return;
      }
      refetch();
      navigate(redirectTo);
    } catch (err) {
      if (errorCode(err) === "PRECONDITION_FAILED") {
        setBreachWarning(true);
        return;
      }
      if (errorCode(err) === "CONFLICT") {
        setUsernameError("That username is already taken.");
        return;
      }
      setBreachWarning(false);
      setError(errorMessage(err, "Signup failed."));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUsernameError(null);
    if (!USERNAME_PATTERN.test(username)) {
      setUsernameError("3-20 characters: lowercase letters, numbers, and underscores.");
      return;
    }
    submit(false);
  }

  const isSubmitting = signup.isPending || login.isPending;

  return (
    <AuthLayout>
      <Card style={{ width: "min(380px, 100%)" }}>
        <h1 style={{ fontSize: 20, marginTop: 0, marginBottom: 4 }}>Create your account</h1>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 0 }}>
          A spatial home for your team's work.
        </p>
        <form onSubmit={handleSubmit}>
          <FormField label="Visible name" htmlFor="visibleName" hint="Shown throughout Void.">
            <Input
              id="visibleName"
              required
              maxLength={80}
              value={visibleName}
              onChange={(e) => setVisibleName(e.target.value)}
              placeholder="Alex Johnson"
            />
          </FormField>
          <FormField
            label="Username"
            htmlFor="username"
            error={usernameError ?? undefined}
            hint={usernameError ? undefined : "For @mentions and search — can't be changed later."}
          >
            <Input
              id="username"
              required
              hasError={Boolean(usernameError)}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="alexj"
              pattern="[a-z0-9_]{3,20}"
            />
          </FormField>
          <FormField label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField
            label="Password"
            htmlFor="password"
            hint="At least 12 characters. No other rules."
          >
            <Input
              id="password"
              type="password"
              required
              minLength={12}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setBreachWarning(false);
              }}
            />
          </FormField>

          {breachWarning && (
            <div
              className="void-fade-in"
              role="alert"
              style={{
                background: "color-mix(in srgb, var(--color-warning) 12%, var(--color-surface))",
                border: "1px solid var(--color-warning)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 12px",
                marginTop: -8,
                marginBottom: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <p style={{ fontSize: 13, margin: 0, color: "var(--color-text)" }}>
                This password has appeared in a known data breach. Choosing a different one is
                strongly recommended.
              </p>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  loading={isSubmitting}
                  onClick={() => submit(true)}
                >
                  Use anyway
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, marginTop: -8 }}>
              {error}
            </p>
          )}

          <Button type="submit" loading={isSubmitting} style={{ width: "100%" }}>
            Sign up
          </Button>
        </form>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 0 }}>
          Already have an account?{" "}
          <Link to="/login" state={{ redirectTo }}>
            Log in
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
