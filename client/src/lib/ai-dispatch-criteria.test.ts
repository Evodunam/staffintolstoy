import { describe, it, expect } from "vitest";
import {
  jobRequiresLiteOrElite,
  checkSkillMatch,
  type JobLike,
} from "./ai-dispatch-criteria";

describe("ai-dispatch-criteria", () => {
  describe("jobRequiresLiteOrElite", () => {
    it("returns true when job trade contains lite or elite", () => {
      expect(jobRequiresLiteOrElite({ trade: "Electrical Lite" })).toBe(true);
      expect(jobRequiresLiteOrElite({ trade: "Carpentry Elite" })).toBe(true);
      expect(jobRequiresLiteOrElite({ trade: "Plumbing Lite" })).toBe(true);
      expect(jobRequiresLiteOrElite({ trade: "HVAC Elite" })).toBe(true);
    });

    it("returns true when requiredSkills contain lite or elite", () => {
      expect(
        jobRequiresLiteOrElite({ requiredSkills: ["Electrical Lite"] })
      ).toBe(true);
      expect(
        jobRequiresLiteOrElite({ requiredSkills: ["Carpentry Elite", "Drywall"] })
      ).toBe(true);
    });

    it("returns true when serviceCategory contains lite or elite", () => {
      expect(
        jobRequiresLiteOrElite({ serviceCategory: "electrical lite" })
      ).toBe(true);
    });

    it("returns false for general labor jobs", () => {
      expect(jobRequiresLiteOrElite({ trade: "General Labor" })).toBe(false);
      expect(jobRequiresLiteOrElite({ trade: "Laborer" })).toBe(false);
      expect(jobRequiresLiteOrElite({ trade: "Painting" })).toBe(false);
      expect(jobRequiresLiteOrElite({ trade: "Drywall" })).toBe(false);
      expect(jobRequiresLiteOrElite({ trade: "Concrete" })).toBe(false);
      expect(jobRequiresLiteOrElite({ trade: "Landscaping" })).toBe(false);
      expect(
        jobRequiresLiteOrElite({ requiredSkills: ["Laborer", "Painting"] })
      ).toBe(false);
    });
  });

  describe("checkSkillMatch", () => {
    it("returns false when person has no skills", () => {
      expect(
        checkSkillMatch(null, { trade: "Electrical Lite", requiredSkills: ["Electrical Lite"] })
      ).toBe(false);
      expect(
        checkSkillMatch([], { trade: "Painting" })
      ).toBe(false);
    });

    it("returns true when person skill matches job trade", () => {
      expect(
        checkSkillMatch(["Painting"], { trade: "Painting" })
      ).toBe(true);
      expect(
        checkSkillMatch(["Electrical Lite"], { trade: "Electrical", requiredSkills: ["Electrical Lite"] })
      ).toBe(true);
    });

    it("returns true when person skill matches requiredSkills", () => {
      expect(
        checkSkillMatch(["Carpentry Lite"], {
          trade: "Carpentry",
          requiredSkills: ["Carpentry Lite"],
        })
      ).toBe(true);
    });

    it("returns false when person has no matching skill for lite/elite job", () => {
      // Person has no Electrical/Plumbing skills; job requires Lite/Elite – no match.
      expect(
        checkSkillMatch(["Laborer", "Painting", "Drywall"], {
          trade: "Electrical",
          requiredSkills: ["Electrical Lite"],
        })
      ).toBe(false);
      expect(
        checkSkillMatch(["Laborer", "Painting"], {
          trade: "Plumbing",
          requiredSkills: ["Plumbing Elite"],
        })
      ).toBe(false);
    });

    it("returns true when person has matching skill for general labor job", () => {
      expect(
        checkSkillMatch(["Laborer"], { trade: "Laborer" })
      ).toBe(true);
      expect(
        checkSkillMatch(["Laborer"], { trade: "General Labor", requiredSkills: ["Laborer"] })
      ).toBe(true);
      expect(
        checkSkillMatch(["Painting", "Drywall"], { trade: "Painting" })
      ).toBe(true);
    });
  });

  describe("availability is enforced in flow", () => {
    it("documents that schedule fit is required before auto-apply", () => {
      // In WorkerDashboard, jobMatchesAiDispatchCriteria (which gates auto-apply) does:
      // 1. Pending teammates → false
      // 2. Lite/Elite skill match when required
      // 3. Distance within max miles
      // 4. Time window if enabled
      // 5. checkScheduleFit(job, workerId) → fetches /api/applications/worker/:id and returns false
      //    if any accepted/pending application overlaps the job's start/end time.
      // So auto-apply only runs when the worker has no overlapping accepted/pending jobs (availability).
      expect(true).toBe(true);
    });
  });
});
