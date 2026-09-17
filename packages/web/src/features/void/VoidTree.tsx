import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../../trpc/client";
import { Button } from "../../ui/Button";

interface TreeVoid {
  id: string;
  name: string;
  visibility: "public" | "private" | "invisible";
  isMember: boolean;
}

/**
 * Third feature pass — the left panel's navigation tree, rewritten from the
 * second pass's flat TeamsVoidsTree now that Team is merged into Void (a
 * self-referencing hierarchy). Genuinely recursive: a root Void's children
 * can themselves have children, and so on — the "Void → Team" language in
 * the product is informal, the schema (and this component) supports any
 * nesting depth. Root Voids come from `void.list` (already access-scoped —
 * every root the caller sees is one they're a member of); each node's
 * children come from `void.listChildren`, which can include a public/
 * private child the caller ISN'T a member of yet (isMember: false) — that
 * node shows "Request to join" instead of navigating straight in.
 */
export function VoidTree({ organizationId }: { organizationId: string }) {
  const roots = trpc.void.list.useQuery({ organizationId });

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
        Voids
      </h3>
      {roots.data?.map((v) => (
        <VoidTreeNode key={v.id} node={v} organizationId={organizationId} depth={0} />
      ))}
    </div>
  );
}

function VoidTreeNode({
  node,
  organizationId,
  depth,
}: {
  node: TreeVoid;
  organizationId: string;
  depth: number;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  // Browsing further into a Void's own children requires actually being a
  // member of it (listChildren is gated by canAccessVoid) — a Void that's
  // merely "visible and joinable" but not yet joined can't have its
  // children browsed, same as a real filesystem: seeing a folder listed
  // doesn't mean you can `cd` into its subfolders yet.
  const children = trpc.void.listChildren.useQuery(
    { voidId: node.id },
    { enabled: expanded && node.isMember },
  );
  const myJoinRequests = trpc.void.listMyJoinRequests.useQuery();
  const requestJoin = trpc.void.requestJoin.useMutation({
    onSuccess: () => utils.void.listMyJoinRequests.invalidate(),
  });

  const isPending = (myJoinRequests.data ?? []).some(
    (r) => r.voidId === node.id && r.status === "pending",
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 4px 4px 0",
          paddingLeft: depth * 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          {node.isMember ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse" : "Expand"}
              style={{
                background: "none",
                border: "none",
                color: "var(--color-text-muted)",
                fontSize: 10,
                cursor: "pointer",
                width: 14,
                flexShrink: 0,
              }}
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}
          {node.isMember ? (
            <button
              onClick={() => navigate(`/orgs/${organizationId}/voids/${node.id}`)}
              style={{
                background: "none",
                border: "none",
                color: "var(--color-text)",
                fontSize: 13,
                fontWeight: depth === 0 ? 500 : 400,
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.name}
            </button>
          ) : (
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{node.name}</span>
          )}
        </div>
        {!node.isMember &&
          (isPending ? (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Pending</span>
          ) : (
            <Button
              variant="ghost"
              style={{ fontSize: 11, padding: "2px 6px" }}
              loading={requestJoin.isPending}
              onClick={() => requestJoin.mutate({ voidId: node.id })}
            >
              Request to join
            </Button>
          ))}
      </div>
      {expanded &&
        children.data?.map((child) => (
          <VoidTreeNode
            key={child.id}
            node={child}
            organizationId={organizationId}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}
