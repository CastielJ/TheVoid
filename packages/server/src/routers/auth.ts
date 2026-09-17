import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../trpc.js";
import { checkRateLimit } from "../domains/auth/rateLimit.js";
import { hashPassword, verifyPassword, checkPasswordPolicy } from "../domains/auth/password.js";
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
  findUserByUsername,
  findUserById,
  createUser,
  markEmailVerified,
  updatePassword,
  updateVisibleName,
  updateThemePreference,
  isUsernameTaken,
  generateUsernameFromEmail,
  USERNAME_PATTERN,
} from "../domains/auth/users.js";
import { themePreferenceValues } from "../db/schema.js";
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

/**
 * Shared by signup/resetPassword/change-password: runs the unconditional
 * length + breach check and translates a policy failure into the right
 * TRPCError. "breached" gets its own distinguishable code (PRECONDITION_FAILED)
 * so the frontend can offer an explicit "Use anyway" override rather than a
 * plain rejection — there is no existing string-matching convention in this
 * codebase to follow, so a structural error code is used instead of message text.
 */
async function enforcePasswordPolicyOrThrow(
  plaintext: string,
  acknowledgeBreach: boolean,
): Promise<void> {
  const result = await checkPasswordPolicy(plaintext, acknowledgeBreach);
  if (result.ok) return;
  if (result.reason === "too_short") {
    throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "This password has appeared in a known data breach. You can proceed anyway if you understand the risk.",
  });
}

export const authRouter = router({
  // --- Signup / email verification ---------------------------------------
  signup: publicProcedure
    .input(
      z.object({
        email: emailSchema,
        username: z.string().regex(USERNAME_PATTERN, "3-20 lowercase letters, numbers, or _"),
        visibleName: z.string().trim().min(1).max(80),
        password: z.string(),
        acknowledgeBreach: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(`signup:${clientIp(ctx.req)}`, { windowMs: 60 * 60 * 1000, max: 10 });

      await enforcePasswordPolicyOrThrow(input.password, input.acknowledgeBreach);

      // Existing-email check must run BEFORE the username-uniqueness check,
      // not after — otherwise a resubmission for an already-registered
      // email (e.g. the same client retrying) leaks account existence via
      // a distinguishable "username taken" error instead of the intended
      // silent { ok: true }, since a deterministic client-side username
      // suggestion would collide with itself on a second attempt.
      const existing = await findUserByEmail(input.email);
      if (existing) {
        return { ok: true as const };
      }

      const username = input.username.toLowerCase();
      if (await isUsernameTaken(username)) {
        throw new TRPCError({ code: "CONFLICT", message: "That username is already taken." });
      }

      const passwordHash = await hashPassword(input.password);
      const user = await createUser({
        email: input.email,
        username,
        visibleName: input.visibleName,
        passwordHash,
      });
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

  // Authenticated + actor-keyed rate limit (mirrors routers/invitation.ts's
  // `invite:${ctx.session.user.id}` convention for authenticated endpoints).
  // issueAuthToken already revokes any prior outstanding token of the same
  // purpose (domains/auth/tokens.ts, C4) before issuing a new one, so no
  // separate revoke step is needed here.
  resendVerificationEmail: protectedProcedure.mutation(async ({ ctx }) => {
    checkRateLimit(`resend-verify:${ctx.session.user.id}`, {
      windowMs: 60 * 60 * 1000,
      max: 5,
    });

    const user = await findUserById(ctx.session.user.id);
    if (!user || user.emailVerifiedAt) {
      return { ok: true as const };
    }

    const rawToken = await issueAuthToken(user.id, "email_verification");
    await emailSender.send("email_verification", user.email, { token: rawToken });
    return { ok: true as const };
  }),

  // --- Password login (with optional 2FA challenge) -----------------------
  // Accepts either an email or a username as the identifier — whichever the
  // user finds easier to remember. Looked up as an email only when it
  // contains "@" (the one unambiguous signal, since a username can never
  // contain one per USERNAME_PATTERN); everything else is tried as a
  // username. Never reveals which kind of identifier was recognized in the
  // error message, same as the existing "Invalid email or password" wording.
  login: publicProcedure
    .input(
      z.object({
        identifier: z.string().min(1),
        password: z.string(),
        rememberMe: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(`login:${clientIp(ctx.req)}:${input.identifier}`, {
        windowMs: 15 * 60 * 1000,
        max: 10,
      });

      const user = input.identifier.includes("@")
        ? await findUserByEmail(input.identifier)
        : await findUserByUsername(input.identifier);
      const invalidCredentials = () =>
        new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email/username or password." });

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
      // account types) — create the account on first request. Username/
      // visibleName aren't collected by this flow, so a valid, unique
      // username is derived from the email and the local-part is used as a
      // starting visibleName; both are editable later from Account settings.
      if (!user) {
        const generatedUsername = await generateUsernameFromEmail(input.email);
        user = await createUser({
          email: input.email,
          username: generatedUsername,
          visibleName: input.email.split("@")[0] || "User",
        });
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
    .input(
      z.object({
        token: z.string(),
        newPassword: z.string(),
        acknowledgeBreach: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await verifyAuthToken(input.token, "password_reset");
      if (!result.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid or expired token (${result.reason}).`,
        });
      }

      await enforcePasswordPolicyOrThrow(input.newPassword, input.acknowledgeBreach);

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
      username: ctx.session.user.username,
      visibleName: ctx.session.user.visibleName,
      emailVerified: Boolean(ctx.session.user.emailVerifiedAt),
      totpEnabled: Boolean(ctx.session.user.totpSecret),
      themePreference: ctx.session.user.themePreference,
    };
  }),

  // Second feature pass: server-side theme preference, so it's consistent
  // across devices/sessions rather than reset per-device (localStorage is
  // still used as a synchronous write-through mirror to avoid a flash of
  // the wrong theme before this session loads — see app/theme.ts).
  updateThemePreference: protectedProcedure
    .input(z.object({ themePreference: z.enum(themePreferenceValues) }))
    .mutation(async ({ ctx, input }) => {
      await updateThemePreference(ctx.session.user.id, input.themePreference);
      return { ok: true as const };
    }),

  // visibleName only — username is set at registration and not editable in
  // this pass (no requirement to make it editable; changing it would also
  // break existing @username mentions pointing at it).
  updateVisibleName: protectedProcedure
    .input(z.object({ visibleName: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await updateVisibleName(ctx.session.user.id, input.visibleName);
      return { ok: true as const };
    }),
});
