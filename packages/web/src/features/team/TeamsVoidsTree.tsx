import { useNavigate } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { Button } from "../../ui/Button";

/**
 * Second feature pass — the left panel's navigation tree: every visible
 * Team (respecting the three-tier visibility model — an invisible Team the
 * caller isn't a member of is simply absent from team.list already, no
 * extra filtering needed here) with its Voids nested underneath, a
 * "Private (just me)" group for teamId-less personal Voids, and a "shared"
 * badge for any Void granted to more than one Team.
 */
export function TeamsVoidsTree({ organizationId }: { organizationId: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const teams = trpc.team.list.useQuery({ organizationId });
  const voidsWithGrants = trpc.void.listMineWithTeamGrants.useQuery({ organizationId });
  const myJoinRequests = trpc.team.listMyJoinRequests.useQuery();
  const requestJoin = trpc.team.requestJoin.useMutation({
    onSuccess: () => utils.team.listMyJoinRequests.invalidate(),
  });

  const voidsByTeamId = new Map<string, { id: string; name: string; teamIds: string[] }[]>();
  const privateVoids: { id: string; name: string }[] = [];
  for (const { void: v, teamIds } of voidsWithGrants.data ?? []) {
    if (teamIds.length === 0) {
      privateVoids.push({ id: v.id, name: v.name });
      continue;
    }
    for (const teamId of teamIds) {
      const list = voidsByTeamId.get(teamId) ?? [];
      list.push({ id: v.id, name: v.name, teamIds });
      voidsByTeamId.set(teamId, list);
    }
  }

  const pendingTeamIds = new Set(
    (myJoinRequests.data ?? []).filter((r) => r.status === "pending").map((r) => r.teamId),
  );

  function goToVoid(voidId: string) {
    navigate(`/orgs/${organizationId}/voids/${voidId}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <h3
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
          margin: "12px 0 4px",
        }}
      >
        Teams &amp; Voids
      </h3>

      {teams.data?.map((team) => {
        const teamVoids = voidsByTeamId.get(team.id) ?? [];
        const showRequestButton = team.visibility === "private" && !team.isMember;
        return (
          <div key={team.id} style={{ marginBottom: 4 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 4px 4px 0",
              }}
            >
              <button
                onClick={() => navigate(`/orgs/${organizationId}/teams/${team.id}`)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-text)",
                  fontSize: 13,
                  fontWeight: 500,
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {team.name}
              </button>
              {showRequestButton &&
                (pendingTeamIds.has(team.id) ? (
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    Request pending
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    style={{ fontSize: 11, padding: "2px 6px" }}
                    loading={requestJoin.isPending}
                    onClick={() => requestJoin.mutate({ teamId: team.id })}
                  >
                    Request to join
                  </Button>
                ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 12 }}>
              {teamVoids.map((v) => (
                <button
                  key={v.id}
                  onClick={() => goToVoid(v.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "none",
                    border: "none",
                    color: "var(--color-text-muted)",
                    fontSize: 12,
                    padding: "3px 0",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {v.name}
                  {v.teamIds.length > 1 && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 5px",
                        borderRadius: 999,
                        background: "var(--color-border)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      shared
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {privateVoids.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div
            style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)", padding: "4px 0" }}
          >
            Private (just me)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 12 }}>
            {privateVoids.map((v) => (
              <button
                key={v.id}
                onClick={() => goToVoid(v.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  padding: "3px 0",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
