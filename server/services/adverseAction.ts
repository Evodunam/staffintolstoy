/**
 * FCRA §615 adverse-action email templates + sender.
 *
 * Workflow:
 *   1. Background check returns "consider" or "fail".
 *   2. We send the PRE-ADVERSE notice (sendPreAdverse) attaching the report
 *      copy + Summary of Rights.
 *   3. We wait at least 5 business days for the consumer to dispute.
 *   4. If still adverse, we send the FINAL adverse notice (sendFinalAdverse).
 *
 * Both notices are required regardless of vendor (Checkr / Goodhire / etc.).
 * The workflow is enforced via the `adverseActionPreNoticeSentAt` timestamp
 * column on background_check_orders — no final notice can be sent until 5
 * business days after the pre-notice timestamp.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { backgroundCheckOrders, profiles } from "@shared/schema";
import { sendEmail } from "../email-service";
import { recordPreAdverseSent, recordFinalAdverseSent, FCRA_SUMMARY_OF_RIGHTS_URL } from "./backgroundCheck";

const MIN_BUSINESS_DAYS_BETWEEN_NOTICES = 5;

function businessDaysBetween(a: Date, b: Date): number {
  if (b < a) return 0;
  let count = 0;
  const cur = new Date(a);
  while (cur < b) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

export async function sendPreAdverse(orderId: number, reportSummary: string): Promise<void> {
  const [order] = await db.select().from(backgroundCheckOrders).where(eq(backgroundCheckOrders.id, orderId));
  if (!order) throw new Error("Order not found");
  if (order.adverseActionPreNoticeSentAt) {
    console.warn(`[FCRA] Pre-adverse already sent for order ${orderId} at ${order.adverseActionPreNoticeSentAt}`);
    return;
  }
  const [worker] = await db.select().from(profiles).where(eq(profiles.id, order.workerId));
  if (!worker?.email) throw new Error("Worker has no email");

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
    <h1 style="font-size:18px">Pre-Adverse Action Notice</h1>
    <p>Dear ${escape(worker.firstName ?? "")} ${escape(worker.lastName ?? "")},</p>
    <p>
      Tolstoy Staffing, Inc. has received a consumer report from
      <strong>${escape(order.vendor)}</strong> in connection with your engagement on
      our marketplace. Based in part on information in that report, we are
      considering taking action that may be adverse to you (suspension or
      removal of marketplace eligibility).
    </p>
    <p>
      <strong>Before any final decision is made, you have the right to:</strong>
    </p>
    <ol>
      <li>Review a copy of the consumer report (attached / available at the link below).</li>
      <li>Review your rights under the federal Fair Credit Reporting Act (Summary of Rights below).</li>
      <li>Dispute the accuracy or completeness of any item in the report directly with ${escape(order.vendor)}.</li>
    </ol>
    <p>
      <strong>You have at least 5 business days from the date of this notice to respond.</strong>
      If you wish to dispute the report, contact ${escape(order.vendor)} as instructed
      in the report itself, and notify us at <a href="mailto:support@tolstoystaffing.com">support@tolstoystaffing.com</a>
      so we can hold the decision until your dispute is resolved.
    </p>
    <p>Report URL: ${order.reportUrl ? `<a href="${escape(order.reportUrl)}">${escape(order.reportUrl)}</a>` : "(attached)"}<br/>
    Summary of Your Rights Under the FCRA: <a href="${FCRA_SUMMARY_OF_RIGHTS_URL}">${FCRA_SUMMARY_OF_RIGHTS_URL}</a></p>
    <p style="margin-top:32px;font-size:12px;color:#6b7280">
      Tolstoy Staffing, Inc.<br/>
      This notice is provided pursuant to 15 U.S.C. §1681m(a)(1) (FCRA §615(a)).
    </p>
  </body></html>`;

  await sendEmail({
    to: worker.email,
    type: "fcra_pre_adverse",
    data: { workerName: `${worker.firstName ?? ""} ${worker.lastName ?? ""}`.trim() },
    overrideHtml: html,
    overrideSubject: "Pre-Adverse Action Notice — Background Check Result",
  } as any);

  await recordPreAdverseSent(orderId);
}

export async function sendFinalAdverse(orderId: number, reason: string): Promise<void> {
  const [order] = await db.select().from(backgroundCheckOrders).where(eq(backgroundCheckOrders.id, orderId));
  if (!order) throw new Error("Order not found");
  if (!order.adverseActionPreNoticeSentAt) {
    throw new Error("Pre-adverse notice must be sent first (FCRA §615 sequencing requirement)");
  }
  const days = businessDaysBetween(new Date(order.adverseActionPreNoticeSentAt), new Date());
  if (days < MIN_BUSINESS_DAYS_BETWEEN_NOTICES) {
    throw new Error(`Final adverse notice cannot be sent until ${MIN_BUSINESS_DAYS_BETWEEN_NOTICES} business days after pre-adverse (currently ${days}).`);
  }
  if (order.adverseActionFinalNoticeSentAt) return;
  const [worker] = await db.select().from(profiles).where(eq(profiles.id, order.workerId));
  if (!worker?.email) throw new Error("Worker has no email");

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
    <h1 style="font-size:18px">Adverse Action Notice</h1>
    <p>Dear ${escape(worker.firstName ?? "")} ${escape(worker.lastName ?? "")},</p>
    <p>
      This notice is provided pursuant to the Fair Credit Reporting Act (FCRA),
      15 U.S.C. §1681m(a). Based in whole or in part on information contained in
      a consumer report obtained from <strong>${escape(order.vendor)}</strong>,
      Tolstoy Staffing, Inc. has decided to take the following adverse action:
    </p>
    <p style="border-left:3px solid #dc2626;padding-left:12px;margin-left:0">
      ${escape(reason)}
    </p>
    <p>You have the right to:</p>
    <ul>
      <li>Obtain, within 60 days, a free additional copy of the report from ${escape(order.vendor)}.</li>
      <li>Dispute the accuracy or completeness of any item in the report directly with ${escape(order.vendor)}.</li>
    </ul>
    <p>${escape(order.vendor)} contact information is included in the report itself.</p>
    <p>
      Tolstoy Staffing, Inc. did not make this adverse decision and is not able
      to provide you with the specific reason(s) why the report contained the
      information it did. The consumer reporting agency that supplied the report
      played no role in the decision other than supplying the report.
    </p>
    <p>Summary of Your Rights Under the FCRA: <a href="${FCRA_SUMMARY_OF_RIGHTS_URL}">${FCRA_SUMMARY_OF_RIGHTS_URL}</a></p>
    <p style="margin-top:32px;font-size:12px;color:#6b7280">
      Tolstoy Staffing, Inc.<br/>
      This notice is provided pursuant to 15 U.S.C. §1681m(a) (FCRA §615(a)).
    </p>
  </body></html>`;

  await sendEmail({
    to: worker.email,
    type: "fcra_final_adverse",
    data: { workerName: `${worker.firstName ?? ""} ${worker.lastName ?? ""}`.trim() },
    overrideHtml: html,
    overrideSubject: "Final Adverse Action Notice",
  } as any);

  await recordFinalAdverseSent(orderId);
}

function escape(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
