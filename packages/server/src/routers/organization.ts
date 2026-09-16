import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import { canManageOrganization, canTransferOwnership } from "../authorization/capabilities.js";
import {
  createOrganization,
  findOrganizationById,
  updateOrganizationName,
} from "../domains/organization/organizations.js";
import {
  listActiveMembers,
  listOrganizationsForUser,
  updateMemberRole,
  removeMember,
  transferOwnership,
} from "../domains/organization/memberships.js";
import { emitUserAccessChanged } from "../realtime/events.js";

const organizationIdInput = z.object({ organizationId: z.string().uuid() });

export const organizationRouter = router({
  // Any authenticated user may create an Organization; they become its
  // Owner via a Membership row in the same transaction (C7).
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return createOrganization(ctx.session.user.id, input.name);
    }),

  // Ungated (see listOrganizationsForUser): scoped to the caller by
  // construction, same reasoning as void.list.
  listMine: protectedProcedure.query(async ({ ctx }) => {
    return listOrganizationsForUser(ctx.session.user.id);
  }),

  updateSettings: protectedProcedure
    .input(organizationIdInput.extend({ name: z.string().min(1) }))
    .use(
      requireCapability(
        canManageOrganization,
        (input: { organizationId: string }) => input.organizationId,
      ),
    )
    .mutation(async ({ input }) => {
      const org = await findOrganizationById(input.organizationId);
      if (!org) throw new TRPCError({ code: "NOT_FOUND" });
      await updateOrganizationName(input.organizationId, input.name);
      return { ok: true as const };
    }),

  listMembers: protectedProcedure
    .input(organizationIdInput)
    .use(
      requireCapability(
        canManageOrganization,
        (input: { organizationId: string }) => input.organizationId,
      ),
    )
    .query(async ({ input }) => {
      const rows = await listActiveMembers(input.organizationId);
      return rows.map(({ membership, user }) => ({
        userId: user.id,
        email: user.email,
        role: membership.role,
        joinedAt: membership.createdAt,
      }));
    }),

  updateMemberRole: protectedProcedure
    .input(
      organizationIdInput.extend({ userId: z.string().uuid(), role: z.enum(["admin", "member"]) }),
    )
    .use(
      requireCapability(
        canManageOrganization,
        (input: { organizationId: string }) => input.organizationId,
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateMemberRole(
        input.organizationId,
        input.userId,
        input.role,
        ctx.session.user.id,
      );
      if (!result.ok) {
        const message =
          result.reason === "not_found"
            ? "Member not found."
            : "The Organization Owner's role cannot be changed this way — use transferOwnership.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      return { ok: true as const };
    }),

  removeMember: protectedProcedure
    .input(organizationIdInput.extend({ userId: z.string().uuid() }))
    .use(
      requireCapability(
        canManageOrganization,
        (input: { organizationId: string }) => input.organizationId,
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await removeMember(input.organizationId, input.userId, ctx.session.user.id);
      if (!result.ok) {
        const message =
          result.reason === "not_found"
            ? "Member not found."
            : "The Organization Owner cannot be removed — transfer ownership first.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      // D34/ID10: removal can revoke this User's access to any Void in the
      // Organization at once (the getVoidRole active-Membership check,
      // Phase 4) — re-check all of their live realtime subscriptions rather
      // than enumerating which specific Voids were affected.
      emitUserAccessChanged(input.userId);
      return { ok: true as const };
    }),

  // Owner-only (canTransferOwnership) — see authorization/capabilities.ts.
  transferOwnership: protectedProcedure
    .input(organizationIdInput.extend({ newOwnerUserId: z.string().uuid() }))
    .use(
      requireCapability(
        canTransferOwnership,
        (input: { organizationId: string }) => input.organizationId,
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await transferOwnership(
        input.organizationId,
        input.newOwnerUserId,
        ctx.session.user.id,
      );
      if (!result.ok) {
        const messages = {
          no_active_owner: "No active owner found for this Organization.",
          already_owner: "That user is already the Owner.",
          target_not_active_member: "The target user is not an active member of this Organization.",
        } as const;
        throw new TRPCError({ code: "BAD_REQUEST", message: messages[result.reason] });
      }
      return { ok: true as const };
    }),
});
