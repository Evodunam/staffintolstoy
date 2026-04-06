import { describe, expect, it } from "vitest";
import { displayJobTitle, getDisplayJobTitle } from "./job-display";

describe("getDisplayJobTitle", () => {
  it("maps E2E Flow seed titles to trade assignment", () => {
    expect(
      getDisplayJobTitle({ title: "E2E Flow 1773804371250", trade: "Plumbing" })
    ).toBe("Plumbing Assignment");
  });

  it("uses General Labor when trade missing", () => {
    expect(getDisplayJobTitle({ title: "E2E Flow 1", trade: "" })).toBe("General Labor Assignment");
  });

  it("matches E2E titles with leading/trailing whitespace", () => {
    expect(displayJobTitle("  E2E Flow 1773935050859  ", "Electrical")).toBe("Electrical Assignment");
  });

  it("leaves normal titles unchanged", () => {
    expect(getDisplayJobTitle({ title: "Fix leak", trade: "Plumbing" })).toBe("Fix leak");
  });
});
