import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import {
  canAccessVoid,
  canEditVoid,
  canAccessVoidForGroup,
  canEditVoidForGroup,
} from "../authorization/capabilities.js";
import {
  createGroup,
  findGroupById,
  listGroupsForVoid,
  updateGroup,
  deleteGroup,
} from "../domains/group/groups.js";
import { assignTagsToGroup, listTagsForGroup } from "../domains/tag/tags.js";
import { publishVoidEvent } from "../realtime/broadcast.js";

const groupIdInput = z.object({ groupId: z.string().uuid() });
const tagNamesInput = z.array(z.string().trim().min(1).max(40)).max(20);

export const groupRouter = router({
  // Editor or Manager (D13). voidId is trustworthy client input here — the
  // created Group's voidId literally *is* this value, no other entity to
  // cross-check it against.
  create: protectedProcedure
    .input(
      z.object({
        voidId: z.string().uuid(),
        name: z.string().min(1),
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        tagNames: tagNamesInput.optional(),
      }),
    )
    .use(requireCapability(canEditVoid, (input: { voidId: string }) => input.voidId))
    .mutation(async ({ ctx, input }) => {
      const { tagNames, ...groupInput } = input;
      const group = await createGroup(groupInput);
      if (tagNames && tagNames.length > 0) {
        await assignTagsToGroup(group.id, tagNames, ctx.session.user.id);
      }
      publishVoidEvent(input.voidId, "group.created", group);
      return group;
    }),

  // groupId resolves its own Void server-side (canEditVoidForGroup) — never
  // trust a client-supplied voidId for authorization here (Group.void_id is
  // immutable and not part of this input at all).
  update: protectedProcedure
    .input(
      groupIdInput.extend({
        name: z.string().min(1).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        tagNames: tagNamesInput.optional(),
      }),
    )
    .use(requireCapability(canEditVoidForGroup, (input: { groupId: string }) => input.groupId))
    .mutation(async ({ ctx, input }) => {
      const { groupId, tagNames, ...changes } = input;
      const group = await updateGroup(groupId, changes);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      if (tagNames !== undefined) {
        await assignTagsToGroup(groupId, tagNames, ctx.session.user.id);
      }
      publishVoidEvent(group.voidId, "group.updated", group);
      return group;
    }),

  delete: protectedProcedure
    .input(groupIdInput)
    .use(requireCapability(canEditVoidForGroup, (input: { groupId: string }) => input.groupId))
    .mutation(async ({ input }) => {
      const group = await findGroupById(input.groupId);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      await deleteGroup(input.groupId);
      publishVoidEvent(group.voidId, "group.deleted", { groupId: input.groupId });
      return { ok: true as const };
    }),

  list: protectedProcedure
    .input(z.object({ voidId: z.string().uuid() }))
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      return listGroupsForVoid(input.voidId);
    }),

  listTags: protectedProcedure
    .input(groupIdInput)
    .use(requireCapability(canAccessVoidForGroup, (input: { groupId: string }) => input.groupId))
    .query(async ({ input }) => {
      return listTagsForGroup(input.groupId);
    }),
});
