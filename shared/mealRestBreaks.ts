/**
 * Meal/rest break compliance per state. Pure module — server uses it to add
 * §226.7 penalty pay; client uses it to prompt the worker at the 4h/5h marks.
 */

export interface BreakRules {
  /** Minimum hours triggering a meal-break requirement. */
  mealBreakRequiredAfterHours: number;
  /** Minimum length of the required meal break (minutes). */
  mealBreakMinMinutes: number;
  /** Hours threshold where a SECOND meal break is required (CA: 10h). */
  secondMealBreakAfterHours: number | null;
  /** Maximum shift length allowing the meal break to be waived by mutual consent (CA: 6h). */
  mealBreakWaivableUpToHours: number | null;
  /** Rest breaks: required minutes per N hours worked (e.g. CA: 10 minutes per 4 hours). */
  restBreakMinutesPer: { perHours: number; minutes: number } | null;
  /** Whether the state assesses a §226.7-style "premium hour" for missed breaks. */
  premiumPayForMissedBreak: boolean;
}

const FLSA_NO_BREAK_RULES: BreakRules = {
  mealBreakRequiredAfterHours: Infinity, // FLSA does not require breaks federally.
  mealBreakMinMinutes: 0,
  secondMealBreakAfterHours: null,
  mealBreakWaivableUpToHours: null,
  restBreakMinutesPer: null,
  premiumPayForMissedBreak: false,
};

const STATE_RULES: Record<string, BreakRules> = {
  CA: {
    mealBreakRequiredAfterHours: 5,        // §512(a)
    mealBreakMinMinutes: 30,
    secondMealBreakAfterHours: 10,
    mealBreakWaivableUpToHours: 6,         // §512(a) — waivable by mutual consent only if shift ≤ 6h
    restBreakMinutesPer: { perHours: 4, minutes: 10 }, // §226.7 / Wage Order 4-2001 §12
    premiumPayForMissedBreak: true,        // §226.7(c) — 1 hour of regular-rate premium pay
  },
  WA: {
    mealBreakRequiredAfterHours: 5,        // WAC 296-126-092
    mealBreakMinMinutes: 30,
    secondMealBreakAfterHours: null,
    mealBreakWaivableUpToHours: null,
    restBreakMinutesPer: { perHours: 4, minutes: 10 },
    premiumPayForMissedBreak: true,
  },
  OR: {
    mealBreakRequiredAfterHours: 6,        // OR OAR 839-020-0050
    mealBreakMinMinutes: 30,
    secondMealBreakAfterHours: null,
    mealBreakWaivableUpToHours: null,
    restBreakMinutesPer: { perHours: 4, minutes: 10 },
    premiumPayForMissedBreak: false,       // not statutory; civil penalty available
  },
  CO: {
    mealBreakRequiredAfterHours: 5,        // 7 CCR 1103-1 (COMPS Order)
    mealBreakMinMinutes: 30,
    secondMealBreakAfterHours: null,
    mealBreakWaivableUpToHours: null,
    restBreakMinutesPer: { perHours: 4, minutes: 10 },
    premiumPayForMissedBreak: true,
  },
  NY: {
    mealBreakRequiredAfterHours: 6,        // 12 NYCRR §142-2.18
    mealBreakMinMinutes: 30,
    secondMealBreakAfterHours: null,
    mealBreakWaivableUpToHours: null,
    restBreakMinutesPer: null,
    premiumPayForMissedBreak: false,
  },
  IL: {
    mealBreakRequiredAfterHours: 7.5,      // 820 ILCS 140/3
    mealBreakMinMinutes: 20,
    secondMealBreakAfterHours: null,
    mealBreakWaivableUpToHours: null,
    restBreakMinutesPer: null,
    premiumPayForMissedBreak: false,
  },
};

export function getBreakRules(state: string | null | undefined): BreakRules {
  const code = (state || "").trim().toUpperCase();
  if (STATE_RULES[code]) return STATE_RULES[code];
  return FLSA_NO_BREAK_RULES;
}

export interface BreakComplianceInput {
  hoursWorked: number;
  state: string | null | undefined;
  mealBreaksTakenMinutes: number;
  restBreaksTakenCount: number;
  mealBreakWaived: boolean;
  hourlyRateCents: number;
}

export interface BreakComplianceResult {
  rules: BreakRules;
  mealBreakRequired: boolean;
  /** How many additional meal-break minutes are owed (0 = compliant). */
  mealBreakShortMinutes: number;
  /** How many rest breaks were short. */
  restBreakShortCount: number;
  /** Penalty pay (cents) for missed meal break (CA §226.7 = 1 hour at regular rate). */
  mealBreakPenaltyCents: number;
  /** Penalty pay (cents) for missed rest break(s). */
  restBreakPenaltyCents: number;
}

export function evaluateBreakCompliance(input: BreakComplianceInput): BreakComplianceResult {
  const rules = getBreakRules(input.state);
  const result: BreakComplianceResult = {
    rules,
    mealBreakRequired: false,
    mealBreakShortMinutes: 0,
    restBreakShortCount: 0,
    mealBreakPenaltyCents: 0,
    restBreakPenaltyCents: 0,
  };
  if (input.hoursWorked < rules.mealBreakRequiredAfterHours) return result;

  result.mealBreakRequired = true;

  const requiredMealMinutes = rules.mealBreakMinMinutes
    + (rules.secondMealBreakAfterHours != null && input.hoursWorked >= rules.secondMealBreakAfterHours ? rules.mealBreakMinMinutes : 0);

  // Waiver: only allowed when shift ≤ waivable threshold AND worker explicitly waived.
  const waiverApplies = !!(input.mealBreakWaived
    && rules.mealBreakWaivableUpToHours != null
    && input.hoursWorked <= rules.mealBreakWaivableUpToHours);

  if (!waiverApplies) {
    result.mealBreakShortMinutes = Math.max(0, requiredMealMinutes - input.mealBreaksTakenMinutes);
    if (result.mealBreakShortMinutes > 0 && rules.premiumPayForMissedBreak) {
      result.mealBreakPenaltyCents = input.hourlyRateCents; // 1 hour at regular rate
    }
  }

  if (rules.restBreakMinutesPer) {
    const requiredRestBreaks = Math.floor(input.hoursWorked / rules.restBreakMinutesPer.perHours);
    result.restBreakShortCount = Math.max(0, requiredRestBreaks - input.restBreaksTakenCount);
    if (result.restBreakShortCount > 0 && rules.premiumPayForMissedBreak) {
      // §226.7 imposes one premium hour per workday for missed-rest-break category, regardless of count.
      result.restBreakPenaltyCents = input.hourlyRateCents;
    }
  }

  return result;
}
