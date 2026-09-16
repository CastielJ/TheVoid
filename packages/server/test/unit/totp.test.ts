import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { generateTotpSecret, verifyTotpCode } from "../../src/domains/auth/totp.js";

describe("TOTP 2FA (D23, optional user-enabled)", () => {
  it("generates a usable base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/); // base32 alphabet
  });

  it("verifies a code generated from the same secret", () => {
    const secret = generateTotpSecret();
    const totp = new OTPAuth.TOTP({
      issuer: "Void",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
    const code = totp.generate();
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("rejects a code generated from a different secret", () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const totpB = new OTPAuth.TOTP({
      issuer: "Void",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: secretB,
    });
    expect(verifyTotpCode(secretA, totpB.generate())).toBe(false);
  });
});
