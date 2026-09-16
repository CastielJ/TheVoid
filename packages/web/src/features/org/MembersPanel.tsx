import { trpc } from "../../trpc/client";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";

/**
 * Org-admin-only member management. There is currently no way for a second
 * person to actually join an Organization outside of tests — email
 * invitations are Phase 7 (docs/decisions.md "Phase 6 Kickoff Notes") — so
 * in practice this panel shows a single-member list until that ships. It's
 * still wired up correctly against the real procedures so it needs no
 * rework once invitations exist.
 */
export function MembersPanel({ organizationId }: { organizationId: string }) {
  const utils = trpc.useUtils();
  const members = trpc.organization.listMembers.useQuery({ organizationId });
  const updateRole = trpc.organization.updateMemberRole.useMutation({
    onSuccess: () => utils.organization.listMembers.invalidate({ organizationId }),
  });
  const removeMember = trpc.organization.removeMember.useMutation({
    onSuccess: () => utils.organization.listMembers.invalidate({ organizationId }),
  });

  if (members.isLoading) return <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {members.data?.map((m) => (
        <Card
          key={m.userId}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <div>
            <div>{m.email}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{m.role}</div>
          </div>
          {m.role !== "owner" && (
            <div style={{ display: "flex", gap: 8 }}>
              <select
                aria-label={`Change role for ${m.email}`}
                value={m.role}
                onChange={(e) =>
                  updateRole.mutate({
                    organizationId,
                    userId: m.userId,
                    role: e.target.value as "admin" | "member",
                  })
                }
                style={{
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--color-border-strong)",
                }}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
              <Button
                variant="danger"
                onClick={() => removeMember.mutate({ organizationId, userId: m.userId })}
              >
                Remove
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
