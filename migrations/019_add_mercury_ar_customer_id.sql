-- Migration: Add mercury_ar_customer_id to profiles for Mercury AR (Accounts Receivable) customer
-- Created when a company completes onboarding so they can be invoiced in Mercury.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS mercury_ar_customer_id TEXT;

COMMENT ON COLUMN profiles.mercury_ar_customer_id IS 'Mercury AR (Accounts Receivable) customer ID for company invoicing; set when company completes onboarding';
