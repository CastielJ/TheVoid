import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../trpc.js";
import { checkRateLimit } from "../domains/auth/rateLimit.js";
import {
  hashPassword,
  verifyPassword,
  validatePasswordLength,
  isPasswordBreached,
} from "../domains/auth/password.js";
import { issueAuthToken, verifyAuthToken, consumeAuthToken } from "../domains/auth/tokens.js";
import {
  createSession,
  revokeSession,
  revokeAllOtherSessions,
  revokeAllSessionsForUser,
  listActiveSessions,
} from "../domains/auth/sessions.js";
import { setSessionCookie, clearSessionCookie } from "../domains/auth/cookies.js";
import {
  findUserByEmail,
  findUserById,
  createUser,
  markEmailVerified,
  updatePassword,
} from "../domains/auth/users.js";
import {
  generateTotpSecret,
  buildTotpUri,
  verifyTotpCode,
  generateAndStoreBackupCodes,
  consumeBackupCode,
  enableTotpForUser,
  disableTotpForUser,
} from "../domains/auth/totp.js";
import {
  createPendingTwoFactorChallenge,
  consumePendingTwoFactorChallenge,
} from "../domains/auth/twoFactorChallenge.js";
import { emailSender } from "../email/index.js";

const emailSchema = z.string().email();

function clientIp(req: { ip: string }): string {
  return req.ip;
}

export const authRouter = router({
  // --- Signup / email verification ---------------------------------------
  signup: publicProcedure
    .input(z.object({ email: emailSchema, password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(`signup:${clientIp(ctx.req)}`, { windowMs: 60 * 60 * 1000, max: 10 });

      const lengthCheck = validatePasswordLength(input.password);
      if (!lengthCheck.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: lengthCheck.message });
      }
      if (await isPasswordBreached(input.password)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This password has appeared in a known data breach. Please choose another.",
        });
      }

      const existing = await findUserByEmail(input.email);
      if (existing) {
        // Do not reveal whether the account exists (standard practice).
        return { ok: true as const };
      }

      const passwordHash = await hashPassword(input.password);
      const user = await createUser(input.email, passwordHash);
      const rawToken = await issueAuthToken(user.id, "email_verification");
      await emailSender.send("email_verification", user.email, { token: rawToken });

      return { ok: true as const };
    }),

  verifyEmail: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const result = await verifyAuthToken(input.token, "email_verification");
      if (!result.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid or expired token (${result.reason}).`,
        });
      }
      await consumeAuthToken(result.tokenId);
      await markEmailVerified(result.userId);
      return { ok: true as const };
    }),

  // --- Password login (with optional 2FA challenge) -----------------------
  login: publicProcedure
    .input(
      z.object({ email: emailSchema, password: z.string(), rememberMe: z.boolean().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(`login:${clientIp(ctx.req)}:${input.email}`, {
        windowMs: 15 * 60 * 1000,
        max: 10,
      });

      const user = await findUserByEmail(input.email);
      const invalidCredentials = () =>
        new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });

      if (!user || !user.passwordHash) throw invalidCredentials();
      if (!(await verifyPassword(user.passwordHash, input.password))) throw invalidCredentials();

      if (user.totpSecret) {
        const challengeToken = createPendingTwoFactorChallenge(user.id);
        return { requiresTwoFactor: true as const, challengeToken };
      }

      const { rawToken, expiresAt } = await createSession(user.id, {
        rememberMe: input.rememberMe,
        ipAddress: clientIp(ctx.req),
      });
      setSessionCookie(ctx.res, rawToken, expiresAt);
      return { requiresTwoFactor: false as const };
    }),

  verify2FA: publicProcedure
    .input(
      z.object({
        challengeToken: z.string(),
        code: z.string(),
        isBackupCode: z.boolean().optional(),
        rememberMe: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(`2fa:${clientIp(ctx.req)}`, { windowMs: 15 * 60 * 1000, max: 10 });

      const userId = consumePendingTwoFactorChallenge(input.challengeToken);
      if (!userId)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Challenge expired or invalid." });

      const user = await findUserById(userId);
      if (!user || !user.totpSecret) throw new TRPCError({ code: "UNAUTHORIZED" });

      const codeValid = input.isBackupCode
        ? await consumeBackupCode(userId, input.code)
        : verifyTotpCode(user.totpSecret, input.code);

      if (!codeValid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid code." });

      const { rawToken, expiresAt } = await createSession(user.id, {
        rememberMe: input.rememberMe,
        ipAddress: clientIp(ctx.req),
      });
      setSessionCookie(ctx.res, rawToken, expiresAt);
      return { ok: true as const };
    }),

  // --- Passwordless magic-link login (D19) --------------------------------
  requestMagicLink: publicProcedure
    .input(z.object({ email: emailSchema }))
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(`magic-link:${clientIp(ctx.req)}:${input.email}`, {
        windowMs: 15 * 60 * 1000,
        max: 5,
      });

      let user = await findUserByEmail(input.email);
      // Magic link can also be how a brand-new user signs up (D19: both
      // methods authenticate the same underlying account, no separate
      // account types) — create the account on first request.
      if (!user) {
        user = await createUser(input.email);
      }

      const rawToken = await issueAuthToken(user.id, "magic_link");
      await emailSender.send("magic_link", user.email, { token: rawToken });
      return { ok: true as const };
    }),

  verifyMagicLink: publicProcedure
    .input(z.object({ token: z.string(), rememberMe: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await verifyAuthToken(input.token, "magic_link");
      if (!result.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid or expired link (${result.reason}).`,
        });
      }
      await consumeAuthToken(result.tokenId);
      // A successful magic-link click also verifies the email itself.
      await markEmailVerified(result.userId);

      const { rawToken, expiresAt } = await createSession(result.userId, {
        rememberMe: input.rememberMe,
        ipAddress: clientIp(ctx.req),
      });
      setSessionCookie(ctx.res, rawToken, expiresAt);
      return { ok: true as const };
    }),

  // --- Password reset ------------------------------------------------------
  requestPasswordReset: publicProcedure
    .input(z.object({ email: emailSchema }))
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(`pwreset:${clientIp(ctx.req)}:${input.email}`, {
        windowMs: 60 * 60 * 1000,
        max: 5,
      });

      const user = await findUserByEmail(input.email);
      if (user) {
        const rawToken = await issueAuthToken(user.id, "password_reset");
        await emailSender.send("password_reset", user.email, { token: rawToken });
      }
      // Same response whether or not the account exists (standard practice).
      return { ok: true as const };
    }),

  resetPassword: publicProcedure
    .input(z.object({ token: z.string(), newPassword: z.string() }))
    .mutation(async ({ input }) => {
      const result = await verifyAuthToken(input.token, "password_reset");
      if (!result.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid or expired token (${result.reason}).`,
        });
      }

      const lengthCheck = validatePasswordLength(input.newPassword);
      if (!lengthCheck.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: lengthCheck.message });
      }
      if (await isPasswordBreached(input.newPassword)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This password has appeared in a known data breach. Please choose another.",
        });
      }

      await consumeAuthToken(result.tokenId);
      const passwordHash = await hashPassword(input.newPassword);
      await updatePassword(result.userId, passwordHash);
      // ID13/D28: a password reset invalidates any session an attacker may
      // have established, not just future logins.
      await revokeAllSessionsForUser(result.userId);

      return { ok: true as const };
    }),

  // --- 2FA enrollment (requires an existing session) -----------------------
  begin2FAEnrollment: protectedProcedure.mutation(async ({ ctx }) => {
    const secret = generateTotpSecret();
    const uri = buildTotpUri(secret, ctx.session.user.email);
    // Secret is returned to the client only for this enrollment step (to
    // render a QR code / manual-entry string); it is NOT persisted until
    // confirmed via confirm2FAEnrollment, so an abandoned enrollment never
    // leaves a half-configured 2FA state.
    return { secret, uri };
  }),

  confirm2FAEnrollment: protectedProcedure
    .input(z.object({ secret: z.string(), code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!verifyTotpCode(input.secret, input.code)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid code." });
      }
      await enableTotpForUser(ctx.session.user.id, input.secret);
      const backupCodes = await generateAndStoreBackupCodes(ctx.session.user.id);
      return { backupCodes };
    }),

  // Password re-confirmation required — disabling 2FA is a security
  // downgrade, not an ordinary settings change (same bar as a password
  // reset invalidating sessions, ID13/D28's spirit applied here).
  disable2FA: protectedProcedure
    .input(z.object({ password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await findUserById(ctx.session.user.id);
      if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect password." });
      }
      await disableTotpForUser(ctx.session.user.id);
      return { ok: true as const };
    }),

  // --- Session management (D26) --------------------------------------------
  listSessions: protectedProcedure.query(async ({ ctx }) => {
    return listActiveSessions(ctx.session.user.id);
  }),

  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await revokeSession(input.sessionId, ctx.session.user.id);
      return { ok: true as const };
    }),

  revokeAllOtherSessions: protectedProcedure.mutation(async ({ ctx }) => {
    await revokeAllOtherSessions(ctx.session.user.id, ctx.session.sessionId);
    return { ok: true as const };
  }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await revokeSession(ctx.session.sessionId, ctx.session.user.id);
    clearSessionCookie(ctx.res);
    return { ok: true as const };
  }),

  me: protectedProcedure.query(({ ctx }) => {
    return {
      id: ctx.session.user.id,
      email: ctx.session.user.email,
      totpEnabled: Boolean(ctx.session.user.totpSecret),
    };
  }),
});
