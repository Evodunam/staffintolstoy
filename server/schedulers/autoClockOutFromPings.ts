import { db } from "../db";
import { storage } from "../storage";
import { timesheets, locationPings, jobSchedules } from "@shared/schema";
import { eq, and, isNull, desc, gte, lte } from "drizzle-orm";
import { sendPushNotification } from "../services/pushNotifications";
import { sendEmail } from "../email-service";

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const CLOCK_OUT_REMINDER_EMAIL_THROTTLE_MS = 30 * 60 * 1000; // Don't send same reminder more than once per 30 min
const STALE_PING_MINUTES = 15; // No ping for 15 min → clock out at last ping (concrete: never pay beyond last verified)
const WAKEUP_PING_MINUTES = 10; // No ping in 10 min → send challenge (confirm presence) push
const SCHEDULED_END_GRACE_MINUTES = 15; // Past scheduled end + 15 min → clock out at scheduled end
const TIME_AWAY_GEOFENCE_METERS = 500; // Same as routes: "left job site"
const MIN_CONSECUTIVE_OUTSIDE = 2; // Require 2 consecutive pings outside geofence before auto clock-out (reduces GPS drift false positives)
const MAX_SHIFT_HOURS = 14; // Safety: auto clock out if still clocked in after this many hours (forgot or device off)

let intervalId: NodeJS.Timeout | null = null;
const lastClockOutReminderSent = new Map<string, number>();

type PerformServerSideClockOut = (
  timesheetId: number,
  workerProfileId: number,
  clockOutTime: Date,
  latitude: number,
  longitude: number,
  distanceFromJob: number | null
) => Promise<void>;

async function sendClockOutReminderIfNotRecently(ts: { id: number; workerId: number; jobId: number }): Promise<void> {
  const key = `reminder-${ts.id}`;
  const last = lastClockOutReminderSent.get(key) ?? 0;
  if (Date.now() - last < CLOCK_OUT_REMINDER_EMAIL_THROTTLE_MS) return;

  const job = await storage.getJob(ts.jobId);
  const jobTitle = job?.title || "Job";

  await sendPushNotification(ts.workerId, "geolocation_wakeup", { jobId: ts.jobId, workerId: ts.workerId });
  await sendPushNotification(ts.workerId, "clock_out_reminder", { jobId: ts.jobId, jobTitle });

  const worker = await storage.getProfile(ts.workerId);
  if (worker?.email && worker.emailNotifications !== false) {
    const workerName = `${worker.firstName || ""} ${worker.lastName || ""}`.trim() || "Worker";
    const result = await sendEmail({
      to: worker.email,
      type: "geolocation_clock_out_reminder",
      data: { workerName, jobTitle: job.title, jobId: ts.jobId },
    });
    if (result.success) lastClockOutReminderSent.set(key, Date.now());
  }
}

/** Parse HH:MM or "h:mm AM/PM" to hours/minutes. */
function parseTimeToParts(timeStr: string): { hours: number; minutes: number } | null {
  if (!timeStr || typeof timeStr !== "string") return null;
  const t = timeStr.trim();
  const ampm = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    if (ampm[3].toUpperCase() === "PM" && h !== 12) h += 12;
    if (ampm[3].toUpperCase() === "AM" && h === 12) h = 0;
    return { hours: h, minutes: m };
  }
  const parts = t.split(":").map(Number);
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { hours: parts[0], minutes: parts[1] };
  }
  return null;
}

/** Get scheduled end datetime for a timesheet (clock-in date + job end time). Returns null if no schedule. */
async function getScheduledEndForTimesheet(clockInTime: Date, jobId: number): Promise<Date | null> {
  const job = await storage.getJob(jobId);
  if (!job) return null;
  const clockInDate = new Date(clockInTime);
  clockInDate.setHours(0, 0, 0, 0);
  const clockInEnd = new Date(clockInDate);
  clockInEnd.setHours(23, 59, 59, 999);

  const schedules = await db.select()
    .from(jobSchedules)
    .where(and(eq(jobSchedules.jobId, jobId), gte(jobSchedules.date, clockInDate), lte(jobSchedules.date, clockInEnd)));
  if (schedules.length > 0) {
    const s = schedules[0];
    const d = new Date(s.date);
    const parts = parseTimeToParts(s.endTime);
    if (parts) {
      d.setHours(parts.hours, parts.minutes, 0, 0);
      return d;
    }
  }
  const endTime = (job as any).endTime || ((job as any).scheduledTime && String((job as any).scheduledTime).includes("-") ? String((job as any).scheduledTime).split("-")[1]?.trim() : null);
  if (endTime) {
    const parts = parseTimeToParts(String(endTime));
    if (parts) {
      const d = new Date(clockInDate);
      d.setHours(parts.hours, parts.minutes, 0, 0);
      return d;
    }
  }
  return null;
}

async function sendAutoClockedOutEmail(workerId: number, jobId: number, clockOutTime: Date, reason?: string): Promise<void> {
  const worker = await storage.getProfile(workerId);
  const job = await storage.getJob(jobId);
  if (!worker?.email || worker.emailNotifications === false || !job) return;
  const workerName = `${worker.firstName || ""} ${worker.lastName || ""}`.trim() || "Worker";
  const timeStr = clockOutTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  await sendEmail({
    to: worker.email,
    type: "geolocation_auto_clocked_out",
    data: { workerName, jobTitle: job.title, jobId, clockOutTime: timeStr, reason },
  });
}

export async function checkAutoClockOutFromPings(): Promise<void> {
  const fn = (globalThis as any).__performServerSideClockOut as PerformServerSideClockOut | undefined;
  if (!fn) {
    console.log("[AutoClockOutFromPings] Handler not registered yet, skipping");
    return;
  }

  try {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_PING_MINUTES * 60 * 1000);
    const wakeupCutoff = new Date(now.getTime() - WAKEUP_PING_MINUTES * 60 * 1000);

    const active = await db
      .select({ id: timesheets.id, workerId: timesheets.workerId, jobId: timesheets.jobId, clockInTime: timesheets.clockInTime })
      .from(timesheets)
      .where(isNull(timesheets.clockOutTime));

    if (active.length === 0) return;

    for (const ts of active) {
      const clockInTime = new Date(ts.clockInTime);
      const pings = await db
        .select({
          latitude: locationPings.latitude,
          longitude: locationPings.longitude,
          createdAt: locationPings.createdAt,
          distanceFromJob: locationPings.distanceFromJob,
        })
        .from(locationPings)
        .where(and(
          eq(locationPings.workerProfileId, ts.workerId),
          eq(locationPings.jobId, ts.jobId),
          gte(locationPings.createdAt, clockInTime)
        ))
        .orderBy(desc(locationPings.createdAt))
        .limit(10);

      const shiftMs = now.getTime() - clockInTime.getTime();
      const maxShiftMs = MAX_SHIFT_HOURS * 60 * 60 * 1000;

      if (pings.length === 0) {
        const job = await storage.getJob(ts.jobId);
        const lat = job?.latitude != null ? parseFloat(job.latitude) : 0;
        const lng = job?.longitude != null ? parseFloat(job.longitude) : 0;
        if (shiftMs > maxShiftMs && Number.isFinite(lat) && Number.isFinite(lng)) {
          const clockOutTime = new Date(clockInTime.getTime() + maxShiftMs);
          await fn(ts.id, ts.workerId, clockOutTime, lat, lng, null);
          await sendAutoClockedOutEmail(ts.workerId, ts.jobId, clockOutTime, "Shift exceeded maximum allowed hours.");
          console.log(`[AutoClockOutFromPings] Timesheet ${ts.id} exceeded ${MAX_SHIFT_HOURS}h (no pings), auto clock-out at cap`);
        } else {
          const scheduledEnd = await getScheduledEndForTimesheet(clockInTime, ts.jobId);
          if (scheduledEnd && Number.isFinite(lat) && Number.isFinite(lng)) {
            const graceEnd = new Date(scheduledEnd.getTime() + SCHEDULED_END_GRACE_MINUTES * 60 * 1000);
            if (now.getTime() > graceEnd.getTime()) {
              await fn(ts.id, ts.workerId, scheduledEnd, lat, lng, null);
              await sendAutoClockedOutEmail(ts.workerId, ts.jobId, scheduledEnd, "Shift ended at scheduled time. You were clocked out.");
              console.log(`[AutoClockOutFromPings] Timesheet ${ts.id} (no pings) past scheduled end + ${SCHEDULED_END_GRACE_MINUTES}min, auto clock-out at scheduled end`);
            } else {
              await sendClockOutReminderIfNotRecently(ts);
              console.log(`[AutoClockOutFromPings] No ping for timesheet ${ts.id}, sent wakeup + reminder to worker ${ts.workerId}`);
            }
          } else {
            await sendClockOutReminderIfNotRecently(ts);
            console.log(`[AutoClockOutFromPings] No ping for timesheet ${ts.id}, sent wakeup + reminder to worker ${ts.workerId}`);
          }
        }
        continue;
      }

      const lastPing = pings[0];
      const lastPingTime = new Date(lastPing.createdAt);

      // Safety: shift exceeds max (e.g. forgot to clock out or device off) → clock out at clockIn + MAX_SHIFT_HOURS (we have pings for coords)
      if (shiftMs > maxShiftMs) {
        const clockOutTime = new Date(clockInTime.getTime() + maxShiftMs);
        const lat = Number(lastPing.latitude);
        const lng = Number(lastPing.longitude);
        const dist = lastPing.distanceFromJob != null ? Number(lastPing.distanceFromJob) : null;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          await fn(ts.id, ts.workerId, clockOutTime, lat, lng, dist);
          await sendAutoClockedOutEmail(ts.workerId, ts.jobId, clockOutTime, "Shift exceeded maximum allowed hours.");
          console.log(`[AutoClockOutFromPings] Timesheet ${ts.id} exceeded ${MAX_SHIFT_HOURS}h, auto clock-out at cap`);
        }
        continue;
      }

      // Scheduled end + grace: job has end time and we're past end + 15 min → clock out at scheduled end (concrete rule)
      const scheduledEnd = await getScheduledEndForTimesheet(clockInTime, ts.jobId);
      if (scheduledEnd) {
        const graceEnd = new Date(scheduledEnd.getTime() + SCHEDULED_END_GRACE_MINUTES * 60 * 1000);
        if (now.getTime() > graceEnd.getTime()) {
          const job = await storage.getJob(ts.jobId);
          const lat = job?.latitude != null ? parseFloat(job.latitude) : Number(lastPing.latitude);
          const lng = job?.longitude != null ? parseFloat(job.longitude) : Number(lastPing.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            await fn(ts.id, ts.workerId, scheduledEnd, lat, lng, lastPing.distanceFromJob != null ? Number(lastPing.distanceFromJob) : null);
            await sendAutoClockedOutEmail(ts.workerId, ts.jobId, scheduledEnd, `Shift ended at scheduled time. You were clocked out at ${scheduledEnd.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`);
            console.log(`[AutoClockOutFromPings] Timesheet ${ts.id} past scheduled end + ${SCHEDULED_END_GRACE_MINUTES}min, auto clock-out at scheduled end`);
          }
          continue;
        }
      }

      // Stale: no location for 15+ min (app closed, device off) → clock out at last known time (concrete: never pay beyond last verified)
      if (lastPingTime < staleCutoff) {
        const lat = Number(lastPing.latitude);
        const lng = Number(lastPing.longitude);
        const dist = lastPing.distanceFromJob != null ? Number(lastPing.distanceFromJob) : null;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          await fn(ts.id, ts.workerId, lastPingTime, lat, lng, dist);
          await sendAutoClockedOutEmail(ts.workerId, ts.jobId, lastPingTime, "We stopped receiving your location for 15+ minutes, so we clocked you out at the last known time.");
          console.log(`[AutoClockOutFromPings] Stale pings (${STALE_PING_MINUTES} min) for timesheet ${ts.id}, auto clock-out at last ping time`);
        } else {
          await sendClockOutReminderIfNotRecently(ts);
        }
        continue;
      }

      // Not stale but no recent ping (10 min) → send challenge (wakeup + reminder) so worker confirms presence or clocks out
      if (lastPingTime < wakeupCutoff) {
        await sendClockOutReminderIfNotRecently(ts);
        console.log(`[AutoClockOutFromPings] No recent ping for timesheet ${ts.id}, sent wakeup + reminder to worker ${ts.workerId}`);
        continue;
      }

      // Check last MIN_CONSECUTIVE_OUTSIDE pings: all outside geofence → auto clock out (use first outside time for fairness)
      const recent = pings.slice(0, MIN_CONSECUTIVE_OUTSIDE);
      const allOutside = recent.length >= MIN_CONSECUTIVE_OUTSIDE && recent.every((p) => (p.distanceFromJob != null ? Number(p.distanceFromJob) : 0) > TIME_AWAY_GEOFENCE_METERS);
      if (allOutside) {
        const usePing = recent[recent.length - 1];
        const lat = Number(usePing.latitude);
        const lng = Number(usePing.longitude);
        const dist = usePing.distanceFromJob != null ? Number(usePing.distanceFromJob) : null;
        const clockOutTime = new Date(usePing.createdAt);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          await fn(ts.id, ts.workerId, clockOutTime, lat, lng, dist);
          await sendAutoClockedOutEmail(ts.workerId, ts.jobId, clockOutTime, "Location showed you had left the job site.");
          console.log(`[AutoClockOutFromPings] Timesheet ${ts.id} left job site (${MIN_CONSECUTIVE_OUTSIDE} pings outside), auto clock-out at ${clockOutTime.toISOString()}`);
        }
      }
    }
  } catch (err) {
    console.error("[AutoClockOutFromPings] Error:", err);
  }
}

export function startAutoClockOutFromPingsScheduler(): void {
  if (intervalId) {
    console.log("[AutoClockOutFromPings] Scheduler already running");
    return;
  }
  console.log(`[AutoClockOutFromPings] Starting (every ${CHECK_INTERVAL / 60000} min)`);
  checkAutoClockOutFromPings();
  intervalId = setInterval(checkAutoClockOutFromPings, CHECK_INTERVAL);
}

export function stopAutoClockOutFromPingsScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[AutoClockOutFromPings] Stopped");
  }
}
