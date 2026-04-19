import { db } from "../db";
import { eq, and, gte, lte } from "drizzle-orm";
import { safetyIncidents, profiles } from "@shared/schema";

/**
 * OSHA Form 300A — "Summary of Work-Related Injuries and Illnesses".
 * Required by 29 CFR §1904.32. Must be posted in a visible location at the
 * establishment from February 1 to April 30 of the year following the
 * year covered by the data, and certified by an executive.
 *
 * This generator produces a printable HTML summary aggregated from the
 * `safety_incidents` rows for the given company + year. The certification
 * signature line is left blank for handwritten exec signature.
 */

export interface Osha300AOptions {
  companyProfileId: number;
  year: number;
  /** Used in the establishment-info header. Defaults to the profile's name. */
  establishmentName?: string;
  establishmentAddress?: string;
  /** Optional NAICS classification + total hours worked + average employees;
   *  required on the official form. Caller supplies if known. */
  naicsCode?: string;
  totalHoursWorked?: number;
  averageEmployees?: number;
}

export async function generateOsha300ASummaryHtml(opts: Osha300AOptions): Promise<string> {
  const startOfYear = new Date(Date.UTC(opts.year, 0, 1));
  const endOfYear = new Date(Date.UTC(opts.year, 11, 31, 23, 59, 59));

  const incidents = await db.select()
    .from(safetyIncidents)
    .where(and(
      eq(safetyIncidents.companyProfileId, opts.companyProfileId),
      gte(safetyIncidents.occurredAt, startOfYear),
      lte(safetyIncidents.occurredAt, endOfYear),
    ));

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

  // Counts per OSHA 300A boxes (numbers (G)-(J) on the official form).
  let deaths = 0;
  let casesDaysAway = 0;
  let casesJobTransferOnly = 0;
  let otherRecordableCases = 0;
  // Totals per (K)-(L).
  let totalDaysAway = 0;
  let totalDaysRestricted = 0;
  // Per-injury-type breakdown (boxes M(1)-(6)).
  const byType: Record<string, number> = {
    injuries: 0, skin: 0, respiratory: 0, poisoning: 0, hearing: 0, allOtherIllnesses: 0,
  };
  for (const inc of incidents) {
    const sev = inc.severity;
    const daysAway = inc.daysAway ?? 0;
    const daysRest = inc.daysRestricted ?? 0;
    if (sev === "fatality") deaths++;
    else if (daysAway > 0) casesDaysAway++;
    else if (daysRest > 0) casesJobTransferOnly++;
    else otherRecordableCases++;
    totalDaysAway += daysAway;
    totalDaysRestricted += daysRest;
    // Coarse mapping of injury_type → 300A category. Most physical injuries
    // are "injuries"; chemical/heat/cold/electrical map to illness categories.
    switch (inc.injuryType) {
      case "chemical": byType.poisoning++; break;
      case "heat_illness":
      case "cold_illness": byType.allOtherIllnesses++; break;
      default: byType.injuries++;
    }
  }
  const totalCases = deaths + casesDaysAway + casesJobTransferOnly + otherRecordableCases;

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8" />
  <title>OSHA Form 300A — ${escapeHtml(establishment)} (${opts.year})</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; padding: 24px; max-width: 850px; margin: 0 auto; }
    h1 { font-size: 18px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin: 12px 0; }
    .meta div { padding: 4px 0; border-bottom: 1px solid #ccc; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }
    .box { border: 1px solid #333; padding: 8px; text-align: center; }
    .box .num { font-size: 24px; font-weight: bold; }
    .box .label { font-size: 10px; color: #555; }
    .totals { margin-top: 16px; font-size: 13px; }
    .cert { margin-top: 32px; border-top: 2px solid #333; padding-top: 14px; }
    .cert .sig-line { border-bottom: 1px solid #333; height: 28px; margin: 12px 0 4px; }
    @media print { body { padding: 12px; } }
  </style>
</head><body>
  <h1>OSHA's Form 300A — Summary of Work-Related Injuries and Illnesses</h1>
  <p style="font-size:11px;color:#555;">Year ${opts.year}. Establishments covered by 29 CFR Part 1904 must post this summary from February 1 to April 30 of the following year.</p>

  <div class="meta">
    <div><strong>Establishment:</strong> ${escapeHtml(establishment)}</div>
    <div><strong>Address:</strong> ${escapeHtml(address)}</div>
    <div><strong>Industry (NAICS):</strong> ${escapeHtml(opts.naicsCode || "—")}</div>
    <div><strong>Annual avg # employees:</strong> ${opts.averageEmployees ?? "—"}</div>
    <div><strong>Total hours worked:</strong> ${opts.totalHoursWorked?.toLocaleString() ?? "—"}</div>
    <div><strong>Total recordable cases:</strong> ${totalCases}</div>
  </div>

  <h3>Number of Cases</h3>
  <div class="grid">
    <div class="box"><div class="num">${casesDaysAway}</div><div class="label">(G) Cases with days away from work</div></div>
    <div class="box"><div class="num">${casesJobTransferOnly}</div><div class="label">(H) Cases with job transfer or restriction</div></div>
    <div class="box"><div class="num">${otherRecordableCases}</div><div class="label">(I) Other recordable cases</div></div>
    <div class="box"><div class="num">${deaths}</div><div class="label">(J) Total deaths</div></div>
  </div>

  <h3 style="margin-top:24px">Number of Days</h3>
  <div class="grid" style="grid-template-columns: 1fr 1fr;">
    <div class="box"><div class="num">${totalDaysAway}</div><div class="label">(K) Total days away from work</div></div>
    <div class="box"><div class="num">${totalDaysRestricted}</div><div class="label">(L) Total days of job transfer/restriction</div></div>
  </div>

  <h3 style="margin-top:24px">Injury and Illness Types</h3>
  <div class="grid" style="grid-template-columns: repeat(3, 1fr);">
    <div class="box"><div class="num">${byType.injuries}</div><div class="label">(M-1) Injuries</div></div>
    <div class="box"><div class="num">${byType.skin}</div><div class="label">(M-2) Skin disorders</div></div>
    <div class="box"><div class="num">${byType.respiratory}</div><div class="label">(M-3) Respiratory conditions</div></div>
    <div class="box"><div class="num">${byType.poisoning}</div><div class="label">(M-4) Poisonings</div></div>
    <div class="box"><div class="num">${byType.hearing}</div><div class="label">(M-5) Hearing loss</div></div>
    <div class="box"><div class="num">${byType.allOtherIllnesses}</div><div class="label">(M-6) All other illnesses</div></div>
  </div>

  <div class="cert">
    <p style="font-size:11px;">
      I certify that I have examined this document and that to the best of my knowledge the entries are true, accurate, and complete.
    </p>
    <div class="sig-line"></div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;font-size:10px;color:#555;">
      <div>Company executive name and title</div>
      <div>Signature</div>
      <div>Date</div>
    </div>
  </div>

  <p style="margin-top:32px;font-size:10px;color:#666;">
    Generated by Tolstoy Staffing on ${new Date().toLocaleString()}.
    Retain for at least 5 years (29 CFR §1904.33).
  </p>
</body></html>`;
}

function escapeHtml(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

