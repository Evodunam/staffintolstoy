-- Mailing list for subprocessor change notifications. Most enterprise DPAs
-- require 30-day advance notice when we add a new subprocessor. This table
-- holds opt-in addresses that get notified when the admin sends a blast.
--
-- Double opt-in: insert with confirmed_at NULL + a confirm_token, send email
-- with confirm link, update confirmed_at on click. Unsubscribe is one-click.

CREATE TABLE IF NOT EXISTS subprocessor_subscribers (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  confirm_token TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  source TEXT,                          -- e.g. "subprocessor_page", "dpa_signup"
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subprocessor_subscribers_email_active
  ON subprocessor_subscribers (LOWER(email)) WHERE unsubscribed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subprocessor_subscribers_confirmed
  ON subprocessor_subscribers (confirmed_at) WHERE unsubscribed_at IS NULL;
