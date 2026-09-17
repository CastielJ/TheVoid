import { pingResponseSchema } from "@void/shared";
import { publicProcedure, router } from "../trpc.js";
import { authRouter } from "./auth.js";
import { organizationRouter } from "./organization.js";
import { voidRouter } from "./void.js";
import { groupRouter } from "./group.js";
import { taskRouter } from "./task.js";
import { invitationRouter } from "./invitation.js";
import { notificationRouter } from "./notification.js";
import { searchRouter } from "./search.js";
import { tagRouter } from "./tag.js";

/**
 * Phase 0's only procedure: proves the full stack (React client → tRPC →
 * Fastify → response, using a type shared from @void/shared) connects
 * end-to-end before any real feature work starts
 * (docs/implementation-plan.md Phase 0 milestone).
 *
 * Domain routers (auth, organization, void, ...) are composed in here
 * starting Phase 1, per docs/architecture.md §5 / implementation-plan.md §6.
 */
export const appRouter = router({
  ping: publicProcedure.query(() => {
    return pingResponseSchema.parse({
      message: "pong",
      serverTime: new Date().toISOString(),
    });
  }),
  auth: authRouter,
  organization: organizationRouter,
  void: voidRouter,
  group: groupRouter,
  task: taskRouter,
  invitation: invitationRouter,
  notification: notificationRouter,
  search: searchRouter,
  tag: tagRouter,
});

export type AppRouter = typeof appRouter;
