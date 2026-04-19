-- Worker availability — recurring weekly windows + ad-hoc blackout periods
-- (PTO, surgery, etc). Used by job matching to skip workers who can't take
-- the shift, and surfaced as a calendar in the worker dashboard.

CREATE TABLE IF NOT EXISTS worker_availability_windows (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_minute > start_minute)
);
CREATE INDEX IF NOT EXISTS idx_wa_windows_profile ON worker_availability_windows (profile_id);

CREATE TABLE IF NOT EXISTS worker_availability_blackouts (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_wa_blackouts_profile ON worker_availability_blackouts (profile_id);
CREATE INDEX IF NOT EXISTS idx_wa_blackouts_range ON worker_availability_blackouts (starts_at, ends_at);

