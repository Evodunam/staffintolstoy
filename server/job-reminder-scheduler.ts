import { db } from "./db";
import { jobs, applications, profiles, jobReminders, workerTeamMembers, jobSchedules } from "@shared/schema";
import { eq, and, gte, lte, isNull, inArray } from "drizzle-orm";
import { sendEmail } from "./email-service";
import { format, addMinutes, addHours, startOfDay, parse, isAfter, isBefore } from "date-fns";

const REMINDER_INTERVAL_MS = 60 * 1000; // Check every minute
const REMINDER_MINUTES_BEFORE = 15;
const REMINDER_24HR_HOURS_BEFORE = 24;
type ReminderType = "15_min_before" | "1_day_before";

interface JobWithSchedule {
  job: typeof jobs.$inferSelect;
  schedule: typeof jobSchedules.$inferSelect | null;
  assignment: {
    workerId: number;
    teamMemberId: number | null;
    proposedRate: number | null;
  };
  worker: typeof profiles.$inferSelect;
  teamMember: typeof workerTeamMembers.$inferSelect | null;
  company: typeof profiles.$inferSelect;
}

async function getUpcomingAssignments(): Promise<JobWithSchedule[]> {
  const now = new Date();
  const reminderWindow = addMinutes(now, REMINDER_MINUTES_BEFORE + 5); // 5 min buffer
  
  // Get all accepted applications with their jobs
  const acceptedApps = await db.select({
    application: applications,
    job: jobs,
    worker: profiles,
  })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(profiles, eq(applications.workerId, profiles.id))
    .where(
      and(
        eq(applications.status, "accepted"),
        eq(jobs.status, "in_progress")
      )
    );
  
  const results: JobWithSchedule[] = [];
  
  for (const app of acceptedApps) {
    // Get job schedules for this job
    const schedules = await db.select()
      .from(jobSchedules)
      .where(eq(jobSchedules.jobId, app.job.id));
    
    // Get company profile
    const [company] = await db.select()
      .from(profiles)
      .where(eq(profiles.id, app.job.companyId));
    
    if (!company) continue;
    
    // Get team member if applicable
    let teamMember = null;
    if (app.application.teamMemberId) {
      const [tm] = await db.select()
        .from(workerTeamMembers)
        .where(eq(workerTeamMembers.id, app.application.teamMemberId));
      teamMember = tm || null;
    }
    
    // Check if any schedule starts within the reminder window
    for (const schedule of schedules) {
      const scheduleDate = new Date(schedule.date);
      const today = startOfDay(now);
      
      // Only check schedules for today
      if (scheduleDate < today || scheduleDate > addMinutes(today, 24 * 60)) continue;
      
      // Parse start time (format: "HH:mm" or similar)
      const startTime = schedule.startTime;
      if (!startTime) continue;
      
      // Combine date with start time
      const [hours, minutes] = startTime.split(":").map(Number);
      const jobStartTime = new Date(scheduleDate);
      jobStartTime.setHours(hours, minutes, 0, 0);
      
      // Check if job starts within the reminder window (15-20 minutes from now)
      const reminderTime = addMinutes(jobStartTime, -REMINDER_MINUTES_BEFORE);
      
      if (isAfter(reminderTime, now) || isBefore(reminderTime, addMinutes(now, -5))) {
        continue; // Not within our window
      }
      
      results.push({
        job: app.job,
        schedule,
        assignment: {
          workerId: app.application.workerId,
          teamMemberId: app.application.teamMemberId,
          proposedRate: app.application.proposedRate,
        },
        worker: app.worker,
        teamMember,
        company,
      });
    }
    
    // Also check jobs without schedules but with startDate
    if (schedules.length === 0 && app.job.startDate) {
      const jobStartDate = new Date(app.job.startDate);
      const today = startOfDay(now);
      
      // If job start date is today
      if (jobStartDate >= today && jobStartDate <= addMinutes(today, 24 * 60)) {
        // Default to 9:00 AM if no specific time
        const jobStartTime = new Date(jobStartDate);
        if (jobStartTime.getHours() === 0 && jobStartTime.getMinutes() === 0) {
          jobStartTime.setHours(9, 0, 0, 0);
        }
        
        const reminderTime = addMinutes(jobStartTime, -REMINDER_MINUTES_BEFORE);
        
        if (isAfter(reminderTime, addMinutes(now, -5)) && isBefore(reminderTime, addMinutes(now, 5))) {
          results.push({
            job: app.job,
            schedule: null,
            assignment: {
              workerId: app.application.workerId,
              teamMemberId: app.application.teamMemberId,
              proposedRate: app.application.proposedRate,
            },
            worker: app.worker,
            teamMember,
            company,
          });
        }
      }
    }
  }
  
  return results;
}

/** Assignments starting in ~24 hours (for 1_day_before reminder). */
async function getUpcomingAssignments24hr(): Promise<JobWithSchedule[]> {
  const now = new Date();
  const in24hrStart = addHours(now, REMINDER_24HR_HOURS_BEFORE - 0.5);
  const in24hrEnd = addHours(now, REMINDER_24HR_HOURS_BEFORE + 0.5);

  const acceptedApps = await db.select({
    application: applications,
    job: jobs,
    worker: profiles,
  })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(profiles, eq(applications.workerId, profiles.id))
    .where(
      and(
        eq(applications.status, "accepted"),
        eq(jobs.status, "in_progress")
      )
    );

  const results: JobWithSchedule[] = [];

  for (const app of acceptedApps) {
    const schedules = await db.select()
      .from(jobSchedules)
      .where(eq(jobSchedules.jobId, app.job.id));

    const [company] = await db.select()
      .from(profiles)
      .where(eq(profiles.id, app.job.companyId));
    if (!company) continue;

    let teamMember = null;
    if (app.application.teamMemberId) {
      const [tm] = await db.select()
        .from(workerTeamMembers)
        .where(eq(workerTeamMembers.id, app.application.teamMemberId));
      teamMember = tm || null;
    }

    for (const schedule of schedules) {
      const scheduleDate = new Date(schedule.date);
      const startTime = schedule.startTime;
      if (!startTime) continue;
      const [hours, minutes] = startTime.split(":").map(Number);
      const jobStartTime = new Date(scheduleDate);
      jobStartTime.setHours(hours, minutes, 0, 0);
      if (isAfter(jobStartTime, in24hrStart) && isBefore(jobStartTime, in24hrEnd)) {
        results.push({
          job: app.job,
          schedule,
          assignment: {
            workerId: app.application.workerId,
            teamMemberId: app.application.teamMemberId,
            proposedRate: app.application.proposedRate,
          },
          worker: app.worker,
          teamMember,
          company,
        });
      }
    }

    if (schedules.length === 0 && app.job.startDate) {
      const jobStartDate = new Date(app.job.startDate);
      if (jobStartDate.getHours() === 0 && jobStartDate.getMinutes() === 0) {
        jobStartDate.setHours(9, 0, 0, 0);
      }
      if (isAfter(jobStartDate, in24hrStart) && isBefore(jobStartDate, in24hrEnd)) {
        results.push({
          job: app.job,
          schedule: null,
          assignment: {
            workerId: app.application.workerId,
            teamMemberId: app.application.teamMemberId,
            proposedRate: app.application.proposedRate,
          },
          worker: app.worker,
          teamMember,
          company,
        });
      }
    }
  }

  return results;
}

type ReminderTypeValue = "15_min_before" | "1_day_before";

async function hasReminderBeenSent(
  jobId: number,
  workerId: number,
  jobDate: Date,
  reminderType: ReminderTypeValue
): Promise<boolean> {
  const dayStart = startOfDay(jobDate);
  const dayEnd = addMinutes(dayStart, 24 * 60);
  const existing = await db.select()
    .from(jobReminders)
    .where(
      and(
        eq(jobReminders.jobId, jobId),
        eq(jobReminders.workerId, workerId),
        eq(jobReminders.reminderType, reminderType),
        gte(jobReminders.jobDate, dayStart),
        lte(jobReminders.jobDate, dayEnd)
      )
    );
  return existing.length > 0;
}

async function recordReminderSent(
  jobId: number,
  workerId: number,
  teamMemberId: number | null,
  jobDate: Date,
  reminderType: ReminderTypeValue,
  emailSent: boolean
): Promise<void> {
  await db.insert(jobReminders).values({
    jobId,
    workerId,
    teamMemberId,
    jobDate,
    reminderType,
    emailSent,
    emailSentAt: emailSent ? new Date() : null,
    pushSent: false,
  });
}

async function sendJobStartReminders(): Promise<void> {
  console.log("[JobReminder] Checking for upcoming jobs...");
  
  try {
    const upcomingJobs = await getUpcomingAssignments();
    console.log(`[JobReminder] Found ${upcomingJobs.length} upcoming job assignments`);
    
    for (const assignment of upcomingJobs) {
      const { job, schedule, worker, teamMember, company } = assignment;
      const jobDate = schedule ? new Date(schedule.date) : new Date(job.startDate!);
      
      // Check if reminder already sent
      const alreadySent = await hasReminderBeenSent(
        job.id,
        worker.id,
        jobDate,
        "15_min_before"
      );
      
      if (alreadySent) {
        console.log(`[JobReminder] Reminder already sent for job ${job.id} to worker ${worker.id}`);
        continue;
      }
      
      // Determine recipient email
      const recipientEmail = teamMember?.email || worker.email;
      const recipientName = teamMember 
        ? `${teamMember.firstName} ${teamMember.lastName}` 
        : `${worker.firstName} ${worker.lastName}`;
      
      if (!recipientEmail) {
        console.log(`[JobReminder] No email for worker ${worker.id}, skipping`);
        continue;
      }
      
      // Format start time and date
      const startTime = schedule?.startTime || "9:00 AM";
      const startDateStr = jobDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      const location = [job.address, job.city, job.state].filter(Boolean).join(", ");
      const jobSchedulesList = await db.select().from(jobSchedules).where(eq(jobSchedules.jobId, job.id));
      const isRecurring = jobSchedulesList.length > 1;
      const timeType = isRecurring ? "Recurring" : "One-time";

      console.log(`[JobReminder] Sending 15-min reminder to ${recipientEmail} for job "${job.title}"`);

      // Worker email: no hourly rate shown
      const result = await sendEmail({
        to: recipientEmail,
        type: "job_start_reminder",
        data: {
          workerName: recipientName,
          jobTitle: job.title,
          jobId: job.id,
          companyName: company.companyName || `${company.firstName} ${company.lastName}`,
          startTime,
          startDate: startDateStr,
          timeType,
          isRecurring,
          location: location || "See job details",
          showHourlyRate: false,
          within24hr: false,
        },
      });

      await recordReminderSent(
        job.id,
        worker.id,
        assignment.assignment.teamMemberId,
        jobDate,
        "15_min_before",
        result.success
      );
      
      if (result.success) {
        console.log(`[JobReminder] Successfully sent 15-min reminder for job ${job.id}`);
      } else {
        console.error(`[JobReminder] Failed to send reminder: ${result.error}`);
      }
    }

    // 24-hour reminders: send to worker (no rate) and to company admin
    const upcoming24hr = await getUpcomingAssignments24hr();
    console.log(`[JobReminder] Found ${upcoming24hr.length} assignments starting in ~24 hours`);
    for (const assignment of upcoming24hr) {
      const { job, schedule, worker, teamMember, company } = assignment;
      const jobDate = schedule ? new Date(schedule.date) : new Date(job.startDate!);
      const alreadySent24 = await hasReminderBeenSent(job.id, worker.id, jobDate, "1_day_before");
      if (alreadySent24) continue;

      const recipientEmail = teamMember?.email || worker.email;
      const recipientName = teamMember ? `${teamMember.firstName} ${teamMember.lastName}` : `${worker.firstName} ${worker.lastName}`;
      if (!recipientEmail) continue;

      const startTime = schedule?.startTime || "9:00 AM";
      const startDateStr = jobDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      const location = [job.address, job.city, job.state].filter(Boolean).join(", ");
      const jobSchedulesList24 = await db.select().from(jobSchedules).where(eq(jobSchedules.jobId, job.id));
      const timeType = jobSchedulesList24.length > 1 ? "Recurring" : "One-time";
      const companyName = company.companyName || `${company.firstName} ${company.lastName}`;

      // Worker email (within 24hr, no rate)
      const workerResult = await sendEmail({
        to: recipientEmail,
        type: "job_start_reminder",
        data: {
          workerName: recipientName,
          jobTitle: job.title,
          jobId: job.id,
          companyName,
          startTime,
          startDate: startDateStr,
          timeType,
          isRecurring: jobSchedulesList24.length > 1,
          location: location || "See job details",
          showHourlyRate: false,
          within24hr: true,
        },
      });
      await recordReminderSent(job.id, worker.id, assignment.assignment.teamMemberId, jobDate, "1_day_before", workerResult.success);

      // Admin copy to company (include hourly rate for admin)
      if (company.email) {
        const adminHourlyRate = assignment.assignment.proposedRate != null
          ? (assignment.assignment.proposedRate / 100).toFixed(0)
          : (job.hourlyRate != null ? (job.hourlyRate / 100).toFixed(0) : undefined);
        sendEmail({
          to: company.email,
          type: "job_start_reminder",
          data: {
            jobTitle: job.title,
            jobId: job.id,
            workerName: recipientName,
            companyName,
            startTime,
            startDate: startDateStr,
            timeType,
            location: location || "See job details",
            isAdminCopy: true,
            within24hr: true,
            showHourlyRate: true,
            hourlyRate: adminHourlyRate,
          },
        }).catch((err) => console.error("[JobReminder] Failed to send admin 24hr reminder:", err));
      }
    }
  } catch (error) {
    console.error("[JobReminder] Error in reminder scheduler:", error);
  }
}

let schedulerInterval: NodeJS.Timeout | null = null;

export function startJobReminderScheduler(): void {
  if (schedulerInterval) {
    console.log("[JobReminder] Scheduler already running");
    return;
  }
  
  console.log("[JobReminder] Starting job reminder scheduler (checking every minute)");
  
  // Run immediately on startup
  sendJobStartReminders();
  
  // Then run every minute
  schedulerInterval = setInterval(sendJobStartReminders, REMINDER_INTERVAL_MS);
}

export function stopJobReminderScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[JobReminder] Scheduler stopped");
  }
}
