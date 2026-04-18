import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

// Session storage table.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  passwordHash: varchar("password_hash"), // For custom email/password registration
  authProvider: varchar("auth_provider").default("google"), // "google" or "email"
  userType: varchar("user_type").default("worker"), // "worker" or "company" - identifies account type
  passwordResetToken: varchar("password_reset_token"), // Token for password reset
  passwordResetExpires: timestamp("password_reset_expires"), // Expiration for reset token
  otpCode: varchar("otp_code"), // OTP code for email login
  otpExpires: timestamp("otp_expires"), // Expiration for OTP code
  magicLinkToken: varchar("magic_link_token"), // Token for magic link login
  magicLinkExpires: timestamp("magic_link_expires"), // Expiration for magic link
  // CCPA §1798.105 / GDPR Art. 17 — soft-delete fields. deletionRequestedAt set
  // when the user invokes their right to delete; deletionScheduledFor is the
  // hard-delete cutoff (default = +30 days, allows account recovery + dispute
  // resolution per CCPA §1798.105(d) exemptions).
  deletionRequestedAt: timestamp("deletion_requested_at"),
  deletionScheduledFor: timestamp("deletion_scheduled_for"),
  // MFA (TOTP / RFC 6238). mfaSecret is the base32-encoded shared secret stored
  // server-side; the user holds the matching seed in their authenticator app.
  // mfaBackupCodes is JSON array of bcrypt-hashed one-time recovery codes.
  // Required for company admins; optional for workers.
  mfaEnabled: varchar("mfa_enabled").default("false"),
  mfaSecret: varchar("mfa_secret"),
  mfaBackupCodes: jsonb("mfa_backup_codes"),
  mfaLastUsedAt: timestamp("mfa_last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect & {
  // Derived flag exposed on the API instead of leaking passwordHash.
  // Optional so server-side internal usage of the raw row type is unaffected.
  hasPassword?: boolean;
  impersonation?: {
    isImpersonating: boolean;
    isEmployee: boolean;
    originalUserId?: string;
    teamMemberId?: number;
    teamMember?: {
      id: number;
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
      role: string;
      teamId: number;
    };
  };
};
