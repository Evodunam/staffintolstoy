-- Migration: Add onboarding reminder sent timestamps for worker onboarding email sequence
-- Sends up to 3 reminders over ~1 month when worker has incomplete onboarding

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_reminder_1_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS onboarding_reminder_2_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS onboarding_reminder_3_sent_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN profiles.onboarding_reminder_1_sent_at IS 'When first onboarding reminder email was sent (worker incomplete)';
COMMENT ON COLUMN profiles.onboarding_reminder_2_sent_at IS 'When second onboarding reminder was sent (~10 days after first)';
COMMENT ON COLUMN profiles.onboarding_reminder_3_sent_at IS 'When third onboarding reminder was sent (~10 days after second)';
