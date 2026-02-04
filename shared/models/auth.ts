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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect & {
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
