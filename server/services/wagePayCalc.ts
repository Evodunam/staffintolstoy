/**
 * Server-side adapter that connects timesheet rows to the pure wage engine in
 * shared/wageCompliance.ts. Owns the "look up the worker's other shifts in the
 * same workweek" logic so the engine itself stays pure and testable.
 */
import { and, eq, gte, lt, ne } from "drizzle-orm";
import { db } from "../db";
import { timesheets, jobs } from "@shared/schema";
import { computeShiftPay, type ShiftPayResult } from "@shared/wageCompliance";
import { evaluateBreakCompliance } from "@shared/mealRestBreaks";

/** FLSA workweek = fixed 168-hour period. We use Sunday 00:00 to next Sunday 00:00 in worker-local-ish UTC. */
function workweekStart(d: Date): Date {
  const start = new Date(d);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // back up to Sunday
  return start;
}

function workweekEnd(d: Date): Date {
  const end = workweekStart(d);
  end.setUTCDate(end.getUTCDate() + 7);
  return end;
}

/**
 * Returns hours the worker has already worked this workweek (before the given timesheet),
 * counted from approved + the currently-pending timesheets except `excludeTimesheetId`.
 */
async function workerWeekToDateHoursBefore(
  workerId: number,
  shiftClockIn: Date,
  excludeTimesheetId: number,
): Promise<number> {
  const wkStart = workweekStart(shiftClockIn);
  const rows = await db
    .select({ totalHours: timesheets.totalHours, adjustedHours: timesheets.adjustedHours, clockInTime: timesheets.clockInTime })
    .from(timesheets)
    .where(
      and(
        eq(timesheets.workerId, workerId),
        gte(timesheets.clockInTime, wkStart),
        lt(timesheets.clockInTime, shiftClockIn),
        ne(timesheets.id, excludeTimesheetId),
      ),
    );
  let total = 0;
  for (const r of rows) {
    const h = parseFloat(String(r.adjustedHours || r.totalHours || "0"));
    if (Number.isFinite(h) && h > 0) total += h;
  }
  return total;
}

/**
 * Returns true if the given shift is the worker's 7th consecutive day worked
 * within the current workweek (CA Labor Code §510 premium trigger).
 */
async function isSeventhConsecutiveDayCheck(workerId: number, shiftClockIn: Date, excludeTimesheetId: number): Promise<boolean> {
  const wkStart = workweekStart(shiftClockIn);
  const wkEnd = workweekEnd(shiftClockIn);
  const rows = await db
    .select({ clockInTime: timesheets.clockInTime })
    .from(timesheets)
    .where(
      and(
        eq(timesheets.workerId, workerId),
        gte(timesheets.clockInTime, wkStart),
        lt(timesheets.clockInTime, wkEnd),
        ne(timesheets.id, excludeTimesheetId),
      ),
    );
  const days = new Set<number>();
  for (const r of rows) {
    if (r.clockInTime) days.add(new Date(r.clockInTime).getUTCDay());
  }
  days.add(new Date(shiftClockIn).getUTCDay());
  return days.size >= 7;
}

export interface CalcShiftPayArgs {
  timesheetId: number;
  workerId: number;
  jobId: number;
  hoursWorked: number;
  hourlyRateCents: number;
  clockInTime: Date;
}

/**
 * Compute pay for a timesheet using the per-state OT engine. Looks up the worker's
 * job-state for OT/min-wage rules and the worker's other shifts in the same workweek
 * for federal weekly OT roll-up.
 *
 * Also folds in CA §226.7 / WA / CO meal-and-rest break premium pay when the
 * timesheet's logged breaks are short of state requirements. Premium pay is added
 * to totalPayCents (NOT to hours) and surfaces as additional line items.
 */
export async function calcShiftPayForTimesheet(args: CalcShiftPayArgs): Promise<ShiftPayResult> {
  const [job] = await db
    .select({ state: jobs.state, city: jobs.city })
    .from(jobs)
    .where(eq(jobs.id, args.jobId))
    .limit(1);

  const [weekHours, isSeventhDay, ts] = await Promise.all([
    workerWeekToDateHoursBefore(args.workerId, args.clockInTime, args.timesheetId),
    isSeventhConsecutiveDayCheck(args.workerId, args.clockInTime, args.timesheetId),
    db.select({
      mealBreaksTakenMinutes: timesheets.mealBreaksTakenMinutes,
      restBreaksTakenCount: timesheets.restBreaksTakenCount,
      mealBreakWaived: timesheets.mealBreakWaived,
    }).from(timesheets).where(eq(timesheets.id, args.timesheetId)).limit(1),
  ]);

  const basePay = computeShiftPay({
    hoursWorked: args.hoursWorked,
    hourlyRateCents: args.hourlyRateCents,
    workState: job?.state ?? null,
    workCity: job?.city ?? null,
    weekToDateHoursBefore: weekHours,
    isSeventhConsecutiveDay: isSeventhDay,
  });

  const tsRow = ts[0];
  const breakResult = evaluateBreakCompliance({
    hoursWorked: args.hoursWorked,
    state: job?.state ?? null,
    mealBreaksTakenMinutes: tsRow?.mealBreaksTakenMinutes ?? 0,
    restBreaksTakenCount: tsRow?.restBreaksTakenCount ?? 0,
    mealBreakWaived: tsRow?.mealBreakWaived ?? false,
    hourlyRateCents: args.hourlyRateCents,
  });

  const lineItems = [...basePay.lineItems];
  let extraCents = 0;
  if (breakResult.mealBreakPenaltyCents > 0) {
    extraCents += breakResult.mealBreakPenaltyCents;
    lineItems.push({ kind: "regular", hours: 1, rateCents: args.hourlyRateCents, amountCents: breakResult.mealBreakPenaltyCents });
  }
  if (breakResult.restBreakPenaltyCents > 0) {
    extraCents += breakResult.restBreakPenaltyCents;
    lineItems.push({ kind: "regular", hours: 1, rateCents: args.hourlyRateCents, amountCents: breakResult.restBreakPenaltyCents });
  }

  // Persist the penalty amounts on the timesheet for the wage statement to read.
  if (extraCents > 0) {
    await db.update(timesheets).set({
      mealBreakPenaltyCents: breakResult.mealBreakPenaltyCents,
      restBreakPenaltyCents: breakResult.restBreakPenaltyCents,
    }).where(eq(timesheets.id, args.timesheetId));
  }

  return {
    ...basePay,
    totalPayCents: basePay.totalPayCents + extraCents,
    lineItems,
  };
}
