/**
 * Wage Theft Prevention Act notices.
 *
 * Several states require employers (and many courts treat marketplace
 * platforms as joint employers for this purpose) to give workers a written
 * notice at hire detailing pay rate, pay schedule, employer info, and the
 * worker's rights. This module returns printable HTML for the major regimes:
 *
 *   - California Labor Code §2810.5 — required at start of employment AND
 *     within 7 days of any change. Bilingual when applicable. Penalty up to
 *     $50/violation × employee count.
 *   - New York Labor Law §195.1 — required at hire and again whenever pay
 *     rate or pay day changes. $50/employee/workweek not given, capped $5k.
 *   - Washington RCW 49.46.020 — pay-rate disclosure required.
 *   - Massachusetts G.L. c.149, §148B / 159C — independent contractor notice.
 *
 * The notice is rendered HTML (printable), saved to object storage at hire
 * time, and acknowledged by the worker via signature. The acknowledgment ID
 * is stored on the timesheet/job for audit trail.
 */
import { db } from "../db";
import { eq } from "drizzle-orm";
import { jobs, profiles } from "@shared/schema";
import { getMinimumWageUsd } from "@shared/wageCompliance";

const moneyUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type NoticeRegime = "CA_2810_5" | "NY_195_1" | "WA_RCW_49_46" | "MA_148B" | "GENERIC";

export function noticeRegimeForState(state: string | null | undefined): NoticeRegime {
  const s = (state || "").trim().toUpperCase();
  if (s === "CA" || s === "CALIFORNIA") return "CA_2810_5";
  if (s === "NY" || s === "NEW YORK") return "NY_195_1";
  if (s === "WA" || s === "WASHINGTON") return "WA_RCW_49_46";
  if (s === "MA" || s === "MASSACHUSETTS") return "MA_148B";
  return "GENERIC";
}

export interface WageTheftNoticeArgs {
  jobId: number;
  workerId: number;
}

export async function buildWageTheftNoticeHtml(args: WageTheftNoticeArgs): Promise<string | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, args.jobId)).limit(1);
  const [worker] = await db.select().from(profiles).where(eq(profiles.id, args.workerId)).limit(1);
  if (!job || !worker) return null;
  const [company] = await db.select().from(profiles).where(eq(profiles.id, job.companyId)).limit(1);
  if (!company) return null;

  const regime = noticeRegimeForState(job.state);
  const workerName = `${worker.firstName ?? ""} ${worker.lastName ?? ""}`.trim();
  const companyName = company.companyName || `${company.firstName ?? ""} ${company.lastName ?? ""}`.trim();
  const companyAddress = company.address ? [company.address, company.city, company.state, company.zipCode].filter(Boolean).join(", ") : "(address on file)";
  const jobsiteAddress = [job.address, job.city, job.state, job.zipCode].filter(Boolean).join(", ");
  const rateUsd = (job.hourlyRate ?? 0) / 100;
  const minWage = getMinimumWageUsd({ state: job.state, city: job.city });

  const regimeBlock = (() => {
    switch (regime) {
      case "CA_2810_5":
        return `<h2>California Labor Code §2810.5 Wage Notice</h2>
<p class="small">This Notice is provided pursuant to California Labor Code §2810.5. You may report any concerns about wage practices to the California Labor Commissioner's Office at <strong>1-833-LCO-INFO</strong> or <a href="https://www.dir.ca.gov/dlse/">dir.ca.gov/dlse</a>.</p>`;
      case "NY_195_1":
        return `<h2>New York Labor Law §195.1 Notice and Acknowledgement of Pay Rate</h2>
<p class="small">This Notice is provided pursuant to New York Labor Law §195.1. You may file a complaint with the NY Department of Labor at <a href="https://dol.ny.gov">dol.ny.gov</a> if you believe these terms have not been honored.</p>`;
      case "WA_RCW_49_46":
        return `<h2>Washington RCW 49.46 Pay-Rate Disclosure</h2>
<p class="small">This disclosure is provided pursuant to Washington's Wage Payment Act. Concerns may be reported to L&amp;I at <a href="https://lni.wa.gov">lni.wa.gov</a>.</p>`;
      case "MA_148B":
        return `<h2>Massachusetts G.L. c.149 §148B Independent Contractor Notice</h2>
<p class="small">You are engaged as an independent contractor. The hiring entity does not withhold federal/state income tax, FICA, Medicare, or unemployment from your pay; you are responsible for self-employment tax. Concerns may be reported to the Office of the Attorney General at <a href="https://www.mass.gov/orgs/office-of-the-attorney-general">mass.gov/ago</a>.</p>`;
      default:
        return `<h2>Wage Notice and Acknowledgement</h2>
<p class="small">This notice provides the basic terms of your engagement. Some states require this disclosure by law (e.g. CA Labor Code §2810.5, NY Labor Law §195.1).</p>`;
    }
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Wage Notice — ${escapeHtml(companyName)} → ${escapeHtml(workerName)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:24px;color:#111;background:#fff}
  .doc{max-width:760px;margin:0 auto;border:1px solid #ddd;padding:24px}
  h1{margin:0 0 4px;font-size:20px}
  h2{font-size:16px;margin:16px 0 6px}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  th,td{padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:left;vertical-align:top;font-size:14px}
  th{background:#f9fafb;font-weight:600;width:40%}
  .small{font-size:11px;color:#6b7280;line-height:1.5}
  .sig{margin-top:24px;border-top:1px solid #d1d5db;padding-top:16px}
  .sig-line{border-bottom:1px solid #111;display:inline-block;min-width:280px;height:24px}
  @media print{body{padding:0}.doc{border:0}}
</style>
</head>
<body>
<div class="doc">
  <h1>Notice of Pay Terms — Independent Contractor Engagement</h1>
  <p class="small">Issued: ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })} · Job #${job.id}</p>

  ${regimeBlock}

  <h2>1. Hiring entity</h2>
  <table>
    <tr><th>Legal name</th><td>${escapeHtml(companyName)}</td></tr>
    <tr><th>"Doing business as"</th><td>${escapeHtml(company.companyName || companyName)}</td></tr>
    <tr><th>Physical address</th><td>${escapeHtml(companyAddress)}</td></tr>
    <tr><th>Phone</th><td>${escapeHtml(company.phone ?? "")}</td></tr>
    <tr><th>Marketplace operator</th><td>Tolstoy Staffing — support@tolstoystaffing.com — billing &amp; payouts only; not the hiring entity.</td></tr>
  </table>

  <h2>2. Worker</h2>
  <table>
    <tr><th>Name</th><td>${escapeHtml(workerName)}</td></tr>
    <tr><th>Engagement type</th><td>Independent contractor (1099-NEC).</td></tr>
  </table>

  <h2>3. Pay terms</h2>
  <table>
    <tr><th>Hourly rate</th><td><strong>${moneyUsd(job.hourlyRate ?? 0)}/hour</strong></td></tr>
    <tr><th>Overtime rate(s)</th><td>1.5× regular rate over the applicable daily/weekly threshold; 2.0× where state law (e.g. CA) requires double-time.</td></tr>
    <tr><th>Minimum wage at jobsite</th><td>${moneyUsd(Math.ceil(minWage * 100))}/hour (${escapeHtml(job.city ?? "")}, ${escapeHtml(job.state ?? "")})</td></tr>
    <tr><th>Payment schedule</th><td>Within 7 calendar days of timesheet approval, by ACH to your linked bank account on file.</td></tr>
    <tr><th>Method</th><td>ACH to bank account verified by Mercury via Plaid.</td></tr>
    <tr><th>Allowances claimed</th><td>None. The hiring entity does not claim meal, lodging, or other credits against the rate.</td></tr>
  </table>

  <h2>4. Jobsite</h2>
  <table>
    <tr><th>Address</th><td>${escapeHtml(jobsiteAddress)}</td></tr>
    <tr><th>Job title</th><td>${escapeHtml(job.title ?? "")}</td></tr>
  </table>

  <h2>5. Worker rights</h2>
  <ul class="small">
    <li>You are entitled to be paid at least the local minimum wage for every hour worked.</li>
    <li>You may file a wage claim with your state labor agency without retaliation. Retaliation is unlawful.</li>
    <li>You may request itemized statements of every shift's hours and pay at any time.</li>
    <li>You may revoke consent to electronic communications and request paper notice instead.</li>
  </ul>

  <div class="sig">
    <h2>Acknowledgement</h2>
    <p class="small">By electronically accepting this engagement on the Tolstoy Staffing platform, the worker acknowledges receipt of this Notice. The platform records the acknowledgment timestamp and stores this PDF for the duration required by applicable state law.</p>
    <p>Worker signature: <span class="sig-line">&nbsp;</span></p>
    <p>Date: <span class="sig-line" style="min-width:180px">&nbsp;</span></p>
  </div>
</div>
</body>
</html>`;
}
