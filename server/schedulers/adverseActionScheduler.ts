import { db } from "../db";
import { eq, and, isNull, isNotNull, lte } from "drizzle-orm";
import { backgroundCheckOrders, profiles } from "@shared/schema";

/**
 * FCRA adverse action scheduler.
 *
 * Once per hour we:
 *   1. Find background check orders whose result is "consider" or "fail"
 *      and have NOT yet had a pre-adverse notice sent — kick off the
 *      pre-adverse email and stamp `adverse_action_pre_notice_sent_at`.
 *   2. Find orders whose pre-adverse was sent ≥ 5 BUSINESS days ago and
 *      whose final-adverse hasn't been sent — send the final-adverse email
 *      and stamp `adverse_action_final_notice_sent_at`.
 *
 * 5-business-day calc skips Sat/Sun. We don't currently model federal
 * holidays — counsel-defensible in most jurisdictions, but if you operate
 * in CT or MA where state holidays meaningfully change worker timelines,
 * extend `addBusinessDays` to skip a static holiday list.
 */

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const PRE_ADVERSE_WAIT_BUSINESS_DAYS = 5;

// Worker reads vendor info from env so we can swap providers without code changes.
const VENDOR_NAME = process.env.BG_CHECK_VENDOR_NAME || "Checkr, Inc.";
const VENDOR_PHONE = process.env.BG_CHECK_VENDOR_PHONE || "1-844-824-3257";
const VENDOR_ADDRESS = process.env.BG_CHECK_VENDOR_ADDRESS || "One Montgomery Street, Suite 2400, San Francisco, CA 94104";

let interval: NodeJS.Timeout | null = null;
let running = false;

interface AdverseStats {
  preAdverseSent: number;
  finalAdverseSent: number;
  errors: number;
}

export async function runAdverseActionPass(now = new Date()): Promise<AdverseStats> {
  const stats: AdverseStats = { preAdverseSent: 0, finalAdverseSent: 0, errors: 0 };

  // 1) Pre-adverse: result in {consider, fail} and pre-notice not yet sent.
  const needsPreAdverse = await db.select().from(backgroundCheckOrders).where(and(
    eq(backgroundCheckOrders.status, "complete"),
    isNotNull(backgroundCheckOrders.result),
    isNull(backgroundCheckOrders.adverseActionPreNoticeSentAt),
  ));

  for (const order of needsPreAdverse) {
    if (order.result !== "consider" && order.result !== "fail") continue;
    try {
      const ctx = await buildAdverseContext(order, "pending review");
      if (!ctx) continue;
      const { sendPreAdverseEmail } = await import("../services/adverseActionEmail");
      const ok = await sendPreAdverseEmail(ctx);
      if (ok) {
        await db.update(backgroundCheckOrders).set({
          adverseActionStartedAt: order.adverseActionStartedAt ?? now,
          adverseActionPreNoticeSentAt: now,
          adverseActionReason: order.adverseActionReason ?? `Result: ${order.result}`,
        }).where(eq(backgroundCheckOrders.id, order.id));
        stats.preAdverseSent++;
      } else {
        stats.errors++;
      }
    } catch (e) {
      console.error("[AdverseAction] pre-adverse failed for order", order.id, e);
      stats.errors++;
    }
  }

  // 2) Final-adverse: pre sent ≥5 business days ago, final not sent.
  const candidates = await db.select().from(backgroundCheckOrders).where(and(
    isNotNull(backgroundCheckOrders.adverseActionPreNoticeSentAt),
    isNull(backgroundCheckOrders.adverseActionFinalNoticeSentAt),
  ));

  for (const order of candidates) {
    if (!order.adverseActionPreNoticeSentAt) continue;
    const earliestFinal = addBusinessDays(new Date(order.adverseActionPreNoticeSentAt as any), PRE_ADVERSE_WAIT_BUSINESS_DAYS);
    if (now < earliestFinal) continue;

    try {
      const ctx = await buildAdverseContext(order, "final adverse decision");
      if (!ctx) continue;
      const { sendFinalAdverseEmail } = await import("../services/adverseActionEmail");
      const ok = await sendFinalAdverseEmail(ctx);
      if (ok) {
        await db.update(backgroundCheckOrders).set({
          adverseActionFinalNoticeSentAt: now,
        }).where(eq(backgroundCheckOrders.id, order.id));
        stats.finalAdverseSent++;
      } else {
        stats.errors++;
      }
    } catch (e) {
      console.error("[AdverseAction] final-adverse failed for order", order.id, e);
      stats.errors++;
    }
  }

  if (stats.preAdverseSent > 0 || stats.finalAdverseSent > 0) {
    console.log(`[AdverseAction] preAdverseSent=${stats.preAdverseSent} finalAdverseSent=${stats.finalAdverseSent} errors=${stats.errors}`);
  }
  return stats;
}

async function buildAdverseContext(order: typeof backgroundCheckOrders.$inferSelect, _phase: string) {
  const [worker] = await db.select({
    firstName: profiles.firstName,
    lastName: profiles.lastName,
    email: profiles.email,
  }).from(profiles).where(eq(profiles.id, order.workerId)).limit(1);
  if (!worker?.email) {
    console.warn(`[AdverseAction] order ${order.id} worker ${order.workerId} has no email; skipping`);
    return null;
  }
  return {
    workerEmail: worker.email,
    workerFirstName: worker.firstName || "there",
    vendorName: VENDOR_NAME,
    vendorPhone: VENDOR_PHONE,
    vendorAddress: VENDOR_ADDRESS,
    reportRef: order.vendorReference || `Order #${order.id}`,
    reportUrl: order.reportUrl || "https://app.tolstoystaffing.com/dashboard/settings/account",
    positionTitle: "[position]", // we don't currently link orders to a job; tighten when we do
  };
}

/**
 * Add N business days to a date (skips Sat/Sun). Doesn't account for federal
 * holidays — most adverse-action defenses cite 5 calendar days as the floor,
 * and 5 business days is the standard recommendation, so this is conservative.
 */
function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

export function startAdverseActionScheduler() {
  if (interval) return;
  void import("../observability/schedulerHealth").then(({ registerScheduler }) => {
    registerScheduler("adverse-action", SCHEDULER_INTERVAL_MS);
  });
  interval = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { recordRun } = await import("../observability/schedulerHealth");
      await recordRun("adverse-action", async () => {
        const stats = await runAdverseActionPass();
        return {
          preAdverseSent: stats.preAdverseSent,
          finalAdverseSent: stats.finalAdverseSent,
          errors: stats.errors,
        };
      });
    } catch (e) { console.error("[AdverseAction] tick failed:", e); }
    finally { running = false; }
  }, SCHEDULER_INTERVAL_MS);
  interval.unref?.();
  console.log("[AdverseAction] scheduler started (1h interval)");
}

export function stopAdverseActionScheduler() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

