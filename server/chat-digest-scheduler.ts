import { db } from "./db";
import { chatMessagePendingDigest, chatMessageDigestSent, jobMessages } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";
import { storage } from "./storage";
import { sendEmail } from "./email-service";

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const ONE_HOUR_MS = 60 * 60 * 1000;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

async function processChatDigests(): Promise<void> {
  try {
    const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS);
    const pending = await db.select()
      .from(chatMessagePendingDigest)
      .where(lt(chatMessagePendingDigest.createdAt, oneHourAgo));

    for (const row of pending) {
      try {
        const job = await storage.getJob(row.jobId);
        if (!job || job.status === "cancelled") {
          await db.delete(chatMessagePendingDigest).where(eq(chatMessagePendingDigest.id, row.id));
          continue;
        }

        const [msg] = await db.select().from(jobMessages).where(eq(jobMessages.id, row.messageId));
        if (!msg) {
          await db.delete(chatMessagePendingDigest).where(eq(chatMessagePendingDigest.id, row.id));
          continue;
        }

        const apps = await storage.getJobApplications(row.jobId);
        const accepted = apps.filter((a: any) => a.status === "accepted");
        const companyProfile = await storage.getProfile(job.companyId);
        const recipients = new Set<number>();
        if (companyProfile) recipients.add(companyProfile.id);
        for (const a of accepted) {
          if (a.workerId) recipients.add(a.workerId);
        }
        recipients.delete(row.senderId);

        const messagePreview = (msg.content || "").trim().substring(0, 100);

        for (const recipientId of recipients) {
          const alreadySent = await db.select().from(chatMessageDigestSent)
            .where(and(
              eq(chatMessageDigestSent.messageId, row.messageId),
              eq(chatMessageDigestSent.recipientProfileId, recipientId)
            ));
          if (alreadySent.length > 0) continue;

          const unreadCount = await storage.getUnreadMessageCount(row.jobId, recipientId);
          if (unreadCount === 0) continue;

          const recipientProfile = await storage.getProfile(recipientId);
          if (!recipientProfile?.email || !recipientProfile.emailNotifications) continue;

          const senderProfile = await storage.getProfile(row.senderId);
          const senderName = senderProfile?.firstName || senderProfile?.companyName || "Someone";

          const result = await sendEmail({
            to: recipientProfile.email,
            type: "chat_unread_digest",
            data: {
              items: [
                {
                  jobTitle: job.title,
                  jobId: row.jobId,
                  unreadCount,
                  lastPreview: messagePreview || "[Attachment]",
                },
              ],
            },
          });

          if (result.success) {
            await db.insert(chatMessageDigestSent).values({
              messageId: row.messageId,
              recipientProfileId: recipientId,
            });
          }
        }

        await db.delete(chatMessagePendingDigest).where(eq(chatMessagePendingDigest.id, row.id));
      } catch (err) {
        console.error("[ChatDigest] Error processing pending digest:", err);
      }
    }
  } catch (err) {
    console.error("[ChatDigest] Scheduler error:", err);
  }
}

export function startChatDigestScheduler(): void {
  if (schedulerInterval) {
    console.log("[ChatDigest] Scheduler already running");
    return;
  }
  console.log("[ChatDigest] Starting 1hr digest scheduler (checking every 10 min)");
  void processChatDigests();
  schedulerInterval = setInterval(() => {
    void processChatDigests();
  }, CHECK_INTERVAL_MS);
}

export function stopChatDigestScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[ChatDigest] Scheduler stopped");
  }
}
