# Full flow analysis – job post to payout and review

This document summarizes the full lifecycle, failure points, and bugs that have been fixed.

## 1. Company side

| Step | Where | Notes |
|------|--------|------|
| Add funds | `POST /api/mt/company/fund` (routes.ts ~14825) | Stripe only (card/ACH). Updates `profiles.depositAmount`, creates `company_transactions` type `deposit`. |
| Auto-replenishment | `server/auto-replenishment-scheduler.ts` | Every 5 min; charges when balance below trigger; uses Stripe. |
| Job post | `POST /api/jobs` (routes.ts ~3574) | Requires `contractSigned` and at least one company payment method. `storage.createJob()`. |

## 2. Worker apply and company accept

| Step | Where | Notes |
|------|--------|------|
| Apply | `POST /api/applications` (routes.ts ~5261) | Duplicate (jobId+workerId) → 400 "You have already applied" (catch 23505). |
| Accept | `PATCH /api/applications/:id/status` (routes.ts ~5446) | Company only. Sets `applications.status = 'accepted'`. No `job_assignments` insert in codebase. |

## 3. Timesheet: clock-in and approve

| Step | Where | Notes |
|------|--------|------|
| Clock-in | `POST /api/timesheets/clock-in` (routes.ts ~8096) | **Fixed:** Requires accepted application or job_assignment for this job; else 403 `NOT_ACCEPTED_FOR_JOB`. Geofence when location sent; unvalidated when offline. |
| Clock-out | Routes (e.g. submit location, clock-out) | Updates `totalHours`, `totalPay`, `locationVerified` (if pings used). |
| Approve | `PUT /api/timesheets/:id/approve` (routes.ts ~10252) | **Fixed:** If company `depositAmount < totalPay` → 402 `INSUFFICIENT_BALANCE`; no deduction or payout. Location unverified → 400 `LOCATION_UNVERIFIED`. Then: balance -= totalPay, invoice, worker payout (Mercury or pending_w9/pending_bank_setup). |
| Bulk approve | `POST /api/timesheets/bulk-approve` | **Fixed:** Per timesheet, if balance < totalPay → skip with "Insufficient balance". |

## 4. Payouts

| Flow | Where | Notes |
|------|--------|------|
| Worker has W-9 + bank | Same approve handler | `mercuryService.sendPayment()`, then `createWorkerPayout` + `updateTimesheet(paymentStatus)`. |
| Worker no W-9 | Same approve handler | `createWorkerPayout(status: 'pending_w9')`, email. |
| W-9 release | `runW9PayoutReleaseForWorker()` (routes.ts ~72) | Triggered: PATCH profile (W-9 uploaded), GET pending-w9-payouts (cooldown), POST mt/worker/payout-account. Batches pending_w9, one Mercury payment, then updates payouts + timesheets. |

## 5. Review and job complete

| Step | Where | Notes |
|------|--------|------|
| Review | `POST /api/reviews` (routes.ts ~11635) | Company only. Upsert review, recalc worker `averageRating` / `totalReviews`. |
| Job complete | `storage.updateJobStatus(jobId, 'completed')` | No single route; dashboard/API can update job status. |

## 6. Invariants and edge cases

- **Applications:** Unique on `(jobId, workerId)` only. Multi-slot (same worker, different teamMemberId) would need schema change to `(jobId, workerId, teamMemberId)`.
- **Balance:** Never goes negative in DB; approve rejects when insufficient (402).
- **Clock-in:** Only workers with accepted application (or job_assignment) for that job can clock in.

## 7. Script

- `script/full-flow-test.ts` runs the full lifecycle using storage (no HTTP). Run: `npx dotenv -e .env.development -- tsx script/full-flow-test.ts`
- It does not re-test API failure paths (403 on clock-in without accept, 402 on approve with insufficient balance); those are enforced in the routes above.

## 8. Playwright E2E (real UI)

- **`POST /api/dev/e2e-flow-setup`** (dev only): open job at Apple Park coords + pending application; bumps company deposit; returns `jobId`, `applicationId`, `companyUserId`, `workerUserId`, `workerProfileId`, `jobLat`/`jobLng`.
- **`npm run test:e2e`**: starts dev server (unless `PLAYWRIGHT_SKIP_WEBSERVER=1`), switches to company → `/company-dashboard/jobs?jobId=&applicationId=` → clicks `data-testid="button-hire-{applicationId}"` → switches worker → geolocation at job → `/dashboard/today` → `button-clock-in-{jobId}` → asserts `PATCH …/status` + `POST …/clock-in` + active timesheet.
- See `e2e/README.md`. Fails if no suitable worker (`team_id` null, not a team owner) or company UI blocked by onboarding.
