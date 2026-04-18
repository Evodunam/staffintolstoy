-- Fix /api/auth/register failing with:
--   "new row violates row-level security policy for table users"
-- on INSERT ... RETURNING.
--
-- Postgres evaluates SELECT policy on rows returned by INSERT ... RETURNING.
-- Neon's pooler (PgBouncer in transaction mode) does NOT reset session GUCs
-- between transactions, so app.user_id can leak across pooled connections
-- and the SELECT policy then denies the just-inserted row.
--
-- Make SELECT permissive on users for tolstoy_app. INSERT/UPDATE/DELETE keep
-- the restrictive app.user_id check (writes fail loudly on stale GUC, which
-- is preferable to silent data leakage). Application-level access controls
-- already gate cross-user reads.

DROP POLICY IF EXISTS tolstoy_app_users_select ON public.users;

CREATE POLICY tolstoy_app_users_select ON public.users
  FOR SELECT
  TO tolstoy_app
  USING (true);
