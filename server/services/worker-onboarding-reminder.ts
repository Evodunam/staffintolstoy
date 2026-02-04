/**
 * Worker onboarding reminder: dynamic list of incomplete items + resume URL.
 * Used by the onboarding reminder email sequence (3 emails over ~1 month).
 */

import type { Profile } from "@shared/schema";
import { sendEmail } from "../email-service";
import { storage } from "../storage";

const BASE_URL = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";

export interface IncompleteItem {
  label: string;
  url: string;
}

/**
 * Builds a dynamic list of incomplete onboarding items for a worker profile,
 * with direct links to each step (or sub-step for step 3).
 */
export function getWorkerOnboardingIncompleteItems(profile: Profile): {
  items: IncompleteItem[];
  resumeUrl: string;
} {
  if (!profile || profile.role !== "worker") {
    return { items: [], resumeUrl: `${BASE_URL}/worker-onboarding` };
  }

  const step = Math.max(1, Math.min(6, profile.onboardingStep ?? 1));
  const items: IncompleteItem[] = [];

  const firstName = (profile.firstName ?? "").toString().trim();
  const lastName = (profile.lastName ?? "").toString().trim();
  const email = (profile.email ?? "").toString().trim();
  const phone = (profile.phone ?? "").toString().trim();
  const avatarUrl = (profile.avatarUrl ?? "").toString().trim();
  const faceVerified = profile.faceVerified === true;
  const serviceCategories = profile.serviceCategories;
  const hourlyRate = profile.hourlyRate != null && Number(profile.hourlyRate) > 0;
  const mercuryRecipientId = (profile.mercuryRecipientId ?? "").toString().trim();
  const bankAccountLinked = profile.bankAccountLinked === true;
  const hasBank = bankAccountLinked || !!mercuryRecipientId;
  const address = (profile.address ?? "").toString().trim();
  const hasAddress = !!(address && (profile.city ?? "").toString().trim() && (profile.state ?? "").toString().trim() && (profile.zipCode ?? "").toString().trim());

  // List every possible missing item so the email shows all remaining steps
  if (!firstName) {
    items.push({ label: "Add your first name", url: `${BASE_URL}/worker-onboarding?step=1` });
  }
  if (!lastName) {
    items.push({ label: "Add your last name", url: `${BASE_URL}/worker-onboarding?step=1` });
  }
  if (!email) {
    items.push({ label: "Add your email", url: `${BASE_URL}/worker-onboarding?step=1` });
  }
  if (!phone) {
    items.push({ label: "Add your phone number", url: `${BASE_URL}/worker-onboarding?step=1` });
  }
  if (!avatarUrl) {
    items.push({ label: "Add your profile photo", url: `${BASE_URL}/worker-onboarding?step=1` });
  }
  if (!faceVerified && avatarUrl) {
    items.push({ label: "Verify your face (identity check)", url: `${BASE_URL}/worker-onboarding?step=1` });
  }
  if (!address) {
    items.push({ label: "Add your street address", url: `${BASE_URL}/worker-onboarding?step=2` });
  }
  if (!(profile.city ?? "").toString().trim()) {
    items.push({ label: "Add your city", url: `${BASE_URL}/worker-onboarding?step=2` });
  }
  if (!(profile.state ?? "").toString().trim()) {
    items.push({ label: "Add your state", url: `${BASE_URL}/worker-onboarding?step=2` });
  }
  if (!(profile.zipCode ?? "").toString().trim()) {
    items.push({ label: "Add your ZIP code", url: `${BASE_URL}/worker-onboarding?step=2` });
  }
  if (!hourlyRate) {
    items.push({ label: "Set your hourly rate", url: `${BASE_URL}/worker-onboarding?step=3&sub=rate` });
  }
  if (!Array.isArray(serviceCategories) || serviceCategories.length < 1) {
    items.push({ label: "Select at least one industry / skill-set", url: `${BASE_URL}/worker-onboarding?step=3&sub=categories` });
  }
  if (!hasBank) {
    items.push({ label: "Connect your bank account for payouts", url: `${BASE_URL}/worker-onboarding?step=4` });
  }
  const w9Uploaded = !!(profile as any).w9UploadedAt;
  if (!w9Uploaded) {
    items.push({ label: "Upload W-9 (tax form)", url: `${BASE_URL}/worker-onboarding?step=5` });
  }
  const contractSigned = (profile as any).contractSigned === true;
  if (!contractSigned) {
    items.push({ label: "Sign the worker agreement", url: `${BASE_URL}/worker-onboarding?step=6` });
  }

  const uniqueItems = items;

  const resumeUrl = step === 3
    ? `${BASE_URL}/worker-onboarding?step=3&sub=rate`
    : `${BASE_URL}/worker-onboarding?step=${step}`;

  return { items: uniqueItems, resumeUrl };
}

const REMINDER_INTERVAL_DAYS = 10; // ~3 reminders over 30 days: day 0, 10, 20

/**
 * Determines which reminder (1, 2, or 3) should be sent next for a profile,
 * based on sent timestamps. Returns 0 if no reminder should be sent.
 */
export function getNextReminderNumber(profile: Profile): 1 | 2 | 3 | 0 {
  const r1 = profile.onboardingReminder1SentAt ? new Date(profile.onboardingReminder1SentAt).getTime() : 0;
  const r2 = profile.onboardingReminder2SentAt ? new Date(profile.onboardingReminder2SentAt).getTime() : 0;
  const r3 = profile.onboardingReminder3SentAt ? new Date(profile.onboardingReminder3SentAt).getTime() : 0;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  if (r1 === 0) return 1;
  if (r2 === 0 && now - r1 >= REMINDER_INTERVAL_DAYS * day) return 2;
  if (r3 === 0 && r2 > 0 && now - r2 >= REMINDER_INTERVAL_DAYS * day) return 3;
  return 0;
}

export interface SendWorkerReminderOptions {
  /** When true, send now regardless of reminder schedule (e.g. team member triggered resend). Does not update reminder sent timestamps. */
  force?: boolean;
}

/**
 * Sends one onboarding reminder email for the given profile and updates the sent timestamp (unless force is true).
 */
export async function sendWorkerOnboardingReminder(
  profile: Profile,
  options?: SendWorkerReminderOptions
): Promise<{ sent: boolean; error?: string }> {
  const email = (profile.email ?? "").toString().trim();
  if (!email) {
    return { sent: false, error: "No email" };
  }

  const { items, resumeUrl } = getWorkerOnboardingIncompleteItems(profile);
  const firstName = (profile.firstName ?? "").toString().trim() || "there";

  if (options?.force) {
    const result = await sendEmail({
      to: email,
      type: "worker_onboarding_reminder",
      data: {
        firstName,
        incompleteItems: items,
        resumeUrl,
        reminderNumber: 1,
        triggeredByTeamMember: true,
      },
    });
    return result.success ? { sent: true } : { sent: false, error: result.error };
  }

  const next = getNextReminderNumber(profile);
  if (next === 0) {
    return { sent: false, error: "No reminder due" };
  }

  const result = await sendEmail({
    to: email,
    type: "worker_onboarding_reminder",
    data: {
      firstName,
      incompleteItems: items,
      resumeUrl,
      reminderNumber: next,
    },
  });

  if (!result.success) {
    return { sent: false, error: result.error };
  }

  const updates: Partial<Profile> =
    next === 1
      ? { onboardingReminder1SentAt: new Date() }
      : next === 2
      ? { onboardingReminder2SentAt: new Date() }
      : { onboardingReminder3SentAt: new Date() };

  await storage.updateProfile(profile.id, updates as any);
  return { sent: true };
}

/**
 * Finds all workers with incomplete onboarding and sends the next due reminder (1, 2, or 3).
 * Call daily (e.g. from a cron job or scheduled route).
 */
export async function processWorkerOnboardingReminders(): Promise<{ sent: number; skipped: number; errors: number }> {
  const workers = await storage.getAllWorkers();
  const incomplete = workers.filter(
    (p) => p.onboardingStatus === "incomplete" && p.role === "worker" && (p.email ?? "").toString().trim()
  );

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const profile of incomplete) {
    const next = getNextReminderNumber(profile);
    if (next === 0) {
      skipped++;
      continue;
    }
    const result = await sendWorkerOnboardingReminder(profile);
    if (result.sent) sent++;
    else errors++;
  }

  return { sent, skipped, errors };
}
