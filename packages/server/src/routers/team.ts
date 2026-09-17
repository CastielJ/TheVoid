import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import { canManageOrganization, canManageTeam } from "../authorization/capabilities.js";
import {
  createTeam,
  findTeamById,
  listVisibleTeamsForOrganization,
  updateTeamName,
  updateTeamVisibility,
  deleteTeam,
} from "../domains/team/teams.js";
import { getActiveMembership } from "../domains/organization/memberships.js";
import {
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  setTeamLead,
  listTeamIdsUserIsMemberOf,
} from "../domains/team/teamMemberships.js";
import {
  createTeamJoinRequest,
  listPendingJoinRequestsForTeam,
  listTeamJoinRequestsForUser,
  findTeamJoinRequestById,
  decideTeamJoinRequest,
} from "../domains/team/teamJoinRequests.js";
import { teamVisibilityValues } from "../db/schema.js";

const teamIdInput = z.object({ teamId: z.string().uuid() });

export const teamRouter = router({
  // Creating a Team is an org-management action (no Team exists yet to
  // check canManageTeam against).
  create: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid(), name: z.string().min(1) }))
    .use(
      requireCapability(
        canManageOrganization,
        (input: { organizationId: string }) => input.organizationId,
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return createTeam(input.organizationId, input.name, ctx.session.user.id);
    }),

  // Any active Organization member may see the Team list (needed to pick a
  // Team when creating a Void) — narrower than canManageTeam, which governs
  // mutating a specific Team's membership/settings. Visibility-filtered:
  // an invisible Team is absent here entirely unless the caller is already a
  // member (listVisibleTeamsForOrganization) — this is the single choke
  // point that makes invisible-Team enforcement apply everywhere, since
  // every listing surface (Org dashboard, Void-creation Team picker, the new
  // left-panel tree) reads through this same procedure.
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const membership = await getActiveMembership(ctx.session.user.id, input.organizationId);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      const visibleTeams = await listVisibleTeamsForOrganization(
        input.organizationId,
        ctx.session.user.id,
      );
      // isMember: powers the left-panel tree's "show a join button at all"
      // decision without a second round-trip per Team.
      const memberTeamIds = await listTeamIdsUserIsMemberOf(
        ctx.session.user.id,
        visibleTeams.map((t) => t.id),
      );
      return visibleTeams.map((t) => ({ ...t, isMember: memberTeamIds.has(t.id) }));
    }),

  update: protectedProcedure
    .input(teamIdInput.extend({ name: z.string().min(1) }))
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .mutation(async ({ ctx, input }) => {
      await updateTeamName(input.teamId, input.name, ctx.session.user.id);
      return { ok: true as const };
    }),

  // Org Owner/Admin, or that Team's own Team Lead — same rule as `update`
  // above (canManageTeam), matching the existing pattern for who manages a
  // Team's settings.
  updateVisibility: protectedProcedure
    .input(teamIdInput.extend({ visibility: z.enum(teamVisibilityValues) }))
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .mutation(async ({ ctx, input }) => {
      await updateTeamVisibility(input.teamId, input.visibility, ctx.session.user.id);
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(teamIdInput)
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .mutation(async ({ ctx, input }) => {
      await deleteTeam(input.teamId, ctx.session.user.id);
      return { ok: true as const };
    }),

  listMembers: protectedProcedure
    .input(teamIdInput)
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .query(async ({ input }) => {
      const rows = await listTeamMembers(input.teamId);
      return rows.map(({ teamMembership, user }) => ({
        userId: user.id,
        email: user.email,
        username: user.username,
        visibleName: user.visibleName,
        isTeamLead: teamMembership.isTeamLead,
      }));
    }),

  addMember: protectedProcedure
    .input(teamIdInput.extend({ userId: z.string().uuid() }))
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .mutation(async ({ ctx, input }) => {
      const result = await addTeamMember(input.teamId, input.userId, ctx.session.user.id);
      if (!result.ok) {
        const messages = {
          team_not_found: "Team not found.",
          user_not_org_member: "That user is not an active member of this Team's Organization.",
          already_member: "That user is already a member of this Team.",
        } as const;
        throw new TRPCError({ code: "BAD_REQUEST", message: messages[result.reason] });
      }
      return { ok: true as const };
    }),

  removeMember: protectedProcedure
    .input(teamIdInput.extend({ userId: z.string().uuid() }))
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .mutation(async ({ ctx, input }) => {
      const result = await removeTeamMember(input.teamId, input.userId, ctx.session.user.id);
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found." });
      return { ok: true as const };
    }),

  setTeamLead: protectedProcedure
    .input(teamIdInput.extend({ userId: z.string().uuid(), isTeamLead: z.boolean() }))
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .mutation(async ({ ctx, input }) => {
      const result = await setTeamLead(
        input.teamId,
        input.userId,
        input.isTeamLead,
        ctx.session.user.id,
      );
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found." });
      return { ok: true as const };
    }),

  get: protectedProcedure
    .input(teamIdInput)
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .query(async ({ input }) => {
      const team = await findTeamById(input.teamId);
      if (!team) throw new TRPCError({ code: "NOT_FOUND" });
      return team;
    }),

  // Self-service, no capability gate beyond "logged in" — internal guards
  // (Team exists, is private, caller is an active Org member, not already a
  // member, no existing pending request) live inside createTeamJoinRequest.
  requestJoin: protectedProcedure.input(teamIdInput).mutation(async ({ ctx, input }) => {
    const result = await createTeamJoinRequest(input.teamId, ctx.session.user.id);
    if (!result.ok) {
      const messages = {
        team_not_found: "Team not found.",
        not_private: "This Team doesn't require a join request.",
        not_org_member: "You must be an active member of this Team's Organization first.",
        already_member: "You're already a member of this Team.",
        already_pending: "You already have a pending request for this Team.",
      } as const;
      throw new TRPCError({ code: "BAD_REQUEST", message: messages[result.reason] });
    }
    return { ok: true as const };
  }),

  // A user's own pending/decided requests — lets the UI show "Request
  // pending" instead of a raw "Request to join" button.
  listMyJoinRequests: protectedProcedure.query(async ({ ctx }) => {
    return listTeamJoinRequestsForUser(ctx.session.user.id);
  }),

  listJoinRequests: protectedProcedure
    .input(teamIdInput)
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .query(async ({ input }) => {
      const rows = await listPendingJoinRequestsForTeam(input.teamId);
      return rows.map(({ request, user }) => ({
        id: request.id,
        userId: user.id,
        username: user.username,
        visibleName: user.visibleName,
        createdAt: request.createdAt,
      }));
    }),

  // teamId is resolved from requestId server-side (never trusted from the
  // client) — requireCapability's getTargetId must be synchronous, so this
  // async lookup + the canManageTeam check both happen manually here rather
  // than through the usual middleware, same standing convention (never
  // trust a client-supplied parent id) applied by hand.
  decideJoinRequest: protectedProcedure
    .input(z.object({ requestId: z.string().uuid(), decision: z.enum(["accepted", "denied"]) }))
    .mutation(async ({ ctx, input }) => {
      const request = await findTeamJoinRequestById(input.requestId);
      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      const allowed = await canManageTeam(ctx.session.user.id, request.teamId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const result = await decideTeamJoinRequest(
        input.requestId,
        input.decision,
        ctx.session.user.id,
      );
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            result.reason === "already_decided"
              ? "This request has already been decided."
              : "Request not found.",
        });
      }
      return { ok: true as const };
    }),
});
