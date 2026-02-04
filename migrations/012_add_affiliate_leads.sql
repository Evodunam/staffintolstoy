-- Affiliate leads for kanban: leads without TS accounts yet; each has unique token for redeem URL
CREATE TABLE IF NOT EXISTS affiliate_leads (
  id serial PRIMARY KEY,
  affiliate_id integer NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  name text,
  email text,
  phone text,
  business_name text,
  account_type text NOT NULL CHECK (account_type IN ('worker', 'company')),
  stage text NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead', 'contacted', 'closed_won', 'closed_lost')),
  token text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_leads_affiliate_id ON affiliate_leads(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_leads_token ON affiliate_leads(token);
CREATE INDEX IF NOT EXISTS idx_affiliate_leads_stage ON affiliate_leads(stage);
