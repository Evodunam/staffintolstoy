import { db } from "../db";
import { eq, lt, and, isNotNull } from "drizzle-orm";
import { users } from "@shared/models/auth";
import { profiles } from "@shared/schema";

/**
 * Daily data-retention enforcement scheduler.
 *
 * Runs once per day. For each user whose `deletionScheduledFor` is in the
 * past:
 *   1. Anonymize PII on the `users` row (email → tombstone, name → blank).
 *   2. Anonymize PII on their `profiles` row (name, phone, address, lat/lng).
 *   3. Mark the user as fully deleted (status="deleted", anonymizedAt=now).
 *
 * We DO NOT hard-delete the row — operational data references it (jobs they
 * worked on, payouts, audit log entries, tax records). Anonymizing the PII
 * fulfills CCPA §1798.105 and GDPR Art. 17 while preserving the legally
 * required retention of:
 *   - Tax records (1099-NEC, 7 years per IRS)
 *   - Wage statements (3-4 years per FLSA + state law)
 *   - Safety incidents (5 years per OSHA)
 *   - Audit logs (open-ended for SOC 2)
 *
 * The user can be re-identified by a court subpoena via the audit log only,
 * not via day-to-day platform queries.
 */

const SCHEDULER_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
let interval: NodeJS.Timeout | null = null;
let running = false;

interface RetentionStats {
  scanned: number;
  anonymized: number;
  errors: number;
}

export async function runDataRetentionPass(now = new Date()): Promise<RetentionStats> {
  const stats: RetentionStats = { scanned: 0, anonymized: 0, errors: 0 };

  // Find users whose grace period has elapsed.
  const due = await db.select({
    id: users.id,
    email: users.email,
  }).from(users).where(and(
    isNotNull(users.deletionScheduledFor),
    lt(users.deletionScheduledFor, now),
  ));
  stats.scanned = due.length;

  for (const u of due) {
    try {
      // Use the user id as the tombstone discriminator so we can still join
      // operational data later if subpoenaed; the email is unrecoverable.
      const tombstoneEmail = `deleted+${u.id}@anon.tolstoystaffing.com`;
      await db.transaction(async (tx) => {
        await tx.update(users).set({
          email: tombstoneEmail,
          firstName: null,
          lastName: null,
          profileImageUrl: null,
          // Mark the deletion as completed so subsequent passes skip this row.
          deletionRequestedAt: null,
          deletionScheduledFor: null,
        } as any).where(eq(users.id, u.id));

        // Profile-level PII. We deliberately keep `state` so wage-compliance
        // aggregations (per-state min wage, etc) still work in retrospect.
        await tx.update(profiles).set({
          firstName: null,
          lastName: null,
          email: tombstoneEmail,
          phone: null,
          avatarUrl: null,
          bio: null,
          address: null,
          city: null,
          zipCode: null,
          latitude: null,
          longitude: null,
          // Trade/skills are operational; keep for matching de-duplication.
        }).where(eq(profiles.userId, u.id));
      });
      stats.anonymized++;
    } catch (e) {
      console.error("[DataRetention] failed to anonymize user", u.id, e);
      stats.errors++;
    }
  }

  if (stats.anonymized > 0) {
    console.log(`[DataRetention] anonymized ${stats.anonymized}/${stats.scanned} users (errors: ${stats.errors})`);
  }
  return stats;
}

/**
 * Start the periodic data-retention scheduler. Idempotent — safe to call
 * multiple times.
 */
export function startDataRetentionScheduler() {
  if (interval) return;
  void import("../observability/schedulerHealth").then(({ registerScheduler }) => {
    registerScheduler("data-retention", SCHEDULER_INTERVAL_MS);
  });

  const wrappedRun = async () => {
    const { recordRun } = await import("../observability/schedulerHealth");
    await recordRun("data-retention", async () => {
      const stats = await runDataRetentionPass();
      return { scanned: stats.scanned, anonymized: stats.anonymized, errors: stats.errors };
    });
  };

  // Run once on startup so a redeploy doesn't delay enforcement by 6 hours.
  void wrappedRun().catch((e) => console.error("[DataRetention] startup pass failed:", e));

  interval = setInterval(async () => {
    if (running) return;
    running = true;
    try { await wrappedRun(); }
    catch (e) { console.error("[DataRetention] tick failed:", e); }
    finally { running = false; }
  }, SCHEDULER_INTERVAL_MS);
  interval.unref?.();
  console.log("[DataRetention] scheduler started (6h interval)");
}

export function stopDataRetentionScheduler() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

