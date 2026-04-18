/**
 * Stripe.js loader with advanced fraud signals disabled.
 * This prevents the r.stripe.com beacon request that can trigger CORS errors
 * in some environments (extensions, localhost, strict CSP). Payment and
 * SetupIntents still work normally.
 *
 * Memoized per publishableKey: many components call `loadStripe(key)` and
 * Stripe.js warns / wastes work if the script is loaded twice. The internal
 * `_loadStripe` from the SDK already de-dupes the script tag itself, but we
 * also cache the Promise so consumers share a single Stripe instance.
 *
 * @see https://www.npmjs.com/package/@stripe/stripe-js#disabling-advanced-fraud-detection-signals
 */
import { loadStripe as rawLoadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";

rawLoadStripe.setLoadParameters({ advancedFraudSignals: false });

const cache = new Map<string, Promise<Stripe | null>>();

export function loadStripe(publishableKey: string): Promise<Stripe | null> {
  let p = cache.get(publishableKey);
  if (!p) {
    p = rawLoadStripe(publishableKey);
    cache.set(publishableKey, p);
  }
  return p;
}
