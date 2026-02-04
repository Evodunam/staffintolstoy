import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../db";
import { eq } from "drizzle-orm";

// Interface for auth storage operations
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  setPasswordResetToken(email: string, token: string, expiresAt: Date): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  clearPasswordResetToken(email: string): Promise<void>;
  setOtpCode(email: string, code: string, expiresAt: Date): Promise<void>;
  getUserByOtpCode(code: string): Promise<User | undefined>;
  clearOtpCode(email: string): Promise<void>;
  setMagicLinkToken(email: string, token: string, expiresAt: Date): Promise<void>;
  getUserByMagicLinkToken(token: string): Promise<User | undefined>;
  clearMagicLinkToken(email: string): Promise<void>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async createUser(userData: UpsertUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async setPasswordResetToken(email: string, token: string, expiresAt: Date): Promise<void> {
    await db
      .update(users)
      .set({
        passwordResetToken: token,
        passwordResetExpires: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email.toLowerCase()));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.passwordResetToken, token));
    return user;
  }

  async clearPasswordResetToken(email: string): Promise<void> {
    await db
      .update(users)
      .set({
        passwordResetToken: null,
        passwordResetExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email.toLowerCase()));
  }

  async setOtpCode(email: string, code: string, expiresAt: Date): Promise<void> {
    await db
      .update(users)
      .set({
        otpCode: code,
        otpExpires: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email.toLowerCase()));
  }

  async getUserByOtpCode(code: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.otpCode, code));
    return user;
  }

  async clearOtpCode(email: string): Promise<void> {
    await db
      .update(users)
      .set({
        otpCode: null,
        otpExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email.toLowerCase()));
  }

  async setMagicLinkToken(email: string, token: string, expiresAt: Date): Promise<void> {
    await db
      .update(users)
      .set({
        magicLinkToken: token,
        magicLinkExpires: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email.toLowerCase()));
  }

  async getUserByMagicLinkToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.magicLinkToken, token));
    return user;
  }

  async clearMagicLinkToken(email: string): Promise<void> {
    await db
      .update(users)
      .set({
        magicLinkToken: null,
        magicLinkExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email.toLowerCase()));
  }
}

export const authStorage = new AuthStorage();
