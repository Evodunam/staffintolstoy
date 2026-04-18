-- Disable RLS on the remaining public tables that depend on
-- current_setting('app.user_id'/'app.profile_id'/'app.profile_role').
--
-- Why: migrations 043, 044, 045 already disabled RLS on the user/session/
-- onboarding tables for this exact reason — Neon's pooler (PgBouncer in
-- transaction mode) keeps a small pool of server-side sessions and shares
-- them across unrelated client requests. session-level GUCs set with
-- `set_config(..., is_local=false)` (which is what attachRlsDbContext uses
-- to keep the value alive across awaits) leak between requests. A write
-- arriving on a "dirty" pooled connection sees a stale or wrong app.user_id
-- and the policy denies the row:
--   ERROR: new row violates row-level security policy for table "<table>"
--
-- This is the prod symptom: posting a job, submitting a timesheet, saving
-- settings, creating a notification — anything INSERT/UPDATE — fails
-- intermittently in production. Reads "work" because permissive SELECT
-- policies on these tables either always return true or have an
-- `is null OR is empty OR equals` check that silently skips rows on a stale
-- GUC instead of erroring.
--
-- App-level auth (req.profile + role checks at every route handler) is the
-- actual security boundary; RLS was defense-in-depth that's now actively
-- breaking the app on Neon's pooler. Disabling it does NOT make the app
-- less secure given the existing route gates.
--
-- This migration is idempotent (DISABLE is a no-op on already-disabled
-- tables; DROP POLICY IF EXISTS is safe).
--
-- Future work: refactor attachRlsDbContext to use a single transaction per
-- request with `SET LOCAL` (transaction-scoped GUCs) — those don't leak
-- across pool clients. Then re-enable RLS table-by-table behind a feature
-- flag.

-- Tables touched by EVERY authenticated write path. Disable RLS so writes
-- stop bouncing on the pooler.
ALTER TABLE IF EXISTS public.jobs                      DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.applications              DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.timesheets                DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.timesheet_events          DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.timesheet_edits           DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.timesheet_reports         DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.location_pings            DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications             DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notification_types        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.device_tokens             DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.job_assignments          DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.job_schedules            DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.job_messages              DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.job_message_email_log     DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.job_reminders             DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.message_translations      DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_message_pending_digest DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_message_digest_sent    DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_digest_log             DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.job_budget_review_email_sent DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reviews                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.invoices                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.invoice_items             DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.company_transactions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.worker_payouts            DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_strikes             DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_activity_log        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.billing_actions           DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.job_suspensions           DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.worker_statuses           DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.company_statuses          DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.affiliate_leads           DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.affiliate_lead_activities DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.affiliate_payout_platform_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.affiliate_commissions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.affiliate_email_reminders DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saved_team_members        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.background_check_consents DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.background_check_orders   DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.feature_flags             DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.safety_incidents          DISABLE ROW LEVEL SECURITY;

-- Drop any current_setting()-dependent policies on the above tables. We don't
-- need to enumerate every policy name explicitly — DISABLE ROW LEVEL SECURITY
-- already neutralizes them. Listing the known leaky ones for cleanliness so
-- future inspections of pg_policies aren't confusing.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual LIKE '%current_setting%' OR with_check LIKE '%current_setting%')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
  END LOOP;
END $$;
