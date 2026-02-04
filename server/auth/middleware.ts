import type { RequestHandler } from "express";
import { storage } from "../storage";

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user?.claims?.sub) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // No time-based expiry: user stays logged in until they log out or clear cookies.

  return next();
};

/** Session key for cached profile (avoids DB hit on every request). */
const PROFILE_SNAPSHOT_KEY = "profileSnapshot";

/**
 * Attach current user's profile to req.profile. Uses session cache when valid
 * so subsequent requests skip the profile DB lookup (instant resume).
 * Run after passport.session(); only runs for authenticated requests.
 */
export const attachProfile: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) return next();
  const user = req.user as any;
  const userId = user?.claims?.sub;
  if (!userId) return next();

  const session = req.session as any;
  const cached = session?.[PROFILE_SNAPSHOT_KEY];
  if (cached && cached.userId === userId) {
    req.profile = cached as any;
    return next();
  }

  try {
    const profile = await storage.getProfileByUserId(userId);
    req.profile = profile;
    if (profile) {
      session[PROFILE_SNAPSHOT_KEY] = profile;
    }
  } catch (err) {
    // Don't fail the request; route may not need profile
  }
  return next();
};

/** Clear session profile cache (call after profile update or account switch). */
export function clearProfileSnapshot(req: { session?: any }): void {
  const session = req.session as any;
  if (session && typeof session[PROFILE_SNAPSHOT_KEY] !== "undefined") {
    delete session[PROFILE_SNAPSHOT_KEY];
  }
}
