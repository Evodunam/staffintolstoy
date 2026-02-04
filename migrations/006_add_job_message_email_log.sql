-- Rate limit new_job_message emails: 1 per day per (job, recipient)
CREATE TABLE IF NOT EXISTS job_message_email_log (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  recipient_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_message_email_log_lookup
  ON job_message_email_log (job_id, recipient_profile_id, sent_at);

COMMENT ON TABLE job_message_email_log IS 'Tracks when we sent new_job_message email so we send at most 1 per day per job per recipient';
