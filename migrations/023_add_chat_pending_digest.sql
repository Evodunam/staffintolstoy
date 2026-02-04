-- Pending 1hr digest: when a message is sent, we insert here. Scheduler processes 1hr later.
CREATE TABLE IF NOT EXISTS chat_message_pending_digest (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES job_messages(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_pending_digest_created ON chat_message_pending_digest (created_at);

-- Log of 1hr digest emails sent - prevents duplicate sends
CREATE TABLE IF NOT EXISTS chat_message_digest_sent (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES job_messages(id) ON DELETE CASCADE,
  recipient_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_digest_sent_message ON chat_message_digest_sent (message_id);
CREATE INDEX IF NOT EXISTS idx_chat_digest_sent_lookup ON chat_message_digest_sent (message_id, recipient_profile_id);
