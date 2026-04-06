/** Seeded / internal E2E job titles in DB — never show raw to users. */
export function isE2EFlowJobTitle(raw: string | null | undefined): boolean {
  const t = (raw || "").trim();
  if (!t) return false;
  return /^e2e\s+flow\s+\d+/i.test(t);
}

/**
 * Human-facing title from raw DB title + optional trade.
 * Collapses seeded E2E job names into "{trade} Assignment".
 */
export function displayJobTitle(rawTitle?: string | null, trade?: string | null): string {
  const raw = (rawTitle || "").trim();
  if (!raw) return "Job";
  if (isE2EFlowJobTitle(raw)) {
    const tr = (trade || "General Labor").trim() || "General Labor";
    return `${tr} Assignment`;
  }
  return raw;
}

export function getDisplayJobTitle(job: { title?: string | null; trade?: string | null }): string {
  return displayJobTitle(job.title, job.trade);
}
