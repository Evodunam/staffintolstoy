# Affiliate payout flow – testing guide

## Overview

- When a **company** or **worker** referred by an affiliate has a timesheet **approved** (and paid), the affiliate earns **20% of the platform fee** for that timesheet (e.g. $13/hr × 10 hrs = $130 platform fee → $26 affiliate commission).
- **Referred workers**: if the affiliate referred a worker, and that worker does jobs and gets their timesheet paid by a company, the affiliate gets 20% of the platform fee for that timesheet.
- **Referred companies**: if the affiliate referred a company, and that company approves timesheets (for any worker), the affiliate gets 20% of the platform fee for each such timesheet.
- Commissions are created as **Scheduled** (pending) and show in **Menu → Payment history**.
- **Referral period**: commissions are only created if the referred account (company or worker) signed up **within the last 12 months** (1 year from `profile.createdAt`).
- Payouts to the affiliate’s bank are from the **main/platform account** (when you implement the payout job). Until then, commissions stay **pending** in Payment history.

## How to test (company-referred flow)

1. **Create an affiliate**
   - Sign up as affiliate or use existing affiliate account.
   - Note the referral link/code (e.g. `?ref=ABC123`).

2. **Sign up a company via the affiliate link**
   - Use the company onboarding URL with `?ref=<affiliate_code>` so the company profile gets `referredByAffiliateId` set.
   - Complete company onboarding (so the company is “active”).

3. **Create a job and timesheet as that company**
   - As the company, create a job and have a worker submit a timesheet (or create a timesheet for testing).

4. **Approve the timesheet (company dashboard)**
   - As the company, go to the company dashboard and approve the timesheet.
   - Backend will:
     - Compute platform fee (e.g. `hours × platformFeePerHourCents`, default $13/hr).
     - If the **company** was referred by an affiliate and signed up within the last year: create an `affiliate_commission` row (status `pending`, amount = 20% of platform fee).

5. **Check affiliate side**
   - Log in as the affiliate.
   - **Analytics**: referred company appears; Sales volume and Payout columns update for that referral.
   - **Menu → Payment history**: new row with Date, Amount (e.g. $26.00), Status **Scheduled**, Reference (Timesheet #… · Job title).

6. **1-year window**
   - Commissions are only created when the referred profile’s `createdAt` is within the last 365 days.
   - To test “no commission after 1 year”: use a company (or worker) that was created more than 1 year ago and approve a timesheet; no new commission should be created for that referral.

## How to test (worker-referred flow)

1. **Create an affiliate**
   - Sign up as affiliate or use existing affiliate account.
   - Note the **worker** referral link (e.g. worker onboarding with `?ref=<affiliate_code>`).

2. **Sign up a worker via the affiliate link**
   - Use the worker onboarding URL with `?ref=<affiliate_code>` so the worker profile gets `referredByAffiliateId` set.
   - Complete worker onboarding (so the worker is active).

3. **Worker does a job and gets a timesheet paid**
   - A company (any company) creates a job, the referred worker works it and submits a timesheet.
   - The company approves the timesheet (and the worker is paid).
   - Backend will:
     - Compute platform fee (e.g. `hours × platformFeePerHourCents`, default $13/hr).
     - If the **worker** was referred by an affiliate and signed up within the last year: create an `affiliate_commission` row (status `pending`, amount = 20% of platform fee).

4. **Check affiliate side**
   - Log in as the affiliate.
   - **Analytics**: referred worker appears; Sales volume and Payout columns update for that referral.
   - **Menu → Payment history**: new row with Date, Amount (e.g. $26.00), Status **Scheduled**, Reference (Timesheet #… · Job title).

So referred workers work the same way: when their timesheet is paid (approved), the affiliate gets 20% of the platform fee for that timesheet, for 1 year from the worker’s signup.

## Platform config

- **Platform fee per hour**: `platform_config.platform_fee_per_hour_cents` (default 1300 = $13/hr).
- **Affiliate commission %**: `platform_config.affiliate_commission_percent` (default 20).
- Adjust in admin/platform config if your environment uses different values.

## Payment history (affiliate menu)

- **Menu → Payment history** lists all commissions (scheduled and paid) for the logged-in affiliate.
- Columns: **Date** (created), **Amount**, **Status** (Scheduled | Paid), **Reference** (timesheet id + job title).
- Paid status is set when your payout job sends the Mercury payment and updates the commission to `paid` and sets `paidAt`.

## Automated flow test (sample data + auto-approve + commissions)

1. **Ensure an affiliate exists** with code `test-make` (e.g. create one in the app or use seed).
2. **Start the server** (e.g. `npm run dev`) so it loads the dev routes.
3. **Run the test script:**
   ```bash
   npx tsx script/test-affiliate-payout-flow.ts
   ```
   The script will:
   - `POST /api/dev/affiliate-payout-flow-test` — create referred worker, referred company, job, and a **pending** timesheet with `submittedAt` 50 hours ago (so it’s eligible for auto-approval).
   - `POST /api/timesheets/process-auto-approvals` — run auto-approval; the timesheet is approved and **affiliate commissions** are created (worker-referred and company-referred, 20% of platform fee).
   - `GET /api/dev/affiliate-commissions?affiliateId=X` — verify commissions for that affiliate.
4. **Auto-approval** also creates affiliate commissions: when a pending timesheet is older than 48 hours, `process-auto-approvals` approves it and creates worker-referred and company-referred commissions (same 1-year window and 20% as manual approval).
