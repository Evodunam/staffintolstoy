// Strip server-controlled fields from a client-supplied profile update payload.
//
// These fields must never be set by a client request:
//
//   - Identity / FK glue (userId, role, teamId, referredBy, referredByAffiliateId)
//     -> mutating these would let a user move a profile to a different account
//        or join a team they don't belong to.
//
//   - Payment-platform IDs (stripeCustomerId, stripeAccountId,
//     stripeIdentityVerificationId, mercuryRecipientId,
//     mercuryExternalAccountId, mercuryArCustomerId, dwollaCustomerId,
//     plaidAccessToken, unit*)
//     -> mutating these would let a user redirect another account's payouts /
//        invoicing into accounts they control.
//
//   - Verification + linkage flags (faceVerified, faceVerifiedAt,
//     identityVerified, identityVerifiedAt, isVerified, bankAccountLinked,
//     mercuryBankVerified, contractSigned, contractSignedAt)
//     -> these are set by Stripe Identity webhooks / Mercury callbacks /
//        signature-capture flows; client-side flips bypass real verification.
//
//   - Account balance / billing internals (depositAmount,
//     autoReplenishThreshold, primaryPaymentMethodId,
//     primaryPaymentMethodVerified, primaryPaymentMethodVerificationStatus,
//     lastFailedPaymentMethodId, paymentFailureReminderSentAt,
//     paymentFailureReminderCount)
//     -> a client could set their own balance to any amount and bypass funding
//        requirements.
//
//   - Reputation / discipline (reputationScore, averageRating, totalReviews,
//     completedJobs, strikeCount, isVerified)
//     -> already partially blocked by insertProfileSchema.omit() but listed
//        here for defense in depth.
//
//   - W-9 receipt timestamp (w9UploadedAt)
//     -> set only after Mercury attachment succeeds, server-side.
//
//   - Email / push reminder telemetry (onboardingReminder*SentAt,
//     companyOnboardingReminderSentAt)
//     -> set by reminder schedulers, server-side only.
//
//   - Google My Business OAuth tokens
//     -> set by OAuth callback, never accepted from client body.
//
//   - DB metadata (id, createdAt, updatedAt) — already blocked by Drizzle
//     omit() in insertProfileSchema, listed here for clarity.

const SERVER_CONTROLLED_PROFILE_FIELDS = [
  // Identity / FK glue
  "id",
  "userId",
  "role",
  "teamId",
  "referredBy",
  "referredByAffiliateId",
  "affiliateCode",
  "createdAt",
  "updatedAt",

  // Stripe
  "stripeCustomerId",
  "stripeAccountId",
  "stripeIdentityVerificationId",

  // Mercury
  "mercuryRecipientId",
  "mercuryExternalAccountId",
  "mercuryArCustomerId",
  "mercuryBankVerified",

  // Unit (deprecated platform; never accept from client)
  "unitCustomerId",
  "unitAccountId",
  "unitCounterpartyId",
  "unitBankRoutingNumber",
  "unitBankAccountNumber",
  "unitBankAccountType",

  // Other payment platforms
  "dwollaCustomerId",
  "plaidAccessToken",
  "bankAccountLinked",

  // Verification badges (server-set by webhooks / scheduled jobs)
  "faceVerified",
  "faceVerifiedAt",
  "identityVerified",
  "identityVerifiedAt",
  "isVerified",
  "contractSigned",
  "contractSignedAt",

  // Account balance / billing internals
  "depositAmount",
  "autoReplenishThreshold",
  "primaryPaymentMethodId",
  "primaryPaymentMethodVerified",
  "primaryPaymentMethodVerificationStatus",
  "lastFailedPaymentMethodId",
  "paymentFailureReminderSentAt",
  "paymentFailureReminderCount",

  // Reputation / discipline
  "reputationScore",
  "averageRating",
  "totalReviews",
  "completedJobs",
  "strikeCount",

  // W-9 receipt (set after Mercury attachment succeeds)
  "w9UploadedAt",

  // Reminder telemetry (set by schedulers)
  "onboardingReminder1SentAt",
  "onboardingReminder2SentAt",
  "onboardingReminder3SentAt",
  "companyOnboardingReminderSentAt",

  // Google My Business OAuth (set by OAuth callback)
  "googleBusinessAccessToken",
  "googleBusinessRefreshToken",
  "googleBusinessTokenExpiresAt",
  "googleBusinessLocationId",
] as const;

const SERVER_FIELD_SET = new Set<string>(SERVER_CONTROLLED_PROFILE_FIELDS);

/**
 * Drop any client-supplied field that should only be writable by the server.
 * Returns a NEW object — does not mutate `input`. Logs the dropped keys when
 * any are present so attempted privilege-escalation attempts are observable.
 */
export function stripServerControlledProfileFields<T extends Record<string, unknown>>(
  input: T,
  context?: { profileId?: number; userId?: string; route?: string },
): Partial<T> {
  if (!input || typeof input !== "object") return input;
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (SERVER_FIELD_SET.has(key)) {
      dropped.push(key);
    } else {
      out[key] = value;
    }
  }
  if (dropped.length > 0) {
    console.warn(
      "[ProfileWriteGuard] Dropped server-controlled fields from update:",
      {
        ...context,
        droppedFields: dropped,
      },
    );
  }
  return out as Partial<T>;
}

export const __SERVER_CONTROLLED_PROFILE_FIELDS_FOR_TEST = SERVER_CONTROLLED_PROFILE_FIELDS;
