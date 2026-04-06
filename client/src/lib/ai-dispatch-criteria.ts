/**
 * Pure helpers for AI Dispatch criteria. Used by WorkerDashboard and tested in ai-dispatch-criteria.test.ts.
 */

export interface JobLike {
  trade?: string | null;
  serviceCategory?: string | null;
  requiredSkills?: string[] | null;
}

/** True if the job requires a Lite/Elite skill (Electrical, Plumbing, HVAC, Carpentry). Those jobs always require a skill match. */
export function jobRequiresLiteOrElite(job: JobLike): boolean {
  const terms = [
    job.trade ?? "",
    job.serviceCategory ?? "",
    ...(job.requiredSkills ?? []),
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return terms.some((t) => t.includes("lite") || t.includes("elite"));
}

/** True if the worker's skills match the job (trade, serviceCategory, or requiredSkills). */
export function checkSkillMatch(
  personSkills: string[] | null | undefined,
  job: JobLike
): boolean {
  const skills = (personSkills ?? []).filter((s) => typeof s === "string" && s.trim().length > 0);
  if (skills.length === 0) return false;
  const jobTrade = (job.trade ?? "").toLowerCase();
  const jobCategory = (job.serviceCategory ?? "").toLowerCase();
  const jobSkills = (job.requiredSkills ?? [])
    .map((s) => String(s).toLowerCase().trim())
    .filter((s) => s.length > 0);

  return skills.some((skill) => {
    const skillLower = skill.toLowerCase().trim();
    if (!skillLower) return false;
    return (
      (jobTrade.length > 0 && (jobTrade.includes(skillLower) || skillLower.includes(jobTrade))) ||
      (jobCategory.length > 0 && (jobCategory.includes(skillLower) || skillLower.includes(jobCategory))) ||
      jobSkills.some(
        (js) => js.length > 0 && (js.includes(skillLower) || skillLower.includes(js))
      )
    );
  });
}
