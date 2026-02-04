-- Activity records for affiliate leads (notes / timeline)
CREATE TABLE IF NOT EXISTS affiliate_lead_activities (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES affiliate_leads(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_lead_activities_lead_id ON affiliate_lead_activities(lead_id);
