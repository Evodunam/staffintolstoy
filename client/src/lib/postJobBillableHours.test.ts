import { describe, it, expect } from "vitest";
import {
  computeBillableWorkerHours,
  hoursBetweenTimes,
  minimumLaborBudgetCentsForWorkerHours,
} from "@shared/postJobBillableHours";
import { PLATFORM_MIN_JOB_BUDGET_HOURLY_CENTS } from "@shared/platformPayPolicy";

describe("@shared/postJobBillableHours", () => {
  it("hoursBetweenTimes handles minutes", () => {
    expect(hoursBetweenTimes("09:00", "17:00")).toBe(8);
    expect(hoursBetweenTimes("09:30", "17:15")).toBeCloseTo(7.75);
  });

  it("one-day multiplies by workers", () => {
    const h = computeBillableWorkerHours({
      shiftType: "one-day",
      workersNeeded: 3,
      onDemandDate: "",
      onDemandDoneByDate: "",
      oneDaySchedule: { startTime: "09:00", endTime: "17:00" },
      recurringSchedule: { days: [], weeks: 1, startTime: "09:00", endTime: "17:00" },
      monthlySchedule: { days: [], startTime: "09:00", endTime: "17:00" },
      monthlyMonthsCount: 1,
    });
    expect(h).toBe(24);
  });

  it("minimumLaborBudgetCentsForWorkerHours rounds up cents", () => {
    expect(minimumLaborBudgetCentsForWorkerHours(10)).toBe(10 * PLATFORM_MIN_JOB_BUDGET_HOURLY_CENTS);
    expect(minimumLaborBudgetCentsForWorkerHours(10.1)).toBe(Math.ceil(10.1 * PLATFORM_MIN_JOB_BUDGET_HOURLY_CENTS));
  });
});
