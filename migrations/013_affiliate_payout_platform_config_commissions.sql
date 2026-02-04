-- Affiliate Mercury payout (same as workers) for commission payouts
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS mercury_recipient_id text;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS mercury_external_account_id text;

-- Platform config: editable platform fee per hour (cents) and affiliate commission %
CREATE TABLE IF NOT EXISTS platform_config (
  id serial PRIMARY KEY,
  platform_fee_per_hour_cents integer NOT NULL DEFAULT 1300,
  affiliate_commission_percent integer NOT NULL DEFAULT 20,
  updated_at timestamp DEFAULT now()
);
-- Single row: id=1
INSERT INTO platform_config (id, platform_fee_per_hour_cents, affiliate_commission_percent)
VALUES (1, 1300, 20)
ON CONFLICT (id) DO NOTHING;

-- Affiliate commissions: 20% of platform fee per approved timesheet
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id serial PRIMARY KEY,
  affiliate_id integer NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  timesheet_id integer NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at timestamp,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate ON affiliate_commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_timesheet ON affiliate_commissions(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_status ON affiliate_commissions(status);
