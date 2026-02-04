-- Migration: Modern Treasury to Mercury Bank
-- Date: January 27, 2026
-- Description: Rename Modern Treasury columns to Mercury equivalents
--
-- IMPORTANT: Run this BEFORE using db:push if your DB still has mt_* columns.
-- See docs/500KB_FIX_AND_DATABASE.md for 500KB fix vs DB migrations and safe order.

BEGIN;

-- ============================================
-- PROFILES TABLE
-- ============================================

-- Rename Modern Treasury fields to Mercury equivalents
ALTER TABLE profiles RENAME COLUMN mt_counterparty_id TO mercury_recipient_id;
ALTER TABLE profiles RENAME COLUMN mt_external_account_id TO mercury_external_account_id;
ALTER TABLE profiles RENAME COLUMN mt_bank_verified TO mercury_bank_verified;

-- Drop virtual account and ledger account columns (Mercury doesn't use these)
ALTER TABLE profiles DROP COLUMN IF EXISTS mt_virtual_account_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS mt_ledger_account_id;

-- Add comment for future reference
COMMENT ON COLUMN profiles.mercury_recipient_id IS 'Mercury recipient ID for ACH payments';
COMMENT ON COLUMN profiles.mercury_external_account_id IS 'Mercury external account ID (bank account)';
COMMENT ON COLUMN profiles.mercury_bank_verified IS 'Whether bank account is verified in Mercury';

-- ============================================
-- COMPANY_PAYMENT_METHODS TABLE
-- ============================================

-- Rename Modern Treasury fields to Mercury equivalents
ALTER TABLE company_payment_methods RENAME COLUMN mt_counterparty_id TO mercury_recipient_id;
ALTER TABLE company_payment_methods RENAME COLUMN mt_external_account_id TO mercury_external_account_id;

-- Drop deprecated Unit fields if they exist
ALTER TABLE company_payment_methods DROP COLUMN IF EXISTS unit_counterparty_id;

-- Add comment for future reference
COMMENT ON COLUMN company_payment_methods.mercury_recipient_id IS 'Mercury recipient ID for this payment method';
COMMENT ON COLUMN company_payment_methods.mercury_external_account_id IS 'Mercury external account ID for this payment method';

-- ============================================
-- COMPANY_TRANSACTIONS TABLE
-- ============================================

-- Rename Modern Treasury fields to Mercury equivalents
ALTER TABLE company_transactions RENAME COLUMN mt_payment_order_id TO mercury_payment_id;
ALTER TABLE company_transactions RENAME COLUMN mt_payment_status TO mercury_payment_status;

-- Drop deprecated Unit fields if they exist
ALTER TABLE company_transactions DROP COLUMN IF EXISTS unit_payment_id;
ALTER TABLE company_transactions DROP COLUMN IF EXISTS unit_payment_status;

-- Add comment for future reference
COMMENT ON COLUMN company_transactions.mercury_payment_id IS 'Mercury payment/transaction ID';
COMMENT ON COLUMN company_transactions.mercury_payment_status IS 'Mercury payment status (pending, sent, completed, failed)';

-- ============================================
-- WORKER_PAYOUTS TABLE
-- ============================================

-- Rename Modern Treasury fields to Mercury equivalents
ALTER TABLE worker_payouts RENAME COLUMN mt_payment_order_id TO mercury_payment_id;
ALTER TABLE worker_payouts RENAME COLUMN mt_payment_status TO mercury_payment_status;

-- Drop deprecated Unit fields if they exist
ALTER TABLE worker_payouts DROP COLUMN IF EXISTS unit_payment_id;
ALTER TABLE worker_payouts DROP COLUMN IF EXISTS unit_payment_status;

-- Add comment for future reference
COMMENT ON COLUMN worker_payouts.mercury_payment_id IS 'Mercury payment ID for worker payout';
COMMENT ON COLUMN worker_payouts.mercury_payment_status IS 'Mercury payment status (pending, sent, completed, failed)';

-- ============================================
-- VERIFICATION
-- ============================================

-- Verify columns were renamed successfully
DO $$
BEGIN
    -- Check profiles table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'profiles' AND column_name = 'mercury_recipient_id') THEN
        RAISE EXCEPTION 'Migration failed: mercury_recipient_id not found in profiles table';
    END IF;
    
    -- Check company_payment_methods table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'company_payment_methods' AND column_name = 'mercury_recipient_id') THEN
        RAISE EXCEPTION 'Migration failed: mercury_recipient_id not found in company_payment_methods table';
    END IF;
    
    -- Check company_transactions table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'company_transactions' AND column_name = 'mercury_payment_id') THEN
        RAISE EXCEPTION 'Migration failed: mercury_payment_id not found in company_transactions table';
    END IF;
    
    -- Check worker_payouts table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'worker_payouts' AND column_name = 'mercury_payment_id') THEN
        RAISE EXCEPTION 'Migration failed: mercury_payment_id not found in worker_payouts table';
    END IF;
    
    RAISE NOTICE 'Migration verification successful: All Mercury columns created';
END $$;

COMMIT;

-- ============================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================

-- Uncomment to rollback:
/*
BEGIN;

ALTER TABLE profiles RENAME COLUMN mercury_recipient_id TO mt_counterparty_id;
ALTER TABLE profiles RENAME COLUMN mercury_external_account_id TO mt_external_account_id;
ALTER TABLE profiles RENAME COLUMN mercury_bank_verified TO mt_bank_verified;
ALTER TABLE profiles ADD COLUMN mt_virtual_account_id TEXT;
ALTER TABLE profiles ADD COLUMN mt_ledger_account_id TEXT;

ALTER TABLE company_payment_methods RENAME COLUMN mercury_recipient_id TO mt_counterparty_id;
ALTER TABLE company_payment_methods RENAME COLUMN mercury_external_account_id TO mt_external_account_id;

ALTER TABLE company_transactions RENAME COLUMN mercury_payment_id TO mt_payment_order_id;
ALTER TABLE company_transactions RENAME COLUMN mercury_payment_status TO mt_payment_status;

ALTER TABLE worker_payouts RENAME COLUMN mercury_payment_id TO mt_payment_order_id;
ALTER TABLE worker_payouts RENAME COLUMN mercury_payment_status TO mt_payment_status;

COMMIT;
*/
