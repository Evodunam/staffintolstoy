/**
 * FCRA-compliant pre-adverse and final adverse action emails for background
 * checks. Required by 15 USC §1681b(b)(3) and §1681m before and after a
 * decision is made (in whole or in part) on the basis of a consumer report.
 *
 * Two-step process:
 *   1. **Pre-adverse**: Sent at least 5 business days BEFORE final decision.
 *      Must include a copy of the report and the FCRA "Summary of Rights"
 *      (provided here as a static URL — vendors usually host one).
 *   2. **Final adverse**: Sent at the time of final adverse decision (or
 *      shortly after). Must include the consumer reporting agency's name
 *      and contact info, plus a notice the worker can dispute the report.
 *
 * Some states add wait-period or content rules on top of FCRA:
 *   - California ICRAA (Cal. Civ. Code §1786 et seq.)
 *   - New York City FCA (Local Law 4 of 2015, "Stop Credit Discrimination")
 *   - Massachusetts CORI sealed-record disclosures
 * Those layers are out of scope for this module — caller must ensure the
 * state-specific notice is added when targeting those jurisdictions.
 */

const CONSUMER_RIGHTS_SUMMARY_URL =
  "https://www.consumerfinance.gov/policy-compliance/guidance/implementation-guidance/fcra-summary-of-rights/";

export interface AdverseActionContext {
  workerEmail: string;
  workerFirstName: string;
  /** The CRA (consumer reporting agency) that produced the report. */
  vendorName: string;
  vendorPhone: string;
  vendorAddress: string;
  /** Report identifier from the vendor for the worker to reference. */
  reportRef: string;
  /** Public URL where the worker can review their full report copy. */
  reportUrl: string;
  /** What we're rescinding — typically a job offer or a hire. */
  positionTitle: string;
}

/**
 * Send the pre-adverse action email. Caller is responsible for waiting at
 * least 5 business days before placing the final adverse action.
 *
 * Returns true on send success, false on Resend failure (so the caller can
 * retry on a backoff). Does NOT throw — the caller should treat a failure
 * as "delay the wait-period clock until you re-send".
 */
export async function sendPreAdverseEmail(ctx: AdverseActionContext): Promise<boolean> {
  const subject = `Important: pending review of your background check for ${ctx.positionTitle}`;
  const html = `
    <p>Hi ${escapeHtml(ctx.workerFirstName)},</p>
    <p>We've received the results of a consumer report we ordered in connection with your application for the position of <strong>${escapeHtml(ctx.positionTitle)}</strong>. Based on information in that report, we are <strong>considering taking adverse action</strong> with respect to your application.</p>
    <p><strong>Before we make a final decision</strong>, we want to give you the opportunity to review the report and dispute any inaccuracies directly with the consumer reporting agency that produced it.</p>
    <ul>
      <li><strong>Consumer reporting agency:</strong> ${escapeHtml(ctx.vendorName)}</li>
      <li><strong>Address:</strong> ${escapeHtml(ctx.vendorAddress)}</li>
      <li><strong>Phone:</strong> ${escapeHtml(ctx.vendorPhone)}</li>
      <li><strong>Report reference:</strong> ${escapeHtml(ctx.reportRef)}</li>
      <li><strong>Copy of the report:</strong> <a href="${escapeAttr(ctx.reportUrl)}">${escapeHtml(ctx.reportUrl)}</a></li>
    </ul>
    <p>You also have rights under the Fair Credit Reporting Act. A summary of those rights is available at: <a href="${escapeAttr(CONSUMER_RIGHTS_SUMMARY_URL)}">${escapeHtml(CONSUMER_RIGHTS_SUMMARY_URL)}</a></p>
    <p>We will not make a final decision for at least <strong>5 business days</strong> from the date of this email to give you a reasonable opportunity to respond. If you believe any information in the report is inaccurate or incomplete, please contact the consumer reporting agency directly at the contact information above.</p>
    <p>If you have questions about this notice, reply to this email.</p>
    <p>— Tolstoy Staffing</p>
  `.trim();
  return sendViaResend(ctx.workerEmail, subject, html);
}

/**
 * Send the final adverse action notice. Should be sent only AFTER the
 * 5-business-day pre-adverse wait period has elapsed and after considering
 * any dispute the worker raised.
 */
export async function sendFinalAdverseEmail(ctx: AdverseActionContext): Promise<boolean> {
  const subject = `Final decision: your application for ${ctx.positionTitle}`;
  const html = `
    <p>Hi ${escapeHtml(ctx.workerFirstName)},</p>
    <p>This is to inform you that your application for the position of <strong>${escapeHtml(ctx.positionTitle)}</strong> has been declined, in whole or in part, on the basis of information contained in a consumer report we received about you.</p>
    <p>The information was provided by:</p>
    <ul>
      <li><strong>${escapeHtml(ctx.vendorName)}</strong></li>
      <li>${escapeHtml(ctx.vendorAddress)}</li>
      <li>${escapeHtml(ctx.vendorPhone)}</li>
    </ul>
    <p>The consumer reporting agency listed above did not make this decision and is unable to provide you with the specific reasons why we made this decision. <strong>You have the right to:</strong></p>
    <ul>
      <li>Obtain a free copy of your consumer report from the agency listed above by contacting them within 60 days of the date of this notice.</li>
      <li>Dispute the accuracy or completeness of any information in the report directly with the consumer reporting agency.</li>
    </ul>
    <p>A summary of your rights under the Fair Credit Reporting Act is available at: <a href="${escapeAttr(CONSUMER_RIGHTS_SUMMARY_URL)}">${escapeHtml(CONSUMER_RIGHTS_SUMMARY_URL)}</a></p>
    <p>If you have questions about this notice, reply to this email.</p>
    <p>— Tolstoy Staffing</p>
  `.trim();
  return sendViaResend(ctx.workerEmail, subject, html);
}

async function sendViaResend(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "support@tolstoystaffing.com";
  if (!apiKey) {
    console.error("[AdverseAction] RESEND_API_KEY missing; cannot send to", to);
    return false;
  }
  try {
    const { Resend } = await import("resend");
    const r = new Resend(apiKey);
    const { error } = await r.emails.send({
      from, to, subject, html,
      // Always include FCRA notices in plain text fallback for email clients
      // that strip HTML (lots of corporate filters do).
      text: html.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n"),
    } as any);
    if (error) {
      console.error("[AdverseAction] Resend error:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[AdverseAction] send failed:", e);
    return false;
  }
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }

