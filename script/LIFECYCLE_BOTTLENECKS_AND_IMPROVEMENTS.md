# Full lifecycle: bottlenecks, blockers & industry-standard improvements

Covers worker and company flows end-to-end, then a compiled list of improvements.

---

## 1. Worker lifecycle (high level)

| Step | Where | Blockers / bottlenecks |
|------|--------|------------------------|
| Sign up / auth | Auth routes | — |
| **Onboarding** | `WorkerOnboarding`, `RequiredOnboardingModal`, `worker-onboarding.ts` | **Block:** Must complete name, email, phone, **face photo + verified**, **≥1 skill**, **rate**, **bank** before dashboard is fully usable. `isWorkerOnboardingComplete()` gates; redirect/modal can block Find Work and Today. |
| Find work | `GET /api/jobs/find-work`, `useFindWork` | **Bottleneck:** 25s client timeout + abort; slow or heavy query can feel like “endless searching”. No pagination/cursor in find-work. |
| Apply | `POST /api/applications` | Duplicate → 400. No “save draft” or “apply with proposed rate” clarity in one place. |
| See acceptance | Notifications + dashboard | Relies on WebSocket + email; no in-app “application status” center. |
| Today / assignments | `GET /api/today/assignments` | **Block:** If onboarding incomplete, modal/redirect. **Bottleneck:** Geofence required for clock-in (5 mi manual); offline clock-in creates unvalidated timesheet → must submit location later. |
| Clock in/out | `POST /api/timesheets/clock-in`, clock-out | **Block:** 403 if not accepted for job. **Block:** Unvalidated timesheet cannot be approved until location submitted. **Strike** if location >50 mi from job. |
| Get paid | Approve → Mercury or pending_w9 | **Block:** No W-9 → pay held (pending_w9). No bank → pending_bank_setup. **Bottleneck:** Standard ACH timing; instant pay (1% + $0.30) exists but not obvious in UX. |
| Reviews | `POST /api/reviews` | Company-only; worker sees result. No worker→company review in same flow. |
| Strikes / account | `strikeCount`, 3 = ban | Location fraud, rejections; no appeal flow in-app. |

---

## 2. Company lifecycle (high level)

| Step | Where | Blockers / bottlenecks |
|------|--------|------------------------|
| Sign up / auth | Auth routes | — |
| **Onboarding** | Company onboarding, agreement | **Block:** Must sign agreement (`contractSigned`) and add **payment method** before `POST /api/jobs` (403 in prod). |
| Post job | `POST /api/jobs` | **Block:** contractSigned + payment method required. Geocoding can be slow; no draft-save-and-publish. |
| Receive applications | Jobs tab, notifications | **Bottleneck:** “Approve all” was per-job only (fixed with global “Approve all pending”). |
| Hire (accept) | `PATCH /api/applications/:id/status` | **Gap:** No `job_assignments` row created on accept (clock-in allows accepted application OR assignment; so works but not industry-standard assignment record). |
| Timesheets | Pending tab, approve/reject | **Block:** 402 if `depositAmount < totalPay`; location unverified → 400. **Bottleneck:** Bulk approve was per-job; global button added. |
| Pay workers | Same approve flow + Mercury | **Bottleneck:** AR customer 403 in sandbox if product not enabled; payouts non-blocking. |
| Complete job / review | Mark complete, `POST /api/reviews` | No single “complete job” route; status updated in dashboard. Review is company→worker only. |

---

## 3. Cross-cutting bottlenecks & blockers

- **Find-work timeout:** 25s can feel like hang; no skeleton or “refine search” when empty.
- **Geofence:** Workers outside 5 mi (manual) cannot clock in; good for fraud, bad for flexibility (e.g. remote or “start tomorrow”).
- **Offline clock-in:** Creates unvalidated timesheet; worker must submit location later; company cannot approve until then.
- **W-9 / bank:** Worker pay held until W-9 + bank; no in-app “complete to get paid” funnel.
- **Balance vs multiple approvals:** Approving one timesheet can drop balance below next; partial bulk failure with “Insufficient balance” (toasts improved).
- **Notifications:** Email (Resend) sandbox limits; WebSocket only for connected clients; no guaranteed delivery receipt.
- **Job status visibility:** Worker sees “accepted” but no explicit “scheduled / in progress / completed” pipeline in one place.
- **No job_assignment on accept:** Accept updates application only; no formal assignment record (industry often has both).

---

## 4. Industry-standard improvements (compiled list)

### 4.1 Worker experience

- **Pay speed & clarity:** Default to “get paid in X days” and prominent “Instant pay (1% + $0.30)” toggle with clear fee; show expected pay date after approve.
- **Onboarding funnel:** Single linear “complete profile to get paid” checklist (name, email, phone, photo, skills, rate, W-9, bank) with progress % and skip-where-allowed.
- **Application status center:** Dedicated “My applications” with status (pending / accepted / rejected) and link to job; deep link from notifications.
- **Find work:** Pagination or cursor; filters (date, rate range, distance); “No jobs match – try broader filters” + save search.
- **Today / assignments:** Clear “Scheduled” vs “In progress” vs “Completed”; show next shift time and “Clock in available at X”.
- **Clock-in flexibility:** Optional “manager-approved exception” or “start tomorrow” so workers aren’t blocked by geofence when job isn’t at site yet.
- **Strikes & appeals:** In-app strike history and “dispute / appeal” with reason; timeline of rejections and location issues.

### 4.2 Company experience

- **Job draft:** Save job as draft (no payment/contract required); require contract + payment only on “Publish”.
- **Hire → assignment:** On accept, create `job_assignments` row (and optionally send “You’re scheduled” to worker); use assignment as source of truth for “who is on this job”.
- **Timesheet approval:** One “Approve all pending” (done); show running balance impact before approve; warn “Balance will be $X after these approvals”.
- **Payments & AR:** Clear “Funding” and “Spend” history; reconcile with Stripe/Mercury; avoid calling AR customer create in sandbox if product not enabled (feature-flag or env).

### 4.3 Platform & reliability

- **Idempotency:** Critical payment and payout endpoints (approve, clock-in, payout) use idempotency keys to avoid double-debit/double-pay.
- **Notifications:** In-app notification center with read state; optional push (PWA); email as fallback with “View in app” link.
- **Status pipeline:** Explicit statuses for job (draft → open → in_progress → completed) and application (pending → accepted / rejected) and timesheet (pending → approved / rejected / disputed) with audit events.
- **Disputes:** Timesheet “disputed” status with reason and optional admin resolution; don’t pay out until resolved or time-bound auto-resolve.

### 4.4 Mobile & offline

- **PWA / install:** Installable app, offline-capable shell; queue clock-in/out and sync when online (partially present).
- **Location:** Single “enable location for clock-in” prompt with explanation; fallback IP when device location denied (with “approval may be delayed” message).

### 4.5 Compliance & trust

- **W-9 flow:** Single “Upload W-9 to receive pay” step with validation and “pending_w9” explanation; release batch when W-9 verified.
- **Contract & agreement:** Company agreement signed before first job post; worker agreement before first apply (or first clock-in); store version and timestamp.
- **Audit trail:** Log who approved which timesheet, who created job, who accepted application; expose in admin or support view.

---

## 5. Quick reference – where things live

| Concern | Worker | Company |
|--------|--------|--------|
| Onboarding gate | `worker-onboarding.ts`, `RequiredOnboardingModal`, `WorkerOnboarding` | Agreement + payment in `POST /api/jobs` and company onboarding |
| Find work / jobs | `useFindWork`, `FindWorkPage`, `/api/jobs/find-work` | `CompanyDashboard` Jobs tab, `POST /api/jobs` |
| Apply / accept | `POST /api/applications`, `PATCH …/status` | Hire button, `handleAcceptApplication` |
| Clock-in/out | `TodayPage`, `POST /api/timesheets/clock-in`, clock-out | — |
| Approve / pay | — | Timesheets tab, `useBulkApproveTimesheets`, `PUT /api/timesheets/:id/approve`, bulk-approve |
| Balance | — | `depositAmount`, `POST /api/mt/company/fund`, auto-replenishment |
| Payouts | W-9 + bank, `pending_w9`, instant pay option | — |
| Reviews | Receive only | `POST /api/reviews` |

---

## Implemented (in repo)

- **Hire → assignment:** `storage.updateApplicationStatus` upserts `job_assignments` on `accepted` (agreed rate = proposed rate if set, else job `hourlyRate`). Covers company `PATCH /api/applications/:id/status`, worker `POST /api/applications/:id/accept`, direct-inquiry auto-accept, scripts, and dev seeds that use `updateApplicationStatus`. Sets `respondedAt` on accepted / rejected / withdrawn.
- **Backfill assignments:** `npm run backfill:job-assignments` (dev) / `backfill:job-assignments:prod` — upserts `job_assignments` for all accepted applications.
- **Pay clarity:** Payment history shows “When you get paid” (standard ACH vs instant fee, W-9/bank) + link to Payout settings.
- **Application status UX:** Jobs tab subtitle explains tabs vs Today vs payment settings.
- **Find work timeout:** Client treats 25s abort as `FIND_WORK_TIMEOUT`; desktop + mobile show retry instead of a silent empty list.
- **Approve idempotency:** `PUT /api/timesheets/:id/approve` returns `alreadyApproved: true` + current balance if already approved (no double charge). `POST /api/timesheets/bulk-approve` treats already-approved as `{ success: true, skipped: true }`.
- **Bulk approve hours:** Server bulk path uses same hours as single approve (`adjustedHours` if set, else `totalHours`) and persists `totalPay` + `adjustedHours` on the row.
- **Company balance preview:** Pending timesheets tab shows estimated total worker pay for all pending, current balance, projected balance after approving all; warns if projected &lt; 0.

- **Mercury payout idempotency:** Worker payouts for a timesheet use deterministic key `timesheet-payout-${timesheetId}` (single approve, bulk approve, auto-approval service, admin batch payout). Retries do not double-pay.
- **Disputed timesheets:** Approve (single and bulk) returns 400 / per-item error when status is `disputed`; payout is not created until dispute is resolved (e.g. company re-approves or admin resolves).

- **Job drafts:** Jobs can be created with `status: "draft"` (no contract/payment required). `POST /api/jobs` accepts `status: "draft"` in body; draft jobs skip notify/email. `POST /api/jobs/:id/publish` transitions draft → open (requires contract + payment), then notifies workers. PostJob has "Save as draft"; company Jobs tab has a "Draft" filter and "Publish" per draft. Migration `034_jobs_status_draft.sql` adds draft to status check.

- **W9 batch idempotency:** W-9 release uses deterministic key `w9-release-worker-${profileId}-${payoutIds.join('-')}` so retrying the same set of payouts does not double-pay.
- **Notifications API:** GET and PATCH (read / read-all) are restricted to the authenticated user’s own profile; no IDOR.

- **Notification center (full page):** Route `/dashboard/notifications` with full list, “Mark all read,” and “View all” from the bell dropdown on worker dashboard. GET `/api/notifications/:profileId` accepts optional `limit` and `offset`; notification center uses infinite list (20 per page) with “Load more”.
- **Find-work empty state:** When filters are active and the filtered list is empty, worker sees “No jobs match your filters” and “Try clearing some filters or check back later” with a “Clear filters” button (desktop and mobile Find tab).

- **Notification filters (unread):** GET `/api/notifications/:profileId` supports `unreadOnly=1` (or `true`). Notification center has an “Unread only” switch; paginated load-more works with the filter.
- **Company notification inbox:** Route `/company-dashboard/notifications` (same `NotificationsCenter`); worker nav hidden for company role; “View all” in `NotificationPopup` routes by role. **Bugfix:** `NotificationPopup` now loads profile via `useAuth` + `useProfile(user?.id)` (was always disabled).

- **Today / next shift:** Day view shows “Next shift: Clock in at {{time}}” when there is an upcoming scheduled shift today (first start time ≥ current time). Sections already labeled “Active / In Progress”, “Scheduled”, “Flexible / On-Demand”; chips show “Clock in available at {{time}}”.

- **Today completed section:** `/api/today/assignments` now includes `todayCompletedTimesheets` per assignment (timesheets for today with `clockOutTime` set). Day view shows a “Completed” section with one row per completed shift (job title, clock in – clock out, duration); tap opens job details. Empty state only when there are no active, scheduled, flexible, or completed items.

- **Notification type filter:** GET `/api/notifications/:profileId` accepts optional `type` (comma-separated, e.g. `application_approved,application_rejected`). Notification center has a “Type” dropdown: All, Applications, Payments, Jobs, Messages; selection resets pagination and works with “Unread only”.

- **Find-work cursor pagination:** GET `/api/jobs/find-work` accepts optional `limit` and `cursor` (job id). When present, response is `{ jobs, nextCursor }`; otherwise returns full array (backward compatible). Client uses `useFindWorkInfinite` (page size 25); list/table/card views show “Load more jobs” when `hasNextPage`; mobile find list has “Load more” at bottom. Initial load is faster; “Load more” fetches next page.

- **Expected pay date after approve:** PUT `/api/timesheets/:id/approve` response includes `expectedPayTiming` (e.g. "Standard ACH: 2-3 business days", "Worker will be paid after W-9 is uploaded", "Instant payout: funds on the way (fee applied)"). Company dashboard toast after single approve shows this text. Worker gets an in-app notification (type `timesheet_approved`) with the same pay timing in the body; notification type added to schema and created on approve.

- **Application status center:** Dedicated “My applications” page at `/dashboard/applications` (`MyApplicationsPage`). Lists all applications with status (Pending / Accepted / Not selected), job title, company name, applied date; filter tabs (All, Pending, Accepted, Not selected); tap row opens job (`/jobs/:id`). Worker nav includes “Applications” link. GET `/api/applications/worker/:workerId` restricted to own profile (403 if not worker or wrong id). Locale: `myApplications` (en, es, fr, pt, zh).

*Remaining ideas from this doc: additional UX polish, etc.*
