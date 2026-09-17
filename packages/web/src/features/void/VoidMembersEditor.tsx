import { useState } from "react";
import { trpc } from "../../trpc/client";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";

type Role = "viewer" | "editor" | "manager";

/**
 * Third feature pass — Void's own member management, the first UI ever
 * built for the `grantAccess`/`revokeAccess`/`listAccessGrants` procedures
 * (they existed server-side since Phase 3 but had no frontend). Shared
 * between the creation wizard's members step and the settings page's
 * members panel — both just need a voidId, a list of current grants with
 * role-change/remove, and an "Add member" picker over the rest of the Org.
 */
export function VoidMembersEditor({ voidId }: { voidId: string }) {
  const utils = trpc.useUtils();
  const grants = trpc.void.listAccessGrants.useQuery({ voidId });
  const updateRole = trpc.void.grantAccess.useMutation({
    onSuccess: () => {
      utils.void.listAccessGrants.invalidate({ voidId });
      utils.void.listEligibleMembersForGrant.invalidate({ voidId });
    },
  });
  const revoke = trpc.void.revokeAccess.useMutation({
    onSuccess: () => {
      utils.void.listAccessGrants.invalidate({ voidId });
      utils.void.listEligibleMembersForGrant.invalidate({ voidId });
    },
  });

  const [pickedUserId, setPickedUserId] = useState("");
  const [pickedRole, setPickedRole] = useState<Role>("editor");
  const eligible = trpc.void.listEligibleMembersForGrant.useQuery({ voidId });
  const addMember = trpc.void.grantAccess.useMutation({
    onSuccess: () => {
      setPickedUserId("");
      utils.void.listAccessGrants.invalidate({ voidId });
      utils.void.listEligibleMembersForGrant.invalidate({ voidId });
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {grants.data?.map((g) => (
        <Card
          key={g.id}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <div>
            <div>
              {g.visibleName}{" "}
              <span style={{ color: "var(--color-text-muted)" }}>@{g.username}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{g.email}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              aria-label={`Change role for ${g.visibleName}`}
              value={g.role}
              onChange={(e) =>
                updateRole.mutate({ voidId, userId: g.userId, role: e.target.value as Role })
              }
              style={{
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border-strong)",
              }}
            >
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="manager">manager</option>
            </select>
            <Button variant="danger" onClick={() => revoke.mutate({ grantId: g.id })}>
              Remove
            </Button>
          </div>
        </Card>
      ))}

      {eligible.data && eligible.data.length > 0 && (
        <Card style={{ marginTop: 4 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!pickedUserId) return;
              addMember.mutate({ voidId, userId: pickedUserId, role: pickedRole });
            }}
            style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}
          >
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                Add member
              </label>
              <select
                aria-label="Add member"
                value={pickedUserId}
                onChange={(e) => setPickedUserId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--color-border-strong)",
                }}
              >
                <option value="">Select a member…</option>
                {eligible.data.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.visibleName} (@{m.username})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 120 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                Role
              </label>
              <select
                aria-label="Role"
                value={pickedRole}
                onChange={(e) => setPickedRole(e.target.value as Role)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--color-border-strong)",
                }}
              >
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="manager">manager</option>
              </select>
            </div>
            <Button type="submit" disabled={!pickedUserId || addMember.isPending}>
              Add
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
