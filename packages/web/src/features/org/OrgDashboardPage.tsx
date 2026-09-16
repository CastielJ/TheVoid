import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { AppShell } from "../../app/AppShell";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";
import { MembersPanel } from "./MembersPanel";
import { InvitationsPanel } from "./InvitationsPanel";

export function OrgDashboardPage() {
  const { orgId } = useParams<{ orgId: string }>();
  if (!orgId) throw new Error("orgId param is required");
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const orgs = trpc.organization.listMine.useQuery();
  const org = orgs.data?.find((o) => o.id === orgId);
  const isOrgManager = org?.role === "owner" || org?.role === "admin";

  const teams = trpc.team.list.useQuery({ organizationId: orgId });
  const voids = trpc.void.list.useQuery({ organizationId: orgId });

  const [teamName, setTeamName] = useState("");
  const createTeam = trpc.team.create.useMutation({
    onSuccess: async () => {
      setTeamName("");
      await utils.team.list.invalidate({ organizationId: orgId });
    },
  });

  const [orgName, setOrgName] = useState("");
  const updateOrgSettings = trpc.organization.updateSettings.useMutation({
    onSuccess: () => {
      setOrgName("");
      return utils.organization.listMine.invalidate();
    },
  });

  const [voidName, setVoidName] = useState("");
  const [voidTeamId, setVoidTeamId] = useState("");
  const createVoid = trpc.void.create.useMutation({
    onSuccess: async (voidRow) => {
      setVoidName("");
      setVoidTeamId("");
      await utils.void.list.invalidate({ organizationId: orgId });
      navigate(`/orgs/${orgId}/voids/${voidRow.id}`);
    },
  });

  return (
    <AppShell orgId={orgId}>
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        <div>
          <Link to="/orgs" style={{ fontSize: 13 }}>
            ← All organizations
          </Link>
          <h1 style={{ fontSize: 22, marginTop: 4 }}>{org?.name ?? "…"}</h1>
        </div>

        <section>
          <h2 style={{ fontSize: 16 }}>Voids</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {voids.data?.map((v) => (
              <Card
                key={v.id}
                onClick={() => navigate(`/orgs/${orgId}/voids/${v.id}`)}
                style={{ cursor: "pointer" }}
              >
                <div style={{ fontWeight: 500 }}>{v.name}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  {v.teamId ? "Team Void" : "Private Void"}
                </div>
              </Card>
            ))}
          </div>
          <Card style={{ marginTop: 12 }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!voidName.trim()) return;
                createVoid.mutate({
                  organizationId: orgId,
                  name: voidName.trim(),
                  teamId: voidTeamId || undefined,
                });
              }}
              style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}
            >
              <div style={{ flex: 1, minWidth: 160 }}>
                <FormField label="New Void name" htmlFor="void-name">
                  <Input
                    id="void-name"
                    required
                    value={voidName}
                    onChange={(e) => setVoidName(e.target.value)}
                  />
                </FormField>
              </div>
              <div style={{ minWidth: 160, marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  Team (optional)
                </label>
                <select
                  aria-label="Team (optional)"
                  value={voidTeamId}
                  onChange={(e) => setVoidTeamId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border-strong)",
                  }}
                >
                  <option value="">Private (just me)</option>
                  {teams.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={createVoid.isPending} style={{ marginBottom: 16 }}>
                Create Void
              </Button>
            </form>
            {createVoid.error && (
              <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13 }}>
                {createVoid.error.message}
              </p>
            )}
          </Card>
        </section>

        <section>
          <h2 style={{ fontSize: 16 }}>Teams</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {teams.data?.map((t) => (
              <Card
                key={t.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span data-testid="team-name">{t.name}</span>
                <Link to={`/orgs/${orgId}/teams/${t.id}`} style={{ fontSize: 13 }}>
                  Manage
                </Link>
              </Card>
            ))}
          </div>
          {isOrgManager && (
            <Card style={{ marginTop: 12 }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!teamName.trim()) return;
                  createTeam.mutate({ organizationId: orgId, name: teamName.trim() });
                }}
                style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
              >
                <div style={{ flex: 1 }}>
                  <FormField label="New Team name" htmlFor="team-name">
                    <Input
                      id="team-name"
                      required
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                    />
                  </FormField>
                </div>
                <Button type="submit" disabled={createTeam.isPending} style={{ marginBottom: 16 }}>
                  Create Team
                </Button>
              </form>
            </Card>
          )}
        </section>

        {isOrgManager && (
          <section>
            <h2 style={{ fontSize: 16 }}>Members</h2>
            <MembersPanel organizationId={orgId} />
          </section>
        )}

        {isOrgManager && (
          <section>
            <h2 style={{ fontSize: 16 }}>Invitations</h2>
            <InvitationsPanel organizationId={orgId} />
          </section>
        )}

        {isOrgManager && (
          <section>
            <h2 style={{ fontSize: 16 }}>Organization settings</h2>
            <Card>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!orgName.trim()) return;
                  updateOrgSettings.mutate({ organizationId: orgId, name: orgName.trim() });
                }}
                style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
              >
                <div style={{ flex: 1 }}>
                  <FormField label="Organization name" htmlFor="org-rename">
                    <Input
                      id="org-rename"
                      placeholder={org?.name}
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                    />
                  </FormField>
                </div>
                <Button
                  type="submit"
                  disabled={updateOrgSettings.isPending}
                  style={{ marginBottom: 16 }}
                >
                  Save
                </Button>
              </form>
            </Card>
          </section>
        )}
      </div>
    </AppShell>
  );
}
