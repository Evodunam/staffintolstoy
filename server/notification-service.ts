import { db } from "./db";
import { notifications, deviceTokens, profiles, jobs } from "@shared/schema";
import { eq, and, sql, ne, lte } from "drizzle-orm";
import { sendPushNotification } from "./firebase-admin";

export type NotificationType = typeof notifications.$inferSelect["type"];

interface NotificationPayload {
  profileId: number;
  type: NotificationType;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, any>;
}

export async function createNotification(payload: NotificationPayload): Promise<void> {
  const [notification] = await db.insert(notifications).values({
    profileId: payload.profileId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    url: payload.url,
    data: payload.data,
  }).returning();

  const tokens = await db.select({ token: deviceTokens.token })
    .from(deviceTokens)
    .where(and(
      eq(deviceTokens.profileId, payload.profileId),
      eq(deviceTokens.isActive, true)
    ));

  if (tokens.length > 0) {
    const tokenList = tokens.map(t => t.token);
    const result = await sendPushNotification(
      tokenList,
      payload.title,
      payload.body,
      {
        type: payload.type,
        url: payload.url || "/",
        notificationId: String(notification.id),
        ...Object.fromEntries(
          Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
        ),
      }
    );

    if (result.successCount > 0) {
      await db.update(notifications)
        .set({ isPushSent: true, pushSentAt: new Date() })
        .where(eq(notifications.id, notification.id));
    }

    if (result.failedTokens.length > 0) {
      for (const token of result.failedTokens) {
        await db.update(deviceTokens)
          .set({ isActive: false })
          .where(eq(deviceTokens.token, token));
      }
    }
  }
}

export async function notifyNewJobInTerritory(
  jobId: number,
  jobTitle: string,
  companyName: string,
  lat: number,
  lng: number
): Promise<void> {
  const workers = await db.select({
    id: profiles.id,
    latitude: profiles.latitude,
    longitude: profiles.longitude,
  })
    .from(profiles)
    .where(and(
      eq(profiles.role, "worker"),
      eq(profiles.isVerified, true),
      sql`${profiles.latitude} IS NOT NULL`,
      sql`${profiles.longitude} IS NOT NULL`
    ));

  for (const worker of workers) {
    if (worker.latitude && worker.longitude) {
      const distance = calculateDistanceMiles(
        Number(worker.latitude),
        Number(worker.longitude),
        lat,
        lng
      );

      if (distance <= 20) {
        await createNotification({
          profileId: worker.id,
          type: "new_job_in_territory",
          title: "New Job Available",
          body: `${companyName} posted "${jobTitle}" ${Math.round(distance)} miles away`,
          url: `/jobs/${jobId}`,
          data: { jobId, distance: Math.round(distance) },
        });
      }
    }
  }
}

export async function notifyJobOffer(
  workerId: number,
  jobId: number,
  jobTitle: string,
  companyName: string
): Promise<void> {
  await createNotification({
    profileId: workerId,
    type: "job_offer_received",
    title: "Job Offer Received",
    body: `${companyName} wants to hire you for "${jobTitle}"`,
    url: `/dashboard?tab=jobs&section=offers&jobId=${jobId}`,
    data: { jobId },
  });
}

export async function notifyApplicationApproved(
  workerId: number,
  jobId: number,
  jobTitle: string
): Promise<void> {
  await createNotification({
    profileId: workerId,
    type: "application_approved",
    title: "Application Approved!",
    body: `Your application for "${jobTitle}" has been accepted`,
    url: `/dashboard?tab=jobs&section=active&jobId=${jobId}`,
    data: { jobId },
  });
}

export async function notifyApplicationRejected(
  workerId: number,
  jobId: number,
  jobTitle: string
): Promise<void> {
  await createNotification({
    profileId: workerId,
    type: "application_rejected",
    title: "Application Update",
    body: `Your application for "${jobTitle}" was not selected`,
    url: `/dashboard?tab=jobs&section=history&jobId=${jobId}`,
    data: { jobId },
  });
}

export async function notifyTimesheetEdited(
  workerId: number,
  timesheetId: number,
  jobTitle: string,
  oldHours: number,
  newHours: number,
  explanation: string
): Promise<void> {
  await createNotification({
    profileId: workerId,
    type: "timesheet_edited",
    title: "Timesheet Edited",
    body: `Your hours for "${jobTitle}" were adjusted from ${oldHours.toFixed(1)}h to ${newHours.toFixed(1)}h`,
    url: `/dashboard?tab=timesheets&timesheetId=${timesheetId}`,
    data: { timesheetId, oldHours, newHours, explanation },
  });
}

export async function notifyTimesheetReported(
  workerId: number,
  timesheetId: number,
  jobTitle: string,
  currentStrikes: number
): Promise<void> {
  await createNotification({
    profileId: workerId,
    type: "timesheet_reported",
    title: "Timesheet Reported - Strike Issued",
    body: `Your timesheet for "${jobTitle}" was reported. You now have ${currentStrikes}/3 strikes.`,
    url: `/dashboard?tab=strikes&timesheetId=${timesheetId}`,
    data: { timesheetId, currentStrikes },
  });
}

export async function notifyStrikeIssued(
  workerId: number,
  currentStrikes: number,
  reason: string
): Promise<void> {
  await createNotification({
    profileId: workerId,
    type: "strike_issued",
    title: "Strike Issued",
    body: `You have received a strike (${currentStrikes}/3). Reason: ${reason}`,
    url: `/dashboard?tab=strikes`,
    data: { currentStrikes, reason },
  });
}

export async function notifyPaymentReceived(
  workerId: number,
  amount: number,
  jobTitle: string
): Promise<void> {
  await createNotification({
    profileId: workerId,
    type: "payment_received",
    title: "Payment Received",
    body: `You earned $${(amount / 100).toFixed(2)} for "${jobTitle}"`,
    url: `/dashboard?tab=earnings`,
    data: { amount, jobTitle },
  });
}

export async function notifyAccountTerminated(workerId: number): Promise<void> {
  await createNotification({
    profileId: workerId,
    type: "account_terminated",
    title: "Account Terminated",
    body: "Your account has been terminated due to 3 strikes. Please contact support.",
    url: `/`,
    data: {},
  });
}

export async function notifyWorkerInquiry(
  companyProfileId: number,
  workerName: string,
  jobId: number,
  jobTitle: string
): Promise<void> {
  await createNotification({
    profileId: companyProfileId,
    type: "worker_inquiry",
    title: "New Worker Application",
    body: `${workerName} has applied for "${jobTitle}"`,
    url: `/company-dashboard/jobs?jobId=${jobId}&tab=applications`,
    data: { jobId, workerName },
  });
}

export async function notifyBalanceToppedUp(
  companyProfileId: number,
  amount: number,
  isAuto: boolean
): Promise<void> {
  await createNotification({
    profileId: companyProfileId,
    type: "balance_topped_up",
    title: isAuto ? "Auto-Recharge Complete" : "Balance Updated",
    body: `$${(amount / 100).toFixed(2)} has been added to your account`,
    url: `/dashboard?tab=billing&section=history`,
    data: { amount, isAuto },
  });
}

export async function notifyWorkerAvailabilityUpdated(
  companyProfileId: number,
  workerName: string,
  jobId: number,
  jobTitle: string,
  newStatus: string
): Promise<void> {
  const statusText = newStatus === 'available' ? 'is now available' : 
                     newStatus === 'unavailable' ? 'is no longer available' : 
                     `updated their availability to ${newStatus}`;
  await createNotification({
    profileId: companyProfileId,
    type: "worker_availability_updated",
    title: "Worker Availability Update",
    body: `${workerName} ${statusText} for "${jobTitle}"`,
    url: `/dashboard?tab=jobs&jobId=${jobId}`,
    data: { jobId, workerName, newStatus },
  });
}

export async function notifyWorkerClockedIn(
  companyProfileId: number,
  workerName: string,
  jobTitle: string,
  timesheetId: number
): Promise<void> {
  await createNotification({
    profileId: companyProfileId,
    type: "worker_clocked_in",
    title: "Worker Clocked In",
    body: `${workerName} has started work on "${jobTitle}"`,
    url: `/dashboard?tab=timesheets&timesheetId=${timesheetId}`,
    data: { workerName, jobTitle, timesheetId },
  });
}

export async function notifyWorkerClockedOut(
  companyProfileId: number,
  workerName: string,
  jobTitle: string,
  hoursWorked: number,
  timesheetId: number
): Promise<void> {
  await createNotification({
    profileId: companyProfileId,
    type: "worker_clocked_out",
    title: "Worker Clocked Out",
    body: `${workerName} completed ${hoursWorked.toFixed(1)}h on "${jobTitle}"`,
    url: `/dashboard?tab=timesheets&timesheetId=${timesheetId}`,
    data: { workerName, jobTitle, hoursWorked, timesheetId },
  });
}

export async function sendMarketingNotification(
  companyProfileId: number
): Promise<void> {
  await createNotification({
    profileId: companyProfileId,
    type: "marketing_post_job",
    title: "Need Help on a Project?",
    body: "Post a job and connect with skilled workers in your area today!",
    url: `/post-job`,
    data: {},
  });
}

function calculateDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
