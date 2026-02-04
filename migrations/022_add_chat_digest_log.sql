-- Chat digest email log: at most 2 per day per recipient (morning + evening)
CREATE TABLE IF NOT EXISTS chat_digest_log (
  id SERIAL PRIMARY KEY,
  recipient_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_digest_log_recipient ON chat_digest_log (recipient_profile_id);
CREATE INDEX IF NOT EXISTS idx_chat_digest_log_sent ON chat_digest_log (sent_at);

COMMENT ON TABLE chat_digest_log IS 'Tracks chat digest emails so we send at most 2 per day per user';
