-- When a job's estimated labor budget is met, we send the company a "close project" review email once.
CREATE TABLE IF NOT EXISTS job_budget_review_email_sent (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_budget_review_sent_job
  ON job_budget_review_email_sent (job_id);

COMMENT ON TABLE job_budget_review_email_sent IS 'Tracks when we sent close_project_review email for a job (budget met) so we send at most once per job';
