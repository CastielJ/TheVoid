import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";
import { searchAccessible } from "../domains/search/search.js";

export const searchRouter = router({
  // Ungated beyond auth — see searchAccessible's own docstring for why this
  // is not a gap: results are pre-scoped to accessible Voids, not filtered
  // after the fact.
  search: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid(), query: z.string() }))
    .query(async ({ ctx, input }) => {
      return searchAccessible(ctx.session.user.id, input.organizationId, input.query);
    }),
});
