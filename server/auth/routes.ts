import type { Express } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { authStorage } from "./storage";
import { isAuthenticated, clearProfileSnapshot } from "./middleware";
import { SESSION_TTL_SECONDS } from "./session";
import { storage } from "../storage";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";

// Configure Google OAuth Strategy
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/api/auth/google/callback`,
        passReqToCallback: true, // Allow access to req in callback
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) {
            return done(new Error("No email provided by Google"), undefined);
          }

          // Check if user exists
          const [existingUser] = await db
            .select()
            .from(users)
            .where(eq(users.email, email));

          if (existingUser) {
            // Update user's profile image if available and not set
            if (profile.photos?.[0]?.value && !existingUser.profileImageUrl) {
              await db
                .update(users)
                .set({
                  profileImageUrl: profile.photos[0].value,
                  updatedAt: new Date(),
                })
                .where(eq(users.id, existingUser.id));
            }

            // User exists, log them in
            const userObj = {
              claims: {
                sub: existingUser.id,
                email: existingUser.email,
                first_name: existingUser.firstName || profile.name?.givenName || "",
                last_name: existingUser.lastName || profile.name?.familyName || "",
              },
              expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
            };
            return done(null, userObj);
          }

          // Determine userType from session if available (e.g., from onboarding)
          const onboardingDataString = (req.session as any)?.onboardingData;
          let userType: "worker" | "company" = "worker"; // Default
          if (onboardingDataString) {
            try {
              const onboardingData = JSON.parse(onboardingDataString);
              if (onboardingData.userType === "company") {
                userType = "company";
              }
            } catch (e) {
              console.error("Error parsing onboardingData from session:", e);
            }
          }

          // Create new user
          const newUser = await authStorage.createUser({
            email,
            firstName: profile.name?.givenName || "",
            lastName: profile.name?.familyName || "",
            profileImageUrl: profile.photos?.[0]?.value,
            authProvider: "google",
            userType: userType,
            passwordHash: null, // Google users don't have passwords
          });

          const userObj = {
            claims: {
              sub: newUser.id,
              email: newUser.email,
              first_name: newUser.firstName || "",
              last_name: newUser.lastName || "",
            },
            expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
          };

          return done(null, userObj);
        } catch (error: any) {
          console.error("Google OAuth error:", error);
          return done(error, undefined);
        }
      }
    )
  );
} else {
  console.warn("⚠️ Google OAuth environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not set. Google login will not be available.");
  console.warn("   To enable Google login, add these to your .env.development file:");
  console.warn("   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com");
  console.warn("   GOOGLE_CLIENT_SECRET=your-client-secret");
}

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Google OAuth routes
  app.get(
    "/api/auth/google",
    (req, res, next) => {
      // Store return URL and onboarding data in session
      const returnTo = req.query.returnTo as string | undefined;
      const onboardingData = req.query.onboardingData as string | undefined;
      
      if (returnTo) {
        (req.session as any).returnTo = returnTo;
      }
      if (onboardingData) {
        (req.session as any).onboardingData = onboardingData;
      }
      
      next();
    },
    (req, res, next) => {
      // Build redirect_uri from the request so it always matches the current origin (fixes redirect_uri_mismatch)
      const host = req.get("host") || "localhost:5000";
      const protocol = req.protocol || "http";
      const callbackURL = `${protocol}://${host}/api/auth/google/callback`;
      if (process.env.NODE_ENV !== "production") {
        console.log("[Google OAuth] redirect_uri (add this to Google Console):", callbackURL);
      }
      passport.authenticate("google", {
        scope: ["profile", "email"],
        callbackURL,
      })(req, res, next);
    }
  );

  app.get(
    "/api/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login?error=google_auth_failed" }),
    async (req, res) => {
      try {
        // Get return URL and onboarding data from session
        const returnTo = (req.session as any)?.returnTo || "/";
        const onboardingData = (req.session as any)?.onboardingData;
        
        // Clear session data and profile cache so next request loads fresh profile
        delete (req.session as any).returnTo;
        delete (req.session as any).onboardingData;
        clearProfileSnapshot(req);

        // If there's onboarding data, redirect back to onboarding with it
        if (onboardingData) {
          try {
            // Pass onboarding data in URL params
            const redirectUrl = `${returnTo}?googleAuth=true&onboardingData=${encodeURIComponent(onboardingData)}`;
            return res.redirect(redirectUrl);
          } catch (e) {
            console.error("Error handling onboarding data:", e);
          }
        }

        const user = req.user as any;
        if (!user || !user.claims?.sub) {
          console.error("Google OAuth callback: No user in session");
          return res.redirect("/login?error=google_auth_failed");
        }

        // Check if user has a profile
        const userId = user.claims.sub;
        const profile = await storage.getProfileByUserId(userId);
        
        // Check if returnTo is a team invite link
        if (returnTo && returnTo.includes("/team/join/")) {
          // Extract token from returnTo
          const tokenMatch = returnTo.match(/\/team\/join\/([^/?]+)/);
          if (tokenMatch) {
            const token = tokenMatch[1];
            // Check if user is already authenticated and has a profile
            if (profile) {
              // User already has profile, check if they're a team member
              const teamMember = await storage.getWorkerTeamMemberByInviteToken(token);
              if (teamMember && teamMember.email === profile.email) {
                // User matches the invite, redirect to team join page
                return res.redirect(returnTo);
              }
            }
            // User doesn't have profile yet or doesn't match, redirect to team join page
            // The team join page will handle creating the account
            return res.redirect(returnTo);
          }
        }
        
        if (profile) {
          // User has profile, redirect to appropriate dashboard
          if (profile.role === "company") {
            return res.redirect("/company-dashboard");
          } else if (profile.role === "worker") {
            // Redirect to today page for workers
            return res.redirect("/dashboard/today");
          }
        } else {
          // User doesn't have profile, redirect to onboarding
          // Determine onboarding type from returnTo, onboardingData, or default to worker
          let redirectToOnboarding = "/worker-onboarding?googleAuth=true";
          
          if (onboardingData) {
            try {
              const parsed = JSON.parse(onboardingData);
              if (parsed.userType === "company") {
                redirectToOnboarding = "/company-onboarding?googleAuth=true";
              } else {
                redirectToOnboarding = "/worker-onboarding?googleAuth=true";
              }
            } catch (e) {
              // If parsing fails, check returnTo
              if (returnTo.includes("company-onboarding")) {
                redirectToOnboarding = "/company-onboarding?googleAuth=true";
              } else if (returnTo.includes("worker-onboarding")) {
                redirectToOnboarding = "/worker-onboarding?googleAuth=true";
              }
            }
          } else if (returnTo.includes("company-onboarding")) {
            redirectToOnboarding = "/company-onboarding?googleAuth=true";
          } else if (returnTo.includes("worker-onboarding")) {
            redirectToOnboarding = "/worker-onboarding?googleAuth=true";
          }
          
          return res.redirect(redirectToOnboarding);
        }

        res.redirect(returnTo);
      } catch (error: any) {
        console.error("Google OAuth callback error:", error);
        console.error("Error stack:", error.stack);
        res.redirect("/login?error=google_auth_failed");
      }
    }
  );
  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      
      // Check if impersonating a team member
      const impersonatingTeamMemberId = (req.session as any)?.impersonatingTeamMemberId;
      const impersonatingAsEmployee = (req.session as any)?.impersonatingAsEmployee;
      const originalUserId = (req.session as any)?.originalUserId;
      
      if (impersonatingTeamMemberId && impersonatingAsEmployee) {
        // Get the team member data
        const teamMember = await storage.getWorkerTeamMember(impersonatingTeamMemberId);
        if (teamMember) {
          // Return user with impersonation overlay
          res.json({
            ...user,
            impersonation: {
              isImpersonating: true,
              isEmployee: true,
              originalUserId,
              teamMemberId: impersonatingTeamMemberId,
              teamMember: {
                id: teamMember.id,
                firstName: teamMember.firstName,
                lastName: teamMember.lastName,
                avatarUrl: teamMember.avatarUrl,
                role: teamMember.role,
                teamId: teamMember.teamId,
              }
            }
          });
          return;
        }
      }
      
      // Check if impersonating a regular user (not team member)
      const impersonatingUserId = (req.session as any)?.impersonatingUserId;
      if (originalUserId && impersonatingUserId) {
        res.json({
          ...user,
          impersonation: {
            isImpersonating: true,
            isEmployee: false,
            originalUserId,
          }
        });
        return;
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
