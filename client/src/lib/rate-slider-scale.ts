/**
 * Non-linear scale for the $1–$200 rate slider:
 * - First 50% of the bar = $1 to $30 (easier to pick common rates)
 * - Second 50% of the bar = $30 to $200 (takes more sliding to reach high rates)
 */

const LOW_MAX = 30;
const HIGH_MAX = 200;

/** Convert rate ($1–$200) to slider position in [0, 1]. */
export function rateToPosition(rate: number): number {
  const r = Math.max(1, Math.min(HIGH_MAX, Math.round(rate)));
  if (r <= LOW_MAX) return 0.5 * (r - 1) / (LOW_MAX - 1);
  return 0.5 + 0.5 * (r - LOW_MAX) / (HIGH_MAX - LOW_MAX);
}

/** Convert slider position in [0, 1] to rate ($1–$200). */
export function positionToRate(position: number): number {
  const p = Math.max(0, Math.min(1, position));
  if (p <= 0.5) {
    return Math.round(1 + (LOW_MAX - 1) * (p / 0.5));
  }
  return Math.round(LOW_MAX + (HIGH_MAX - LOW_MAX) * ((p - 0.5) / 0.5));
}

export const RATE_MIN = 1;
export const RATE_MAX = HIGH_MAX;
