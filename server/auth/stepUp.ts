/**
 * Step-up re-authentication for sensitive actions.
 *
 * When a user wants to perform a high-risk action (change bank account, change
 * payment method, withdraw funds, change admin emails, change password, disable
 * MFA), we require a fresh password/OTP confirmation EVEN IF they're already
 * logged in. The step-up grant is short-lived (5 minutes) and scoped to a
 * specific reason so it can't be replayed for a different action.
 *
 * Usage:
 *   import { requireStepUp, grantStepUp, STEP_UP_REASONS } from "./stepUp";
 *
 *   // On the protected endpoint:
 *   app.post("/api/payment-methods/delete", requireStepUp(STEP_UP_REASONS.PAYMENT_METHOD), handler);
 *
 *   // Frontend flow: hit the endpoint → 401 with code STEP_UP_REQUIRED → user
 *   //   re-enters password at /api/auth/step-up → grantStepUp() → retry endpoint.
 */
import type { Request, Response, NextFunction } from "express";

export const STEP_UP_REASONS = {
  PAYMENT_METHOD: "payment_method",
  BANK_ACCOUNT: "bank_account",
  WITHDRAW_FUNDS: "withdraw_funds",
  ADMIN_EMAIL_CHANGE: "admin_email_change",
  PASSWORD_CHANGE: "password_change",
  MFA_DISABLE: "mfa_disable",
  ACCOUNT_DELETE: "account_delete",
} as const;

export type StepUpReason = typeof STEP_UP_REASONS[keyof typeof STEP_UP_REASONS];

const STEP_UP_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface StepUpGrant {
  reason: StepUpReason;
  expiresAt: number;
}

declare module "express-session" {
  interface SessionData {
    stepUp?: StepUpGrant;
  }
}

export function grantStepUp(req: Request, reason: StepUpReason): void {
  if (!req.session) return;
  req.session.stepUp = {
    reason,
    expiresAt: Date.now() + STEP_UP_TTL_MS,
  };
}

export function consumeStepUp(req: Request): void {
  if (req.session?.stepUp) delete req.session.stepUp;
}

export function hasValidStepUp(req: Request, expectedReason: StepUpReason): boolean {
  const grant = req.session?.stepUp;
  if (!grant) return false;
  if (grant.reason !== expectedReason) return false;
  if (Date.now() > grant.expiresAt) return false;
  return true;
}

export function requireStepUp(reason: StepUpReason) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated?.()) {
      return res.status(401).json({ message: "Unauthorized", code: "UNAUTHENTICATED" });
    }
    if (!hasValidStepUp(req, reason)) {
      return res.status(401).json({
        message: "This action requires re-entering your password.",
        code: "STEP_UP_REQUIRED",
        stepUpReason: reason,
        stepUpEndpoint: "/api/auth/step-up",
      });
    }
    // Step-up is single-use: consume on success so an attacker who steals a session
    // mid-grant can't replay multiple sensitive actions.
    consumeStepUp(req);
    next();
  };
}
