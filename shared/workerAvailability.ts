/**
 * Pure helpers for evaluating whether a worker is available for a given shift.
 *
 * Two layers:
 *   1. Recurring weekly windows (e.g. "Mon-Fri 7am-3pm" in worker's local TZ).
 *      Stored as one row per (dayOfWeek, startMinute, endMinute) tuple.
 *      An empty list means "always available" (legacy / unconfigured workers).
 *   2. Ad-hoc blackout periods (e.g. PTO, surgery recovery). These override
 *      everything. Stored as (startsAt, endsAt) UTC ranges.
 *
 * All evaluation in this module operates in the worker's local timezone for
 * weekly windows but in absolute UTC for blackouts. The caller passes UTC
 * timestamps and the worker's IANA timezone string.
 */

export interface WeeklyWindow {
  dayOfWeek: number;       // 0=Sunday, 6=Saturday (matches Date.getDay())
  startMinute: number;     // minutes since 00:00 in worker's local TZ (0-1439)
  endMinute: number;       // exclusive; allow up to 1440 to mean "end of day"
}

export interface Blackout {
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

export interface AvailabilityCheck {
  available: boolean;
  reason: "no_windows_configured" | "blackout" | "outside_window" | "available";
  matchedWindow?: WeeklyWindow;
  blockingBlackout?: Blackout;
}

/**
 * Convert a UTC Date to a {dayOfWeek, minuteOfDay} pair in the given IANA TZ.
 * Uses Intl.DateTimeFormat — no extra dependency. Falls back to UTC if the
 * timezone string is invalid.
 */
export function toLocalDayMinute(utc: Date, timezone: string): { dayOfWeek: number; minuteOfDay: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    }).formatToParts(utc);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(utc);
  }
  const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return { dayOfWeek: wkMap[weekday] ?? 0, minuteOfDay: hour * 60 + minute };
}

/**
 * Check whether [shiftStart, shiftEnd) is fully covered by the worker's
 * weekly windows AND not blocked by any blackout. We require full coverage —
 * a partial overlap fails. This is intentional: if a worker says "Mon 9-5"
 * and the shift is "Mon 4pm-7pm", we want to flag that, not silently match.
 *
 * If `weeklyWindows` is empty, returns `available: true` with reason
 * `no_windows_configured` so legacy / unconfigured workers aren't broken.
 */
export function checkAvailability(
  shiftStart: Date,
  shiftEnd: Date,
  weeklyWindows: WeeklyWindow[],
  blackouts: Blackout[],
  timezone: string,
): AvailabilityCheck {
  // Blackouts win regardless of weekly windows.
  for (const b of blackouts) {
    const overlap = b.startsAt < shiftEnd && b.endsAt > shiftStart;
    if (overlap) return { available: false, reason: "blackout", blockingBlackout: b };
  }

  if (weeklyWindows.length === 0) {
    return { available: true, reason: "no_windows_configured" };
  }

  // Walk the shift in 15-minute steps and ensure every step is covered by
  // some window. Brute-force but bounded (max 96 steps for a 24h shift).
  const STEP_MIN = 15;
  const totalMinutes = Math.ceil((shiftEnd.getTime() - shiftStart.getTime()) / 60_000);
  const steps = Math.max(1, Math.ceil(totalMinutes / STEP_MIN));
  let firstMatched: WeeklyWindow | undefined;
  for (let i = 0; i < steps; i++) {
    const t = new Date(shiftStart.getTime() + i * STEP_MIN * 60_000);
    if (t >= shiftEnd) break;
    const { dayOfWeek, minuteOfDay } = toLocalDayMinute(t, timezone);
    const matched = weeklyWindows.find((w) => w.dayOfWeek === dayOfWeek && minuteOfDay >= w.startMinute && minuteOfDay < w.endMinute);
    if (!matched) return { available: false, reason: "outside_window" };
    if (!firstMatched) firstMatched = matched;
  }
  return { available: true, reason: "available", matchedWindow: firstMatched };
}

/**
 * Validate a list of weekly windows for client-side form input. Returns
 * the first error message, or null if all good.
 */
export function validateWindows(windows: WeeklyWindow[]): string | null {
  for (const w of windows) {
    if (w.dayOfWeek < 0 || w.dayOfWeek > 6) return `Invalid day-of-week ${w.dayOfWeek}`;
    if (w.startMinute < 0 || w.startMinute > 1440) return `Start minute out of range`;
    if (w.endMinute < 0 || w.endMinute > 1440) return `End minute out of range`;
    if (w.endMinute <= w.startMinute) return `Window end must be after start (day ${w.dayOfWeek})`;
  }
  // Detect overlapping windows on the same day — they're not strictly wrong
  // but probably unintentional.
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i], b = windows[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        return `Overlapping windows on day ${a.dayOfWeek}`;
      }
    }
  }
  return null;
}

export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60), m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

