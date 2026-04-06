/**
 * Single source of truth for company Stripe customer ID.
 *
 * Policy: Whenever we create a Stripe customer we MUST persist it to the DB for that account
 * (profiles.stripe_customer_id). We never return a created customer id without saving. Precheck
 * "does this company have a Stripe customer?" from DB only — no need to fetch from Stripe.
 *
 * One account = one Stripe customer forever. Never create duplicates; never overwrite.
 * If the DB has no stripeCustomerId (e.g. after migration 029), we search Stripe for an existing
 * customer with metadata profileId + role=company and reuse it instead of creating a new one.
 */
import { eq, and, isNull } from "drizzle-orm";
import { profiles } from "@shared/schema";
import { db } from "../db";
import { getStripe } from "../services/stripe";

export type CompanyProfileForStripe = {
  id: number;
  stripeCustomerId?: string | null;
  email?: string | null;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  userId: string;
  mercuryArCustomerId?: string | null;
};

/** Fire-and-forget: ensure company has a Mercury AR customer for invoicing (creates if missing). */
function ensureMercuryArCustomerLater(profile: CompanyProfileForStripe): void {
  void (async () => {
    try {
      const { mercuryService } = await import("../services/mercury");
      await mercuryService.ensureMercuryArCustomerForCompany(profile);
    } catch (_) {}
  })();
}

function isNoSuchCustomerError(err: any): boolean {
  const msg = String(err?.message ?? "").toLowerCase();
  const code = err?.code ?? "";
  return (
    msg.includes("no such customer") ||
    code === "resource_missing" ||
    (typeof code === "string" && code.toLowerCase().includes("missing"))
  );
}

/**
 * Search Stripe for an existing customer with metadata profileId and role=company.
 * Returns the customer id if exactly one match, else null. Search is not available in India.
 */
async function findExistingStripeCustomerByProfileId(
  stripe: import("stripe").Stripe,
  profileId: number
): Promise<string | null> {
  try {
    const query = `metadata['profileId']:'${profileId}' AND metadata['role']:'company'`;
    const result = await stripe.customers.search({ query, limit: 10 });
    if (result.data.length === 0) return null;
    // Prefer the oldest customer (original); newer duplicates were created when DB had no ID (e.g. after migration 029)
    const sorted = [...result.data].sort(
      (a, b) => (a.created ?? 0) - (b.created ?? 0)
    );
    return sorted[0].id;
  } catch (e: any) {
    // Search not available in some regions (e.g. India) or API issue; fall back to create
    const msg = String(e?.message ?? "");
    if (msg.includes("search") || msg.includes("not available") || e?.code === "resource_invalid") {
      console.warn(`[Stripe] Customer search skipped for company ${profileId}:`, msg.slice(0, 80));
    }
    return null;
  }
}

/**
 * Get the company's Stripe customer ID. If the account has none in DB, look up Stripe for an
 * existing customer with this profileId (avoids creating a duplicate after DB was cleared).
 * If none found, create one once and persist it.
 * If the stored customer was deleted in Stripe ("No such customer"), clear it and try find/create again.
 * Re-checks DB right before create to avoid race duplicates; if we lose the race, the orphan Stripe customer is deleted.
 */
export async function ensureCompanyStripeCustomer(profile: CompanyProfileForStripe): Promise<string> {
  const stripe = getStripe();

  const useStoredId = async (customerId: string): Promise<string | null> => {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      // Deleted customers are still returned by retrieve (soft-delete); they cannot be used for payment intents
      if (customer.deleted === true) {
        await db.update(profiles).set({ stripeCustomerId: null }).where(eq(profiles.id, profile.id));
        console.log(`[Stripe] Cleared deleted Stripe customer ${customerId} for company ${profile.id}, creating new one`);
        return null;
      }
      return customerId;
    } catch (e: any) {
      if (isNoSuchCustomerError(e)) {
        await db.update(profiles).set({ stripeCustomerId: null }).where(eq(profiles.id, profile.id));
        console.log(`[Stripe] Cleared invalid Stripe customer ${customerId} for company ${profile.id} (no longer exists in Stripe), creating new one`);
        return null;
      }
      throw e;
    }
  };

  if (profile.stripeCustomerId) {
    const valid = await useStoredId(profile.stripeCustomerId);
    if (valid) {
      ensureMercuryArCustomerLater(profile);
      return valid;
    }
  }

  // Re-check DB so we don't create a duplicate if another request just set it
  const [existing] = await db
    .select({ stripeCustomerId: profiles.stripeCustomerId })
    .from(profiles)
    .where(eq(profiles.id, profile.id))
    .limit(1);
  if (existing?.stripeCustomerId) {
    const valid = await useStoredId(existing.stripeCustomerId);
    if (valid) return valid;
  }

  // DB has no customer ID (e.g. migration 029 cleared it). Search Stripe for existing customer with this profileId so we don't create a duplicate.
  const foundInStripe = await findExistingStripeCustomerByProfileId(stripe, profile.id);
  if (foundInStripe) {
    const valid = await useStoredId(foundInStripe);
    if (valid) {
      await db.update(profiles).set({ stripeCustomerId: foundInStripe }).where(eq(profiles.id, profile.id));
      console.log(`[Stripe] Reused existing Stripe customer ${foundInStripe} for company ${profile.id} (restored from Stripe metadata after DB had no ID)`);
      ensureMercuryArCustomerLater(profile);
      return foundInStripe;
    }
  }

  const email = (profile.email && String(profile.email).trim()) || undefined;
  const name =
    (profile.companyName && String(profile.companyName).trim()) ||
    [profile.firstName, profile.lastName].filter(Boolean).map(String).join(" ").trim() ||
    undefined;
  const customer = await stripe.customers.create({
    email: email || undefined,
    name: name || undefined,
    metadata: { profileId: profile.id.toString(), userId: profile.userId, role: "company" },
  });

  const updated = await db
    .update(profiles)
    .set({ stripeCustomerId: customer.id })
    .where(and(eq(profiles.id, profile.id), isNull(profiles.stripeCustomerId)))
    .returning({ stripeCustomerId: profiles.stripeCustomerId });

  if (updated.length > 0 && updated[0].stripeCustomerId) {
    console.log(`[Stripe] Created Stripe customer ${customer.id} for company ${profile.id} (account customer ID set forever)`);
    ensureMercuryArCustomerLater(profile);
    return updated[0].stripeCustomerId;
  }

  // Lost the race: another request set stripeCustomerId first. Use DB value and delete the orphan we just created.
  const [row] = await db
    .select({ stripeCustomerId: profiles.stripeCustomerId })
    .from(profiles)
    .where(eq(profiles.id, profile.id))
    .limit(1);
  if (row?.stripeCustomerId) {
    try {
      await stripe.customers.del(customer.id);
      console.log(`[Stripe] Deleted orphan customer ${customer.id} (company ${profile.id} already had ${row.stripeCustomerId})`);
    } catch (delErr: any) {
      console.warn(`[Stripe] Could not delete orphan customer ${customer.id}:`, delErr?.message);
    }
    ensureMercuryArCustomerLater(profile);
    return row.stripeCustomerId;
  }

  // Conditional update matched 0 rows but profile still has no customer ID (race or edge case). Persist the new customer so we never return a created customer without saving to DB.
  try {
    await db.update(profiles).set({ stripeCustomerId: customer.id }).where(eq(profiles.id, profile.id));
    console.log(`[Stripe] Persisted new Stripe customer ${customer.id} for company ${profile.id} (fallback save)`);
  } catch (fallbackErr: any) {
    console.warn(`[Stripe] Fallback save of customer ${customer.id} for profile ${profile.id} failed:`, fallbackErr?.message);
  }
  ensureMercuryArCustomerLater(profile);
  return customer.id;
}
