-- Migration: Add instant payout fields to profiles and worker_payouts tables
-- Date: 2026-01-28

-- Add instant_payout_enabled to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS instant_payout_enabled BOOLEAN DEFAULT false;

-- Add instant payout fields to worker_payouts table
ALTER TABLE worker_payouts 
ADD COLUMN IF NOT EXISTS is_instant_payout BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS instant_payout_fee INTEGER,
ADD COLUMN IF NOT EXISTS original_amount INTEGER;

-- Note: The status column in worker_payouts is a TEXT column with CHECK constraint (not a PostgreSQL ENUM type)
-- So "pending_w9" should work automatically. If you're using a PostgreSQL ENUM type, run:
-- ALTER TYPE worker_payout_status ADD VALUE IF NOT EXISTS 'pending_w9';

COMMENT ON COLUMN profiles.instant_payout_enabled IS 'Whether worker has instant payouts enabled (1% + $0.30 fee)';
COMMENT ON COLUMN worker_payouts.is_instant_payout IS 'Whether this payout was processed as an instant payout';
COMMENT ON COLUMN worker_payouts.instant_payout_fee IS 'Fee charged for instant payout in cents (1% + $0.30)';
COMMENT ON COLUMN worker_payouts.original_amount IS 'Original payout amount before fee deduction in cents';
