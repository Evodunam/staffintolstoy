-- Per-company webhook endpoint configuration. URL must be HTTPS. Secret is
-- generated server-side and shown to the user exactly once. Events_enabled
-- is a JSONB array of event-type strings the company subscribes to ([] = all).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS webhook_events_enabled JSONB;
