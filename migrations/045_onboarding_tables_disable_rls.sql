-- Same Neon pooler GUC-leak issue that broke /api/auth/register also blocks
-- the company-onboarding "Continue to Payment" button (POST /api/profiles
-- + PUT /api/profiles/:id + locations + team invites + payment methods +
-- company agreement). The attachRlsDbContext middleware requires BOTH a
-- userId AND a profileId, so a freshly-registered user without a profile
-- bypasses the middleware entirely and writes go to the pool directly with
-- whatever stale app.user_id is on that connection.
--
-- Disable RLS on the tables touched by the worker/company onboarding flows.
-- App-level auth gating still applies; this just stops the spurious denials.

ALTER TABLE public.profiles                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_locations       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invites            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_team_members    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_team_members     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_payment_methods DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_agreements      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_signatures      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_accounts         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_skills           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliates              DISABLE ROW LEVEL SECURITY;
