/**
 * Stripe Identity verification external URLs (open in new tab).
 * Sandbox = test mode (development); Live = production.
 */
export const STRIPE_IDENTITY_VERIFY_URLS = {
  sandbox: {
    onboarding: "https://verify.stripe.com/v/test_eVqdR82E7fbe5SYdoSb3q00",
    settings: "https://verify.stripe.com/v/test_fZudR8fqTd360yEbgKb3q01",
  },
  live: {
    onboarding: "https://verify.stripe.com/v/fZudR8fqTd360yEbgKb3q01",
    settings: "https://verify.stripe.com/v/eVqdR82E7fbe5SYdoSb3q00",
  },
} as const;

export type IdentityFlowType = "onboarding" | "settings";

/** Returns the external verify URL for the current environment (sandbox in dev, live in prod). */
export function getIdentityVerificationUrl(flowType: IdentityFlowType): string {
  const isSandbox = import.meta.env.DEV;
  const env = isSandbox ? "sandbox" : "live";
  return STRIPE_IDENTITY_VERIFY_URLS[env][flowType];
}
