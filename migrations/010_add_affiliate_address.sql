-- Add address for affiliate
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS address text;
