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

  // Third feature pass: Team merged into Void — this only lists top-level
  // Voids now (parentVoidId IS NULL). Nested child Voids ("Teams") are
  // reached via a Void's own settings page or the left panel's nested tree,
  // not a second flat list here. `list` can include a discoverable-but-not-
  // yet-joined Void (public/private, isMember: false) — this grid is a
  // quick-access shortcut to Voids already open to you, so it filters to
  // isMember only; discovering and requesting to join anything else happens
  // through the left panel tree instead.
  const voids = trpc.void.list.useQuery({ organizationId: orgId });
  const myVoids = voids.data?.filter((v) => v.isMember);

  const [orgName, setOrgName] = useState("");
  const updateOrgSettings = trpc.organization.updateSettings.useMutation({
    onSuccess: () => {
      setOrgName("");
      return utils.organization.listMine.invalidate();
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: 16, margin: 0 }}>Voids</h2>
            <Link to={`/orgs/${orgId}/voids/new`}>
              <Button>New Void</Button>
            </Link>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {myVoids?.map((v) => (
              <Card
                key={v.id}
                onClick={() => navigate(`/orgs/${orgId}/voids/${v.id}`)}
                style={{ cursor: "pointer" }}
              >
                <div style={{ fontWeight: 500 }}>{v.name}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{v.visibility}</div>
              </Card>
            ))}
          </div>
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
