-- Store Stripe payment method payload (and setup_intent metadata) in JSONB for webhook updates and audit.
ALTER TABLE company_payment_methods
  ADD COLUMN IF NOT EXISTS stripe_payment_method_json JSONB DEFAULT NULL;

COMMENT ON COLUMN company_payment_methods.stripe_payment_method_json IS 'Stripe payment_method object (sanitized) and/or setup_intent metadata; updated by Stripe webhooks (e.g. verification status).';
