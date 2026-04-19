import { db } from "../db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { safetyIncidents, profiles, jobs } from "@shared/schema";

/**
 * OSHA Form 300 — "Log of Work-Related Injuries and Illnesses".
 * Required by 29 CFR §1904.7 for most employers with >10 employees.
 *
 * One row per recordable incident in the calendar year. We generate
 * printable HTML directly from `safety_incidents` rows; the company prints
 * it for their on-site posting and OSHA inspection.
 *
 * NOT a substitute for OSHA's own e-recordkeeping submission process —
 * companies in covered industries with 250+ employees still file
 * electronically via the ITA portal.
 */

export interface Osha300Options {
  companyProfileId: number;
  year: number;
  /** Establishment name + address (defaults pulled from profile). */
  establishmentName?: string;
  establishmentAddress?: string;
}

export async function generateOsha300LogHtml(opts: Osha300Options): Promise<string> {
  const startOfYear = new Date(Date.UTC(opts.year, 0, 1));
  const endOfYear = new Date(Date.UTC(opts.year, 11, 31, 23, 59, 59));

  const incidents = await db.select()
    .from(safetyIncidents)
    .where(and(
      eq(safetyIncidents.companyProfileId, opts.companyProfileId),
      gte(safetyIncidents.occurredAt, startOfYear),
      lte(safetyIncidents.occurredAt, endOfYear),
    ));

  // Look up worker names + job titles for the rows in one batch each.
  const workerIds = Array.from(new Set(incidents.map((i) => i.workerProfileId).filter((x): x is number => !!x)));
  const jobIds = Array.from(new Set(incidents.map((i) => i.jobId).filter((x): x is number => !!x)));
  const workerMap = new Map<number, string>();
  const jobTitleMap = new Map<number, string>();
  if (workerIds.length > 0) {
    const ws = await db.select({ id: profiles.id, firstName: profiles.firstName, lastName: profiles.lastName })
      .from(profiles).where(inArray(profiles.id, workerIds));
    for (const w of ws) workerMap.set(w.id, [w.firstName, w.lastName].filter(Boolean).join(" ") || `Worker #${w.id}`);
  }
  if (jobIds.length > 0) {
    const js = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(inArray(jobs.id, jobIds));
    for (const j of js) jobTitleMap.set(j.id, j.title);
  }

  const [company] = await db.select({
    firstName: profiles.firstName,
    lastName: profiles.lastName,
    address: profiles.address,
    city: profiles.city,
    state: profiles.state,
    zipCode: profiles.zipCode,
  }).from(profiles).where(eq(profiles.id, opts.companyProfileId)).limit(1);

  const companyName = [company?.firstName, company?.lastName].filter(Boolean).join(" ");
  const establishment = opts.establishmentName || companyName || "[Establishment name]";
  const address = opts.establishmentAddress
    || [company?.address, company?.city, company?.state, company?.zipCode].filter(Boolean).join(", ")
    || "[Establishment address]";

  // Aggregate by classification type for the totals row at the bottom.
  let deathsCount = 0;
  let daysAwayCount = 0;
  let restrictedCount = 0;
  let otherCount = 0;
  for (const inc of incidents) {
    if (inc.severity === "fatality") deathsCount++;
    else if ((inc.daysAway ?? 0) > 0) daysAwayCount++;
    else if ((inc.daysRestricted ?? 0) > 0) restrictedCount++;
    else otherCount++;
  }

  const rowsHtml = incidents.map((inc, idx) => {
    const workerName = inc.workerProfileId ? (workerMap.get(inc.workerProfileId) ?? `Worker #${inc.workerProfileId}`) : "—";
    const jobTitle = inc.jobId ? (jobTitleMap.get(inc.jobId) ?? "—") : "—";
    const isFatal = inc.severity === "fatality";
    const hasDaysAway = (inc.daysAway ?? 0) > 0;
    const hasRestricted = (inc.daysRestricted ?? 0) > 0;
    const otherRecordable = !isFatal && !hasDaysAway && !hasRestricted;
    return `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(workerName)}</td>
      <td>${escapeHtml(jobTitle)}</td>
      <td>${inc.occurredAt ? new Date(inc.occurredAt as any).toLocaleDateString() : "—"}</td>
      <td>${escapeHtml(inc.locationDescription || "—")}</td>
      <td>${escapeHtml(inc.description || "—")}</td>
      <td style="text-align:center">${isFatal ? "✓" : ""}</td>
      <td style="text-align:center">${hasDaysAway ? "✓" : ""}</td>
      <td style="text-align:center">${hasRestricted ? "✓" : ""}</td>
      <td style="text-align:center">${otherRecordable ? "✓" : ""}</td>
      <td style="text-align:center">${inc.daysAway ?? 0}</td>
      <td style="text-align:center">${inc.daysRestricted ?? 0}</td>
    </tr>
  `;
  }).join("");

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8" />
  <title>OSHA Form 300 — ${escapeHtml(establishment)} (${opts.year})</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11px; padding: 24px; }
    h1 { font-size: 16px; margin-bottom: 4px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }
    th { background: #f0f0f0; text-align: left; }
    .footer { margin-top: 16px; font-size: 10px; color: #666; }
    .totals { background: #fafafa; font-weight: bold; }
    @media print { body { padding: 12px; } }
  </style>
</head><body>
  <h1>OSHA's Form 300 — Log of Work-Related Injuries and Illnesses</h1>
  <p>Year: <strong>${opts.year}</strong> &nbsp;·&nbsp; Establishment: <strong>${escapeHtml(establishment)}</strong></p>
  <p>Address: ${escapeHtml(address)}</p>
  <p style="font-size:10px;color:#555;">You must record information about every work-related injury or illness that involves loss of consciousness, restricted work activity or job transfer, days away from work, or medical treatment beyond first aid (29 CFR §1904.7).</p>
  <table>
    <thead>
      <tr>
        <th rowspan="2">Case<br/>No.</th>
        <th rowspan="2">Employee's name</th>
        <th rowspan="2">Job title</th>
        <th rowspan="2">Date of injury</th>
        <th rowspan="2">Where event occurred</th>
        <th rowspan="2">Describe injury or illness, parts of body affected, and object/substance that caused the injury</th>
        <th colspan="4">Classify the case</th>
        <th colspan="2">Days</th>
      </tr>
      <tr>
        <th>Death</th>
        <th>Days away</th>
        <th>Job transfer / restriction</th>
        <th>Other recordable</th>
        <th>Away from work</th>
        <th>On restricted duty</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || `<tr><td colspan="12" style="text-align:center;color:#888;padding:24px">No recordable incidents in ${opts.year}.</td></tr>`}
      <tr class="totals">
        <td colspan="6" style="text-align:right">Totals (page):</td>
        <td style="text-align:center">${deathsCount}</td>
        <td style="text-align:center">${daysAwayCount}</td>
        <td style="text-align:center">${restrictedCount}</td>
        <td style="text-align:center">${otherCount}</td>
        <td colspan="2"></td>
      </tr>
    </tbody>
  </table>
  <div class="footer">
    Generated by Tolstoy Staffing on ${new Date().toLocaleString()}.
    Retain this log for at least 5 years following the year it covers (29 CFR §1904.33).
  </div>
</body></html>`;
}

function escapeHtml(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

