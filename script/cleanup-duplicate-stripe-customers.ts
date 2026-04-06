/**
 * Find and optionally delete duplicate Stripe customers for the same company.
 * One account = one Stripe customer. Canonical ID is profiles.stripe_customer_id.
 * Also fixes companies with no stripe_customer_id in DB but multiple in Stripe: picks one, saves to DB, deletes the rest.
 *
 * Usage:
 *   # List duplicates only (dry run)
 *   npx dotenv -e .env.development -- tsx script/cleanup-duplicate-stripe-customers.ts
 *
 *   # Actually delete duplicate customers from Stripe (and set canonical in DB where missing)
 *   npx dotenv -e .env.development -- tsx script/cleanup-duplicate-stripe-customers.ts --delete
 */
import { config } from "dotenv";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { profiles } from "@shared/schema";
import stripeService from "../server/services/stripe";

const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
config({ path: resolve(process.cwd(), envFile), override: true });

const doDelete = process.argv.includes("--delete");

type StripeCustomerRow = { id: string; created: number; name?: string; metadata?: Record<string, string> };

async function main() {
  if (!stripeService.isStripeConfigured()) {
    console.error("❌ Stripe is not configured (STRIPE_TEST_SECRET_KEY or STRIPE_SECRET_KEY).");
    process.exit(1);
  }
  const stripe = stripeService.getStripe();

  const companyProfiles = await db
    .select({ id: profiles.id, stripeCustomerId: profiles.stripeCustomerId, companyName: profiles.companyName })
    .from(profiles)
    .where(eq(profiles.role, "company"));

  const canonicalByProfileId = new Map<number, string | null>();
  for (const p of companyProfiles) {
    canonicalByProfileId.set(p.id, p.stripeCustomerId ?? null);
  }

  // Group all Stripe customers with metadata.role=company and metadata.profileId by profileId
  const byProfileId = new Map<number, StripeCustomerRow[]>();
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const list = await stripe.customers.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const c of list.data) {
      const profileId = c.metadata?.profileId;
      const role = c.metadata?.role;
      if (role !== "company" || profileId == null) continue;
      const pid = parseInt(profileId, 10);
      if (Number.isNaN(pid)) continue;
      const arr = byProfileId.get(pid) ?? [];
      arr.push({
        id: c.id,
        created: typeof c.created === "number" ? c.created : 0,
        name: c.name ?? undefined,
        metadata: c.metadata as Record<string, string> | undefined,
      });
      byProfileId.set(pid, arr);
    }
    hasMore = list.has_more;
    if (list.data.length > 0) startingAfter = list.data[list.data.length - 1].id;
    else hasMore = false;
  }

  const toDelete: { customerId: string; profileId: number; name?: string }[] = [];
  const toSetInDb: { profileId: number; customerId: string }[] = [];

  for (const [profileId, customers] of byProfileId) {
    const canonical = canonicalByProfileId.get(profileId) ?? null;
    if (customers.length === 0) continue;
    if (canonical != null) {
      for (const c of customers) {
        if (c.id !== canonical) toDelete.push({ customerId: c.id, profileId, name: c.name });
      }
    } else {
      // No canonical in DB: pick oldest (first created) as the one to keep, set in DB, delete the rest
      const sorted = [...customers].sort((a, b) => a.created - b.created);
      const keep = sorted[0];
      toSetInDb.push({ profileId, customerId: keep.id });
      for (let i = 1; i < sorted.length; i++) {
        toDelete.push({ customerId: sorted[i].id, profileId, name: sorted[i].name });
      }
    }
  }

  if (toDelete.length === 0 && toSetInDb.length === 0) {
    console.log("✅ No duplicate Stripe customers found (each company has at most one customer).");
    return;
  }

  if (toSetInDb.length > 0) {
    console.log(`Companies with no stripe_customer_id in DB but Stripe customers (will set canonical and remove rest):`);
    for (const x of toSetInDb) {
      const count = byProfileId.get(x.profileId)?.length ?? 0;
      console.log(`  profileId=${x.profileId} → set canonical ${x.customerId} (${count - 1} duplicate(s) to delete)`);
    }
  }
  if (toDelete.length > 0) {
    console.log(`\nDuplicate Stripe customer(s) to delete (${toDelete.length} total):`);
    for (const d of toDelete) {
      const canonical = canonicalByProfileId.get(d.profileId) ?? (toSetInDb.find((x) => x.profileId === d.profileId)?.customerId ?? "—");
      console.log(`  ${d.customerId}  (profileId=${d.profileId}, name=${d.name ?? "—"})  → canonical ${canonical}`);
    }
  }

  if (!doDelete) {
    console.log("\nDry run. To apply (set DB + delete from Stripe), run with --delete");
    return;
  }

  console.log("\nApplying changes...");
  for (const x of toSetInDb) {
    try {
      await db.update(profiles).set({ stripeCustomerId: x.customerId }).where(eq(profiles.id, x.profileId));
      console.log(`  Set profile ${x.profileId} stripe_customer_id = ${x.customerId}`);
    } catch (err: any) {
      console.error(`  Failed to set profile ${x.profileId}:`, err?.message ?? err);
    }
  }
  for (const d of toDelete) {
    try {
      await stripe.customers.del(d.customerId);
      console.log(`  Deleted ${d.customerId}`);
    } catch (err: any) {
      console.error(`  Failed to delete ${d.customerId}:`, err?.message ?? err);
    }
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
