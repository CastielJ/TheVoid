import type { TaskLinkType } from "../trpc/types";

/** Shared between EdgeLayer's rendered arrows and TaskCard's connect-handle/armed-source highlight. */
export function linkTypeColor(type: TaskLinkType): string {
  return type === "dependency" ? "var(--color-edge-dependency)" : "var(--color-edge-flow)";
}
