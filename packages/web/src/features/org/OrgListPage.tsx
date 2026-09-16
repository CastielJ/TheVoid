import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { AppShell } from "../../app/AppShell";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";

export function OrgListPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const orgs = trpc.organization.listMine.useQuery();
  const createOrg = trpc.organization.create.useMutation({
    onSuccess: async (org) => {
      await utils.organization.listMine.invalidate();
      navigate(`/orgs/${org.id}`);
    },
  });
  const [name, setName] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createOrg.mutate({ name: name.trim() });
  }

  return (
    <AppShell>
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <h1 style={{ fontSize: 22 }}>Your organizations</h1>

        {orgs.isLoading && <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>}

        {orgs.data && orgs.data.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {orgs.data.map((org) => (
              <Card
                key={org.id}
                onClick={() => navigate(`/orgs/${org.id}`)}
                style={{ cursor: "pointer", display: "flex", justifyContent: "space-between" }}
              >
                <span style={{ fontWeight: 500 }}>{org.name}</span>
                <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{org.role}</span>
              </Card>
            ))}
          </div>
        )}

        {orgs.data && orgs.data.length === 0 && (
          <p style={{ color: "var(--color-text-muted)" }}>
            You don&apos;t belong to any organization yet — create one below.
          </p>
        )}

        <Card>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Create an organization</h2>
          <form
            onSubmit={handleCreate}
            style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
          >
            <div style={{ flex: 1 }}>
              <FormField label="Name" htmlFor="org-name">
                <Input
                  id="org-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Inc."
                />
              </FormField>
            </div>
            <Button type="submit" disabled={createOrg.isPending} style={{ marginBottom: 16 }}>
              Create
            </Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
