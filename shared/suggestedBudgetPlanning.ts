/**
 * Illustrative planning rates for company job budgets (USD/hr bands).
 * Tiers are labor-side anchors × location, then {@link PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_USD} is added so totals match
 * what companies budget (worker-leaning slice + fixed per-worker-hour platform allocation). Not a wage quote or new minimum.
 *
 * Phase 2 (optional): replace or refine bands via server route (BLS/COLI/LLM) with cache + fallback to this module.
 */
import {
  PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_USD,
  PLATFORM_MIN_JOB_BUDGET_HOURLY_USD,
} from "./platformPayPolicy";

export type BudgetTier =
  | "labor_floor"
  | "retail_hosp"
  | "logistics"
  | "general_outdoor"
  | "general_skilled"
  | "trade_lite"
  | "office_mgmt"
  | "trade_elite";

const TIER_RANK: Record<BudgetTier, number> = {
  labor_floor: 0,
  retail_hosp: 1,
  logistics: 2,
  general_outdoor: 3,
  general_skilled: 4,
  trade_lite: 5,
  office_mgmt: 6,
  trade_elite: 7,
};

/**
 * Labor-side planning anchors (USD/hr), before US-state multiplier.
 * {@link PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_USD} is added after COL so company-facing totals include payroll-processing allocation.
 */
const TIER_LABOR_USD: Record<BudgetTier, { low: number; mid: number; high: number }> = {
  labor_floor: { low: 15, mid: 17, high: 21 },
  retail_hosp: { low: 15, mid: 19, high: 25 },
  logistics: { low: 17, mid: 22, high: 29 },
  general_outdoor: { low: 17, mid: 23, high: 31 },
  general_skilled: { low: 21, mid: 29, high: 39 },
  trade_lite: { low: 25, mid: 35, high: 45 },
  office_mgmt: { low: 23, mid: 31, high: 41 },
  trade_elite: { low: 35, mid: 49, high: 65 },
};

/**
 * Explicit map for each role id from shared industry definitions.
 * Unknown ids default to labor_floor in getRoleBudgetTier.
 */
const ROLE_ID_TO_TIER: Record<string, BudgetTier> = {
  Laborer: "labor_floor",
  Landscaping: "general_outdoor",
  Painting: "general_skilled",
  Drywall: "general_skilled",
  Concrete: "general_skilled",
  "Carpentry Lite": "trade_lite",
  "Carpentry Elite": "trade_elite",
  "Electrical Lite": "trade_lite",
  "Electrical Elite": "trade_elite",
  "Plumbing Lite": "trade_lite",
  "Plumbing Elite": "trade_elite",
  "HVAC Lite": "trade_lite",
  "HVAC Elite": "trade_elite",
  "Assembly Line Worker": "logistics",
  "Forklift Operator": "logistics",
  "Warehouse Associate": "logistics",
  "Supply Chain Coordinator": "office_mgmt",
  "Sales Associate": "retail_hosp",
  "Inventory Specialist": "retail_hosp",
  "Store Supervisor": "office_mgmt",
  Housekeeper: "retail_hosp",
  "Laundry Staff": "retail_hosp",
  "Janitorial Staff": "retail_hosp",
  "Event Coordinator": "office_mgmt",
  "Banquet Server": "retail_hosp",
  "Setup Crew": "labor_floor",
  "AV Technician": "trade_lite",
  "Site Manager": "office_mgmt",
  Supervisor: "office_mgmt",
  "Office Admin": "office_mgmt",
  "HR Coordinator": "office_mgmt",
};

/** v1: US state code (2 letters) → rough cost-of-labor multiplier. Missing/unknown → 1. */
const US_STATE_MULTIPLIER: Record<string, number> = {
  CA: 1.14,
  NY: 1.14,
  MA: 1.12,
  NJ: 1.12,
  WA: 1.1,
  DC: 1.16,
  CT: 1.1,
  MD: 1.1,
  HI: 1.18,
  OR: 1.08,
  CO: 1.08,
  IL: 1.06,
  VA: 1.08,
  FL: 1.04,
  TX: 1.02,
  AZ: 1.06,
  GA: 1.03,
  NV: 1.06,
  NH: 1.06,
  RI: 1.08,
  DE: 1.08,
  AK: 1.12,
  PA: 1.02,
  UT: 1.02,
  VT: 1.02,
  ME: 0.98,
  NC: 0.98,
  MS: 0.92,
  AR: 0.92,
  WV: 0.94,
  AL: 0.94,
  OK: 0.94,
  KY: 0.94,
  LA: 0.94,
  TN: 0.96,
  SC: 0.94,
  ND: 0.94,
  SD: 0.94,
  NE: 0.96,
  KS: 0.96,
  IA: 0.96,
  MO: 0.96,
  IN: 0.97,
  OH: 0.97,
  WI: 0.97,
  MI: 0.97,
  ID: 0.96,
  NM: 0.96,
  MT: 0.94,
  WY: 0.94,
};

export function getRoleBudgetTier(roleId: string): BudgetTier {
  return ROLE_ID_TO_TIER[roleId] ?? "labor_floor";
}

/** When multiple roles are selected, use the highest-cost tier (conservative for planning). */
export function maxBudgetTierForRoles(selectedRoleIds: string[]): BudgetTier {
  if (selectedRoleIds.length === 0) return "labor_floor";
  let best: BudgetTier = "labor_floor";
  let bestRank = TIER_RANK[best];
  for (const id of selectedRoleIds) {
    const t = getRoleBudgetTier(id);
    const r = TIER_RANK[t];
    if (r > bestRank) {
      best = t;
      bestRank = r;
    }
  }
  return best;
}

function normalizeUsStateCode(state: string | undefined | null): string | null {
  if (state == null) return null;
  const t = state.trim();
  if (t.length === 0) return null;
  if (t.length === 2) return t.toUpperCase();
  return null;
}

export function getLocationMultiplier(location: { state?: string | null }): number {
  const code = normalizeUsStateCode(location.state ?? undefined);
  if (!code) return 1;
  return US_STATE_MULTIPLIER[code] ?? 1;
}

function clampUsdHourly(n: number): number {
  return Math.max(PLATFORM_MIN_JOB_BUDGET_HOURLY_USD, Math.round(n));
}

export type PlanningHourlyBand = { low: number; mid: number; high: number };

export function suggestPlanningHourlyUsd(params: {
  selectedRoleIds: string[];
  location?: { state?: string | null; city?: string | null };
}): PlanningHourlyBand {
  const tier = maxBudgetTierForRoles(params.selectedRoleIds);
  const mult = getLocationMultiplier(params.location ?? {});
  const b = TIER_LABOR_USD[tier];
  const platform = PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_USD;
  let low = clampUsdHourly(Math.round(b.low * mult) + platform);
  let mid = clampUsdHourly(Math.round(b.mid * mult) + platform);
  let high = clampUsdHourly(Math.round(b.high * mult) + platform);
  if (low > mid) mid = low;
  if (mid > high) high = mid;
  if (low > high) low = high;
  return { low, mid, high };
}

/**
 * Total budget (whole USD) when the user applies the suggested planning rate: buffered, never below minimum postable total.
 */
export function computeAppliedSuggestedBudgetUsd(params: {
  planningMidHourlyUsd: number;
  billableWorkerHours: number;
  buffer: number;
  minimumTotalUsd: number;
}): number {
  const { planningMidHourlyUsd, billableWorkerHours, buffer, minimumTotalUsd } = params;
  if (!(billableWorkerHours > 0) || !Number.isFinite(billableWorkerHours)) {
    return Math.max(0, Math.ceil(minimumTotalUsd));
  }
  const rawTotal = planningMidHourlyUsd * billableWorkerHours * buffer;
  const ceiled = Math.ceil(rawTotal);
  const minCeiled = Math.ceil(Math.max(0, minimumTotalUsd));
  return Math.max(ceiled, minCeiled);
}
