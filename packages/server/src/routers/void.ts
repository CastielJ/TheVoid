import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import {
  canCreateVoidForTeam,
  canManageVoidAccess,
  canAccessVoid,
  canDeleteVoid,
  canManageVoidAccessForGrant,
} from "../authorization/capabilities.js";
import { getActiveMembership } from "../domains/organization/memberships.js";
import {
  createVoid,
  findVoidById,
  updateVoidName,
  deleteVoid,
  listAccessibleVoids,
  listAccessibleVoidsWithTeamGrants,
  listEligibleMembersForVoid,
} from "../domains/void/voids.js";
import {
  grantVoidAccess,
  revokeVoidAccessGrant,
  listVoidAccessGrants,
  findVoidAccessGrantById,
  type GrantTarget,
} from "../domains/void/voidAccessGrants.js";
import { getVoidCamera, saveVoidCamera } from "../domains/void/voidCamera.js";
import { publishVoidEvent } from "../realtime/broadcast.js";
import { emitVoidAccessChanged } from "../realtime/events.js";

const voidIdInput = z.object({ voidId: z.string().uuid() });

export const voidRouter = router({
  // Not a single-capability check (implementation-plan.md §4's
  // requireCapability helper assumes one target/one capability): creating a
  // private Void only requires active Organization membership; creating a
  // Team-associated Void additionally requires canCreateVoidForTeam. Both
  // checks still go through the shared capability module, just composed
  // here rather than via the single-capability middleware.
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        name: z.string().min(1),
        teamId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await getActiveMembership(ctx.session.user.id, input.organizationId);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      if (input.teamId && !(await canCreateVoidForTeam(ctx.session.user.id, input.teamId))) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const result = await createVoid(
        input.organizationId,
        input.name,
        input.teamId ?? null,
        ctx.session.user.id,
      );
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That Team does not belong to this Organization.",
        });
      }
      return result.void;
    }),

  // Manager-only (D13: "manage Void-level settings").
  update: protectedProcedure
    .input(voidIdInput.extend({ name: z.string().min(1) }))
    .use(requireCapability(canManageVoidAccess, (input: { voidId: string }) => input.voidId))
    .mutation(async ({ ctx, input }) => {
      await updateVoidName(input.voidId, input.name, ctx.session.user.id);
      return { ok: true as const };
    }),

  // Void Manager OR Organization Admin/Owner (ID1 — an explicit, recorded
  // exception to C1, scoped narrowly to deletion).
  delete: protectedProcedure
    .input(voidIdInput)
    .use(requireCapability(canDeleteVoid, (input: { voidId: string }) => input.voidId))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteVoid(input.voidId, ctx.session.user.id);
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND" });
      // §6.2/ID10: broadcast void.deleted before the eviction check below
      // disconnects remaining subscribers, so they see an explicit
      // "deleted" state instead of the connection silently dropping.
      publishVoidEvent(input.voidId, "void.deleted", { voidId: input.voidId });
      emitVoidAccessChanged(input.voidId);
      return { ok: true as const };
    }),

  get: protectedProcedure
    .input(voidIdInput)
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      const voidRow = await findVoidById(input.voidId);
      if (!voidRow) throw new TRPCError({ code: "NOT_FOUND" });
      return voidRow;
    }),

  // Ungated: this query is scoped per-caller by construction (only Voids
  // `userId` can already access are returned), so a non-member simply gets
  // an empty list rather than a FORBIDDEN — no information is leaked either way.
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listAccessibleVoids(ctx.session.user.id, input.organizationId);
    }),

  // Second feature pass — powers the new left-panel Teams/Voids tree. Same
  // ungated-but-self-scoped reasoning as `list` above: only Voids the caller
  // can already access are returned, plus which Team(s) hold a grant on
  // each one (so a Void shared between two Teams renders under both, with a
  // "shared" badge).
  listMineWithTeamGrants: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listAccessibleVoidsWithTeamGrants(ctx.session.user.id, input.organizationId);
    }),

  grantAccess: protectedProcedure
    .input(
      z
        .object({
          voidId: z.string().uuid(),
          teamId: z.string().uuid().optional(),
          userId: z.string().uuid().optional(),
          role: z.enum(["viewer", "editor", "manager"]),
        })
        .refine((data) => Boolean(data.teamId) !== Boolean(data.userId), {
          message: "Exactly one of teamId or userId must be provided.",
        }),
    )
    .use(requireCapability(canManageVoidAccess, (input: { voidId: string }) => input.voidId))
    .mutation(async ({ ctx, input }) => {
      const target: GrantTarget = input.teamId
        ? { teamId: input.teamId }
        : { userId: input.userId! };
      const result = await grantVoidAccess(input.voidId, target, input.role, ctx.session.user.id);
      if (!result.ok) {
        const message =
          result.reason === "void_not_found"
            ? "Void not found."
            : "That Team or User does not belong to this Void's Organization.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      // ID10: any VoidAccessGrant mutation triggers a re-check — a grant
      // can only ever add/upgrade access, so this can never actually evict
      // anyone, but emitting unconditionally keeps the rule simple and
      // matches ID10's literal "any procedure that changes a
      // VoidAccessGrant" wording.
      emitVoidAccessChanged(input.voidId);
      return result.grant;
    }),

  revokeAccess: protectedProcedure
    .input(z.object({ grantId: z.string().uuid() }))
    .use(
      requireCapability(canManageVoidAccessForGrant, (input: { grantId: string }) => input.grantId),
    )
    .mutation(async ({ ctx, input }) => {
      const grant = await findVoidAccessGrantById(input.grantId);
      const result = await revokeVoidAccessGrant(input.grantId, ctx.session.user.id);
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND" });
      if (grant) emitVoidAccessChanged(grant.voidId);
      return { ok: true as const };
    }),

  listAccessGrants: protectedProcedure
    .input(voidIdInput)
    .use(requireCapability(canManageVoidAccess, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      return listVoidAccessGrants(input.voidId);
    }),

  // D31: personal camera state, gated by mere access (not edit) — reading/
  // writing your own viewport position is not a Void-content mutation.
  getCamera: protectedProcedure
    .input(voidIdInput)
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .query(async ({ ctx, input }) => {
      return getVoidCamera(input.voidId, ctx.session.user.id);
    }),

  saveCamera: protectedProcedure
    .input(voidIdInput.extend({ x: z.number(), y: z.number(), zoom: z.number().positive() }))
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .mutation(async ({ ctx, input }) => {
      const { voidId, ...camera } = input;
      await saveVoidCamera(voidId, ctx.session.user.id, camera);
      return { ok: true as const };
    }),

  // Post-launch refinement pass — powers the assignee search picker
  // ("Search members..." -> "Alex Johnson (@alex)"). Gated by mere access
  // (Viewer+), same bar as getCamera: this is a read of who else can see
  // this Void, not a content mutation.
  listEligibleMembers: protectedProcedure
    .input(voidIdInput.extend({ query: z.string().optional() }))
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      return listEligibleMembersForVoid(input.voidId, input.query);
    }),
});
