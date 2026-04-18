-- Feature flags: per-flag toggle + percentage rollout + allowlist.
-- Reads cached in-process for 60s in the server (server/services/featureFlags.ts).

CREATE TABLE IF NOT EXISTS feature_flags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_percent INTEGER DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  allowlist_profile_ids JSONB,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
