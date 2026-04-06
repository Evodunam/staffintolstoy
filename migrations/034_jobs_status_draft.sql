-- Allow 'draft' as a job status (save without contract/payment; publish later).
-- If your DB has no CHECK on jobs.status, this adds one. If one exists with a different name, drop it first or skip.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('draft', 'open', 'in_progress', 'completed', 'cancelled'));
