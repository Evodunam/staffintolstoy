-- Migration: Affiliate email reminders (share link, bank/W-9 setup)
-- Tracks when we last sent these emails for throttling

ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS share_link_reminder_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS bank_w9_reminder_sent_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN affiliates.share_link_reminder_sent_at IS 'Last time affiliate share link reminder email was sent (e.g. every 14 days)';
COMMENT ON COLUMN affiliates.bank_w9_reminder_sent_at IS 'Last time bank/W-9 setup reminder was sent (when pending commissions, throttled)';
