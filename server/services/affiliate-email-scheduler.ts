/**
 * Affiliate email scheduler:
 * 1. Bank/W-9 setup reminder - when affiliate has pending commissions but missing bank or W-9 (throttled ~7 days)
 * 2. Share link reminder - recurring email to share referral link (every 14 days)
 */

import { sendEmail } from "../email-service";
import { storage } from "../storage";
import { authStorage } from "../auth/storage";

const BASE_URL = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";
const SHARE_LINK_INTERVAL_DAYS = 14;
const BANK_W9_REMINDER_INTERVAL_DAYS = 7;

function daysSince(date: Date | null | undefined): number {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000);
}

export async function processAffiliateShareLinkReminders(): Promise<{ sent: number; skipped: number }> {
  const all = await storage.getAllAffiliates();
  let sent = 0;
  let skipped = 0;
  for (const affiliate of all) {
    const lastSent = (affiliate as any).shareLinkReminderSentAt;
    if (daysSince(lastSent) < SHARE_LINK_INTERVAL_DAYS) {
      skipped++;
      continue;
    }
    const user = await authStorage.getUser(affiliate.userId);
    const email = affiliate.email || user?.email;
    if (!email?.trim()) {
      skipped++;
      continue;
    }
    const origin = BASE_URL.replace(/\/$/, "");
    const referralLink = `${origin}/company-onboarding?ref=${encodeURIComponent(affiliate.code)}`;
    const result = await sendEmail({
      to: email.trim(),
      type: "affiliate_share_link_reminder",
      data: {
        firstName: affiliate.firstName || "there",
        referralLink,
        code: affiliate.code,
        dashboardUrl: `${BASE_URL}/affiliate-dashboard`,
      },
    });
    if (result.success) {
      await storage.updateAffiliate(affiliate.id, { shareLinkReminderSentAt: new Date(), updatedAt: new Date() } as any);
      sent++;
    }
  }
  return { sent, skipped };
}

export async function processAffiliateBankW9Reminders(): Promise<{ sent: number; skipped: number }> {
  const all = await storage.getAllAffiliates();
  let sent = 0;
  let skipped = 0;
  for (const affiliate of all) {
    const needsBank = !affiliate.mercuryRecipientId || !affiliate.mercuryExternalAccountId;
    const needsW9 = !affiliate.w9UploadedAt;
    if (!needsBank && !needsW9) {
      skipped++;
      continue;
    }
    const commissions = await storage.getAffiliateCommissionsByAffiliateId(affiliate.id);
    const pending = commissions.filter((c: any) => c.status === "pending");
    const pendingCents = pending.reduce((sum: number, c: any) => sum + (c.amountCents || 0), 0);
    if (pendingCents <= 0) {
      skipped++;
      continue;
    }
    const lastSent = (affiliate as any).bankW9ReminderSentAt;
    if (daysSince(lastSent) < BANK_W9_REMINDER_INTERVAL_DAYS) {
      skipped++;
      continue;
    }
    const user = await authStorage.getUser(affiliate.userId);
    const email = affiliate.email || user?.email;
    if (!email?.trim()) {
      skipped++;
      continue;
    }
    const result = await sendEmail({
      to: email.trim(),
      type: "affiliate_setup_bank_w9",
      data: {
        firstName: affiliate.firstName || "there",
        pendingCents,
        needsBank,
        needsW9,
        setupUrl: `${BASE_URL}/affiliate-dashboard`,
      },
    });
    if (result.success) {
      await storage.updateAffiliate(affiliate.id, { bankW9ReminderSentAt: new Date(), updatedAt: new Date() } as any);
      sent++;
    }
  }
  return { sent, skipped };
}

const SCHEDULER_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run daily

export function startAffiliateEmailScheduler(): void {
  const run = async () => {
    try {
      const [shareResult, bankResult] = await Promise.all([
        processAffiliateShareLinkReminders(),
        processAffiliateBankW9Reminders(),
      ]);
      if (shareResult.sent + shareResult.skipped + bankResult.sent + bankResult.skipped > 0) {
        console.log(`[AffiliateEmail] Share link: ${shareResult.sent} sent, ${shareResult.skipped} skipped; Bank/W-9: ${bankResult.sent} sent, ${bankResult.skipped} skipped`);
      }
    } catch (e: any) {
      console.error("[AffiliateEmail] Scheduler error:", e?.message);
    }
  };
  run();
  setInterval(run, SCHEDULER_INTERVAL_MS);
}
