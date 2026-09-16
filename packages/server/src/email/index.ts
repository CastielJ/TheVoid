import { logger } from "../logger.js";

/**
 * Provider-agnostic email-sending interface (docs/decisions.md ID12).
 * Domain modules (auth, invitation) depend only on this — never a vendor
 * SDK directly. The concrete provider remains open (deployment-preparation
 * time, per decisions.md); ConsoleEmailSender backs local dev/tests.
 */
export type EmailPurpose = "email_verification" | "magic_link" | "password_reset" | "invitation";

export interface EmailSender {
  send(purpose: EmailPurpose, to: string, data: Record<string, unknown>): Promise<void>;
}

class ConsoleEmailSender implements EmailSender {
  async send(purpose: EmailPurpose, to: string, data: Record<string, unknown>): Promise<void> {
    logger.info({ purpose, to, data }, "[ConsoleEmailSender] Would send email");
  }
}

// Real provider (Resend/Postmark/SES/etc.) is chosen at deployment-preparation
// time (docs/decisions.md ID12) — swapping it in requires no change to any
// caller, only this export.
export const emailSender: EmailSender = new ConsoleEmailSender();
