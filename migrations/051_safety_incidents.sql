-- OSHA 300 / 301-style safety incident reports.
-- 29 CFR §1904 mandates this for covered employers; we collect for every
-- worksite incident regardless to support companies' recordkeeping
-- obligations and to surface unsafe sites in worker matching.

CREATE TABLE IF NOT EXISTS safety_incidents (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  timesheet_id INTEGER REFERENCES timesheets(id) ON DELETE SET NULL,
  reporter_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  worker_profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  company_profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,

  occurred_at TIMESTAMPTZ NOT NULL,
  description TEXT NOT NULL,
  body_parts JSONB,
  injury_type TEXT NOT NULL CHECK (injury_type IN
    ('cut','burn','fracture','sprain','fall','struck_by','caught_in','electrical','chemical','heat_illness','cold_illness','other')),
  severity TEXT NOT NULL CHECK (severity IN
    ('near_miss','first_aid','medical_treatment','restricted_duty','days_away','fatality')),

  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  location_description TEXT,

  photo_urls JSONB,
  witness_names JSONB,

  treated_at TEXT,
  days_away INTEGER DEFAULT 0,
  days_restricted INTEGER DEFAULT 0,

  osha_recordable BOOLEAN DEFAULT FALSE,
  osha_reported BOOLEAN DEFAULT FALSE,
  osha_reported_at TIMESTAMPTZ,
  osha_case_number TEXT,

  status TEXT DEFAULT 'new' CHECK (status IN ('new','investigating','closed','disputed')),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolved_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safety_incidents_job ON safety_incidents (job_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_worker ON safety_incidents (worker_profile_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_company ON safety_incidents (company_profile_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_status ON safety_incidents (status);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_severity ON safety_incidents (severity);
