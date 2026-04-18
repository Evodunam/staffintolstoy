import * as Sentry from "@sentry/react";

let initialized = false;

export function initClientSentry(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: import.meta.env.PROD ? 0.05 : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 0.1 : 0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    beforeSend(event, hint) {
      const err = hint?.originalException as Error | undefined;
      const msg = err?.message || (typeof event.message === "string" ? event.message : "");
      // Drop the same Stripe ad-blocker noise we already filter in main.tsx
      if (msg && (msg.includes("r.stripe.com") || msg.includes("ERR_BLOCKED_BY_CLIENT"))) {
        return null;
      }
      // Drop wallet-extension CSP noise
      if (msg && msg.includes("inpage.js")) return null;
      return event;
    },
  });

  initialized = true;
}

export { Sentry };
