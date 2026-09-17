import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { AppShell } from "../../app/AppShell";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";
import { VoidMembersEditor } from "./VoidMembersEditor";

type Role = "viewer" | "editor" | "manager";

/**
 * Third feature pass — replaces TeamDetailPage.tsx now that Team is merged
 * into Void (a self-referencing hierarchy): this page is generic for BOTH
 * a top-level Void and a nested child Void ("Team"), since both now share
 * the exact same visibility/members/join-request shape. Routed at
 * /orgs/:orgId/voids/:voidId/settings.
 */
export function VoidSettingsPage() {
  const { orgId, voidId } = useParams<{ orgId: string; voidId: string }>();
  if (!orgId || !voidId) throw new Error("orgId and voidId params are required");
  const utils = trpc.useUtils();

  const voidRow = trpc.void.get.useQuery({ voidId });
  const children = trpc.void.listChildren.useQuery({ voidId });

  const [name, setName] = useState("");
  const update = trpc.void.update.useMutation({
    onSuccess: () => utils.void.get.invalidate({ voidId }),
  });

  const updateVisibility = trpc.void.updateVisibility.useMutation({
    onSuccess: () => utils.void.get.invalidate({ voidId }),
  });

  const joinRequests = trpc.void.listJoinRequests.useQuery({ voidId });
  const [roleByRequestId, setRoleByRequestId] = useState<Record<string, Role>>({});
  const decideJoinRequest = trpc.void.decideJoinRequest.useMutation({
    onSuccess: () => {
      utils.void.listJoinRequests.invalidate({ voidId });
      utils.void.listAccessGrants.invalidate({ voidId });
    },
  });

  return (
    <AppShell orgId={orgId}>
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div>
          <Link to={`/orgs/${orgId}/voids/${voidId}`} style={{ fontSize: 13 }}>
            ← Back to Void
          </Link>
          <h1 style={{ fontSize: 22, marginTop: 4 }}>{voidRow.data?.name ?? "…"}</h1>
        </div>

        <Card>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Rename</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              update.mutate({ voidId, name: name.trim() });
            }}
            style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
          >
            <div style={{ flex: 1 }}>
              <FormField label="Void name" htmlFor="void-name">
                <Input
                  id="void-name"
                  placeholder={voidRow.data?.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
            </div>
            <Button type="submit" disabled={update.isPending} style={{ marginBottom: 16 }}>
              Save
            </Button>
          </form>
        </Card>

        <Card>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Visibility</h2>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: -8 }}>
            Public: visible to all Organization members. Private: visible, but joining requires a
            request you approve or deny. Invisible: only current members can see it exists at all.
          </p>
          <select
            aria-label="Void visibility"
            value={voidRow.data?.visibility ?? "private"}
            onChange={(e) =>
              updateVisibility.mutate({
                voidId,
                visibility: e.target.value as "public" | "private" | "invisible",
              })
            }
            style={{
              padding: "8px 10px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border-strong)",
            }}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
            <option value="invisible">Invisible</option>
          </select>
        </Card>

        {voidRow.data?.visibility === "private" && (
          <section>
            <h2 style={{ fontSize: 16 }}>Pending join requests</h2>
            {joinRequests.data?.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>No pending requests.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {joinRequests.data?.map((r) => (
                <Card
                  key={r.id}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div>
                    {r.visibleName}{" "}
                    <span style={{ color: "var(--color-text-muted)" }}>@{r.username}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      aria-label={`Role to grant ${r.visibleName}`}
                      value={roleByRequestId[r.id] ?? "editor"}
                      onChange={(e) =>
                        setRoleByRequestId((prev) => ({
                          ...prev,
                          [r.id]: e.target.value as Role,
                        }))
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
                    <Button
                      onClick={() =>
                        decideJoinRequest.mutate({
                          requestId: r.id,
                          decision: "accepted",
                          role: roleByRequestId[r.id] ?? "editor",
                        })
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() =>
                        decideJoinRequest.mutate({ requestId: r.id, decision: "denied" })
                      }
                    >
                      Deny
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 style={{ fontSize: 16 }}>Members</h2>
          <VoidMembersEditor voidId={voidId} />
        </section>

        <section>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <h2 style={{ fontSize: 16, margin: 0 }}>Teams</h2>
            <Link to={`/orgs/${orgId}/voids/new?parentVoidId=${voidId}`}>
              <Button variant="secondary">Create Team</Button>
            </Link>
          </div>
          {children.data?.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              No Teams yet — a Team is its own canvas nested under this Void.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {children.data?.map((child) => (
              <Card
                key={child.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{child.name}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    {child.visibility}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <Link to={`/orgs/${orgId}/voids/${child.id}`} style={{ fontSize: 13 }}>
                    Open
                  </Link>
                  <Link to={`/orgs/${orgId}/voids/${child.id}/settings`} style={{ fontSize: 13 }}>
                    Manage
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
