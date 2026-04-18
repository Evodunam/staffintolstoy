-- FCRA-compliant background check schema. Vendor-agnostic.
-- background_check_consents holds the worker's signed disclosure + authorization
-- (separate documents per FCRA §604(b)(2)). An order CANNOT be created without
-- a matching consent row.

CREATE TABLE IF NOT EXISTS background_check_consents (
  id SERIAL PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  disclosure_version TEXT NOT NULL,
  disclosure_signed_at TIMESTAMPTZ NOT NULL,
  auth_signed_at TIMESTAMPTZ NOT NULL,
  signature_name TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bg_consents_worker ON background_check_consents (worker_id);

CREATE TABLE IF NOT EXISTS background_check_orders (
  id SERIAL PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consent_id INTEGER NOT NULL REFERENCES background_check_consents(id) ON DELETE RESTRICT,
  vendor TEXT NOT NULL,
  vendor_reference TEXT,
  package_code TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','ordered','pending','complete','suspended','canceled','expired')),
  result TEXT CHECK (result IN ('clear','consider','fail') OR result IS NULL),
  report_url TEXT,
  ordered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  adverse_action_started_at TIMESTAMPTZ,
  adverse_action_pre_notice_sent_at TIMESTAMPTZ,
  adverse_action_final_notice_sent_at TIMESTAMPTZ,
  adverse_action_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bg_orders_worker ON background_check_orders (worker_id);
CREATE INDEX IF NOT EXISTS idx_bg_orders_status ON background_check_orders (status);
