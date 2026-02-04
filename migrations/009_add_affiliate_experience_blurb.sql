-- Add experience blurb for affiliate application (job-application style)
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS experience_blurb text;
