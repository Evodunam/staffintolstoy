import { describe, it, expect } from "vitest";
import {
  validateAutoFulfillJobPayload,
  evaluateAutoFulfillAccept,
  applyAutoFulfillLegalAck,
} from "./autoFulfill";
import { AUTO_FULFILL_LEGAL_VERSION } from "@shared/autoFulfillLegal";

describe("autoFulfill", () => {
  it("validate rejects custom window without dates", () => {
    const err = validateAutoFulfillJobPayload({
      autoFulfillEnabled: true,
      autoFulfillBudgetWindow: "custom",
      autoFulfillBudgetCents: 50000,
      estimatedHours: 10,
    } as any);
    expect(err).toContain("autoFulfillWindowStart");
  });

  it("validate rejects labor budget below platform floor for known hours", () => {
    const err = validateAutoFulfillJobPayload({
      autoFulfillEnabled: true,
      autoFulfillBudgetWindow: "one_day",
      autoFulfillBudgetCents: 1000,
      estimatedHours: 10,
    } as any);
    expect(err).toContain("minimum");
  });

  it("validate rejects max hourly below platform floor", () => {
    const err = validateAutoFulfillJobPayload({
      autoFulfillEnabled: true,
      autoFulfillBudgetWindow: "weekly",
      autoFulfillBudgetCents: 500_000,
      estimatedHours: 10,
      autoFulfillMaxHourlyCents: 1000,
    } as any);
    expect(err).toContain("autoFulfillMaxHourlyCents");
  });

  it("applyAutoFulfillLegalAck sets version and timestamp", () => {
    const j = applyAutoFulfillLegalAck(
      { autoFulfillEnabled: true, autoFulfillBudgetCents: 100 } as any,
      true
    );
    expect(j.autoFulfillLegalAckVersion).toBe(AUTO_FULFILL_LEGAL_VERSION);
    expect(j.autoFulfillLegalAckAt).toBeInstanceOf(Date);
  });

  it("evaluate accepts when rules pass", () => {
    const job = applyAutoFulfillLegalAck(
      {
        autoFulfillEnabled: true,
        autoFulfillBudgetCents: 50000,
        autoFulfillBudgetWindow: "weekly",
        estimatedHours: 10,
        hourlyRate: 4000,
        maxWorkersNeeded: 1,
        status: "open",
      } as any,
      true
    );
    const worker = {
      averageRating: "4.8",
      totalReviews: 5,
    } as any;
    const r = evaluateAutoFulfillAccept({
      job: job as any,
      worker,
      proposedRateCents: 4000,
      acceptedApplicationCount: 0,
    });
    expect(r.accept).toBe(true);
  });

  it("evaluate rejects rate above derived max", () => {
    const job = applyAutoFulfillLegalAck(
      {
        autoFulfillEnabled: true,
        autoFulfillBudgetCents: 10000,
        autoFulfillBudgetWindow: "one_day",
        autoFulfillExpectedHours: "2",
        hourlyRate: 9000,
        maxWorkersNeeded: 1,
        status: "open",
      } as any,
      true
    );
    const worker = { averageRating: "5", totalReviews: 10 } as any;
    const r = evaluateAutoFulfillAccept({
      job: job as any,
      worker,
      proposedRateCents: 9000,
      acceptedApplicationCount: 0,
    });
    expect(r.accept).toBe(false);
    expect(r.reason).toBe("rate_above_max");
  });

  it("evaluate rejects below min rating when configured", () => {
    const job = applyAutoFulfillLegalAck(
      {
        autoFulfillEnabled: true,
        autoFulfillBudgetCents: 50000,
        autoFulfillBudgetWindow: "weekly",
        estimatedHours: 10,
        hourlyRate: 4000,
        autoFulfillMinWorkerRating: "4.9",
        autoFulfillMinWorkerReviews: 3,
        maxWorkersNeeded: 1,
        status: "open",
      } as any,
      true
    );
    const worker = { averageRating: "4.0", totalReviews: 10 } as any;
    const r = evaluateAutoFulfillAccept({
      job: job as any,
      worker,
      proposedRateCents: 4000,
      acceptedApplicationCount: 0,
    });
    expect(r.accept).toBe(false);
    expect(r.reason).toBe("below_min_rating");
  });
});
