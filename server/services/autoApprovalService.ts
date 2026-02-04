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
          adjustedHours: hoursWorked,
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
        
        // Ensure company has a primary payment method (required for catch-all fallback)
        const methods = await storage.getCompanyPaymentMethods(company.id);
        const hasPrimary = methods.some((m: any) => m.isPrimary ?? m.is_primary);
        if (!hasPrimary && methods.length > 0) {
          const firstUsable = methods.find((m: any) => {
            const hasStripe = !!(m.stripePaymentMethodId ?? m.stripe_payment_method_id);
            const isMercury = !!((m.mercuryRecipientId ?? m.mercury_recipient_id) || (m.mercuryExternalAccountId ?? m.mercury_external_account_id));
            return hasStripe && !isMercury && (m.type === "card" || (m.type === "ach" && (m.isVerified ?? m.is_verified)));
          }) ?? methods[0];
          if (firstUsable) await storage.updateCompanyPaymentMethod(firstUsable.id, { isPrimary: true });
        }

        let paymentCharged = false;
        
        if (job.companyLocationId) {
          const location = await storage.getCompanyLocation(job.companyLocationId);
          
          if (location && location.paymentMethodId) {
            const paymentMethod = await storage.getCompanyPaymentMethod(location.paymentMethodId);
            
            if (paymentMethod) {
              if (paymentMethod.type === "card" && paymentMethod.stripePaymentMethodId && company.stripeCustomerId) {
                console.log(`[AutoApproval] Charging location card (${paymentMethod.cardBrand} ...${paymentMethod.lastFour})`);
                
                try {
                  const { chargeCardOffSession, CARD_FEE_PERCENTAGE } = await import("./stripe");
                  const cardFee = Math.round(totalAmount * (CARD_FEE_PERCENTAGE / 100));
                  const totalWithFee = totalAmount + cardFee;
                  
                  const chargeResult = await chargeCardOffSession({
                    amount: totalWithFee,
                    customerId: company.stripeCustomerId,
                    paymentMethodId: paymentMethod.stripePaymentMethodId,
                    description: `Auto-approved Timesheet #${ts.id} - ${location.name}`,
                    metadata: {
                      companyId: company.id.toString(),
                      timesheetId: ts.id.toString(),
                      locationId: location.id.toString(),
                      type: "auto_approval_charge",
                    },
                  });
                  
                  if (chargeResult.success && chargeResult.paymentIntentId) {
                    paymentCharged = true;
                    
                    await storage.createCompanyTransaction({
                      profileId: company.id,
                      type: "charge",
                      amount: totalAmount,
                      description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs)`,
                      paymentMethod: "card",
                      stripePaymentIntentId: chargeResult.paymentIntentId,
                      cardFee,
                    });
                    
                    await storage.updateInvoice(invoice.id, {
                      status: "paid",
                      paidAt: new Date(),
                    });
                    
                    console.log(`[AutoApproval] Card charged successfully for timesheet ${ts.id}`);
                  } else {
                    console.warn(`[AutoApproval] Card charge failed for timesheet ${ts.id}: ${chargeResult.error}`);
                  }
                } catch (cardErr: any) {
                  console.error(`[AutoApproval] Card charge error for timesheet ${ts.id}:`, cardErr.message);
                }
              }
              else if (paymentMethod.type === "ach" && paymentMethod.stripePaymentMethodId && company.stripeCustomerId) {
                console.log(`[AutoApproval] Charging location Stripe ACH (${paymentMethod.bankName} ...${paymentMethod.lastFour})`);
                
                try {
                  const { chargeAchOffSession } = await import("./stripe");
                  
                  const chargeResult = await chargeAchOffSession({
                    amount: totalAmount,
                    customerId: company.stripeCustomerId,
                    paymentMethodId: paymentMethod.stripePaymentMethodId,
                    description: `Auto-approved Timesheet #${ts.id} - ${location.name}`,
                    metadata: {
                      companyId: company.id.toString(),
                      timesheetId: ts.id.toString(),
                      locationId: location.id.toString(),
                      type: "auto_approval_charge",
                    },
                  });
                  
                  if (chargeResult.success && chargeResult.paymentIntentId) {
                    paymentCharged = true;
                    await storage.createCompanyTransaction({
                      profileId: company.id,
                      type: "charge",
                      amount: totalAmount,
                      description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs) (ACH)`,
                      paymentMethod: "ach",
                      stripePaymentIntentId: chargeResult.paymentIntentId,
                      cardFee: 0,
                    });
                    await storage.updateInvoice(invoice.id, { status: "paid", paidAt: new Date() });
                    console.log(`[AutoApproval] Stripe ACH charged successfully for timesheet ${ts.id}`);
                  } else {
                    console.warn(`[AutoApproval] Stripe ACH charge failed: ${chargeResult.error}`);
                  }
                } catch (achErr: any) {
                  console.error(`[AutoApproval] Stripe ACH charge error:`, achErr.message);
                }
              }
              else if (paymentMethod.type === "ach" && paymentMethod.mtCounterpartyId && paymentMethod.mtExternalAccountId) {
                console.log(`[AutoApproval] Charging location MT ACH (${paymentMethod.bankName} ...${paymentMethod.lastFour})`);
                
                try {
                  const mtModule = await import("./modernTreasury");
                  const modernTreasuryService = mtModule.default;
                  const getPlatformInternalAccountId = mtModule.getPlatformInternalAccountId;
                  const platformAccountId = await getPlatformInternalAccountId();
                  
                  const paymentOrder = await modernTreasuryService.createACHDebit({
                    originatingAccountId: platformAccountId,
                    counterpartyId: paymentMethod.mtCounterpartyId,
                    receivingAccountId: paymentMethod.mtExternalAccountId,
                    amount: totalAmount,
                    description: `Auto-approved Timesheet #${ts.id} - ${location.name}`,
                    metadata: {
                      companyId: company.id.toString(),
                      timesheetId: ts.id.toString(),
                      type: "auto_approval_charge",
                    },
                  });
                  
                  paymentCharged = true;
                  
                  await storage.createCompanyTransaction({
                    profileId: company.id,
                    type: "charge",
                    amount: totalAmount,
                    description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs) (ACH)`,
                    paymentMethod: "ach",
                    mtPaymentOrderId: paymentOrder.id,
                    mtPaymentStatus: paymentOrder.status,
                    cardFee: 0,
                  });
                  
                  await storage.updateInvoice(invoice.id, {
                    status: "sent",
                  });
                  
                  console.log(`[AutoApproval] ACH charge initiated for timesheet ${ts.id} - pending settlement`);
                } catch (achErr: any) {
                  console.error(`[AutoApproval] ACH charge error for timesheet ${ts.id}:`, achErr.message);
                }
              }
            }
          }
        }
        
        if (!paymentCharged) {
          const primaryPaymentMethod = await storage.getPrimaryPaymentMethod(company.id);
          
          if (primaryPaymentMethod && primaryPaymentMethod.type === "card" && primaryPaymentMethod.stripePaymentMethodId && company.stripeCustomerId) {
            console.log(`[AutoApproval] Charging primary card (${primaryPaymentMethod.cardBrand} ...${primaryPaymentMethod.lastFour})`);
            
            try {
              const { chargeCardOffSession, CARD_FEE_PERCENTAGE } = await import("./stripe");
              const cardFee = Math.round(totalAmount * (CARD_FEE_PERCENTAGE / 100));
              const totalWithFee = totalAmount + cardFee;
              
              const chargeResult = await chargeCardOffSession({
                amount: totalWithFee,
                customerId: company.stripeCustomerId,
                paymentMethodId: primaryPaymentMethod.stripePaymentMethodId,
                description: `Auto-approved Timesheet #${ts.id}`,
                metadata: {
                  companyId: company.id.toString(),
                  timesheetId: ts.id.toString(),
                  type: "auto_approval_charge",
                },
              });
              
              if (chargeResult.success && chargeResult.paymentIntentId) {
                paymentCharged = true;
                
                await storage.createCompanyTransaction({
                  profileId: company.id,
                  type: "charge",
                  amount: totalAmount,
                  description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs)`,
                  paymentMethod: "card",
                  stripePaymentIntentId: chargeResult.paymentIntentId,
                  cardFee,
                });
                
                await storage.updateInvoice(invoice.id, {
                  status: "paid",
                  paidAt: new Date(),
                });
                
                console.log(`[AutoApproval] Primary card charged successfully for timesheet ${ts.id}`);
              }
            } catch (cardErr: any) {
              console.error(`[AutoApproval] Primary card charge error:`, cardErr.message);
            }
          }
          
          if (!paymentCharged) {
            const currentBalance = company.depositAmount || 0;
            
            if (currentBalance >= totalAmount) {
              const newBalance = currentBalance - totalAmount;
              await storage.updateProfile(company.id, { depositAmount: newBalance });
              
              await storage.createCompanyTransaction({
                profileId: company.id,
                type: "charge",
                amount: totalAmount,
                description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs)`,
                paymentMethod: "balance",
              });
              
              await storage.updateInvoice(invoice.id, {
                status: "paid",
                paidAt: new Date(),
              });
              
              paymentCharged = true;
              console.log(`[AutoApproval] Balance deducted for timesheet ${ts.id}: $${(totalAmount/100).toFixed(2)}`);
            } else {
              console.warn(`[AutoApproval] Insufficient balance for timesheet ${ts.id}: $${(currentBalance/100).toFixed(2)} < $${(totalAmount/100).toFixed(2)}`);
            }
          }
        }
        
        if (!paymentCharged) {
          console.warn(`[AutoApproval] All payment methods failed for timesheet ${ts.id} - marking as payment_failed`);
          await storage.updateTimesheet(ts.id, { 
            paymentStatus: "failed",
            companyNotes: 'Auto-approved after 48 hours - payment failed, retry required',
          });
          failedCount++;
          continue;
        }
        
        if (paymentCharged && worker && worker.mtCounterpartyId && worker.mtExternalAccountId && totalPay > 0) {
          try {
            const mtModule = await import("./modernTreasury");
            const modernTreasuryService = mtModule.default;
            const getPlatformInternalAccountId = mtModule.getPlatformInternalAccountId;
            const platformAccountId = await getPlatformInternalAccountId();
            
            const paymentOrder = await modernTreasuryService.createACHCredit({
              originatingAccountId: platformAccountId,
              counterpartyId: worker.mtCounterpartyId,
              receivingAccountId: worker.mtExternalAccountId,
              amount: totalPay,
              description: `Payment for ${job.title} - Auto-approved Timesheet #${ts.id}`,
              metadata: {
                workerId: worker.id.toString(),
                timesheetId: ts.id.toString(),
                type: "worker_payout",
              },
            });
            
            await storage.createWorkerPayout({
              workerId: worker.id,
              timesheetId: ts.id,
              amount: totalPay,
              status: paymentOrder.status === "completed" ? "completed" : "pending",
              mtPaymentOrderId: paymentOrder.id,
              mtPaymentStatus: paymentOrder.status,
            });
            
            await storage.updateTimesheet(ts.id, {
              paymentStatus: paymentOrder.status === "completed" ? "completed" : "pending",
            });
            
            paidCount++;
            console.log(`[AutoApproval] Worker payout initiated for timesheet ${ts.id}: $${(totalPay/100).toFixed(2)}`);
          } catch (payoutErr: any) {
            console.error(`[AutoApproval] Worker payout failed for timesheet ${ts.id}:`, payoutErr.message);
            await storage.updateTimesheet(ts.id, { paymentStatus: "failed" });
          }
        } else if (paymentCharged && worker && (!worker.mtCounterpartyId || !worker.mtExternalAccountId)) {
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
          console.log(`[AutoApproval] Worker ${worker.id} has no bank account - $${(totalPay/100).toFixed(2)} held in escrow`);
        }
        
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
