import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";
import { Card } from "../../ui/Card";
import { AuthLayout } from "./AuthLayout";
import { useSession } from "../../app/session";

export function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo ?? "/orgs";
  const { refetch } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const signup = trpc.auth.signup.useMutation();
  const login = trpc.auth.login.useMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await signup.mutateAsync({ email, password });
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
      setError(err instanceof Error ? err.message : "Signup failed.");
    }
  }

  return (
    <AuthLayout>
      <Card style={{ width: 360 }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Create your account</h1>
        <form onSubmit={handleSubmit}>
          <FormField label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {error && (
            <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, marginTop: -8 }}>
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={signup.isPending || login.isPending}
            style={{ width: "100%" }}
          >
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
