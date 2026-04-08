import Stripe from "stripe";

// Use test (sandbox) keys whenever we're not explicitly in production (localhost / dev).
// This ensures npm run dev and localhost always use pk_test_ / sk_test_ even if NODE_ENV is unset.
const isProduction = process.env.NODE_ENV === "production";
const isLocalhost = [process.env.BASE_URL, process.env.APP_URL].some(
  (u) => typeof u === "string" && u.includes("localhost")
);
const useTestKeys = !isProduction || isLocalhost || process.env.STRIPE_USE_TEST_KEYS === "true";

const secretKey = useTestKeys
  ? (process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY)
  : (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY);

// Identity flow IDs must match the key in use (test key → sandbox flows, live key → live flows)
const isTestKey = typeof secretKey === "string" && secretKey.startsWith("sk_test_");

const publishableKey = useTestKeys
  ? (process.env.STRIPE_TEST_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY)
  : (process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_TEST_PUBLISHABLE_KEY);

if (!secretKey) {
  console.warn(`[Stripe] Warning: No ${useTestKeys ? "test" : "live"} secret key configured`);
} else if (useTestKeys && typeof secretKey === "string" && secretKey.startsWith("sk_live_")) {
  console.warn("[Stripe] Dev/localhost should use test keys (sk_test_*). You have a live secret key; set STRIPE_TEST_SECRET_KEY and STRIPE_TEST_PUBLISHABLE_KEY in .env.development.");
}

const stripe = secretKey ? new Stripe(secretKey, {
  apiVersion: "2025-04-30.basil",
}) : null;

if (stripe && publishableKey) {
  const mode = typeof secretKey === "string" && secretKey.startsWith("sk_test_") ? "test (sandbox)" : "live";
  console.log(`[Stripe] Using ${mode} keys (${useTestKeys ? "dev/localhost" : "production"})`);
}

export const CARD_FEE_PERCENTAGE = 3.5;

export function calculateCardFee(amountCents: number): number {
  return Math.round(amountCents * (CARD_FEE_PERCENTAGE / 100));
}

export function getPublishableKey(): string | null {
  return publishableKey || null;
}

/** "test" when using sk_test_ (sandbox), "live" otherwise. Useful for API config and logging. */
export function getStripeKeyMode(): "test" | "live" {
  return isTestKey ? "test" : "live";
}

export function isStripeConfigured(): boolean {
  return !!stripe && !!publishableKey;
}

export function getStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }
  return stripe;
}

export async function createPaymentIntent(params: {
  amount: number;
  currency?: string;
  description?: string;
  metadata?: Record<string, string>;
  customer?: string;
  /** When charging a saved card (e.g. top-up), pass the payment method so we charge it, not save a new one. */
  payment_method?: string;
}): Promise<Stripe.PaymentIntent> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const { amount, currency = "usd", description, metadata, customer, payment_method } = params;

  const createParams: Stripe.PaymentIntentCreateParams = {
    amount,
    currency,
    description,
    metadata,
    customer,
    // Charge saved card only; do not set setup_future_usage (we are not saving a card)
    ...(payment_method
      ? { payment_method, confirm: false }
      : { automatic_payment_methods: { enabled: true } }),
  };

  const paymentIntent = await stripe.paymentIntents.create(createParams);

  return paymentIntent;
}

export async function confirmPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  return await stripe.paymentIntents.retrieve(paymentIntentId);
}

export async function getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  return await stripe.paymentIntents.retrieve(paymentIntentId);
}

export interface OffSessionChargeResult {
  success: boolean;
  paymentIntentId?: string;
  status?: string;
  error?: string;
  requiresAction?: boolean;
}

export async function chargeCardOffSession(params: {
  amount: number;
  customerId: string;
  paymentMethodId: string;
  description?: string;
  metadata?: Record<string, string>;
}): Promise<OffSessionChargeResult> {
  if (!stripe) {
    return { success: false, error: "Stripe is not configured" };
  }

  const { amount, customerId, paymentMethodId, description, metadata } = params;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      description,
      metadata,
    });

    if (paymentIntent.status === "succeeded") {
      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      };
    } else if (paymentIntent.status === "requires_action" || paymentIntent.status === "requires_confirmation") {
      return {
        success: false,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        requiresAction: true,
        error: `Payment requires customer action (${paymentIntent.status})`,
      };
    } else {
      return {
        success: false,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        error: `Payment not completed, status: ${paymentIntent.status}`,
      };
    }
  } catch (err: any) {
    const errorMessage = err.message || "Unknown Stripe error";
    console.error("[Stripe] Off-session charge failed:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/** Charge a saved ACH (us_bank_account) payment method. No fee. */
export async function chargeAchOffSession(params: {
  amount: number;
  customerId: string;
  paymentMethodId: string;
  description?: string;
  metadata?: Record<string, string>;
}): Promise<OffSessionChargeResult> {
  if (!stripe) {
    return { success: false, error: "Stripe is not configured" };
  }

  const { amount, customerId, paymentMethodId, description, metadata } = params;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: ["us_bank_account"],
      off_session: true,
      confirm: true,
      description,
      metadata,
    });

    if (paymentIntent.status === "succeeded") {
      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      };
    } else if (paymentIntent.status === "requires_action" || paymentIntent.status === "requires_confirmation") {
      return {
        success: false,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        requiresAction: true,
        error: `Payment requires customer action (${paymentIntent.status})`,
      };
    } else {
      return {
        success: false,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        error: `Payment not completed, status: ${paymentIntent.status}`,
      };
    }
  } catch (err: any) {
    const errorMessage = err.message || "Unknown Stripe error";
    console.error("[Stripe] ACH off-session charge failed:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Stripe Identity: government ID + selfie (and flow-configured checks). It does not return
// criminal history or credit data; those require a separate consumer-reporting / screening integration.
// Stripe Identity verification flow IDs (https://docs.stripe.com/identity/verification-flows)
// Sandbox (test mode): onboarding = worker onboarding, settings = Account & Documents
// Live: onboarding = worker onboarding, settings = worker settings menu
const STRIPE_IDENTITY_FLOWS = {
  // Sandbox / test keys (NODE_ENV development or STRIPE_TEST_* keys)
  sandbox: {
    onboarding: "vf_1SueVaAoeGfnj1xI10ZgyCfe",   // https://verify.stripe.com/v/test_eVqdR82E7fbe5SYdoSb3q00
    settings: "vf_1SufiKAoeGfnj1xIJ3EWGqqh",    // https://verify.stripe.com/v/test_fZudR8fqTd360yEbgKb3q01
  },
  // Live keys (production)
  live: {
    onboarding: "vf_1SufgEAoeGfnj1xIRpOnpwmZ",   // https://verify.stripe.com/v/fZudR8fqTd360yEbgKb3q01
    settings: "vf_1StujqAoeGfnj1xI6UQMzl9s",    // https://verify.stripe.com/v/eVqdR82E7fbe5SYdoSb3q00
  },
} as const;

export async function createIdentityVerificationSession(params: {
  returnUrl: string;
  flowType?: "onboarding" | "settings";
  metadata?: Record<string, string>;
  clientReferenceId?: string;
}): Promise<Stripe.Identity.VerificationSession> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const { returnUrl, flowType = "onboarding", metadata, clientReferenceId } = params;
  // Use flow IDs that match the key (test key → sandbox flows, live key → live flows)
  const flows = isTestKey ? STRIPE_IDENTITY_FLOWS.sandbox : STRIPE_IDENTITY_FLOWS.live;
  const verificationFlow = flowType === "onboarding" ? flows.onboarding : flows.settings;

  const createParams = {
    verification_flow: verificationFlow,
    return_url: returnUrl,
    ...(metadata && { metadata }),
    ...(clientReferenceId && { client_reference_id: clientReferenceId }),
  };

  try {
    const verificationSession = await stripe.identity.verificationSessions.create(createParams);
    return verificationSession;
  } catch (err: any) {
    // If verification_flow fails (e.g. flow not found for this account), fallback to legacy document session
    const isFlowError = err?.code === "resource_missing" || err?.message?.includes("verification_flow") || err?.message?.includes("No such verification");
    if (isFlowError) {
      const fallbackSession = await stripe.identity.verificationSessions.create({
        type: "document",
        return_url: returnUrl,
        ...(metadata && { metadata }),
        ...(clientReferenceId && { client_reference_id: clientReferenceId }),
        options: {
          document: {
            allowed_types: ["driving_license", "id_card", "passport"],
            require_matching_selfie: true,
          },
        },
      });
      return fallbackSession;
    }
    throw err;
  }
}

export async function getIdentityVerificationSession(sessionId: string): Promise<Stripe.Identity.VerificationSession> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  return await stripe.identity.verificationSessions.retrieve(sessionId);
}

export default {
  createPaymentIntent,
  confirmPaymentIntent,
  getPaymentIntent,
  getPublishableKey,
  getStripeKeyMode,
  isStripeConfigured,
  calculateCardFee,
  getStripe,
  chargeCardOffSession,
  chargeAchOffSession,
  createIdentityVerificationSession,
  getIdentityVerificationSession,
  CARD_FEE_PERCENTAGE,
};
