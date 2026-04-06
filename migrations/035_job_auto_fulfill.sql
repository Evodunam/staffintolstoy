-- Auto-fulfill: optional auto-accept of applicants + legal ack tracking
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS auto_fulfill_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_fulfill_budget_cents integer,
  ADD COLUMN IF NOT EXISTS auto_fulfill_budget_window text,
  ADD COLUMN IF NOT EXISTS auto_fulfill_window_start timestamp,
  ADD COLUMN IF NOT EXISTS auto_fulfill_window_end timestamp,
  ADD COLUMN IF NOT EXISTS auto_fulfill_expected_hours numeric(8, 2),
  ADD COLUMN IF NOT EXISTS auto_fulfill_min_worker_rating numeric(3, 2),
  ADD COLUMN IF NOT EXISTS auto_fulfill_min_worker_reviews integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auto_fulfill_max_hourly_cents integer,
  ADD COLUMN IF NOT EXISTS auto_fulfill_min_hourly_cents integer,
  ADD COLUMN IF NOT EXISTS auto_fulfill_policy text DEFAULT 'first_match',
  ADD COLUMN IF NOT EXISTS auto_fulfill_legal_ack_version text,
  ADD COLUMN IF NOT EXISTS auto_fulfill_legal_ack_at timestamp;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS auto_accepted boolean NOT NULL DEFAULT false;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS auto_fulfill_defaults_json text;

COMMENT ON COLUMN jobs.auto_fulfill_budget_window IS 'one_day | weekly | monthly | custom';
COMMENT ON COLUMN jobs.auto_fulfill_policy IS 'first_match | best_rating (best_rating reserved)';
