/**
 * In-process scheduler health tracker. Every recurring background job (data
 * retention, adverse action, meal-break reminder, outbound webhooks, …)
 * registers itself + records each tick through this module. The admin
 * dashboard reads from `snapshotSchedulerHealth()` for visibility.
 *
 * Why in-process instead of pushing to an external monitoring service?
 *   - Keeps every scheduler's "did it actually run?" question answerable
 *     without a Datadog/Sentry account.
 *   - Process restarts wipe history (intentional — fresh deploy starts a
 *     fresh ledger; long-term history belongs in a TSDB).
 *
 * Bounded memory: one record per scheduler name (no growth past startup),
 * plus a 60-tick rolling history per scheduler for the latency sparkline.
 *
 * Failed ticks are also reported to Sentry (tag `scheduler_name`) when
 * SENTRY_DSN is configured, and optionally persisted to `scheduler_runs`.
 */

interface SchedulerTickRecord {
  startedAt: number;
  durationMs: number;
  ok: boolean;
  error?: string;
  /** Caller-supplied summary for the tick — e.g. `{ delivered: 5, failed: 0 }` */
  stats?: Record<string, number>;
}

interface SchedulerState {
  name: string;
  intervalMs: number;
  /** Wall-clock time we registered the scheduler. */
  registeredAt: number;
  /** Cumulative tick count since process start. */
  runCount: number;
  /** Number of ticks that threw or returned ok=false. */
  errorCount: number;
  /** Most recent tick. */
  lastTick: SchedulerTickRecord | null;
  /** Rolling history (newest last) — bounded at 60 ticks. */
  history: SchedulerTickRecord[];
  /** Aggregate stats across last 60 ticks. */
  cumulativeStats: Record<string, number>;
}

const HISTORY_CAP = 60;
const schedulers = new Map<string, SchedulerState>();

async function persistSchedulerRun(name: string, tick: SchedulerTickRecord): Promise<void> {
  try {
    const { db } = await import("../db");
    const { schedulerRuns } = await import("@shared/schema");
    await db.insert(schedulerRuns).values({
      schedulerName: name,
      startedAt: new Date(tick.startedAt),
      durationMs: tick.durationMs,
      ok: tick.ok,
      error: tick.error ?? null,
      stats: tick.stats ?? null,
    });
  } catch (e) {
    console.warn("[scheduler_runs] insert failed:", (e as Error)?.message || e);
  }
}

/**
 * Register a scheduler with a name + cadence. Idempotent — re-registering
 * with the same name just updates the cadence (useful in dev hot reload).
 */
export function registerScheduler(name: string, intervalMs: number): void {
  const existing = schedulers.get(name);
  if (existing) {
    existing.intervalMs = intervalMs;
    return;
  }
  schedulers.set(name, {
    name,
    intervalMs,
    registeredAt: Date.now(),
    runCount: 0,
    errorCount: 0,
    lastTick: null,
    history: [],
    cumulativeStats: {},
  });
}

/**
 * Wrap a scheduler tick to capture success/failure + duration + caller-supplied
 * stats. Use like:
 *
 *     await recordRun("outbound-webhooks", async () => {
 *       const stats = await processBatch();
 *       return stats; // optional — captured into history
 *     });
 *
 * Errors are caught + recorded but re-thrown so callers can still log them.
 */
export async function recordRun<T extends Record<string, number> | void>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const state = schedulers.get(name);
  if (!state) {
    // Unregistered — register on first run with unknown cadence so we still
    // capture data instead of dropping it on the floor.
    registerScheduler(name, 0);
  }
  const s = schedulers.get(name)!;
  const startedAt = Date.now();
  let result: T | undefined;
  let err: Error | undefined;
  try {
    result = await fn();
  } catch (e: any) {
    err = e instanceof Error ? e : new Error(String(e));
    void import("./sentry")
      .then(({ Sentry }) => {
        Sentry.captureException(err, { tags: { scheduler_name: name } });
      })
      .catch(() => { /* sentry not initialized */ });
    throw err;
  } finally {
    const durationMs = Date.now() - startedAt;
    const tick: SchedulerTickRecord = {
      startedAt,
      durationMs,
      ok: !err,
      error: err?.message,
      stats: result && typeof result === "object" ? (result as any) : undefined,
    };
    s.runCount++;
    if (err) s.errorCount++;
    s.lastTick = tick;
    s.history.push(tick);
    if (s.history.length > HISTORY_CAP) s.history.shift();
    if (tick.stats) {
      for (const [k, v] of Object.entries(tick.stats)) {
        if (typeof v === "number") s.cumulativeStats[k] = (s.cumulativeStats[k] ?? 0) + v;
      }
    }
    void persistSchedulerRun(name, tick);
  }
  return result as T;
}

export interface SchedulerHealthSnapshot {
  name: string;
  intervalMs: number;
  registeredAt: number;
  runCount: number;
  errorCount: number;
  errorRatePct: number;
  lastTick: SchedulerTickRecord | null;
  /** Compact representation for sparkline: 0 = error, durationMs otherwise. */
  durationHistory: number[];
  successHistory: boolean[];
  /** Wall-clock ms when each tick in `durationHistory` started (same length). */
  tickStartedAt: number[];
  cumulativeStats: Record<string, number>;
  /** Healthy = recent enough tick + last tick succeeded. */
  healthy: boolean;
  /** "Recent enough" = within 1.5× the configured interval, or 5min if interval=0. */
  staleSinceMs: number | null;
}

export function snapshotSchedulerHealth(): { generatedAt: string; schedulers: SchedulerHealthSnapshot[] } {
  const now = Date.now();
  const out: SchedulerHealthSnapshot[] = [];
  for (const s of schedulers.values()) {
    const lastRunAt = s.lastTick?.startedAt ?? 0;
    const stalenessThreshold = s.intervalMs > 0 ? s.intervalMs * 1.5 : 5 * 60 * 1000;
    const sinceLastRun = lastRunAt > 0 ? now - lastRunAt : Infinity;
    const stale = sinceLastRun > stalenessThreshold;
    out.push({
      name: s.name,
      intervalMs: s.intervalMs,
      registeredAt: s.registeredAt,
      runCount: s.runCount,
      errorCount: s.errorCount,
      errorRatePct: s.runCount === 0 ? 0 : (s.errorCount / s.runCount) * 100,
      lastTick: s.lastTick,
      durationHistory: s.history.map((t) => t.durationMs),
      successHistory: s.history.map((t) => t.ok),
      tickStartedAt: s.history.map((t) => t.startedAt),
      cumulativeStats: s.cumulativeStats,
      healthy: !stale && (s.lastTick?.ok ?? false),
      staleSinceMs: stale && lastRunAt > 0 ? sinceLastRun : null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { generatedAt: new Date().toISOString(), schedulers: out };
}
