/**
 * Reset affiliate commissions from paid back to pending (for re-testing payout flow).
 * Runs directly against the database — server does not need to be running.
 *
 * Usage:
 *   npx dotenv -e .env.development -- tsx script/reset-affiliate-commissions.ts
 *   npx dotenv -e .env.development -- tsx script/reset-affiliate-commissions.ts 2
 *
 * Optional: pass affiliateId as first arg (default: 1).
 */
import "dotenv/config";
import { db } from "../server/db";
import { affiliateCommissions } from "@shared/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const affiliateId = Number(process.argv[2] ?? 1);
  if (!affiliateId || Number.isNaN(affiliateId)) {
    console.error("Usage: npx tsx script/reset-affiliate-commissions.ts [affiliateId]");
    process.exit(1);
  }

  const result = await db
    .update(affiliateCommissions)
    .set({ status: "pending", paidAt: null })
    .where(and(eq(affiliateCommissions.affiliateId, affiliateId), eq(affiliateCommissions.status, "paid")))
    .returning();

  console.log(`Reset ${result.length} commission(s) to pending for affiliate ${affiliateId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
