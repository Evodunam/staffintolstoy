-- Company-initiated background check flow. Mirrors drug_screen_consent_requests:
-- company creates a request → worker gets a tokenized email → on click,
-- worker reviews the FCRA disclosure + authorization + Summary of Rights and
-- signs. Signature creates a real background_check_consents row + a draft
-- background_check_orders row, then the vendor adapter takes over to actually
-- procure the report.
--
-- Why a separate table from background_check_consents? Failed/abandoned
-- consent attempts shouldn't pollute the canonical consents table, and we
-- want the company-side audit trail (who requested, when, against what job)
-- separate from the worker-side authorization record.

CREATE TABLE IF NOT EXISTS background_check_consent_requests (
  id SERIAL PRIMARY KEY,
  requested_by_company_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  worker_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  worker_email TEXT NOT NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  vendor TEXT NOT NULL DEFAULT 'checkr',
  package_code TEXT,
  consent_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consented_at TIMESTAMPTZ,
  /** FK to the canonical consents row created on signature. */
  resulting_consent_id INTEGER REFERENCES background_check_consents(id) ON DELETE SET NULL,
  /** FK to the draft order row created on signature. */
  resulting_order_id INTEGER REFERENCES background_check_orders(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bccr_company ON background_check_consent_requests (requested_by_company_id);
CREATE INDEX IF NOT EXISTS idx_bccr_worker ON background_check_consent_requests (worker_id);
CREATE INDEX IF NOT EXISTS idx_bccr_email ON background_check_consent_requests (LOWER(worker_email));
