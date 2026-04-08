import { PLATFORM_MIN_JOB_BUDGET_HOURLY_CENTS } from "./platformPayPolicy";

/** Parse "yyyy-MM-dd" as local calendar date */
function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Fractional hours between HH:mm times (same day). */
export function hoursBetweenTimes(startHHMM: string, endHHMM: string): number {
  const [sh, smRaw] = startHHMM.split(":").map(Number);
  const [eh, emRaw] = endHHMM.split(":").map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(eh)) return 0;
  const sm = Number.isFinite(smRaw) ? smRaw : 0;
  const em = Number.isFinite(emRaw) ? emRaw : 0;
  return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
}

export type PostJobBillableScheduleInput = {
  shiftType: "on-demand" | "one-day" | "recurring" | "monthly";
  workersNeeded: number;
  onDemandDate: string;
  onDemandDoneByDate: string;
  oneDaySchedule: { startTime: string; endTime: string };
  recurringSchedule: { days: string[]; weeks: number; startTime: string; endTime: string };
  monthlySchedule: { days: string[]; startTime: string; endTime: string };
  monthlyMonthsCount: number;
  /** Calendar days in range × this × workers = on-demand hours (matches PostJob wizard default). */
  onDemandHoursPerCalendarDay?: number;
};

/**
 * Total worker-hours for the posting (sum across workers), used to sanity-check budgets
 * against a minimum hourly floor.
 */
export function computeBillableWorkerHours(input: PostJobBillableScheduleInput): number {
  const w = Math.max(1, input.workersNeeded);
  const perDay = input.onDemandHoursPerCalendarDay ?? 8;

  if (input.shiftType === "on-demand") {
    const end = input.onDemandDoneByDate || input.onDemandDate;
    if (!input.onDemandDate) return perDay * w;
    if (!end) return perDay * w;
    const start = parseLocalDate(input.onDemandDate);
    const endDt = parseLocalDate(end);
    if (endDt < start) return perDay * w;
    const days = Math.ceil((endDt.getTime() - start.getTime()) / 86400000) + 1;
    return days * perDay * w;
  }

  if (input.shiftType === "one-day") {
    const h = hoursBetweenTimes(input.oneDaySchedule.startTime, input.oneDaySchedule.endTime);
    return h * w;
  }

  if (input.shiftType === "recurring") {
    const h = hoursBetweenTimes(input.recurringSchedule.startTime, input.recurringSchedule.endTime);
    return h * input.recurringSchedule.days.length * input.recurringSchedule.weeks * w;
  }

  if (input.shiftType === "monthly") {
    const h = hoursBetweenTimes(input.monthlySchedule.startTime, input.monthlySchedule.endTime);
    return h * input.monthlySchedule.days.length * input.monthlyMonthsCount * w;
  }

  return 0;
}

/** Minimum company labor budget (cents) for scheduled worker-hours at the all-in minimum per worker-hour. */
export function minimumLaborBudgetCentsForWorkerHours(
  totalWorkerHours: number,
  minHourlyCents: number = PLATFORM_MIN_JOB_BUDGET_HOURLY_CENTS
): number {
  if (!Number.isFinite(totalWorkerHours) || totalWorkerHours <= 0) return 0;
  if (!Number.isFinite(minHourlyCents) || minHourlyCents <= 0) return 0;
  return Math.ceil(totalWorkerHours * minHourlyCents);
}
