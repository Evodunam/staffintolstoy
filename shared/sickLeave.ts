/**
 * State paid-sick-leave accrual rules.
 *
 * Worker-side: covered states require accrual at minimum rates per hour worked,
 * with carryover and max balance caps. Independent contractors are NOT generally
 * covered, but several jurisdictions (CA SB-95, NJ Earned Sick Leave Law,
 * Seattle PSST) have expanded definitions and enforcement is uneven; tracking
 * accrual proactively reduces misclassification + back-pay exposure.
 *
 * This module produces the per-shift accrual amount and the running balance
 * cap. It is PURE — no DB, no I/O. The server applies it after each timesheet
 * approval and persists the running balance on the worker's profile.
 */

export type SickLeaveJurisdiction =
  | "CA" | "AZ" | "CO" | "CT" | "MA" | "MD" | "MI" | "MN"
  | "NJ" | "NM" | "NY" | "OR" | "RI" | "VT" | "WA" | "DC"
  | "SEATTLE" | "NYC" | "SF" | "PHILADELPHIA" | "MINNEAPOLIS";

export interface SickLeaveRule {
  /** Hours of sick time accrued per hour worked (e.g. CA: 1/30 ≈ 0.0333). */
  accrualRatePerHourWorked: number;
  /** Maximum hours an employer must allow to accrue per year. */
  annualAccrualCapHours: number;
  /** Maximum balance the employee may carry at any time. */
  maxBalanceHours: number;
  /** Hours that must be allowed to be USED per year (CA: 40h or 5 days). */
  annualUsageCapHours: number;
  /** Citation for code-comments / wage-statement footers. */
  citation: string;
}

export const SICK_LEAVE_RULES: Record<SickLeaveJurisdiction, SickLeaveRule> = {
  CA: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 80, maxBalanceHours: 80, annualUsageCapHours: 40, citation: "CA Labor Code §246 (SB-616, eff Jan 2024 — 5 days/40h minimum)" },
  AZ: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 40, maxBalanceHours: 40, annualUsageCapHours: 40, citation: "AZ Fair Wages and Healthy Families Act" },
  CO: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 48, maxBalanceHours: 48, annualUsageCapHours: 48, citation: "CO Healthy Families and Workplaces Act" },
  CT: { accrualRatePerHourWorked: 1 / 40, annualAccrualCapHours: 40, maxBalanceHours: 40, annualUsageCapHours: 40, citation: "CT Public Act 11-52" },
  MA: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 40, maxBalanceHours: 40, annualUsageCapHours: 40, citation: "MA Earned Sick Time Law (M.G.L. c.149 §148C)" },
  MD: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 40, maxBalanceHours: 64, annualUsageCapHours: 64, citation: "MD Healthy Working Families Act" },
  MI: { accrualRatePerHourWorked: 1 / 35, annualAccrualCapHours: 40, maxBalanceHours: 40, annualUsageCapHours: 40, citation: "MI Paid Medical Leave Act (PA 369 of 2018)" },
  MN: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 48, maxBalanceHours: 80, annualUsageCapHours: 48, citation: "MN Earned Sick and Safe Time (eff Jan 2024)" },
  NJ: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 40, maxBalanceHours: 40, annualUsageCapHours: 40, citation: "NJ Earned Sick Leave Law (P.L. 2018, c.10)" },
  NM: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 64, maxBalanceHours: 64, annualUsageCapHours: 64, citation: "NM Healthy Workplaces Act" },
  NY: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 56, maxBalanceHours: 56, annualUsageCapHours: 56, citation: "NY Labor Law §196-b" },
  OR: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 40, maxBalanceHours: 40, annualUsageCapHours: 40, citation: "OR Sick Time Law (ORS 653.601)" },
  RI: { accrualRatePerHourWorked: 1 / 35, annualAccrualCapHours: 40, maxBalanceHours: 40, annualUsageCapHours: 40, citation: "RI Healthy and Safe Families and Workplaces Act" },
  VT: { accrualRatePerHourWorked: 1 / 52, annualAccrualCapHours: 40, maxBalanceHours: 40, annualUsageCapHours: 40, citation: "VT Earned Sick Time Act (21 V.S.A. §481)" },
  WA: { accrualRatePerHourWorked: 1 / 40, annualAccrualCapHours: Infinity, maxBalanceHours: Infinity, annualUsageCapHours: Infinity, citation: "WA Initiative 1433 (RCW 49.46.210)" },
  DC: { accrualRatePerHourWorked: 1 / 37, annualAccrualCapHours: 56, maxBalanceHours: 56, annualUsageCapHours: 56, citation: "DC Accrued Sick and Safe Leave Act" },

  SEATTLE: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: Infinity, maxBalanceHours: Infinity, annualUsageCapHours: Infinity, citation: "Seattle PSST (SMC 14.16)" },
  NYC: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 56, maxBalanceHours: 56, annualUsageCapHours: 56, citation: "NYC Earned Safe and Sick Time Act" },
  SF: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 72, maxBalanceHours: 72, annualUsageCapHours: 72, citation: "SF Paid Sick Leave Ordinance" },
  PHILADELPHIA: { accrualRatePerHourWorked: 1 / 40, annualAccrualCapHours: 40, maxBalanceHours: 40, annualUsageCapHours: 40, citation: "Philadelphia Promoting Healthy Families and Workplaces" },
  MINNEAPOLIS: { accrualRatePerHourWorked: 1 / 30, annualAccrualCapHours: 48, maxBalanceHours: 80, annualUsageCapHours: 48, citation: "Minneapolis Sick and Safe Time Ordinance" },
};

export function getSickLeaveRule(state: string | null | undefined, city?: string | null): SickLeaveRule | null {
  const code = (state || "").trim().toUpperCase();
  const cityKey = (city || "").trim().toUpperCase();
  // City overrides take precedence (most worker-favorable)
  if (cityKey === "SEATTLE" && code === "WA") return SICK_LEAVE_RULES.SEATTLE;
  if (cityKey === "NEW YORK" && code === "NY") return SICK_LEAVE_RULES.NYC;
  if (cityKey === "SAN FRANCISCO" && code === "CA") return SICK_LEAVE_RULES.SF;
  if (cityKey === "PHILADELPHIA" && code === "PA") return SICK_LEAVE_RULES.PHILADELPHIA;
  if (cityKey === "MINNEAPOLIS" && code === "MN") return SICK_LEAVE_RULES.MINNEAPOLIS;
  if ((SICK_LEAVE_RULES as Record<string, SickLeaveRule>)[code]) return SICK_LEAVE_RULES[code as SickLeaveJurisdiction];
  return null;
}

export interface AccrueArgs {
  hoursWorked: number;
  state: string | null | undefined;
  city?: string | null;
  /** Worker's current accrued sick-leave balance in hours BEFORE this shift. */
  currentBalanceHours: number;
  /** Sum of sick-leave hours already accrued YEAR-TO-DATE (for annual cap). */
  ytdAccruedHours: number;
}

export interface AccrueResult {
  rule: SickLeaveRule | null;
  accruedThisShiftHours: number;
  newBalanceHours: number;
  /** Was annual or balance cap hit this shift? */
  cappedAt: "annual" | "balance" | null;
}

export function accrueSickLeave(args: AccrueArgs): AccrueResult {
  const rule = getSickLeaveRule(args.state, args.city);
  if (!rule) {
    return { rule: null, accruedThisShiftHours: 0, newBalanceHours: args.currentBalanceHours, cappedAt: null };
  }
  const rawAccrual = args.hoursWorked * rule.accrualRatePerHourWorked;
  const remainingAnnual = Math.max(0, rule.annualAccrualCapHours - args.ytdAccruedHours);
  const remainingBalance = Math.max(0, rule.maxBalanceHours - args.currentBalanceHours);
  let cappedAt: AccrueResult["cappedAt"] = null;
  let accruedThisShiftHours = rawAccrual;
  if (accruedThisShiftHours > remainingAnnual) { accruedThisShiftHours = remainingAnnual; cappedAt = "annual"; }
  if (accruedThisShiftHours > remainingBalance) { accruedThisShiftHours = remainingBalance; cappedAt = "balance"; }
  return {
    rule,
    accruedThisShiftHours: Math.round(accruedThisShiftHours * 100) / 100,
    newBalanceHours: Math.round((args.currentBalanceHours + accruedThisShiftHours) * 100) / 100,
    cappedAt,
  };
}
