-- Affiliates table: url-based and sales affiliates with unique codes
CREATE TABLE IF NOT EXISTS affiliates (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'url' CHECK (type IN ('url', 'sales')),
  code text NOT NULL UNIQUE,
  first_name text,
  last_name text,
  email text,
  phone text,
  onboarding_complete boolean DEFAULT false,
  onboarding_step integer DEFAULT 1,
  agreement_signed boolean DEFAULT false,
  agreement_signed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliates_user_id ON affiliates(user_id);
CREATE INDEX IF NOT EXISTS idx_affiliates_code ON affiliates(code);

-- Link profiles (workers/companies) to affiliate when they sign up via affiliate link
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by_affiliate_id integer REFERENCES affiliates(id);
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by_affiliate ON profiles(referred_by_affiliate_id);
