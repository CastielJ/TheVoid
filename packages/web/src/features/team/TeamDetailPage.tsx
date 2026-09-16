import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { AppShell } from "../../app/AppShell";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";

export function TeamDetailPage() {
  const { orgId, teamId } = useParams<{ orgId: string; teamId: string }>();
  if (!orgId || !teamId) throw new Error("orgId and teamId params are required");
  const utils = trpc.useUtils();

  const team = trpc.team.get.useQuery({ teamId });
  const members = trpc.team.listMembers.useQuery({ teamId });
  // Only resolves if the caller is an org Owner/Admin (organization.listMembers
  // is gated to canManageOrganization); a Team Lead without org-admin rights
  // won't see this list — a known limitation until Phase 7 invitations exist
  // (see docs/decisions.md "Phase 6 Kickoff Notes").
  const orgMembers = trpc.organization.listMembers.useQuery({ organizationId: orgId });

  const [pickedUserId, setPickedUserId] = useState("");
  const addMember = trpc.team.addMember.useMutation({
    onSuccess: () => {
      setPickedUserId("");
      return utils.team.listMembers.invalidate({ teamId });
    },
  });
  const removeMember = trpc.team.removeMember.useMutation({
    onSuccess: () => utils.team.listMembers.invalidate({ teamId }),
  });
  const setTeamLead = trpc.team.setTeamLead.useMutation({
    onSuccess: () => utils.team.listMembers.invalidate({ teamId }),
  });

  const [name, setName] = useState("");
  const update = trpc.team.update.useMutation({
    onSuccess: () => utils.team.get.invalidate({ teamId }),
  });

  const availableToAdd = orgMembers.data?.filter(
    (om) => !members.data?.some((m) => m.userId === om.userId),
  );

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
          <Link to={`/orgs/${orgId}`} style={{ fontSize: 13 }}>
            ← Organization
          </Link>
          <h1 style={{ fontSize: 22, marginTop: 4 }}>{team.data?.name ?? "…"}</h1>
        </div>

        <Card>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Rename</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              update.mutate({ teamId, name: name.trim() });
            }}
            style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
          >
            <div style={{ flex: 1 }}>
              <FormField label="Team name" htmlFor="team-name">
                <Input
                  id="team-name"
                  placeholder={team.data?.name}
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

        <section>
          <h2 style={{ fontSize: 16 }}>Members</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {members.data?.map((m) => (
              <Card
                key={m.userId}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div>
                  <div>
                    {m.visibleName}{" "}
                    <span style={{ color: "var(--color-text-muted)" }}>@{m.username}</span>
                  </div>
                  {m.isTeamLead && (
                    <div style={{ fontSize: 12, color: "var(--color-accent-hover)" }}>
                      Team Lead
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setTeamLead.mutate({ teamId, userId: m.userId, isTeamLead: !m.isTeamLead })
                    }
                  >
                    {m.isTeamLead ? "Unset lead" : "Make lead"}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => removeMember.mutate({ teamId, userId: m.userId })}
                  >
                    Remove
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {orgMembers.data && (
            <Card style={{ marginTop: 12 }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!pickedUserId) return;
                  addMember.mutate({ teamId, userId: pickedUserId });
                }}
                style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
              >
                <div style={{ flex: 1 }}>
                  <label
                    style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}
                  >
                    Add organization member
                  </label>
                  <select
                    aria-label="Add organization member"
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
                    {availableToAdd?.map((om) => (
                      <option key={om.userId} value={om.userId}>
                        {om.visibleName} (@{om.username})
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={!pickedUserId || addMember.isPending}>
                  Add
                </Button>
              </form>
            </Card>
          )}
          {orgMembers.isError && (
            <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              Only an Organization Owner/Admin can add Team members here.
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
