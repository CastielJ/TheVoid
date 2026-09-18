import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { taskLinkTypeValues } from "../db/schema.js";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import {
  canAccessVoid,
  canEditVoidForTaskPair,
  canEditVoidForTaskLink,
} from "../authorization/capabilities.js";
import {
  createTaskLink,
  findTaskLinkById,
  listTaskLinksForVoid,
  deleteTaskLink,
} from "../domains/task/taskLinks.js";
import { publishVoidEvent } from "../realtime/broadcast.js";

const typeEnum = z.enum(taskLinkTypeValues);

const reasonMessages: Record<string, string> = {
  self_loop: "A Task cannot be linked to itself.",
  source_not_found: "Source Task not found.",
  target_not_found: "Target Task not found.",
  cross_void: "Both Tasks must belong to the same Void.",
  duplicate: "That connection already exists.",
};

export const taskLinkRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        sourceTaskId: z.string().uuid(),
        targetTaskId: z.string().uuid(),
        type: typeEnum,
      }),
    )
    .use(
      requireCapability(
        canEditVoidForTaskPair,
        (input: { sourceTaskId: string; targetTaskId: string }) =>
          `${input.sourceTaskId}:${input.targetTaskId}`,
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createTaskLink(input, ctx.session.user.id);
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: reasonMessages[result.reason] ?? "Failed to create connection.",
        });
      }
      publishVoidEvent(result.taskLink.voidId, "taskLink.created", result.taskLink);
      return result.taskLink;
    }),

  delete: protectedProcedure
    .input(z.object({ taskLinkId: z.string().uuid() }))
    .use(
      requireCapability(
        canEditVoidForTaskLink,
        (input: { taskLinkId: string }) => input.taskLinkId,
      ),
    )
    .mutation(async ({ input }) => {
      const link = await findTaskLinkById(input.taskLinkId);
      if (!link) throw new TRPCError({ code: "NOT_FOUND" });
      await deleteTaskLink(input.taskLinkId);
      publishVoidEvent(link.voidId, "taskLink.deleted", { taskLinkId: input.taskLinkId });
      return { ok: true as const };
    }),

  list: protectedProcedure
    .input(z.object({ voidId: z.string().uuid() }))
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      return listTaskLinksForVoid(input.voidId);
    }),
});
