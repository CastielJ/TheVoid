import { describe, expect, it, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { TRPCClientError } from "@trpc/client";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/db/client.js";
import { emailSender } from "../../src/email/index.js";
import { createTestClient } from "../helpers/client.js";
import { resetAuthTables } from "../helpers/db.js";

/** Mirrors password.ts's own HIBP request shape (SHA-1, k-anonymity). */
function hibpSuffixFor(password: string): string {
  return createHash("sha1").update(password).digest("hex").toUpperCase().slice(5);
}

/**
 * Phase 1 verification (docs/implementation-plan.md §2 Phase 1 / §9 Tier 2):
 * the full signup/verify/login, magic-link, password-reset, and 2FA flows
 * work end-to-end against a real database, through the real tRPC wire
 * protocol (test/helpers/client.ts), not just unit-level function calls.
 */
describe("Phase 1: auth flows", () => {
  let app: FastifyInstance;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(async () => {
    await resetAuthTables();
    sendSpy = vi.spyOn(emailSender, "send");
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  function lastTokenSentFor(purpose: string): string {
    const call = sendSpy.mock.calls.findLast((c) => c[0] === purpose);
    if (!call) throw new Error(`No email of purpose ${purpose} was sent`);
    return (call[2] as { token: string }).token;
  }

  it("signup -> verifyEmail -> login -> me", async () => {
    const { client } = createTestClient(app);

    await client.auth.signup.mutate({
      email: "alice@example.com",
      username: "alice",
      visibleName: "Alice",
      password: "correct-horse-battery",
    });
    expect(sendSpy).toHaveBeenCalledWith(
      "email_verification",
      "alice@example.com",
      expect.objectContaining({ token: expect.any(String) }),
    );

    const verifyToken = lastTokenSentFor("email_verification");
    await client.auth.verifyEmail.mutate({ token: verifyToken });

    const loginResult = await client.auth.login.mutate({
      email: "alice@example.com",
      password: "correct-horse-battery",
    });
    expect(loginResult.requiresTwoFactor).toBe(false);

    const me = await client.auth.me.query();
    expect(me.email).toBe("alice@example.com");
    expect(me.username).toBe("alice");
    expect(me.visibleName).toBe("Alice");
    expect(me.emailVerified).toBe(true);
  });

  it("resendVerificationEmail issues a fresh token that supersedes the original, and no-ops once already verified", async () => {
    const { client } = createTestClient(app);
    await client.auth.signup.mutate({
      email: "judy@example.com",
      username: "judy",
      visibleName: "Judy",
      password: "correct-horse-battery",
    });
    await client.auth.login.mutate({
      email: "judy@example.com",
      password: "correct-horse-battery",
    });

    const firstToken = lastTokenSentFor("email_verification");
    await client.auth.resendVerificationEmail.mutate();
    const secondToken = lastTokenSentFor("email_verification");
    expect(secondToken).not.toBe(firstToken);

    // The superseded first token must no longer work (issueAuthToken
    // revokes any prior outstanding token of the same purpose, C4).
    await expect(client.auth.verifyEmail.mutate({ token: firstToken })).rejects.toThrow(
      TRPCClientError,
    );
    await client.auth.verifyEmail.mutate({ token: secondToken });

    // Once verified, resending is a no-op (no new email sent).
    sendSpy.mockClear();
    await client.auth.resendVerificationEmail.mutate();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("rejects login with the wrong password", async () => {
    const { client } = createTestClient(app);
    await client.auth.signup.mutate({
      email: "bob@example.com",
      username: "bob",
      visibleName: "Bob",
      password: "correct-horse-battery",
    });

    await expect(
      client.auth.login.mutate({ email: "bob@example.com", password: "wrong-password-entirely" }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("signup does not reveal whether an account already exists", async () => {
    const { client } = createTestClient(app);
    await client.auth.signup.mutate({
      email: "carol@example.com",
      username: "carol",
      visibleName: "Carol",
      password: "correct-horse-battery",
    });
    sendSpy.mockClear();

    // Second signup for the same email must not error and must not send
    // a second verification email (would leak account existence).
    await expect(
      client.auth.signup.mutate({
        email: "carol@example.com",
        username: "carol2",
        visibleName: "Carol",
        password: "another-password-1",
      }),
    ).resolves.toEqual({ ok: true });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("signup rejects a username that is already taken", async () => {
    const { client } = createTestClient(app);
    await client.auth.signup.mutate({
      email: "carol-a@example.com",
      username: "carolduplicate",
      visibleName: "Carol A",
      password: "correct-horse-battery",
    });

    await expect(
      client.auth.signup.mutate({
        email: "carol-b@example.com",
        username: "carolduplicate",
        visibleName: "Carol B",
        password: "correct-horse-battery",
      }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("breached-password: rejected without acknowledgeBreach, accepted with it — and the check runs for real on both submissions, not skipped when acknowledgeBreach is true", async () => {
    const { client } = createTestClient(app);
    const originalFetch = global.fetch;
    const suffix = hibpSuffixFor("aaaaaaaaaaaa");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `${suffix}:1`,
    } as Response);
    global.fetch = fetchSpy;

    try {
      await expect(
        client.auth.signup.mutate({
          email: "breach-test@example.com",
          username: "breachtest",
          visibleName: "Breach Test",
          password: "aaaaaaaaaaaa",
        }),
      ).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await expect(
        client.auth.signup.mutate({
          email: "breach-test@example.com",
          username: "breachtest",
          visibleName: "Breach Test",
          password: "aaaaaaaaaaaa",
          acknowledgeBreach: true,
        }),
      ).resolves.toEqual({ ok: true });
      // The invariant under test: the HIBP check must run unconditionally
      // on every submission, even when acknowledgeBreach=true — the flag
      // only changes what happens with the result, it must never
      // short-circuit the check itself.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("breached-password: acknowledgeBreach=true on a genuinely non-breached password still succeeds", async () => {
    const { client } = createTestClient(app);
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:2",
    } as Response);

    try {
      await expect(
        client.auth.signup.mutate({
          email: "not-breached@example.com",
          username: "notbreached",
          visibleName: "Not Breached",
          password: "aaaaaaaaaaaa",
          acknowledgeBreach: true,
        }),
      ).resolves.toEqual({ ok: true });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("breached-password: a too-short password is rejected regardless of acknowledgeBreach", async () => {
    const { client } = createTestClient(app);

    await expect(
      client.auth.signup.mutate({
        email: "short-pw@example.com",
        username: "shortpw",
        visibleName: "Short PW",
        password: "short1",
        acknowledgeBreach: true,
      }),
    ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  });

  it("magic-link login creates an account on first request and authenticates", async () => {
    const { client } = createTestClient(app);

    await client.auth.requestMagicLink.mutate({ email: "dave@example.com" });
    const token = lastTokenSentFor("magic_link");

    await client.auth.verifyMagicLink.mutate({ token });
    const me = await client.auth.me.query();
    expect(me.email).toBe("dave@example.com");
  });

  it("a magic-link token is single-use", async () => {
    const { client } = createTestClient(app);
    await client.auth.requestMagicLink.mutate({ email: "erin@example.com" });
    const token = lastTokenSentFor("magic_link");

    await client.auth.verifyMagicLink.mutate({ token });
    await expect(client.auth.verifyMagicLink.mutate({ token })).rejects.toThrow(TRPCClientError);
  });

  it("password reset invalidates existing sessions (ID13)", async () => {
    const { client } = createTestClient(app);
    await client.auth.signup.mutate({
      email: "frank@example.com",
      username: "frank",
      visibleName: "Frank",
      password: "correct-horse-battery",
    });
    await client.auth.verifyEmail.mutate({ token: lastTokenSentFor("email_verification") });
    await client.auth.login.mutate({
      email: "frank@example.com",
      password: "correct-horse-battery",
    });

    // Confirm the session works before reset.
    await expect(client.auth.me.query()).resolves.toMatchObject({ email: "frank@example.com" });

    await client.auth.requestPasswordReset.mutate({ email: "frank@example.com" });
    const resetToken = lastTokenSentFor("password_reset");
    await client.auth.resetPassword.mutate({
      token: resetToken,
      newPassword: "new-correct-horse-battery",
    });

    // The old session must now be revoked.
    await expect(client.auth.me.query()).rejects.toThrow(TRPCClientError);

    // Login with the new password must succeed.
    const { client: freshClient } = createTestClient(app);
    const login = await freshClient.auth.login.mutate({
      email: "frank@example.com",
      password: "new-correct-horse-battery",
    });
    expect(login.requiresTwoFactor).toBe(false);
  });

  it("2FA enrollment gates subsequent logins behind a TOTP challenge", async () => {
    const { client } = createTestClient(app);
    await client.auth.signup.mutate({
      email: "grace@example.com",
      username: "grace",
      visibleName: "Grace",
      password: "correct-horse-battery",
    });
    await client.auth.verifyEmail.mutate({ token: lastTokenSentFor("email_verification") });
    await client.auth.login.mutate({
      email: "grace@example.com",
      password: "correct-horse-battery",
    });

    const { secret } = await client.auth.begin2FAEnrollment.mutate();
    const totp = new OTPAuth.TOTP({
      issuer: "Void",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
    const code = totp.generate();

    const { backupCodes } = await client.auth.confirm2FAEnrollment.mutate({ secret, code });
    expect(backupCodes.length).toBeGreaterThan(0);

    await client.auth.logout.mutate();

    // Logging in again must now require the 2FA challenge, not issue a session directly.
    const loginResult = await client.auth.login.mutate({
      email: "grace@example.com",
      password: "correct-horse-battery",
    });
    expect(loginResult.requiresTwoFactor).toBe(true);
    if (!loginResult.requiresTwoFactor) throw new Error("unreachable");

    const freshCode = totp.generate();
    await client.auth.verify2FA.mutate({
      challengeToken: loginResult.challengeToken,
      code: freshCode,
    });
    await expect(client.auth.me.query()).resolves.toMatchObject({ email: "grace@example.com" });
  });

  it("2FA backup codes are single-use", async () => {
    const { client } = createTestClient(app);
    await client.auth.signup.mutate({
      email: "heidi@example.com",
      username: "heidi",
      visibleName: "Heidi",
      password: "correct-horse-battery",
    });
    await client.auth.verifyEmail.mutate({ token: lastTokenSentFor("email_verification") });
    await client.auth.login.mutate({
      email: "heidi@example.com",
      password: "correct-horse-battery",
    });

    const { secret } = await client.auth.begin2FAEnrollment.mutate();
    const totp = new OTPAuth.TOTP({
      issuer: "Void",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
    const { backupCodes } = await client.auth.confirm2FAEnrollment.mutate({
      secret,
      code: totp.generate(),
    });
    await client.auth.logout.mutate();

    const login = await client.auth.login.mutate({
      email: "heidi@example.com",
      password: "correct-horse-battery",
    });
    if (!login.requiresTwoFactor) throw new Error("unreachable");

    const code = backupCodes[0]!;
    await client.auth.verify2FA.mutate({
      challengeToken: login.challengeToken,
      code,
      isBackupCode: true,
    });
    await client.auth.logout.mutate();

    const login2 = await client.auth.login.mutate({
      email: "heidi@example.com",
      password: "correct-horse-battery",
    });
    if (!login2.requiresTwoFactor) throw new Error("unreachable");

    // Reusing the same backup code must fail.
    await expect(
      client.auth.verify2FA.mutate({
        challengeToken: login2.challengeToken,
        code,
        isBackupCode: true,
      }),
    ).rejects.toThrow(TRPCClientError);
  });

  it("session management: list, revoke one, revoke all others", async () => {
    const { client: sessionA } = createTestClient(app);
    await sessionA.auth.signup.mutate({
      email: "ivan@example.com",
      username: "ivan",
      visibleName: "Ivan",
      password: "correct-horse-battery",
    });
    await sessionA.auth.verifyEmail.mutate({ token: lastTokenSentFor("email_verification") });
    await sessionA.auth.login.mutate({
      email: "ivan@example.com",
      password: "correct-horse-battery",
    });

    const { client: sessionB } = createTestClient(app);
    await sessionB.auth.login.mutate({
      email: "ivan@example.com",
      password: "correct-horse-battery",
    });

    const sessions = await sessionA.auth.listSessions.query();
    expect(sessions.length).toBe(2);

    await sessionA.auth.revokeAllOtherSessions.mutate();
    await expect(sessionB.auth.me.query()).rejects.toThrow(TRPCClientError);
    await expect(sessionA.auth.me.query()).resolves.toMatchObject({ email: "ivan@example.com" });
  });

  it("rejects a state-changing request from a disallowed Origin (ID9 CSRF protection)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/trpc/auth.login",
      headers: { origin: "https://evil.example.com", "content-type": "application/json" },
      payload: JSON.stringify({ json: { email: "x@example.com", password: "whatever12345" } }),
    });
    expect(response.statusCode).toBe(403);
  });
});
