/**
 * Field-level PII encryption helper.
 *
 * Use ONLY for sensitive PII columns where the application needs to read the
 * plaintext (DOB, phone, address). For SSN/bank-account: don't store at all,
 * use Stripe / Mercury tokens.
 *
 * AES-256-GCM with a 32-byte key from PII_ENCRYPTION_KEY (base64). Each value
 * gets a random 12-byte IV; output is `iv|tag|ciphertext` concatenated and
 * base64-encoded — single column, single round-trip.
 *
 * Key rotation strategy: PII_ENCRYPTION_KEY_PREVIOUS holds the prior key for
 * decrypt-only fallback during rotation windows. New writes always use the
 * current key.
 *
 * Limitations:
 *   - You cannot search-by-equality on encrypted columns from SQL. Either
 *     accept that, or compute a deterministic HMAC alongside for indexed lookup.
 *   - No envelope encryption (KMS-managed DEK). For SOC 2 high bar, swap the
 *     key source for AWS KMS / GCP KMS DescribeKey + Decrypt.
 */
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(name: string): Buffer | null {
  const raw = process.env[name];
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    console.error(`[PII] ${name} must be a 32-byte base64-encoded key (got ${buf.length} bytes); skipping`);
    return null;
  }
  return buf;
}

let primaryKey: Buffer | null = null;
let previousKey: Buffer | null = null;
function ensureKeys() {
  if (primaryKey === null) primaryKey = loadKey("PII_ENCRYPTION_KEY");
  if (previousKey === null) previousKey = loadKey("PII_ENCRYPTION_KEY_PREVIOUS");
}

export function encryptPii(plaintext: string): string {
  ensureKeys();
  if (!primaryKey) {
    // No-op when key unset — the column stores plaintext but we never silently
    // claim it's encrypted. Caller can detect this by checking the prefix.
    return `pt:${plaintext}`;
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, primaryKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, enc]).toString("base64")}`;
}

export function decryptPii(stored: string): string {
  if (!stored) return stored;
  if (stored.startsWith("pt:")) return stored.slice(3); // legacy plaintext
  if (!stored.startsWith("v1:")) return stored;          // unknown format — return as-is
  ensureKeys();
  const buf = Buffer.from(stored.slice(3), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const tryWith = (key: Buffer) => {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  };
  if (primaryKey) {
    try { return tryWith(primaryKey); } catch { /* fall through to previous */ }
  }
  if (previousKey) {
    try { return tryWith(previousKey); } catch { /* fall through */ }
  }
  throw new Error("PII decrypt failed: no key matches the ciphertext");
}

/** Helper: wrap any plain object's value at `path` with encryption (mutates). */
export function encryptField<T extends Record<string, any>>(obj: T, key: keyof T): T {
  const v = obj[key];
  if (typeof v === "string" && v.length > 0 && !v.startsWith("v1:") && !v.startsWith("pt:")) {
    (obj as any)[key] = encryptPii(v);
  }
  return obj;
}
