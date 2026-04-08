import type { PostJobDraft } from "@/hooks/use-post-job-draft";

/** True when the in-memory post job form has enough content that a "resume draft" banner is useful. */
export function isSubstantivePostJobFormState(args: {
  step: number;
  jobDescription: string;
  selectedSkillsets: string[];
  companyJobTitle: string;
  selectedLocationId: number | null;
  mediaCount: number;
  shiftType: string | null;
}): boolean {
  if (args.step >= 2) return true;
  if (args.selectedLocationId != null) return true;
  if (args.shiftType != null) return true;
  if (args.jobDescription.trim().length >= 15) return true;
  if (args.selectedSkillsets.length > 0) return true;
  if (args.companyJobTitle.trim().length > 0) return true;
  if (args.mediaCount > 0) return true;
  return false;
}

/** Draft on disk is worth keeping / showing (e.g. after refresh before React state hydrates). */
export function isSubstantiveStoredDraft(d: PostJobDraft | null | undefined): boolean {
  if (!d) return false;
  if (d.step >= 2) return true;
  if (d.selectedLocationId != null) return true;
  if (d.shiftType != null) return true;
  if ((d.jobDescription || "").trim().length >= 15) return true;
  if ((d.selectedSkillsets || []).length > 0) return true;
  if ((d.companyJobTitle || "").trim().length > 0) return true;
  if ((d.mediaPermanentUrls || []).length > 0) return true;
  return false;
}

/** Selected location must be in the list returned for this user (teammates may be scoped). */
export function isDraftLocationAllowedForVisibleLocations(
  selectedLocationId: number | null,
  visibleLocationIds: Set<number>
): boolean {
  if (selectedLocationId == null) return true;
  return visibleLocationIds.has(selectedLocationId);
}
