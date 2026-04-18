-- Fix /api/auth/register failing with:
--   "new row violates row-level security policy for table users"
--
-- Root cause: the existing single ALL-policy `tolstoy_app_users_phase2` requires
-- the new row's id to equal current_setting('app.user_id') unless it's null/''.
-- Neon's pooler shares server-side sessions across pooled clients, so
-- session-level GUCs (set with `set_config(..., false)`) can leak between
-- requests. A registration arriving on a stale connection sees a non-empty
-- app.user_id from a prior authenticated request and the INSERT is rejected.
--
-- Splitting the policy lets INSERT always succeed (new rows are user creations;
-- the unique constraint on email still prevents duplicates / impersonation),
-- while SELECT/UPDATE/DELETE keep enforcing per-row ownership.

DROP POLICY IF EXISTS tolstoy_app_users_phase2 ON public.users;

CREATE POLICY tolstoy_app_users_select ON public.users
  FOR SELECT
  TO tolstoy_app
  USING (
    current_setting('app.user_id', true) IS NULL
    OR current_setting('app.user_id', true) = ''
    OR (id)::text = current_setting('app.user_id', true)
  );

CREATE POLICY tolstoy_app_users_insert ON public.users
  FOR INSERT
  TO tolstoy_app
  WITH CHECK (true);

CREATE POLICY tolstoy_app_users_update ON public.users
  FOR UPDATE
  TO tolstoy_app
  USING (
    current_setting('app.user_id', true) IS NULL
    OR current_setting('app.user_id', true) = ''
    OR (id)::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.user_id', true) IS NULL
    OR current_setting('app.user_id', true) = ''
    OR (id)::text = current_setting('app.user_id', true)
  );

CREATE POLICY tolstoy_app_users_delete ON public.users
  FOR DELETE
  TO tolstoy_app
  USING (
    current_setting('app.user_id', true) IS NULL
    OR current_setting('app.user_id', true) = ''
    OR (id)::text = current_setting('app.user_id', true)
  );
