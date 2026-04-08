import { describe, it, expect } from "vitest";
import {
  computeAppliedSuggestedBudgetUsd,
  getLocationMultiplier,
  getRoleBudgetTier,
  maxBudgetTierForRoles,
  suggestPlanningHourlyUsd,
} from "@shared/suggestedBudgetPlanning";
import {
  PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_USD,
  PLATFORM_MIN_JOB_BUDGET_HOURLY_USD,
} from "@shared/platformPayPolicy";

describe("@shared/suggestedBudgetPlanning", () => {
  it("Laborer maps to labor_floor", () => {
    expect(getRoleBudgetTier("Laborer")).toBe("labor_floor");
  });

  it("unknown role id defaults to labor_floor", () => {
    expect(getRoleBudgetTier("Future Role XYZ")).toBe("labor_floor");
  });

  it("max tier wins for mixed roles", () => {
    expect(maxBudgetTierForRoles(["Laborer", "Plumbing Elite"])).toBe("trade_elite");
  });

  it("company-facing band includes fixed platform $/hr after COL on labor component", () => {
    const neutral = suggestPlanningHourlyUsd({ selectedRoleIds: ["Laborer"], location: { state: "ZZ" } });
    // labor_floor mid labor 17 * 1 + 13 = 30
    expect(neutral.mid).toBe(17 + PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_USD);
  });

  it("CA raises band vs default state", () => {
    const base = suggestPlanningHourlyUsd({ selectedRoleIds: ["Laborer"], location: { state: "XX" } });
    const ca = suggestPlanningHourlyUsd({ selectedRoleIds: ["Laborer"], location: { state: "CA" } });
    expect(ca.mid).toBeGreaterThanOrEqual(base.mid);
    expect(ca.mid).toBeGreaterThanOrEqual(PLATFORM_MIN_JOB_BUDGET_HOURLY_USD);
  });

  it("Plumbing Elite in CA is above Laborer in MS", () => {
    const lowColLaborer = suggestPlanningHourlyUsd({ selectedRoleIds: ["Laborer"], location: { state: "MS" } });
    const highTrade = suggestPlanningHourlyUsd({
      selectedRoleIds: ["Plumbing Elite"],
      location: { state: "CA" },
    });
    expect(highTrade.mid).toBeGreaterThan(lowColLaborer.mid);
  });

  it("getLocationMultiplier trims 2-letter state", () => {
    expect(getLocationMultiplier({ state: " ca " })).toBe(getLocationMultiplier({ state: "CA" }));
    expect(getLocationMultiplier({ state: "ZZ" })).toBe(1);
  });

  it("computeAppliedSuggestedBudgetUsd applies buffer and floor to minimum", () => {
    const min = 280;
    expect(
      computeAppliedSuggestedBudgetUsd({
        planningMidHourlyUsd: 28,
        billableWorkerHours: 10,
        buffer: 1.1,
        minimumTotalUsd: min,
      })
    ).toBe(Math.max(Math.ceil(28 * 10 * 1.1), Math.ceil(min)));
  });
});
