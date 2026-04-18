-- State paid-sick-leave accrual tracking on worker profiles.
-- Multi-state minimum: 1h sick / 30h worked (CA SB-616, NJ, MA, NYC, etc.).
-- Annual usage caps and balance maxes are enforced in shared/sickLeave.ts.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sick_leave_balance_hours NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sick_leave_ytd_accrued_hours NUMERIC(6,2) DEFAULT 0;
