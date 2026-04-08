/**
 * Minimum worker-side hourly used for rate floors and pay logic (USD / hour).
 * Product rule — not legal advice; adjust if you add jurisdiction-specific minimums.
 */
export const PLATFORM_MIN_BILLABLE_HOURLY_USD = 15;
export const PLATFORM_MIN_BILLABLE_HOURLY_CENTS = Math.round(PLATFORM_MIN_BILLABLE_HOURLY_USD * 100);

/**
 * Per worker-hour amount that must be covered inside company labor budgets (payroll processing).
 * Not broken out in posting UI; combined with {@link PLATFORM_MIN_BILLABLE_HOURLY_USD} for budget floors.
 */
export const PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_USD = 13;
export const PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_CENTS = Math.round(PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_USD * 100);

/** Company job budget: minimum implied $/worker-hour (worker floor + per-hour payroll allocation). */
export const PLATFORM_MIN_JOB_BUDGET_HOURLY_USD =
  PLATFORM_MIN_BILLABLE_HOURLY_USD + PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_USD;
export const PLATFORM_MIN_JOB_BUDGET_HOURLY_CENTS = Math.round(PLATFORM_MIN_JOB_BUDGET_HOURLY_USD * 100);

/**
 * `jobs.hourly_rate` is stored as company billable cents per worker-hour (wage + {@link PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_CENTS}).
 * Worker-facing listings and apply flows use wage only (no platform line item in UI).
 */
export function workerFacingJobHourlyCents(billableHourlyCents: number | null | undefined): number {
  if (billableHourlyCents == null || !Number.isFinite(billableHourlyCents) || billableHourlyCents <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(billableHourlyCents - PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_CENTS));
}
