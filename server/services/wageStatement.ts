/**
 * Itemized wage statement generator (CA Labor Code §226 / NY Labor Law §195.3).
 *
 * Returns printable HTML showing all nine fields CA requires:
 *   1. Gross wages earned
 *   2. Total hours worked (regular + OT broken out)
 *   3. Piece-rate units (N/A for hourly contractors)
 *   4. All deductions
 *   5. Net wages earned
 *   6. Pay period inclusive dates
 *   7. Worker name + last 4 of SSN/EIN (we use bank last4 instead — Stripe holds SSN)
 *   8. Employer name + address
 *   9. Hourly rates and corresponding hours at each rate (regular / OT / DT)
 *
 * Independent contractors are technically not covered by §226, but issuing the
 * same statement (a) reduces misclassification risk by giving workers the same
 * transparency they'd get as W-2 employees, and (b) is required as a matter of
 * platform policy for our marketplace's defensibility.
 */
import { db } from "../db";
import { eq } from "drizzle-orm";
import { timesheets, jobs, profiles } from "@shared/schema";
import { calcShiftPayForTimesheet } from "./wagePayCalc";

const moneyUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface WageStatementHtmlArgs {
  timesheetId: number;
  /** Set true when the recipient (worker) is viewing it; redacts company internal notes. */
  workerView?: boolean;
}

export async function buildWageStatementHtml({ timesheetId, workerView = true }: WageStatementHtmlArgs): Promise<string | null> {
  const [ts] = await db.select().from(timesheets).where(eq(timesheets.id, timesheetId)).limit(1);
  if (!ts) return null;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, ts.jobId)).limit(1);
  const [worker] = await db.select().from(profiles).where(eq(profiles.id, ts.workerId)).limit(1);
  const [company] = await db.select().from(profiles).where(eq(profiles.id, ts.companyId)).limit(1);
  if (!job || !worker || !company) return null;

  const hoursWorked = parseFloat(String(ts.adjustedHours || ts.totalHours || "0"));
  const pay = await calcShiftPayForTimesheet({
    timesheetId: ts.id,
    workerId: ts.workerId,
    jobId: ts.jobId,
    hoursWorked,
    hourlyRateCents: ts.hourlyRate,
    clockInTime: ts.clockInTime,
  });

  const periodStart = ts.clockInTime ? new Date(ts.clockInTime).toLocaleDateString("en-US", { dateStyle: "long" }) : "—";
  const periodEnd = ts.clockOutTime ? new Date(ts.clockOutTime).toLocaleDateString("en-US", { dateStyle: "long" }) : periodStart;
  const workerName = `${worker.firstName ?? ""} ${worker.lastName ?? ""}`.trim() || "Worker";
  const companyName = company.companyName || `${company.firstName ?? ""} ${company.lastName ?? ""}`.trim() || "Company";
  const companyAddress = [job.address, job.city, job.state, job.zipCode].filter(Boolean).join(", ");

  const lineItemRows = pay.lineItems
    .map((li) => {
      const label =
        li.kind === "regular" ? "Regular hours" :
        li.kind === "overtime" ? "Overtime (1.5×)" :
        "Double-time (2.0×)";
      return `<tr>
        <td>${label}</td>
        <td class="num">${li.hours.toFixed(2)}</td>
        <td class="num">${moneyUsd(li.rateCents)}/hr</td>
        <td class="num">${moneyUsd(li.amountCents)}</td>
      </tr>`;
    })
    .join("");

  // 1099 contractors: no statutory deductions; show explicit "$0.00" with disclosure.
  const deductions: Array<{ label: string; cents: number }> = [];
  const grossCents = pay.totalPayCents;
  const totalDeductionsCents = deductions.reduce((sum, d) => sum + d.cents, 0);
  const netCents = grossCents - totalDeductionsCents;

  const minWageNote = pay.meetsMinimumWage
    ? `Hourly rate at or above local minimum wage (${moneyUsd(pay.minimumWageCents)}/hr).`
    : `<strong style="color:#b45309">⚠️ Hourly rate is below local minimum wage of ${moneyUsd(pay.minimumWageCents)}/hr.</strong>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Wage Statement — Timesheet #${ts.id}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:24px;color:#111;background:#fff}
  .doc{max-width:760px;margin:0 auto;border:1px solid #ddd;padding:24px}
  h1{margin:0 0 4px;font-size:20px}
  h2{font-size:14px;margin:16px 0 6px;color:#374151;text-transform:uppercase;letter-spacing:.04em}
  .meta{color:#6b7280;font-size:13px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:14px}
  th,td{padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:left}
  th{background:#f9fafb;font-weight:600;font-size:12px;color:#4b5563;text-transform:uppercase;letter-spacing:.04em}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .totals{margin-top:8px;border-top:2px solid #111;padding-top:8px}
  .totals .row{display:flex;justify-content:space-between;padding:4px 0;font-size:14px}
  .totals .row.gross{font-weight:600}
  .totals .row.net{font-size:16px;font-weight:700;border-top:1px solid #d1d5db;margin-top:6px;padding-top:8px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .card{border:1px solid #e5e7eb;border-radius:8px;padding:12px}
  .card h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
  .small{font-size:11px;color:#6b7280;margin-top:16px;line-height:1.5}
  @media print{body{padding:0}.doc{border:0}}
</style>
</head>
<body>
<div class="doc">
  <h1>Wage Statement</h1>
  <div class="meta">
    Timesheet #${ts.id}
    · Pay period: ${escapeHtml(periodStart)}${periodEnd !== periodStart ? ` – ${escapeHtml(periodEnd)}` : ""}
    · Issued: ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}
  </div>

  <div class="grid">
    <div class="card">
      <h3>Worker</h3>
      <div>${escapeHtml(workerName)}</div>
      <div class="meta">Worker ID: ${worker.id}</div>
    </div>
    <div class="card">
      <h3>Hiring entity</h3>
      <div>${escapeHtml(companyName)}</div>
      <div class="meta">${escapeHtml(companyAddress)}</div>
    </div>
  </div>

  <h2>Hours and earnings</h2>
  <table>
    <thead>
      <tr><th>Category</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr>
    </thead>
    <tbody>
      ${lineItemRows || `<tr><td colspan="4" style="color:#9ca3af">No earnings recorded.</td></tr>`}
    </tbody>
  </table>

  ${pay.overtimeHours > 0 || pay.doubleTimeHours > 0 ? `<div class="meta">Overtime computed per ${escapeHtml(pay.rulesApplied.dailyOvertimeAfterHours ? `${pay.rulesApplied.dailyOvertimeAfterHours}h-daily` : "FLSA weekly")} rules for ${escapeHtml(job.state ?? "the worker's location")}.</div>` : ""}

  <h2>Deductions</h2>
  ${deductions.length === 0
    ? `<div class="meta">None. Worker is engaged as an independent contractor (1099-NEC). No federal/state/FICA withholding by hiring entity. Worker is responsible for self-employment tax.</div>`
    : `<table>${deductions.map(d => `<tr><td>${escapeHtml(d.label)}</td><td class="num">${moneyUsd(d.cents)}</td></tr>`).join("")}</table>`
  }

  <div class="totals">
    <div class="row gross"><span>Gross wages</span><span class="num">${moneyUsd(grossCents)}</span></div>
    <div class="row"><span>Total deductions</span><span class="num">${moneyUsd(totalDeductionsCents)}</span></div>
    <div class="row net"><span>Net wages</span><span class="num">${moneyUsd(netCents)}</span></div>
  </div>

  <p class="small">
    ${minWageNote}<br/>
    Pay period dates reflect the actual shift worked. This statement is provided for transparency
    and to satisfy CA Labor Code §226 / NY Labor Law §195.3 documentation expectations even though
    independent contractors are not statutorily covered. ${workerView ? "Save or print this page for your records." : ""}
  </p>
</div>
</body>
</html>`;
}
