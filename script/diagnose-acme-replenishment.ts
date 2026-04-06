/**
 * Diagnose why auto-replenishment is or isn't triggering for Acme (or any company by name).
 * Prints the exact DB values used by the scheduler: balance, pending, commitments, shortfall, payment methods.
 *
 * Usage:
 *   npx dotenv -e .env.development -- tsx script/diagnose-acme-replenishment.ts
 *   npx dotenv -e .env.development -- tsx script/diagnose-acme-replenishment.ts "Acme"
 */
import { config } from "dotenv";
import { resolve } from "path";
import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "../server/db";
import {
  profiles,
  jobs,
  applications,
  timesheets,
  companyPaymentMethods,
} from "@shared/schema";

const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
config({ path: resolve(process.cwd(), envFile), override: true });

const searchName = process.argv[2] ?? "Acme";

async function calculatePendingPayments(companyId: number): Promise<number> {
  const companyJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.companyId, companyId));
  const jobIds = companyJobs.map((j) => j.id);
  if (jobIds.length === 0) return 0;
  const pendingTs = await db
    .select()
    .from(timesheets)
    .where(and(inArray(timesheets.jobId, jobIds), eq(timesheets.status, "pending")));
  return pendingTs.reduce((sum, ts) => {
    const hours = parseFloat(ts.adjustedHours?.toString() || ts.totalHours?.toString() || "0");
    const rate = ts.hourlyRate || 2500;
    return sum + Math.round(hours * rate * 1.52);
  }, 0);
}

async function calculateJobCommitments(companyId: number): Promise<number> {
  const companyJobs = await db
    .select({ job: jobs })
    .from(jobs)
    .where(
      and(eq(jobs.companyId, companyId), inArray(jobs.status, ["open", "in_progress", "cancelled"]))
    );
  let totalCommitments = 0;
  for (const { job } of companyJobs) {
    const acceptedApplications = await db
      .select()
      .from(applications)
      .where(and(eq(applications.jobId, job.id), eq(applications.status, "accepted")));
    const acceptedWorkerCount = acceptedApplications.length;
    if (acceptedWorkerCount > 0) {
      const jobRate = job.hourlyRate || 2500;
      const estimatedHours = job.estimatedHours || 40;
      const estimatedCost = Math.round(estimatedHours * jobRate * acceptedWorkerCount);
      totalCommitments += estimatedCost;
    }
  }
  return Math.round(totalCommitments * 1.52);
}

async function main() {
  const companies = await db
    .select()
    .from(profiles)
    .where(eq(profiles.role, "company"));

  const match = companies.filter(
    (c) =>
      (c.companyName && c.companyName.toLowerCase().includes(searchName.toLowerCase())) ||
      (c.firstName && c.firstName.toLowerCase().includes(searchName.toLowerCase()))
  );

  if (match.length === 0) {
    console.log(`No company found matching "${searchName}". Companies in DB:`);
    companies.forEach((c) =>
      console.log(`  id=${c.id} companyName=${c.companyName ?? "(null)"} firstName=${c.firstName ?? "(null)"}`)
    );
    process.exit(1);
  }

  for (const company of match) {
    const name = company.companyName || company.firstName || `Company ${company.id}`;
    console.log("\n=== Company (scheduler uses these values) ===");
    console.log("  id:", company.id);
    console.log("  name:", name);
    console.log("  depositAmount (balance, cents):", company.depositAmount ?? 0, `($${((company.depositAmount ?? 0) / 100).toFixed(2)})`);
    console.log("  stripeCustomerId:", company.stripeCustomerId ?? "(null)");

    const pendingPayments = await calculatePendingPayments(company.id);
    const jobCommitments = await calculateJobCommitments(company.id);
    const requiredCents = pendingPayments + jobCommitments;
    const currentBalance = company.depositAmount ?? 0;
    const shortfallCents = Math.max(0, requiredCents - currentBalance);

    console.log("\n=== Replenishment math (same as scheduler) ===");
    console.log("  pendingPayments (cents):", pendingPayments, `($${(pendingPayments / 100).toFixed(2)})`);
    console.log("  jobCommitments (cents):", jobCommitments, `($${(jobCommitments / 100).toFixed(2)})`);
    console.log("  requiredCents (pending + commitments):", requiredCents, `($${(requiredCents / 100).toFixed(2)})`);
    console.log("  currentBalance (depositAmount):", currentBalance, `($${(currentBalance / 100).toFixed(2)})`);
    console.log("  shortfallCents (required - balance):", shortfallCents, `($${(shortfallCents / 100).toFixed(2)})`);

    const paymentMethods = await db
      .select()
      .from(companyPaymentMethods)
      .where(eq(companyPaymentMethods.profileId, company.id))
      .orderBy(desc(companyPaymentMethods.isPrimary), desc(companyPaymentMethods.createdAt));

    console.log("\n=== Payment methods (profileId = " + company.id + ") ===");
    if (paymentMethods.length === 0) {
      console.log("  (none)");
    } else {
      paymentMethods.forEach((m, i) => {
        const hasStripe = !!m.stripePaymentMethodId;
        const usable = m.type === "card" || (m.type === "ach" && m.isVerified === true);
        const usableForScheduler = hasStripe && usable;
        console.log(
          `  [${i + 1}] id=${m.id} type=${m.type} stripePaymentMethodId=${m.stripePaymentMethodId ?? "(null)"} isVerified=${m.isVerified} isPrimary=${m.isPrimary} lastFour=${m.lastFour} → usable for scheduler: ${usableForScheduler}`
        );
      });
    }

    const usableStripeMethods = paymentMethods.filter((m) => {
      if (!m.stripePaymentMethodId) return false;
      return m.type === "card" || (m.type === "ach" && m.isVerified === true);
    });

    console.log("\n=== Why charge does or doesn't happen ===");
    if (shortfallCents <= 0) {
      console.log("  SHORTFALL <= 0 → scheduler skips (no charge attempt). Balance is sufficient per scheduler math.");
    } else if (usableStripeMethods.length === 0) {
      console.log(
        "  SHORTFALL > 0 but NO USABLE STRIPE METHODS → scheduler skips. Need at least one: card, or ACH with isVerified=true and stripePaymentMethodId set."
      );
    } else {
      const chargeCents = Math.round(shortfallCents * 1.3);
      console.log(
        `  SHORTFALL > 0 and ${usableStripeMethods.length} usable method(s) → scheduler SHOULD attempt charge of $${(chargeCents / 100).toFixed(2)} (+30%).`
      );
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
