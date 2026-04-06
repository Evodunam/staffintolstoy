/**
 * Platform floor for implied / effective pay when validating budgets (USD / hour).
 * Product rule — not legal advice; adjust if you add jurisdiction-specific minimums.
 */
export const PLATFORM_MIN_BILLABLE_HOURLY_USD = 15;
export const PLATFORM_MIN_BILLABLE_HOURLY_CENTS = Math.round(PLATFORM_MIN_BILLABLE_HOURLY_USD * 100);
