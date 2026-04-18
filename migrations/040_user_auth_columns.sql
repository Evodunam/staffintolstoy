-- Self-healing migration for the `users` table to match shared/models/auth.ts.
-- Idempotent: safe to run repeatedly. Run on prod to fix /api/auth/register 500s
-- caused by missing columns (password_hash / auth_provider / user_type / etc).
--
-- Only ALTERs the existing `users` table; assumes the table already exists
-- (which it does on prod, since auth/login routes have been working before).

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash          varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider          varchar DEFAULT 'google';
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type              varchar DEFAULT 'worker';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token   varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code               varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires            timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS magic_link_token       varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS magic_link_expires     timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name             varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name              varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url      varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at             timestamp DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at             timestamp DEFAULT NOW();

-- Backfill any rows created before defaults existed.
UPDATE users SET auth_provider = 'google' WHERE auth_provider IS NULL;
UPDATE users SET user_type     = 'worker' WHERE user_type     IS NULL;
UPDATE users SET created_at    = NOW()    WHERE created_at    IS NULL;
UPDATE users SET updated_at    = NOW()    WHERE updated_at    IS NULL;
