import { db } from "../db";
import { eq, and, isNull, isNotNull, lt } from "drizzle-orm";
import { timesheets, profiles, jobs, deviceTokens } from "@shared/schema";
import { getBreakRules } from "@shared/mealRestBreaks";

/**
 * Periodic scheduler that pings workers via push notification a few minutes
 * before their state-mandated meal break window expires.
 *
 * Why this matters:
 *   - California Labor Code §512: 30-min meal break required by the end of
 *     the 5th hour of work. Missing it triggers 1 hour of premium pay.
 *   - We surface the obligation in-product so the company isn't on the hook
 *     for the penalty due to ignorance.
 *
 * Loop:
 *   - Every 5 minutes, find timesheets that are still open (no clockOutTime),
 *     don't yet have a meal break logged, and have crossed the state's
 *     "remind by" threshold.
 *   - Send a single push per timesheet (we track sent reminders in-memory so
 *     we don't spam — if the process restarts, the worker may get a second
 *     reminder, which is acceptable).
 */

const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
// How many minutes BEFORE the deadline to send the reminder. Workers need
// time to actually take the break.
const REMINDER_LEAD_MIN = 15;

let interval: NodeJS.Timeout | null = null;
let running = false;
const remindedTimesheetIds = new Set<number>();

interface ReminderStats {
  scanned: number;
  reminded: number;
  errors: number;
}

export async function runMealBreakReminderPass(now = new Date()): Promise<ReminderStats> {
  const stats: ReminderStats = { scanned: 0, reminded: 0, errors: 0 };

  // Active timesheets — clocked in, not clocked out, no meal break logged.
  const open = await db.select({
    id: timesheets.id,
    workerId: timesheets.workerId,
    jobId: timesheets.jobId,
    clockInTime: timesheets.clockInTime,
    mealBreaksTakenMinutes: timesheets.mealBreaksTakenMinutes,
    mealBreakWaived: timesheets.mealBreakWaived,
  }).from(timesheets).where(and(
    isNull(timesheets.clockOutTime),
    isNotNull(timesheets.clockInTime),
  )).limit(500);
  stats.scanned = open.length;

  for (const ts of open) {
    if (remindedTimesheetIds.has(ts.id)) continue;
    if ((ts.mealBreaksTakenMinutes ?? 0) > 0) continue;
    if (ts.mealBreakWaived) continue;

    try {
      // Resolve worker state — fall back to job state, then federal default.
      const [job] = await db.select({ state: jobs.state }).from(jobs).where(eq(jobs.id, ts.jobId)).limit(1);
      const [worker] = await db.select({ state: profiles.state }).from(profiles).where(eq(profiles.id, ts.workerId)).limit(1);
      const state = (worker?.state || job?.state || "").toUpperCase();
      const rules = getBreakRules(state);
      // FLSA default returns Infinity — those workers don't get reminders.
      if (!Number.isFinite(rules.mealBreakRequiredAfterHours)) continue;

      // First meal break is required after `mealBreakRequiredAfterHours` of work.
      const clockedIn = new Date(ts.clockInTime as any);
      const deadline = new Date(clockedIn.getTime() + rules.mealBreakRequiredAfterHours * 3600_000);
      const remindAt = new Date(deadline.getTime() - REMINDER_LEAD_MIN * 60_000);

      // Send only when we're between remindAt and deadline. Outside that
      // window, either too early (skip) or too late (penalty already accruing).
      if (now < remindAt) continue;
      if (now > deadline) {
        // Mark reminded so we don't keep evaluating it. The actual penalty
        // calc happens at timesheet approval time in wagePayCalc.ts.
        remindedTimesheetIds.add(ts.id);
        continue;
      }

      // Send push to all active device tokens for this worker.
      const tokens = await db.select({ token: deviceTokens.token })
        .from(deviceTokens)
        .where(and(eq(deviceTokens.profileId, ts.workerId), eq(deviceTokens.isActive, true)));
      if (tokens.length > 0) {
        const minsLeft = Math.max(1, Math.round((deadline.getTime() - now.getTime()) / 60_000));
        try {
          const { sendPushNotification } = await import("../firebase-admin");
          await sendPushNotification(
            tokens.map((t) => t.token),
            "Meal break due soon",
            `Take your ${rules.mealBreakMinMinutes || 30}-min meal break within ${minsLeft} minutes to avoid premium-pay penalty.`,
            { url: `/timesheets/${ts.id}`, action: "log_meal_break" },
          );
        } catch (e) {
          // Don't fail the whole pass on one push error.
          console.warn("[MealBreakReminder] push failed for timesheet", ts.id, e);
        }
      }
      remindedTimesheetIds.add(ts.id);
      stats.reminded++;
    } catch (e) {
      console.error("[MealBreakReminder] processing timesheet", ts.id, "failed:", e);
      stats.errors++;
    }
  }

  // Bound the in-memory set so it doesn't grow forever. 10k entries is plenty.
  if (remindedTimesheetIds.size > 10_000) {
    remindedTimesheetIds.clear();
  }
  return stats;
}

export function startMealBreakReminderScheduler() {
  if (interval) return;
  void import("../observability/schedulerHealth").then(({ registerScheduler }) => {
    registerScheduler("meal-break-reminder", SCHEDULER_INTERVAL_MS);
  });
  interval = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { recordRun } = await import("../observability/schedulerHealth");
      await recordRun("meal-break-reminder", async () => {
        const stats = await runMealBreakReminderPass();
        return { scanned: stats.scanned, reminded: stats.reminded, errors: stats.errors };
      });
    } catch (e) { console.error("[MealBreakReminder] tick failed:", e); }
    finally { running = false; }
  }, SCHEDULER_INTERVAL_MS);
  interval.unref?.();
  console.log("[MealBreakReminder] scheduler started (5min interval)");
}

export function stopMealBreakReminderScheduler() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

