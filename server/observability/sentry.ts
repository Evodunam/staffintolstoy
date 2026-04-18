import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[Sentry] SENTRY_DSN not set; error tracking disabled");
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.GIT_COMMIT_SHA || undefined,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    integrations: [nodeProfilingIntegration()],
    beforeSend(event) {
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
        delete event.request.headers["x-csrf-token"];
      }
      const data = event.request?.data as Record<string, unknown> | undefined;
      if (data) {
        for (const k of ["password", "ssn", "dob", "bankAccount", "routingNumber", "stripeToken", "cardNumber", "cvv"]) {
          if (k in data) data[k] = "[redacted]";
        }
      }
      return event;
    },
  });

  initialized = true;
  console.log(`[Sentry] Initialized (env=${process.env.NODE_ENV}, traces=${process.env.NODE_ENV === "production" ? "10%" : "off"})`);
}

export { Sentry };
