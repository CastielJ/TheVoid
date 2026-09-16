/**
 * Session lifetime defaults — approved 2026-09-16 as configurable
 * implementation defaults, not immutable product requirements
 * (docs/decisions.md, Implementation Planning Addenda, ID7). Centralized
 * here, not hardcoded at each call site, so a future security review can
 * retune them without touching authentication logic itself.
 */
export const SESSION_IDLE_EXPIRY_MS = 12 * 60 * 60 * 1000; // 12 hours
export const SESSION_REMEMBER_ME_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const SESSION_COOKIE_NAME = "void_session";

/**
 * AuthToken (email verification / magic link / password reset) expiry —
 * short-lived per architecture.md §4. Kept centralized for the same reason
 * as the session constants above.
 */
export const AUTH_TOKEN_EXPIRY_MS = {
  email_verification: 24 * 60 * 60 * 1000, // 24 hours
  magic_link: 15 * 60 * 1000, // 15 minutes
  password_reset: 60 * 60 * 1000, // 1 hour
} as const;

export type AuthTokenPurpose = keyof typeof AUTH_TOKEN_EXPIRY_MS;

/** Password policy baseline — docs/decisions.md D22 (NIST 800-63B-aligned). */
export const MIN_PASSWORD_LENGTH = 12;

/** TOTP backup codes issued at 2FA enrollment. */
export const TOTP_BACKUP_CODE_COUNT = 10;

/** Organization invitation expiry (D16: "~7-day expiry"). */
export const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
