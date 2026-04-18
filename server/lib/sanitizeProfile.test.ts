import { describe, expect, it } from "vitest";
import { sanitizeProfileForViewer } from "./sanitizeProfile";

// Realistic shape — every sensitive field that lives on the profiles table
// today, so a test failure means a regression: someone added a leak path
// without updating the whitelist.
const fullProfile = {
  // Safe / public
  id: 7,
  userId: "u_abc",
  role: "company",
  firstName: "Brandon",
  lastName: "Tolstoy",
  avatarUrl: "https://x/avatar.jpg",
  bio: "Hello",
  city: "San Jose",
  state: "CA",
  trades: ["plumbing"],
  serviceCategories: ["Plumbing"],
  hourlyRate: 5500,
  experienceYears: 3,
  portfolioImages: [],
  isAvailable: true,
  faceVerified: true,
  identityVerified: true,
  isVerified: true,
  bankAccountLinked: true,
  mercuryBankVerified: true,
  contractSigned: true,
  averageRating: "4.50",
  totalReviews: 12,
  completedJobs: 30,
  reputationScore: 100,
  companyName: "Tolstoy Staffing",
  companyLogo: "https://x/logo.png",
  companyWebsite: "https://tolstoystaffing.com",
  hiringIndustries: ["construction"],
  onboardingStatus: "complete",
  onboardingStep: 9,
  affiliateCode: "BRAN10",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-04-18"),

  // Sensitive — must NOT leak to non-owners
  email: "brandon@tolstoystaffing.com",
  phone: "+15551234567",
  alternateEmails: ["other@x.com"],
  alternatePhones: ["+15559999999"],
  address: "123 Main St",
  zipCode: "95113",
  latitude: "37.3382",
  longitude: "-121.8863",
  signatureData: "data:image/png;base64,xxxx",
  w9DocumentUrl: "https://x/w9.pdf",
  insuranceDocumentUrl: "https://x/ins.pdf",
  insurancePolicyNumber: "POL-12345",
  insuranceIssuer: "Hartford",
  insuranceCoverageAmount: 100000000,
  insuranceCoverageType: "General Liability",
  stripeCustomerId: "cus_abcd",
  stripeAccountId: "acct_abcd",
  stripeIdentityVerificationId: "vs_abcd",
  mercuryRecipientId: "rec_abcd",
  mercuryExternalAccountId: "ext_abcd",
  mercuryArCustomerId: "ar_abcd",
  unitCustomerId: "u_cust",
  unitAccountId: "u_acct",
  unitCounterpartyId: "u_cp",
  unitBankRoutingNumber: "021000021",
  unitBankAccountNumber: "0123456789",
  unitBankAccountType: "checking",
  dwollaCustomerId: "dwl_abcd",
  plaidAccessToken: "access-sandbox-xxx",
  depositAmount: 200000,
  autoReplenishThreshold: 200000,
  primaryPaymentMethodId: 99,
  primaryPaymentMethodVerified: true,
  primaryPaymentMethodVerificationStatus: "verified",
  lastFailedPaymentMethodId: null,
  paymentFailureReminderSentAt: null,
  paymentFailureReminderCount: 0,
  importedCalendars: '["https://example.com/cal.ics"]',
  language: "en",
  autoFulfillDefaultsJson: '{"k":"v"}',
  googleBusinessAccessToken: "ya29.xxx",
  googleBusinessRefreshToken: "1//0xxx",
  googleBusinessTokenExpiresAt: new Date("2099-01-01"),
  googleBusinessLocationId: "loc_xxx",
  strikeCount: 1,
  referredBy: 4,
  referredByAffiliateId: 4,
  emailNotifications: false,
  smsNotifications: false,
  pushNotifications: false,
  notifyNewJobs: false,
  notifyJobUpdates: false,
  notifyPayments: false,
  notifyMessages: false,
} as const;

const SENSITIVE_KEYS = [
  "email",
  "phone",
  "alternateEmails",
  "alternatePhones",
  "address",
  "zipCode",
  "latitude",
  "longitude",
  "signatureData",
  "w9DocumentUrl",
  "insuranceDocumentUrl",
  "insurancePolicyNumber",
  "insuranceIssuer",
  "insuranceCoverageAmount",
  "insuranceCoverageType",
  "stripeCustomerId",
  "stripeAccountId",
  "stripeIdentityVerificationId",
  "mercuryRecipientId",
  "mercuryExternalAccountId",
  "mercuryArCustomerId",
  "unitCustomerId",
  "unitAccountId",
  "unitCounterpartyId",
  "unitBankRoutingNumber",
  "unitBankAccountNumber",
  "unitBankAccountType",
  "dwollaCustomerId",
  "plaidAccessToken",
  "depositAmount",
  "autoReplenishThreshold",
  "primaryPaymentMethodId",
  "primaryPaymentMethodVerified",
  "primaryPaymentMethodVerificationStatus",
  "lastFailedPaymentMethodId",
  "paymentFailureReminderSentAt",
  "paymentFailureReminderCount",
  "importedCalendars",
  "language",
  "autoFulfillDefaultsJson",
  "googleBusinessAccessToken",
  "googleBusinessRefreshToken",
  "googleBusinessTokenExpiresAt",
  "googleBusinessLocationId",
  "strikeCount",
  "referredBy",
  "referredByAffiliateId",
  "emailNotifications",
  "smsNotifications",
  "pushNotifications",
  "notifyNewJobs",
  "notifyJobUpdates",
  "notifyPayments",
  "notifyMessages",
] as const;

describe("sanitizeProfileForViewer", () => {
  it("returns the full profile unchanged for the owner", () => {
    const out = sanitizeProfileForViewer(fullProfile, "owner");
    expect(out).toBe(fullProfile);
  });

  it("redacts every sensitive field for an authenticated stranger", () => {
    const out = sanitizeProfileForViewer(fullProfile, "authenticated");
    for (const key of SENSITIVE_KEYS) {
      expect(out, `leak for "${key}"`).not.toHaveProperty(key);
    }
  });

  it("keeps the public-card fields for an authenticated stranger", () => {
    const out = sanitizeProfileForViewer(fullProfile, "authenticated");
    expect(out.firstName).toBe("Brandon");
    expect(out.companyName).toBe("Tolstoy Staffing");
    expect(out.city).toBe("San Jose");
    expect(out.state).toBe("CA");
    expect(out.averageRating).toBe("4.50");
  });

  it("redacts every sensitive field for an anonymous viewer", () => {
    const out = sanitizeProfileForViewer(fullProfile, "public");
    for (const key of SENSITIVE_KEYS) {
      expect(out, `leak for "${key}"`).not.toHaveProperty(key);
    }
  });

  it("does not expose verification badges to anonymous viewers (operational signal)", () => {
    const out = sanitizeProfileForViewer(fullProfile, "public");
    expect(out).not.toHaveProperty("identityVerified");
    expect(out).not.toHaveProperty("faceVerified");
    expect(out).not.toHaveProperty("bankAccountLinked");
    expect(out).not.toHaveProperty("mercuryBankVerified");
    expect(out).not.toHaveProperty("contractSigned");
    expect(out).not.toHaveProperty("hiringIndustries");
  });

  it("returns the input unchanged when given a falsy profile", () => {
    expect(sanitizeProfileForViewer(null as any, "public")).toBe(null);
    expect(sanitizeProfileForViewer(undefined as any, "public")).toBe(undefined);
  });
});
