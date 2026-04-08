-- Track company-initiated worker alert blasts for 24h rate limit (persists across sessions).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_worker_alert_at TIMESTAMP;
