/**
 * TOTP (RFC 6238) MFA service.
 *
 * Required for company admins (or any role with payment-method authority);
 * optional for workers. Enrollment flow:
 *   1. POST /api/auth/mfa/setup → returns base32 secret + otpauth URL + QR PNG data URL.
 *      Secret is also persisted on the user row with mfa_enabled='pending'.
 *   2. User scans QR with Authenticator / Google Authenticator / 1Password.
 *   3. POST /api/auth/mfa/verify { token } → if valid, flips mfa_enabled='true'
 *      AND issues 10 single-use backup codes (returned ONCE, hashed-at-rest).
 *   4. Login flow: after password OK, if mfa_enabled='true', server returns
 *      "code: MFA_REQUIRED" instead of completing login. Client prompts for
 *      6-digit code or backup code, hits /api/auth/mfa/login-verify.
 *
 * Anti-replay: we track mfa_last_used_at. Reject any token whose 30s window
 * <= last-used window. Backup codes are deleted on use.
 */
import { authenticator } from "otplib";
import * as QRCode from "qrcode";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

// 30-second window, ±1 step grace (so user has 60s to type the code).
authenticator.options = { window: 1, step: 30 };

export interface MfaEnrollment {
  secret: string;            // base32, store on user row
  otpauthUrl: string;        // for user to scan
  qrPngDataUrl: string;      // base64 PNG, embed in <img>
}

export async function generateMfaEnrollment(userEmail: string): Promise<MfaEnrollment> {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(userEmail, "Tolstoy Staffing", secret);
  const qrPngDataUrl = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: "M", margin: 1, scale: 4 });
  return { secret, otpauthUrl, qrPngDataUrl };
}

export function verifyMfaToken(secret: string, token: string): boolean {
  if (!secret || !token) return false;
  return authenticator.check(token.replace(/\s+/g, ""), secret);
}

/** Generates 10 cryptographically-random backup codes; returns them in plaintext (show once) and as bcrypt hashes (persist). */
export async function generateBackupCodes(): Promise<{ plaintext: string[]; hashes: string[] }> {
  const plaintext: string[] = [];
  for (let i = 0; i < 10; i++) {
    // Format: XXXXX-XXXXX (10 chars total, easy to read & type).
    const raw = randomBytes(8).toString("hex").slice(0, 10).toUpperCase();
    plaintext.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  const hashes = await Promise.all(plaintext.map((code) => bcrypt.hash(code, 10)));
  return { plaintext, hashes };
}

/** Returns index of the matching backup code, or -1. Use with array.splice() to consume. */
export async function findMatchingBackupCode(input: string, hashes: string[]): Promise<number> {
  const normalized = input.replace(/\s+/g, "").toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) return i;
  }
  return -1;
}
