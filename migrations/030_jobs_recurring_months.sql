-- Monthly recurring jobs: number of months (1–12) from start month. When set, schedule repeats monthly on selected weekdays.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS recurring_months integer DEFAULT NULL;

COMMENT ON COLUMN jobs.recurring_months IS 'For monthly recurring jobs: number of months (1–12) from start. Null for weekly recurring or one-time/on-demand.';