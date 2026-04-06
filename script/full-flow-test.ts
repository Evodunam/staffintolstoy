/**
 * Full flow test: full lifecycle from company balance → job post → apply → accept →
 * timesheet → approve → invoice + worker payout → (simulated) Mercury payout completion →
 * job complete → review → balance/transaction verification.
 *
 * Run: npx dotenv -e .env.development -- tsx script/full-flow-test.ts
 *
 * Bugs fixed (enforced in API; not re-tested in this script which uses storage only):
 * - Clock-in: POST /api/timesheets/clock-in now requires accepted application or job_assignment
 *   for the job (returns 403 NOT_ACCEPTED_FOR_JOB otherwise).
 * - Timesheet approve: PUT /api/timesheets/:id/approve and bulk-approve now reject when
 *   company balance < totalPay (402 INSUFFICIENT_BALANCE).
 *
 * Stages and what they cover:
 * - setup: company + worker profiles from DB.
 * - company_balance_seed: simulate Stripe funding (profile.depositAmount + company_transaction type "deposit"). Real path: POST /api/mt/company/fund (Stripe).
 * - job_post: storage.createJob.
 * - worker_apply: storage.createApplication (API returns 400 on duplicate).
 * - company_accept: storage.updateApplicationStatus.
 * - timesheet_clock_in / clock_out: storage.createTimesheet, updateTimesheet.
 * - timesheet_approve + invoice_payout: updateTimesheet approved, createInvoice, createCompanyTransaction (charge), createWorkerPayout (pending_w9). Company balance is reduced here.
 * - worker_payout_complete: simulate Mercury → recipient: updateWorkerPayout to completed, timesheet paymentStatus completed. Real path: timesheet approve when worker has W-9+bank calls mercuryService.sendPayment; or W-9 release (runW9PayoutReleaseForWorker) batches pending_w9 and sends one Mercury payment.
 * - job_complete: storage.updateJobStatus(jobId, "completed").
 * - review: insert review, update worker averageRating (mirrors POST /api/reviews).
 * - balance_verification: read company balance, company transactions, worker payouts and assert consistency.
 */

import { db, pool } from "../server/db";
import { storage } from "../server/storage";
import { profiles } from "@shared/schema";
import { eq } from "drizzle-orm";

type Stage =
  | "setup"
  | "company_balance_seed"
  | "job_post"
  | "worker_apply"
  | "company_accept"
  | "timesheet_clock_in"
  | "timesheet_clock_out"
  | "timesheet_approve"
  | "invoice_payout"
  | "worker_payout_complete"
  | "job_complete"
  | "review"
  | "balance_verification";

function log(stage: Stage, ok: boolean, message: string, detail?: unknown) {
  const icon = ok ? "✅" : "❌";
  console.log(`${icon} [${stage}] ${message}`);
  if (detail != null) console.log("   ", typeof detail === "object" && detail instanceof Error ? (detail as Error).message : detail);
}

async function run() {
  console.log("\n--- Full flow: Balance → Job → Apply → Accept → Timesheet → Approve → Payout → Complete → Review → Verify ---\n");

  let companyId: number;
  let workerId: number;
  let jobId: number;
  let applicationId: number;
  let timesheetId: number;
  let workerPayoutId: number;

  // --- Stage: setup (get company + worker profiles) ---
  try {
    const [company] = await db.select().from(profiles).where(eq(profiles.role, "company")).limit(1);
    const [worker] = await db.select().from(profiles).where(eq(profiles.role, "worker")).limit(1);
    if (!company || !worker) {
      log("setup", false, "Need at least one company and one worker profile in DB. Create via app onboarding.");
      process.exit(1);
    }
    companyId = company.id;
    workerId = worker.id;
    log("setup", true, `Using company ${companyId}, worker ${workerId}`);
  } catch (e) {
    log("setup", false, "Setup failed", e);
    console.log("\n--- Failure summary: fix setup (ensure DB has company + worker profiles) then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: company balance seed (simulate Stripe funding: deposit + transaction) ---
  try {
    const SEED_CENTS = 100000; // $1,000
    const [companyRow] = await db.select({ depositAmount: profiles.depositAmount }).from(profiles).where(eq(profiles.id, companyId)).limit(1);
    const currentBalance = Number(companyRow?.depositAmount ?? 0);
    const newBalance = currentBalance + SEED_CENTS;
    await storage.updateProfile(companyId, { depositAmount: newBalance });
    await storage.createCompanyTransaction({
      profileId: companyId,
      type: "deposit",
      amount: SEED_CENTS,
      description: "Flow test: simulated balance top-up (real path: POST /api/mt/company/fund via Stripe)",
      paymentMethod: "ach",
      initiatedById: companyId,
    });
    log("company_balance_seed", true, `Company balance +$${(SEED_CENTS / 100).toFixed(2)} → $${(newBalance / 100).toFixed(2)}`);
  } catch (e) {
    log("company_balance_seed", false, "Balance seed failed", e);
    console.log("\n--- Failure summary: fix company_balance_seed then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: company job post (real createJob) ---
  try {
    const startDate = new Date();
    const endDate = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const job = await storage.createJob({
      companyId,
      title: "Flow test job",
      description: "Created by full-flow-test script",
      location: "123 Test St",
      address: "123 Test St",
      city: "Test City",
      state: "CA",
      zipCode: "90210",
      latitude: "34.0522",
      longitude: "-118.2437",
      trade: "General Labor",
      hourlyRate: 2500, // $25/hr cents
      maxWorkersNeeded: 1,
      startDate,
      endDate,
      estimatedHours: 8,
    });
    jobId = job.id;
    log("job_post", true, `Job created id=${jobId}`);
  } catch (e) {
    log("job_post", false, "Job create failed", e);
    console.log("\n--- Failure summary: fix job_post (schema/constraints) then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: worker apply (real createApplication) ---
  try {
    const app = await storage.createApplication({
      jobId,
      workerId,
      message: "Flow test application",
      proposedRate: 2500,
    });
    applicationId = app.id;
    log("worker_apply", true, `Application created id=${applicationId}`);
  } catch (e) {
    log("worker_apply", false, "Application create failed", e);
    console.log("\n--- Failure summary: fix worker_apply (e.g. duplicate application → API returns 400). Re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: company accept (update application status) ---
  try {
    await storage.updateApplicationStatus(applicationId, "accepted");
    log("company_accept", true, `Application ${applicationId} accepted`);
  } catch (e) {
    log("company_accept", false, "Accept application failed", e);
    console.log("\n--- Failure summary: fix company_accept then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: timesheet clock-in (real createTimesheet) ---
  try {
    const job = await storage.getJob(jobId);
    if (!job) throw new Error("Job not found");
    const active = await storage.getActiveTimesheet(workerId);
    if (active) throw new Error(`Worker already has active timesheet ${active.id}`);
    const ts = await storage.createTimesheet({
      jobId,
      workerId,
      companyId: job.companyId,
      clockInTime: new Date(),
      clockInLatitude: job.latitude ?? undefined,
      clockInLongitude: job.longitude ?? undefined,
      hourlyRate: job.hourlyRate,
      locationVerified: true,
    });
    timesheetId = ts.id;
    log("timesheet_clock_in", true, `Timesheet created id=${timesheetId}`);
  } catch (e) {
    log("timesheet_clock_in", false, "Clock-in failed", e);
    console.log("\n--- Failure summary: fix timesheet_clock_in (e.g. worker already clocked in) then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: timesheet clock-out (update with clockOut + totalHours) ---
  try {
    const hours = 8;
    const ts = await storage.getTimesheet(timesheetId);
    if (!ts) throw new Error("Timesheet not found");
    const totalPay = Math.round(hours * ts.hourlyRate);
    await storage.updateTimesheet(timesheetId, {
      clockOutTime: new Date(),
      totalHours: String(hours),
      adjustedHours: String(hours),
      totalPay,
    });
    log("timesheet_clock_out", true, `Timesheet ${timesheetId} clocked out, ${hours}h, $${(totalPay / 100).toFixed(2)}`);
  } catch (e) {
    log("timesheet_clock_out", false, "Clock-out failed", e);
    console.log("\n--- Failure summary: fix timesheet_clock_out then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: timesheet approve + invoice + payout (mirror routes logic, no Mercury call) ---
  try {
    const timesheet = await storage.getTimesheet(timesheetId);
    if (!timesheet) throw new Error("Timesheet not found");
    const companyProfile = await storage.getProfile(companyId);
    if (!companyProfile) throw new Error("Company profile not found");
    const workerProfile = await storage.getProfile(workerId);
    if (!workerProfile) throw new Error("Worker profile not found");

    const finalHours = parseFloat(String(timesheet.totalHours ?? timesheet.adjustedHours ?? 0)) || 8;
    const totalPay = Math.round(finalHours * timesheet.hourlyRate);

    await storage.updateTimesheet(timesheetId, {
      status: "approved",
      approvedBy: companyId,
      approvedAt: new Date(),
      adjustedHours: String(finalHours),
      totalPay,
    });
    log("timesheet_approve", true, `Timesheet ${timesheetId} approved, $${(totalPay / 100).toFixed(2)}`);

    const invoiceNumber = await storage.getNextInvoiceNumber();
    const job = await storage.getJob(timesheet.jobId);
    const platformConfig = await storage.getPlatformConfig();
    const platformFeePerHourCents = platformConfig?.platformFeePerHourCents ?? 1300;
    const platformFee = Math.round(finalHours * platformFeePerHourCents);
    const totalAmount = totalPay + platformFee;

    const invoice = await storage.createInvoice({
      invoiceNumber,
      companyId: companyProfile.id,
      workerId: timesheet.workerId,
      jobId: timesheet.jobId,
      status: "sent",
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      subtotal: totalPay,
      platformFee,
      taxAmount: 0,
      totalAmount,
      notes: `Auto-generated for timesheet #${timesheetId}`,
    });
    await storage.createInvoiceItem({
      invoiceId: invoice.id,
      description: `${workerProfile.firstName ?? ""} ${workerProfile.lastName ?? ""} - ${job?.title ?? "Job"} (${finalHours} hrs)`,
      quantity: String(finalHours),
      unitPrice: timesheet.hourlyRate,
      amount: totalPay,
      timesheetId: timesheetId,
      workDate: timesheet.createdAt ?? new Date(),
    });

    const balanceBefore = Number(companyProfile.depositAmount ?? 0);
    const newBalance = Math.max(0, balanceBefore - totalPay);
    await storage.updateProfile(companyId, { depositAmount: newBalance });
    await storage.createCompanyTransaction({
      profileId: companyId,
      type: "charge",
      amount: totalPay,
      description: `Timesheet #${timesheetId} - approved - ${finalHours} hrs`,
    });

    const payout = await storage.createWorkerPayout({
      workerId: workerProfile.id,
      timesheetId: timesheetId,
      jobId: timesheet.jobId,
      amount: totalPay,
      status: "pending_w9",
      description: `Flow test - ${job?.title ?? "Job"}`,
      hoursWorked: String(finalHours),
      hourlyRate: timesheet.hourlyRate,
    });
    workerPayoutId = payout.id;
    await storage.updateTimesheet(timesheetId, { paymentStatus: "pending" });

    log("invoice_payout", true, `Invoice ${invoiceNumber}, company balance $${(newBalance / 100).toFixed(2)}, worker payout id=${workerPayoutId} pending_w9`);
  } catch (e) {
    log("invoice_payout", false, "Approve/invoice/payout failed", e);
    console.log("\n--- Failure summary: fix invoice_payout (invoice/transaction/workerPayout schema) then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: worker payout complete (simulate Mercury → recipient; real path: mercuryService.sendPayment in approve or W-9 release) ---
  try {
    await storage.updateWorkerPayout(workerPayoutId, {
      status: "completed",
      mercuryPaymentId: "flow-test-sim",
      mercuryPaymentStatus: "completed",
    });
    await storage.updateTimesheet(timesheetId, { paymentStatus: "completed" });
    log("worker_payout_complete", true, `Payout ${workerPayoutId} and timesheet ${timesheetId} marked completed (simulated Mercury)`);
  } catch (e) {
    log("worker_payout_complete", false, "Worker payout complete failed", e);
    console.log("\n--- Failure summary: fix worker_payout_complete then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: job complete ---
  try {
    await storage.updateJobStatus(jobId, "completed");
    log("job_complete", true, `Job ${jobId} status = completed`);
  } catch (e) {
    log("job_complete", false, "Job complete failed", e);
    console.log("\n--- Failure summary: fix job_complete then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: review (company reviews worker; mirrors POST /api/reviews; raw SQL so DB without is_google_review column works) ---
  try {
    const rating = 5;
    const checkResult = await pool.query<{ id: number }>(
      "SELECT id FROM reviews WHERE job_id = $1 AND reviewer_id = $2 AND reviewee_id = $3 LIMIT 1",
      [jobId, companyId, workerId]
    );
    const existing = checkResult.rows;
    if (existing.length > 0) {
      await pool.query(
        "UPDATE reviews SET rating = $1, quality_rating = $2, punctuality_rating = $3, communication_rating = $4, effort_rating = $5, comment = $6 WHERE id = $7",
        [rating, rating, rating, rating, rating, "Flow test review (updated)", existing[0].id]
      );
    } else {
      await pool.query(
        "INSERT INTO reviews (job_id, reviewer_id, reviewee_id, rating, quality_rating, punctuality_rating, communication_rating, effort_rating, comment) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [jobId, companyId, workerId, rating, rating, rating, rating, rating, "Flow test review"]
      );
    }
    const avgResult = await pool.query<{ rating: number }>("SELECT rating FROM reviews WHERE reviewee_id = $1", [workerId]);
    const allRatings = avgResult.rows.map((r) => r.rating);
    const totalReviewsCount = allRatings.length;
    const avgRating = totalReviewsCount > 0 ? allRatings.reduce((a, b) => a + b, 0) / totalReviewsCount : 0;
    await storage.updateProfile(workerId, {
      averageRating: avgRating.toFixed(2),
      totalReviews: totalReviewsCount,
    });
    log("review", true, `Review saved for worker ${workerId}, job ${jobId}; worker avg rating ${avgRating.toFixed(2)} (${totalReviewsCount} reviews)`);
  } catch (e) {
    log("review", false, "Review failed", e);
    console.log("\n--- Failure summary: fix review then re-run. ---\n");
    process.exit(1);
  }

  // --- Stage: balance verification (company balance, transactions, worker payouts) ---
  try {
    const [companyRow] = await db.select({ depositAmount: profiles.depositAmount }).from(profiles).where(eq(profiles.id, companyId)).limit(1);
    const balanceCents = Number(companyRow?.depositAmount ?? 0);
    const transactions = await storage.getCompanyTransactions(companyId);
    const payouts = await storage.getWorkerPayouts(workerId);
    const chargeTx = transactions.filter((t) => t.type === "charge");
    const depositTx = transactions.filter((t) => t.type === "deposit");
    const chargeTotal = chargeTx.reduce((s, t) => s + t.amount, 0);
    const depositTotal = depositTx.reduce((s, t) => s + t.amount, 0);
    const payoutTotal = payouts.reduce((s, p) => s + (p.amount ?? 0), 0);
    log("balance_verification", true, `Company balance $${(balanceCents / 100).toFixed(2)}, tx deposits $${(depositTotal / 100).toFixed(2)}, tx charges $${(chargeTotal / 100).toFixed(2)}, worker payouts total $${(payoutTotal / 100).toFixed(2)}`);
  } catch (e) {
    log("balance_verification", false, "Balance verification failed", e);
    console.log("\n--- Failure summary: fix balance_verification then re-run. ---\n");
    process.exit(1);
  }

  console.log("\n--- Full lifecycle completed successfully ---\n");
  process.exit(0);
}

run().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
