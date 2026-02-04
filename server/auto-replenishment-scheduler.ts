import { db } from "./db";
import { profiles, jobs, applications, companyTransactions, timesheets, companyPaymentMethods } from "@shared/schema";
import { eq, and, inArray, desc, or, isNotNull } from "drizzle-orm";
import mercuryService from "./services/mercury";
import { chargeCardOffSession, calculateCardFee } from "./services/stripe";

const REPLENISHMENT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const MINIMUM_BALANCE_CENTS = 200000; // $2,000 minimum balance

interface CompanyCommitments {
  companyId: number;
  currentBalanceCents: number;
  pendingPaymentsCents: number;
  jobCommitmentsCents: number;
  totalNeededCents: number;
  shortfallCents: number;
  profile: typeof profiles.$inferSelect;
  primaryCardPaymentMethod?: typeof companyPaymentMethods.$inferSelect;
}

async function calculateJobCommitments(companyId: number): Promise<number> {
  const companyJobs = await db.select({
    job: jobs,
  })
    .from(jobs)
    .where(
      and(
        eq(jobs.companyId, companyId),
        inArray(jobs.status, ["open", "in_progress"])
      )
    );

  let totalCommitments = 0;

  for (const { job } of companyJobs) {
    // Check if job has any accepted workers
    const acceptedApplications = await db.select()
      .from(applications)
      .where(
        and(
          eq(applications.jobId, job.id),
          eq(applications.status, "accepted")
        )
      );

    const acceptedWorkerCount = acceptedApplications.length;
    
    // Only count commitments for jobs with accepted workers
    // Matching frontend totalJobCommitments calculation: estimatedHours × hourlyRate × acceptedWorkers × 1.52 markup
    if (acceptedWorkerCount > 0) {
      const jobRate = job.hourlyRate || 2500;
      const estimatedHours = job.estimatedHours || 40;
      // Frontend calculation: (job.estimatedHours * job.hourlyRate * acceptedWorkers) then * 1.52 at the end
      const estimatedCost = Math.round(estimatedHours * jobRate * acceptedWorkerCount);
      totalCommitments += estimatedCost;
      
      console.log(`[AutoReplenish] Job ${job.id} (${job.title}): ` +
        `${acceptedWorkerCount} workers × $${(jobRate / 100).toFixed(2)}/hr × ${estimatedHours}hrs = $${(estimatedCost / 100).toFixed(2)}`);
    }
  }

  // Apply 1.52 markup at the end (matching frontend calculation)
  return Math.round(totalCommitments * 1.52);
}

async function calculatePendingPayments(companyId: number): Promise<number> {
  // Get pending timesheets for this company's jobs
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
        eq(timesheets.status, "pending")
      )
    );

  return pendingTs.reduce((sum, ts) => {
    const hours = parseFloat(ts.adjustedHours?.toString() || ts.totalHours?.toString() || "0");
    const rate = ts.hourlyRate || 2500;
    return sum + Math.round(hours * rate * 1.52);
  }, 0);
}

async function getCompaniesNeedingReplenishment(): Promise<CompanyCommitments[]> {
  // Get all company profiles that are actively using the platform
  // Include companies with complete onboarding OR those with payment methods linked
  const companies = await db.select()
    .from(profiles)
    .where(
      and(
        eq(profiles.role, "company"),
        or(
          eq(profiles.onboardingStatus, "complete"),
          // Include companies with bank accounts linked (actively using platform)
          and(
            isNotNull(profiles.mercuryRecipientId),
            isNotNull(profiles.mercuryExternalAccountId)
          )
        )
      )
    );

  console.log(`[AutoReplenish] Found ${companies.length} companies with complete onboarding or payment methods`);
  // Optimized: Batch fetch all payment methods at once instead of per-company
  const companyIds = companies.map(c => c.id);
  const allPaymentMethods = companyIds.length > 0 ? await db
    .select()
    .from(companyPaymentMethods)
    .where(
      and(
        inArray(companyPaymentMethods.profileId, companyIds),
        eq(companyPaymentMethods.type, "card")
      )
    )
    .orderBy(desc(companyPaymentMethods.isPrimary), desc(companyPaymentMethods.createdAt))
    : [];
  
  // Group payment methods by company ID, prioritizing primary cards
  const paymentMethodsByCompany = new Map<number, typeof allPaymentMethods[0]>();
  for (const method of allPaymentMethods) {
    if (!paymentMethodsByCompany.has(method.profileId) || method.isPrimary) {
      paymentMethodsByCompany.set(method.profileId, method);
    }
  }

  const needsReplenishment: CompanyCommitments[] = [];

  for (const company of companies) {
    // Check for payment methods: ACH (bank account) or card
    const hasBankAccount = company.mercuryRecipientId && company.mercuryExternalAccountId;
    
    // Get card payment method from pre-fetched map
    const cardPaymentMethod = paymentMethodsByCompany.get(company.id);
    
    // Skip if no payment method available (neither bank nor card)
    if (!hasBankAccount && !cardPaymentMethod) {
      console.log(`[AutoReplenish] Company ${company.id} (${company.companyName || company.firstName}) has no payment methods, skipping`);
      continue;
    }

    const currentBalance = company.depositAmount || 0;
    const pendingPayments = await calculatePendingPayments(company.id);
    const jobCommitments = await calculateJobCommitments(company.id);
    const totalNeeded = pendingPayments + jobCommitments + MINIMUM_BALANCE_CENTS;
    const shortfall = Math.max(0, totalNeeded - currentBalance);

    console.log(`[AutoReplenish] Company ${company.id} (${company.companyName || company.firstName}): ` +
      `Balance: $${(currentBalance / 100).toFixed(2)}, ` +
      `Pending: $${(pendingPayments / 100).toFixed(2)}, ` +
      `Commitments: $${(jobCommitments / 100).toFixed(2)}, ` +
      `Shortfall: $${(shortfall / 100).toFixed(2)}`);

    if (shortfall > 0) {
      needsReplenishment.push({
        companyId: company.id,
        currentBalanceCents: currentBalance,
        pendingPaymentsCents: pendingPayments,
        jobCommitmentsCents: jobCommitments,
        totalNeededCents: totalNeeded,
        shortfallCents: shortfall,
        profile: company,
        primaryCardPaymentMethod: cardPaymentMethod,
      });
    }
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
    const hasBankAccount = profile.mercuryRecipientId && profile.mercuryExternalAccountId;
    const hasCard = company.primaryCardPaymentMethod && 
                    company.primaryCardPaymentMethod.stripePaymentMethodId && 
                    profile.stripeCustomerId;

    // Try ACH first if bank account is available (lower fees)
    if (hasBankAccount) {
      try {
        // Request ACH debit from company via Mercury
        // Note: In production, company must have authorized ACH debits via Plaid or manual verification
        const debitRequest = await mercuryService.requestDebit({
          counterpartyName: profile.companyName || `${profile.firstName} ${profile.lastName}`,
          amount: company.shortfallCents,
          description: `Auto-replenishment: Commitments + $2,000 minimum balance`,
          idempotencyKey: `auto-recharge-${profile.id}-${Date.now()}`,
        });

        console.log(`[AutoReplenish] Created Mercury ACH debit request ${debitRequest.id} for $${(company.shortfallCents / 100).toFixed(2)}`);

        // Record in Mercury AR (invoice for this company payment, mark paid)
        mercuryService.recordCompanyPaymentAsMercuryInvoice(
          profile,
          company.shortfallCents,
          `Auto-replenishment via ACH: Commitments ($${(company.jobCommitmentsCents / 100).toFixed(2)}) + $2,000 minimum`,
          debitRequest.id
        ).catch((e) => console.warn("[AutoReplenish] Mercury AR invoice failed (non-blocking):", e?.message));

        await db.insert(companyTransactions).values({
          profileId: company.companyId,
          type: "auto_recharge",
          amount: company.shortfallCents,
          description: `Auto-replenishment via ACH: Commitments ($${(company.jobCommitmentsCents / 100).toFixed(2)}) + $2,000 minimum`,
          mercuryPaymentId: debitRequest.id,
          mercuryPaymentStatus: debitRequest.status || 'pending',
          paymentMethod: "ach",
        });

        // Update balance (ACH may be pending but we credit immediately for seamless experience)
        await db.update(profiles)
          .set({ depositAmount: (profile.depositAmount || 0) + company.shortfallCents })
          .where(eq(profiles.id, profile.id));

        return true;
      } catch (achError: any) {
        console.log(`[AutoReplenish] Mercury ACH debit failed: ${achError.message}, trying card...`);
        // Fall through to try card
      }
    }

    // Try card payment if available
    if (hasCard) {
      try {
        const cardMethod = company.primaryCardPaymentMethod!;
        const cardFee = calculateCardFee(company.shortfallCents);
        const totalCharge = company.shortfallCents + cardFee;

        console.log(`[AutoReplenish] Charging card (${cardMethod.cardBrand} ...${cardMethod.lastFour}) for $${(totalCharge / 100).toFixed(2)} (includes $${(cardFee / 100).toFixed(2)} fee)`);

        const chargeResult = await chargeCardOffSession({
          amount: totalCharge,
          customerId: profile.stripeCustomerId!,
          paymentMethodId: cardMethod.stripePaymentMethodId!,
          description: `Auto-replenishment: Commitments + $2,000 minimum balance`,
          metadata: {
            companyId: profile.id.toString(),
            type: "auto_recharge",
            commitments: (company.jobCommitmentsCents / 100).toFixed(2),
            pendingPayments: (company.pendingPaymentsCents / 100).toFixed(2),
            cardFee: (cardFee / 100).toFixed(2),
          },
        });

        if (chargeResult.success) {
          console.log(`[AutoReplenish] Card charge successful: ${chargeResult.paymentIntentId}`);

          // Record in Mercury AR (invoice for this company payment, mark paid)
          mercuryService.recordCompanyPaymentAsMercuryInvoice(
            profile,
            company.shortfallCents,
            `Auto-replenishment via card: Commitments ($${(company.jobCommitmentsCents / 100).toFixed(2)}) + $2,000 minimum`,
            chargeResult.paymentIntentId ?? undefined
          ).catch((e) => console.warn("[AutoReplenish] Mercury AR invoice failed (non-blocking):", e?.message));

          // Record main deposit transaction
          await db.insert(companyTransactions).values({
            profileId: company.companyId,
            type: "auto_recharge",
            amount: company.shortfallCents,
            description: `Auto-replenishment via card (${cardMethod.cardBrand} ...${cardMethod.lastFour}): Commitments ($${(company.jobCommitmentsCents / 100).toFixed(2)}) + $2,000 minimum`,
            stripePaymentIntentId: chargeResult.paymentIntentId,
            paymentMethod: "card",
          });

          // Record card fee transaction
          if (cardFee > 0) {
            await db.insert(companyTransactions).values({
              profileId: company.companyId,
              type: "card_fee",
              amount: -cardFee,
              description: `Card processing fee (3.5%) for auto-replenishment`,
              stripePaymentIntentId: chargeResult.paymentIntentId,
              paymentMethod: "card",
            });
          }

          // Update balance
          await db.update(profiles)
            .set({ depositAmount: (profile.depositAmount || 0) + company.shortfallCents })
            .where(eq(profiles.id, profile.id));

          return true;
        } else {
          console.error(`[AutoReplenish] Card charge failed: ${chargeResult.error}`);
        }
      } catch (cardError: any) {
        console.error(`[AutoReplenish] Card processing error: ${cardError.message}`);
      }
    }

    // Fallback: Sandbox simulation (only if no payment method worked)
    if (!hasBankAccount && !hasCard) {
      console.log(`[AutoReplenish] Company ${company.companyId} has no payment methods linked, skipping`);
      return false;
    }

    // If we reach here, both ACH and card failed - log and return false
    console.error(`[AutoReplenish] All payment methods failed for company ${company.companyId}`);
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
      console.log("[AutoReplenish] All companies have sufficient balance");
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
  console.log("[AutoReplenish] Starting auto-replenishment scheduler (checking every 5 minutes)");

  checkAndReplenishBalances();

  setInterval(() => {
    checkAndReplenishBalances();
  }, REPLENISHMENT_CHECK_INTERVAL_MS);
}

// Export function to trigger immediate replenishment check for a specific company
export async function triggerAutoReplenishmentForCompany(companyId: number): Promise<boolean> {
  console.log(`[AutoReplenish] Triggered immediate check for company ${companyId}`);
  
  try {
    const company = await db.select()
      .from(profiles)
      .where(eq(profiles.id, companyId))
      .limit(1);
    
    if (!company[0] || company[0].role !== "company") {
      console.log(`[AutoReplenish] Company ${companyId} not found or not a company`);
      return false;
    }
    
    const profile = company[0];
    const hasBankAccount = profile.mercuryRecipientId && profile.mercuryExternalAccountId;
    
    // Get card payment method
    const [cardPaymentMethod] = await db.select()
      .from(companyPaymentMethods)
      .where(
        and(
          eq(companyPaymentMethods.profileId, profile.id),
          eq(companyPaymentMethods.type, "card")
        )
      )
      .orderBy(desc(companyPaymentMethods.createdAt))
      .limit(1);
    
    if (!hasBankAccount && !cardPaymentMethod) {
      console.log(`[AutoReplenish] Company ${companyId} has no payment methods`);
      return false;
    }
    
    const currentBalance = profile.depositAmount || 0;
    const pendingPayments = await calculatePendingPayments(profile.id);
    const jobCommitments = await calculateJobCommitments(profile.id);
    const totalNeeded = pendingPayments + jobCommitments + MINIMUM_BALANCE_CENTS;
    const shortfall = Math.max(0, totalNeeded - currentBalance);
    
    console.log(`[AutoReplenish] Company ${companyId}: Balance $${(currentBalance / 100).toFixed(2)}, ` +
      `Commitments $${(jobCommitments / 100).toFixed(2)}, ` +
      `Shortfall $${(shortfall / 100).toFixed(2)}`);
    
    if (shortfall > 0) {
      const companyData: CompanyCommitments = {
        companyId: profile.id,
        currentBalanceCents: currentBalance,
        pendingPaymentsCents: pendingPayments,
        jobCommitmentsCents: jobCommitments,
        totalNeededCents: totalNeeded,
        shortfallCents: shortfall,
        profile: profile,
        primaryCardPaymentMethod: cardPaymentMethod,
      };
      
      return await processAutoReplenishment(companyData);
    }
    
    console.log(`[AutoReplenish] Company ${companyId} has sufficient balance`);
    return false;
  } catch (error: any) {
    console.error(`[AutoReplenish] Error checking company ${companyId}:`, error.message);
    return false;
  }
}
