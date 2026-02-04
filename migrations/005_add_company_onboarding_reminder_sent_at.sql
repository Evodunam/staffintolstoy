-- Migration: Company onboarding reminder (weekly until complete)
-- Sends recurring weekly email to companies with incomplete onboarding

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS company_onboarding_reminder_sent_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN profiles.company_onboarding_reminder_sent_at IS 'Last time a company onboarding reminder email was sent (weekly until complete)';
