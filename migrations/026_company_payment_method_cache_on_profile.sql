-- Migration: Cache primary payment method and verification status on company profile.
-- Avoids fetching payment methods on every load; popup shows when lastFailedPaymentMethodId is set or no verified primary.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS primary_payment_method_id INTEGER REFERENCES company_payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_payment_method_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_failed_payment_method_id INTEGER REFERENCES company_payment_methods(id) ON DELETE SET NULL;

COMMENT ON COLUMN profiles.primary_payment_method_id IS 'Cached primary company payment method id for quick "has valid method" check';
COMMENT ON COLUMN profiles.primary_payment_method_verified IS 'True if primary method is card or verified ACH';
COMMENT ON COLUMN profiles.last_failed_payment_method_id IS 'Set when a charge fails with this method; triggers global add-payment popup. Cleared when new method added or retry succeeds';
