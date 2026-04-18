// Map raw Stripe / payment-method error text to a friendly toast.
// Returns { title, description } where title is short ("Invalid payment method")
// and description is the actionable bit ("Check the card number...").
//
// Used by company onboarding's payment step and the dashboard's add-card flows
// so users see "Invalid payment method" / "Card declined" instead of the raw
// Stripe machine string.
export function humanizePaymentError(raw: string | undefined | null): {
  title: string;
  description: string;
} {
  const fallback = {
    title: "Invalid payment method",
    description:
      "We couldn't save that payment method. Double-check the details and try again.",
  };
  if (!raw) return fallback;
  const msg = String(raw).trim();
  const lower = msg.toLowerCase();

  // Card-side validation
  if (/your card (was )?declined|card_declined|do_not_honor|generic_decline/.test(lower)) {
    return {
      title: "Card declined",
      description:
        "Your bank declined this card. Try another card or contact your bank.",
    };
  }
  if (/insufficient_funds|insufficient funds/.test(lower)) {
    return {
      title: "Insufficient funds",
      description:
        "There aren't enough funds on this card. Try another payment method.",
    };
  }
  if (/expired_card|card has expired|card is expired/.test(lower)) {
    return {
      title: "Card expired",
      description: "This card has expired. Use a different card.",
    };
  }
  if (/incorrect_cvc|security code|cvc/.test(lower)) {
    return {
      title: "Invalid security code",
      description:
        "The CVC / security code on the back of the card doesn't match.",
    };
  }
  if (/incorrect_number|invalid_number|invalid card number|card number is incorrect/.test(lower)) {
    return {
      title: "Invalid card number",
      description: "Re-enter the 16-digit card number.",
    };
  }
  if (/invalid_expiry|expiration|expiry/.test(lower)) {
    return {
      title: "Invalid expiry date",
      description: "Check the month and year on your card.",
    };
  }
  if (/incorrect_zip|postal_code|zip/.test(lower)) {
    return {
      title: "Invalid ZIP code",
      description: "The ZIP code doesn't match the card on file.",
    };
  }
  if (/processing_error|try again later|temporarily/.test(lower)) {
    return {
      title: "Processing error",
      description:
        "Something went wrong on the payment processor. Try again in a moment.",
    };
  }
  // Bank account / ACH
  if (/routing_number|invalid routing/.test(lower)) {
    return {
      title: "Invalid routing number",
      description: "The 9-digit routing number doesn't look right.",
    };
  }
  if (/account_number|invalid account/.test(lower)) {
    return {
      title: "Invalid account number",
      description: "Double-check your bank account number and try again.",
    };
  }
  // Generic auth / setup
  if (/authentication.*required|3d.?secure|requires_action/.test(lower)) {
    return {
      title: "Verification required",
      description:
        "Your bank wants to verify this payment. Complete the prompt and try again.",
    };
  }
  if (/network|fetch|timeout/.test(lower)) {
    return {
      title: "Network error",
      description:
        "Couldn't reach the payment processor. Check your connection and retry.",
    };
  }
  return {
    ...fallback,
    description: msg.length < 140 ? msg : fallback.description,
  };
}
