import { db } from "./db";
import { invoices, profiles, jobs, timesheets, invoiceItems } from "@shared/schema";
import { eq, and, inArray, isNull, ne } from "drizzle-orm";
import { sendEmail } from "./email-service";
import { format } from "date-fns";

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface OpenInvoiceSummary {
  companyId: number;
  companyEmail: string;
  companyName: string;
  workerId: number;
  workerName: string;
  openTimesheetCount: number;
  totalHours: number;
  totalAmountCents: number;
  timesheetDetails: {
    date: string;
    hours: string;
    amount: string;
    jobTitle: string;
  }[];
}

async function getOpenInvoices(): Promise<OpenInvoiceSummary[]> {
  // Optimized: Fetch invoices with company and job in one query
  const openInvoices = await db
    .select({
      invoice: invoices,
      company: profiles,
      job: jobs,
    })
    .from(invoices)
    .innerJoin(profiles, eq(invoices.companyId, profiles.id))
    .leftJoin(jobs, eq(invoices.jobId, jobs.id))
    .where(
      and(
        inArray(invoices.status, ["sent", "overdue"]),
        isNull(invoices.paidAt)
      )
    );

  // Batch fetch all workers at once instead of per-invoice
  const workerIds = [...new Set(openInvoices.map(row => row.invoice.workerId).filter(Boolean))];
  const workers = workerIds.length > 0 ? await db
    .select({
      id: profiles.id,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
    })
    .from(profiles)
    .where(inArray(profiles.id, workerIds))
    : [];
  const workersMap = new Map(workers.map(w => [w.id, w]));

  // Batch fetch all invoice items at once instead of per-invoice
  const invoiceIds = openInvoices.map(row => row.invoice.id);
  const allInvoiceItems = invoiceIds.length > 0 ? await db
    .select({
      item: invoiceItems,
      timesheet: timesheets,
      invoiceId: invoiceItems.invoiceId,
    })
    .from(invoiceItems)
    .leftJoin(timesheets, eq(invoiceItems.timesheetId, timesheets.id))
    .where(inArray(invoiceItems.invoiceId, invoiceIds))
    : [];

  // Group invoice items by invoice ID for O(1) lookup
  const itemsByInvoiceId = new Map<number, typeof allInvoiceItems>();
  for (const item of allInvoiceItems) {
    if (!itemsByInvoiceId.has(item.invoiceId)) {
      itemsByInvoiceId.set(item.invoiceId, []);
    }
    itemsByInvoiceId.get(item.invoiceId)!.push(item);
  }

  const summaryMap = new Map<string, OpenInvoiceSummary>();

  for (const row of openInvoices) {
    // Get worker from pre-fetched map instead of querying
    const worker = workersMap.get(row.invoice.workerId);
    if (!worker) continue;

    const key = `${row.invoice.companyId}-${row.invoice.workerId}`;
    
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        companyId: row.invoice.companyId,
        companyEmail: row.company.email || '',
        companyName: row.company.companyName || `${row.company.firstName} ${row.company.lastName}`,
        workerId: row.invoice.workerId,
        workerName: `${worker.firstName} ${worker.lastName}`,
        openTimesheetCount: 0,
        totalHours: 0,
        totalAmountCents: 0,
        timesheetDetails: [],
      });
    }

    const summary = summaryMap.get(key)!;
    summary.openTimesheetCount += 1;
    summary.totalAmountCents += row.invoice.totalAmount || 0;

    // Get items from pre-fetched map instead of querying
    const items = itemsByInvoiceId.get(row.invoice.id) || [];

    for (const item of items) {
      const hours = item.timesheet?.totalHours ? parseFloat(item.timesheet.totalHours) : 0;
      summary.totalHours += hours;
      summary.timesheetDetails.push({
        date: item.timesheet?.clockInTime ? format(new Date(item.timesheet.clockInTime), "MMM d, yyyy") : "N/A",
        hours: hours.toFixed(1),
        amount: ((item.item.amount || 0) / 100).toFixed(2),
        jobTitle: row.job?.title || "Unknown Job",
      });
    }
  }

  return Array.from(summaryMap.values()).filter(s => s.companyEmail);
}

export async function sendPaymentReminders(): Promise<{ sent: number; failed: number }> {
  console.log("[InvoiceReminder] Checking for unpaid invoices...");
  
  const openInvoices = await getOpenInvoices();
  console.log(`[InvoiceReminder] Found ${openInvoices.length} company-worker pairs with unpaid invoices`);

  let sent = 0;
  let failed = 0;

  for (const summary of openInvoices) {
    if (!summary.companyEmail) {
      console.log(`[InvoiceReminder] Skipping company ${summary.companyId} - no email`);
      continue;
    }

    try {
      const result = await sendEmail({
        to: summary.companyEmail,
        type: "payment_reminder",
        data: {
          workerName: summary.workerName,
          openTimesheetCount: summary.openTimesheetCount,
          totalHours: summary.totalHours,
          totalAmountCents: summary.totalAmountCents,
          timesheetDetails: summary.timesheetDetails.slice(0, 5),
        },
      });

      if (result.success) {
        sent++;
        console.log(`[InvoiceReminder] Sent reminder to ${summary.companyEmail} for ${summary.workerName}`);
      } else {
        failed++;
        console.error(`[InvoiceReminder] Failed to send to ${summary.companyEmail}:`, result.error);
      }
    } catch (err: any) {
      failed++;
      console.error(`[InvoiceReminder] Error sending reminder:`, err?.message || err);
    }
  }

  console.log(`[InvoiceReminder] Complete. Sent: ${sent}, Failed: ${failed}`);
  return { sent, failed };
}

export async function sendPaymentReminderForWorker(workerId: number): Promise<{ sent: number; failed: number; companies: string[] }> {
  console.log(`[InvoiceReminder] Sending reminders for worker ${workerId}`);
  
  const allOpenInvoices = await getOpenInvoices();
  const workerInvoices = allOpenInvoices.filter(s => s.workerId === workerId);
  
  console.log(`[InvoiceReminder] Found ${workerInvoices.length} companies with unpaid invoices for worker ${workerId}`);

  let sent = 0;
  let failed = 0;
  const companies: string[] = [];

  for (const summary of workerInvoices) {
    if (!summary.companyEmail) continue;

    try {
      const result = await sendEmail({
        to: summary.companyEmail,
        type: "payment_reminder",
        data: {
          workerName: summary.workerName,
          openTimesheetCount: summary.openTimesheetCount,
          totalHours: summary.totalHours,
          totalAmountCents: summary.totalAmountCents,
          timesheetDetails: summary.timesheetDetails.slice(0, 5),
        },
      });

      if (result.success) {
        sent++;
        companies.push(summary.companyName);
        console.log(`[InvoiceReminder] Sent reminder to ${summary.companyEmail}`);
      } else {
        failed++;
        console.error(`[InvoiceReminder] Failed:`, result.error);
      }
    } catch (err: any) {
      failed++;
      console.error(`[InvoiceReminder] Error:`, err?.message || err);
    }
  }

  return { sent, failed, companies };
}

let invoiceReminderInterval: NodeJS.Timeout | null = null;

export function startInvoiceReminderScheduler() {
  console.log("[InvoiceReminder] Starting invoice reminder scheduler (24-hour interval)");
  
  sendPaymentReminders().catch(err => {
    console.error("[InvoiceReminder] Initial check failed:", err);
  });
  
  invoiceReminderInterval = setInterval(() => {
    sendPaymentReminders().catch(err => {
      console.error("[InvoiceReminder] Scheduled check failed:", err);
    });
  }, REMINDER_INTERVAL_MS);
}

export function stopInvoiceReminderScheduler() {
  if (invoiceReminderInterval) {
    clearInterval(invoiceReminderInterval);
    invoiceReminderInterval = null;
    console.log("[InvoiceReminder] Invoice reminder scheduler stopped");
  }
}
