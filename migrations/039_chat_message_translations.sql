-- Add sender language to source messages.
ALTER TABLE job_messages
  ADD COLUMN IF NOT EXISTS sender_language_code TEXT;

-- Cache translated message bodies by target language.
CREATE TABLE IF NOT EXISTS message_translations (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES job_messages(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_translations_message_lang
  ON message_translations (message_id, language_code);

CREATE INDEX IF NOT EXISTS idx_message_translations_message
  ON message_translations (message_id);
