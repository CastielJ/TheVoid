import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import {
  canCreateChildVoid,
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
  updateVoidVisibility,
  deleteVoid,
  listTopLevelAccessibleVoids,
  listChildVoids,
  listVoidAncestors,
  listEligibleMembersForVoid,
  listOrganizationMembersEligibleForGrant,
} from "../domains/void/voids.js";
import {
  grantVoidAccess,
  revokeVoidAccessGrant,
  listVoidAccessGrantsWithUsers,
  findVoidAccessGrantById,
} from "../domains/void/voidAccessGrants.js";
import {
  createVoidJoinRequest,
  listPendingJoinRequestsForVoid,
  listVoidJoinRequestsForUser,
  findVoidJoinRequestById,
  decideVoidJoinRequest,
} from "../domains/void/voidJoinRequests.js";
import { getVoidCamera, saveVoidCamera } from "../domains/void/voidCamera.js";
import { voidVisibilityValues, voidAccessGrantRoleValues } from "../db/schema.js";
import { publishVoidEvent } from "../realtime/broadcast.js";
import { emitVoidAccessChanged } from "../realtime/events.js";

const voidIdInput = z.object({ voidId: z.string().uuid() });

export const voidRouter = router({
  // Not a single-capability check (implementation-plan.md §4's
  // requireCapability helper assumes one target/one capability): creating a
  // top-level Void only requires active Organization membership; creating a
  // child Void ("Team") under a parent additionally requires
  // canCreateChildVoid (Manager on the parent, or Org Admin/Owner). Both
  // checks still go through the shared capability module, just composed
  // here rather than via the single-capability middleware.
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        name: z.string().min(1),
        parentVoidId: z.string().uuid().optional(),
        // Optional, defaulting to "private" — matches the DB column's own
        // default (voids.visibility), so a bare {organizationId, name}
        // create still works without every caller having to think about
        // visibility up front (the wizard sets it explicitly; a quick
        // create elsewhere doesn't have to).
        visibility: z.enum(voidVisibilityValues).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await getActiveMembership(ctx.session.user.id, input.organizationId);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      if (
        input.parentVoidId &&
        !(await canCreateChildVoid(ctx.session.user.id, input.parentVoidId))
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const result = await createVoid(
        input.organizationId,
        input.name,
        input.parentVoidId ?? null,
        input.visibility ?? "private",
        ctx.session.user.id,
      );
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            result.reason === "parent_not_found"
              ? "Parent Void not found."
              : "That parent Void does not belong to this Organization.",
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

  // Org Owner/Admin, or that Void's own Manager — same rule as `update`
  // above (canManageVoidAccess), matching the existing pattern for who
  // manages a Void's settings. Applies uniformly at every nesting depth.
  updateVisibility: protectedProcedure
    .input(voidIdInput.extend({ visibility: z.enum(voidVisibilityValues) }))
    .use(requireCapability(canManageVoidAccess, (input: { voidId: string }) => input.voidId))
    .mutation(async ({ ctx, input }) => {
      await updateVoidVisibility(input.voidId, input.visibility, ctx.session.user.id);
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

  // Third feature pass — breadcrumb navigation for a nested Void ("Team").
  // Gated by mere access to the Void itself (Viewer+), same bar as getCamera.
  getAncestors: protectedProcedure
    .input(voidIdInput)
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      return listVoidAncestors(input.voidId);
    }),

  // Ungated: this query is scoped per-caller by construction (only Voids
  // `userId` can already access are returned), so a non-member simply gets
  // an empty list rather than a FORBIDDEN — no information is leaked either
  // way. Third feature pass: top-level only (parentVoidId IS NULL) — powers
  // OrgDashboardPage's Voids list and the left panel tree's root level;
  // nested children are fetched separately via `listChildren`.
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listTopLevelAccessibleVoids(ctx.session.user.id, input.organizationId);
    }),

  // Third feature pass — child Voids ("Teams") nested directly under a given
  // parent. Gated by mere access to the parent (Viewer+) — an invisible
  // child is filtered out inside listChildVoids itself unless the caller
  // already holds a direct grant on it, the same two-layer pattern the old
  // Team-visibility choke point used.
  listChildren: protectedProcedure
    .input(voidIdInput)
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .query(async ({ ctx, input }) => {
      return listChildVoids(input.voidId, ctx.session.user.id);
    }),

  grantAccess: protectedProcedure
    .input(
      z.object({
        voidId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(voidAccessGrantRoleValues),
      }),
    )
    .use(requireCapability(canManageVoidAccess, (input: { voidId: string }) => input.voidId))
    .mutation(async ({ ctx, input }) => {
      const result = await grantVoidAccess(
        input.voidId,
        input.userId,
        input.role,
        ctx.session.user.id,
      );
      if (!result.ok) {
        const message =
          result.reason === "void_not_found"
            ? "Void not found."
            : "That User does not belong to this Void's Organization.";
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
      const rows = await listVoidAccessGrantsWithUsers(input.voidId);
      return rows.map(({ grant, user }) => ({
        id: grant.id,
        userId: user.userId,
        username: user.username,
        visibleName: user.visibleName,
        email: user.email,
        role: grant.role,
      }));
    }),

  // Third feature pass — the "Add member" picker on a Void's settings page:
  // active Organization members who don't already hold a grant on this
  // Void. Manager-only (distinct from `listEligibleMembers` below, which is
  // the Viewer+ assignee picker over *current* members).
  listEligibleMembersForGrant: protectedProcedure
    .input(voidIdInput.extend({ query: z.string().optional() }))
    .use(requireCapability(canManageVoidAccess, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      return listOrganizationMembersEligibleForGrant(input.voidId, input.query);
    }),

  // Self-service, no capability gate beyond "logged in" — internal guards
  // (Void exists, is private, caller is an active Org member, not already
  // granted, no existing pending request) live inside createVoidJoinRequest.
  requestJoin: protectedProcedure.input(voidIdInput).mutation(async ({ ctx, input }) => {
    const result = await createVoidJoinRequest(input.voidId, ctx.session.user.id);
    if (!result.ok) {
      const messages = {
        void_not_found: "Void not found.",
        not_private: "This Void doesn't require a join request.",
        not_org_member: "You must be an active member of this Void's Organization first.",
        already_member: "You already have access to this Void.",
        already_pending: "You already have a pending request for this Void.",
      } as const;
      throw new TRPCError({ code: "BAD_REQUEST", message: messages[result.reason] });
    }
    return { ok: true as const };
  }),

  // A user's own pending/decided requests — lets the UI show "Request
  // pending" instead of a raw "Request to join" button.
  listMyJoinRequests: protectedProcedure.query(async ({ ctx }) => {
    return listVoidJoinRequestsForUser(ctx.session.user.id);
  }),

  listJoinRequests: protectedProcedure
    .input(voidIdInput)
    .use(requireCapability(canManageVoidAccess, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      const rows = await listPendingJoinRequestsForVoid(input.voidId);
      return rows.map(({ request, user }) => ({
        id: request.id,
        userId: user.id,
        username: user.username,
        visibleName: user.visibleName,
        createdAt: request.createdAt,
      }));
    }),

  // voidId is resolved from requestId server-side (never trusted from the
  // client) — requireCapability's getTargetId must be synchronous, so this
  // async lookup + the canManageVoidAccess check both happen manually here
  // rather than through the usual middleware, same standing convention
  // (never trust a client-supplied parent id) applied by hand. `role` is
  // required when accepting (the deciding Manager explicitly picks it, not
  // a fixed default) and ignored when denying.
  decideJoinRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        decision: z.enum(["accepted", "denied"]),
        role: z.enum(voidAccessGrantRoleValues).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await findVoidJoinRequestById(input.requestId);
      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      const allowed = await canManageVoidAccess(ctx.session.user.id, request.voidId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const result = await decideVoidJoinRequest(
        input.requestId,
        input.decision,
        input.role ?? null,
        ctx.session.user.id,
      );
      if (!result.ok) {
        const messages = {
          not_found: "Request not found.",
          already_decided: "This request has already been decided.",
          role_required: "Pick a role to grant before accepting.",
        } as const;
        throw new TRPCError({ code: "BAD_REQUEST", message: messages[result.reason] });
      }
      emitVoidAccessChanged(request.voidId);
      return { ok: true as const };
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
