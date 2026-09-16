import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { AppShell } from "../../app/AppShell";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";

export function AccountPage() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const sessions = trpc.auth.listSessions.useQuery();
  const revokeSession = trpc.auth.revokeSession.useMutation({
    onSuccess: () => utils.auth.listSessions.invalidate(),
  });
  const revokeAllOthers = trpc.auth.revokeAllOtherSessions.useMutation({
    onSuccess: () => utils.auth.listSessions.invalidate(),
  });

  return (
    <AppShell>
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        <div>
          <Link to="/orgs" style={{ fontSize: 13 }}>
            ← Organizations
          </Link>
          <h1 style={{ fontSize: 22, marginTop: 4, marginBottom: 4 }}>Account</h1>
          {me.data && (
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, margin: 0 }}>
              {me.data.visibleName} · @{me.data.username}
            </p>
          )}
        </div>

        <section>
          <h2 style={{ fontSize: 16 }}>Profile</h2>
          {me.data && <ProfileSection email={me.data.email} visibleName={me.data.visibleName} />}
        </section>

        <section>
          <h2 style={{ fontSize: 16 }}>Email verification</h2>
          {me.data && (
            <VerificationSection verified={me.data.emailVerified} email={me.data.email} />
          )}
        </section>

        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 16 }}>Active sessions</h2>
            <Button
              variant="secondary"
              loading={revokeAllOthers.isPending}
              onClick={() => revokeAllOthers.mutate()}
            >
              Log out other sessions
            </Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {sessions.data?.map((s) => (
              <Card
                key={s.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div>
                  <div style={{ fontSize: 13 }}>{s.deviceLabel ?? "Unknown device"}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    {s.ipAddress ?? "unknown IP"} · last active{" "}
                    {new Date(s.lastActiveAt).toLocaleString()}
                  </div>
                </div>
                <Button variant="danger" onClick={() => revokeSession.mutate({ sessionId: s.id })}>
                  Revoke
                </Button>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 16 }}>Two-factor authentication</h2>
          {me.data && <TwoFactorSection enabled={me.data.totpEnabled} />}
        </section>
      </div>
    </AppShell>
  );
}

function ProfileSection({ email, visibleName }: { email: string; visibleName: string }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(visibleName);
  const [saved, setSaved] = useState(false);
  useEffect(() => setName(visibleName), [visibleName]);

  const update = trpc.auth.updateVisibleName.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    },
  });

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || name === visibleName) return;
          update.mutate({ visibleName: name.trim() });
        }}
        style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
      >
        <div style={{ flex: 1 }}>
          <FormField
            label="Visible name"
            htmlFor="account-visible-name"
            hint="Username stays fixed for mentions/search — only this display name is editable."
          >
            <Input
              id="account-visible-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </FormField>
        </div>
        <Button
          type="submit"
          loading={update.isPending}
          disabled={!name.trim() || name === visibleName}
          style={{ marginBottom: 16 }}
        >
          {saved ? "Saved" : "Save"}
        </Button>
      </form>
      <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>{email}</p>
    </Card>
  );
}

function VerificationSection({ verified, email }: { verified: boolean; email: string }) {
  const [sent, setSent] = useState(false);
  const resend = trpc.auth.resendVerificationEmail.useMutation({
    onSuccess: () => setSent(true),
  });

  if (verified) {
    return (
      <Card style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--color-success)",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 13 }}>{email} is verified.</span>
      </Card>
    );
  }

  return (
    <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--color-warning)",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 13 }}>{email} is not verified.</span>
      </div>
      <Button
        variant="secondary"
        loading={resend.isPending}
        disabled={sent}
        onClick={() => resend.mutate()}
      >
        {sent ? "Email sent" : "Resend verification"}
      </Button>
    </Card>
  );
}

function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const utils = trpc.useUtils();
  const begin = trpc.auth.begin2FAEnrollment.useMutation();
  const confirm = trpc.auth.confirm2FAEnrollment.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
  });
  const disable = trpc.auth.disable2FA.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
  });

  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (enabled) {
    return (
      <Card className="void-fade-in">
        <p style={{ fontSize: 13 }}>Two-factor authentication is enabled on your account.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await disable.mutateAsync({ password });
              setPassword("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to disable 2FA.");
            }
          }}
          style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
        >
          <div style={{ flex: 1 }}>
            <FormField label="Confirm password to disable" htmlFor="disable-2fa-password">
              <Input
                id="disable-2fa-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
          </div>
          <Button
            type="submit"
            variant="danger"
            loading={disable.isPending}
            style={{ marginBottom: 16 }}
          >
            Disable
          </Button>
        </form>
        {error && (
          <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13 }}>
            {error}
          </p>
        )}
      </Card>
    );
  }

  if (backupCodes) {
    return (
      <Card className="void-fade-in">
        <p style={{ fontSize: 13, fontWeight: 500 }}>Save these backup codes somewhere safe:</p>
        <pre
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            background: "var(--color-bg)",
            padding: 12,
            borderRadius: 6,
          }}
        >
          {backupCodes.join("\n")}
        </pre>
        <Button onClick={() => setBackupCodes(null)}>Done</Button>
      </Card>
    );
  }

  if (begin.data) {
    return (
      <Card className="void-fade-in">
        <p style={{ fontSize: 13 }}>
          Scan this in your authenticator app, or enter the secret manually:
        </p>
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 13, wordBreak: "break-all" }}>
          {begin.data.secret}
        </code>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const result = await confirm.mutateAsync({ secret: begin.data!.secret, code });
              setBackupCodes(result.backupCodes);
              setCode("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Invalid code.");
            }
          }}
          style={{ display: "flex", gap: 12, alignItems: "flex-end", marginTop: 12 }}
        >
          <div style={{ flex: 1 }}>
            <FormField label="Enter the 6-digit code" htmlFor="confirm-2fa-code">
              <Input
                id="confirm-2fa-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </FormField>
          </div>
          <Button type="submit" loading={confirm.isPending} style={{ marginBottom: 16 }}>
            Confirm
          </Button>
        </form>
        {error && (
          <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13 }}>
            {error}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <p style={{ fontSize: 13 }}>Two-factor authentication is not enabled.</p>
      <Button loading={begin.isPending} onClick={() => begin.mutate()}>
        Enable 2FA
      </Button>
    </Card>
  );
}
