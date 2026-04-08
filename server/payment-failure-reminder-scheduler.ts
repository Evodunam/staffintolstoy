/**
 * Resend email sequence when company funding fails (payment hold / failed charge).
 * Sends immediately (debounced) from failure hooks; repeats every PAYMENT_FAILURE_RECURRING_HOURS until resolved.
 */
import { db } from "./db";
import { profiles, jobs } from "@shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { sendEmail } from "./email-service";

const BASE_URL = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";

/** Minimum hours between sends when failure hooks fire frequently (scheduler + replenish). */
const KICK_DEBOUNCE_HOURS = 1;
/** Recurring reminder interval while issue persists. */
export const PAYMENT_FAILURE_RECURRING_HOURS = Number(process.env.PAYMENT_FAILURE_RECURRING_HOURS || 24);

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000; // hourly tick; gated by recurring threshold

export async function companyHasActivePaymentIssue(companyId: number): Promise<boolean> {
  const [row] = await db
    .select({
      id: profiles.id,
      lastFailed: profiles.lastFailedPaymentMethodId,
    })
    .from(profiles)
    .where(eq(profiles.id, companyId))
    .limit(1);
  if (!row) return false;
  if (row.lastFailed != null) return true;
  const held = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.companyId, companyId), isNotNull(jobs.paymentHoldAt)))
    .limit(1);
  return held.length > 0;
}

function hoursSince(date: Date | null | undefined): number {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / (60 * 60 * 1000);
}

async function loadHeldJobs(companyId: number): Promise<{ id: number; title: string | null }[]> {
  return db
    .select({ id: jobs.id, title: jobs.title })
    .from(jobs)
    .where(and(eq(jobs.companyId, companyId), isNotNull(jobs.paymentHoldAt)));
}

/**
 * Reset reminder columns when funding issue is gone (no holds, no last-failed PM).
 */
export async function syncPaymentFailureReminderState(companyId: number): Promise<void> {
  const open = await companyHasActivePaymentIssue(companyId);
  if (open) return;
  await db
    .update(profiles)
    .set({
      paymentFailureReminderSentAt: null,
      paymentFailureReminderCount: 0,
    })
    .where(eq(profiles.id, companyId));
}

async function sendPaymentIssueEmailAndBumpCount(companyId: number): Promise<boolean> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, companyId)).limit(1);
  if (!profile || profile.role !== "company") return false;
  if (profile.emailNotifications === false) return false;
  const to = (profile.email || "").trim();
  if (!to) return false;

  const held = await loadHeldJobs(companyId);
  const nextCount = (profile.paymentFailureReminderCount ?? 0) + 1;
  const firstName = profile.firstName || profile.companyName || "there";
  const fixPaymentUrl = `${BASE_URL.replace(/\/$/, "")}/company-dashboard?section=billing`;
  const jobsDashboardUrl = `${BASE_URL.replace(/\/$/, "")}/company-dashboard/jobs`;
  const jobUrlPrefix = `${BASE_URL.replace(/\/$/, "")}/company-dashboard`;

  const result = await sendEmail({
    to,
    type: "company_payment_action_required",
    data: {
      firstName,
      companyName: profile.companyName || undefined,
      reminderNumber: nextCount,
      hasFailedPaymentMethod: profile.lastFailedPaymentMethodId != null,
      jobsOnHold: held.map((j) => ({ id: j.id, title: j.title || `Job #${j.id}` })),
      fixPaymentUrl,
      jobsDashboardUrl,
      jobUrlPrefix,
    },
  });

  if (!result.success) {
    console.warn(`[PaymentFailureEmail] Send failed for company ${companyId}:`, result.error);
    return false;
  }

  await db
    .update(profiles)
    .set({
      paymentFailureReminderSentAt: new Date(),
      paymentFailureReminderCount: nextCount,
    })
    .where(eq(profiles.id, companyId));
  return true;
}

/**
 * Called from hire / replenishment failure paths. Debounced so the 5-min replenishment loop does not spam.
 */
export async function notifyCompanyPaymentFundingIssue(companyId: number): Promise<void> {
  if (!(await companyHasActivePaymentIssue(companyId))) {
    await syncPaymentFailureReminderState(companyId);
    return;
  }
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, companyId)).limit(1);
  if (!profile) return;
  const last = profile.paymentFailureReminderSentAt;
  if (last != null && hoursSince(last) < KICK_DEBOUNCE_HOURS) return;
  await sendPaymentIssueEmailAndBumpCount(companyId);
}

/**
 * Hourly (or on boot): for each company with an open issue, send if last send is older than recurring interval.
 */
export async function processPaymentFailureReminderTick(): Promise<{ sent: number; skipped: number; reset: number }> {
  let sent = 0;
  let skipped = 0;
  let reset = 0;

  const idSet = new Set<number>();
  const heldRows = await db.select({ companyId: jobs.companyId }).from(jobs).where(isNotNull(jobs.paymentHoldAt));
  for (const r of heldRows) {
    if (r.companyId != null) idSet.add(r.companyId);
  }
  const flagged = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, "company"), isNotNull(profiles.lastFailedPaymentMethodId)));
  for (const r of flagged) idSet.add(r.id);
  const inSequence = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, "company"), isNotNull(profiles.paymentFailureReminderSentAt)));
  for (const r of inSequence) idSet.add(r.id);

  for (const companyId of idSet) {
    const open = await companyHasActivePaymentIssue(companyId);
    if (!open) {
      const [p] = await db.select().from(profiles).where(eq(profiles.id, companyId)).limit(1);
      if (p && (p.paymentFailureReminderSentAt != null || (p.paymentFailureReminderCount ?? 0) > 0)) {
        await syncPaymentFailureReminderState(companyId);
        reset++;
      }
      continue;
    }

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, companyId)).limit(1);
    if (!profile) {
      skipped++;
      continue;
    }
    if (profile.emailNotifications === false) {
      skipped++;
      continue;
    }

    const last = profile.paymentFailureReminderSentAt;
    if (last == null) {
      const ok = await sendPaymentIssueEmailAndBumpCount(companyId);
      if (ok) sent++;
      else skipped++;
      continue;
    }
    if (hoursSince(last) >= PAYMENT_FAILURE_RECURRING_HOURS) {
      const ok = await sendPaymentIssueEmailAndBumpCount(companyId);
      if (ok) sent++;
      else skipped++;
    } else skipped++;
  }

  if (sent + reset > 0) {
    console.log(`[PaymentFailureEmail] tick: ${sent} sent, ${skipped} skipped, ${reset} sequences reset`);
  }
  return { sent, skipped, reset };
}

export function startPaymentFailureReminderScheduler(): void {
  const run = () => {
    processPaymentFailureReminderTick().catch((e: any) =>
      console.error("[PaymentFailureEmail] Scheduler error:", e?.message || e)
    );
  };
  run();
  setInterval(run, SCHEDULER_INTERVAL_MS);
}
