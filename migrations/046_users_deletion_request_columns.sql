-- CCPA §1798.105 / GDPR Art. 17 soft-delete columns on users.
-- Allows the DSAR pipeline to schedule a 30-day hold before hard delete
-- so account recovery + retention exceptions (tax, active dispute) can apply.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_deletion_scheduled_for
  ON users (deletion_scheduled_for)
  WHERE deletion_scheduled_for IS NOT NULL;
