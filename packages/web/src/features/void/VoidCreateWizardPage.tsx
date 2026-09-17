import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { AppShell } from "../../app/AppShell";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { FormField, Input } from "../../ui/Input";
import { VoidMembersEditor } from "./VoidMembersEditor";

type Visibility = "public" | "private" | "invisible";

/**
 * Third feature pass — the Void creation flow, now a 3-step wizard: name →
 * visibility → members. Routed at /orgs/:orgId/voids/new, with an optional
 * ?parentVoidId= to create a child Void ("Team") nested under that parent
 * instead of a top-level one — same wizard either way, since a Team is
 * structurally just a Void. The actual `void.create` call fires once, at
 * the name+visibility → members transition (not per-step), so the Void
 * never briefly exists with the wrong visibility before a concurrent
 * viewer could see it.
 */
export function VoidCreateWizardPage() {
  const { orgId } = useParams<{ orgId: string }>();
  if (!orgId) throw new Error("orgId param is required");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentVoidId = searchParams.get("parentVoidId") ?? undefined;
  const parent = trpc.void.get.useQuery({ voidId: parentVoidId! }, { enabled: !!parentVoidId });

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [createdVoidId, setCreatedVoidId] = useState<string | null>(null);

  const createVoid = trpc.void.create.useMutation({
    onSuccess: (voidRow) => {
      setCreatedVoidId(voidRow.id);
      setStep(3);
    },
  });

  return (
    <AppShell orgId={orgId}>
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div>
          <Link
            to={parentVoidId ? `/orgs/${orgId}/voids/${parentVoidId}/settings` : `/orgs/${orgId}`}
            style={{ fontSize: 13 }}
          >
            ← Cancel
          </Link>
          <h1 style={{ fontSize: 22, marginTop: 4 }}>
            {parentVoidId ? `New Team in ${parent.data?.name ?? "…"}` : "New Void"}
          </h1>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Step {step} of 3</p>
        </div>

        {step === 1 && (
          <Card>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Name</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                setStep(2);
              }}
            >
              <FormField label="Name" htmlFor="new-void-name">
                <Input
                  id="new-void-name"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
              <Button type="submit" disabled={!name.trim()} style={{ marginTop: 8 }}>
                Next
              </Button>
            </form>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Visibility</h2>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: -8 }}>
              Public: visible to all Organization members. Private: visible, but joining requires a
              request you approve or deny. Invisible: only current members can see it exists at all.
            </p>
            <select
              aria-label="Visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
              style={{
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border-strong)",
                width: "100%",
              }}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="invisible">Invisible</option>
            </select>
            {createVoid.error && (
              <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13 }}>
                {createVoid.error.message}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                loading={createVoid.isPending}
                onClick={() =>
                  createVoid.mutate({
                    organizationId: orgId,
                    name: name.trim(),
                    parentVoidId,
                    visibility,
                  })
                }
              >
                Next
              </Button>
            </div>
          </Card>
        )}

        {step === 3 && createdVoidId && (
          <Card>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Members</h2>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: -8 }}>
              Add members from the Organization now, or skip and add them later from the Void's
              settings.
            </p>
            <VoidMembersEditor voidId={createdVoidId} />
            <Button
              style={{ marginTop: 16 }}
              onClick={() => navigate(`/orgs/${orgId}/voids/${createdVoidId}`)}
            >
              Done
            </Button>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
