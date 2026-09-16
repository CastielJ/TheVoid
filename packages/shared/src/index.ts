import { z } from "zod";

/**
 * Phase 0 placeholder. Domain schemas (User, Organization, Task, etc.) are
 * added here starting in Phase 1, per docs/implementation-plan.md — this
 * package exists so server and web share one definition of every domain
 * shape, never two independently-typed copies.
 */
export const pingResponseSchema = z.object({
  message: z.literal("pong"),
  serverTime: z.string(),
});

export type PingResponse = z.infer<typeof pingResponseSchema>;

/**
 * Task priority levels (post-launch refinement pass). Single source of
 * truth — schema.ts, routers/task.ts, and every frontend priority display
 * import from here instead of each declaring their own copy of the value
 * list, which is what caused the old 4-level enum to drift across three
 * independent declarations.
 *
 * Ordered lowest to highest urgency. "First Priority" is a deliberate
 * top "drop everything" tier above "Highest", not a synonym for it.
 */
export const taskPriorityValues = [
  "lowest",
  "low",
  "medium",
  "high",
  "highest",
  "first_priority",
] as const;

export type TaskPriority = (typeof taskPriorityValues)[number];

export const taskPriorityRank: Record<TaskPriority, number> = {
  lowest: 0,
  low: 1,
  medium: 2,
  high: 3,
  highest: 4,
  first_priority: 5,
};

export const taskPriorityLabels: Record<TaskPriority, string> = {
  lowest: "Lowest",
  low: "Low",
  medium: "Medium",
  high: "High",
  highest: "Highest",
  first_priority: "First Priority",
};
