-- When balance funding fails after a hire (auto-replenish), the job is flagged so new applies are blocked
-- and workers cannot clock in until the company balance covers commitments again.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_hold_at TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN jobs.payment_hold_at IS 'Set when funding failed after an acceptance; cleared when balance covers pending+commitments.';
