-- Outbound webhook delivery queue. We enqueue an event row, the scheduler
-- picks it up, signs + POSTs, then updates status. Failed deliveries retry
-- with exponential backoff up to max_attempts.
--
-- Idempotency_key is the unique handle the receiver uses to dedupe — if our
-- scheduler crashes after sending but before updating the row, the next retry
-- carries the same idempotency_key so the receiver knows it's a duplicate.

CREATE TABLE IF NOT EXISTS outbound_webhook_events (
  id SERIAL PRIMARY KEY,
  recipient_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','abandoned')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_response_status INTEGER,
  last_response_body TEXT,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_recipient ON outbound_webhook_events (recipient_profile_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_status ON outbound_webhook_events (status);
-- Hot path for the scheduler: pull pending events whose next_attempt is due.
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_due ON outbound_webhook_events (next_attempt_at)
  WHERE status = 'pending';
