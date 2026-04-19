-- Persisted scheduler tick history for SOC 2 / ops (survives process restarts).
CREATE TABLE IF NOT EXISTS scheduler_runs (
  id SERIAL PRIMARY KEY,
  scheduler_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,
  ok BOOLEAN NOT NULL,
  error TEXT,
  stats JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_name_started
  ON scheduler_runs (scheduler_name, started_at DESC);
