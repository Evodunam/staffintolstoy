import type { Job, Profile } from "@shared/schema";
import { AUTO_FULFILL_LEGAL_VERSION } from "@shared/autoFulfillLegal";
import { PLATFORM_MIN_BILLABLE_HOURLY_CENTS } from "@shared/platformPayPolicy";

function effectiveAutoFulfillWorkerHours(j: Partial<JobAuto>): number {
  const expH = j.autoFulfillExpectedHours != null ? Number(j.autoFulfillExpectedHours) : NaN;
  const estH = j.estimatedHours != null ? Number(j.estimatedHours) : NaN;
  if (Number.isFinite(expH) && expH > 0) return expH;
  if (Number.isFinite(estH) && estH > 0) return estH;
  return 0;
}

export type JobAuto = Job & {
  autoFulfillEnabled?: boolean | null;
  autoFulfillBudgetCents?: number | null;
  autoFulfillBudgetWindow?: string | null;
  autoFulfillWindowStart?: Date | null;
  autoFulfillWindowEnd?: Date | null;
  autoFulfillExpectedHours?: string | number | null;
  autoFulfillMinWorkerRating?: string | number | null;
  autoFulfillMinWorkerReviews?: number | null;
  autoFulfillMaxHourlyCents?: number | null;
  autoFulfillMinHourlyCents?: number | null;
  autoFulfillPolicy?: string | null;
  autoFulfillLegalAckVersion?: string | null;
  autoFulfillLegalAckAt?: Date | null;
};

export function validateAutoFulfillJobPayload(j: Partial<JobAuto>): string | null {
  if (!j.autoFulfillEnabled) return null;
  if (!j.autoFulfillBudgetWindow || String(j.autoFulfillBudgetWindow).trim() === "") {
    return "Auto-fulfill requires a budget window (one_day, weekly, monthly, or custom).";
  }
  const win = String(j.autoFulfillBudgetWindow);
  const allowed = ["one_day", "weekly", "monthly", "custom"];
  if (!allowed.includes(win)) {
    return `Invalid auto-fulfill budget window. Use one of: ${allowed.join(", ")}.`;
  }
  if (win === "custom") {
    if (!j.autoFulfillWindowStart || !j.autoFulfillWindowEnd) {
      return "Custom budget window requires autoFulfillWindowStart and autoFulfillWindowEnd.";
    }
  }
  const budget = Number(j.autoFulfillBudgetCents ?? 0);
  if (!Number.isFinite(budget) || budget <= 0) {
    return "Auto-fulfill requires a positive autoFulfillBudgetCents (labor budget for the window, in cents).";
  }
  const maxHour = j.autoFulfillMaxHourlyCents != null ? Number(j.autoFulfillMaxHourlyCents) : null;
  const minHourly = j.autoFulfillMinHourlyCents != null ? Number(j.autoFulfillMinHourlyCents) : null;
  const expH = j.autoFulfillExpectedHours != null ? Number(j.autoFulfillExpectedHours) : NaN;
  const estH = j.estimatedHours != null ? Number(j.estimatedHours) : NaN;
  const hoursOk = (Number.isFinite(expH) && expH > 0) || (Number.isFinite(estH) && estH > 0);
  if ((!maxHour || maxHour <= 0) && !hoursOk) {
    return "Auto-fulfill requires autoFulfillExpectedHours (>0), or job estimatedHours (>0), or autoFulfillMaxHourlyCents (>0).";
  }
  if (minHourly != null && minHourly > 0 && minHourly < PLATFORM_MIN_BILLABLE_HOURLY_CENTS) {
    return "autoFulfillMinHourlyCents is below the platform minimum hourly rate.";
  }
  if (maxHour != null && maxHour > 0 && maxHour < PLATFORM_MIN_BILLABLE_HOURLY_CENTS) {
    return "autoFulfillMaxHourlyCents is below the platform minimum hourly rate.";
  }
  const hoursEff = effectiveAutoFulfillWorkerHours(j);
  if (hoursEff > 0 && Number.isFinite(budget) && budget > 0) {
    const minBudgetCents = Math.ceil(hoursEff * PLATFORM_MIN_BILLABLE_HOURLY_CENTS);
    if (budget < minBudgetCents) {
      return `Auto-fulfill labor budget must cover at least ${hoursEff} worker-hours at the platform minimum rate (minimum $${(minBudgetCents / 100).toFixed(2)}).`;
    }
  }
  if (j.autoFulfillMinWorkerRating != null) {
    const r = Number(j.autoFulfillMinWorkerRating);
    if (!Number.isFinite(r) || r < 0 || r > 5) {
      return "autoFulfillMinWorkerRating must be between 0 and 5.";
    }
  }
  return null;
}

export function applyAutoFulfillLegalAck(
  j: Partial<JobAuto>,
  termsAcknowledged?: boolean
): Partial<JobAuto> {
  if (!j.autoFulfillEnabled || !termsAcknowledged) return j;
  return {
    ...j,
    autoFulfillLegalAckVersion: AUTO_FULFILL_LEGAL_VERSION,
    autoFulfillLegalAckAt: new Date(),
  };
}

export function evaluateAutoFulfillAccept(args: {
  job: JobAuto;
  worker: Profile;
  proposedRateCents: number | null | undefined;
  acceptedApplicationCount: number;
}): { accept: boolean; reason: string } {
  const j = args.job;
  if (!j.autoFulfillEnabled) return { accept: false, reason: "disabled" };

  const st = String(j.status ?? "");
  if (st !== "open" && st !== "in_progress") return { accept: false, reason: "job_not_bookable" };

  const maxSlots = j.maxWorkersNeeded ?? 1;
  if (args.acceptedApplicationCount >= maxSlots) return { accept: false, reason: "job_full" };

  if (!j.autoFulfillLegalAckAt || !j.autoFulfillLegalAckVersion) {
    return { accept: false, reason: "missing_legal_ack" };
  }
  if (j.autoFulfillLegalAckVersion !== AUTO_FULFILL_LEGAL_VERSION) {
    return { accept: false, reason: "stale_legal_version" };
  }

  const minRating =
    j.autoFulfillMinWorkerRating != null ? parseFloat(String(j.autoFulfillMinWorkerRating)) : null;
  const minReviews = j.autoFulfillMinWorkerReviews ?? 1;
  const workerRating =
    args.worker.averageRating != null ? parseFloat(String(args.worker.averageRating)) : 0;
  const workerReviews = args.worker.totalReviews ?? 0;

  if (minRating != null && Number.isFinite(minRating)) {
    if (workerReviews < minReviews) return { accept: false, reason: "insufficient_reviews" };
    if (workerRating < minRating) return { accept: false, reason: "below_min_rating" };
  }

  const effectiveRate =
    args.proposedRateCents != null && args.proposedRateCents > 0
      ? args.proposedRateCents
      : j.hourlyRate ?? 0;

  let maxHourly = j.autoFulfillMaxHourlyCents != null ? Number(j.autoFulfillMaxHourlyCents) : null;
  if (maxHourly == null || !Number.isFinite(maxHourly) || maxHourly <= 0) {
    const budget = j.autoFulfillBudgetCents != null ? Number(j.autoFulfillBudgetCents) : 0;
    const hoursRaw =
      j.autoFulfillExpectedHours != null
        ? parseFloat(String(j.autoFulfillExpectedHours))
        : j.estimatedHours != null
          ? Number(j.estimatedHours)
          : 0;
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 0;
    if (budget > 0 && hours > 0) {
      maxHourly = Math.floor(budget / hours);
    }
  }

  if (maxHourly != null && Number.isFinite(maxHourly) && maxHourly > 0 && effectiveRate > maxHourly) {
    return { accept: false, reason: "rate_above_max" };
  }

  const minHourly = j.autoFulfillMinHourlyCents != null ? Number(j.autoFulfillMinHourlyCents) : null;
  if (minHourly != null && Number.isFinite(minHourly) && minHourly > 0 && effectiveRate < minHourly) {
    return { accept: false, reason: "rate_below_min" };
  }

  const policy = (j.autoFulfillPolicy || "first_match").toLowerCase();
  if (policy !== "first_match") {
    return { accept: false, reason: "unsupported_policy" };
  }

  return { accept: true, reason: "ok" };
}
