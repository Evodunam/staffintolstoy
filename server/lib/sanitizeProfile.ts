// Sanitize a profile row before returning it to a non-owner viewer.
//
// Whitelist (not blocklist) of safe fields. If someone adds a new sensitive
// column to the profiles table later, it stays redacted by default until
// explicitly added here.
//
// Three viewer kinds:
//   - "owner"          -> the user's own profile (return everything)
//   - "authenticated"  -> some other logged-in user viewing this profile
//   - "public"         -> unauthenticated request (most restrictive)
//
// What lives on the profiles table that we deliberately DO NOT expose to
// non-owners (and why):
//   - All payment platform IDs (stripeCustomerId, stripeAccountId,
//     mercury*, unit*, dwollaCustomerId, plaidAccessToken)
//   - All Google My Business OAuth tokens
//   - Precise location (address, latitude, longitude, zipCode)
//     -> public viewers see city + state only
//   - Contact PII (email, phone, alternateEmails, alternatePhones)
//   - Legal blobs (signatureData, w9DocumentUrl, insuranceDocumentUrl,
//     insurancePolicyNumber, insuranceIssuer, insurance dates / amounts)
//   - Private settings (notify*, *Notifications, importedCalendars, language,
//     autoFulfillDefaultsJson)
//   - Internal billing/onboarding telemetry (depositAmount,
//     autoReplenishThreshold, primaryPaymentMethod*, lastFailedPaymentMethodId,
//     paymentFailureReminder*, onboardingReminder*SentAt)
//   - Discipline (strikeCount), referral internals (referredBy*, affiliateCode)

export type ProfileViewerKind = "owner" | "authenticated" | "public";

/** Fields safe to share with another logged-in user. */
const AUTHENTICATED_FIELDS: readonly string[] = [
  "id",
  "userId",
  "role",
  "firstName",
  "lastName",
  "avatarUrl",
  "bio",
  // Coarse location only — no street/zip/lat/lng
  "city",
  "state",
  // Worker public attributes
  "trades",
  "serviceCategories",
  "hourlyRate",
  "experienceYears",
  "portfolioImages",
  "isAvailable",
  // Verification badges (boolean status only)
  "faceVerified",
  "faceVerifiedAt",
  "identityVerified",
  "identityVerifiedAt",
  "isVerified",
  "bankAccountLinked",
  "mercuryBankVerified",
  "contractSigned",
  "contractSignedAt",
  // Public reputation
  "averageRating",
  "totalReviews",
  "completedJobs",
  "reputationScore",
  // Company-side public profile
  "companyName",
  "companyLogo",
  "companyWebsite",
  "hiringIndustries",
  // Onboarding state (used by lots of UI gating; safe to show)
  "onboardingStatus",
  "onboardingStep",
  // Affiliate join code is a public share link by definition
  "affiliateCode",
  "createdAt",
  "updatedAt",
] as const;

/**
 * Fields safe for fully unauthenticated viewers (e.g. public job-poster
 * preview on a marketing page). Subset of authenticated; no team / verification
 * flags that could leak operational signal.
 */
const PUBLIC_FIELDS: readonly string[] = [
  "id",
  "role",
  "firstName",
  "lastName",
  "avatarUrl",
  "bio",
  "city",
  "state",
  "trades",
  "serviceCategories",
  "hourlyRate",
  "experienceYears",
  "portfolioImages",
  "averageRating",
  "totalReviews",
  "completedJobs",
  "companyName",
  "companyLogo",
  "companyWebsite",
  "isVerified",
  "createdAt",
];

function pick<T extends Record<string, unknown>>(obj: T, keys: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in obj) out[k] = obj[k];
  }
  return out as Partial<T>;
}

export function sanitizeProfileForViewer<T extends Record<string, unknown>>(
  profile: T,
  viewerKind: ProfileViewerKind,
): Partial<T> {
  if (!profile) return profile;
  if (viewerKind === "owner") return profile;
  if (viewerKind === "authenticated") return pick(profile, AUTHENTICATED_FIELDS);
  return pick(profile, PUBLIC_FIELDS);
}
