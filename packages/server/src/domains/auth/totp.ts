import * as OTPAuth from "otpauth";
import { randomBytes, createHash } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users, totpBackupCodes } from "../../db/schema.js";
import { TOTP_BACKUP_CODE_COUNT } from "../../config/auth.js";

/** Optional, user-enabled TOTP 2FA (D23) — not required in MVP. */
export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function buildTotpUri(secret: string, email: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "Void",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  return totp.toString();
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: "Void",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  // window: 1 tolerates ±30s clock drift, standard practice.
  return totp.validate({ token: code, window: 1 }) !== null;
}

function hashBackupCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Returns the raw codes once (shown to the user at enrollment); only hashes are stored. */
export async function generateAndStoreBackupCodes(userId: string): Promise<string[]> {
  const rawCodes = Array.from({ length: TOTP_BACKUP_CODE_COUNT }, () =>
    randomBytes(5).toString("hex"),
  );

  await db.insert(totpBackupCodes).values(
    rawCodes.map((code) => ({
      userId,
      codeHash: hashBackupCode(code),
    })),
  );

  return rawCodes;
}

export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const codeHash = hashBackupCode(code);
  const [record] = await db
    .select()
    .from(totpBackupCodes)
    .where(
      and(
        eq(totpBackupCodes.userId, userId),
        eq(totpBackupCodes.codeHash, codeHash),
        isNull(totpBackupCodes.consumedAt),
      ),
    )
    .limit(1);

  if (!record) return false;

  await db
    .update(totpBackupCodes)
    .set({ consumedAt: new Date() })
    .where(eq(totpBackupCodes.id, record.id));

  return true;
}

export async function enableTotpForUser(userId: string, secret: string): Promise<void> {
  await db
    .update(users)
    .set({ totpSecret: secret, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/** Phase 7 account-settings UI: disabling also discards unused backup codes — they're only meaningful alongside an active secret. */
export async function disableTotpForUser(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ totpSecret: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.delete(totpBackupCodes).where(eq(totpBackupCodes.userId, userId));
  });
}
