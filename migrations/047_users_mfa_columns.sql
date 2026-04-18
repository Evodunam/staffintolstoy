-- TOTP MFA columns on users (RFC 6238).
-- mfa_secret: base32-encoded shared secret (NEVER returned to the client after enrollment).
-- mfa_backup_codes: JSON array of bcrypt-hashed one-time recovery codes (10 issued at enable).
-- mfa_last_used_at: anti-replay anchor (refuse codes whose timestamp is <= last_used).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enabled VARCHAR DEFAULT 'false',
  ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR,
  ADD COLUMN IF NOT EXISTS mfa_backup_codes JSONB,
  ADD COLUMN IF NOT EXISTS mfa_last_used_at TIMESTAMPTZ;
