-- Company-initiated drug screen flow. The company submits a request →
-- worker gets an email with a one-time consent link → worker reviews the
-- disclosure, signs, and the actual drug_screen_orders row is created with
-- the full FCRA paper trail.
--
-- Why a separate table instead of a "pending_consent" status on orders?
-- Failed / abandoned consent attempts shouldn't pollute the orders table,
-- and the orders table requires consent_signature_name + consent_given_at
-- as NOT NULL (we want that — an order without consent is illegal).

CREATE TABLE IF NOT EXISTS drug_screen_consent_requests (
  id SERIAL PRIMARY KEY,
  requested_by_company_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  worker_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  worker_email TEXT NOT NULL,
  panel TEXT NOT NULL CHECK (panel IN ('5_panel','5_panel_no_thc','10_panel','dot_panel')),
  workplace_state TEXT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  consent_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consented_at TIMESTAMPTZ,
  consent_signature_name TEXT,
  consent_ip_address TEXT,
  /** Set once consent leads to a real drug_screen_orders row. */
  resulting_order_id INTEGER REFERENCES drug_screen_orders(id) ON DELETE SET NULL,
  /** Optional cancellation by the company before consent. */
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dscr_company ON drug_screen_consent_requests (requested_by_company_id);
CREATE INDEX IF NOT EXISTS idx_dscr_worker ON drug_screen_consent_requests (worker_id);
CREATE INDEX IF NOT EXISTS idx_dscr_email ON drug_screen_consent_requests (LOWER(worker_email));
