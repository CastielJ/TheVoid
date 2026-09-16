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
