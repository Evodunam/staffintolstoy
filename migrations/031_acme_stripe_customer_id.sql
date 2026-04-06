-- Set Acme Construction company Stripe customer ID to the canonical customer (cus_Tx1AdfiAcCV6iV).
-- Only update profiles that don't already have this ID (avoids no-op for already-correct rows).
UPDATE profiles
SET stripe_customer_id = 'cus_Tx1AdfiAcCV6iV'
WHERE role = 'company'
  AND (company_name = 'Acme Construction' OR company_name ILIKE '%Acme Construction%')
  AND (stripe_customer_id IS NULL OR stripe_customer_id != 'cus_Tx1AdfiAcCV6iV');
