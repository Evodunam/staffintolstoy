import { pgTable, text, serial, integer, boolean, timestamp, jsonb, decimal, uniqueIndex, index, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";
export * from "./models/auth";
import { users } from "./models/auth";

// === ENUMS ===
export const userRoles = ["worker", "company"] as const;
export const jobStatuses = ["open", "in_progress", "completed", "cancelled"] as const;
export const applicationStatuses = ["pending", "accepted", "rejected", "withdrawn"] as const;
export const onboardingStatuses = ["incomplete", "complete"] as const;
export const skillLevels = ["lite", "elite"] as const;
export const payoutProviders = ["stripe", "dwolla", "plaid", "unit", "mercury"] as const;
export const payoutStatuses = ["pending", "verified", "failed"] as const;

// Service categories with Lite/Elite distinctions
export const serviceCategories = [
  "Laborer",
  "Landscaping", 
  "Painting",
  "Drywall",
  "Concrete",
  "Carpentry Lite",
  "Carpentry Elite",
  "Electrical Lite",
  "Electrical Elite",
  "Plumbing Lite",
  "Plumbing Elite",
  "HVAC Lite",
  "HVAC Elite"
] as const;

// Legacy trades for backwards compatibility
export const trades = [
  "Electrical", "Plumbing", "HVAC", "General Labor", "Drywall", 
  "Painting", "Demolition", "Cleaning", "Concrete", "Carpentry"
] as const;

// === CORE TABLES ===

// Skills table - normalized skill definitions
export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category").notNull(), // e.g., "Electrical", "Plumbing"
  description: text("description"),
  hasLiteElite: boolean("has_lite_elite").default(false), // Whether this skill has lite/elite levels
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_skills_category").on(table.category),
]);

// Worker Skills - junction table for worker-to-skill relationships
export const workerSkills = pgTable("worker_skills", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  skillId: integer("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  level: text("level", { enum: skillLevels }), // null for skills without lite/elite
  yearsExperience: integer("years_experience"),
  certified: boolean("certified").default(false),
  certificationExpiry: timestamp("certification_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_worker_skill_unique").on(table.workerId, table.skillId),
  index("idx_worker_skills_worker").on(table.workerId),
  index("idx_worker_skills_skill").on(table.skillId),
]);

// Affiliate types: url = share links only; sales = links + dashboard, leads, create accounts
export const affiliateTypes = ["url", "sales"] as const;

export const affiliates = pgTable("affiliates", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: affiliateTypes }).notNull().default("url"),
  code: text("code").notNull().unique(), // unique slug for links, e.g. "jane-doe" -> ?ref=jane-doe
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  experienceBlurb: text("experience_blurb"), // Job-application style blurb about their experience
  address: text("address"),
  onboardingComplete: boolean("onboarding_complete").default(false),
  onboardingStep: integer("onboarding_step").default(1),
  agreementSigned: boolean("agreement_signed").default(false),
  agreementSignedAt: timestamp("agreement_signed_at"),
  salesTrackerEnabled: boolean("sales_tracker_enabled").default(false),
  // Mercury payout for affiliate commissions (same system as worker payouts)
  mercuryRecipientId: text("mercury_recipient_id"),
  mercuryExternalAccountId: text("mercury_external_account_id"),
  w9UploadedAt: timestamp("w9_uploaded_at"), // W-9 attached to Mercury recipient for tax purposes
  shareLinkReminderSentAt: timestamp("share_link_reminder_sent_at"),
  bankW9ReminderSentAt: timestamp("bank_w9_reminder_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_affiliates_user_id").on(table.userId),
  index("idx_affiliates_code").on(table.code),
]);

export const affiliateLeadStages = ["lead", "contacted", "closed_won", "closed_lost"] as const;
export const affiliateLeadAccountTypes = ["worker", "company"] as const;

// Lead activity list item (stored in activityList JSONB)
export type AffiliateLeadActivityItem = { body: string; createdAt: string };

export const affiliateLeads = pgTable("affiliate_leads", {
  id: serial("id").primaryKey(),
  affiliateId: integer("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  businessName: text("business_name"),
  accountType: text("account_type", { enum: affiliateLeadAccountTypes }).notNull(),
  stage: text("stage", { enum: affiliateLeadStages }).notNull().default("lead"),
  token: text("token").notNull().unique(),
  activityList: jsonb("activity_list").$type<AffiliateLeadActivityItem[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_affiliate_leads_affiliate_id").on(table.affiliateId),
  index("idx_affiliate_leads_token").on(table.token),
  index("idx_affiliate_leads_stage").on(table.stage),
]);

// Platform config (single row): editable platform fee per hour and affiliate commission %
export const platformConfig = pgTable("platform_config", {
  id: serial("id").primaryKey(),
  platformFeePerHourCents: integer("platform_fee_per_hour_cents").notNull().default(1300), // $13/hr default
  affiliateCommissionPercent: integer("affiliate_commission_percent").notNull().default(20), // 20% of platform fee
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Affiliate commissions: 20% of platform fee per approved timesheet, paid via Mercury
export const affiliateCommissionStatuses = ["pending", "paid"] as const;
export const affiliateCommissions = pgTable("affiliate_commissions", {
  id: serial("id").primaryKey(),
  affiliateId: integer("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
  timesheetId: integer("timesheet_id").notNull().references(() => timesheets.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  status: text("status", { enum: affiliateCommissionStatuses }).notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_affiliate_commissions_affiliate").on(table.affiliateId),
  index("idx_affiliate_commissions_timesheet").on(table.timesheetId),
  index("idx_affiliate_commissions_status").on(table.status),
]);

// Profiles table extends the base User
export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role", { enum: userRoles }).notNull(),
  
  // Personal info
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  
  // Location - with geolocation support
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  
  // Worker specific fields
  trades: text("trades").array(),
  serviceCategories: text("service_categories").array(),
  hourlyRate: integer("hourly_rate"), // In cents
  experienceYears: integer("experience_years"),
  portfolioImages: text("portfolio_images").array(),
  
  // Face verification
  faceVerified: boolean("face_verified").default(false),
  faceVerifiedAt: timestamp("face_verified_at"),
  
  // Identity verification (Stripe Identity)
  stripeIdentityVerificationId: text("stripe_identity_verification_id"),
  identityVerified: boolean("identity_verified").default(false),
  identityVerifiedAt: timestamp("identity_verified_at"),
  
  // Payment info (tokenized references only - no sensitive data)
  dwollaCustomerId: text("dwolla_customer_id"),
  plaidAccessToken: text("plaid_access_token"),
  stripeAccountId: text("stripe_account_id"),
  stripeCustomerId: text("stripe_customer_id"), // Stripe Customer ID for reusing saved payment methods
  bankAccountLinked: boolean("bank_account_linked").default(false),
  
  // Unit payment platform fields (deprecated - migrated to Mercury)
  unitCustomerId: text("unit_customer_id"),
  unitAccountId: text("unit_account_id"),
  unitCounterpartyId: text("unit_counterparty_id"),
  unitBankRoutingNumber: text("unit_bank_routing_number"),
  unitBankAccountNumber: text("unit_bank_account_number"),
  unitBankAccountType: text("unit_bank_account_type"),
  
  // Mercury Bank payment platform fields
  mercuryRecipientId: text("mercury_recipient_id"), // Mercury recipient ID for ACH payments
  mercuryExternalAccountId: text("mercury_external_account_id"), // Mercury external account ID (bank account)
  mercuryBankVerified: boolean("mercury_bank_verified").default(false), // Whether bank account is verified
  mercuryArCustomerId: text("mercury_ar_customer_id"), // Mercury AR (Accounts Receivable) customer ID for company invoicing
  instantPayoutEnabled: boolean("instant_payout_enabled").default(false), // Whether worker has instant payouts enabled (1% + $0.30 fee)
  
  // Contract/Signature
  contractSigned: boolean("contract_signed").default(false),
  contractSignedAt: timestamp("contract_signed_at"),
  signatureData: text("signature_data"),
  
  // Insurance - Worker documents
  insuranceDocumentUrl: text("insurance_document_url"),
  insurancePolicyNumber: text("insurance_policy_number"),
  insuranceIssuer: text("insurance_issuer"),
  insuranceStartDate: timestamp("insurance_start_date"),
  insuranceEndDate: timestamp("insurance_end_date"),
  insuranceCoverageType: text("insurance_coverage_type"), // e.g., "General Liability", "Commercial General Liability"
  insuranceCoverageAmount: integer("insurance_coverage_amount"), // In cents, coverage limit
  insuranceVerified: boolean("insurance_verified").default(false),
  
  // W-9 Document
  w9DocumentUrl: text("w9_document_url"),
  w9UploadedAt: timestamp("w9_uploaded_at"),
  
  // Team/Affiliate
  teamId: integer("team_id"),
  referredBy: integer("referred_by"),
  affiliateCode: text("affiliate_code"),
  referredByAffiliateId: integer("referred_by_affiliate_id").references(() => affiliates.id), // FK to affiliates when signup via affiliate link
  
  // Company specific fields
  companyName: text("company_name"),
  companyLogo: text("company_logo"), // URL to logo in object storage
  companyWebsite: text("company_website"),
  alternateEmails: text("alternate_emails").array(), // Additional contact emails
  alternatePhones: text("alternate_phones").array(), // Additional contact phones
  hiringIndustries: text("hiring_industries").array(), // Industry IDs from INDUSTRY_CATEGORIES (e.g. construction, plumbing)
  depositAmount: integer("deposit_amount").default(0), // In cents
  autoReplenishThreshold: integer("auto_replenish_threshold").default(200000), // In cents, default $2,000
  
  // Notification preferences
  emailNotifications: boolean("email_notifications").default(true),
  smsNotifications: boolean("sms_notifications").default(true),
  pushNotifications: boolean("push_notifications").default(true),
  notifyNewJobs: boolean("notify_new_jobs").default(true),
  notifyJobUpdates: boolean("notify_job_updates").default(true),
  notifyPayments: boolean("notify_payments").default(true),
  notifyMessages: boolean("notify_messages").default(true),
  
  // Status and reputation
  isVerified: boolean("is_verified").default(false),
  reputationScore: integer("reputation_score").default(0),
  averageRating: decimal("average_rating", { precision: 3, scale: 2 }),
  totalReviews: integer("total_reviews").default(0),
  completedJobs: integer("completed_jobs").default(0),
  onboardingStatus: text("onboarding_status", { enum: onboardingStatuses }).default("incomplete"),
  onboardingStep: integer("onboarding_step").default(1),
  onboardingReminder1SentAt: timestamp("onboarding_reminder_1_sent_at"),
  onboardingReminder2SentAt: timestamp("onboarding_reminder_2_sent_at"),
  onboardingReminder3SentAt: timestamp("onboarding_reminder_3_sent_at"),
  companyOnboardingReminderSentAt: timestamp("company_onboarding_reminder_sent_at"),
  isAvailable: boolean("is_available").default(true),
  strikeCount: integer("strike_count").default(0),
  
  // Calendar integration - JSON string of imported calendar settings
  importedCalendars: text("imported_calendars"),
  
  // Language preference - auto-detected from device on first visit, can be manually changed
  language: text("language"), // Language code: 'en', 'es', 'zh', 'pt', 'fr'
  
  // Google My Business OAuth tokens (for syncing reviews)
  googleBusinessAccessToken: text("google_business_access_token"),
  googleBusinessRefreshToken: text("google_business_refresh_token"),
  googleBusinessTokenExpiresAt: timestamp("google_business_token_expires_at"),
  googleBusinessLocationId: text("google_business_location_id"), // The location ID from My Business API
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_profiles_user_id").on(table.userId),
  index("idx_profiles_role").on(table.role),
  index("idx_profiles_location").on(table.latitude, table.longitude),
  index("idx_profiles_available_workers").on(table.role, table.isAvailable),
  index("idx_profiles_referred_by_affiliate").on(table.referredByAffiliateId),
]);

// Jobs table with enhanced location and scheduling
export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => profiles.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  
  // Location - full address with geolocation
  location: text("location").notNull(),
  locationName: text("location_name"), // User-friendly location name for display
  companyLocationId: integer("company_location_id"), // FK to companyLocations for linking to saved locations
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  /** Cached static map image URL (Google Static Maps). Generated once on job create and reused for cards, popup, and email to avoid API usage charges. */
  mapThumbnailUrl: text("map_thumbnail_url"),
  
  // Media attachments
  images: text("images").array(), // Array of image URLs
  videos: text("videos").array(), // Array of video URLs
  
  // Job requirements
  trade: text("trade", { enum: trades }).notNull(),
  serviceCategory: text("service_category"),
  skillLevel: text("skill_level", { enum: ["lite", "elite", "any"] }).default("any"),
  requiredSkills: text("required_skills").array(),
  
  // Pay and workers
  hourlyRate: integer("hourly_rate").notNull(), // In cents
  maxWorkersNeeded: integer("max_workers_needed").default(1),
  workersHired: integer("workers_hired").default(0),
  
  // Status and timing
  status: text("status", { enum: jobStatuses }).default("open").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  scheduledTime: text("scheduled_time"),
  estimatedHours: integer("estimated_hours"),
  timezone: text("timezone"), // IANA timezone for job location (e.g., "America/New_York")
  
  // Job type for auto clock-in rules
  isOnDemand: boolean("is_on_demand").default(false), // On-demand jobs allow flexible clock-in
  jobType: text("job_type", { enum: ["one_time", "recurring", "on_demand"] }).default("one_time"),
  
  // Recurring schedule fields
  scheduleDays: text("schedule_days").array(), // Days of week: ["monday", "tuesday", ...]
  endTime: text("end_time"), // Daily end time for recurring jobs (e.g., "17:00")
  recurringWeeks: integer("recurring_weeks").default(1), // Number of weeks for recurring jobs
  
  // Payment tracking
  totalPaid: integer("total_paid").default(0), // In cents
  budgetCents: integer("budget_cents"), // Optional project budget in cents
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_jobs_company").on(table.companyId),
  index("idx_jobs_status").on(table.status),
  index("idx_jobs_location").on(table.latitude, table.longitude),
  index("idx_jobs_trade").on(table.trade),
  index("idx_jobs_start_date").on(table.startDate),
  index("idx_jobs_open").on(table.status).where(sql`status = 'open'`),
]);

// Job Skills - required skills for a job
export const jobSkills = pgTable("job_skills", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  skillId: integer("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  levelRequired: text("level_required", { enum: skillLevels }),
  isRequired: boolean("is_required").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_job_skill_unique").on(table.jobId, table.skillId),
  index("idx_job_skills_job").on(table.jobId),
]);

// Applications with enhanced tracking
export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  workerId: integer("worker_id").notNull().references(() => profiles.id),
  teamMemberId: integer("team_member_id").references(() => workerTeamMembers.id), // Optional: if applying on behalf of team member
  status: text("status", { enum: applicationStatuses }).default("pending").notNull(),
  message: text("message"),
  proposedRate: integer("proposed_rate"), // Worker can propose different rate
  responseDeadline: timestamp("response_deadline"),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_application_unique").on(table.jobId, table.workerId),
  index("idx_applications_job").on(table.jobId),
  index("idx_applications_worker").on(table.workerId),
  index("idx_applications_status").on(table.status),
  index("idx_applications_team_member").on(table.teamMemberId),
]);

// Job Assignments - for tracking workers assigned to jobs
export const jobAssignments = pgTable("job_assignments", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  workerId: integer("worker_id").notNull().references(() => profiles.id),
  applicationId: integer("application_id").references(() => applications.id),
  agreedRate: integer("agreed_rate").notNull(), // In cents
  hoursWorked: decimal("hours_worked", { precision: 5, scale: 2 }).default("0"),
  totalEarned: integer("total_earned").default(0), // In cents
  status: text("status", { enum: ["assigned", "in_progress", "completed", "cancelled"] }).default("assigned"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_assignment_unique").on(table.jobId, table.workerId),
  index("idx_assignments_job").on(table.jobId),
  index("idx_assignments_worker").on(table.workerId),
]);

// Direct Job Inquiries - when companies send direct job requests to workers
export const directJobInquiryStatuses = ["pending", "accepted", "declined", "expired", "converted"] as const;
export type DirectJobInquiryStatus = typeof directJobInquiryStatuses[number];

export const directJobInquiries = pgTable("direct_job_inquiries", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => profiles.id),
  workerId: integer("worker_id").notNull().references(() => profiles.id),
  
  // Job details (stored until worker accepts, then converted to job)
  title: text("title").notNull(),
  description: text("description").notNull(),
  location: text("location").notNull(),
  locationName: text("location_name"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  
  // Job requirements
  requiredSkills: text("required_skills").array(),
  hourlyRate: integer("hourly_rate").notNull(), // In cents (worker's rate)
  
  // Schedule
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  scheduledTime: text("scheduled_time"),
  estimatedHours: integer("estimated_hours"),
  jobType: text("job_type", { enum: ["one_time", "recurring", "on_demand"] }).default("on_demand"),
  
  // Media
  images: text("images").array(),
  videos: text("videos").array(),
  
  // Budget
  budgetCents: integer("budget_cents"),
  maxWorkersNeeded: integer("max_workers_needed").default(1),
  
  // Status tracking
  status: text("status", { enum: directJobInquiryStatuses }).default("pending").notNull(),
  fallbackToPublic: boolean("fallback_to_public").default(true),
  expiresAt: timestamp("expires_at"), // 24 hours from creation
  
  // Conversion tracking
  convertedJobId: integer("converted_job_id").references(() => jobs.id),
  
  // Worker response
  workerMessage: text("worker_message"),
  respondedAt: timestamp("responded_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_direct_inquiries_company").on(table.companyId),
  index("idx_direct_inquiries_worker").on(table.workerId),
  index("idx_direct_inquiries_status").on(table.status),
  index("idx_direct_inquiries_expires").on(table.expiresAt),
]);

// Reviews with enhanced scoring
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => jobs.id), // Nullable for Google reviews that aren't tied to a specific job
  reviewerId: integer("reviewer_id").references(() => profiles.id), // Nullable for Google reviews (anonymous reviewers)
  revieweeId: integer("reviewee_id").notNull().references(() => profiles.id),
  rating: integer("rating").notNull(), // 1-5 overall average
  qualityRating: integer("quality_rating"), // 1-5 (value/quality)
  punctualityRating: integer("punctuality_rating"), // 1-5 (timeliness)
  communicationRating: integer("communication_rating"), // 1-5
  effortRating: integer("effort_rating"), // 1-5
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
  // Google Business Reviews fields
  isGoogleReview: boolean("is_google_review").default(false),
  googleReviewId: text("google_review_id"), // Google's review ID
  googleReviewerName: text("google_reviewer_name"), // Reviewer name from Google
  googleReviewerPhotoUrl: text("google_reviewer_photo_url"), // Reviewer photo from Google
  googleReviewDate: timestamp("google_review_date"), // Original review date from Google
  syncedAt: timestamp("synced_at"), // When this review was synced from Google
}, (table) => [
  uniqueIndex("idx_review_unique").on(table.jobId, table.reviewerId, table.revieweeId),
  uniqueIndex("idx_google_review_unique").on(table.googleReviewId, table.revieweeId),
  index("idx_reviews_reviewee").on(table.revieweeId),
  index("idx_reviews_google").on(table.isGoogleReview),
]);

// Payout Accounts - for tracking payment method connections
export const payoutAccounts = pgTable("payout_accounts", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: payoutProviders }).notNull(),
  externalAccountId: text("external_account_id").notNull(), // Tokenized reference
  accountType: text("account_type"), // "checking", "savings", etc.
  accountLastFour: text("account_last_four"), // Last 4 digits for display
  bankName: text("bank_name"),
  status: text("status", { enum: payoutStatuses }).default("pending"),
  isDefault: boolean("is_default").default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_payout_accounts_profile").on(table.profileId),
  uniqueIndex("idx_payout_account_provider").on(table.profileId, table.provider, table.externalAccountId),
]);

// Digital Signatures - for legal document tracking
export const digitalSignatures = pgTable("digital_signatures", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(), // "contractor_agreement", "nda", etc.
  documentVersion: text("document_version").notNull(),
  signatureData: text("signature_data").notNull(),
  signedName: text("signed_name").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  signedAt: timestamp("signed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_signatures_profile").on(table.profileId),
  index("idx_signatures_document").on(table.documentType),
]);

// Teams table for worker teams (Business Operator feature)
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: integer("owner_id").notNull().references(() => profiles.id),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Worker Team Member Roles
export const workerTeamRoles = ["admin", "employee"] as const;
export type WorkerTeamRole = typeof workerTeamRoles[number];

// Worker Team Members - team members under a business operator
export const workerTeamMembers = pgTable("worker_team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  role: text("role", { enum: workerTeamRoles }).default("employee").notNull(),
  hourlyRate: integer("hourly_rate"), // Rate in whole dollars
  skillsets: text("skillsets").array(), // Array of skill IDs/names
  status: text("status", { enum: ["active", "inactive", "pending"] }).default("pending").notNull(),
  inviteToken: text("invite_token"),
  invitedAt: timestamp("invited_at"),
  acceptedAt: timestamp("accepted_at"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_worker_team_members_team").on(table.teamId),
  index("idx_worker_team_members_email").on(table.email),
  index("idx_worker_team_members_invite_token").on(table.inviteToken),
]);

// Company Locations - for companies with multiple project sites
export const companyLocations = pgTable("company_locations", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "Main Office", "Downtown Project"
  address: text("address").notNull(),
  address2: text("address_2"), // Unit, Suite, Apt, etc.
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  isStarred: boolean("is_starred").default(false), // Favorited for quick selection
  isPrimary: boolean("is_primary").default(false),
  // Contact representative fields
  contactName: text("contact_name"), // Custom name for the representative
  contactPhone: text("contact_phone"), // Primary contact phone for this location
  contactEmail: text("contact_email"), // Contact email for this location
  contactAltPhone: text("contact_alt_phone"), // Alternative contact phone
  representativeTeamMemberId: integer("representative_team_member_id"), // FK to companyTeamMembers if selected from team (legacy single selection)
  assignedTeamMemberIds: integer("assigned_team_member_ids").array(), // Array of team member IDs assigned to this location for access control
  useCompanyDefault: boolean("use_company_default").default(true), // If true, use company's phone/admin as default
  paymentMethodId: integer("payment_method_id"), // FK to companyPaymentMethods for auto-charging timesheets at this location
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_company_locations_profile").on(table.profileId),
]);

// Team Invites - for inviting coworkers to manage company account
export const teamInvites = pgTable("team_invites", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  role: text("role", { enum: ["admin", "manager", "viewer"] }).default("manager"),
  status: text("status", { enum: ["pending", "accepted", "declined", "expired"] }).default("pending"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  locationIds: text("location_ids").array(), // Array of location IDs this member can access
  invitedAt: timestamp("invited_at").defaultNow(),
  acceptedAt: timestamp("accepted_at"),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("idx_team_invites_profile").on(table.profileId),
  index("idx_team_invites_email").on(table.email),
  uniqueIndex("idx_team_invites_token").on(table.token),
]);

// Company Team Members - users who can access company dashboard
export const companyTeamMembers = pgTable("company_team_members", {
  id: serial("id").primaryKey(),
  companyProfileId: integer("company_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  role: text("role", { enum: ["owner", "admin", "manager", "viewer"] }).notNull().default("manager"),
  passwordHash: text("password_hash"),
  inviteId: integer("invite_id").references(() => teamInvites.id),
  locationIds: text("location_ids").array(), // Array of location IDs this member can access
  isActive: boolean("is_active").default(true),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_company_team_members_company").on(table.companyProfileId),
  index("idx_company_team_members_user").on(table.userId),
  uniqueIndex("idx_company_team_member_unique").on(table.companyProfileId, table.userId),
]);

// Worker Not Interested Jobs - track jobs workers have dismissed
export const workerDismissedJobs = pgTable("worker_dismissed_jobs", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  reason: text("reason"), // Optional reason for dismissal
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_dismissed_job_unique").on(table.workerId, table.jobId),
  index("idx_dismissed_jobs_worker").on(table.workerId),
  index("idx_dismissed_jobs_job").on(table.jobId),
]);

// Job Schedules - for multiple shift times on a job
export const jobSchedules = pgTable("job_schedules", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  startTime: text("start_time").notNull(), // e.g., "08:00"
  endTime: text("end_time").notNull(), // e.g., "17:00"
  workersNeeded: integer("workers_needed").default(1),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_job_schedules_job").on(table.jobId),
]);

// Company Balance Transactions - for tracking deposit and usage
export const companyTransactions = pgTable("company_transactions", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["deposit", "charge", "refund", "auto_recharge"] }).notNull(),
  amount: integer("amount").notNull(), // In cents (base amount added to balance)
  cardFee: integer("card_fee"), // Card processing fee in cents (3.5% for card payments)
  description: text("description"),
  jobId: integer("job_id").references(() => jobs.id),
  workerId: integer("worker_id").references(() => profiles.id),
  hoursWorked: decimal("hours_worked", { precision: 5, scale: 2 }),
  paymentMethod: text("payment_method", { enum: ["ach", "card"] }), // Payment method used
  initiatedById: integer("initiated_by_id").references(() => profiles.id), // Who initiated the payment
  stripePaymentIntentId: text("stripe_payment_intent_id"), // For card payments
  stripePaymentStatus: text("stripe_payment_status"), // Stripe payment status
  mercuryPaymentId: text("mercury_payment_id"), // Mercury payment/transaction ID
  mercuryPaymentStatus: text("mercury_payment_status"), // Mercury payment status (pending, sent, completed, failed)
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_company_transactions_profile").on(table.profileId),
  index("idx_company_transactions_job").on(table.jobId),
]);

// Company Payment Methods - ACH and Cards (Mercury Bank + Stripe)
export const companyPaymentMethods = pgTable("company_payment_methods", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["ach", "card"] }).notNull().default("ach"),
  lastFour: text("last_four").notNull(),
  bankName: text("bank_name"),
  cardBrand: text("card_brand"), // For card payments: visa, mastercard, amex, etc.
  stripePaymentMethodId: text("stripe_payment_method_id"), // Stripe payment method ID for saved cards
  mercuryRecipientId: text("mercury_recipient_id"), // Mercury recipient ID for this payment method
  mercuryExternalAccountId: text("mercury_external_account_id"), // Mercury external account ID for this payment method
  routingNumber: text("routing_number"),
  accountNumber: text("account_number"), // Last 4 of account number
  isPrimary: boolean("is_primary").default(false),
  isVerified: boolean("is_verified").default(false), // Mercury verification status
  locationIds: text("location_ids").array(), // Specific location IDs this payment method is assigned to (null/empty = uses primary for all)
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_company_payment_methods_profile").on(table.profileId),
]);

// Worker Payouts - for tracking payments to workers (Mercury Bank ACH)
export const workerPayouts = pgTable("worker_payouts", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  jobId: integer("job_id").references(() => jobs.id),
  timesheetId: integer("timesheet_id").references(() => timesheets.id),
  amount: integer("amount").notNull(), // In cents
  status: text("status", { enum: ["pending", "processing", "sent", "completed", "failed", "returned", "pending_bank_setup", "pending_w9"] }).notNull().default("pending"),
  mercuryPaymentId: text("mercury_payment_id"), // Mercury payment ID for worker payout
  mercuryPaymentStatus: text("mercury_payment_status"), // Mercury payment status (pending, sent, completed, failed)
  description: text("description"),
  hoursWorked: decimal("hours_worked", { precision: 5, scale: 2 }),
  hourlyRate: integer("hourly_rate"), // In cents
  isInstantPayout: boolean("is_instant_payout").default(false), // Whether this was an instant payout
  instantPayoutFee: integer("instant_payout_fee"), // Fee charged for instant payout (1% + $0.30) in cents
  originalAmount: integer("original_amount"), // Original payout amount before fee deduction (in cents)
  processedAt: timestamp("processed_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_worker_payouts_worker").on(table.workerId),
  index("idx_worker_payouts_job").on(table.jobId),
  index("idx_worker_payouts_status").on(table.status),
]);

// Timesheet Edits - for tracking edits with explanations
export const timesheetEdits = pgTable("timesheet_edits", {
  id: serial("id").primaryKey(),
  timesheetId: integer("timesheet_id").notNull().references(() => timesheets.id, { onDelete: "cascade" }),
  editedBy: integer("edited_by").notNull().references(() => profiles.id),
  originalHours: decimal("original_hours", { precision: 5, scale: 2 }).notNull(),
  newHours: decimal("new_hours", { precision: 5, scale: 2 }).notNull(),
  explanation: text("explanation").notNull(), // Min 30 chars
  emailSent: boolean("email_sent").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_timesheet_edits_timesheet").on(table.timesheetId),
]);

// Timesheet Reports/Strikes
export const timesheetReports = pgTable("timesheet_reports", {
  id: serial("id").primaryKey(),
  timesheetId: integer("timesheet_id").notNull().references(() => timesheets.id, { onDelete: "cascade" }),
  reportedBy: integer("reported_by").notNull().references(() => profiles.id),
  workerId: integer("worker_id").notNull().references(() => profiles.id),
  explanation: text("explanation").notNull(), // Min 30 chars
  isStrike: boolean("is_strike").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_timesheet_reports_timesheet").on(table.timesheetId),
  index("idx_timesheet_reports_worker").on(table.workerId),
]);

// Company Agreements - stores signed agreements during onboarding
export const companyAgreements = pgTable("company_agreements", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  agreementType: text("agreement_type", { enum: ["hiring_agreement", "terms_of_service", "privacy_policy", "payment_terms"] }).notNull(),
  version: text("version").notNull(),
  signedName: text("signed_name"),
  signatureData: text("signature_data"),
  agreementText: text("agreement_text"), // full agreement content as signed (for display in company menu)
  ipAddress: text("ip_address"),
  signedAt: timestamp("signed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_company_agreements_profile").on(table.profileId),
]);

// Timesheets - for tracking clock in/out
export const timesheets = pgTable("timesheets", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  
  // Clock in/out times
  clockInTime: timestamp("clock_in_time").notNull(),
  clockOutTime: timestamp("clock_out_time"),
  
  // Location tracking
  clockInLatitude: decimal("clock_in_latitude", { precision: 10, scale: 7 }),
  clockInLongitude: decimal("clock_in_longitude", { precision: 10, scale: 7 }),
  clockOutLatitude: decimal("clock_out_latitude", { precision: 10, scale: 7 }),
  clockOutLongitude: decimal("clock_out_longitude", { precision: 10, scale: 7 }),
  
  // Hours and pay
  totalHours: decimal("total_hours", { precision: 5, scale: 2 }),
  adjustedHours: decimal("adjusted_hours", { precision: 5, scale: 2 }), // After location adjustments
  hourlyRate: integer("hourly_rate").notNull(), // In cents
  totalPay: integer("total_pay"), // In cents
  
  // Location verification
  clockInDistanceFromJob: integer("clock_in_distance_from_job"), // In meters
  clockOutDistanceFromJob: integer("clock_out_distance_from_job"), // In meters
  locationVerified: boolean("location_verified").default(true),
  locationAdjustmentReason: text("location_adjustment_reason"),
  
  // Approval status
  status: text("status", { enum: ["pending", "approved", "rejected", "disputed"] }).default("pending"),
  approvedBy: integer("approved_by").references(() => profiles.id),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  submittedAt: timestamp("submitted_at"), // When worker submitted for review (for 48hr auto-approve)
  autoApprovedAt: timestamp("auto_approved_at"), // Set when auto-approved after 48hrs
  
  // Notes
  workerNotes: text("worker_notes"),
  companyNotes: text("company_notes"),
  
  // Payment tracking
  paymentStatus: text("payment_status", { enum: ["pending", "processing", "completed", "failed"] }).default("pending"),
  paymentId: text("payment_id"), // Unit payment ID
  paidAt: timestamp("paid_at"),
  
  // Auto clock in/out tracking
  autoClockedIn: boolean("auto_clocked_in").default(false),
  autoClockedOut: boolean("auto_clocked_out").default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_timesheets_job").on(table.jobId),
  index("idx_timesheets_worker").on(table.workerId),
  index("idx_timesheets_company").on(table.companyId),
  index("idx_timesheets_status").on(table.status),
  index("idx_timesheets_payment_status").on(table.paymentStatus),
]);

// Location Pings - tracking worker location for geofencing
export const locationPings = pgTable("location_pings", {
  id: serial("id").primaryKey(),
  workerProfileId: integer("worker_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  accuracy: decimal("accuracy", { precision: 10, scale: 2 }), // In meters
  source: text("source", { enum: ["browser", "ios", "android", "background"] }).default("browser"),
  distanceFromJob: integer("distance_from_job"), // In meters
  withinGeofence: boolean("within_geofence").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_location_pings_worker").on(table.workerProfileId),
  index("idx_location_pings_job").on(table.jobId),
  index("idx_location_pings_created").on(table.createdAt),
]);

// Timesheet Events - audit trail for clock in/out actions
export const timesheetEvents = pgTable("timesheet_events", {
  id: serial("id").primaryKey(),
  timesheetId: integer("timesheet_id").notNull().references(() => timesheets.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["clock_in", "clock_out", "auto_clock_in", "auto_clock_out", "manual_clock_in", "manual_clock_out"] }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  distanceFromJob: integer("distance_from_job"), // In meters
  metadata: jsonb("metadata"), // Additional event data
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_timesheet_events_timesheet").on(table.timesheetId),
  index("idx_timesheet_events_type").on(table.eventType),
]);

// Saved Team Members - contractors saved by company (per location)
export const savedTeamMembers = pgTable("saved_team_members", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  companyLocationId: integer("company_location_id").references(() => companyLocations.id, { onDelete: "cascade" }), // Which location's team (null = legacy company-wide)
  addedFromJobId: integer("added_from_job_id").references(() => jobs.id),
  nickname: text("nickname"), // Optional custom name for this contractor
  notes: text("notes"),
  rating: integer("rating"), // Company's private rating 1-5
  isFavorite: boolean("is_favorite").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Partial uniques are in migration 024: one per (company, worker) when location is null; one per (company, worker, location) when location set
  index("idx_saved_team_company").on(table.companyId),
  index("idx_saved_team_location").on(table.companyLocationId),
]);

// Referrals - for tracking referral bonuses
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull().references(() => profiles.id),
  referredId: integer("referred_id").notNull().references(() => profiles.id),
  referralCode: text("referral_code").notNull(),
  status: text("status", { enum: ["pending", "qualified", "paid"] }).default("pending"),
  bonusAmount: integer("bonus_amount").default(10000), // $100 in cents
  qualifiedAt: timestamp("qualified_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_referral_unique").on(table.referrerId, table.referredId),
  index("idx_referrals_referrer").on(table.referrerId),
]);

// === RELATIONS ===
export const skillsRelations = relations(skills, ({ many }) => ({
  workerSkills: many(workerSkills),
  jobSkills: many(jobSkills),
}));

export const workerSkillsRelations = relations(workerSkills, ({ one }) => ({
  worker: one(profiles, {
    fields: [workerSkills.workerId],
    references: [profiles.id],
  }),
  skill: one(skills, {
    fields: [workerSkills.skillId],
    references: [skills.id],
  }),
}));

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  user: one(users, {
    fields: [profiles.userId],
    references: [users.id],
  }),
  postedJobs: many(jobs, { relationName: "companyJobs" }),
  applications: many(applications),
  assignments: many(jobAssignments),
  reviewsReceived: many(reviews, { relationName: "receivedReviews" }),
  reviewsGiven: many(reviews, { relationName: "givenReviews" }),
  team: one(teams, {
    fields: [profiles.teamId],
    references: [teams.id],
  }),
  referrer: one(profiles, {
    fields: [profiles.referredBy],
    references: [profiles.id],
  }),
  referredByAffiliate: one(affiliates, {
    fields: [profiles.referredByAffiliateId],
    references: [affiliates.id],
  }),
  workerSkills: many(workerSkills),
  payoutAccounts: many(payoutAccounts),
  digitalSignatures: many(digitalSignatures),
  referralsMade: many(referrals, { relationName: "referrer" }),
  referralReceived: one(referrals, {
    fields: [profiles.id],
    references: [referrals.referredId],
    relationName: "referred",
  }),
}));

export const affiliatesRelations = relations(affiliates, ({ one, many }) => ({
  user: one(users, {
    fields: [affiliates.userId],
    references: [users.id],
  }),
  leads: many(affiliateLeads),
  commissions: many(affiliateCommissions),
}));

export const affiliateLeadsRelations = relations(affiliateLeads, ({ one }) => ({
  affiliate: one(affiliates, {
    fields: [affiliateLeads.affiliateId],
    references: [affiliates.id],
  }),
}));

export const affiliateCommissionsRelations = relations(affiliateCommissions, ({ one }) => ({
  affiliate: one(affiliates, {
    fields: [affiliateCommissions.affiliateId],
    references: [affiliates.id],
  }),
  timesheet: one(timesheets, {
    fields: [affiliateCommissions.timesheetId],
    references: [timesheets.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  company: one(profiles, {
    fields: [jobs.companyId],
    references: [profiles.id],
    relationName: "companyJobs",
  }),
  applications: many(applications),
  assignments: many(jobAssignments),
  requiredJobSkills: many(jobSkills),
}));

export const jobSkillsRelations = relations(jobSkills, ({ one }) => ({
  job: one(jobs, {
    fields: [jobSkills.jobId],
    references: [jobs.id],
  }),
  skill: one(skills, {
    fields: [jobSkills.skillId],
    references: [skills.id],
  }),
}));

export const applicationsRelations = relations(applications, ({ one }) => ({
  job: one(jobs, {
    fields: [applications.jobId],
    references: [jobs.id],
  }),
  worker: one(profiles, {
    fields: [applications.workerId],
    references: [profiles.id],
  }),
}));

export const jobAssignmentsRelations = relations(jobAssignments, ({ one }) => ({
  job: one(jobs, {
    fields: [jobAssignments.jobId],
    references: [jobs.id],
  }),
  worker: one(profiles, {
    fields: [jobAssignments.workerId],
    references: [profiles.id],
  }),
  application: one(applications, {
    fields: [jobAssignments.applicationId],
    references: [applications.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  job: one(jobs, {
    fields: [reviews.jobId],
    references: [jobs.id],
  }),
  reviewer: one(profiles, {
    fields: [reviews.reviewerId],
    references: [profiles.id],
    relationName: "givenReviews",
  }),
  reviewee: one(profiles, {
    fields: [reviews.revieweeId],
    references: [profiles.id],
    relationName: "receivedReviews",
  }),
}));

export const payoutAccountsRelations = relations(payoutAccounts, ({ one }) => ({
  profile: one(profiles, {
    fields: [payoutAccounts.profileId],
    references: [profiles.id],
  }),
}));

export const digitalSignaturesRelations = relations(digitalSignatures, ({ one }) => ({
  profile: one(profiles, {
    fields: [digitalSignatures.profileId],
    references: [profiles.id],
  }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  owner: one(profiles, {
    fields: [teams.ownerId],
    references: [profiles.id],
  }),
  members: many(workerTeamMembers),
}));

export const workerTeamMembersRelations = relations(workerTeamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [workerTeamMembers.teamId],
    references: [teams.id],
  }),
}));

export const referralsRelations = relations(referrals, ({ one }) => ({
  referrer: one(profiles, {
    fields: [referrals.referrerId],
    references: [profiles.id],
    relationName: "referrer",
  }),
  referred: one(profiles, {
    fields: [referrals.referredId],
    references: [profiles.id],
    relationName: "referred",
  }),
}));

export const timesheetsRelations = relations(timesheets, ({ one }) => ({
  job: one(jobs, {
    fields: [timesheets.jobId],
    references: [jobs.id],
  }),
  worker: one(profiles, {
    fields: [timesheets.workerId],
    references: [profiles.id],
    relationName: "workerTimesheets",
  }),
  company: one(profiles, {
    fields: [timesheets.companyId],
    references: [profiles.id],
    relationName: "companyTimesheets",
  }),
  approver: one(profiles, {
    fields: [timesheets.approvedBy],
    references: [profiles.id],
  }),
}));

export const savedTeamMembersRelations = relations(savedTeamMembers, ({ one }) => ({
  company: one(profiles, {
    fields: [savedTeamMembers.companyId],
    references: [profiles.id],
    relationName: "savedTeam",
  }),
  worker: one(profiles, {
    fields: [savedTeamMembers.workerId],
    references: [profiles.id],
    relationName: "savedByCompanies",
  }),
  addedFromJob: one(jobs, {
    fields: [savedTeamMembers.addedFromJobId],
    references: [jobs.id],
  }),
}));

// === ZOD SCHEMAS ===
export const insertSkillSchema = createInsertSchema(skills).omit({ 
  id: true, 
  createdAt: true,
});

export const insertWorkerSkillSchema = createInsertSchema(workerSkills).omit({ 
  id: true, 
  createdAt: true,
});

export const insertProfileSchema = createInsertSchema(profiles).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
  reputationScore: true,
  isVerified: true,
  strikeCount: true,
  averageRating: true,
  totalReviews: true,
  completedJobs: true,
});

export const insertAffiliateSchema = createInsertSchema(affiliates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAffiliateLeadSchema = createInsertSchema(affiliateLeads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  activityList: true,
});

export const insertPlatformConfigSchema = createInsertSchema(platformConfig).omit({
  updatedAt: true,
});

export const insertAffiliateCommissionSchema = createInsertSchema(affiliateCommissions).omit({
  id: true,
  createdAt: true,
});

export const insertJobSchema = createInsertSchema(jobs, {
  // Coerce date strings to Date objects for API requests
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
}).omit({ 
  id: true, 
  createdAt: true,
  status: true,
  workersHired: true,
  totalPaid: true,
});

export const insertJobSkillSchema = createInsertSchema(jobSkills).omit({ 
  id: true, 
  createdAt: true,
});

export const insertApplicationSchema = createInsertSchema(applications).omit({ 
  id: true, 
  createdAt: true, 
  status: true,
  respondedAt: true,
});

export const insertJobAssignmentSchema = createInsertSchema(jobAssignments).omit({ 
  id: true, 
  createdAt: true,
  hoursWorked: true,
  totalEarned: true,
});

export const insertDirectJobInquirySchema = createInsertSchema(directJobInquiries, {
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
}).omit({ 
  id: true, 
  createdAt: true,
  status: true,
  respondedAt: true,
  convertedJobId: true,
});

export const insertReviewSchema = createInsertSchema(reviews).omit({ 
  id: true, 
  createdAt: true 
});

export const insertPayoutAccountSchema = createInsertSchema(payoutAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
});

export const insertDigitalSignatureSchema = createInsertSchema(digitalSignatures).omit({
  id: true,
  createdAt: true,
  signedAt: true,
});

export const insertTeamSchema = createInsertSchema(teams).omit({
  id: true,
  createdAt: true,
});

export const insertWorkerTeamMemberSchema = createInsertSchema(workerTeamMembers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReferralSchema = createInsertSchema(referrals).omit({
  id: true,
  createdAt: true,
  qualifiedAt: true,
  paidAt: true,
});

export const insertCompanyLocationSchema = createInsertSchema(companyLocations).omit({
  id: true,
  createdAt: true,
});

export const insertTeamInviteSchema = createInsertSchema(teamInvites).omit({
  id: true,
  invitedAt: true,
  acceptedAt: true,
});

export const insertCompanyTeamMemberSchema = createInsertSchema(companyTeamMembers).omit({
  id: true,
  createdAt: true,
  lastLoginAt: true,
});

export const insertJobScheduleSchema = createInsertSchema(jobSchedules).omit({
  id: true,
  createdAt: true,
});

export const insertWorkerDismissedJobSchema = createInsertSchema(workerDismissedJobs).omit({
  id: true,
  createdAt: true,
});

export const insertCompanyTransactionSchema = createInsertSchema(companyTransactions).omit({
  id: true,
  createdAt: true,
});

export const insertTimesheetSchema = createInsertSchema(timesheets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
});

export const insertSavedTeamMemberSchema = createInsertSchema(savedTeamMembers).omit({
  id: true,
  createdAt: true,
});

export const insertCompanyPaymentMethodSchema = createInsertSchema(companyPaymentMethods).omit({
  id: true,
  createdAt: true,
});

export const insertWorkerPayoutSchema = createInsertSchema(workerPayouts).omit({
  id: true,
  createdAt: true,
  processedAt: true,
  completedAt: true,
});

export const insertTimesheetEditSchema = createInsertSchema(timesheetEdits).omit({
  id: true,
  createdAt: true,
});

export const insertTimesheetReportSchema = createInsertSchema(timesheetReports).omit({
  id: true,
  createdAt: true,
});

export const insertLocationPingSchema = createInsertSchema(locationPings).omit({
  id: true,
  createdAt: true,
});

export const insertTimesheetEventSchema = createInsertSchema(timesheetEvents).omit({
  id: true,
  createdAt: true,
});

export const insertCompanyAgreementSchema = createInsertSchema(companyAgreements).omit({
  id: true,
  createdAt: true,
  signedAt: true,
});

// === PUSH NOTIFICATIONS ===

// Notification types for workers and companies
export const notificationTypes = [
  // Worker notifications
  "new_job_in_territory",
  "job_offer_received",
  "application_approved",
  "application_rejected",
  "timesheet_edited",
  "timesheet_reported",
  "strike_issued",
  "payment_received",
  "account_terminated",
  "job_start_reminder", // 15 minutes before job start
  // Company notifications
  "worker_inquiry",
  "worker_availability_updated",
  "balance_topped_up",
  "worker_clocked_in",
  "worker_clocked_out",
  "marketing_post_job",
  "call_invite", // Video call invite – action opens the call URL
] as const;

// Device tokens for push notifications
export const deviceTokens = pgTable("device_tokens", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  deviceName: text("device_name"), // User-friendly device name
  deviceType: text("device_type"), // "web", "android", "ios"
  userAgent: text("user_agent"),
  lastUsed: timestamp("last_used").defaultNow(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_device_tokens_profile").on(table.profileId),
  uniqueIndex("idx_device_tokens_token").on(table.token),
]);

// Notifications log
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  type: text("type", { enum: notificationTypes }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url"), // Deep link URL in the app
  data: jsonb("data"), // Additional payload data
  isRead: boolean("is_read").default(false),
  isPushSent: boolean("is_push_sent").default(false),
  pushSentAt: timestamp("push_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_notifications_profile").on(table.profileId),
  index("idx_notifications_unread").on(table.profileId, table.isRead),
  index("idx_notifications_type").on(table.type),
]);

// Device token relations
export const deviceTokensRelations = relations(deviceTokens, ({ one }) => ({
  profile: one(profiles, {
    fields: [deviceTokens.profileId],
    references: [profiles.id],
  }),
}));

// Notification relations
export const notificationsRelations = relations(notifications, ({ one }) => ({
  profile: one(profiles, {
    fields: [notifications.profileId],
    references: [profiles.id],
  }),
}));

// Job Reminders - tracks sent 15-min pre-start notifications to prevent duplicates
export const jobReminders = pgTable("job_reminders", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  teamMemberId: integer("team_member_id").references(() => workerTeamMembers.id, { onDelete: "cascade" }),
  jobDate: timestamp("job_date").notNull(), // The job start date/time this reminder is for
  reminderType: text("reminder_type", { enum: ["15_min_before", "1_hour_before", "1_day_before"] }).notNull().default("15_min_before"),
  emailSent: boolean("email_sent").default(false),
  emailSentAt: timestamp("email_sent_at"),
  pushSent: boolean("push_sent").default(false),
  pushSentAt: timestamp("push_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_job_reminders_job").on(table.jobId),
  index("idx_job_reminders_worker").on(table.workerId),
  index("idx_job_reminders_date").on(table.jobDate),
  uniqueIndex("idx_job_reminders_unique").on(table.jobId, table.workerId, table.jobDate, table.reminderType),
]);

export const jobRemindersRelations = relations(jobReminders, ({ one }) => ({
  job: one(jobs, {
    fields: [jobReminders.jobId],
    references: [jobs.id],
  }),
  worker: one(profiles, {
    fields: [jobReminders.workerId],
    references: [profiles.id],
  }),
  teamMember: one(workerTeamMembers, {
    fields: [jobReminders.teamMemberId],
    references: [workerTeamMembers.id],
  }),
}));

// === JOB CHAT MESSAGES ===

// Messages between workers and companies for accepted jobs
export const jobMessages = pgTable("job_messages", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  messageType: text("message_type", { enum: ["text", "clock_in", "clock_out", "timesheet_summary"] }).default("text"),
  timesheetId: integer("timesheet_id").references(() => timesheets.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  visibleToCompanyOnly: boolean("visible_to_company_only").default(false),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_job_messages_job").on(table.jobId),
  index("idx_job_messages_sender").on(table.senderId),
  index("idx_job_messages_created").on(table.createdAt),
]);

export const jobMessagesRelations = relations(jobMessages, ({ one }) => ({
  job: one(jobs, {
    fields: [jobMessages.jobId],
    references: [jobs.id],
  }),
  sender: one(profiles, {
    fields: [jobMessages.senderId],
    references: [profiles.id],
  }),
  timesheet: one(timesheets, {
    fields: [jobMessages.timesheetId],
    references: [timesheets.id],
  }),
}));

export type JobMessage = typeof jobMessages.$inferSelect;
export type InsertJobMessage = typeof jobMessages.$inferInsert;

// Log of when we sent "new_job_message" email to a recipient (at most 1 per day per recipient, any job)
export const jobMessageEmailLog = pgTable("job_message_email_log", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  recipientProfileId: integer("recipient_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (table) => [
  index("idx_job_message_email_log_lookup").on(table.jobId, table.recipientProfileId, table.sentAt),
]);

export type JobMessageEmailLog = typeof jobMessageEmailLog.$inferSelect;
export type InsertJobMessageEmailLog = typeof jobMessageEmailLog.$inferInsert;

// Log of chat digest emails (at most 2 per day per recipient: morning + evening)
export const chatDigestLog = pgTable("chat_digest_log", {
  id: serial("id").primaryKey(),
  recipientProfileId: integer("recipient_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (table) => [
  index("idx_chat_digest_log_recipient").on(table.recipientProfileId),
  index("idx_chat_digest_log_sent").on(table.sentAt),
]);

// Pending 1hr digest: when a message is sent, we insert here. Scheduler processes 1hr later.
export const chatMessagePendingDigest = pgTable("chat_message_pending_digest", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => jobMessages.id, { onDelete: "cascade" }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_chat_pending_digest_created").on(table.createdAt),
]);

// Log of 1hr digest emails sent (one per message per recipient) - prevents duplicate sends
export const chatMessageDigestSent = pgTable("chat_message_digest_sent", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => jobMessages.id, { onDelete: "cascade" }),
  recipientProfileId: integer("recipient_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (table) => [
  index("idx_chat_digest_sent_message").on(table.messageId),
  index("idx_chat_digest_sent_lookup").on(table.messageId, table.recipientProfileId),
]);

// Log when we sent "close project / review" email for a job (budget met) – one per job
export const jobBudgetReviewEmailSent = pgTable("job_budget_review_email_sent", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_job_budget_review_sent_job").on(table.jobId),
]);

export type JobBudgetReviewEmailSent = typeof jobBudgetReviewEmailSent.$inferSelect;
export type InsertJobBudgetReviewEmailSent = typeof jobBudgetReviewEmailSent.$inferInsert;

// === ADMIN TABLES ===

// Admin email allowlist constant
export const ADMIN_EMAIL = "cairlbrandon@gmail.com";

// Admin strikes - individual strike records for workers
export const adminStrikes = pgTable("admin_strikes", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  severity: text("severity", { enum: ["warning", "minor", "major", "critical"] }).default("minor"),
  notes: text("notes"),
  issuedBy: text("issued_by").notNull(), // Admin email
  isActive: boolean("is_active").default(true),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  resolvedNotes: text("resolved_notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_admin_strikes_worker").on(table.workerId),
  index("idx_admin_strikes_active").on(table.workerId, table.isActive),
]);

// Job suspensions - admin actions on jobs
export const jobSuspensions = pgTable("job_suspensions", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  action: text("action", { enum: ["suspended", "cancelled", "flagged", "reinstated"] }).notNull(),
  reason: text("reason").notNull(),
  issuedBy: text("issued_by").notNull(), // Admin email
  effectiveUntil: timestamp("effective_until"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_job_suspensions_job").on(table.jobId),
  index("idx_job_suspensions_active").on(table.jobId, table.isActive),
]);

// Billing actions - admin billing adjustments
export const billingActions = pgTable("billing_actions", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type", { enum: ["company", "worker"] }).notNull(),
  entityId: integer("entity_id").notNull(),
  actionType: text("action_type", { enum: ["credit", "debit", "refund", "adjustment", "waive"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  performedBy: text("performed_by").notNull(), // Admin email
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_billing_actions_entity").on(table.entityType, table.entityId),
]);

// Admin activity log - audit trail for all admin actions
export const adminActivityLog = pgTable("admin_activity_log", {
  id: serial("id").primaryKey(),
  adminEmail: text("admin_email").notNull(),
  action: text("action").notNull(), // e.g., "issue_strike", "suspend_job", "billing_adjustment"
  entityType: text("entity_type").notNull(), // "worker", "company", "job"
  entityId: integer("entity_id"),
  details: jsonb("details"), // Additional action details
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_admin_activity_admin").on(table.adminEmail),
  index("idx_admin_activity_entity").on(table.entityType, table.entityId),
  index("idx_admin_activity_date").on(table.createdAt),
]);

// Worker status - for admin to suspend/ban workers
export const workerStatuses = pgTable("worker_statuses", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => profiles.id, { onDelete: "cascade" }).unique(),
  status: text("status", { enum: ["active", "suspended", "banned", "under_review"] }).default("active"),
  reason: text("reason"),
  suspendedUntil: timestamp("suspended_until"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_worker_statuses_worker").on(table.workerId),
  index("idx_worker_statuses_status").on(table.status),
]);

// === INVOICES ===
export const invoiceStatuses = ["draft", "sent", "paid", "overdue", "cancelled", "void"] as const;

// Invoices - auto-generated for completed jobs/timesheets
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(), // e.g., INV-2026-00001
  
  // Parties
  companyId: integer("company_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }),
  
  // Dates
  issueDate: timestamp("issue_date").notNull().defaultNow(),
  dueDate: timestamp("due_date").notNull(),
  paidAt: timestamp("paid_at"),
  
  // Amounts (in cents)
  subtotal: integer("subtotal").notNull(), // Sum of line items
  platformFee: integer("platform_fee").default(0), // Tolstoy fee if any
  taxAmount: integer("tax_amount").default(0),
  totalAmount: integer("total_amount").notNull(),
  amountPaid: integer("amount_paid").default(0),
  
  // Status
  status: text("status", { enum: invoiceStatuses }).default("draft"),
  
  // Payment info
  paymentMethod: text("payment_method"), // e.g., "unit_ach", "stripe"
  paymentReference: text("payment_reference"), // Unit payment ID or Stripe charge ID
  
  // Notes
  notes: text("notes"),
  termsAndConditions: text("terms_and_conditions"),
  
  // Metadata
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_invoices_company").on(table.companyId),
  index("idx_invoices_worker").on(table.workerId),
  index("idx_invoices_job").on(table.jobId),
  index("idx_invoices_status").on(table.status),
  index("idx_invoices_number").on(table.invoiceNumber),
]);

// Invoice line items - individual entries on an invoice
export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  timesheetId: integer("timesheet_id").references(() => timesheets.id, { onDelete: "set null" }),
  
  // Description
  description: text("description").notNull(),
  
  // Quantity and rate
  quantity: decimal("quantity", { precision: 8, scale: 2 }).notNull(), // Hours worked
  unitPrice: integer("unit_price").notNull(), // Hourly rate in cents
  amount: integer("amount").notNull(), // quantity * unitPrice in cents
  
  // Work dates
  workDate: timestamp("work_date"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_invoice_items_invoice").on(table.invoiceId),
  index("idx_invoice_items_timesheet").on(table.timesheetId),
]);

// Invoice relations
export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  company: one(profiles, {
    fields: [invoices.companyId],
    references: [profiles.id],
    relationName: "invoiceCompany",
  }),
  worker: one(profiles, {
    fields: [invoices.workerId],
    references: [profiles.id],
    relationName: "invoiceWorker",
  }),
  job: one(jobs, {
    fields: [invoices.jobId],
    references: [jobs.id],
  }),
  items: many(invoiceItems),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
  timesheet: one(timesheets, {
    fields: [invoiceItems.timesheetId],
    references: [timesheets.id],
  }),
}));

// Company status - for admin to suspend/ban companies
export const companyStatuses = pgTable("company_statuses", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => profiles.id, { onDelete: "cascade" }).unique(),
  status: text("status", { enum: ["active", "suspended", "banned", "under_review"] }).default("active"),
  reason: text("reason"),
  suspendedUntil: timestamp("suspended_until"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_company_statuses_company").on(table.companyId),
  index("idx_company_statuses_status").on(table.status),
]);

// Admin strike relations
export const adminStrikesRelations = relations(adminStrikes, ({ one }) => ({
  worker: one(profiles, {
    fields: [adminStrikes.workerId],
    references: [profiles.id],
  }),
}));

// Job suspension relations
export const jobSuspensionsRelations = relations(jobSuspensions, ({ one }) => ({
  job: one(jobs, {
    fields: [jobSuspensions.jobId],
    references: [jobs.id],
  }),
}));

// Worker status relations
export const workerStatusesRelations = relations(workerStatuses, ({ one }) => ({
  worker: one(profiles, {
    fields: [workerStatuses.workerId],
    references: [profiles.id],
  }),
}));

// Company status relations
export const companyStatusesRelations = relations(companyStatuses, ({ one }) => ({
  company: one(profiles, {
    fields: [companyStatuses.companyId],
    references: [profiles.id],
  }),
}));

// Insert schemas for admin tables
export const insertAdminStrikeSchema = createInsertSchema(adminStrikes).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});

export const insertJobSuspensionSchema = createInsertSchema(jobSuspensions).omit({
  id: true,
  createdAt: true,
});

export const insertBillingActionSchema = createInsertSchema(billingActions).omit({
  id: true,
  createdAt: true,
});

export const insertAdminActivityLogSchema = createInsertSchema(adminActivityLog).omit({
  id: true,
  createdAt: true,
});

export const insertWorkerStatusSchema = createInsertSchema(workerStatuses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompanyStatusSchema = createInsertSchema(companyStatuses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({
  id: true,
  createdAt: true,
});

export const insertDeviceTokenSchema = createInsertSchema(deviceTokens).omit({
  id: true,
  createdAt: true,
  lastUsed: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  isRead: true,
  isPushSent: true,
  pushSentAt: true,
});

export const insertJobReminderSchema = createInsertSchema(jobReminders).omit({
  id: true,
  createdAt: true,
  emailSentAt: true,
  pushSentAt: true,
});

// === TYPES ===
export type Skill = typeof skills.$inferSelect;
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type WorkerSkill = typeof workerSkills.$inferSelect;
export type InsertWorkerSkill = z.infer<typeof insertWorkerSkillSchema>;
export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type JobSkill = typeof jobSkills.$inferSelect;
export type InsertJobSkill = z.infer<typeof insertJobSkillSchema>;
export type Application = typeof applications.$inferSelect;
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type JobAssignment = typeof jobAssignments.$inferSelect;
export type InsertJobAssignment = z.infer<typeof insertJobAssignmentSchema>;
export type Review = typeof reviews.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type PayoutAccount = typeof payoutAccounts.$inferSelect;
export type InsertPayoutAccount = z.infer<typeof insertPayoutAccountSchema>;
export type DigitalSignature = typeof digitalSignatures.$inferSelect;
export type InsertDigitalSignature = z.infer<typeof insertDigitalSignatureSchema>;
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type WorkerTeamMember = typeof workerTeamMembers.$inferSelect;
export type InsertWorkerTeamMember = z.infer<typeof insertWorkerTeamMemberSchema>;
export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type CompanyLocation = typeof companyLocations.$inferSelect;
export type InsertCompanyLocation = z.infer<typeof insertCompanyLocationSchema>;
export type TeamInvite = typeof teamInvites.$inferSelect;
export type InsertTeamInvite = z.infer<typeof insertTeamInviteSchema>;
export type CompanyTeamMember = typeof companyTeamMembers.$inferSelect;
export type InsertCompanyTeamMember = z.infer<typeof insertCompanyTeamMemberSchema>;
export type JobSchedule = typeof jobSchedules.$inferSelect;
export type InsertJobSchedule = z.infer<typeof insertJobScheduleSchema>;
export type CompanyTransaction = typeof companyTransactions.$inferSelect;
export type InsertCompanyTransaction = z.infer<typeof insertCompanyTransactionSchema>;
export type Timesheet = typeof timesheets.$inferSelect;
export type InsertTimesheet = z.infer<typeof insertTimesheetSchema>;
export type SavedTeamMember = typeof savedTeamMembers.$inferSelect;
export type InsertSavedTeamMember = z.infer<typeof insertSavedTeamMemberSchema>;
export type CompanyPaymentMethod = typeof companyPaymentMethods.$inferSelect;
export type InsertCompanyPaymentMethod = z.infer<typeof insertCompanyPaymentMethodSchema>;
export type WorkerPayout = typeof workerPayouts.$inferSelect;
export type InsertWorkerPayout = z.infer<typeof insertWorkerPayoutSchema>;
export type TimesheetEdit = typeof timesheetEdits.$inferSelect;
export type InsertTimesheetEdit = z.infer<typeof insertTimesheetEditSchema>;
export type TimesheetReport = typeof timesheetReports.$inferSelect;
export type InsertTimesheetReport = z.infer<typeof insertTimesheetReportSchema>;
export type LocationPing = typeof locationPings.$inferSelect;
export type InsertLocationPing = z.infer<typeof insertLocationPingSchema>;
export type TimesheetEvent = typeof timesheetEvents.$inferSelect;
export type InsertTimesheetEvent = z.infer<typeof insertTimesheetEventSchema>;
export type CompanyAgreement = typeof companyAgreements.$inferSelect;
export type InsertCompanyAgreement = z.infer<typeof insertCompanyAgreementSchema>;
export type DeviceToken = typeof deviceTokens.$inferSelect;
export type InsertDeviceToken = z.infer<typeof insertDeviceTokenSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type AdminStrike = typeof adminStrikes.$inferSelect;
export type InsertAdminStrike = z.infer<typeof insertAdminStrikeSchema>;
export type JobSuspension = typeof jobSuspensions.$inferSelect;
export type InsertJobSuspension = z.infer<typeof insertJobSuspensionSchema>;
export type BillingAction = typeof billingActions.$inferSelect;
export type InsertBillingAction = z.infer<typeof insertBillingActionSchema>;
export type AdminActivityLog = typeof adminActivityLog.$inferSelect;
export type InsertAdminActivityLog = z.infer<typeof insertAdminActivityLogSchema>;
export type WorkerStatus = typeof workerStatuses.$inferSelect;
export type InsertWorkerStatus = z.infer<typeof insertWorkerStatusSchema>;
export type CompanyStatus = typeof companyStatuses.$inferSelect;
export type InsertCompanyStatus = z.infer<typeof insertCompanyStatusSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type WorkerDismissedJob = typeof workerDismissedJobs.$inferSelect;
export type InsertWorkerDismissedJob = z.infer<typeof insertWorkerDismissedJobSchema>;
export type JobReminder = typeof jobReminders.$inferSelect;
export type InsertJobReminder = z.infer<typeof insertJobReminderSchema>;
export type DirectJobInquiry = typeof directJobInquiries.$inferSelect;
export type InsertDirectJobInquiry = z.infer<typeof insertDirectJobInquirySchema>;
export type Affiliate = typeof affiliates.$inferSelect;
export type InsertAffiliate = z.infer<typeof insertAffiliateSchema>;
export type AffiliateLead = typeof affiliateLeads.$inferSelect;
export type InsertAffiliateLead = z.infer<typeof insertAffiliateLeadSchema>;
export type PlatformConfig = typeof platformConfig.$inferSelect;
export type InsertPlatformConfig = z.infer<typeof insertPlatformConfigSchema>;
export type AffiliateCommission = typeof affiliateCommissions.$inferSelect;
export type InsertAffiliateCommission = z.infer<typeof insertAffiliateCommissionSchema>;