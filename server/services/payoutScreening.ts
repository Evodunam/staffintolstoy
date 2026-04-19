import { db } from "../db";
import { eq } from "drizzle-orm";
import { adminActivityLog, profiles } from "@shared/schema";
import { screenAgainstSdn, type ScreeningResult } from "./ofacScreening";

/**
 * Pre-payout OFAC sanctions enforcement.
 *
 * Wraps any code path that disburses money to a worker / vendor and ensures
 * the payee has been screened against the OFAC SDN list within the last 24h.
 *
 * Today worker disbursements run through Mercury (`mercuryService.sendPayment`),
 * which always calls `ensureClearedForPayout` first. If you add Stripe Connect
 * instant payouts, bank transfers, or any other rail, invoke the same helper
 * immediately before the money movement.
 * Result is cached per (workerProfileId | rawName) so a burst of payouts to
 * the same worker doesn't re-download the SDN list 100 times.
 *
 * Three outcomes:
 *   - cleared:  payment proceeds.
 *   - review:   payment blocked. Admin must manually clear via
 *               adminClearPayee(profileId) — typically after sight-of-ID
 *               verification that the fuzzy match is a false positive.
 *   - blocked:  payment blocked permanently in code (only adminClearPayee
 *               with `acknowledgeBlockedMatch: true` overrides). At this
 *               point you should also consult counsel — a true SDN match
 *               may carry an OFAC reporting obligation.
 *
 * If the SDN list fetch itself fails we FAIL CLOSED (treat as blocked).
 * Sanctions exposure is non-recoverable; a transient network blip causing
 * a delayed payout is.
 */

const CLEARANCE_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_OVERRIDE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map<string, { result: ScreeningResult; cachedAt: number; adminOverride?: boolean }>();

export class OfacBlockedError extends Error {
  constructor(
    message: string,
    public readonly screening: ScreeningResult,
    public readonly profileId: number | null,
  ) {
    super(message);
    this.name = "OfacBlockedError";
  }
}

interface ScreenInput {
  /** When known, prefer this — name is pulled from the profile so we screen
   *  the legal name on file (which the company submitted KYC docs for),
   *  not whatever the recipient label happens to say. */
  workerProfileId?: number;
  /** Raw name fallback if no profile id is available (rare). */
  rawName?: string;
  /** Optional ISO country code for context. */
  country?: string;
}

function cacheKey(input: ScreenInput): string {
  return input.workerProfileId
    ? `pid:${input.workerProfileId}`
    : `name:${(input.rawName || "").trim().toLowerCase()}`;
}

/**
 * Resolve the legal name to screen. Prefer profile firstName+lastName since
 * that's what the company verified via KYC.
 */
async function resolveName(input: ScreenInput): Promise<string | null> {
  if (input.workerProfileId) {
    const [p] = await db.select({
      firstName: profiles.firstName,
      lastName: profiles.lastName,
    }).from(profiles).where(eq(profiles.id, input.workerProfileId)).limit(1);
    if (!p) return input.rawName ?? null;
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    return name || input.rawName || null;
  }
  return input.rawName ?? null;
}

/**
 * Screen and either return cleared or throw OfacBlockedError. Use this at
 * every payout boundary. Idempotent + cache-aware so safe to call repeatedly.
 */
export async function ensureClearedForPayout(input: ScreenInput, opts: {
  /** Skip the screen entirely. Only set from admin endpoints with audit log. */
  bypass?: boolean;
  /** Email of the actor invoking the payment — recorded in admin activity log
   *  on review/blocked rejections so we can trace who tried to disburse. */
  actor?: string;
} = {}): Promise<ScreeningResult> {
  if (opts.bypass) {
    await logScreening({ ...input, status: "cleared", reason: "explicit_bypass", actor: opts.actor });
    return { status: "cleared", matches: [], checkedAt: new Date().toISOString() };
  }

  const key = cacheKey(input);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < (cached.adminOverride ? ADMIN_OVERRIDE_TTL_MS : CLEARANCE_TTL_MS)) {
    if (cached.result.status !== "cleared" && !cached.adminOverride) {
      throw new OfacBlockedError(
        `OFAC ${cached.result.status} (cached) — admin must clear before payout`,
        cached.result,
        input.workerProfileId ?? null,
      );
    }
    return cached.result;
  }

  const name = await resolveName(input);
  if (!name) {
    // Without a name we can't screen — block. Caller should ensure profile
    // is populated before initiating a payout.
    throw new OfacBlockedError("Cannot screen: no name resolved", { status: "blocked", matches: [], checkedAt: new Date().toISOString() }, input.workerProfileId ?? null);
  }

  let result: ScreeningResult;
  try {
    result = await screenAgainstSdn({ fullName: name, country: input.country });
  } catch (e: any) {
    // Fail closed: treat SDN-list fetch failures as blocked.
    const failed: ScreeningResult = { status: "blocked", matches: [], checkedAt: new Date().toISOString() };
    await logScreening({ ...input, status: "blocked", reason: `sdn_fetch_failed: ${e?.message || e}`, actor: opts.actor });
    throw new OfacBlockedError("OFAC list unavailable; payment blocked (fail-closed)", failed, input.workerProfileId ?? null);
  }

  cache.set(key, { result, cachedAt: Date.now() });
  await logScreening({ ...input, status: result.status, reason: result.matches.length ? `${result.matches.length} match(es)` : "no_match", actor: opts.actor });

  if (result.status !== "cleared") {
    throw new OfacBlockedError(
      `OFAC ${result.status} — ${result.matches.length} match(es). Admin must clear via /api/admin/payout-screening/clear.`,
      result,
      input.workerProfileId ?? null,
    );
  }
  return result;
}

/**
 * Admin override — explicitly clear a profile for payouts for the next 7 days.
 * Used after manual review of fuzzy matches (e.g. confirming the worker's ID
 * doesn't match the SDN entry's DOB). Acknowledging a true "blocked" match
 * requires `acknowledgeBlockedMatch: true` and should be a rare action with
 * counsel sign-off.
 */
export async function adminClearPayee(args: {
  workerProfileId: number;
  adminEmail: string;
  notes?: string;
  acknowledgeBlockedMatch?: boolean;
}): Promise<void> {
  const key = cacheKey({ workerProfileId: args.workerProfileId });
  const existing = cache.get(key);
  if (existing?.result.status === "blocked" && !args.acknowledgeBlockedMatch) {
    throw new Error("Cannot clear a 'blocked' status without acknowledgeBlockedMatch=true (consult counsel).");
  }
  cache.set(key, {
    result: { status: "cleared", matches: existing?.result.matches ?? [], checkedAt: new Date().toISOString() },
    cachedAt: Date.now(),
    adminOverride: true,
  });
  await db.insert(adminActivityLog).values({
    adminEmail: args.adminEmail,
    action: "ofac_payee_cleared",
    entityType: "worker",
    entityId: args.workerProfileId,
    details: {
      notes: args.notes ?? null,
      acknowledgeBlockedMatch: !!args.acknowledgeBlockedMatch,
      previousStatus: existing?.result.status ?? "uncached",
    },
  });
}

/**
 * Drop the cache entry for a payee — forces a fresh screen on next payout.
 * Useful after the worker updates their legal name on file.
 */
export function invalidateScreeningCache(workerProfileId: number) {
  cache.delete(cacheKey({ workerProfileId }));
}

async function logScreening(args: {
  workerProfileId?: number;
  rawName?: string;
  status: ScreeningResult["status"];
  reason: string;
  actor?: string;
}): Promise<void> {
  try {
    await db.insert(adminActivityLog).values({
      adminEmail: args.actor || "system",
      action: `ofac_screen_${args.status}`,
      entityType: "worker",
      entityId: args.workerProfileId ?? null,
      details: { rawName: args.rawName ?? null, reason: args.reason },
    });
  } catch (e) {
    // Logging failure must not block screening result — but loud, so we notice.
    console.error("[PayoutScreening] failed to log screening result:", e);
  }
}

