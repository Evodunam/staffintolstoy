-- Disable RLS on the sessions table for the same reason we disabled it on
-- users: Neon's pooler leaks session GUCs across pooled connections, which
-- can cause occasional spurious denials (especially around login flows that
-- write the session record before app.user_id is set in the same request).
-- Sessions are managed by express-session + connect-pg-simple and are scoped
-- by sid; cross-row access via the app role isn't useful even if granted.

ALTER TABLE public.sessions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tolstoy_app_full_access ON public.sessions;
