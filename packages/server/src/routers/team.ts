import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import { canManageOrganization, canManageTeam } from "../authorization/capabilities.js";
import {
  createTeam,
  findTeamById,
  listTeamsForOrganization,
  updateTeamName,
  deleteTeam,
} from "../domains/team/teams.js";
import { getActiveMembership } from "../domains/organization/memberships.js";
import {
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  setTeamLead,
} from "../domains/team/teamMemberships.js";

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
  // mutating a specific Team's membership/settings.
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const membership = await getActiveMembership(ctx.session.user.id, input.organizationId);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      return listTeamsForOrganization(input.organizationId);
    }),

  update: protectedProcedure
    .input(teamIdInput.extend({ name: z.string().min(1) }))
    .use(requireCapability(canManageTeam, (input: { teamId: string }) => input.teamId))
    .mutation(async ({ ctx, input }) => {
      await updateTeamName(input.teamId, input.name, ctx.session.user.id);
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
});
