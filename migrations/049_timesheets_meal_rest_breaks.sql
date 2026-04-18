-- Meal/rest break tracking and CA §226.7 penalty pay columns on timesheets.
-- CA Labor Code §512: 30-min unpaid meal break required at or before the 5th hour;
--   second 30-min meal at or before the 10th hour for 10+ hour shifts.
--   §226.7: 1 hour of regular-rate "premium pay" per workday a required meal
--   break was missed, and 1 additional hour per workday a required rest break
--   was missed.

ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS meal_breaks_taken_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rest_breaks_taken_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meal_break_waived BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS meal_break_penalty_cents INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rest_break_penalty_cents INT DEFAULT 0;
