-- Affiliate W-9: track when W-9 was uploaded to Mercury for tax purposes
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS w9_uploaded_at timestamp;
