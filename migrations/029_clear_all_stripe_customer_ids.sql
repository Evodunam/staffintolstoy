-- One-time: clear all stored Stripe customer IDs so each account gets a fresh customer on next use.
-- Use when Stripe customers were deleted or invalid (e.g. "No such customer"); ensureCompanyStripeCustomer will create new ones.

UPDATE profiles
SET stripe_customer_id = NULL
WHERE stripe_customer_id IS NOT NULL;
