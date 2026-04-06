# E2E (Playwright)

**Prereqs:** `npm run dev` with `.env.development` + DB seeded (at least one company profile, one independent worker with `team_id` null and not a team owner).

```bash
npm run test:e2e
```

Uses:

- `POST /api/dev/e2e-flow-setup` — job + pending application, bumps company deposit
- `POST /api/dev/switch-user` — impersonate company then worker (dev only)

Default E2E binds **:5010** (avoids clashing with a long-running dev server on :5000 that might lack new routes).

Use your own server on :5000:

```bash
set PLAYWRIGHT_SKIP_WEBSERVER=1
set PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000
npm run test:e2e
```

If the company UI is blocked by onboarding modals, complete onboarding for that company once or point setup at known-good accounts (future: optional body on `e2e-flow-setup`).
