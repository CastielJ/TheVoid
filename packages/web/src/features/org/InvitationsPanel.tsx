import { useState } from "react";
import { trpc } from "../../trpc/client";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";

/** D16, Org-Admin/Owner only (rendered behind that check by the caller). */
export function InvitationsPanel({ organizationId }: { organizationId: string }) {
  const utils = trpc.useUtils();
  const pending = trpc.invitation.listPending.useQuery({ organizationId });
  const create = trpc.invitation.create.useMutation({
    onSuccess: () => {
      setEmail("");
      return utils.invitation.listPending.invalidate({ organizationId });
    },
  });
  const revoke = trpc.invitation.revoke.useMutation({
    onSuccess: () => utils.invitation.listPending.invalidate({ organizationId }),
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pending.data?.map((invite) => (
          <Card
            key={invite.id}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <div>
              <div>{invite.email}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}
              </div>
            </div>
            <Button variant="danger" onClick={() => revoke.mutate({ invitationId: invite.id })}>
              Revoke
            </Button>
          </Card>
        ))}
        {pending.data?.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>No pending invitations.</p>
        )}
      </div>

      <Card style={{ marginTop: 12 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            create.mutate({ organizationId, email: email.trim(), role });
          }}
          style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <FormField label="Invite by email" htmlFor="invite-email">
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "member" | "admin")}
              style={{
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border-strong)",
              }}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <Button type="submit" disabled={create.isPending} style={{ marginBottom: 16 }}>
            Send invite
          </Button>
        </form>
        {create.error && (
          <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13 }}>
            {create.error.message}
          </p>
        )}
      </Card>
    </div>
  );
}
