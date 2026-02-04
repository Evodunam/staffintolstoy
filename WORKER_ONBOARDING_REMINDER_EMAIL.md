# Worker Onboarding Reminder Email Sequence

Workers with **incomplete** onboarding receive up to **3 reminder emails** over ~1 month. Each email includes a **dynamic list of uncompleted items** with direct links to finish where they left off.

## Behavior

- **Reminder 1**: Sent when a worker has incomplete onboarding (no prior reminder sent).
- **Reminder 2**: Sent ~10 days after Reminder 1 if still incomplete.
- **Reminder 3**: Sent ~10 days after Reminder 2 if still incomplete.

Emails are sent via **Resend** using the existing `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (or default).

## Dynamic content

Each email includes:

- **Resume URL**: Link to the step they left off (e.g. `/worker-onboarding?step=3&sub=rate`).
- **Remaining steps**: A list of incomplete items, each linking to the exact step (or sub-step for step 3: rate, categories, portfolio).

Steps and URLs:

| Step | URL | Description |
|------|-----|-------------|
| 1 | `/worker-onboarding?step=1` | Account & identity (name, email, phone, face) |
| 2 | `/worker-onboarding?step=2` | Location |
| 3 | `/worker-onboarding?step=3&sub=rate` | Set hourly rate |
| 3 | `/worker-onboarding?step=3&sub=categories` | Select industries |
| 3 | `/worker-onboarding?step=3&sub=portfolio` | Prior work photos |
| 4 | `/worker-onboarding?step=4` | Connect bank (payouts) |
| 5 | `/worker-onboarding?step=5` | Upload W-9 |
| 6 | `/worker-onboarding?step=6` | Sign contract |

## Database

Run the migration to add reminder sent timestamps to `profiles`:

```bash
# From project root (adjust for your DB)
psql $DATABASE_URL -f migrations/004_add_onboarding_reminder_sent_at.sql
```

Columns added: `onboarding_reminder_1_sent_at`, `onboarding_reminder_2_sent_at`, `onboarding_reminder_3_sent_at`.

## Cron / scheduler

Call the endpoint **once per day** (e.g. 9:00 AM):

```bash
# Optional: set CRON_SECRET in env and pass it to protect the endpoint
curl -X POST "https://your-app.com/api/cron/worker-onboarding-reminders" \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

- **Endpoint**: `POST /api/cron/worker-onboarding-reminders`
- **Protection**: If `CRON_SECRET` is set in the environment, the request must include header `x-cron-secret: <CRON_SECRET>`.
- **Response**: `{ success: true, sent: number, skipped: number, errors: number }`

## Manual test (development)

```bash
curl -X POST "http://localhost:5000/api/dev/test-worker-onboarding-reminders"
```

This runs the same logic as the cron and returns the counts.

## Environment

- `RESEND_API_KEY` – Required for sending (existing).
- `RESEND_FROM_EMAIL` or default – From address (existing).
- `BASE_URL` or `APP_URL` – Used for links in emails (e.g. `https://your-app.com`).
- `CRON_SECRET` – Optional; if set, cron endpoint requires `x-cron-secret` header.
