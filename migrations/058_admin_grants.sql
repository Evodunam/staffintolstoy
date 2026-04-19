-- Database-managed admin access. Supplements the env-based ADMIN_EMAILS list:
-- super-admins can grant admin access to other users via the UI without
-- redeploying. A grant is identified by the recipient's email (case-insensitive).
-- Revoking sets revoked_at; we soft-delete to preserve the audit trail.

CREATE TABLE IF NOT EXISTS admin_grants (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  notes TEXT,
  -- For MFA grace enforcement: we know when an account first became admin so
  -- we can require MFA enrollment within N days.
  mfa_grace_started_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_grants_email_active
  ON admin_grants (LOWER(email)) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_admin_grants_email ON admin_grants (LOWER(email));

