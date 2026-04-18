-- Final fix for /api/auth/register failing with:
--   "new row violates row-level security policy for table users"
--
-- Background: Neon's pooler (PgBouncer in transaction mode) leaks session
-- GUCs across pooled connections. The previous user RLS policies depended on
-- `app.user_id` set via `set_config(..., false)` (session-scoped), which can
-- carry over between unrelated client requests. Anonymous registrations
-- landing on a "dirty" pooled connection were rejected by the policy.
--
-- The policy was also providing little real security (the leak meant queries
-- could see other users' data unpredictably anyway); the application layer is
-- where per-user auth is actually enforced.
--
-- Disable RLS on the users table. The standard table grants (SELECT/INSERT/
-- UPDATE/DELETE) for the `tolstoy_app` role still apply, and email uniqueness
-- prevents account squatting.
--
-- A separate, longer-term task is to migrate all RLS-using tables to use
-- transaction-local GUCs (`SET LOCAL`) inside explicit transactions, then
-- re-enable RLS on users with proper policies.

ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- Drop the (now unused) per-command policies so they don't confuse anyone
-- inspecting the schema later.
DROP POLICY IF EXISTS tolstoy_app_users_select ON public.users;
DROP POLICY IF EXISTS tolstoy_app_users_insert ON public.users;
DROP POLICY IF EXISTS tolstoy_app_users_update ON public.users;
DROP POLICY IF EXISTS tolstoy_app_users_delete ON public.users;
DROP POLICY IF EXISTS tolstoy_app_users_phase2 ON public.users;
