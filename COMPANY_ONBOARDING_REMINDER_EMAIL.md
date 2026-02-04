# Company Onboarding Reminder Email (Weekly)

Companies with **incomplete** onboarding receive a **weekly reminder email** until they complete their profile. Each email includes a **dynamic list of remaining steps** with direct links to resume where they left off.

## Behavior

- **Recurring**: One email per week until `onboardingStatus` is `complete`.
- **Content**: Greeting, list of remaining steps (each step links to its URL), and a "Resume where I left off" button.
- **Resend**: Uses existing `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.

## Dynamic content

- **Resume URL**: `/company-onboarding?step=N` (N = current step 1–5).
- **Remaining steps**: From current step through step 5, each with label and URL:

| Step | URL | Label |
|------|-----|--------|
| 1 | `/company-onboarding?step=1` | Select industries you hire for |
| 2 | `/company-onboarding?step=2` | Add business info & locations |
| 3 | `/company-onboarding?step=3` | Set up team access (optional) |
| 4 | `/company-onboarding?step=4` | Payment setup (deposit & bank) |
| 5 | `/company-onboarding?step=5` | Sign the hiring agreement |

## Database

Run the migration:

```bash
psql $DATABASE_URL -f migrations/005_add_company_onboarding_reminder_sent_at.sql
```

Column added on `profiles`: `company_onboarding_reminder_sent_at` (last reminder sent timestamp).

## Cron / scheduler

Call **once per week** (e.g. every Monday 9:00 AM):

```bash
curl -X POST "https://your-app.com/api/cron/company-onboarding-reminders" \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

- **Endpoint**: `POST /api/cron/company-onboarding-reminders`
- **Protection**: If `CRON_SECRET` is set, request must include header `x-cron-secret`.
- **Response**: `{ success: true, sent: number, skipped: number, errors: number }`
- **Logic**: Only companies with `onboardingStatus === "incomplete"` and `role === "company"` are considered. A reminder is sent only if `company_onboarding_reminder_sent_at` is null or 7+ days ago.

## Manual test (development)

```bash
curl -X POST "http://localhost:5000/api/dev/test-company-onboarding-reminders"
```

## Environment

- `RESEND_API_KEY` – Required for sending (existing).
- `BASE_URL` or `APP_URL` – Used for links in emails.
- `CRON_SECRET` – Optional; if set, cron endpoint requires `x-cron-secret` header.
