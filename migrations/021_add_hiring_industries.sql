-- Add hiring_industries to profiles for company hiring preferences
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hiring_industries text[];
