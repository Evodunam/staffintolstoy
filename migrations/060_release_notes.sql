-- In-product changelog. Admin posts entries; users see an unread bell badge
-- until they open the changelog. Audience-filterable (all / company / worker / admin).

CREATE TABLE IF NOT EXISTS release_notes (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  audience TEXT DEFAULT 'all' CHECK (audience IN ('all','company','worker','admin')),
  published_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_release_notes_published ON release_notes (published_at);
CREATE INDEX IF NOT EXISTS idx_release_notes_audience ON release_notes (audience);

CREATE TABLE IF NOT EXISTS release_notes_reads (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

