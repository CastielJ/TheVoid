import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import { canAccessVoid } from "../authorization/capabilities.js";
import { findVoidById } from "../domains/void/voids.js";
import { listOrgTags } from "../domains/tag/tags.js";

/**
 * Read-only. Tag creation happens inline through task.update/group.update
 * (find-or-create by name), not a separate write endpoint here — see
 * domains/tag/tags.ts. `organizationId` is resolved server-side from the
 * given voidId (never accepted as direct client input), so a caller can
 * only ever list tags for an Organization whose Void they already have
 * access to — listing existing Tags never grants access to anything beyond
 * what canAccessVoid on this specific voidId already allows.
 */
export const tagRouter = router({
  list: protectedProcedure
    .input(z.object({ voidId: z.string().uuid() }))
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      const voidRow = await findVoidById(input.voidId);
      if (!voidRow) throw new TRPCError({ code: "NOT_FOUND" });
      return listOrgTags(voidRow.organizationId);
    }),
});
