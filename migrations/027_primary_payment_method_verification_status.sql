-- Migration: Store primary payment method verification status from Stripe on company profile.
-- Used to show verify-cents global popup when primary is US bank with status "pending" and no other valid method.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS primary_payment_method_verification_status TEXT;

COMMENT ON COLUMN profiles.primary_payment_method_verification_status IS 'From Stripe: verified | pending (ACH new) | verification_failed | failed (charge declined). Drives verify-cents popup when pending and no other valid method.';
