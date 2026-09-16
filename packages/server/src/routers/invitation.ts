import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import {
  canManageOrganization,
  canManageOrganizationForInvitation,
} from "../authorization/capabilities.js";
import { findOrganizationById } from "../domains/organization/organizations.js";
import {
  createInvitation,
  listPendingInvitations,
  revokeInvitation,
  acceptInvitation,
} from "../domains/invitation/invitations.js";
import { emailSender } from "../email/index.js";
import { checkRateLimit } from "../domains/auth/rateLimit.js";

const emailSchema = z.string().email();

export const invitationRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        email: emailSchema,
        role: z.enum(["admin", "member"]),
      }),
    )
    .use(
      requireCapability(
        canManageOrganization,
        (input: { organizationId: string }) => input.organizationId,
      ),
    )
    .mutation(async ({ ctx, input }) => {
      // Phase 8 hardening: every other email-sending procedure
      // (signup/magic-link/password-reset, routers/auth.ts) is rate
      // limited against abuse/enumeration; this one sends email too and
      // had no equivalent limit. Keyed by actor (authenticated, unlike the
      // public auth endpoints keyed by IP) — bounds a single compromised
      // or malicious Admin account from mass-emailing arbitrary addresses.
      checkRateLimit(`invite:${ctx.session.user.id}`, { windowMs: 60 * 60 * 1000, max: 30 });

      const result = await createInvitation(
        input.organizationId,
        input.email,
        input.role,
        ctx.session.user.id,
      );
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That person is already a member of this Organization.",
        });
      }

      const org = await findOrganizationById(input.organizationId);
      await emailSender.send("invitation", input.email, {
        token: result.rawToken,
        organizationName: org?.name ?? "an Organization",
        role: input.role,
      });

      return {
        id: result.invitation.id,
        email: result.invitation.email,
        role: result.invitation.role,
      };
    }),

  listPending: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .use(
      requireCapability(
        canManageOrganization,
        (input: { organizationId: string }) => input.organizationId,
      ),
    )
    .query(async ({ input }) => {
      return listPendingInvitations(input.organizationId);
    }),

  revoke: protectedProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .use(
      requireCapability(
        canManageOrganizationForInvitation,
        (input: { invitationId: string }) => input.invitationId,
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await revokeInvitation(input.invitationId, ctx.session.user.id);
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),

  // Not capability-gated the usual way — any authenticated User may attempt
  // to accept any token; acceptInvitation itself enforces that the token's
  // target email matches the caller's own account email (the actual
  // security boundary here, domains/invitation/invitations.ts).
  accept: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await acceptInvitation(
        input.token,
        ctx.session.user.id,
        ctx.session.user.email,
      );
      if (!result.ok) {
        const messages = {
          not_found: "This invitation link is invalid or has already been used.",
          expired: "This invitation has expired.",
          wrong_account: "This invitation was sent to a different email address than your account.",
        } as const;
        throw new TRPCError({ code: "BAD_REQUEST", message: messages[result.reason] });
      }
      return { organizationId: result.organizationId };
    }),
});
