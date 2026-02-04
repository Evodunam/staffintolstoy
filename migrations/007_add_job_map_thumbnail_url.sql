-- Add cached static map URL to jobs so we generate once and reuse for cards, popup, and email
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS map_thumbnail_url text;
