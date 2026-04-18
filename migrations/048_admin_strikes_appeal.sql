-- Worker appeal workflow on admin_strikes (right to contest a strike before
-- it permanently affects job-matching). SOC 2 CC1 fairness + many state laws
-- (CA AB-2188, NY HRO) provide a worker right to dispute adverse actions.

ALTER TABLE admin_strikes
  ADD COLUMN IF NOT EXISTS appeal_status TEXT DEFAULT 'none'
    CHECK (appeal_status IN ('none','submitted','reviewing','upheld','overturned')),
  ADD COLUMN IF NOT EXISTS appeal_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_text TEXT,
  ADD COLUMN IF NOT EXISTS appeal_decision_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_decided_by TEXT,
  ADD COLUMN IF NOT EXISTS appeal_decision_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_strikes_appeal_status
  ON admin_strikes (appeal_status);
