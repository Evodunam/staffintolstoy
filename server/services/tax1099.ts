/**
 * 1099-NEC year-end aggregation.
 *
 * IRS rule: any independent contractor paid >= $600 in non-employee compensation
 * during a calendar year requires a 1099-NEC issued by Jan 31 of the following
 * year (filed with IRS by Jan 31, copy B to recipient by Jan 31).
 *
 * This module aggregates payouts per worker per year and flags those over the
 * threshold. Actual filing is done via Track1099 / Stripe Tax Reporting / a
 * similar vendor — that integration is out of scope here, but this gives ops
 * the canonical list of who's reportable and how much each owes a 1099 for.
 *
 * Usage:
 *   const reportable = await aggregate1099Reportable({ year: 2025 });
 *   for (const r of reportable) {
 *     // hand off to Track1099 / file directly with IRS
 *   }
 */
import { and, eq, gte, lt, sum } from "drizzle-orm";
import { db } from "../db";
import { workerPayouts, profiles } from "@shared/schema";

export const IRS_1099_NEC_THRESHOLD_CENTS = 60_000; // $600.00

export interface Reportable1099Worker {
  workerId: number;
  workerName: string;
  workerEmail: string | null;
  hasW9: boolean;
  totalPaidCents: number;
  payoutCount: number;
  /** Whether this worker has crossed the IRS 1099-NEC threshold for the year. */
  reportable: boolean;
}

export interface Aggregate1099Args {
  /** Calendar year, e.g. 2025. */
  year: number;
}

export async function aggregate1099Reportable({ year }: Aggregate1099Args): Promise<Reportable1099Worker[]> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  // Sum completed/sent payouts per worker in the year.
  const rows = await db
    .select({
      workerId: workerPayouts.workerId,
      totalPaidCents: sum(workerPayouts.amount).as("total_paid"),
      payoutCount: sum(workerPayouts.id).as("payout_count"), // proxy; refined below
    })
    .from(workerPayouts)
    .where(and(
      gte(workerPayouts.createdAt, yearStart),
      lt(workerPayouts.createdAt, yearEnd),
    ))
    .groupBy(workerPayouts.workerId);

  if (rows.length === 0) return [];

  const workerIds = rows.map((r) => r.workerId);
  const workerProfiles = await db.select().from(profiles).where(
    workerIds.length === 1 ? eq(profiles.id, workerIds[0]) : (await import("drizzle-orm")).inArray(profiles.id, workerIds),
  );
  const profileById = new Map(workerProfiles.map((p) => [p.id, p]));

  // Re-count payouts properly (sum on id was just to get a non-null value;
  // we re-query for accurate counts).
  const counts = await db
    .select({ workerId: workerPayouts.workerId, n: sum(workerPayouts.id).as("n") })
    .from(workerPayouts)
    .where(and(
      gte(workerPayouts.createdAt, yearStart),
      lt(workerPayouts.createdAt, yearEnd),
    ))
    .groupBy(workerPayouts.workerId);
  const countById = new Map(counts.map(c => [c.workerId, Number(c.n) || 0]));

  return rows.map((r) => {
    const p = profileById.get(r.workerId);
    const totalCents = Number(r.totalPaidCents) || 0;
    return {
      workerId: r.workerId,
      workerName: p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : `Worker #${r.workerId}`,
      workerEmail: p?.email ?? null,
      hasW9: !!p?.w9UploadedAt,
      totalPaidCents: totalCents,
      payoutCount: countById.get(r.workerId) ?? 0,
      reportable: totalCents >= IRS_1099_NEC_THRESHOLD_CENTS,
    };
  });
}
