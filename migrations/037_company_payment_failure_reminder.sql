-- Recurring Resend email sequence for company payment / funding issues (until resolved).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS payment_failure_reminder_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS payment_failure_reminder_count INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN profiles.payment_failure_reminder_sent_at IS 'Last time company_payment_action_required email was sent (Resend).';
COMMENT ON COLUMN profiles.payment_failure_reminder_count IS 'Monotonic count of payment-issue emails sent in current incident; reset when issue clears.';
