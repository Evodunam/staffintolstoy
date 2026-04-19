-- Drug screen orders. Tracks every drug test we order through the
-- vendor-agnostic drugScreening service. Worker consent is required before
-- an order can be placed (FCRA §604(b) for "investigative consumer reports"
-- + state laws like CA AB 1008).

CREATE TABLE IF NOT EXISTS drug_screen_orders (
  id SERIAL PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ordered_by_company_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  vendor TEXT NOT NULL DEFAULT 'accurate',
  vendor_ref TEXT,
  panel TEXT NOT NULL CHECK (panel IN ('5_panel','5_panel_no_thc','10_panel','dot_panel')),
  workplace_state TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed_negative','completed_positive','completed_mro_negative','cancelled','expired')),
  consent_given_at TIMESTAMPTZ NOT NULL,
  consent_signature_name TEXT NOT NULL,
  consent_ip_address TEXT,
  scheduling_url TEXT,
  collected_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  -- Result detail (only populated after completion)
  result_summary TEXT,
  positive_analytes JSONB,
  -- For adverse action workflow when result triggers a hire decision
  adverse_action_pre_notice_sent_at TIMESTAMPTZ,
  adverse_action_final_notice_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drug_screen_orders_worker ON drug_screen_orders (worker_id);
CREATE INDEX IF NOT EXISTS idx_drug_screen_orders_status ON drug_screen_orders (status);
CREATE INDEX IF NOT EXISTS idx_drug_screen_orders_vendor_ref ON drug_screen_orders (vendor_ref) WHERE vendor_ref IS NOT NULL;
