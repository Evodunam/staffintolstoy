/**
 * Auto-replenishment: company balance funding only.
 * We do NOT use Mercury for companies. Company funding (replenishment, top-up) is Stripe only (card/ACH via Stripe).
 * Mercury is for worker payouts only.
 */
import { db } from "./db";
import { profiles, jobs, applications, companyTransactions, timesheets, companyPaymentMethods, companyLocations } from "@shared/schema";
import { eq, and, inArray, desc, isNotNull } from "drizzle-orm";
import { chargeCardOffSession, chargeAchOffSession, calculateCardFee } from "./services/stripe";
import { ensureCompanyStripeCustomer } from "./lib/company-stripe";
import {
  notifyCompanyPaymentFundingIssue,
  syncPaymentFailureReminderState,
} from "./payment-failure-reminder-scheduler";

const REPLENISHMENT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const REPLENISHMENT_BUFFER_PERCENT = 30; // Add 30% to charge amount to maintain balance

/** Stripe error when payment method was created for a different customer (e.g. profile's stripeCustomerId changed). Do not set lastFailedPaymentMethodId so the add-payment modal does not show on every refresh. */
function isPaymentMethodCustomerMismatch(error: string | undefined): boolean {
  if (!error) return false;
  return (
    error.includes("does not belong to the Customer") ||
    error.includes("does not belong to the customer") ||
    (error.includes("PaymentMethod") && error.includes("does not belong"))
  );
}

/** Normalize Stripe PM customer field (can be string id or expanded object). */
function pmCustomerId(pm: any): string | null {
  const raw = (pm as any).customer;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof raw.id === "string") return raw.id;
  return null;
}

/** Result of ensuring PM is attached: canUse = can charge with this PM; unusable = Stripe says PM may not be used again (detached etc.) — caller should remove from DB. */
type AttachResult = { canUse: boolean; unusable?: boolean };

/** Ensure the payment method is attached to the given Stripe customer before charging. Each business/worker has their own customer ID; PM must belong to that customer. Returns { canUse, unusable }; when unusable the caller should delete the PM from DB so we never retry. */
async function ensurePaymentMethodAttachedToCustomer(
  paymentMethodId: string,
  customerId: string
): Promise<AttachResult> {
  try {
    const stripeService = await import("./services/stripe").then((m) => m.default);
    const stripe = stripeService.getStripe();
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const currentCustomer = pmCustomerId(pm);
    if (currentCustomer === customerId) return { canUse: true };
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      console.log(`[AutoReplenish] Attached PM ${paymentMethodId} to customer ${customerId} (was ${currentCustomer})`);
      return { canUse: true };
    } catch (attachErr: any) {
      const raw = attachErr?.raw?.body?.error?.message ?? attachErr?.message ?? "";
      const msg = String(raw).toLowerCase();
      const belongsToOther =
        msg.includes("already been attached to a different customer") ||
        msg.includes("already attached to another customer") ||
        msg.includes("does not belong to the customer") ||
        msg.includes("use this paymentmethod with the customer that it belongs to");
      const unusable =
        msg.includes("may not be used again") ||
        msg.includes("detached from a customer") ||
        msg.includes("previously used without being attached");
      if (belongsToOther || unusable) {
        console.log(`[AutoReplenish] PM ${paymentMethodId} ${unusable ? "no longer reusable" : "belongs to another customer"}, skipping`);
        return { canUse: false, unusable };
      }
      throw attachErr;
    }
  } catch (e: any) {
    console.warn(`[AutoReplenish] Could not ensure PM attached to customer:`, e?.message);
    return { canUse: false };
  }
}

/** Location row for resolving payment method (location.paymentMethodId or PM with locationIds). */
type LocationRow = { id: number; name: string; paymentMethodId: number | null };
/** One charge: specific payment method (location-linked) or "primary". Cards get 3.5% surcharge. */
type LocationChargeItem = { amountCents: number; method: typeof companyPaymentMethods.$inferSelect | "primary"; locationName?: string };

interface CompanyCommitments {
  companyId: number;
  currentBalanceCents: number;
  pendingPaymentsCents: number;
  jobCommitmentsCents: number;
  totalNeededCents: number;
  targetBalanceCents: number;
  shortfallCents: number;
  chargeAmountCents: number;
  profile: typeof profiles.$inferSelect;
  primaryCardPaymentMethod?: typeof companyPaymentMethods.$inferSelect;
  allUsableStripeMethods?: (typeof companyPaymentMethods.$inferSelect)[];
  /** Location-aware: pending + commitments per location (null = jobs with no location). */
  locations?: LocationRow[];
  pendingByLocation?: Map<number | null, number>;
  commitmentsByLocation?: Map<number | null, number>;
}

async function calculateJobCommitments(companyId: number): Promise<number> {
  // Commitments = estimated total cost of open jobs (workers × rate × estimated hours × 1.52), reduced by approved timesheets (paid down).
  const companyJobs = await db.select({
    job: jobs,
  })
    .from(jobs)
    .where(
      and(
        eq(jobs.companyId, companyId),
        inArray(jobs.status, ["open", "in_progress", "cancelled"])
      )
    );

  let totalCommitments = 0;

  for (const { job } of companyJobs) {
    const acceptedApplications = await db.select()
      .from(applications)
      .where(
        and(
          eq(applications.jobId, job.id),
          eq(applications.status, "accepted")
        )
      );

    const acceptedWorkerCount = acceptedApplications.length;
    if (acceptedWorkerCount === 0) continue;

    const jobRate = job.hourlyRate || 2500;
    const estimatedHours = job.estimatedHours || 40;
    const fullEstimateCents = Math.round(estimatedHours * jobRate * acceptedWorkerCount * 1.52);

    // Approved timesheets for this job (paid down) — same formula: hours × rate × 1.52
    const approvedTs = await db.select()
      .from(timesheets)
      .where(
        and(
          eq(timesheets.jobId, job.id),
          eq(timesheets.status, "approved")
        )
      );
    const approvedPaidCents = approvedTs.reduce((sum, ts) => {
      const hours = parseFloat(ts.adjustedHours?.toString() || ts.totalHours?.toString() || "0");
      const rate = ts.hourlyRate || 2500;
      return sum + Math.round(hours * rate * 1.52);
    }, 0);

    const remainingCents = Math.max(0, fullEstimateCents - approvedPaidCents);
    totalCommitments += remainingCents;

    if (remainingCents > 0 && process.env.NODE_ENV !== "production") {
      console.log(`[AutoReplenish] Job ${job.id} (${job.title}): full $${(fullEstimateCents / 100).toFixed(2)}, approved $${(approvedPaidCents / 100).toFixed(2)}, remaining $${(remainingCents / 100).toFixed(2)}`);
    }
  }

  return totalCommitments;
}

async function calculatePendingPayments(companyId: number): Promise<number> {
  // Pending = all timesheets not approved/rejected (open status): pending + disputed
  const companyJobs = await db.select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.companyId, companyId));

  const jobIds = companyJobs.map(j => j.id);
  if (jobIds.length === 0) return 0;

  const pendingTs = await db.select()
    .from(timesheets)
    .where(
      and(
        inArray(timesheets.jobId, jobIds),
        inArray(timesheets.status, ["pending", "disputed"])
      )
    );

  return pendingTs.reduce((sum, ts) => {
    const hours = parseFloat(ts.adjustedHours?.toString() || ts.totalHours?.toString() || "0");
    const rate = ts.hourlyRate || 2500;
    return sum + Math.round(hours * rate * 1.52);
  }, 0);
}

/** Clear payment holds on jobs when balance covers pending timesheets + accepted-hire commitments. */
export async function clearPaymentHoldsForCompanyIfSolvent(companyId: number): Promise<void> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, companyId)).limit(1);
  if (!profile) return;
  const balance = profile.depositAmount || 0;
  const pending = await calculatePendingPayments(companyId);
  const commitments = await calculateJobCommitments(companyId);
  const required = pending + commitments;
  if (balance >= required) {
    await db
      .update(jobs)
      .set({ paymentHoldAt: null })
      .where(and(eq(jobs.companyId, companyId), isNotNull(jobs.paymentHoldAt)));
  }
  await syncPaymentFailureReminderState(companyId);
}

/** Pending amount (cents) by job location; null = jobs with no companyLocationId. Includes pending + disputed. */
async function getPendingByLocation(companyId: number): Promise<Map<number | null, number>> {
  const companyJobs = await db.select({ id: jobs.id, companyLocationId: jobs.companyLocationId })
    .from(jobs)
    .where(eq(jobs.companyId, companyId));
  const jobIds = companyJobs.map(j => j.id);
  if (jobIds.length === 0) return new Map();
  const jobById = new Map(companyJobs.map(j => [j.id, j.companyLocationId ?? null]));
  const pendingTs = await db.select()
    .from(timesheets)
    .where(and(inArray(timesheets.jobId, jobIds), inArray(timesheets.status, ["pending", "disputed"])));
  const byLocation = new Map<number | null, number>();
  for (const ts of pendingTs) {
    const locId = jobById.get(ts.jobId) ?? null;
    const amount = Math.round(
      parseFloat(ts.adjustedHours?.toString() || ts.totalHours?.toString() || "0") * (ts.hourlyRate || 2500) * 1.52
    );
    byLocation.set(locId, (byLocation.get(locId) ?? 0) + amount);
  }
  return byLocation;
}

/** Commitment amount (cents, remaining after approved timesheets) by job location; null = jobs with no companyLocationId. */
async function getCommitmentsByLocation(companyId: number): Promise<Map<number | null, number>> {
  const companyJobs = await db.select({ job: jobs })
    .from(jobs)
    .where(and(eq(jobs.companyId, companyId), inArray(jobs.status, ["open", "in_progress", "cancelled"])));
  const byLocation = new Map<number | null, number>();
  for (const { job } of companyJobs) {
    const accepted = await db.select()
      .from(applications)
      .where(and(eq(applications.jobId, job.id), eq(applications.status, "accepted")));
    if (accepted.length === 0) continue;
    const rate = job.hourlyRate || 2500;
    const hours = job.estimatedHours || 40;
    const fullEstimateCents = Math.round(rate * hours * accepted.length * 1.52);
    const approvedTs = await db.select()
      .from(timesheets)
      .where(and(eq(timesheets.jobId, job.id), eq(timesheets.status, "approved")));
    const approvedPaidCents = approvedTs.reduce((sum, ts) => {
      const h = parseFloat(ts.adjustedHours?.toString() || ts.totalHours?.toString() || "0");
      return sum + Math.round(h * (ts.hourlyRate || 2500) * 1.52);
    }, 0);
    const remainingCents = Math.max(0, fullEstimateCents - approvedPaidCents);
    const locId = job.companyLocationId ?? null;
    byLocation.set(locId, (byLocation.get(locId) ?? 0) + remainingCents);
  }
  return byLocation;
}

async function getCompanyLocations(companyId: number): Promise<LocationRow[]> {
  const rows = await db.select({ id: companyLocations.id, name: companyLocations.name, paymentMethodId: companyLocations.paymentMethodId })
    .from(companyLocations)
    .where(eq(companyLocations.profileId, companyId));
  return rows.map(r => ({ id: r.id, name: r.name ?? "", paymentMethodId: r.paymentMethodId ?? null }));
}

/** Resolve which payment method to use for a location: location.paymentMethodId, or PM with locationIds containing this location, or primary. */
function resolvePaymentMethodForLocation(
  locationId: number | null,
  locations: LocationRow[],
  stripeMethods: (typeof companyPaymentMethods.$inferSelect)[],
  primaryMethod: (typeof companyPaymentMethods.$inferSelect) | undefined
): typeof companyPaymentMethods.$inferSelect | undefined {
  if (locationId === null) return primaryMethod;
  const loc = locations.find(l => l.id === locationId);
  if (loc?.paymentMethodId != null) {
    const pm = stripeMethods.find(m => m.id === loc.paymentMethodId);
    if (pm) return pm;
  }
  const locIdStr = String(locationId);
  const pmWithLocation = stripeMethods.find(m => {
    const ids = m.locationIds ?? [];
    return ids.includes(locIdStr);
  });
  if (pmWithLocation) return pmWithLocation;
  return primaryMethod;
}

type PaymentMethodRow = typeof companyPaymentMethods.$inferSelect;

/** Try to charge amountCents: preferred method first, then if failed and company has >1 method, round-robin try others. Card = 3.5% surcharge. */
async function tryChargeWithRoundRobin(
  amountCents: number,
  opts: {
    preferredMethod: PaymentMethodRow | null;
    stripeMethods: PaymentMethodRow[];
    profile: { stripeCustomerId?: string | null };
    companyId: number;
    locationLabel?: string;
  }
): Promise<{ success: boolean; credited: number; lastFailedMethodId: number | null }> {
  const { preferredMethod, stripeMethods, profile, companyId, locationLabel } = opts;
  if (stripeMethods.length === 0 || !profile.stripeCustomerId) {
    return { success: false, credited: 0, lastFailedMethodId: null };
  }
  const ordered =
    preferredMethod && stripeMethods.some((m) => m.id === preferredMethod.id)
      ? [preferredMethod, ...stripeMethods.filter((m) => m.id !== preferredMethod.id)]
      : [...stripeMethods];
  const desc = `Auto-replenishment: shortfall + ${REPLENISHMENT_BUFFER_PERCENT}%${locationLabel ? ` (${locationLabel})` : ""}`;
  let lastFailedId: number | null = null;
  for (const method of ordered) {
    const stripePmId = method.stripePaymentMethodId;
    if (!stripePmId) continue;
    const attachResult = await ensurePaymentMethodAttachedToCustomer(stripePmId, profile.stripeCustomerId!);
    if (!attachResult.canUse) {
      if (attachResult.unusable) {
        await db.delete(companyPaymentMethods).where(eq(companyPaymentMethods.id, method.id));
        console.log(`[AutoReplenish] Removed payment method ${method.id} from DB (Stripe: PM no longer reusable)`);
      }
      continue;
    }
    const isCard = method.type === "card";
    try {
      if (isCard) {
        const cardFee = calculateCardFee(amountCents);
        const totalCharge = amountCents + cardFee;
        const chargeResult = await chargeCardOffSession({
          amount: totalCharge,
          customerId: profile.stripeCustomerId,
          paymentMethodId: stripePmId,
          description: desc,
          metadata: { companyId: String(companyId), type: "auto_recharge", cardFee: (cardFee / 100).toFixed(2) },
        });
        if (chargeResult.success) {
          await db.insert(companyTransactions).values({
            profileId: companyId,
            type: "auto_recharge",
            amount: amountCents,
            description: `Auto-replenishment via card (${method.cardBrand} ...${method.lastFour})${locationLabel ? ` ${locationLabel}` : ""}`,
            stripePaymentIntentId: chargeResult.paymentIntentId,
            paymentMethod: "card",
          });
          if (cardFee > 0) {
            await db.insert(companyTransactions).values({
              profileId: companyId,
              type: "card_fee",
              amount: -cardFee,
              description: `Card processing fee (3.5%) for auto-replenishment`,
              stripePaymentIntentId: chargeResult.paymentIntentId,
              paymentMethod: "card",
            });
          }
          return { success: true, credited: amountCents, lastFailedMethodId: null };
        }
        if (!isPaymentMethodCustomerMismatch(chargeResult.error)) lastFailedId = method.id;
      } else {
        const chargeResult = await chargeAchOffSession({
          amount: amountCents,
          customerId: profile.stripeCustomerId,
          paymentMethodId: stripePmId,
          description: desc,
          metadata: { companyId: String(companyId), type: "auto_recharge" },
        });
        if (chargeResult.success) {
          await db.insert(companyTransactions).values({
            profileId: companyId,
            type: "auto_recharge",
            amount: amountCents,
            description: `Auto-replenishment via ACH (Stripe)${locationLabel ? ` ${locationLabel}` : ""}`,
            stripePaymentIntentId: chargeResult.paymentIntentId,
            paymentMethod: "ach",
          });
          return { success: true, credited: amountCents, lastFailedMethodId: null };
        }
        if (!isPaymentMethodCustomerMismatch(chargeResult.error)) lastFailedId = method.id;
      }
    } catch (err: any) {
      if (!isPaymentMethodCustomerMismatch(err?.message ?? err?.toString?.())) lastFailedId = method.id;
    }
    // Round-robin: only try next method if company has more than one
    if (stripeMethods.length <= 1) break;
  }
  return { success: false, credited: 0, lastFailedMethodId: lastFailedId };
}

/** Build charge plan: allocate total charge by location; each item uses location-linked PM or primary. Cards get 3.5% surcharge at charge time. */
function buildLocationChargePlan(company: CompanyCommitments): LocationChargeItem[] {
  const totalRequired = company.totalNeededCents;
  if (totalRequired <= 0 || !company.pendingByLocation || !company.commitmentsByLocation || !company.locations) {
    return [{ amountCents: company.chargeAmountCents ?? Math.round(company.shortfallCents * (1 + REPLENISHMENT_BUFFER_PERCENT / 100)), method: "primary" }];
  }
  const stripeMethods = company.allUsableStripeMethods ?? (company.primaryCardPaymentMethod ? [company.primaryCardPaymentMethod] : []);
  const primary = stripeMethods.find(m => m.isPrimary === true) ?? stripeMethods[0];
  const totalCharge = company.chargeAmountCents ?? Math.round(company.shortfallCents * (1 + REPLENISHMENT_BUFFER_PERCENT / 100));
  const allLocIds = new Set<number | null>([
    ...company.pendingByLocation.keys(),
    ...company.commitmentsByLocation.keys(),
  ]);
  const items: LocationChargeItem[] = [];
  for (const locId of allLocIds) {
    const pending = company.pendingByLocation.get(locId) ?? 0;
    const commitments = company.commitmentsByLocation.get(locId) ?? 0;
    const locRequired = pending + commitments;
    if (locRequired <= 0) continue;
    const share = locRequired / totalRequired;
    const amountCents = Math.round(share * totalCharge);
    if (amountCents <= 0) continue;
    const method = resolvePaymentMethodForLocation(locId, company.locations, stripeMethods, primary);
    const locationName = locId === null ? "No location" : (company.locations.find(l => l.id === locId)?.name ?? `Location ${locId}`);
    items.push({ amountCents, method: method ?? "primary", locationName });
  }
  return items;
}

async function getCompaniesNeedingReplenishment(): Promise<CompanyCommitments[]> {
  // Include all companies so we evaluate every one (including demo e.g. Acme). Skip later if no Stripe methods or no shortfall.
  const companies = await db.select()
    .from(profiles)
    .where(eq(profiles.role, "company"));

  console.log(`[AutoReplenish] Found ${companies.length} companies to check`);
  // Batch fetch all Stripe payment methods (card + verified ACH) so companies with only ACH (e.g. Acme) are included
  const companyIds = companies.map(c => c.id);
  const allPaymentMethods = companyIds.length > 0 ? await db
    .select()
    .from(companyPaymentMethods)
    .where(
      and(
        inArray(companyPaymentMethods.profileId, companyIds),
        inArray(companyPaymentMethods.type, ["card", "ach"])
      )
    )
    .orderBy(desc(companyPaymentMethods.isPrimary), desc(companyPaymentMethods.createdAt))
    : [];

  const stripeMethodsByCompany = new Map<number, (typeof allPaymentMethods)[0][]>();
  for (const method of allPaymentMethods) {
    if (!method.stripePaymentMethodId) continue;
    const usable = method.type === "card" || (method.type === "ach" && method.isVerified === true);
    if (!usable) continue;
    const list = stripeMethodsByCompany.get(method.profileId) ?? [];
    list.push(method);
    stripeMethodsByCompany.set(method.profileId, list);
  }
  for (const [pid, list] of stripeMethodsByCompany) {
    stripeMethodsByCompany.set(pid, [...list].sort((a, b) => {
      const aAch = a.type === "ach" ? 1 : 0;
      const bAch = b.type === "ach" ? 1 : 0;
      if (bAch !== aAch) return bAch - aAch;
      const aPrimary = (a.isPrimary === true) ? 1 : 0;
      const bPrimary = (b.isPrimary === true) ? 1 : 0;
      if (bPrimary !== aPrimary) return bPrimary - aPrimary;
      const aAt = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const bAt = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return bAt - aAt;
    }));
  }

  const needsReplenishment: CompanyCommitments[] = [];
  let skippedShortfallNoMethods = 0;

  // Raw payment method rows per company (type card/ach only) for diagnostics
  const rawMethodsByCompany = new Map<number, (typeof allPaymentMethods)[0][]>();
  for (const m of allPaymentMethods) {
    const list = rawMethodsByCompany.get(m.profileId) ?? [];
    list.push(m);
    rawMethodsByCompany.set(m.profileId, list);
  }

  for (const company of companies) {
    const currentBalance = company.depositAmount || 0;
    const pendingPayments = await calculatePendingPayments(company.id);
    const jobCommitments = await calculateJobCommitments(company.id);
    const requiredCents = pendingPayments + jobCommitments;
    const shortfallCents = Math.max(0, requiredCents - currentBalance);
    const name = company.companyName || company.firstName || `Company ${company.id}`;

    // Always log one line per company so we can see Acme (and others) in logs
    console.log(`[AutoReplenish] Company ${company.id} (${name}): balance=$${(currentBalance / 100).toFixed(2)} pending=$${(pendingPayments / 100).toFixed(2)} commitments=$${(jobCommitments / 100).toFixed(2)} shortfall=$${(shortfallCents / 100).toFixed(2)}`);

    if (shortfallCents <= 0) {
      continue; // sufficient balance
    }

    const stripeMethods = stripeMethodsByCompany.get(company.id) ?? [];
    if (stripeMethods.length === 0) {
      skippedShortfallNoMethods++;
      const raw = rawMethodsByCompany.get(company.id) ?? [];
      const withStripe = raw.filter(m => !!m.stripePaymentMethodId);
      const verifiedAch = raw.filter(m => m.type === "ach" && m.isVerified === true && m.stripePaymentMethodId);
      const cards = raw.filter(m => m.type === "card" && m.stripePaymentMethodId);
      console.log(
        `[AutoReplenish] Company ${company.id} (${name}): shortfall $${(shortfallCents / 100).toFixed(2)} but no usable Stripe payment methods. ` +
        `(Usable = card, or ACH that is verified and has stripePaymentMethodId.) ` +
        `On file: ${raw.length} method(s), ${withStripe.length} with Stripe ID, cards=${cards.length}, verified ACH=${verifiedAch.length}. ` +
        `To fix: add a card or complete bank verification in the company dashboard under Settings → Payment Methods, then auto-charge can run. Skipping this company.`
      );
      continue;
    }
    const chargeAmountCents = Math.round(shortfallCents * (1 + REPLENISHMENT_BUFFER_PERCENT / 100));

    console.log(`[AutoReplenish] Company ${company.id} (${name}): ` +
      `Balance: $${(currentBalance / 100).toFixed(2)}, ` +
      `Pending: $${(pendingPayments / 100).toFixed(2)}, ` +
      `Commitments: $${(jobCommitments / 100).toFixed(2)}, ` +
      `Shortfall: $${(shortfallCents / 100).toFixed(2)}, Charge (+${REPLENISHMENT_BUFFER_PERCENT}%): $${(chargeAmountCents / 100).toFixed(2)}`);

    const primaryCard = stripeMethods.find(m => m.type === "card") ?? stripeMethods[0];
    const locations = await getCompanyLocations(company.id);
    const pendingByLocation = await getPendingByLocation(company.id);
    const commitmentsByLocation = await getCommitmentsByLocation(company.id);
    needsReplenishment.push({
      companyId: company.id,
      currentBalanceCents: currentBalance,
      pendingPaymentsCents: pendingPayments,
      jobCommitmentsCents: jobCommitments,
      totalNeededCents: requiredCents,
      targetBalanceCents: requiredCents,
      shortfallCents,
      chargeAmountCents,
      profile: company,
      primaryCardPaymentMethod: primaryCard ?? undefined,
      allUsableStripeMethods: stripeMethods.length > 0 ? stripeMethods : undefined,
      locations: locations.length > 0 ? locations : undefined,
      pendingByLocation,
      commitmentsByLocation,
    });
  }

  if (skippedShortfallNoMethods > 0) {
    console.log(`[AutoReplenish] ${skippedShortfallNoMethods} company(ies) had shortfall but no Stripe payment methods — no charge attempt. Add card/bank in dashboard to enable.`);
  }
  return needsReplenishment;
}

async function processAutoReplenishment(company: CompanyCommitments): Promise<boolean> {
  try {
    console.log(`[AutoReplenish] Processing replenishment for company ${company.companyId}`);
    console.log(`[AutoReplenish] Current: $${(company.currentBalanceCents / 100).toFixed(2)}, ` +
      `Commitments: $${(company.jobCommitmentsCents / 100).toFixed(2)}, ` +
      `Pending: $${(company.pendingPaymentsCents / 100).toFixed(2)}, ` +
      `Shortfall: $${(company.shortfallCents / 100).toFixed(2)}`);

    const profile = company.profile;
    const customerId = await ensureCompanyStripeCustomer(profile);
    (profile as { stripeCustomerId?: string | null }).stripeCustomerId = customerId;

    // Location-aware charging (Stripe only; we do not use Mercury for companies): charge location-linked PM per location’s share, else primary. Card = 3.5% surcharge. On failure, round-robin other methods only if >1 method.
    const stripeMethods = company.allUsableStripeMethods?.length
      ? company.allUsableStripeMethods
      : company.primaryCardPaymentMethod
        ? [company.primaryCardPaymentMethod]
        : [];
    let lastFailedMethodId: number | null = null;

    if (stripeMethods.length === 0) {
      console.log(`[AutoReplenish] Company ${company.companyId} has no Stripe payment methods, skipping`);
      return false;
    }

    const plan = buildLocationChargePlan(company);
    let totalCredited = 0;
    let primaryPoolCents = 0;

    for (const item of plan) {
      if (item.method === "primary") {
        primaryPoolCents += item.amountCents;
        continue;
      }
      const result = await tryChargeWithRoundRobin(item.amountCents, {
        preferredMethod: item.method,
        stripeMethods,
        profile,
        companyId: company.companyId,
        locationLabel: item.locationName,
      });
      if (result.success) {
        totalCredited += result.credited;
      } else {
        primaryPoolCents += item.amountCents;
        if (result.lastFailedMethodId != null) lastFailedMethodId = result.lastFailedMethodId;
      }
    }

    if (primaryPoolCents > 0) {
      const primaryMethod = stripeMethods.find((m) => m.isPrimary === true) ?? stripeMethods[0];
      const result = await tryChargeWithRoundRobin(primaryPoolCents, {
        preferredMethod: primaryMethod ?? null,
        stripeMethods,
        profile,
        companyId: company.companyId,
        locationLabel: "primary",
      });
      if (result.success) {
        totalCredited += result.credited;
      } else if (result.lastFailedMethodId != null) {
        lastFailedMethodId = result.lastFailedMethodId;
      }
    }

    if (totalCredited > 0) {
      await db.update(profiles)
        .set({ depositAmount: (profile.depositAmount || 0) + totalCredited, lastFailedPaymentMethodId: null })
        .where(eq(profiles.id, profile.id));
      // Company charge automation: create Mercury AR invoice for this customer and mark status as paid (only when charge succeeded)
      console.log(`[AutoReplenish] Charge succeeded ($${(totalCredited / 100).toFixed(2)}). Creating Mercury invoice and marking as paid.`);
      try {
        const { mercuryService } = await import("./services/mercury");
        mercuryService.recordCompanyPaymentAsMercuryInvoice(
          profile,
          totalCredited,
          "Auto-replenishment (balance replenished)",
          `auto-replenish-${profile.id}-${Date.now()}`
        ).catch((e: any) => console.warn("[AutoReplenish] Mercury AR invoice failed (non-blocking):", e?.message));
      } catch (mercuryErr: any) {
        console.warn("[AutoReplenish] Mercury service not available for AR invoice:", mercuryErr?.message);
      }
      await clearPaymentHoldsForCompanyIfSolvent(company.companyId);
      return true;
    }
    if (lastFailedMethodId != null) {
      await db.update(profiles)
        .set({ lastFailedPaymentMethodId: lastFailedMethodId })
        .where(eq(profiles.id, profile.id));
    }
    console.error(`[AutoReplenish] All payment methods failed for company ${company.companyId}`);
    notifyCompanyPaymentFundingIssue(company.companyId).catch((e) =>
      console.warn("[AutoReplenish] notifyCompanyPaymentFundingIssue:", e)
    );
    return false;
  } catch (error: any) {
    console.error(`[AutoReplenish] Error processing company ${company.companyId}:`, error.message);
    return false;
  }
}

async function checkAndReplenishBalances(): Promise<void> {
  console.log("[AutoReplenish] Checking company balances for auto-replenishment...");

  try {
    const companiesNeedingReplenishment = await getCompaniesNeedingReplenishment();

    if (companiesNeedingReplenishment.length === 0) {
      console.log("[AutoReplenish] No charge attempts this run (all companies either have sufficient balance or have shortfall but no Stripe payment methods — add card in Payment Methods to enable auto-charge)");
      return;
    }

    console.log(`[AutoReplenish] Found ${companiesNeedingReplenishment.length} companies needing replenishment`);

    for (const company of companiesNeedingReplenishment) {
      console.log(`[AutoReplenish] Company ${company.companyId}: ` +
        `Balance: $${(company.currentBalanceCents / 100).toFixed(2)}, ` +
        `Commitments: $${(company.jobCommitmentsCents / 100).toFixed(2)}, ` +
        `Shortfall: $${(company.shortfallCents / 100).toFixed(2)}`);
      await processAutoReplenishment(company);
    }
  } catch (error: any) {
    console.error("[AutoReplenish] Error checking balances:", error.message);
  }
}

export function startAutoReplenishmentScheduler(): void {
  console.log("[AutoReplenish] Starting auto-replenishment scheduler (first check now, then every 5 minutes)");

  // Run first check immediately so restart triggers one attempt without waiting
  setImmediate(() => checkAndReplenishBalances());

  setInterval(() => {
    checkAndReplenishBalances();
  }, REPLENISHMENT_CHECK_INTERVAL_MS);
}

export type TriggerAutoReplenishmentResult = { success: true } | { success: false; noChargeNeeded: true } | { success: false; noChargeNeeded: false };

// Export function to trigger immediate replenishment check for a specific company
export async function triggerAutoReplenishmentForCompany(
  companyId: number,
  options?: { clientShortfallCents?: number }
): Promise<TriggerAutoReplenishmentResult> {
  console.log(`[AutoReplenish] Triggered immediate check for company ${companyId}`);
  
  try {
    const company = await db.select()
      .from(profiles)
      .where(eq(profiles.id, companyId))
      .limit(1);
    
    if (!company[0] || company[0].role !== "company") {
      console.log(`[AutoReplenish] Company ${companyId} not found or not a company`);
      return { success: false, noChargeNeeded: true };
    }
    
    const profile = company[0];

    // Canonical customer for this account (create once if missing). All charges must use this customer; PMs attached to another customer are removed from DB.
    const targetCustomerId = await ensureCompanyStripeCustomer(profile);
    (profile as { stripeCustomerId?: string | null }).stripeCustomerId = targetCustomerId;

    // All Stripe methods that can be charged: card (always verified) or ACH that is verified. Keep only those attached to this account's customer; delete any that belong to another customer.
    const allStripeMethods = await db.select()
      .from(companyPaymentMethods)
      .where(eq(companyPaymentMethods.profileId, profile.id))
      .orderBy(desc(companyPaymentMethods.isPrimary), desc(companyPaymentMethods.createdAt));
    let allUsableStripeMethods = allStripeMethods.filter((m) => {
      const hasStripe = !!m.stripePaymentMethodId;
      const usable = m.type === "card" || (m.type === "ach" && m.isVerified === true);
      return hasStripe && usable;
    });
    if (allUsableStripeMethods.length > 0) {
      try {
        const stripeService = await import("./services/stripe").then((m) => m.default);
        const stripe = stripeService.getStripe();
        if (stripe) {
          const resolved: typeof allUsableStripeMethods = [];
          for (const m of allUsableStripeMethods) {
            const pmId = m.stripePaymentMethodId;
            if (!pmId) continue;
            try {
              const pm = await stripe.paymentMethods.retrieve(pmId);
              const pmCustomer = pmCustomerId(pm);
              if (pmCustomer === targetCustomerId) {
                resolved.push(m);
                continue;
              }
              try {
                await stripe.paymentMethods.attach(pmId, { customer: targetCustomerId });
                console.log(`[AutoReplenish] Attached payment method ${m.id} to customer ${targetCustomerId} (was ${pmCustomer})`);
                resolved.push(m);
              } catch (attachErr: any) {
                const msg = String(attachErr?.message ?? "").toLowerCase();
                const belongsToOther =
                  msg.includes("already been attached to a different customer") ||
                  msg.includes("already attached to another customer") ||
                  msg.includes("does not belong to the customer") ||
                  msg.includes("use this paymentmethod with the customer that it belongs to");
                const unusable =
                  msg.includes("may not be used again") ||
                  msg.includes("detached from a customer") ||
                  msg.includes("previously used without being attached");
                if (belongsToOther || unusable) {
                  await db.delete(companyPaymentMethods).where(eq(companyPaymentMethods.id, m.id));
                  console.log(`[AutoReplenish] Removed payment method ${m.id} from DB (Stripe: ${unusable ? "PM no longer reusable" : "belongs to another customer"})`);
                } else {
                  console.warn(`[AutoReplenish] Could not attach payment method ${m.id} to customer:`, attachErr?.message);
                }
              }
            } catch (e: any) {
              if ((e as any)?.code === "resource_missing" || String((e as any)?.message ?? "").includes("No such payment_method")) {
                await db.delete(companyPaymentMethods).where(eq(companyPaymentMethods.id, m.id));
                console.log(`[AutoReplenish] Removed payment method ${m.id} from DB (Stripe PM no longer exists)`);
              } else {
                console.warn(`[AutoReplenish] Could not verify/attach payment method ${m.id}:`, (e as any)?.message);
              }
            }
          }
          allUsableStripeMethods = resolved;
        }
      } catch (e: any) {
        console.warn(`[AutoReplenish] Could not resolve payment methods by customer:`, (e as any)?.message);
      }
    }
    // Prefer ACH (no fee) over card (3.5% fee): try ACH methods first, then cards. Within each type, primary first then by createdAt.
    if (allUsableStripeMethods.length > 1) {
      allUsableStripeMethods = [...allUsableStripeMethods].sort((a, b) => {
        const aIsAch = a.type === "ach";
        const bIsAch = b.type === "ach";
        if (aIsAch !== bIsAch) return aIsAch ? -1 : 1;
        const aPrimary = (a.isPrimary === true) ? 1 : 0;
        const bPrimary = (b.isPrimary === true) ? 1 : 0;
        if (bPrimary !== aPrimary) return bPrimary - aPrimary;
        const aAt = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bAt = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bAt - aAt;
      });
    }
    const primaryCard = allUsableStripeMethods.find((m) => m.type === "card") ?? allUsableStripeMethods[0];

    if (allUsableStripeMethods.length === 0) {
      console.log(`[AutoReplenish] Company ${companyId} has no Stripe payment methods`);
      return { success: false, noChargeNeeded: false };
    }

    const currentBalance = profile.depositAmount || 0;
    const pendingPayments = await calculatePendingPayments(profile.id);
    const jobCommitments = await calculateJobCommitments(profile.id);
    const requiredCents = pendingPayments + jobCommitments;
    let shortfallCents = Math.max(0, requiredCents - currentBalance);
    if (shortfallCents <= 0 && options?.clientShortfallCents != null && options.clientShortfallCents > 0) {
      shortfallCents = options.clientShortfallCents;
      console.log(`[AutoReplenish] Company ${companyId}: using client shortfall $${(shortfallCents / 100).toFixed(2)} (server had Balance $${(currentBalance / 100).toFixed(2)}, Pending $${(pendingPayments / 100).toFixed(2)}, Commitments $${(jobCommitments / 100).toFixed(2)})`);
    }
    if (shortfallCents <= 0) {
      console.log(`[AutoReplenish] Company ${companyId}: Balance $${(currentBalance / 100).toFixed(2)} >= required $${(requiredCents / 100).toFixed(2)}, no charge needed`);
      return { success: false, noChargeNeeded: true };
    }
    const chargeAmountCents = Math.round(shortfallCents * (1 + REPLENISHMENT_BUFFER_PERCENT / 100));

    console.log(`[AutoReplenish] Company ${companyId}: Balance $${(currentBalance / 100).toFixed(2)}, ` +
      `Pending $${(pendingPayments / 100).toFixed(2)}, Commitments $${(jobCommitments / 100).toFixed(2)}, ` +
      `Shortfall $${(shortfallCents / 100).toFixed(2)}, Charge (+${REPLENISHMENT_BUFFER_PERCENT}%): $${(chargeAmountCents / 100).toFixed(2)}`);

    const locations = await getCompanyLocations(profile.id);
    const pendingByLocation = await getPendingByLocation(profile.id);
    const commitmentsByLocation = await getCommitmentsByLocation(profile.id);
    const companyData: CompanyCommitments = {
      companyId: profile.id,
      currentBalanceCents: currentBalance,
      pendingPaymentsCents: pendingPayments,
      jobCommitmentsCents: jobCommitments,
      totalNeededCents: requiredCents,
      targetBalanceCents: requiredCents,
      shortfallCents,
      chargeAmountCents,
      profile: profile,
      primaryCardPaymentMethod: primaryCard ?? undefined,
      allUsableStripeMethods: allUsableStripeMethods.length > 0 ? allUsableStripeMethods : undefined,
      locations: locations.length > 0 ? locations : undefined,
      pendingByLocation,
      commitmentsByLocation,
    };

    const ok = await processAutoReplenishment(companyData);
    return ok ? { success: true } : { success: false, noChargeNeeded: false };
  } catch (error: any) {
    console.error(`[AutoReplenish] Error checking company ${companyId}:`, error.message);
    return { success: false, noChargeNeeded: false };
  }
}

/**
 * Run after a worker is hired (application → accepted): attempt Stripe replenishment for balance shortfall.
 * On success or if no charge is needed, clear any payment holds when solvent.
 * On failure, set jobs.payment_hold_at so new applies and clock-in are blocked until funding succeeds.
 */
export async function afterHireFundingCheck(jobId: number, companyId: number): Promise<void> {
  const r = await triggerAutoReplenishmentForCompany(companyId);
  if (r.success || r.noChargeNeeded) {
    await clearPaymentHoldsForCompanyIfSolvent(companyId);
  } else {
    await db.update(jobs).set({ paymentHoldAt: new Date() }).where(eq(jobs.id, jobId));
    console.warn(`[PaymentHold] Job ${jobId}: payment_hold_at set after failed funding (company ${companyId})`);
    notifyCompanyPaymentFundingIssue(companyId).catch((e) =>
      console.warn("[PaymentHold] notifyCompanyPaymentFundingIssue:", e)
    );
  }
}
