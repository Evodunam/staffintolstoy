import { storage } from "../storage";
import { db } from "../db";
import { timesheets } from "@shared/schema";
import { eq } from "drizzle-orm";

const AUTO_APPROVAL_HOURS = 48;
const COMPANY_MARKUP = 1.52;

let isProcessing = false;

export async function processAutoApprovals(): Promise<{ processed: number; paid: number; failed: number }> {
  if (isProcessing) {
    console.log("[AutoApproval] Already processing, skipping this run");
    return { processed: 0, paid: 0, failed: 0 };
  }
  
  isProcessing = true;
  
  try {
    const cutoffTime = new Date(Date.now() - AUTO_APPROVAL_HOURS * 60 * 60 * 1000);
    
    const allPendingTimesheets = await db
      .select()
      .from(timesheets)
      .where(eq(timesheets.status, 'pending'));
    
    const expiredTimesheets = allPendingTimesheets.filter(ts => {
      const submissionTime = ts.submittedAt || ts.clockOutTime || ts.createdAt;
      return submissionTime && new Date(submissionTime) < cutoffTime;
    });
    
    if (expiredTimesheets.length === 0) {
      return { processed: 0, paid: 0, failed: 0 };
    }
    
    console.log(`[AutoApproval] Found ${expiredTimesheets.length} timesheets past 48-hour deadline`);
    
    let approvedCount = 0;
    let paidCount = 0;
    let failedCount = 0;
    
    for (const ts of expiredTimesheets) {
      try {
        const job = await storage.getJob(ts.jobId);
        const company = await storage.getProfile(ts.companyId);
        const worker = await storage.getProfile(ts.workerId);
        
        if (!company || !job) {
          console.error(`[AutoApproval] Missing company or job for timesheet ${ts.id}`);
          failedCount++;
          continue;
        }
        
        const hoursWorked = parseFloat(String(ts.adjustedHours || ts.totalHours)) || 0;
        const totalPay = Math.round(hoursWorked * ts.hourlyRate);
        const totalAmount = Math.round(totalPay * COMPANY_MARKUP);
        const platformFee = totalAmount - totalPay;
        
        console.log(`[AutoApproval] Processing timesheet ${ts.id}: ${hoursWorked}h @ $${(ts.hourlyRate/100).toFixed(2)}/hr = $${(totalPay/100).toFixed(2)} (company pays $${(totalAmount/100).toFixed(2)})`);
        
        await storage.updateTimesheet(ts.id, {
          status: 'approved',
          autoApprovedAt: new Date(),
          companyNotes: 'Auto-approved after 48 hours',
          totalPay,
          adjustedHours: String(hoursWorked),
        });
        approvedCount++;
        
        const workerName = worker ? `${worker.firstName || ''} ${worker.lastName || ''}`.trim() : 'Worker';
        const invoiceNumber = await storage.getNextInvoiceNumber();
        
        const invoice = await storage.createInvoice({
          invoiceNumber,
          companyId: company.id,
          workerId: ts.workerId,
          jobId: ts.jobId,
          status: "sent",
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          subtotal: totalPay,
          platformFee,
          taxAmount: 0,
          totalAmount,
          notes: `Auto-approved invoice for timesheet #${ts.id}`,
        });
        
        await storage.createInvoiceItem({
          invoiceId: invoice.id,
          description: `${workerName} - ${job.title} (${hoursWorked} hrs)`,
          quantity: hoursWorked.toString(),
          unitPrice: ts.hourlyRate,
          amount: totalPay,
          timesheetId: ts.id,
          workDate: ts.createdAt,
        });
        
        console.log(`[AutoApproval] Created invoice ${invoiceNumber} for timesheet ${ts.id}`);
        
        // Flow: trigger platform Mercury payment to worker; if successful, reduce company balance (no charging on approve).
        const hasW9 = worker?.w9UploadedAt != null;
        const hasBankAccount = !!(worker?.mercuryRecipientId && worker?.mercuryExternalAccountId);
        let payoutSuccess = false;
        
        if (worker && totalPay > 0 && !hasW9) {
          await storage.createWorkerPayout({
            workerId: worker.id,
            timesheetId: ts.id,
            jobId: ts.jobId,
            amount: totalPay,
            status: "pending_w9",
            description: `Held pending W-9 upload - ${job.title}`,
            hoursWorked: hoursWorked.toString(),
            hourlyRate: ts.hourlyRate,
          });
          await storage.updateTimesheet(ts.id, { paymentStatus: "pending" });
          console.log(`[AutoApproval] Worker ${worker.id} has no W-9 - $${(totalPay/100).toFixed(2)} held in escrow`);
        } else if (worker && totalPay > 0 && hasW9 && !hasBankAccount) {
          await storage.createWorkerPayout({
            workerId: worker.id,
            timesheetId: ts.id,
            jobId: ts.jobId,
            amount: totalPay,
            status: "pending_bank_setup",
            description: `Held pending bank account setup - ${job.title}`,
            hoursWorked: hoursWorked.toString(),
            hourlyRate: ts.hourlyRate,
          });
          await storage.updateTimesheet(ts.id, { paymentStatus: "pending" });
          console.log(`[AutoApproval] Worker ${worker.id} has no Mercury recipient - $${(totalPay/100).toFixed(2)} held in escrow`);
        } else if (worker && totalPay > 0 && hasW9 && hasBankAccount) {
          try {
            const { mercuryService } = await import("./mercury");
            console.log(`[AutoApproval] [Mercury] Platform paying worker ${worker.id} for timesheet ${ts.id}: $${(totalPay/100).toFixed(2)}`);
            const payment = await mercuryService.sendPayment({
              recipientId: worker.mercuryRecipientId!,
              amount: totalPay,
              description: `Payment for ${job.title} - Auto-approved Timesheet #${ts.id}`,
              idempotencyKey: `timesheet-payout-${ts.id}`,
              note: `Worker: ${worker.id}, Timesheet: ${ts.id}, Company: ${company.id}`,
            });
            await storage.createWorkerPayout({
              workerId: worker.id,
              timesheetId: ts.id,
              amount: totalPay,
              status: payment.status === "completed" ? "completed" : payment.status === "sent" ? "sent" : "pending",
              mercuryPaymentId: payment.id,
              mercuryPaymentStatus: payment.status,
            });
            await storage.updateTimesheet(ts.id, {
              paymentStatus: payment.status === "completed" ? "completed" : "pending",
            });
            payoutSuccess = true;
            paidCount++;
            console.log(`[AutoApproval] [Mercury] Platform payment to worker ${worker.id} completed for timesheet ${ts.id}`);
            // Reduce company balance by amount we paid the worker
            const freshCompany = await storage.getProfile(company.id);
            const currentBalance = Number(freshCompany?.depositAmount ?? company.depositAmount ?? 0);
            const newBalance = Math.max(0, currentBalance - totalPay);
            await storage.updateProfile(company.id, { depositAmount: newBalance });
            await storage.createCompanyTransaction({
              profileId: company.id,
              type: "charge",
              amount: totalPay,
              description: `Auto-approved Timesheet #${ts.id} - ${workerName} (platform paid worker) - ${hoursWorked} hrs`,
            });
            console.log(`[AutoApproval] Reduced company ${company.id} balance by $${(totalPay/100).toFixed(2)}. New balance: $${(newBalance/100).toFixed(2)}`);
          } catch (payoutErr: any) {
            console.error(`[AutoApproval] Worker payout failed for timesheet ${ts.id}:`, payoutErr.message);
            await storage.updateTimesheet(ts.id, { paymentStatus: "failed" });
            failedCount++;
          }
        }

        // (Old charge/payout block removed: we now do platform pay worker first, then deduct balance.)
      } catch (tsErr: any) {
        console.error(`[AutoApproval] Error processing timesheet ${ts.id}:`, tsErr.message);
        failedCount++;
      }
    }
    
    return { processed: approvedCount, paid: paidCount, failed: failedCount };
  } finally {
    isProcessing = false;
  }
}
