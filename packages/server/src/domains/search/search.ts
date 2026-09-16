import { and, ilike, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import { tasks, groups } from "../../db/schema.js";
import { listAccessibleVoids } from "../void/voids.js";

export interface SearchResult {
  type: "task" | "group";
  id: string;
  voidId: string;
  voidName: string;
  title: string;
  x: number;
  y: number;
}

const SEARCH_RESULT_LIMIT = 25;

/**
 * D43 global search — "Standing architecture principle (Round 5)": search
 * passes through the same authorization layer as direct Void access, so a
 * result for an inaccessible Void/Task must never appear. Implemented by
 * scoping the underlying queries to `listAccessibleVoids`'s result up
 * front, the same authoritative access list every other cross-Void listing
 * in this codebase (My Tasks, void.list) uses — not a separate,
 * independently-maintained authorization path. `ILIKE` here is accelerated
 * by the `pg_trgm` GIN indexes (schema.ts) rather than requiring the
 * `%`/similarity operators.
 */
export async function searchAccessible(
  userId: string,
  organizationId: string,
  query: string,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const accessibleVoids = await listAccessibleVoids(userId, organizationId);
  if (accessibleVoids.length === 0) return [];
  const voidIds = accessibleVoids.map((v) => v.id);
  const voidNameById = new Map(accessibleVoids.map((v) => [v.id, v.name]));

  const pattern = `%${trimmed}%`;

  const [taskRows, groupRows] = await Promise.all([
    db
      .select({ id: tasks.id, voidId: tasks.voidId, title: tasks.title, x: tasks.x, y: tasks.y })
      .from(tasks)
      .where(
        and(
          inArray(tasks.voidId, voidIds),
          isNull(tasks.deletedAt),
          or(ilike(tasks.title, pattern), ilike(tasks.description, pattern)),
        ),
      )
      .limit(SEARCH_RESULT_LIMIT),
    db
      .select({ id: groups.id, voidId: groups.voidId, name: groups.name, x: groups.x, y: groups.y })
      .from(groups)
      .where(and(inArray(groups.voidId, voidIds), ilike(groups.name, pattern)))
      .limit(SEARCH_RESULT_LIMIT),
  ]);

  return [
    ...taskRows.map((t) => ({
      type: "task" as const,
      id: t.id,
      voidId: t.voidId,
      voidName: voidNameById.get(t.voidId) ?? "",
      title: t.title,
      x: t.x,
      y: t.y,
    })),
    ...groupRows.map((g) => ({
      type: "group" as const,
      id: g.id,
      voidId: g.voidId,
      voidName: voidNameById.get(g.voidId) ?? "",
      title: g.name,
      x: g.x,
      y: g.y,
    })),
  ];
}
