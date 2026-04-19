import { db } from "../db";
import { eq } from "drizzle-orm";
import { workerAvailabilityWindows, workerAvailabilityBlackouts, profiles } from "@shared/schema";
import { checkAvailability, type WeeklyWindow, type Blackout, type AvailabilityCheck } from "@shared/workerAvailability";

/**
 * Server-side wrapper that fetches a worker's windows + blackouts from the DB
 * and runs the pure shared evaluator. Returns a simple boolean for matching
 * code, plus a detailed reason for logging / debug surfaces.
 *
 * Used by:
 *   - Job dispatch (`server/services/jobMatching*` and notification fan-out)
 *     to skip workers who can't take a shift.
 *   - The Apply endpoint to soft-warn workers applying outside their windows.
 */
export async function checkWorkerAvailable(
  profileId: number,
  shiftStart: Date,
  shiftEnd: Date,
): Promise<AvailabilityCheck> {
  // We don't store a per-worker timezone today. Infer one from the worker's
  // state when possible; default to America/Los_Angeles for new accounts. If
  // we add a profiles.timezone column later, swap this lookup.
  const [profile] = await db.select({ state: profiles.state })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  const timezone = stateToTimezone(profile?.state || "");

  const [windows, blackouts] = await Promise.all([
    db.select().from(workerAvailabilityWindows).where(eq(workerAvailabilityWindows.profileId, profileId)),
    db.select().from(workerAvailabilityBlackouts).where(eq(workerAvailabilityBlackouts.profileId, profileId)),
  ]);

  const weekly: WeeklyWindow[] = windows.map((w) => ({
    dayOfWeek: w.dayOfWeek,
    startMinute: w.startMinute,
    endMinute: w.endMinute,
  }));
  const blocks: Blackout[] = blackouts.map((b) => ({
    startsAt: new Date(b.startsAt as any),
    endsAt: new Date(b.endsAt as any),
    reason: b.reason ?? null,
  }));

  return checkAvailability(shiftStart, shiftEnd, weekly, blocks, timezone);
}

/**
 * Coarse mapping from US state code to IANA timezone. Doesn't handle states
 * that span multiple zones (Tennessee, Kentucky, Indiana, etc) — just picks
 * the dominant one. Good enough for UI defaults; for precise per-worker
 * scheduling, add a worker-set IANA timezone on the profile.
 */
function stateToTimezone(state: string): string {
  const s = state.toUpperCase();
  const PT = ["CA", "WA", "OR", "NV"];
  const MT = ["MT", "ID", "WY", "UT", "AZ", "NM", "CO"];
  const CT = ["TX", "OK", "KS", "NE", "SD", "ND", "MN", "IA", "MO", "AR", "LA", "MS", "AL", "WI", "IL"];
  const ET = ["NY", "NJ", "CT", "MA", "RI", "VT", "NH", "ME", "PA", "DE", "MD", "DC", "VA", "WV", "NC", "SC", "GA", "FL", "OH", "MI", "IN", "KY", "TN"];
  if (PT.includes(s)) return "America/Los_Angeles";
  if (MT.includes(s)) return "America/Denver";
  if (CT.includes(s)) return "America/Chicago";
  if (ET.includes(s)) return "America/New_York";
  if (s === "AK") return "America/Anchorage";
  if (s === "HI") return "Pacific/Honolulu";
  return "America/Los_Angeles";
}

