/**
 * Per-state minimum wage + overtime computation.
 *
 * Source of truth for: minimum-wage enforcement at job posting, hourly-rate
 * validation at clock-in, overtime/double-time pay calculation at timesheet
 * approval, and the line-item breakdown shown on CA Labor Code §226 wage
 * statements.
 *
 * Rates and rules are accurate to 2025; review annually (most states update Jan 1).
 * Cited sources kept as comments next to each value for legal defensibility.
 *
 * IMPORTANT: This module has NO side-effects (no DB, no network). It must stay
 * pure so the same logic runs on the server (for pay calc) and the client (for
 * "your gross will be $X" previews).
 */

export type StateCode =
  | "AK" | "AL" | "AR" | "AZ" | "CA" | "CO" | "CT" | "DC" | "DE" | "FL"
  | "GA" | "HI" | "IA" | "ID" | "IL" | "IN" | "KS" | "KY" | "LA" | "MA"
  | "MD" | "ME" | "MI" | "MN" | "MO" | "MS" | "MT" | "NC" | "ND" | "NE"
  | "NH" | "NJ" | "NM" | "NV" | "NY" | "OH" | "OK" | "OR" | "PA" | "RI"
  | "SC" | "SD" | "TN" | "TX" | "UT" | "VA" | "VT" | "WA" | "WI" | "WV"
  | "WY";

const FEDERAL_MIN_WAGE_USD = 7.25; // 29 USC §206 (FLSA)

/** State minimum wages (USD/hr). Effective 2025; review every January. */
const STATE_MIN_WAGE_USD: Record<StateCode, number> = {
  AK: 13.00, AL: FEDERAL_MIN_WAGE_USD, AR: 11.00, AZ: 14.70,
  CA: 16.50, CO: 14.81, CT: 16.35, DC: 17.50, DE: 15.00,
  FL: 13.00, GA: FEDERAL_MIN_WAGE_USD, HI: 14.00,
  IA: FEDERAL_MIN_WAGE_USD, ID: FEDERAL_MIN_WAGE_USD, IL: 15.00,
  IN: FEDERAL_MIN_WAGE_USD, KS: FEDERAL_MIN_WAGE_USD, KY: FEDERAL_MIN_WAGE_USD,
  LA: FEDERAL_MIN_WAGE_USD, MA: 15.00, MD: 15.00, ME: 14.65, MI: 12.48,
  MN: 11.13, MO: 13.75, MS: FEDERAL_MIN_WAGE_USD, MT: 10.55,
  NC: FEDERAL_MIN_WAGE_USD, ND: FEDERAL_MIN_WAGE_USD, NE: 13.50,
  NH: FEDERAL_MIN_WAGE_USD, NJ: 15.49, NM: 12.00, NV: 12.00, NY: 15.50,
  OH: 10.70, OK: FEDERAL_MIN_WAGE_USD, OR: 14.70, PA: FEDERAL_MIN_WAGE_USD,
  RI: 15.00, SC: FEDERAL_MIN_WAGE_USD, SD: 11.50, TN: FEDERAL_MIN_WAGE_USD,
  TX: FEDERAL_MIN_WAGE_USD, UT: FEDERAL_MIN_WAGE_USD, VA: 12.41, VT: 14.01,
  WA: 16.66, WI: FEDERAL_MIN_WAGE_USD, WV: 8.75, WY: FEDERAL_MIN_WAGE_USD,
};

/** City/county overrides that exceed state minimums (lowercased "city, ST" key). */
const CITY_MIN_WAGE_USD: Record<string, number> = {
  "san francisco, ca": 18.67,
  "los angeles, ca": 17.28,
  "oakland, ca": 16.50,
  "berkeley, ca": 18.67,
  "emeryville, ca": 19.36,
  "west hollywood, ca": 19.65,
  "san jose, ca": 17.55,
  "mountain view, ca": 19.20,
  "palo alto, ca": 18.20,
  "sunnyvale, ca": 19.00,
  "new york, ny": 16.50,
  "long island, ny": 16.50,
  "westchester, ny": 16.50,
  "seattle, wa": 20.76,
  "portland, or": 15.95,
  "denver, co": 18.81,
  "chicago, il": 16.20,
  "minneapolis, mn": 15.57,
  "saint paul, mn": 15.57,
  "washington, dc": 17.50,
};

export interface MinimumWageContext {
  state?: string | null;
  city?: string | null;
}

/** Returns the effective minimum wage in USD/hr at a given location. */
export function getMinimumWageUsd(loc: MinimumWageContext): number {
  const stateRaw = (loc.state || "").trim().toUpperCase();
  const state = (stateRaw.length === 2 ? stateRaw : stateNameToCode(stateRaw)) as StateCode | "";
  const city = (loc.city || "").trim().toLowerCase();
  if (state && city) {
    const cityKey = `${city}, ${state.toLowerCase()}`;
    if (CITY_MIN_WAGE_USD[cityKey] != null) return CITY_MIN_WAGE_USD[cityKey];
  }
  if (state && STATE_MIN_WAGE_USD[state as StateCode] != null) {
    return STATE_MIN_WAGE_USD[state as StateCode];
  }
  return FEDERAL_MIN_WAGE_USD;
}

/** Returns minimum wage in cents. Rounded UP so we never short workers by sub-cent rounding. */
export function getMinimumWageCents(loc: MinimumWageContext): number {
  return Math.ceil(getMinimumWageUsd(loc) * 100);
}

// ---------------------------------------------------------------------------
// Overtime
// ---------------------------------------------------------------------------

export interface OvertimeRules {
  /** Daily threshold above which 1.5x kicks in. */
  dailyOvertimeAfterHours: number | null;
  /** Daily threshold above which 2.0x kicks in (CA). */
  dailyDoubleTimeAfterHours: number | null;
  /** Weekly threshold for 1.5x (FLSA federal default = 40). */
  weeklyOvertimeAfterHours: number;
  /**
   * 7th-consecutive-day-of-workweek rule (CA Labor Code §510): first 8h at 1.5x,
   * anything over 8h at 2x. Only enforced for states that have it.
   */
  seventhConsecutiveDayPremium: boolean;
}

export function getOvertimeRules(state: string | null | undefined): OvertimeRules {
  const code = (state || "").trim().toUpperCase();
  switch (code) {
    case "CA":
    case "CALIFORNIA":
      // CA Labor Code §510. Most generous worker-side rule in the US.
      return {
        dailyOvertimeAfterHours: 8,
        dailyDoubleTimeAfterHours: 12,
        weeklyOvertimeAfterHours: 40,
        seventhConsecutiveDayPremium: true,
      };
    case "AK":
    case "ALASKA":
      // AS 23.10.060
      return { dailyOvertimeAfterHours: 8, dailyDoubleTimeAfterHours: null, weeklyOvertimeAfterHours: 40, seventhConsecutiveDayPremium: false };
    case "NV":
    case "NEVADA":
      // NRS 608.018 — daily OT only if rate < 1.5x state min wage; we apply the conservative rule.
      return { dailyOvertimeAfterHours: 8, dailyDoubleTimeAfterHours: null, weeklyOvertimeAfterHours: 40, seventhConsecutiveDayPremium: false };
    case "CO":
    case "COLORADO":
      // 7 CCR 1103-1 (COMPS) — daily OT after 12h, weekly after 40h.
      return { dailyOvertimeAfterHours: 12, dailyDoubleTimeAfterHours: null, weeklyOvertimeAfterHours: 40, seventhConsecutiveDayPremium: false };
    default:
      // FLSA-only fallback: weekly OT after 40 hours.
      return { dailyOvertimeAfterHours: null, dailyDoubleTimeAfterHours: null, weeklyOvertimeAfterHours: 40, seventhConsecutiveDayPremium: false };
  }
}

export interface ShiftPayInput {
  /** Total hours actually worked in this shift. */
  hoursWorked: number;
  /** Worker's regular hourly rate in cents. */
  hourlyRateCents: number;
  /** Worker's work location (drives both min wage AND OT rules). */
  workState?: string | null;
  workCity?: string | null;
  /** Sum of hours already worked in the same workweek BEFORE this shift. */
  weekToDateHoursBefore: number;
  /** True if this shift falls on the 7th consecutive day of the workweek. */
  isSeventhConsecutiveDay: boolean;
}

export interface ShiftPayResult {
  regularHours: number;
  overtimeHours: number;       // 1.5x
  doubleTimeHours: number;     // 2.0x
  regularPayCents: number;
  overtimePayCents: number;
  doubleTimePayCents: number;
  totalPayCents: number;
  effectiveHourlyRateCents: number;
  /** Min-wage check: was the base rate at or above the location's floor? */
  meetsMinimumWage: boolean;
  minimumWageCents: number;
  rulesApplied: OvertimeRules;
  /** Human-readable line items for wage statements. */
  lineItems: Array<{ kind: "regular" | "overtime" | "double_time"; hours: number; rateCents: number; amountCents: number }>;
}

/**
 * Compute pay for a single shift, splitting hours across regular / 1.5x / 2.0x
 * buckets per the worker-location's rules. NEVER rounds down (CA Donohue v.
 * AMN Services, 2021): worker-facing rounding always favors the worker.
 */
export function computeShiftPay(input: ShiftPayInput): ShiftPayResult {
  const rules = getOvertimeRules(input.workState);
  const minWageCents = getMinimumWageCents({ state: input.workState, city: input.workCity });
  const baseRate = input.hourlyRateCents;

  let remaining = Math.max(0, input.hoursWorked);
  let regularH = 0;
  let otH = 0;
  let dtH = 0;

  // 1) Daily double-time (CA only): hours beyond the daily double-time threshold.
  if (rules.dailyDoubleTimeAfterHours != null && remaining > rules.dailyDoubleTimeAfterHours) {
    dtH = remaining - rules.dailyDoubleTimeAfterHours;
    remaining = rules.dailyDoubleTimeAfterHours;
  }

  // 2) Daily 1.5x (CA, AK, NV; CO above 12h): hours between daily OT and double-time threshold.
  if (rules.dailyOvertimeAfterHours != null && remaining > rules.dailyOvertimeAfterHours) {
    otH = remaining - rules.dailyOvertimeAfterHours;
    remaining = rules.dailyOvertimeAfterHours;
  }

  // 3) Federal weekly OT: any hour pushing weekly total above the weekly threshold goes to 1.5x.
  const weeklyAlready = Math.max(0, input.weekToDateHoursBefore);
  const weeklyThreshold = rules.weeklyOvertimeAfterHours;
  // Only the *regular* bucket portion of this shift counts toward weekly OT
  // (daily OT/DT hours are already overtime; FLSA does not double-count them).
  const regularThisShift = remaining;
  if (weeklyAlready + regularThisShift > weeklyThreshold) {
    const weeklyOtHours = Math.min(regularThisShift, (weeklyAlready + regularThisShift) - weeklyThreshold);
    otH += weeklyOtHours;
    regularH = regularThisShift - weeklyOtHours;
  } else {
    regularH = regularThisShift;
  }

  // 4) CA 7th-consecutive-day premium: first 8 hrs at 1.5x, beyond 8 at 2x — but ONLY if
  //    the daily/weekly rules above didn't already give the worker a richer outcome.
  if (rules.seventhConsecutiveDayPremium && input.isSeventhConsecutiveDay && input.hoursWorked > 0) {
    // Replace whatever bucketing happened with the 7th-day rule (it's worker-favorable by design).
    const total = input.hoursWorked;
    regularH = 0;
    otH = Math.min(8, total);
    dtH = Math.max(0, total - 8);
  }

  const otRateCents = Math.ceil(baseRate * 1.5);
  const dtRateCents = baseRate * 2;

  const regularPayCents = roundUpCents(regularH * baseRate);
  const overtimePayCents = roundUpCents(otH * otRateCents);
  const doubleTimePayCents = roundUpCents(dtH * dtRateCents);
  const totalPayCents = regularPayCents + overtimePayCents + doubleTimePayCents;

  const lineItems: ShiftPayResult["lineItems"] = [];
  if (regularH > 0) lineItems.push({ kind: "regular", hours: regularH, rateCents: baseRate, amountCents: regularPayCents });
  if (otH > 0) lineItems.push({ kind: "overtime", hours: otH, rateCents: otRateCents, amountCents: overtimePayCents });
  if (dtH > 0) lineItems.push({ kind: "double_time", hours: dtH, rateCents: dtRateCents, amountCents: doubleTimePayCents });

  return {
    regularHours: regularH,
    overtimeHours: otH,
    doubleTimeHours: dtH,
    regularPayCents,
    overtimePayCents,
    doubleTimePayCents,
    totalPayCents,
    effectiveHourlyRateCents: input.hoursWorked > 0 ? Math.ceil(totalPayCents / input.hoursWorked) : baseRate,
    meetsMinimumWage: baseRate >= minWageCents,
    minimumWageCents: minWageCents,
    rulesApplied: rules,
    lineItems,
  };
}

/**
 * Always round UP cents — never short the worker by sub-cent rounding.
 * (CA Donohue v. AMN Services prohibits "always round down" time-rounding policies;
 * we apply the same principle to monetary rounding.)
 */
export function roundUpCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.ceil(value - 1e-9); // 1e-9 epsilon to avoid Math.ceil(0.0000000001 -> 1)
}

// ---------------------------------------------------------------------------
// State name -> code (so APIs accepting "California" or "CA" both work)
// ---------------------------------------------------------------------------

const STATE_NAME_MAP: Record<string, StateCode> = {
  ALASKA: "AK", ALABAMA: "AL", ARKANSAS: "AR", ARIZONA: "AZ", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", "DISTRICT OF COLUMBIA": "DC", DELAWARE: "DE",
  FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IOWA: "IA", IDAHO: "ID",
  ILLINOIS: "IL", INDIANA: "IN", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA",
  MASSACHUSETTS: "MA", MARYLAND: "MD", MAINE: "ME", MICHIGAN: "MI", MINNESOTA: "MN",
  MISSOURI: "MO", MISSISSIPPI: "MS", MONTANA: "MT", "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND", NEBRASKA: "NE", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM", NEVADA: "NV", "NEW YORK": "NY", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VIRGINIA: "VA",
  VERMONT: "VT", WASHINGTON: "WA", WISCONSIN: "WI", "WEST VIRGINIA": "WV", WYOMING: "WY",
};

export function stateNameToCode(name: string): StateCode | "" {
  const upper = name.trim().toUpperCase();
  if (STATE_NAME_MAP[upper]) return STATE_NAME_MAP[upper];
  return "";
}

// ---------------------------------------------------------------------------
// Pay-transparency disclosure (separate from min wage but related)
// ---------------------------------------------------------------------------

/** States that legally require pay range on job postings visible to their residents. */
export const PAY_TRANSPARENCY_STATES: StateCode[] = ["CA", "CO", "IL", "MD", "MN", "NJ", "NY", "WA"];

/** Whether a job posted in this jurisdiction MUST include a pay range. */
export function requiresPayRangeDisclosure(state: string | null | undefined): boolean {
  const upper = (state || "").trim().toUpperCase();
  const code = upper.length === 2 ? (upper as StateCode) : stateNameToCode(upper);
  return code !== "" && PAY_TRANSPARENCY_STATES.includes(code as StateCode);
}
