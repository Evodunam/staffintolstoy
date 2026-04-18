/**
 * FCRA-compliant background check service. Vendor-agnostic.
 *
 * Mandatory pre-procurement steps (FCRA §604(b)(2)):
 *   1. Standalone disclosure document presented (no other content commingled).
 *   2. Separate written authorization, signed by the consumer, BEFORE order placed.
 *   3. "Summary of Your Rights Under the FCRA" provided.
 *
 * Adverse action workflow (FCRA §615):
 *   1. Pre-adverse action notice sent with copy of report + Summary of Rights.
 *   2. 5 business day waiting period for the consumer to dispute.
 *   3. Final adverse action notice sent (if hire still denied).
 *
 * The actual data fetch goes to a vendor (Checkr/Goodhire/Sterling). This module
 * only handles the consent + order lifecycle; the vendor adapter lives in a
 * sibling file and is left as a TODO until a vendor is selected.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { backgroundCheckConsents, backgroundCheckOrders } from "@shared/schema";

export const CURRENT_DISCLOSURE_VERSION = "v1.2025-01";

/**
 * Plain-English standalone disclosure required before any background check is
 * ordered. Per the Supreme Court (Spokeo v. Robins) and FTC guidance, this MUST
 * be a single document containing ONLY the disclosure — no liability waivers,
 * no other terms.
 */
export const STANDALONE_DISCLOSURE_TEXT = `
DISCLOSURE REGARDING BACKGROUND INVESTIGATION

Tolstoy Staffing, Inc. ("Tolstoy") may obtain information about you from a
consumer reporting agency for marketplace eligibility purposes. These reports
may contain information about your character, general reputation, personal
characteristics, and mode of living, and may include verification of your
criminal history, motor vehicle records (if you will drive), and identity.

Tolstoy will conduct this investigation through Checkr, Inc. or another
nationally recognized consumer reporting agency. The scope of the investigation
will be limited to the items disclosed in the authorization document.

You may, upon written request, learn whether or not a consumer report has been
prepared and obtain a copy of any such report. You may also receive a written
summary of your rights under the Fair Credit Reporting Act ("FCRA"), which is
provided to you with this disclosure.

This disclosure does not contain any waiver of rights, indemnity provisions, or
other terms. Your separate written authorization is required for Tolstoy to
order the report.
`.trim();

/**
 * Authorization the worker signs (separate from the disclosure). Captures
 * informed consent and right-to-revoke language.
 */
export const AUTHORIZATION_TEXT = `
AUTHORIZATION TO OBTAIN CONSUMER REPORT

I have read and understood the Disclosure Regarding Background Investigation
and the Summary of Your Rights Under the Fair Credit Reporting Act, both
provided to me separately by Tolstoy Staffing, Inc.

I authorize Tolstoy Staffing, Inc. and its consumer reporting agency to procure
consumer reports about me from time to time during my engagement on the
Tolstoy Staffing marketplace, including but not limited to:

  - Identity verification
  - Criminal history (federal, state, county where allowed by law)
  - Sex offender registry
  - Motor vehicle records (if I will be driving for any job)
  - Prior employment verification (if specifically authorized in writing)

I understand that I may revoke this authorization at any time by emailing
support@tolstoystaffing.com, and that revocation will end my eligibility for
jobs on the Tolstoy Staffing marketplace that require a background check.

I acknowledge that this authorization is a stand-alone document, separate from
any application or contract.
`.trim();

/**
 * "Summary of Your Rights Under the Federal Fair Credit Reporting Act" —
 * the short-form text the CFPB requires be provided to consumers. Use this
 * verbatim until the next CFPB version supersedes it.
 */
export const FCRA_SUMMARY_OF_RIGHTS_URL =
  "https://files.consumerfinance.gov/f/documents/cfpb_consumer-rights-summary_2018-09.pdf";

export interface ConsentArgs {
  workerId: number;
  signatureName: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function recordConsent(args: ConsentArgs) {
  const now = new Date();
  const [row] = await db.insert(backgroundCheckConsents).values({
    workerId: args.workerId,
    disclosureVersion: CURRENT_DISCLOSURE_VERSION,
    disclosureSignedAt: now,
    authSignedAt: now,
    signatureName: args.signatureName,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  }).returning();
  return row;
}

export async function latestConsentForWorker(workerId: number) {
  const rows = await db.select().from(backgroundCheckConsents)
    .where(eq(backgroundCheckConsents.workerId, workerId))
    .orderBy(backgroundCheckConsents.createdAt)
    .limit(50);
  if (rows.length === 0) return null;
  return rows[rows.length - 1];
}

export async function createOrder(args: {
  workerId: number;
  consentId: number;
  vendor: string;
  packageCode?: string;
}) {
  const [row] = await db.insert(backgroundCheckOrders).values({
    workerId: args.workerId,
    consentId: args.consentId,
    vendor: args.vendor,
    packageCode: args.packageCode ?? null,
    status: "draft",
  }).returning();
  return row;
}

/**
 * Adverse-action workflow trigger. Sets the pre-adverse timestamp; caller is
 * responsible for actually emailing the report + Summary of Rights to the
 * consumer. After 5 business days with no dispute, send the final notice.
 */
export async function startAdverseAction(orderId: number, reason: string) {
  await db.update(backgroundCheckOrders).set({
    adverseActionStartedAt: new Date(),
    adverseActionReason: reason,
  }).where(eq(backgroundCheckOrders.id, orderId));
}

export async function recordPreAdverseSent(orderId: number) {
  await db.update(backgroundCheckOrders).set({
    adverseActionPreNoticeSentAt: new Date(),
  }).where(eq(backgroundCheckOrders.id, orderId));
}

export async function recordFinalAdverseSent(orderId: number) {
  await db.update(backgroundCheckOrders).set({
    adverseActionFinalNoticeSentAt: new Date(),
  }).where(eq(backgroundCheckOrders.id, orderId));
}
