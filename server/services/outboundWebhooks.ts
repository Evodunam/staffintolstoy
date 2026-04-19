import crypto from "crypto";
import { db } from "../db";
import { eq, and, lte, sql } from "drizzle-orm";
import { outboundWebhookEvents, profiles } from "@shared/schema";

/**
 * Reliable outbound webhook delivery.
 *
 *   enqueueWebhook(...) inserts a row in `outbound_webhook_events` with status
 *   'pending'. The scheduler in this module wakes every 10s, picks up due
 *   pending rows, signs them, POSTs them, and updates status. Retries use
 *   exponential backoff (30s → 60s → 2m → 4m → 8m → 30m → 2h → 12h) and stop
 *   after maxAttempts, marking the event 'abandoned'.
 *
 * Signature scheme:
 *   Header `Tolstoy-Signature: t=<unix>,v1=<hex>`
 *   v1 = HMAC_SHA256(secret, t + "." + raw_request_body)
 *   Receiver verifies by computing the same and constant-time comparing.
 *   Timestamp tolerance window is policy on the receiver's side (we recommend ±5min).
 *
 * Idempotency:
 *   Each enqueue picks an `idempotencyKey` (caller-supplied or random UUID).
 *   The receiver should dedupe on this key — if our scheduler crashes after
 *   the receiver returned 200 but before we updated the row to 'delivered',
 *   the next retry will deliver again with the same key.
 */

const SCHEDULER_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
// 2^n * 30s, capped at 12h.
const RETRY_BACKOFF_MS = [30, 60, 120, 240, 480, 1800, 7200, 43200].map((s) => s * 1000);
const TRUNCATE_RESPONSE_BODY = 4096;

interface EnqueueArgs {
  recipientProfileId: number;
  eventType: string;
  payload: Record<string, any>;
  /** Optional caller-supplied dedup key. If omitted we generate UUID. */
  idempotencyKey?: string;
}

/**
 * Insert a webhook delivery row. No-op (and returns null) if the recipient
 * has no webhookUrl configured or has filtered this eventType out.
 *
 * Caller doesn't await delivery — call from any code path that needs to
 * notify the company. Failures are surfaced through the events browser UI.
 */
export async function enqueueWebhook(args: EnqueueArgs): Promise<{ id: number; idempotencyKey: string } | null> {
  const [profile] = await db.select({
    id: profiles.id,
    webhookUrl: profiles.webhookUrl,
    webhookEventsEnabled: profiles.webhookEventsEnabled,
  }).from(profiles).where(eq(profiles.id, args.recipientProfileId)).limit(1);

  if (!profile?.webhookUrl) return null;
  const enabled = profile.webhookEventsEnabled as string[] | null;
  if (Array.isArray(enabled) && enabled.length > 0 && !enabled.includes(args.eventType)) {
    return null;
  }

  const idempotencyKey = args.idempotencyKey || crypto.randomUUID();
  try {
    const [row] = await db.insert(outboundWebhookEvents).values({
      recipientProfileId: profile.id,
      eventType: args.eventType,
      idempotencyKey,
      url: profile.webhookUrl,
      payload: args.payload,
      status: "pending",
      attempts: 0,
      maxAttempts: 8,
      nextAttemptAt: new Date(),
    }).returning({ id: outboundWebhookEvents.id });
    return { id: row.id, idempotencyKey };
  } catch (e: any) {
    // Unique constraint on idempotencyKey — caller passed a duplicate, treat as
    // already-enqueued (success). Don't surface the error.
    if (e?.code === "23505") return { id: -1, idempotencyKey };
    throw e;
  }
}

/**
 * Sign a payload using the company's webhook secret.
 * Returns the formatted "Tolstoy-Signature" header value.
 */
export function signPayload(secret: string, rawBody: string, ts = Math.floor(Date.now() / 1000)): string {
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

/**
 * Process one due event: HTTP POST + update row. Pure function over a single
 * event id so it's easy to unit test and to invoke ad-hoc from a "force retry"
 * admin button.
 */
async function processEvent(id: number): Promise<void> {
  const [evt] = await db.select().from(outboundWebhookEvents).where(eq(outboundWebhookEvents.id, id)).limit(1);
  if (!evt || evt.status !== "pending") return;

  // Re-read recipient secret fresh — it could've been rotated since enqueue.
  const [profile] = await db.select({
    webhookSecret: profiles.webhookSecret,
    webhookUrl: profiles.webhookUrl,
  }).from(profiles).where(eq(profiles.id, evt.recipientProfileId)).limit(1);

  if (!profile?.webhookSecret) {
    await db.update(outboundWebhookEvents).set({
      status: "abandoned",
      lastError: "Recipient has no webhook secret configured (revoked?)",
    }).where(eq(outboundWebhookEvents.id, id));
    return;
  }
  const url = profile.webhookUrl || evt.url;

  const body = JSON.stringify({
    id: evt.idempotencyKey,
    type: evt.eventType,
    createdAt: evt.createdAt,
    data: evt.payload,
  });
  const signature = signPayload(profile.webhookSecret, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: { status: number; body: string } | null = null;
  let errorMsg: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Tolstoy-Signature": signature,
        "Tolstoy-Event": evt.eventType,
        "Tolstoy-Idempotency-Key": evt.idempotencyKey,
        "User-Agent": "Tolstoy-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });
    const text = (await res.text()).slice(0, TRUNCATE_RESPONSE_BODY);
    response = { status: res.status, body: text };
  } catch (e: any) {
    errorMsg = e?.name === "AbortError" ? "Timeout" : (e?.message || String(e));
  } finally {
    clearTimeout(timeout);
  }

  const attempts = (evt.attempts ?? 0) + 1;
  const succeeded = response && response.status >= 200 && response.status < 300;

  if (succeeded) {
    await db.update(outboundWebhookEvents).set({
      status: "delivered",
      attempts,
      deliveredAt: new Date(),
      lastResponseStatus: response!.status,
      lastResponseBody: response!.body,
      lastError: null,
    }).where(eq(outboundWebhookEvents.id, id));
    return;
  }

  // Retry? Otherwise abandon.
  if (attempts >= (evt.maxAttempts ?? 8)) {
    await db.update(outboundWebhookEvents).set({
      status: "abandoned",
      attempts,
      lastResponseStatus: response?.status ?? null,
      lastResponseBody: response?.body ?? null,
      lastError: errorMsg ?? `HTTP ${response?.status}`,
    }).where(eq(outboundWebhookEvents.id, id));
    return;
  }
  const backoffMs = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
  await db.update(outboundWebhookEvents).set({
    status: "pending",
    attempts,
    nextAttemptAt: new Date(Date.now() + backoffMs),
    lastResponseStatus: response?.status ?? null,
    lastResponseBody: response?.body ?? null,
    lastError: errorMsg ?? `HTTP ${response?.status}`,
  }).where(eq(outboundWebhookEvents.id, id));
}

let schedulerInterval: NodeJS.Timeout | null = null;
let processing = false;

/**
 * Start the periodic delivery scheduler. Idempotent — calling twice is a
 * no-op so it's safe to start from server bootstrap without worrying about
 * hot-reload.
 */
export function startOutboundWebhookScheduler() {
  if (schedulerInterval) return;
  // Register with the central scheduler-health tracker for admin visibility.
  // Lazy-imported to avoid a load-order cycle if observability ever pulls
  // anything from a service that imports us.
  void import("../observability/schedulerHealth").then(({ registerScheduler }) => {
    registerScheduler("outbound-webhooks", SCHEDULER_INTERVAL_MS);
  });

  schedulerInterval = setInterval(async () => {
    if (processing) return;
    processing = true;
    try {
      const { recordRun } = await import("../observability/schedulerHealth");
      await recordRun("outbound-webhooks", async () => {
        // Pull a batch of due events. LIMIT 25 keeps each tick bounded so a
        // backlog can't starve the event loop.
        const due = await db.select({ id: outboundWebhookEvents.id })
          .from(outboundWebhookEvents)
          .where(and(
            eq(outboundWebhookEvents.status, "pending"),
            lte(outboundWebhookEvents.nextAttemptAt, new Date()),
          ))
          .orderBy(outboundWebhookEvents.nextAttemptAt)
          .limit(25);
        let processed = 0;
        let errors = 0;
        for (const row of due) {
          try { await processEvent(row.id); processed++; }
          catch (e) { console.error("[OutboundWebhook] processEvent failed:", row.id, e); errors++; }
        }
        return { processed, errors, due: due.length };
      });
    } catch (e) {
      console.error("[OutboundWebhook] scheduler tick failed:", e);
    } finally {
      processing = false;
    }
  }, SCHEDULER_INTERVAL_MS);
  // Don't keep the Node event loop alive on shutdown.
  schedulerInterval.unref?.();
  console.log("[OutboundWebhook] scheduler started (10s interval)");
}

export function stopOutboundWebhookScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

