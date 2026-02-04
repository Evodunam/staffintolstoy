import { db } from '../db';
import { jobs, jobAssignments, timesheets, jobSchedules, applications } from '@shared/schema';
import { eq, and, inArray, gte, lte } from 'drizzle-orm';
import { addHours } from 'date-fns';
import { sendPushNotification } from '../services/pushNotifications';
import { sendEmail } from '../email-service';
import { storage } from '../storage';

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const WAKEUP_BEFORE_START_MS = 2 * 60 * 60 * 1000; // 2 hours before job start
const PING_AFTER_END_MS = 4 * 60 * 60 * 1000; // Continue pinging 4 hours after shift end (recurring/one-time)
const CLOCK_IN_EMAIL_THROTTLE_MS = 30 * 60 * 1000; // Don't send same clock-in email more than once per 30 min per worker+job

let intervalId: NodeJS.Timeout | null = null;
const lastClockInEmailSent = new Map<string, number>();

export async function checkGeolocationWakeups(): Promise<void> {
  console.log('[GeolocationWakeup] Checking for jobs needing geolocation wakeup...');
  
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Find job schedules for today with their job info
    const todaySchedules = await db.select({
      schedule: jobSchedules,
      job: jobs
    })
    .from(jobSchedules)
    .innerJoin(jobs, eq(jobSchedules.jobId, jobs.id))
    .where(and(
      gte(jobSchedules.date, startOfDay),
      lte(jobSchedules.date, endOfDay),
      inArray(jobs.status, ['open', 'in_progress'])
    ));
    
    if (todaySchedules.length === 0) {
      console.log('[GeolocationWakeup] No job schedules for today');
    }
    
    console.log(`[GeolocationWakeup] Found ${todaySchedules.length} job schedules for today`);
    
    for (const { schedule, job } of todaySchedules) {
      // Parse the actual start time from the schedule
      const jobStartTime = parseScheduleStartTime(schedule.date, schedule.startTime);
      if (!jobStartTime) {
        console.log(`[GeolocationWakeup] Could not parse start time for job ${job.id}`);
        continue;
      }
      
      // Ping window: 2 hrs before start to 4 hrs after end
      const jobEndTime = parseScheduleStartTime(schedule.date, schedule.endTime);
      const windowStart = addHours(jobStartTime, -2);
      const windowEnd = jobEndTime ? addHours(jobEndTime, 4) : addHours(jobStartTime, 12);
      if (now.getTime() < windowStart.getTime() || now.getTime() > windowEnd.getTime()) continue;
      
      // Get assigned workers for this job
      await sendWakeupsForJobWorkers(job, schedule.startTime, schedule.date, now, startOfDay, endOfDay, 'assignment');
    }

    // --- 2. Jobs WITHOUT jobSchedules (on-demand, one-time without schedule) ---
    const jobIdsWithSchedules = new Set(todaySchedules.map(({ job }) => job.id));
    const jobsWithAssignments = await db.select({ job: jobs })
      .from(jobs)
      .innerJoin(jobAssignments, eq(jobAssignments.jobId, jobs.id))
      .where(and(
        eq(jobAssignments.status, 'assigned'),
        inArray(jobs.status, ['open', 'in_progress'])
      ));
    for (const { job } of jobsWithAssignments) {
      if (jobIdsWithSchedules.has(job.id)) continue;
      const win = getPingWindowForJob(job);
      if (!win || now.getTime() < win.windowStart.getTime() || now.getTime() > win.windowEnd.getTime()) continue;
      const startTimeStr = ((job as any).scheduledTime || '09:00').toString().includes('-')
        ? ((job as any).scheduledTime || '09:00').toString().split('-')[0].trim()
        : ((job as any).scheduledTime || '09:00').toString();
      await sendWakeupsForJobWorkers(job, startTimeStr, win.scheduleDate, now, startOfDay, endOfDay, 'assignment');
    }

    // --- 3. Jobs with accepted applications (fallback when no jobAssignments) ---
    const jobIdsWithAssignments = new Set(jobsWithAssignments.map(({ job }) => job.id));
    const jobsWithAcceptedApps = await db.select({ job: jobs })
      .from(jobs)
      .innerJoin(applications, eq(applications.jobId, jobs.id))
      .where(and(
        eq(applications.status, 'accepted'),
        inArray(jobs.status, ['open', 'in_progress'])
      ));
    for (const { job } of jobsWithAcceptedApps) {
      if (jobIdsWithSchedules.has(job.id) || jobIdsWithAssignments.has(job.id)) continue;
      const win = getPingWindowForJob(job);
      if (!win || now.getTime() < win.windowStart.getTime() || now.getTime() > win.windowEnd.getTime()) continue;
      const startTimeStr = ((job as any).scheduledTime || '09:00').toString().includes('-')
        ? ((job as any).scheduledTime || '09:00').toString().split('-')[0].trim()
        : ((job as any).scheduledTime || '09:00').toString();
      await sendWakeupsForJobWorkers(job, startTimeStr, win.scheduleDate, now, startOfDay, endOfDay, 'application');
    }
    
    console.log('[GeolocationWakeup] Wakeup check completed');
  } catch (error) {
    console.error('[GeolocationWakeup] Error during wakeup check:', error);
  }
}

interface PingWindowResult {
  windowStart: Date;
  windowEnd: Date;
  scheduleDate: Date;
}

function getPingWindowForJob(job: typeof jobs.$inferSelect): PingWindowResult | null {
  const jobType = (job as any).jobType || 'one_time';
  const isOnDemand = (job as any).isOnDemand || jobType === 'on_demand';
  const startDate = new Date(job.startDate);
  const scheduledTime = ((job as any).scheduledTime || '09:00').toString();
  const endTime = ((job as any).endTime || '17:00').toString();
  const startTimeStr = scheduledTime.includes('-') ? scheduledTime.split('-')[0].trim() : scheduledTime;
  const endTimeStr = scheduledTime.includes('-') ? scheduledTime.split('-')[1]?.trim() || endTime : endTime;

  const parseTime = (d: Date, t: string) => {
    const r = parseScheduleStartTime(d, t);
    return r || d;
  };

  if (isOnDemand || jobType === 'on_demand') {
    const start = parseTime(startDate, startTimeStr);
    const windowStart = addHours(start, -2);
    const endDate = job.endDate ? new Date(job.endDate) : addHours(start, 14);
    return { windowStart, windowEnd: endDate, scheduleDate: startDate };
  }
  const start = parseTime(startDate, startTimeStr);
  const end = parseTime(startDate, endTimeStr);
  return {
    windowStart: addHours(start, -2),
    windowEnd: addHours(end, 4),
    scheduleDate: startDate,
  };
}

async function sendWakeupsForJobWorkers(
  job: typeof jobs.$inferSelect,
  startTimeStr: string,
  scheduleDate: Date,
  now: Date,
  startOfDay: Date,
  endOfDay: Date,
  source: 'assignment' | 'application'
): Promise<void> {
  const workerIds: number[] = [];
  if (source === 'assignment') {
    const assignments = await db.select()
      .from(jobAssignments)
      .where(and(eq(jobAssignments.jobId, job.id), eq(jobAssignments.status, 'assigned')));
    workerIds.push(...assignments.map((a) => a.workerId));
  } else {
    const apps = await db.select()
      .from(applications)
      .where(and(eq(applications.jobId, job.id), eq(applications.status, 'accepted')));
    workerIds.push(...apps.map((a) => a.workerId));
  }
  const uniqueWorkerIds = [...new Set(workerIds)];
  for (const workerId of uniqueWorkerIds) {
    const existingTimesheet = await db.select()
      .from(timesheets)
      .where(and(
        eq(timesheets.jobId, job.id),
        eq(timesheets.workerId, workerId),
        gte(timesheets.clockInTime, startOfDay),
        lte(timesheets.clockInTime, endOfDay)
      ))
      .limit(1);
    if (existingTimesheet.length > 0) continue;

    await sendPushNotification(workerId, 'geolocation_wakeup', { jobId: job.id, workerId });
    await sendPushNotification(workerId, 'clock_in_reminder', { jobId: job.id, jobTitle: job.title, startTime: startTimeStr });
    const emailKey = `${workerId}-${job.id}`;
    const lastSent = lastClockInEmailSent.get(emailKey) ?? 0;
    if (now.getTime() - lastSent >= CLOCK_IN_EMAIL_THROTTLE_MS) {
      const worker = await storage.getProfile(workerId);
      const workerName = worker ? `${worker.firstName || ''} ${worker.lastName || ''}`.trim() || 'Worker' : 'Worker';
      const location = [job.address, job.city, job.state].filter(Boolean).join(', ') || job.location || '';
      if (worker?.email && worker.emailNotifications !== false) {
        sendEmail({
          to: worker.email,
          type: 'geolocation_clock_in_reminder',
          data: { workerName, jobTitle: job.title, jobId: job.id, startTime: startTimeStr, location: location || undefined },
        }).then((r) => { if (r.success) lastClockInEmailSent.set(emailKey, now.getTime()); }).catch((e) => console.error('[GeolocationWakeup] Email error:', e));
      }
    }
  }
}

function parseScheduleStartTime(scheduleDate: Date, startTimeStr: string): Date | null {
  try {
    const result = new Date(scheduleDate);
    
    // Handle both "HH:MM" (24h) and "h:mm AM/PM" (12h) formats
    if (startTimeStr.includes('AM') || startTimeStr.includes('PM')) {
      const match = startTimeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (match) {
        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const period = match[3].toUpperCase();
        
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        
        result.setHours(hours, minutes, 0, 0);
      }
    } else {
      const [hours, minutes] = startTimeStr.split(':').map(Number);
      result.setHours(hours, minutes, 0, 0);
    }
    
    return result;
  } catch {
    return null;
  }
}

export function startGeolocationWakeupScheduler(): void {
  if (intervalId) {
    console.log('[GeolocationWakeup] Scheduler already running');
    return;
  }
  
  console.log(`[GeolocationWakeup] Starting scheduler (checking every ${CHECK_INTERVAL / 60000} minutes)`);
  
  // Run immediately
  checkGeolocationWakeups();
  
  // Then run periodically
  intervalId = setInterval(checkGeolocationWakeups, CHECK_INTERVAL);
}

export function stopGeolocationWakeupScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[GeolocationWakeup] Scheduler stopped');
  }
}
