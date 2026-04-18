import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const STORAGE_KEY = "cookie-consent.v1";

type ConsentState =
  | { decision: "accepted-all"; timestamp: string }
  | { decision: "essential-only"; timestamp: string }
  | { decision: "custom"; timestamp: string; analytics: boolean; functional: boolean };

/** Read once; does not subscribe to changes. Components that need live updates should listen for the "cookie-consent-changed" CustomEvent. */
export function getCookieConsent(): ConsentState | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.decision === "string") return parsed as ConsentState;
  } catch {
    /* ignore */
  }
  return null;
}

export function hasAnalyticsConsent(): boolean {
  const c = getCookieConsent();
  if (!c) return false;
  if (c.decision === "accepted-all") return true;
  if (c.decision === "custom") return c.analytics;
  return false;
}

function persist(state: ConsentState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("cookie-consent-changed", { detail: state }));
  } catch {
    /* ignore */
  }
}

/**
 * CCPA + GDPR-compatible cookie banner. Shows on first visit; user must make
 * an affirmative choice. Default state is "essential only" — we never opt the
 * user into analytics/functional cookies without consent (GDPR Art. 7).
 *
 * Stored decision is keyed by version so we can re-prompt when the cookie
 * inventory materially changes.
 */
export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const existing = getCookieConsent();
    if (!existing) setShow(true);
  }, []);

  if (!show) return null;

  const decide = (decision: ConsentState["decision"], extra?: { analytics: boolean; functional: boolean }) => {
    const state: ConsentState =
      decision === "custom" && extra
        ? { decision, timestamp: new Date().toISOString(), analytics: extra.analytics, functional: extra.functional }
        : { decision, timestamp: new Date().toISOString() } as ConsentState;
    persist(state);
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[2147483600] bg-background/95 border-t border-border backdrop-blur-sm shadow-2xl"
    >
      <div className="max-w-5xl mx-auto p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1 text-sm text-foreground">
          <p className="font-medium mb-1">We use cookies</p>
          <p className="text-muted-foreground leading-relaxed">
            Essential cookies keep you signed in and secure. With your consent we also use
            cookies for analytics (so we can fix bugs and improve the product). Read our{" "}
            <Link href="/privacy" className="underline text-primary">Privacy Policy</Link>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => decide("essential-only")}>
            Essential only
          </Button>
          <Button variant="outline" size="sm" onClick={() => decide("custom", { analytics: true, functional: false })}>
            Allow analytics
          </Button>
          <Button size="sm" onClick={() => decide("accepted-all")}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
