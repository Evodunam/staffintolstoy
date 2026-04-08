import { describe, expect, it } from "vitest";
import {
  PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_CENTS,
  workerFacingJobHourlyCents,
} from "./platformPayPolicy";

describe("workerFacingJobHourlyCents", () => {
  it("subtracts platform job budget per worker-hour from billable cents", () => {
    expect(workerFacingJobHourlyCents(2800)).toBe(2800 - PLATFORM_JOB_BUDGET_PER_WORKER_HOUR_CENTS);
  });

  it("returns 0 for null, non-finite, or non-positive", () => {
    expect(workerFacingJobHourlyCents(null)).toBe(0);
    expect(workerFacingJobHourlyCents(undefined)).toBe(0);
    expect(workerFacingJobHourlyCents(0)).toBe(0);
    expect(workerFacingJobHourlyCents(-100)).toBe(0);
  });

  it("floors at 0 when billable is below fee (legacy / bad data)", () => {
    expect(workerFacingJobHourlyCents(500)).toBe(0);
  });
});
