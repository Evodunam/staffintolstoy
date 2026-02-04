/**
 * Company onboarding reminder: weekly email until profile is complete.
 * Dynamic list of incomplete steps with direct links to resume.
 */

import type { Profile } from "@shared/schema";
import { sendEmail } from "../email-service";
import { storage } from "../storage";

const BASE_URL = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";

export interface IncompleteItem {
  label: string;
  url: string;
}

const COMPANY_STEP_LINKS: { step: number; label: string; url: string }[] = [
  { step: 1, label: "Select industries you hire for", url: `${BASE_URL}/company-onboarding?step=1` },
  { step: 2, label: "Add company name & business info", url: `${BASE_URL}/company-onboarding?step=2` },
  { step: 2, label: "Add at least one location (address, contact)", url: `${BASE_URL}/company-onboarding?step=2` },
  { step: 3, label: "Set up team access (optional)", url: `${BASE_URL}/company-onboarding?step=3` },
  { step: 4, label: "Payment setup (deposit & payment method)", url: `${BASE_URL}/company-onboarding?step=4` },
  { step: 5, label: "Sign the hiring agreement", url: `${BASE_URL}/company-onboarding?step=5` },
];

/**
 * Builds a full list of onboarding steps for a company profile so the email shows all options.
 * Includes every step with direct links; steps at or after current step are included.
 */
export function getCompanyOnboardingIncompleteItems(profile: Profile): {
  items: IncompleteItem[];
  resumeUrl: string;
} {
  if (!profile || profile.role !== "company") {
    return { items: [], resumeUrl: `${BASE_URL}/company-onboarding` };
  }

  const step = Math.max(1, Math.min(5, profile.onboardingStep ?? 1));
  const items: IncompleteItem[] = [];

  for (const link of COMPANY_STEP_LINKS) {
    if (link.step >= step) {
      items.push({ label: link.label, url: link.url });
    }
  }

  const resumeUrl = `${BASE_URL}/company-onboarding?step=${step}`;
  return { items, resumeUrl };
}

const REMINDER_INTERVAL_DAYS = 7; // Weekly

/**
 * Returns true if we should send a reminder (never sent, or last sent 7+ days ago).
 */
export function shouldSendCompanyReminder(profile: Profile): boolean {
  const sentAt = (profile as any).companyOnboardingReminderSentAt;
  if (!sentAt) return true;
  const elapsed = (Date.now() - new Date(sentAt).getTime()) / (24 * 60 * 60 * 1000);
  return elapsed >= REMINDER_INTERVAL_DAYS;
}

export interface SendCompanyReminderOptions {
  /** When true, send even if one was sent recently (e.g. worker-triggered resend). */
  force?: boolean;
}

/**
 * Sends one company onboarding reminder email and updates companyOnboardingReminderSentAt.
 */
export async function sendCompanyOnboardingReminder(
  profile: Profile,
  options?: SendCompanyReminderOptions
): Promise<{ sent: boolean; error?: string }> {
  const email = (profile.email ?? "").toString().trim();
  if (!email) {
    return { sent: false, error: "No email" };
  }

  if (!options?.force && !shouldSendCompanyReminder(profile)) {
    return { sent: false, error: "Reminder sent recently" };
  }

  const { items, resumeUrl } = getCompanyOnboardingIncompleteItems(profile);
  const firstName = (profile.firstName ?? "").toString().trim() || "there";

  const result = await sendEmail({
    to: email,
    type: "company_onboarding_reminder",
    data: {
      firstName,
      incompleteItems: items,
      resumeUrl,
    },
  });

  if (!result.success) {
    return { sent: false, error: result.error };
  }

  await storage.updateProfile(profile.id, {
    companyOnboardingReminderSentAt: new Date(),
  } as any);
  return { sent: true };
}

/**
 * Finds all companies with incomplete onboarding and sends a reminder
 * if they haven't received one in the last 7 days. Call weekly (e.g. cron).
 */
export async function processCompanyOnboardingReminders(): Promise<{
  sent: number;
  skipped: number;
  errors: number;
}> {
  const companies = await storage.getAllCompanies();
  const incomplete = companies.filter(
    (p) =>
      p.onboardingStatus === "incomplete" &&
      p.role === "company" &&
      (p.email ?? "").toString().trim()
  );

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const profile of incomplete) {
    if (!shouldSendCompanyReminder(profile)) {
      skipped++;
      continue;
    }
    const result = await sendCompanyOnboardingReminder(profile);
    if (result.sent) sent++;
    else errors++;
  }

  return { sent, skipped, errors };
}
