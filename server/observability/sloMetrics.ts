import type { Request, Response, NextFunction } from "express";

/**
 * In-process per-endpoint SLO/RED metrics. No external dependencies (Prometheus,
 * Datadog, etc) — keeps a rolling fixed-size sample of recent latencies per
 * (method + normalized route) for percentile estimation.
 *
 * Uses a reservoir-style ring buffer (capacity 1024 per endpoint) so memory is
 * bounded. p50/p95/p99 are computed on-demand from the buffer at admin-dashboard
 * read time. Works fine for traffic up to ~thousands of req/s before sampling
 * resolution becomes coarse; at that scale, swap in HDRHistogram or push to
 * an external TSDB.
 *
 * Path normalization: numeric/UUID/hex segments collapse to ":id" so
 * /api/jobs/123 and /api/jobs/456 share one bucket. Query strings are dropped.
 */

interface EndpointStats {
  method: string;
  route: string;
  count: number;
  errors4xx: number;
  errors5xx: number;
  totalDurationMs: number;
  // Ring buffer of recent latencies (ms).
  samples: number[];
  sampleIdx: number;
  lastRequestAt: number;
  // Per-minute rolling buckets for the last hour. Keyed by minute-of-hour
  // 0-59 with a generation marker so we don't return stale data when the
  // same minute slot wraps around.
  minuteBuckets: MinuteBucket[];
}

interface MinuteBucket {
  /** Floor of (timestamp / 60_000) — distinguishes this minute from a future
   *  one that lands in the same array slot. */
  minuteEpoch: number;
  count: number;
  errors: number;
  /** Ring of latencies *for this minute only*. Capped at 256 to bound memory. */
  samples: number[];
  sampleIdx: number;
}

const RING_CAPACITY = 1024;
const SPARK_BUCKETS = 60;       // last 60 minutes
const SPARK_SAMPLE_CAP = 256;   // per-minute samples ring
const stats = new Map<string, EndpointStats>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{16,}$/i;
const NUMERIC_RE = /^\d+$/;

export function normalizeRoute(req: Request): string {
  // Prefer Express's matched route pattern when available — gives us
  // "/api/jobs/:id" instead of "/api/jobs/123" automatically.
  const matched = (req.route as any)?.path;
  if (matched && typeof matched === "string") {
    const base = (req.baseUrl || "").replace(/\/$/, "");
    return base + matched;
  }
  // Fallback: normalize ourselves.
  const url = (req.originalUrl || req.url || "").split("?")[0];
  return url.split("/").map((seg) => {
    if (!seg) return seg;
    if (NUMERIC_RE.test(seg)) return ":id";
    if (UUID_RE.test(seg)) return ":uuid";
    if (HEX_RE.test(seg)) return ":hex";
    return seg;
  }).join("/");
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startNs = process.hrtime.bigint();
  res.on("finish", () => {
    const dur = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    record(req.method, normalizeRoute(req), dur, res.statusCode);
  });
  next();
}

function record(method: string, route: string, durationMs: number, status: number) {
  // Skip non-API noise so the dashboard is signal, not Vite dev/asset chaff.
  if (!route.startsWith("/api/")) return;
  const key = `${method} ${route}`;
  let s = stats.get(key);
  if (!s) {
    s = {
      method, route,
      count: 0, errors4xx: 0, errors5xx: 0, totalDurationMs: 0,
      samples: new Array(RING_CAPACITY).fill(0),
      sampleIdx: 0, lastRequestAt: 0,
      minuteBuckets: new Array(SPARK_BUCKETS),
    };
    stats.set(key, s);
  }
  s.count++;
  s.totalDurationMs += durationMs;
  s.lastRequestAt = Date.now();
  if (status >= 500) s.errors5xx++;
  else if (status >= 400) s.errors4xx++;
  s.samples[s.sampleIdx % RING_CAPACITY] = durationMs;
  s.sampleIdx++;

  // Per-minute rollup for the last-hour sparkline.
  const minuteEpoch = Math.floor(s.lastRequestAt / 60_000);
  const slot = minuteEpoch % SPARK_BUCKETS;
  let bucket = s.minuteBuckets[slot];
  if (!bucket || bucket.minuteEpoch !== minuteEpoch) {
    // New minute (or 60+ min old slot getting overwritten).
    bucket = {
      minuteEpoch,
      count: 0, errors: 0,
      samples: new Array(SPARK_SAMPLE_CAP).fill(0),
      sampleIdx: 0,
    };
    s.minuteBuckets[slot] = bucket;
  }
  bucket.count++;
  if (status >= 500) bucket.errors++;
  bucket.samples[bucket.sampleIdx % SPARK_SAMPLE_CAP] = durationMs;
  bucket.sampleIdx++;
}

/**
 * Compute percentile from the live sample ring. Uses the standard nearest-rank
 * method (good enough for dashboard purposes).
 */
function percentile(samples: number[], n: number, p: number): number {
  if (n === 0) return 0;
  const filled = Math.min(n, samples.length);
  // Copy only the filled portion of the ring so the sort doesn't include zeroed
  // slots from the unused capacity.
  const sorted = samples.slice(0, filled).sort((a, b) => a - b);
  const idx = Math.min(filled - 1, Math.max(0, Math.ceil((p / 100) * filled) - 1));
  return sorted[idx];
}

export interface EndpointSnapshot {
  method: string;
  route: string;
  count: number;
  errors4xx: number;
  errors5xx: number;
  errorRatePct: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  lastRequestAt: number;
  /** Last 60 minutes of per-minute p95 latency. Index 0 = oldest. Empty
   *  minutes (no traffic) are 0. Useful for inline sparklines. */
  sparkP95: number[];
  /** Parallel array of per-minute request counts. */
  sparkCount: number[];
  /** UTC minute bucket (floor(ms/60_000)) per spark slot; 0 = no sample for that slot. */
  sparkMinuteEpoch: number[];
}

export function snapshotMetrics(): { generatedAt: string; endpoints: EndpointSnapshot[] } {
  const nowMinute = Math.floor(Date.now() / 60_000);
  const out: EndpointSnapshot[] = [];
  for (const s of stats.values()) {
    if (s.count === 0) continue;
    // Build the last-60-minute time series in chronological order. Walk from
    // 59 minutes ago to "this minute"; for each minute, find the bucket if
    // its minuteEpoch matches, else 0.
    const sparkP95: number[] = new Array(SPARK_BUCKETS).fill(0);
    const sparkCount: number[] = new Array(SPARK_BUCKETS).fill(0);
    const sparkMinuteEpoch: number[] = new Array(SPARK_BUCKETS).fill(0);
    for (let i = 0; i < SPARK_BUCKETS; i++) {
      const targetMinute = nowMinute - (SPARK_BUCKETS - 1 - i);
      const slot = targetMinute % SPARK_BUCKETS;
      const bucket = s.minuteBuckets[slot];
      if (bucket && bucket.minuteEpoch === targetMinute && bucket.count > 0) {
        sparkP95[i] = percentile(bucket.samples, bucket.sampleIdx, 95);
        sparkCount[i] = bucket.count;
        sparkMinuteEpoch[i] = targetMinute;
      }
    }
    out.push({
      method: s.method,
      route: s.route,
      count: s.count,
      errors4xx: s.errors4xx,
      errors5xx: s.errors5xx,
      errorRatePct: ((s.errors4xx + s.errors5xx) / s.count) * 100,
      meanMs: s.totalDurationMs / s.count,
      p50Ms: percentile(s.samples, s.sampleIdx, 50),
      p95Ms: percentile(s.samples, s.sampleIdx, 95),
      p99Ms: percentile(s.samples, s.sampleIdx, 99),
      lastRequestAt: s.lastRequestAt,
      sparkP95,
      sparkCount,
      sparkMinuteEpoch,
    });
  }
  // Sort by request volume descending so the dashboard's first row is the
  // hottest path — most actionable for SLO triage.
  out.sort((a, b) => b.count - a.count);
  return { generatedAt: new Date().toISOString(), endpoints: out };
}

export function resetMetrics() {
  stats.clear();
}

