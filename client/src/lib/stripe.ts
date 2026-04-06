/**
 * Stripe.js loader with advanced fraud signals disabled.
 * This prevents the r.stripe.com beacon request that can trigger CORS errors
 * in some environments (extensions, localhost, strict CSP). Payment and
 * SetupIntents still work normally.
 * @see https://www.npmjs.com/package/@stripe/stripe-js#disabling-advanced-fraud-detection-signals
 */
import { loadStripe } from "@stripe/stripe-js/pure";

loadStripe.setLoadParameters({ advancedFraudSignals: false });

export { loadStripe };
