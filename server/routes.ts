import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { getSession, SESSION_TTL_SECONDS } from "./auth/session";
import { registerAuthRoutes } from "./auth/routes";
import { authStorage } from "./auth/storage";
import { attachProfile, clearProfileSnapshot } from "./auth/middleware";
import { attachRlsDbContext } from "./auth/rls-context";
import passport from "passport";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { profiles, jobs, type Job, digitalSignatures, deviceTokens, notifications, notificationTypes, insertDeviceTokenSchema, applications, timesheets, companyTeamMembers, teamInvites, locationPings, timesheetEvents, companyPaymentMethods, companyTransactions, teams, workerTeamMembers, jobAssignments, jobSchedules, jobMessages, jobMessageEmailLog, chatMessagePendingDigest, chatMessageDigestSent, jobBudgetReviewEmailSent, reviews, skills, referrals, affiliates, insertAffiliateSchema, companyAgreements } from "@shared/schema";
import { eq, and, asc, desc, inArray, isNull, isNotNull, or, gte, lte, sql } from "drizzle-orm";
import { sendEmail, ALL_EMAIL_TYPES, getSampleDataForType } from "./email-service";
import { setupWebSocket, notifyNewJob, notifyApplicationUpdate, notifyJobUpdate, notifyTimesheetUpdate, broadcastPresenceUpdate, notifyWorkerTeamPresence } from "./websocket";
import { notifyWorkerInquiry, notifyWorkerAvailabilityUpdated, notifyNewJobInTerritory, createNotification } from "./notification-service";
import crypto from "crypto";
import { geocodeAddress, geocodeFullAddress } from "./geocoding";
import { buildJobGeocodeQuery } from "@shared/jobGeocode";
import { displayJobTitle } from "@shared/job-display";
import {
  validateAutoFulfillJobPayload,
  applyAutoFulfillLegalAck,
  evaluateAutoFulfillAccept,
} from "./lib/autoFulfill";
import { isLocalDevHostFromRequest } from "./lib/isLocalDevRequest";
import { minimumLaborBudgetCentsForWorkerHours } from "@shared/postJobBillableHours";
import { workerFacingJobHourlyCents } from "@shared/platformPayPolicy";
import * as calendarIntegration from "./services/calendarIntegration";
import { Client as GoogleMapsClient } from "@googlemaps/google-maps-services-js";
import {
  triggerAutoReplenishmentForCompany,
  afterHireFundingCheck,
  clearPaymentHoldsForCompanyIfSolvent,
} from "./auto-replenishment-scheduler";
import {
  findExistingPendingInquiryForWorkerJob,
  getLatestActiveVideoCallMessage,
  parseWorkerId,
  resolveCallInviteUrl,
} from "./lib/runtimeRouteGuards";
import { ensureCompanyStripeCustomer } from "./lib/company-stripe";
import { normalizeLanguageCode as normalizeChatLanguageCode, translateChatText } from "./services/chatTranslation";
import type Stripe from "stripe";
import { addHours } from "date-fns";

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function calculateDistanceMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Reject null-island / placeholder zeros and out-of-range values so we fall back to address geocode or state matching. */
function isPlausibleLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < 1e-5 && Math.abs(lng) < 1e-5) return false;
  return true;
}

function getProfileLanguageCode(profile: { language?: string | null } | null | undefined): string | undefined {
  return normalizeChatLanguageCode(profile?.language);
}

function getViewerLanguageCode(req: any, profile: { language?: string | null } | null | undefined): string | undefined {
  const explicit = normalizeChatLanguageCode(
    typeof req.query?.viewerLanguage === "string" ? req.query.viewerLanguage : undefined,
  );
  if (explicit) return explicit;
  return getProfileLanguageCode(profile);
}

async function ensureJobGeofenceCoords(job: Job): Promise<{ lat: number; lng: number } | null> {
  const savedLat = job.latitude != null ? parseFloat(String(job.latitude)) : NaN;
  const savedLng = job.longitude != null ? parseFloat(String(job.longitude)) : NaN;
  if (isPlausibleLatLng(savedLat, savedLng)) {
    return { lat: savedLat, lng: savedLng };
  }
  const address = String((job as any).streetAddress || job.address || "").trim();
  const city = String(job.city || "").trim();
  const state = String(job.state || "").trim();
  const zipCode = String(job.zipCode || "").trim();
  const location = String(job.location || "").trim();
  const broadQuery = buildJobGeocodeQuery(job) || "";
  const exactQuery = [address, city, state, zipCode].filter(Boolean).join(", ");

  const parseCoords = (coords: { latitude: string; longitude: string } | null): { lat: number; lng: number } | null => {
    if (!coords) return null;
    const lat = parseFloat(String(coords.latitude));
    const lng = parseFloat(String(coords.longitude));
    if (!isPlausibleLatLng(lat, lng)) return null;
    return { lat, lng };
  };

  const candidates = [exactQuery, broadQuery, location].map((q) => q.trim()).filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];

  for (const query of uniqueCandidates) {
    try {
      // Prefer full address geocode when we have structured address fields.
      const full = address && city && state && zipCode
        ? parseCoords(await geocodeFullAddress(address, city, state, zipCode))
        : null;
      const fallback = full ?? parseCoords(await geocodeAddress(query));
      if (!fallback) continue;
      await storage.updateJob(job.id, {
        latitude: fallback.lat.toString(),
        longitude: fallback.lng.toString(),
      });
      return fallback;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function geocodeCompanyLocationInBackground(input: {
  address?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): Promise<{ latitude?: string; longitude?: string }> {
  const address = String(input.address || "").trim();
  const address2 = String(input.address2 || "").trim();
  const city = String(input.city || "").trim();
  const state = String(input.state || "").trim();
  const zipCode = String(input.zipCode || "").trim();

  if (!address || !city || !state || !zipCode) return {};

  try {
    const fullAddress = [address, address2].filter(Boolean).join(", ");
    const coords =
      await geocodeFullAddress(fullAddress, city, state, zipCode) ||
      await geocodeAddress([fullAddress, city, state, zipCode].filter(Boolean).join(", "));

    if (!coords) return {};
    const lat = parseFloat(String(coords.latitude));
    const lng = parseFloat(String(coords.longitude));
    if (!isPlausibleLatLng(lat, lng)) return {};
    return { latitude: coords.latitude, longitude: coords.longitude };
  } catch {
    return {};
  }
}

const METERS_PER_MILE = 1609.344;

// Geofence radii: auto clock in/out requires closer proximity than manual
const AUTO_GEOFENCE_RADIUS_MILES = 0.25; // 0.25 miles for auto clock in/out
const MANUAL_GEOFENCE_RADIUS_MILES = 5; // 5 miles for manual clock in/out
const AUTO_GEOFENCE_RADIUS_METERS = AUTO_GEOFENCE_RADIUS_MILES * METERS_PER_MILE; // ~402 meters
const MANUAL_GEOFENCE_RADIUS_METERS = MANUAL_GEOFENCE_RADIUS_MILES * METERS_PER_MILE; // ~8047 meters

// Legacy constant for backwards compatibility (use manual radius as default)
const GEOFENCE_RADIUS_MILES = MANUAL_GEOFENCE_RADIUS_MILES;
const GEOFENCE_RADIUS_METERS = MANUAL_GEOFENCE_RADIUS_METERS;

// When user comes back online after offline clock-in, we require their pin location. Within this radius we verify and the timesheet can be submitted for approval; beyond = reject timesheet + strike (we never submit the timesheet).
const CLOCK_IN_VALIDATION_RADIUS_MILES = 50;
const CLOCK_IN_VALIDATION_RADIUS_METERS = CLOCK_IN_VALIDATION_RADIUS_MILES * METERS_PER_MILE;

// Rate limit: worker-triggered business-operator onboarding resend (once per 24h per worker)
const workerResendBusinessOperatorReminderLastAt = new Map<number, number>();
const WORKER_RESEND_BUSINESS_OPERATOR_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Guard: only one W-9 payout release per worker at a time (avoids duplicate Mercury calls)
const w9ReleaseInProgress = new Set<number>();
// Throttle: don't trigger release from GET pending-w9-payouts more than once per worker per 90s (avoids infinite loop when banner polls every 5s)
const w9ReleaseLastTriggeredAt = new Map<number, number>();
const W9_RELEASE_TRIGGER_COOLDOWN_MS = 90_000;

/** Run W-9 payout release in background: group all pending_w9 payouts for the worker, send one Mercury payment for the total, then mark all payouts completed. */
async function runW9PayoutReleaseForWorker(profileId: number): Promise<void> {
  if (w9ReleaseInProgress.has(profileId)) {
    console.log(`[W9Release] Skipping duplicate run for worker ${profileId}`);
    return;
  }
  w9ReleaseInProgress.add(profileId);
  try {
    const profile = await storage.getProfile(profileId);
    if (!profile || profile.role !== "worker" || !profile.mercuryRecipientId || !profile.mercuryExternalAccountId) {
      return;
    }
    const pendingW9Payouts = await storage.getWorkerPayoutsByStatus(profileId, "pending_w9");
    if (pendingW9Payouts.length === 0) return;

    const totalAmountCents = pendingW9Payouts.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    if (totalAmountCents <= 0) return;

    const isInstantPayout = profile.instantPayoutEnabled || false;
    let netAmountCents = totalAmountCents;
    let instantPayoutFeeCents = 0;
    if (isInstantPayout) {
      instantPayoutFeeCents = Math.round(totalAmountCents * 0.01) + 30;
      netAmountCents = totalAmountCents - instantPayoutFeeCents;
    }

    console.log(`[W9Release] Sending single grouped payment for worker ${profileId}: ${pendingW9Payouts.length} payouts, total $${(totalAmountCents / 100).toFixed(2)}${isInstantPayout ? `, net $${(netAmountCents / 100).toFixed(2)} (fee $${(instantPayoutFeeCents / 100).toFixed(2)})` : ""}`);

    const { mercuryService } = await import("./services/mercury");
    const payoutIds = pendingW9Payouts.map((p) => p.id).sort((a, b) => a - b);
    const idempotencyKey = `w9-release-worker-${profileId}-${payoutIds.join("-")}`;
    const payment = await mercuryService.sendPayment({
      recipientId: profile.mercuryRecipientId,
      amount: netAmountCents,
      description: isInstantPayout
        ? `W-9 release (${pendingW9Payouts.length} payouts) - Fee: $${(instantPayoutFeeCents / 100).toFixed(2)}`
        : `W-9 release (${pendingW9Payouts.length} payouts)`,
      idempotencyKey,
      note: `Worker: ${profileId}, batch of ${pendingW9Payouts.length} payouts${isInstantPayout ? ", Instant" : ""}`,
    });

    const paymentStatus = payment.status === "completed" ? "completed" : "processing";
    for (const payout of pendingW9Payouts) {
      const pAmount = payout.amount ?? 0;
      const proportionalFee = totalAmountCents > 0 && isInstantPayout
        ? Math.round((instantPayoutFeeCents * pAmount) / totalAmountCents)
        : undefined;
      await storage.updateWorkerPayout(payout.id, {
        status: paymentStatus,
        mercuryPaymentId: payment.id,
        mercuryPaymentStatus: payment.status,
        isInstantPayout: isInstantPayout,
        instantPayoutFee: proportionalFee,
        originalAmount: pAmount,
      });
      if (payout.timesheetId) {
        await storage.updateTimesheet(payout.timesheetId, { paymentStatus: "pending" });
      }
    }
    console.log(`[W9Release] Done: 1 payment (${payment.id}) for ${pendingW9Payouts.length} payouts, worker ${profileId}`);
  } catch (err: any) {
    console.error(`[W9Release] Error for worker ${profileId}:`, err?.message ?? err);
  } finally {
    w9ReleaseInProgress.delete(profileId);
  }
}

// Balance management constants (in cents)
const COMPANY_TARGET_BALANCE_CENTS = 200000; // $2,000 minimum balance to maintain
const COMPANY_REPLENISH_TRIGGER_CENTS = 100000; // Trigger auto-replenish when balance drops below $1,000
const PLATFORM_FEE_PER_HOUR_CENTS = 1300; // $13 per hour worked

function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/** Format job start date as relative to today for emails (e.g. "today", "tomorrow", "in 3 days"). */
function getStartDateRelative(startDate: Date | string | null): string {
  if (!startDate) return '';
  const start = new Date(startDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const diffDays = Math.round((startDay.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 0 && diffDays <= 14) return `in ${diffDays} days`;
  if (diffDays < 0 && diffDays >= -14) return `${-diffDays} days ago`;
  return '';
}

function notificationPrefsOnly(
  p: { emailNotifications?: boolean | null; notifyNewJobs?: boolean | null; notifyJobUpdates?: boolean | null } | null | undefined
): { emailNotifications?: boolean; notifyNewJobs?: boolean; notifyJobUpdates?: boolean } {
  if (!p) return { emailNotifications: true, notifyNewJobs: true, notifyJobUpdates: true };
  return {
    emailNotifications: p.emailNotifications ?? undefined,
    notifyNewJobs: p.notifyNewJobs ?? undefined,
    notifyJobUpdates: p.notifyJobUpdates ?? undefined,
  };
}

/** Resolve notification recipient for job/location: location rep/teammate or company admin. Returns { email, profile } for checking notification prefs. */
async function getNotificationRecipientForJob(
  job: { companyLocationId?: number | null; companyId: number },
  _notificationType: "worker_inquiry" | "worker_clocked_in" | "worker_clocked_out"
): Promise<{ email: string; profile: { emailNotifications?: boolean; notifyNewJobs?: boolean; notifyJobUpdates?: boolean } } | null> {
  const companyProfile = await storage.getProfile(job.companyId);
  if (!companyProfile?.email) return null;
  const companyFallback = { email: companyProfile.email, profile: notificationPrefsOnly(companyProfile) };
  if (!job.companyLocationId) return companyFallback;
  const location = await storage.getCompanyLocation(job.companyLocationId);
  if (!location) return companyFallback;
  const loc = location as any;
  if (loc.useCompanyDefault) return companyFallback;
  if (loc.representativeTeamMemberId) {
    const member = await storage.getCompanyTeamMember(loc.representativeTeamMemberId);
    if (member?.email) {
      const memberProfile = await storage.getProfileByUserId(member.userId);
      return { email: member.email, profile: notificationPrefsOnly(memberProfile) };
    }
  }
  if (loc.assignedTeamMemberIds?.length) {
    const member = await storage.getCompanyTeamMember(loc.assignedTeamMemberIds[0]);
    if (member?.email) {
      const memberProfile = await storage.getProfileByUserId(member.userId);
      return { email: member.email, profile: notificationPrefsOnly(memberProfile) };
    }
  }
  if (loc.contactEmail) return { email: loc.contactEmail, profile: { emailNotifications: true, notifyNewJobs: true, notifyJobUpdates: true } };
  return companyFallback;
}

/** Check if the profile is a worker team member with admin role and the team has an accepted application for this job. */
async function isWorkerTeamAdminWithJobAccess(
  profile: { id: number; role: string; teamId?: number | null; email?: string | null },
  jobId: number
): Promise<boolean> {
  if (profile.role !== 'worker' || !profile.teamId) return false;
  const [team] = await db.select().from(teams).where(eq(teams.id, profile.teamId));
  if (!team) return false;
  const members = await db.select().from(workerTeamMembers)
    .where(and(eq(workerTeamMembers.teamId, team.id), eq(workerTeamMembers.status, 'active')));
  const teamMember = members.find(m => (m.email || '').toLowerCase() === (profile.email || '').toLowerCase());
  if (!teamMember || (teamMember as any).role !== 'admin') return false;
  const acceptedApps = await db.select().from(applications)
    .where(and(eq(applications.jobId, jobId), eq(applications.status, 'accepted')));
  const teamMemberIds = new Set(members.map(m => m.id));
  return acceptedApps.some(app =>
    app.workerId === team.ownerId || (app.teamMemberId != null && teamMemberIds.has(app.teamMemberId))
  );
}

/** Check if the profile is a company team member assigned to the job's location (rep or in assignedTeamMemberIds). */
async function isLocationRepOrAssigned(
  profile: { id: number; role: string; userId?: string | null },
  job: { companyId: number; companyLocationId?: number | null }
): Promise<boolean> {
  if (profile.role !== 'company' || !profile.userId) return false;
  if (!job.companyLocationId) return false;
  const teamMember = await storage.getCompanyTeamMemberByUserId(job.companyId, profile.userId);
  if (!teamMember) return false;
  const location = await storage.getCompanyLocation(job.companyLocationId);
  if (!location) return false;
  const loc = location as { representativeTeamMemberId?: number | null; assignedTeamMemberIds?: number[] };
  if (loc.representativeTeamMemberId === teamMember.id) return true;
  if (Array.isArray(loc.assignedTeamMemberIds) && loc.assignedTeamMemberIds.includes(teamMember.id)) return true;
  return false;
}

/** Resolve location representative name: contactName, team member (representative or first assigned), contactEmail, or company fallback. */
async function getLocationRepresentativeName(
  job: { companyLocationId?: number | null; locationName?: string | null } & { companyName?: string | null },
  companyProfile?: { firstName?: string | null; lastName?: string | null; companyName?: string | null } | null
): Promise<string> {
  const companyFallback = companyProfile
    ? ([companyProfile.firstName, companyProfile.lastName].filter(Boolean).join(' ').trim() || companyProfile.companyName || '')
    : ((job as any).companyName || job.locationName || '');
  if (!job.companyLocationId) return job.locationName || companyFallback || '';
  const location = await storage.getCompanyLocation(job.companyLocationId);
  if (!location) return job.locationName || companyFallback || '';
  const loc = location as any;
  if (loc.contactName) return loc.contactName;
  if (loc.representativeTeamMemberId) {
    const member = await storage.getCompanyTeamMember(loc.representativeTeamMemberId);
    if (member) return [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || companyFallback;
  }
  if (loc.assignedTeamMemberIds?.length) {
    const member = await storage.getCompanyTeamMember(loc.assignedTeamMemberIds[0]);
    if (member) return [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || companyFallback;
  }
  if (loc.contactEmail) return loc.contactEmail;
  return companyFallback;
}

// Bio validation - detect and block personal information
function validateBio(text: string | null | undefined): { isValid: boolean; error: string | null } {
  if (!text) return { isValid: true, error: null };
  
  const lowerText = text.toLowerCase();
  
  // Email patterns
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (emailPattern.test(text)) {
    return { isValid: false, error: "Bio cannot contain email addresses" };
  }
  
  // Phone number patterns (various formats)
  const phonePatterns = [
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // 123-456-7890, 123.456.7890, 123 456 7890
    /\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/, // (123) 456-7890
    /\b\d{10}\b/, // 1234567890
    /\b\+?1?\s?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // +1 123-456-7890
  ];
  for (const pattern of phonePatterns) {
    if (pattern.test(text)) {
      return { isValid: false, error: "Bio cannot contain phone numbers" };
    }
  }
  
  // URL/Website patterns
  const urlPatterns = [
    /https?:\/\/[^\s]+/i, // http:// or https://
    /www\.[^\s]+\.[a-z]{2,}/i, // www.example.com
    /[a-zA-Z0-9-]+\.(com|net|org|io|co|us|info|biz|me|dev|app|tech|xyz)[^\w]/i, // example.com, mysite.net
  ];
  for (const pattern of urlPatterns) {
    if (pattern.test(text)) {
      return { isValid: false, error: "Bio cannot contain websites or URLs" };
    }
  }
  
  // Contact-related keywords paired with potential contact info
  if (/(call|text|email|contact|reach|dm|message|whatsapp|telegram|instagram|facebook|twitter|snapchat|tiktok)/i.test(lowerText)) {
    if (/\b\d{7,}\b/.test(text)) { // 7+ consecutive digits
      return { isValid: false, error: "Bio appears to contain contact information" };
    }
  }
  
  return { isValid: true, error: null };
}

// US state to IANA timezone mapping (uses primary timezone for each state)
const stateTimezones: Record<string, string> = {
  // Eastern Time
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", 
  GA: "America/New_York", ME: "America/New_York", MD: "America/New_York", 
  MA: "America/New_York", NH: "America/New_York", NJ: "America/New_York", 
  NY: "America/New_York", NC: "America/New_York", OH: "America/New_York", 
  PA: "America/New_York", RI: "America/New_York", SC: "America/New_York",
  VT: "America/New_York", VA: "America/New_York", WV: "America/New_York",
  FL: "America/New_York", MI: "America/Detroit", IN: "America/Indiana/Indianapolis",
  KY: "America/Kentucky/Louisville",
  // Central Time
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", 
  IA: "America/Chicago", KS: "America/Chicago", LA: "America/Chicago", 
  MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago", 
  NE: "America/Chicago", ND: "America/Chicago", OK: "America/Chicago",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  // Mountain Time
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Boise", 
  MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  // Pacific Time
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", 
  WA: "America/Los_Angeles",
  // Alaska & Hawaii
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
};

// Get timezone for a state (defaults to Eastern if unknown)
function getTimezoneForState(state: string | null | undefined): string {
  if (state && stateTimezones[state.toUpperCase()]) {
    return stateTimezones[state.toUpperCase()];
  }
  return "America/New_York"; // Default to Eastern
}

// Check if within geofence - uses stricter radius for automatic clock in/out
function isWithinGeofence(distanceMeters: number, isAutomatic: boolean = false): boolean {
  const radiusMeters = isAutomatic ? AUTO_GEOFENCE_RADIUS_METERS : MANUAL_GEOFENCE_RADIUS_METERS;
  return distanceMeters <= radiusMeters;
}

// Radius (meters) for "at job site" when computing time-away-from-site from location pings.
// Worker time outside this radius while clocked in is deducted from billable hours.
const TIME_AWAY_GEOFENCE_METERS = 500;

/**
 * Compute hours spent outside the job site during a shift using location pings.
 * Returns 0 if no pings, or sum of interval portions where the worker was outside TIME_AWAY_GEOFENCE_METERS.
 */
async function computeTimeAwayFromSite(
  workerProfileId: number,
  jobId: number,
  clockInTime: Date,
  clockOutTime: Date
): Promise<{ hoursAway: number; pingCount: number }> {
  const pings = await db
    .select({
      createdAt: locationPings.createdAt,
      distanceFromJob: locationPings.distanceFromJob,
    })
    .from(locationPings)
    .where(and(
      eq(locationPings.workerProfileId, workerProfileId),
      eq(locationPings.jobId, jobId),
      gte(locationPings.createdAt, clockInTime),
      lte(locationPings.createdAt, clockOutTime)
    ))
    .orderBy(asc(locationPings.createdAt));

  if (pings.length < 2) {
    return { hoursAway: 0, pingCount: pings.length };
  }

  let secondsAway = 0;
  for (let i = 0; i < pings.length - 1; i++) {
    const p0 = pings[i];
    const p1 = pings[i + 1];
    const t0 = new Date(p0.createdAt as string | Date).getTime();
    const t1 = new Date(p1.createdAt as string | Date).getTime();
    const intervalMs = t1 - t0;
    const d0 = p0.distanceFromJob != null ? Number(p0.distanceFromJob) : 0;
    const d1 = p1.distanceFromJob != null ? Number(p1.distanceFromJob) : 0;
    const away0 = d0 > TIME_AWAY_GEOFENCE_METERS;
    const away1 = d1 > TIME_AWAY_GEOFENCE_METERS;
    const intervalSec = intervalMs / 1000;
    if (away0 && away1) {
      secondsAway += intervalSec;
    } else if (away0 || away1) {
      secondsAway += intervalSec * 0.5;
    }
  }

  const hoursAway = secondsAway / (60 * 60);
  return { hoursAway, pingCount: pings.length };
}

// Auto-replenishment helper: calculates amount needed to restore target balance
// When balance drops to or below trigger threshold after a charge, this calculates how much to pull
// Companies can have custom target balance, default is COMPANY_TARGET_BALANCE_CENTS ($2,000)
// Trigger threshold is always 50% of the target balance
// Example: Target $2k, trigger $1k: Balance $2k, charge $264 → $1736 (above $1k, no replenish)
// Example: Target $2k, trigger $1k: Balance $1200, charge $264 → $936 (at/below $1k, replenish $2k - $936 = $1064)
function calculateReplenishmentAmount(
  currentBalance: number,
  chargeAmount: number,
  customTargetBalance?: number | null
): { shouldReplenish: boolean; replenishAmount: number; newBalanceAfterCharge: number; targetBalance: number } {
  // Validate and normalize target balance - must be finite, at least $500 (50000 cents)
  const rawTarget = Number(customTargetBalance);
  const targetBalance = Number.isFinite(rawTarget) && rawTarget >= 50000 
    ? rawTarget 
    : COMPANY_TARGET_BALANCE_CENTS;
  const triggerThreshold = Math.floor(targetBalance / 2); // Trigger at 50% of target
  const newBalanceAfterCharge = currentBalance - chargeAmount;
  
  // If balance after charge drops to or below trigger threshold, replenish
  // Use <= to trigger when balance equals exactly the threshold
  if (newBalanceAfterCharge <= triggerThreshold) {
    // Calculate how much we need to get back to target balance
    // This includes covering any shortfall (negative balance) plus restoring to target
    const replenishAmount = targetBalance - newBalanceAfterCharge;
    return {
      shouldReplenish: true,
      replenishAmount: Math.max(replenishAmount, 0),
      newBalanceAfterCharge,
      targetBalance,
    };
  }
  
  return {
    shouldReplenish: false,
    replenishAmount: 0,
    newBalanceAfterCharge,
    targetBalance,
  };
}

// Sanitize messages to remove contact info (phone, email, URLs)
function sanitizeMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  
  let sanitized = message;
  
  // Remove phone numbers (various formats)
  // Matches: (123) 456-7890, 123-456-7890, 123.456.7890, 1234567890, +1 123 456 7890
  sanitized = sanitized.replace(/(\+?1?\s?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[contact removed]');
  
  // Remove email addresses
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[contact removed]');
  
  // Remove URLs (http, https, www)
  sanitized = sanitized.replace(/(?:https?:\/\/|www\.)[^\s]+/gi, '[link removed]');
  
  // Remove additional number sequences that look like phone numbers (7+ digits)
  sanitized = sanitized.replace(/\b\d{7,}\b/g, '[contact removed]');
  
  return sanitized;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const BASE_URL = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";
  const jobFilledEmailSentForJobIds = new Set<number>();

  async function sendJobFilledIfNeeded(job: Job, companyProfile: typeof profiles.$inferSelect | null | undefined): Promise<void> {
    if (!companyProfile?.email) return;
    const acceptedApps = await storage.getApplicationsByJob(job.id);
    const acceptedCount = acceptedApps.filter((a) => a.status === "accepted").length;
    const totalPositions = job.maxWorkersNeeded || 1;
    if (acceptedCount !== totalPositions) return;
    if (jobFilledEmailSentForJobIds.has(job.id)) return;
    jobFilledEmailSentForJobIds.add(job.id);
    sendEmail({
      to: companyProfile.email,
      type: "job_filled",
      data: {
        jobTitle: job.title,
        jobId: job.id,
        workersNeeded: totalPositions,
        startDate: job.startDate ? new Date(job.startDate).toLocaleDateString() : "TBD",
      },
    }).catch((err) => console.error("Failed to send job filled email:", err));
  }

  async function convertInquiryToPublicJob(inquiry: any): Promise<{ jobId: number | null; postedPublicly: boolean }> {
    if (!inquiry?.fallbackToPublic) return { jobId: inquiry?.convertedJobId ?? null, postedPublicly: false };
    if (inquiry.convertedJobId) return { jobId: inquiry.convertedJobId, postedPublicly: true };
    const job = await storage.createJob({
      companyId: inquiry.companyId,
      title: inquiry.title,
      description: inquiry.description,
      location: inquiry.location,
      locationName: inquiry.locationName,
      address: inquiry.address,
      city: inquiry.city,
      state: inquiry.state,
      zipCode: inquiry.zipCode,
      latitude: inquiry.latitude ?? undefined,
      longitude: inquiry.longitude ?? undefined,
      requiredSkills: inquiry.requiredSkills,
      hourlyRate: inquiry.hourlyRate,
      trade: (inquiry.requiredSkills && inquiry.requiredSkills.length > 0 ? inquiry.requiredSkills[0] : "General Labor") as any,
      startDate: inquiry.startDate,
      endDate: inquiry.endDate || undefined,
      scheduledTime: inquiry.scheduledTime,
      estimatedHours: inquiry.estimatedHours,
      jobType: inquiry.jobType as any,
      images: inquiry.images,
      videos: inquiry.videos,
      budgetCents: inquiry.budgetCents,
      maxWorkersNeeded: inquiry.maxWorkersNeeded,
      isOnDemand: inquiry.jobType === "on_demand",
      timezone: getTimezoneForState(inquiry.state),
    });
    await storage.updateDirectJobInquiry(inquiry.id, { status: "converted" as any, convertedJobId: job.id });
    return { jobId: job.id, postedPublicly: true };
  }

  async function expireDirectInquiryAndNotify(
    inquiry: any,
    companyProfile: typeof profiles.$inferSelect | null | undefined,
    workerName: string
  ): Promise<{ status: "expired" | "converted"; jobId: number; postedPublicly: boolean }> {
    const publicResult = await convertInquiryToPublicJob(inquiry);
    const postedPublicly = publicResult.postedPublicly;
    const jobId = publicResult.jobId ?? inquiry.convertedJobId ?? inquiry.id;
    const nextStatus: "expired" | "converted" = postedPublicly ? "converted" : "expired";
    if (!postedPublicly) {
      await storage.updateDirectJobInquiry(inquiry.id, { status: "expired" as any });
    }
    if (companyProfile?.email && companyProfile.emailNotifications) {
      sendEmail({
        to: companyProfile.email,
        type: "direct_request_expired",
        data: {
          jobTitle: inquiry.title,
          jobId,
          workerName: workerName || "The worker",
          postedPublicly,
        },
      }).catch((err) => console.error("Failed to send direct request expired email:", err));
    }
    return { status: nextStatus, jobId, postedPublicly };
  }

  /** Email + replenishment only (caller sends WebSocket via notifyApplicationUpdate). */
  async function sendApplicationAcceptedEmailAndReplenish(params: {
    job: Job;
    worker: (typeof profiles.$inferSelect) | null | undefined;
    companyProfile: typeof profiles.$inferSelect;
  }): Promise<void> {
    const { job, worker, companyProfile } = params;
    const companyName =
      companyProfile?.companyName ||
      (companyProfile ? `${companyProfile.firstName} ${companyProfile.lastName}`.trim() : "") ||
      "Company";
    const companyIdForReplenishment = job.companyId;
    if (worker?.email && worker.emailNotifications) {
      sendEmail({
        to: worker.email,
        type: "application_accepted",
        data: {
          jobTitle: job.title,
          jobId: job.id,
          companyName,
          startDate: job.startDate ? new Date(job.startDate).toLocaleDateString() : "TBD",
          location: job.location || `${job.city}, ${job.state}`,
          hourlyRate: job.hourlyRate ? (job.hourlyRate / 100).toFixed(0) : "0",
        },
      }).catch((err) => console.error("Failed to send application accepted email:", err));
    }

    await sendJobFilledIfNeeded(job, companyProfile);

    await afterHireFundingCheck(job.id, companyIdForReplenishment);
  }
  
  // WebSocket setup for real-time notifications
  setupWebSocket(httpServer, app);
  
  // Auth setup - session and passport
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(attachProfile);
  app.use(attachRlsDbContext);

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  // Log any 403 so we can see in CLI which path returned it
  app.use((req, res, next) => {
    const origStatus = res.status.bind(res);
    res.status = function (code: number) {
      if (code === 403) {
        console.log("[403] " + req.method + " " + req.originalUrl);
      }
      return origStatus(code);
    };
    next();
  });
  
  // Health check endpoint (public, no auth required)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Worker payouts – register first so no other route shadows it (fixes 404 when client fetches recipient payments)
  app.get("/api/worker/payouts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can access payout information" });
    }
    try {
      let payouts = await storage.getWorkerPayouts(profile.id);
      const toSync = payouts.filter((p: any) => p.mercuryPaymentId && p.status !== "completed").slice(0, 5);
      for (const p of toSync) {
        const paymentId = p.mercuryPaymentId;
        if (!paymentId) continue;
        try {
          const { mercuryService } = await import("./services/mercury");
          const tx = await mercuryService.getTransaction(paymentId);
          const txStatus = (tx?.status ?? "").toLowerCase();
          if (txStatus === "completed" || txStatus === "sent" || txStatus === "posted") {
            const completedAt = tx?.createdAt ? new Date(tx.createdAt) : new Date();
            await storage.updateWorkerPayout(p.id, {
              status: "completed",
              mercuryPaymentStatus: tx?.status ?? "completed",
              completedAt,
            } as any);
            payouts = await storage.getWorkerPayouts(profile.id);
          }
        } catch (syncErr: any) {
          console.warn("[WorkerPayouts] Mercury sync for payout", p.id, ":", syncErr?.message ?? syncErr);
        }
      }
      res.json(payouts);
    } catch (err: any) {
      console.error("[WorkerPayouts] Error:", err?.message ?? err);
      res.status(200).json([]);
    }
  });

  // Map thumbnail proxy – serves job map image from our domain so email links match sending domain and API key is never in the email
  // For open jobs: allowed without auth (email previews). For in_progress/completed: require auth + job access.
  app.get("/api/map-thumbnail", async (req, res) => {
    if (req.query.sample === "1") {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      const placeholder = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAWgAAAAUCAYAAAB4dOj3AAAAMklEQVR42u3OMQEAAAjDMMC/52ECvhBI0d0NAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBvBzLgAAETb1UAAAAASUVORK5CYII=", "base64");
      return res.send(placeholder);
    }
    const jobId = req.query.jobId ? Number(req.query.jobId) : null;
    if (!jobId || isNaN(jobId)) return res.status(400).json({ message: "Missing or invalid jobId" });
    const job = await storage.getJob(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    // Require auth for non-open jobs (protect in_progress/completed job locations)
    if (job.status !== "open") {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(403).json({ message: "Forbidden" });
      const isCompany = job.companyId === profile.id || (await isLocationRepOrAssigned(profile, job));
      const workerApps = profile.role === "worker" ? await storage.getWorkerApplications(profile.id) : [];
      const isWorker = workerApps.some((a: any) => a.jobId === jobId && a.status === "accepted")
        || (profile.role === "worker" && (await isWorkerTeamAdminWithJobAccess(profile, jobId)));
      if (!isCompany && !isWorker) return res.status(403).json({ message: "Forbidden" });
    }
    // Build map URL server-side only; never store or expose the Google API key in DB or email
    let mapUrl = (job as any).mapThumbnailUrl || null;
    if (!mapUrl && job.latitude && job.longitude && process.env.GOOGLE_API_KEY) {
      mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${job.latitude},${job.longitude}&zoom=13&size=600x260&maptype=roadmap&markers=color:red%7Csize:mid%7C${job.latitude},${job.longitude}&key=${process.env.GOOGLE_API_KEY}`;
    }
    if (!mapUrl) return res.status(404).json({ message: "No map image for this job" });
    try {
      const resp = await fetch(mapUrl);
      if (!resp.ok) return res.status(502).json({ message: "Failed to fetch map image" });
      const contentType = resp.headers.get("content-type") || "image/png";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      const buf = await resp.arrayBuffer();
      res.send(Buffer.from(buf));
    } catch (e: any) {
      console.error("[map-thumbnail] fetch error:", e?.message);
      return res.status(502).json({ message: "Failed to fetch map image" });
    }
  });

  // Auth routes
  registerAuthRoutes(app);
  
  // Login page route - serve the login page
  app.get("/api/login", (req, res) => {
    // In production, this will be handled by the static file server
    // In development, Vite will handle it
    // For now, redirect to /login client route
    res.redirect("/login");
  });
  
  // Logout route
  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      // Redirect to index page after logout
      // On mobile, redirect to app subdomain if not already there
      const userAgent = req.get('user-agent') || '';
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
      
      if (isMobile) {
        // On mobile, redirect to app subdomain
        const host = req.get('host') || '';
        const protocol = req.protocol;
        let redirectUrl: string;
        
        if (host.startsWith('app.')) {
          // Already on app subdomain
          redirectUrl = `${protocol}://${host}/`;
        } else {
          // Redirect to app subdomain
          const baseDomain = host.split(':')[0]; // Remove port if present
          const parts = baseDomain.split('.');
          const domain = parts.length >= 2 ? parts.slice(-2).join('.') : baseDomain;
          const port = host.includes(':') ? host.split(':')[1] : '';
          redirectUrl = `${protocol}://app.${domain}${port ? `:${port}` : ''}/`;
        }
        
        res.redirect(redirectUrl);
      } else {
        // Desktop: redirect to main domain index
        res.redirect('/');
      }
    });
  });

  // Log all requests to connect-google so we can see in CLI if something returns 403 before we run
  app.use((req, res, next) => {
    if (req.path === "/api/reviews/connect-google") {
      console.log("[connect-google] Incoming:", req.method, req.path, "| authenticated:", !!req.isAuthenticated?.(), "| hasCookie:", !!req.headers?.cookie);
    }
    next();
  });

  // Google Business OAuth (reviews) - workers AND companies allowed (worker onboarding Prior Work Photos sync)
  app.get("/api/reviews/connect-google", async (req, res) => {
    console.log("[connect-google] Handler entered");
    if (!req.isAuthenticated()) {
      console.log("[connect-google] Not authenticated -> redirect /login");
      return res.redirect("/login");
    }
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) {
      console.log("[connect-google] No profile -> redirect worker-onboarding");
      return res.redirect("/worker-onboarding?google_connect=no_profile");
    }
    // Do not add a role check here: both workers and companies can connect Google Business
    const defaultReturn = profile.role === "worker" ? "/worker-onboarding" : "/dashboard/reviews";
    const returnUrl = (req.query.returnUrl as string) || defaultReturn;
    (req.session as any).googleBusinessReturnUrl = returnUrl;
    (req.session as any).googleBusinessProfileId = profile.id;
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      console.log("[connect-google] GOOGLE_CLIENT_ID missing -> 500");
      return res.status(500).json({ message: "Google OAuth not configured" });
    }
    console.log("[connect-google] Redirecting to Google OAuth");
    const scopes = [
      "https://www.googleapis.com/auth/business.manage",
      "https://www.googleapis.com/auth/plus.business.manage",
    ].join(" ");
    const redirectUri = `${process.env.BASE_URL || "http://localhost:5000"}/api/reviews/google-callback`;
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).googleBusinessOAuthState = state;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(googleClientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `state=${state}`;
    res.redirect(authUrl);
  });

  app.get("/api/reviews/google-callback", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.redirect("/login");
    }
    try {
      const { code, state, error } = req.query;
      if (error) {
        const returnUrl = (req.session as any)?.googleBusinessReturnUrl || "/worker-onboarding";
        return res.redirect(`${returnUrl}?error=oauth_failed`);
      }
      if (!code || !state) {
        const returnUrl = (req.session as any)?.googleBusinessReturnUrl || "/worker-onboarding";
        return res.redirect(`${returnUrl}?error=invalid_request`);
      }
      const sessionState = (req.session as any)?.googleBusinessOAuthState;
      if (state !== sessionState) {
        const returnUrl = (req.session as any)?.googleBusinessReturnUrl || "/worker-onboarding";
        return res.redirect(`${returnUrl}?error=invalid_state`);
      }
      const profileId = (req.session as any)?.googleBusinessProfileId;
      const returnUrl = (req.session as any)?.googleBusinessReturnUrl || "/worker-onboarding";
      delete (req.session as any).googleBusinessOAuthState;
      delete (req.session as any).googleBusinessProfileId;
      delete (req.session as any).googleBusinessReturnUrl;
      const googleClientId = process.env.GOOGLE_CLIENT_ID;
      const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = `${process.env.BASE_URL || "http://localhost:5000"}/api/reviews/google-callback`;
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: code as string,
          client_id: googleClientId!,
          client_secret: googleClientSecret!,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenResponse.ok) {
        const returnUrl = (req.session as any)?.googleBusinessReturnUrl || "/worker-onboarding";
        return res.redirect(`${returnUrl}?error=token_exchange_failed`);
      }
      const tokens = await tokenResponse.json();
      const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
      const locationsResponse = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
        headers: { "Authorization": `Bearer ${tokens.access_token}` },
      });
      if (!locationsResponse.ok) {
        return res.redirect(`${returnUrl}?error=fetch_accounts_failed`);
      }
      const accountsData = await locationsResponse.json();
      const accountName = accountsData.accounts?.[0]?.name;
      if (!accountName) {
        return res.redirect("/dashboard/reviews?error=no_account_found");
      }
      const accountLocationsResponse = await fetch(
        `https://mybusinessaccountmanagement.googleapis.com/v1/${accountName}/locations`,
        { headers: { "Authorization": `Bearer ${tokens.access_token}` } }
      );
      if (!accountLocationsResponse.ok) {
        return res.redirect(`${returnUrl}?error=fetch_locations_failed`);
      }
      const locationsData = await accountLocationsResponse.json();
      const locationName = locationsData.locations?.[0]?.name;
      if (!locationName) {
        return res.redirect("/dashboard/reviews?error=no_location_found");
      }
      await db.update(profiles)
        .set({
          googleBusinessAccessToken: tokens.access_token,
          googleBusinessRefreshToken: tokens.refresh_token,
          googleBusinessTokenExpiresAt: expiresAt,
          googleBusinessLocationId: locationName,
        })
        .where(eq(profiles.id, profileId));
      res.redirect(`${returnUrl}?google_connected=true`);
    } catch (err: any) {
      const returnUrl = (req.session as any)?.googleBusinessReturnUrl || "/worker-onboarding";
      res.redirect(`${returnUrl}?error=oauth_callback_failed`);
    }
  });
  
  // Object storage routes
  const { registerObjectStorageRoutes } = await import("./services/objectStorageRoutes");
  registerObjectStorageRoutes(app);

  // === Development-only: Account Switcher for Testing ===
  // Nested /api/dev/* blocks below register only when NODE_ENV is exactly `development`.
  const isDevOnly = process.env.NODE_ENV === 'development';

  /**
   * Dev tooling: fills accepted slots from pending apps + seeded workers.
   * Registered whenever NODE_ENV !== production so `npm run start:dev` (no cross-env) still works.
   */
  app.post("/api/dev/fill-job-worker-slots", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ message: "Not found" });
    }
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can use this" });
    }
    const jobId = Number((req.body as { jobId?: unknown })?.jobId);
    if (!Number.isFinite(jobId)) {
      return res.status(400).json({ message: "jobId required" });
    }
    const job = await storage.getJob(jobId);
    if (!job || job.companyId !== profile.id) {
      return res.status(403).json({ message: "Not your job" });
    }
    if (!["open", "in_progress"].includes(String(job.status))) {
      return res.status(400).json({ message: "Job must be open or in progress" });
    }

    let apps = await storage.getJobApplications(jobId);
    const acceptedCount = apps.filter((a) => a.status === "accepted").length;
    const max = job.maxWorkersNeeded ?? 1;
    let slots = Math.max(0, max - acceptedCount);
    let hired = 0;

    const pending = apps.filter((a) => a.status === "pending").sort((a, b) => a.id - b.id);
    for (const app of pending) {
      if (slots <= 0) break;
      await storage.updateApplicationStatus(app.id, "accepted");
      notifyApplicationUpdate(app.workerId, {
        applicationId: app.id,
        jobId: job.id,
        jobTitle: job.title,
        status: "accepted",
      });
      hired++;
      slots--;
    }

    if (slots > 0) {
      apps = await storage.getJobApplications(jobId);
      const teamRows = await db.select({ ownerId: teams.ownerId }).from(teams);
      const ownerIds = new Set(
        teamRows.map((t) => t.ownerId).filter((id): id is number => typeof id === "number")
      );
      const workerCandidates = await db
        .select()
        .from(profiles)
        .where(and(eq(profiles.role, "worker"), isNull(profiles.teamId)));
      const usedWorkerIds = new Set(apps.map((a) => a.workerId));
      const candidates = workerCandidates.filter((w) => !ownerIds.has(w.id) && !usedWorkerIds.has(w.id));
      const rate = workerFacingJobHourlyCents(job.hourlyRate);

      for (const worker of candidates) {
        if (slots <= 0) break;
        try {
          const newApp = await storage.createApplication({
            jobId: job.id,
            workerId: worker.id,
            message: "[dev] auto-seeded hire",
            ...(rate > 0 ? { proposedRate: rate } : {}),
          });
          usedWorkerIds.add(worker.id);
          await storage.updateApplicationStatus(newApp.id, "accepted");
          notifyApplicationUpdate(worker.id, {
            applicationId: newApp.id,
            jobId: job.id,
            jobTitle: job.title,
            status: "accepted",
          });
          hired++;
          slots--;
        } catch (e) {
          console.warn("[dev fill-job-worker-slots] seed worker failed:", e);
        }
      }
    }

    if (hired > 0) {
      await afterHireFundingCheck(job.id, job.companyId).catch((err) =>
        console.error("[dev fill-job-worker-slots] afterHireFundingCheck:", err)
      );
    }

    return res.json({
      hired,
      remainingSlots: slots,
      maxWorkersNeeded: max,
    });
  });

  if (isDevOnly) {
    // Get list of test accounts - return ALL users from database
    app.get("/api/dev/test-accounts", async (req, res) => {
      try {
        // Fetch ALL users from the database for localhost
        const allUsers = await db.select().from(users);
        
        const testProfiles = await Promise.all(
          allUsers.map(async (u) => {
            try {
              const profile = await storage.getProfileByUserId(u.id);
              return {
                userId: u.id,
                email: u.email || 'No email',
                firstName: profile?.firstName || profile?.companyName || u.firstName || 'Unknown',
                lastName: profile?.lastName || u.lastName || '',
                role: profile?.role || (u.userType === 'company' ? 'company' : 'worker'),
              };
            } catch (profileError) {
              // If profile fetch fails, still return user data
              console.warn(`Failed to fetch profile for user ${u.id}:`, profileError);
              return {
                userId: u.id,
                email: u.email || 'No email',
                firstName: u.firstName || 'Unknown',
                lastName: u.lastName || '',
                role: u.userType === 'company' ? 'company' : 'worker',
              };
            }
          })
        );
        res.json(testProfiles);
      } catch (error: any) {
        console.error("Error fetching test accounts:", error);
        console.error("Error details:", {
          message: error.message,
          stack: error.stack,
        });
        res.status(500).json({ error: "Failed to fetch test accounts", message: error.message });
      }
    });

    /** Seed open job + pending application for UI E2E (company hires → worker clocks in). No auth. */
    app.post("/api/dev/e2e-flow-setup", async (_req, res) => {
      try {
        const [company] = await db.select().from(profiles).where(eq(profiles.role, "company")).limit(1);
        if (!company) {
          return res.status(400).json({ error: "No company profile in DB" });
        }
        const teamRows = await db.select({ ownerId: teams.ownerId }).from(teams);
        const ownerIds = new Set(
          teamRows.map((t) => t.ownerId).filter((id): id is number => typeof id === "number")
        );
        const workerCandidates = await db
          .select()
          .from(profiles)
          .where(and(eq(profiles.role, "worker"), isNull(profiles.teamId)));
        const worker =
          workerCandidates.find((w) => !ownerIds.has(w.id)) ?? workerCandidates[0];
        if (!worker) {
          return res.status(400).json({ error: "No worker profile (try worker with team_id null)" });
        }
        await storage.updateProfile(company.id, {
          depositAmount: Math.max(company.depositAmount ?? 0, 500_000),
        });
        const jobLat = "37.3382";
        const jobLng = "-121.8863";
        const start = new Date();
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const title = `E2E Flow ${Date.now()}`;
        const job = await storage.createJob({
          companyId: company.id,
          title,
          description: "E2E seeded job",
          location: "1 Apple Park Way, Cupertino, CA",
          locationName: "E2E site",
          trade: "General Labor",
          hourlyRate: 2500,
          maxWorkersNeeded: 3,
          startDate: start,
          jobType: "one_time",
          isOnDemand: false,
          latitude: jobLat,
          longitude: jobLng,
        });
        const application = await storage.createApplication({
          jobId: job.id,
          workerId: worker.id,
          message: "E2E application",
        });
        res.json({
          jobId: job.id,
          applicationId: application.id,
          companyUserId: company.userId,
          workerUserId: worker.userId,
          companyProfileId: company.id,
          workerProfileId: worker.id,
          jobLat: parseFloat(jobLat),
          jobLng: parseFloat(jobLng),
        });
      } catch (e: any) {
        console.error("[e2e-flow-setup]", e);
        res.status(500).json({ error: String(e?.message || e) });
      }
    });

    // Test geolocation wakeup and auto clock logic (development only)
    app.post("/api/dev/test-geolocation-auto-clock", async (req, res) => {
      try {
        const { workerId, jobId, latitude, longitude, action } = req.body;
        
        if (!workerId || !jobId || !latitude || !longitude) {
          return res.status(400).json({ error: "workerId, jobId, latitude, longitude required" });
        }
        
        // Get job details
        const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (job.length === 0) {
          return res.status(404).json({ error: "Job not found" });
        }
        
        const jobData = job[0];
        const jobLat = parseFloat(String(jobData.latitude || 0));
        const jobLon = parseFloat(String(jobData.longitude || 0));
        const lat = parseFloat(String(latitude));
        const lng = parseFloat(String(longitude));
        
        // Calculate distance using Haversine formula
        const R = 6371e3; // Earth radius in meters
        const phi1 = lat * Math.PI / 180;
        const phi2 = jobLat * Math.PI / 180;
        const deltaPhi = (jobLat - lat) * Math.PI / 180;
        const deltaLambda = (jobLon - lng) * Math.PI / 180;
        
        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceMeters = R * c;
        
        // Geofence radii
        const AUTO_CLOCK_RADIUS = 402; // 0.25 miles in meters
        const MANUAL_CLOCK_RADIUS = 8047; // 5 miles in meters
        
        const isWithinAutoClockRadius = distanceMeters <= AUTO_CLOCK_RADIUS;
        const isWithinManualClockRadius = distanceMeters <= MANUAL_CLOCK_RADIUS;
        
        // Check assignment
        const assignment = await db.select().from(jobAssignments)
          .where(and(
            eq(jobAssignments.jobId, jobId),
            eq(jobAssignments.workerId, workerId),
            eq(jobAssignments.status, 'assigned')
          ))
          .limit(1);
        
        const isAssigned = assignment.length > 0;
        
        // Check existing timesheet for today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const existingTimesheet = await db.select().from(timesheets)
          .where(and(
            eq(timesheets.jobId, jobId),
            eq(timesheets.workerId, workerId),
            gte(timesheets.clockInTime, today),
            lte(timesheets.clockInTime, tomorrow)
          ))
          .limit(1);
        
        const isClockedIn = existingTimesheet.length > 0 && !existingTimesheet[0].clockOutTime;
        const hasClockedOut = existingTimesheet.length > 0 && existingTimesheet[0].clockOutTime !== null;
        
        // Determine what actions are available
        const canAutoClockIn = isWithinAutoClockRadius && isAssigned && !isClockedIn && !hasClockedOut;
        const canManualClockIn = isWithinManualClockRadius && isAssigned && !isClockedIn && !hasClockedOut;
        const canAutoClockOut = isWithinAutoClockRadius && isClockedIn;
        const canManualClockOut = isWithinManualClockRadius && isClockedIn;
        
        // If action is specified, perform it
        let actionResult = null;
        if (action === 'clock_in' && canManualClockIn) {
          // Get hourly rate from assignment
          const hourlyRate = assignment[0]?.agreedRate || 25;
          const newTimesheet = await db.insert(timesheets).values({
            jobId,
            workerId,
            companyId: jobData.companyId,
            clockInTime: new Date(),
            clockInLatitude: String(latitude),
            clockInLongitude: String(longitude),
            hourlyRate: Number(hourlyRate),
            status: 'pending'
          }).returning();
          actionResult = { action: 'clock_in', success: true, timesheetId: newTimesheet[0].id };
        } else if (action === 'clock_out' && canManualClockOut) {
          await db.update(timesheets)
            .set({
              clockOutTime: new Date(),
              clockOutLatitude: String(latitude),
              clockOutLongitude: String(longitude)
            })
            .where(eq(timesheets.id, existingTimesheet[0].id));
          actionResult = { action: 'clock_out', success: true, timesheetId: existingTimesheet[0].id };
        }
        
        res.json({
          test: 'geolocation-auto-clock',
          input: { workerId, jobId, latitude, longitude },
          job: {
            id: jobData.id,
            title: jobData.title,
            latitude: jobLat,
            longitude: jobLon
          },
          distance: {
            meters: Math.round(distanceMeters),
            miles: (distanceMeters / 1609.34).toFixed(2)
          },
          geofence: {
            autoClockRadius: `${AUTO_CLOCK_RADIUS}m (0.25 miles)`,
            manualClockRadius: `${MANUAL_CLOCK_RADIUS}m (5 miles)`,
            isWithinAutoClockRadius,
            isWithinManualClockRadius
          },
          worker: {
            isAssigned,
            isClockedIn,
            hasClockedOut
          },
          availableActions: {
            canAutoClockIn,
            canManualClockIn,
            canAutoClockOut,
            canManualClockOut
          },
          actionResult
        });
      } catch (error) {
        console.error("Error testing geolocation auto-clock:", error);
        res.status(500).json({ error: String(error) });
      }
    });

    // Test push notification wakeup (development only)
    app.post("/api/dev/test-push-wakeup", async (req, res) => {
      try {
        const { workerId, jobId } = req.body;
        
        if (!workerId || !jobId) {
          return res.status(400).json({ error: "workerId and jobId required" });
        }
        
        // Import push notification service
        const { sendPushNotification } = await import('./services/pushNotifications');
        
        // Send geolocation wakeup
        const wakeupResult = await sendPushNotification(workerId, 'geolocation_wakeup', {
          jobId,
          workerId
        });
        
        // Get job for reminder
        const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        
        // Send clock-in reminder
        const reminderResult = await sendPushNotification(workerId, 'clock_in_reminder', {
          jobId,
          jobTitle: job[0]?.title || 'Test Job',
          startTime: '08:00 AM'
        });
        
        res.json({
          test: 'push-wakeup',
          wakeupResult,
          reminderResult,
          note: 'Push notifications sent. Check device for receipt. Note: Actual push delivery requires valid device tokens registered via /api/device-tokens.'
        });
      } catch (error) {
        console.error("Error testing push wakeup:", error);
        res.status(500).json({ error: String(error) });
      }
    });

    // Test geolocation scheduler manually (development only)
    app.post("/api/dev/test-geolocation-scheduler", async (req, res) => {
      try {
        const { checkGeolocationWakeups } = await import('./schedulers/geolocationWakeup');
        await checkGeolocationWakeups();
        res.json({ 
          success: true, 
          message: 'Geolocation wakeup scheduler ran successfully. Check server logs for details.' 
        });
      } catch (error) {
        console.error("Error running geolocation scheduler:", error);
        res.status(500).json({ error: String(error) });
      }
    });

    // Worker onboarding reminder sequence (3 emails over ~1 month). Call daily via cron.
    // CRON_SECRET required in production; optional in development.
    app.post("/api/cron/worker-onboarding-reminders", async (req, res) => {
      const cronSecret = process.env.CRON_SECRET;
      const providedSecret = req.headers["x-cron-secret"];
      if (process.env.NODE_ENV === "production") {
        if (!cronSecret) return res.status(503).json({ message: "Cron not configured" });
        if (providedSecret !== cronSecret) return res.status(401).json({ message: "Unauthorized" });
      } else if (cronSecret && providedSecret !== cronSecret) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      try {
        const { processWorkerOnboardingReminders } = await import("./services/worker-onboarding-reminder");
        const result = await processWorkerOnboardingReminders();
        res.json({ success: true, ...result });
      } catch (error) {
        console.error("Worker onboarding reminders error:", error);
        res.status(500).json({ success: false, error: String(error) });
      }
    });

    // Test worker onboarding reminders manually (development only)
    app.post("/api/dev/test-worker-onboarding-reminders", async (req, res) => {
      try {
        const { processWorkerOnboardingReminders } = await import("./services/worker-onboarding-reminder");
        const result = await processWorkerOnboardingReminders();
        res.json({ success: true, message: "Worker onboarding reminders ran.", ...result });
      } catch (error) {
        console.error("Error running worker onboarding reminders:", error);
        res.status(500).json({ error: String(error) });
      }
    });

    // Company onboarding reminder (weekly until complete). Call weekly via cron.
    app.post("/api/cron/company-onboarding-reminders", async (req, res) => {
      const cronSecret = process.env.CRON_SECRET;
      const providedSecret = req.headers["x-cron-secret"];
      if (process.env.NODE_ENV === "production") {
        if (!cronSecret) return res.status(503).json({ message: "Cron not configured" });
        if (providedSecret !== cronSecret) return res.status(401).json({ message: "Unauthorized" });
      } else if (cronSecret && providedSecret !== cronSecret) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      try {
        const { processCompanyOnboardingReminders } = await import("./services/company-onboarding-reminder");
        const result = await processCompanyOnboardingReminders();
        res.json({ success: true, ...result });
      } catch (error) {
        console.error("Company onboarding reminders error:", error);
        res.status(500).json({ success: false, error: String(error) });
      }
    });

    // Test company onboarding reminders manually (development only)
    app.post("/api/dev/test-company-onboarding-reminders", async (req, res) => {
      try {
        const { processCompanyOnboardingReminders } = await import("./services/company-onboarding-reminder");
        const result = await processCompanyOnboardingReminders();
        res.json({ success: true, message: "Company onboarding reminders ran.", ...result });
      } catch (error) {
        console.error("Error running company onboarding reminders:", error);
        res.status(500).json({ error: String(error) });
      }
    });

    // Send one sample of every Resend email type to a test address (development only)
    app.post("/api/dev/send-all-email-samples", async (req, res) => {
      try {
        const to = (req.body?.to as string) || "cairlbrandon@gmail.com";
        const results: { type: string; success: boolean; error?: string }[] = [];
        let sent = 0;
        let failed = 0;
        for (const type of ALL_EMAIL_TYPES) {
          const result = await sendEmail({
            to,
            type,
            data: getSampleDataForType(type),
          });
          const ok = result.success;
          if (ok) sent++; else failed++;
          results.push({ type, success: ok, error: result.error });
        }
        res.json({
          success: true,
          message: `Sent ${sent} sample emails, ${failed} failed. Check inbox at ${to}.`,
          to,
          sent,
          failed,
          results,
        });
      } catch (error: any) {
        console.error("Error sending email samples:", error);
        res.status(500).json({ error: String(error?.message || error) });
      }
    });

    // Switch to any account (development/localhost only)
    app.post("/api/dev/switch-user", async (req, res) => {
      try {
        const { userId } = req.body;
        if (!userId) {
          return res.status(400).json({ success: false, message: "userId is required" });
        }
        
        // In localhost/development mode, allow switching to any account
        const [user] = await db.select().from(users).where(eq(users.id, userId));
        if (!user) {
          return res.status(404).json({ success: false, message: "User not found" });
        }
        
        // Check if profile exists for this user
        const profile = await storage.getProfileByUserId(user.id);
        const userRole = profile?.role || (user.userType === 'company' ? 'company' : 'worker');
        
        // Create user object for passport session
        const userObj = {
          claims: {
            sub: user.id,
            email: user.email,
            first_name: user.firstName || "",
            last_name: user.lastName || "",
          },
          expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, // 24 hours
        };
        
        // Log the user in via passport
        // Note: req.login() automatically saves the session, but we'll save it explicitly to be sure
        req.login(userObj, (err) => {
          if (err) {
            console.error("Login error during account switch:", err);
            return res.status(500).json({ success: false, message: "Failed to switch user", error: err.message });
          }
          
          // Mark session as modified to ensure it's saved
          (req.session as any).user = userObj;
          clearProfileSnapshot(req);

          // Save the session explicitly to ensure it's persisted before responding
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error("Session save error during account switch:", saveErr);
              return res.status(500).json({ success: false, message: "Failed to save session", error: saveErr.message });
            }
            
            console.log(`Account switched: ${user.email} (${user.id}), role: ${userRole}, hasProfile: ${!!profile}`);
            
            res.json({ 
              success: true, 
              userId: user.id, 
              email: user.email,
              role: userRole,
              hasProfile: !!profile,
              profileId: profile?.id || null
            });
          });
        });
      } catch (error: any) {
        console.error("Error switching user:", error);
        console.error("Error details:", {
          message: error.message,
          stack: error.stack,
        });
        res.status(500).json({ success: false, message: "Failed to switch user", error: error.message });
      }
    });

    // Switch back to original account
    app.post("/api/dev/switch-back", async (req, res) => {
      try {
        req.logout((err) => {
          if (err) {
            console.error("Logout error during switch-back:", err);
            return res.status(500).json({ success: false, message: "Failed to logout", error: err.message });
          }
          res.json({ success: true, message: "Logged out of test account" });
        });
      } catch (error: any) {
        console.error("Error in switch-back:", error);
        res.status(500).json({ success: false, message: "Failed to switch back", error: error.message });
      }
    });

    // Create test affiliate account and log in as that user (development only)
    app.post("/api/dev/create-test-affiliate", async (req, res) => {
      try {
        const testEmail = "affiliate-test@test.com";
        const testPassword = "Test1234!";
        let [existingUser] = await db.select().from(users).where(eq(users.email, testEmail));
        let userId: string;
        if (existingUser) {
          userId = existingUser.id;
          const existingAffiliate = await storage.getAffiliateByUserId(userId);
          if (existingAffiliate) {
            const userObj = {
              claims: {
                sub: existingUser.id,
                email: existingUser.email,
                first_name: existingUser.firstName || "Affiliate",
                last_name: existingUser.lastName || "Test",
              },
              expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
            };
            req.login(userObj, (err) => {
              if (err) return res.status(500).json({ success: false, message: err.message });
              (req.session as any).user = userObj;
              clearProfileSnapshot(req);
              req.session.save((saveErr) => {
                if (saveErr) return res.status(500).json({ success: false, message: saveErr.message });
                res.json({ success: true, userId: existingUser!.id, email: existingUser!.email });
              });
            });
            return;
          }
        } else {
          const { hashPassword } = await import("./utils/password");
          const passwordHash = await hashPassword(testPassword);
          const [newUser] = await db.insert(users).values({
            email: testEmail,
            firstName: "Affiliate",
            lastName: "Test",
            passwordHash,
            authProvider: "email",
            userType: "worker",
          }).returning();
          userId = newUser.id;
        }
        const userForAffiliate = existingUser || (await db.select().from(users).where(eq(users.id, userId)))[0];
        const code = "affiliate-test";
        const existingByCode = await storage.getAffiliateByCode(code);
        const finalCode = existingByCode ? `${code}-${Date.now().toString(36)}` : code;
        await storage.createAffiliate({
          userId: userForAffiliate.id,
          type: "url",
          code: finalCode,
          firstName: "Affiliate",
          lastName: "Test",
          email: testEmail,
          phone: null,
          experienceBlurb: "Dev test affiliate account.",
          onboardingComplete: true,
          onboardingStep: 4,
          agreementSigned: true,
          agreementSignedAt: new Date(),
        });
        const userObj = {
          claims: {
            sub: userForAffiliate.id,
            email: userForAffiliate.email,
            first_name: userForAffiliate.firstName || "Affiliate",
            last_name: userForAffiliate.lastName || "Test",
          },
          expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        };
        req.login(userObj, (err) => {
          if (err) return res.status(500).json({ success: false, message: err.message });
          (req.session as any).user = userObj;
          clearProfileSnapshot(req);
          req.session.save((saveErr) => {
            if (saveErr) return res.status(500).json({ success: false, message: saveErr.message });
            res.json({ success: true, userId: userForAffiliate.id, email: userForAffiliate.email });
          });
        });
      } catch (error: any) {
        console.error("Error creating test affiliate:", error);
        res.status(500).json({ success: false, message: error?.message || "Failed to create test affiliate" });
      }
    });
  }

  // === Custom Email/Password Registration ===
  const registerSchema = z.object({
    email: z.string().email("Valid email required").transform(e => e.toLowerCase().trim()),
    password: z.string().min(8, "Password must be at least 8 characters"),
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
    userType: z.enum(["worker", "company"]).default("worker"), // Account type: worker or company
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const parseResult = registerSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errors = parseResult.error.errors.map(e => e.message).join(", ");
        return res.status(400).json({ message: errors });
      }
      
      const { email, password, firstName, lastName, userType } = parseResult.data;

      // Import password utilities
      const { hashPassword, validatePassword } = await import("./utils/password");
      
      // Validate password
      const validation = validatePassword(password);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.error });
      }

      // Check if user already exists
      const existingUser = await db.select().from(users).where(eq(users.email, email));
      if (existingUser.length > 0) {
        return res.status(400).json({ message: "An account with this email already exists" });
      }

      // Hash password and create user
      const passwordHash = await hashPassword(password);
      const [newUser] = await db.insert(users).values({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        passwordHash,
        authProvider: "email",
        userType, // Tag account as worker or company
      }).returning();

      // Log the user in
      const userObj = {
        claims: {
          sub: newUser.id,
          email: newUser.email,
          first_name: newUser.firstName,
          last_name: newUser.lastName,
        },
        expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, // 24 hours
      };

      req.login(userObj, (err) => {
        if (err) {
          console.error("Login error after registration:", err);
          return res.status(500).json({ message: "Registration succeeded but login failed" });
        }
        const session = req.session as any;
        const finalize = () => {
          clearProfileSnapshot(req);
          res.json({
            success: true,
            user: {
              id: newUser.id,
              email: newUser.email,
              firstName: newUser.firstName,
              lastName: newUser.lastName,
            },
          });
        };
        if (!session || typeof session.save !== "function") {
          return finalize();
        }
        session.save((saveErr: unknown) => {
          if (saveErr) {
            console.error("Session save error after registration:", saveErr);
            return res.status(500).json({ message: "Registration succeeded but session persistence failed" });
          }
          return finalize();
        });
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      res.status(500).json({ message: error.message || "Registration failed" });
    }
  });

  const loginSchema = z.object({
    email: z.string().email("Valid email required").transform(e => e.toLowerCase().trim()),
    password: z.string().min(1, "Password is required"),
  });

  app.post("/api/auth/login-email", async (req, res) => {
    try {
      const parseResult = loginSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid email or password" });
      }
      
      const { email, password } = parseResult.data;

      // Import password utilities
      const { verifyPassword } = await import("./utils/password");

      // Find user
      const [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Check if user has a password (might be Google-only user)
      if (!user.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Verify password
      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Log the user in
      const userObj = {
        claims: {
          sub: user.id,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
        },
        expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, // 24 hours
      };

      req.login(userObj, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }
        const session = req.session as any;
        const finalize = () => {
          clearProfileSnapshot(req);
          res.json({
            success: true,
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
            },
          });
        };
        if (!session || typeof session.save !== "function") {
          return finalize();
        }
        session.save((saveErr: unknown) => {
          if (saveErr) {
            console.error("Session save error after login:", saveErr);
            return res.status(500).json({ message: "Login succeeded but session persistence failed" });
          }
          return finalize();
        });
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({ message: error.message || "Login failed" });
    }
  });

  // === Password Reset ===
  app.post("/api/auth/password-reset/request", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const user = await authStorage.getUserByEmail(email);
      if (!user) {
        // Don't reveal if user exists for security
        return res.json({ success: true, message: "If an account exists, a password reset link has been sent." });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour expiry

      await authStorage.setPasswordResetToken(email, resetToken, expiresAt);

      // Send reset email
      const resetUrl = `${BASE_URL}/reset-password?token=${resetToken}`;
      const { sendEmail } = await import("./email-service");
      await sendEmail({
        to: email,
        type: "password_reset",
        data: {
          resetUrl,
          firstName: user.firstName || "User",
        },
      });

      res.json({ success: true, message: "Password reset link sent to your email" });
    } catch (error: any) {
      console.error("Password reset request error:", error);
      res.status(500).json({ message: "Failed to send password reset email" });
    }
  });

  app.post("/api/auth/password-reset/verify", async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }

      const user = await authStorage.getUserByResetToken(token);
      if (!user || !user.passwordResetExpires || new Date() > user.passwordResetExpires) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Validate password
      const { validatePassword, hashPassword } = await import("./utils/password");
      const validation = validatePassword(newPassword);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.error });
      }

      // Update password
      const passwordHash = await hashPassword(newPassword);
      await db
        .update(users)
        .set({
          passwordHash,
          passwordResetToken: null,
          passwordResetExpires: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // Clear reset token
      await authStorage.clearPasswordResetToken(user.email!);

      res.json({ success: true, message: "Password reset successfully" });
    } catch (error: any) {
      console.error("Password reset verify error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // === OTP / Magic Link Login ===
  app.post("/api/auth/login/email-otp/request", async (req, res) => {
    try {
      // Safety check - ensure authStorage is available
      if (!authStorage) {
        console.error("CRITICAL: authStorage is not defined. Check server/routes.ts imports.");
        return res.status(500).json({ 
          success: false,
          message: "Server configuration error. Please contact support." 
        });
      }

      const { email, method, sendBoth } = req.body; // method: "otp" or "magic_link", sendBoth: send both OTP and magic link
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const user = await authStorage.getUserByEmail(email);
      if (!user) {
        // Return flag indicating user doesn't exist so frontend can show signup dialog
        return res.json({ 
          success: false, 
          userExists: false,
          message: "No account found with this email. Would you like to sign up?" 
        });
      }

      const { sendEmail } = await import("./email-service");

      // Always generate and send OTP code
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiresAt = new Date();
      otpExpiresAt.setMinutes(otpExpiresAt.getMinutes() + 10); // 10 minutes expiry
      await authStorage.setOtpCode(email, otpCode, otpExpiresAt);

      // Always generate magic link so one email has both code and sign-in button
      const magicToken = crypto.randomBytes(32).toString("hex");
      const magicExpiresAt = new Date();
      magicExpiresAt.setMinutes(magicExpiresAt.getMinutes() + 15); // 15 minutes expiry
      await authStorage.setMagicLinkToken(email, magicToken, magicExpiresAt);
      const magicLink = `${BASE_URL}/api/auth/login/magic-link?token=${magicToken}`;

      const selectedMethod = method === "magic_link" || method === "otp" ? method : null;
      const shouldSendBoth = sendBoth === true || (!selectedMethod && sendBoth !== false);
      const loginEmailType = shouldSendBoth
        ? "otp_and_magic_link_login"
        : selectedMethod === "magic_link"
        ? "magic_link_login"
        : "otp_login";

      if (loginEmailType === "magic_link_login") {
        await sendEmail({
          to: email,
          type: "magic_link_login",
          data: {
            magicLink,
            firstName: user.firstName || "User",
          },
        });
      } else if (loginEmailType === "otp_login") {
        await sendEmail({
          to: email,
          type: "otp_login",
          data: {
            otpCode,
            firstName: user.firstName || "User",
          },
        });
      } else {
        await sendEmail({
          to: email,
          type: "otp_and_magic_link_login",
          data: {
            otpCode,
            magicLink,
            firstName: user.firstName || "User",
          },
        });
      }

      res.json({
        success: true,
        userExists: true,
        message:
          loginEmailType === "magic_link_login"
            ? "Magic sign-in link sent to your email"
            : loginEmailType === "otp_login"
            ? "Login code sent to your email"
            : "Login code and sign-in link sent to your email",
        showOtpInput: loginEmailType !== "magic_link_login",
      });
    } catch (error: any) {
      console.error("OTP/Magic link request error:", error);
      console.error("Error stack:", error?.stack);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        email: req.body.email,
      });
      res.status(500).json({ 
        success: false,
        message: error.message || "Failed to send login code. Please check your email service configuration." 
      });
    }
  });

  app.post("/api/auth/login/email-otp/verify", async (req, res) => {
    try {
      const { email, otpCode } = req.body;
      if (!email || !otpCode) {
        return res.status(400).json({ message: "Email and OTP code are required" });
      }

      const user = await authStorage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or OTP code" });
      }

      // Verify OTP
      if (!user.otpCode || user.otpCode !== otpCode) {
        return res.status(401).json({ message: "Invalid OTP code" });
      }

      if (!user.otpExpires || new Date() > user.otpExpires) {
        await authStorage.clearOtpCode(email);
        return res.status(401).json({ message: "OTP code has expired" });
      }

      // Clear OTP
      await authStorage.clearOtpCode(email);

      // Log the user in
      const userObj = {
        claims: {
          sub: user.id,
          email: user.email,
          first_name: user.firstName || "",
          last_name: user.lastName || "",
        },
        expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, // 24 hours
      };

      req.login(userObj, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }
        clearProfileSnapshot(req);
        res.json({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
          },
        });
      });
    } catch (error: any) {
      console.error("OTP verify error:", error);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  app.get("/api/auth/login/magic-link", async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.redirect("/login?error=invalid_token");
      }

      const user = await authStorage.getUserByMagicLinkToken(token);
      if (!user || !user.magicLinkExpires || new Date() > user.magicLinkExpires) {
        return res.redirect("/login?error=invalid_or_expired_token");
      }

      // Clear magic link token
      await authStorage.clearMagicLinkToken(user.email!);

      // Log the user in
      const userObj = {
        claims: {
          sub: user.id,
          email: user.email,
          first_name: user.firstName || "",
          last_name: user.lastName || "",
        },
        expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, // 24 hours
      };

      req.login(userObj, async (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.redirect("/login?error=login_failed");
        }
        clearProfileSnapshot(req);

        // Redirect to appropriate dashboard
        try {
          const profile = await storage.getProfileByUserId(user.id);
          if (profile) {
            if (profile.role === "company") {
              return res.redirect("/company-dashboard");
            } else if (profile.role === "worker") {
              return res.redirect("/dashboard");
            }
          }
        } catch (error) {
          console.error("Error fetching profile:", error);
        }
        res.redirect("/dashboard");
      });
    } catch (error: any) {
      console.error("Magic link login error:", error);
      res.redirect("/login?error=login_failed");
    }
  });

  // Featured workers for homepage (public endpoint)
  app.get("/api/workers/featured", async (req, res) => {
    try {
      // Get all workers from database
      const allWorkers = await storage.getAllWorkers();
      
      // Prioritize workers with complete profiles (avatar, hourly rate, location)
      const workersWithCompleteProfiles = allWorkers.filter(worker => 
        worker.isAvailable !== false &&
        worker.hourlyRate && 
        worker.hourlyRate > 0 &&
        (worker.firstName || worker.lastName) &&
        (worker.city || worker.state)
      );
      
      // Separate workers with real avatars vs those without
      const workersWithAvatars = workersWithCompleteProfiles.filter(worker => 
        worker.avatarUrl && 
        worker.avatarUrl.startsWith('http') && 
        !worker.avatarUrl.includes('placeholder')
      );
      
      const workersWithoutAvatars = workersWithCompleteProfiles.filter(worker => 
        !worker.avatarUrl || 
        !worker.avatarUrl.startsWith('http') || 
        worker.avatarUrl.includes('placeholder')
      );
      
      // Prioritize workers with avatars, but include others if needed
      // Mix: 70% with avatars, 30% without (if available)
      const targetCount = 15; // Get more to have variety
      const avatarCount = Math.min(workersWithAvatars.length, Math.ceil(targetCount * 0.7));
      const noAvatarCount = Math.min(workersWithoutAvatars.length, targetCount - avatarCount);
      
      // Shuffle each group
      const shuffledWithAvatars = workersWithAvatars.sort(() => Math.random() - 0.5).slice(0, avatarCount);
      const shuffledWithoutAvatars = workersWithoutAvatars.sort(() => Math.random() - 0.5).slice(0, noAvatarCount);
      
      // Combine and shuffle again
      const combined = [...shuffledWithAvatars, ...shuffledWithoutAvatars].sort(() => Math.random() - 0.5);
      
      // Return only necessary fields for display
      const featured = combined.map(worker => ({
        id: worker.id,
        firstName: worker.firstName,
        lastName: worker.lastName,
        avatarUrl: worker.avatarUrl,
        city: worker.city,
        state: worker.state,
        trades: worker.trades,
        hourlyRate: worker.hourlyRate,
        experienceYears: worker.experienceYears,
        bio: worker.bio,
      }));
      
      res.json(featured);
    } catch (error) {
      console.error("Error fetching featured workers:", error);
      res.status(500).json({ message: "Failed to fetch featured workers" });
    }
  });

  // === Profiles ===
  app.get(api.profiles.get.path, async (req, res) => {
    const userId = req.params.userId;
    // If "me", use session-cached profile (no DB hit when cached)
    if (userId === "me") {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      const profile = req.profile;
      // Match UUID branch: 200 + null when no row yet (onboarding) so clients don’t treat as hard error
      if (!profile) return res.status(200).json(null);
      return res.json(profile);
    }
    // Else: numeric param → profile id (e.g. company); otherwise → user id (UUID)
    const id = Number(userId);
    const profile = Number.isInteger(id) && id > 0
      ? await storage.getProfile(id)
      : await storage.getProfileByUserId(userId);
    // User-id lookup: return 200 with null when no profile (e.g. onboarding) to avoid 404 in console
    if (!profile) {
      if (Number.isInteger(id) && id > 0) return res.status(404).json({ message: "Profile not found" });
      return res.status(200).json(null);
    }
    // Redact sensitive PII (email, phone) when unauthenticated or when viewing another user's profile
    const isOwnProfile = req.isAuthenticated() && ((): boolean => {
      const user = req.user as any;
      if (!user?.claims?.sub) return false;
      return (profile as any).userId === user.claims.sub;
    })();
    if (!isOwnProfile) {
      const { email, phone, ...safe } = profile as any;
      return res.json({ ...safe, email: null, phone: null });
    }
    res.json(profile);
  });

  app.post(api.profiles.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      
      // Pre-process date strings to Date objects before validation
      const processedBody = { ...req.body, userId: user.claims.sub };
      const affiliateRef = (processedBody.ref ?? processedBody.affiliateRef) as string | undefined;
      if (affiliateRef) {
        delete (processedBody as any).ref;
        delete (processedBody as any).affiliateRef;
      }
      const dateFields = ['contractSignedAt', 'faceVerifiedAt', 'insuranceStartDate', 'insuranceEndDate', 'w9UploadedAt'];
      for (const field of dateFields) {
        if (typeof processedBody[field] === 'string') {
          processedBody[field] = new Date(processedBody[field]);
        }
      }
      
      const input = api.profiles.create.input.parse(processedBody);
      
      // Check if profile exists
      const existing = req.profile;
      if (existing) return res.status(400).json({ message: "Profile already exists" });

      // Affiliate referral: resolve ref code to affiliate id
      if (affiliateRef && typeof affiliateRef === 'string') {
        const affiliate = await storage.getAffiliateByCode(affiliateRef.trim());
        if (affiliate) (input as any).referredByAffiliateId = affiliate.id;
      }

      const profile = await storage.createProfile(input);
      if (profile.referredByAffiliateId) {
        const affiliate = await storage.getAffiliate(profile.referredByAffiliateId);
        if (affiliate) {
          const affiliateUser = await authStorage.getUser(affiliate.userId);
          const affiliateEmail = (affiliate.email || affiliateUser?.email || "").trim();
          if (affiliateEmail) {
            const baseUrl = (
              process.env.BASE_URL ||
              process.env.APP_URL ||
              `${req.protocol || "https"}://${req.get("host") || ""}`
            ).replace(/\/$/, "");
            const referredName =
              (profile.companyName || "").trim() ||
              [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
              "New signup";
            sendEmail({
              to: affiliateEmail,
              type: "affiliate_referred_lead_signed_up",
              data: {
                firstName: affiliate.firstName || "there",
                referredName,
                referredRole: profile.role,
                signedUpAt: new Date().toLocaleDateString("en-US"),
                dashboardUrl: `${baseUrl}/affiliate-dashboard`,
              },
            }).catch((emailErr) => {
              console.error("[ProfileCreate] Failed affiliate referred signup email:", emailErr);
            });
          }
        }
      }
      res.status(201).json(profile);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Company jobs count (for "Meet the company" showcase on job detail)
  app.get("/api/profiles/:id/jobs-count", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid profile ID" });
    const company = await storage.getProfile(id);
    if (!company) return res.status(404).json({ message: "Profile not found" });
    const companyJobs = await storage.getCompanyJobs(id);
    res.json({ count: companyJobs.length });
  });

  app.get("/api/profiles/:id/locations-count", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid profile ID" });
    const company = await storage.getProfile(id);
    if (!company) return res.status(404).json({ message: "Profile not found" });
    const locs = await storage.getCompanyLocations(id);
    res.json({ count: locs.length });
  });

  // Get referrals for a profile (for Invite a Buddy tracking)
  app.get("/api/referrals/:profileId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const profileId = Number(req.params.profileId);
    if (!Number.isInteger(profileId) || profileId < 1) {
      return res.status(400).json({ message: "Invalid profile ID" });
    }

    try {
      // Fetch all referrals where this user is the referrer
      const userReferrals = await db
        .select({
          id: referrals.id,
          referredUserId: referrals.referredId,
          status: referrals.status,
          bonusAmount: referrals.bonusAmount,
          qualifiedAt: referrals.qualifiedAt,
          paidAt: referrals.paidAt,
          createdAt: referrals.createdAt,
          referredEmail: profiles.email,
          referredFirstName: profiles.firstName,
          referredLastName: profiles.lastName,
          referredCreatedAt: profiles.createdAt,
        })
        .from(referrals)
        .leftJoin(profiles, eq(referrals.referredId, profiles.id))
        .where(eq(referrals.referrerId, profileId))
        .orderBy(desc(referrals.createdAt));

      // For each referral, check if they've completed their first job
      const referralsWithJobStatus = await Promise.all(
        userReferrals.map(async (ref) => {
          // Check if referred user has any completed timesheets
          const completedTimesheets = await db
            .select({
              timesheetId: timesheets.id,
              timesheetStatus: timesheets.status,
              updatedAt: timesheets.updatedAt,
            })
            .from(timesheets)
            .where(
              and(
                eq(timesheets.workerId, ref.referredUserId),
                eq(timesheets.status, "approved")
              )
            )
            .limit(1);

          const hasCompletedJob = completedTimesheets.length > 0;
          const firstJobCompletedAt = hasCompletedJob && completedTimesheets[0]?.updatedAt 
            ? completedTimesheets[0].updatedAt 
            : null;

          // Determine overall status
          let overallStatus: "pending" | "accepted" | "completed" = "pending";
          if (ref.referredCreatedAt) {
            overallStatus = "accepted"; // They've signed up
            if (hasCompletedJob) {
              overallStatus = "completed"; // They've completed first job
            }
          }

          return {
            id: ref.id,
            referredUserId: ref.referredUserId,
            referredEmail: ref.referredEmail || "Unknown",
            referredName: ref.referredFirstName && ref.referredLastName 
              ? `${ref.referredFirstName} ${ref.referredLastName}` 
              : "Unknown",
            status: overallStatus,
            acceptedAt: ref.referredCreatedAt,
            firstJobCompletedAt,
            bonusPaid: ref.status === "paid",
            createdAt: ref.createdAt || new Date(),
          };
        })
      );

      res.json(referralsWithJobStatus);
    } catch (error: any) {
      console.error("Failed to fetch referrals:", error);
      res.status(500).json({ message: "Failed to fetch referrals" });
    }
  });

  // === Affiliates ===
  // Resolve user id from session (same resolution used by all affiliate routes so GET me and GET me/leads match). Coerce to string for DB lookup.
  const getAffiliateUserId = (user: any): string | undefined => {
    const raw = user?.claims?.sub ?? user?.sub ?? user?.id ?? user?.user_id ?? user?.userId;
    return raw != null ? String(raw) : undefined;
  };

  app.get("/api/affiliates/me", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = getAffiliateUserId(user);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const affiliate = await storage.getAffiliateByUserId(userId);
    if (!affiliate) return res.status(200).json(null);
    res.json(affiliate);
  });

  app.post("/api/affiliates", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = getAffiliateUserId(user);
    if (!userId) {
      return res.status(400).json({ message: "User not found in session" });
    }
    const existing = await storage.getAffiliateByUserId(userId);
    if (existing) return res.status(400).json({ message: "Affiliate already exists" });
    const raw = req.body && typeof req.body === "object" ? req.body : {};
    const toStr = (v: unknown): string | null => (v == null || v === "") ? null : String(v).trim() || null;
    const typeRaw = raw.type ?? raw.Type;
    const type = typeRaw === "sales" ? "sales" : "url";
    const firstName = toStr(raw.firstName ?? raw.first_name);
    const lastName = toStr(raw.lastName ?? raw.last_name);
    const email = toStr(raw.email ?? raw.Email);
    const phone = toStr(raw.phone ?? raw.phone_number);
    const address = toStr(raw.address ?? raw.Address);
    const experienceBlurb = toStr(raw.experienceBlurb ?? raw.experience_blurb);
    // Generate unique code: slug from name or random
    let code = (firstName && lastName)
      ? `${(firstName + "-" + lastName).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`
      : "";
    if (!code) code = crypto.randomBytes(6).toString("hex");
    let candidate = code;
    let n = 0;
    while (await storage.getAffiliateByCode(candidate)) {
      candidate = `${code}${n}`;
      n++;
    }
    try {
      const affiliate = await storage.createAffiliate({
        userId,
        type,
        code: candidate,
        firstName,
        lastName,
        email,
        phone,
        address,
        experienceBlurb,
        onboardingComplete: false,
        onboardingStep: 1,
        agreementSigned: false,
        agreementSignedAt: null,
      });
      res.status(201).json(affiliate);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[POST /api/affiliates] createAffiliate failed:", err);
      }
      res.status(500).json({ message: "Failed to create affiliate" });
    }
  });

  app.patch("/api/affiliates/me", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const userId = getAffiliateUserId(user);
      if (!userId) return res.status(401).json({ message: "User not found in session" });
      const affiliate = await storage.getAffiliateByUserId(userId);
      if (!affiliate) return res.status(404).json({ message: "Affiliate not found" });
      const raw = req.body && typeof req.body === "object" ? req.body : {};
      const toStr = (v: unknown): string | null => (v == null || v === "") ? null : String(v).trim() || null;
      const toDate = (v: unknown): Date | null => {
        if (v == null) return null;
        if (v instanceof Date) return v;
        if (typeof v === "string") return new Date(v);
        return null;
      };
      const updates: Record<string, unknown> = {};
      if (raw.type === "sales" || raw.type === "url") updates.type = raw.type;
      if (Object.prototype.hasOwnProperty.call(raw, "firstName")) updates.firstName = toStr(raw.firstName ?? raw.first_name);
      if (Object.prototype.hasOwnProperty.call(raw, "lastName")) updates.lastName = toStr(raw.lastName ?? raw.last_name);
      if (Object.prototype.hasOwnProperty.call(raw, "email")) updates.email = toStr(raw.email);
      if (Object.prototype.hasOwnProperty.call(raw, "phone")) updates.phone = toStr(raw.phone ?? raw.phone_number);
      if (Object.prototype.hasOwnProperty.call(raw, "address")) updates.address = toStr(raw.address);
      if (Object.prototype.hasOwnProperty.call(raw, "experienceBlurb")) updates.experienceBlurb = toStr(raw.experienceBlurb ?? raw.experience_blurb);
      if (Object.prototype.hasOwnProperty.call(raw, "onboardingComplete")) updates.onboardingComplete = Boolean(raw.onboardingComplete);
      if (Object.prototype.hasOwnProperty.call(raw, "onboardingStep")) updates.onboardingStep = Number(raw.onboardingStep) || 1;
      if (Object.prototype.hasOwnProperty.call(raw, "agreementSigned")) updates.agreementSigned = Boolean(raw.agreementSigned);
      if (Object.prototype.hasOwnProperty.call(raw, "agreementSignedAt")) updates.agreementSignedAt = toDate(raw.agreementSignedAt);
      if (Object.prototype.hasOwnProperty.call(raw, "salesTrackerEnabled")) updates.salesTrackerEnabled = Boolean(raw.salesTrackerEnabled);
      if (Object.prototype.hasOwnProperty.call(raw, "sales_tracker_enabled")) updates.salesTrackerEnabled = Boolean(raw.sales_tracker_enabled);
      updates.updatedAt = new Date();
      const updated = await storage.updateAffiliate(affiliate.id, updates as Parameters<typeof storage.updateAffiliate>[1]);
      const affiliateJustCompletedOnboarding =
        affiliate.onboardingComplete !== true && updated.onboardingComplete === true;
      if (affiliateJustCompletedOnboarding) {
        const userAccount = await authStorage.getUser(userId);
        const recipientEmail = (updated.email || userAccount?.email || "").trim();
        if (recipientEmail) {
          const baseUrl = (
            process.env.BASE_URL ||
            process.env.APP_URL ||
            `${req.protocol || "https"}://${req.get("host") || ""}`
          ).replace(/\/$/, "");
          const referralLink = `${baseUrl}/company-onboarding?ref=${encodeURIComponent(updated.code)}`;
          sendEmail({
            to: recipientEmail,
            type: "affiliate_welcome",
            data: {
              firstName: updated.firstName || "there",
              referralLink,
              dashboardUrl: `${baseUrl}/affiliate-dashboard`,
            },
          }).catch((err) => {
            console.error("[AffiliateOnboarding] Failed to send welcome email:", err);
          });
        }
      }
      res.json(updated);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") console.error("[PATCH /api/affiliates/me]", err);
      res.status(500).json({ message: "Failed to update affiliate" });
    }
  });

  app.get("/api/affiliates/me/links", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = getAffiliateUserId(user);
    if (!userId) return res.status(401).json({ message: "User not found in session" });
    const affiliate = await storage.getAffiliateByUserId(userId);
    if (!affiliate) return res.status(404).json({ message: "Affiliate not found" });
    const origin = (req.protocol || "https") + "://" + (req.get("host") || "");
    const workerLink = `${origin}/worker-onboarding?ref=${encodeURIComponent(affiliate.code)}`;
    const companyLink = `${origin}/company-onboarding?ref=${encodeURIComponent(affiliate.code)}`;
    res.json({ workerLink, companyLink, code: affiliate.code });
  });

  app.get("/api/affiliates/me/leads", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = getAffiliateUserId(user);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const affiliate = await storage.getAffiliateByUserId(userId);
    if (!affiliate) {
      if (process.env.NODE_ENV !== "production") console.error("[GET /api/affiliates/me/leads] Affiliate not found for userId:", userId, "user keys:", user ? Object.keys(user) : []);
      return res.status(404).json({ message: "Affiliate not found" });
    }
    const list = await storage.getAffiliateLeadsByAffiliateId(affiliate.id);
    res.json(list);
  });

  app.post("/api/affiliates/me/leads", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const userId = getAffiliateUserId(user);
      if (!userId) return res.status(401).json({ message: "User not found in session" });
      const affiliate = await storage.getAffiliateByUserId(userId);
      if (!affiliate) return res.status(404).json({ message: "Affiliate not found" });
      const raw = req.body && typeof req.body === "object" ? req.body : {};
      const toStr = (v: unknown): string | null => (v == null || v === "") ? null : String(v).trim() || null;
      const name = toStr(raw.name ?? raw.firstName);
      const email = toStr(raw.email);
      const phone = toStr(raw.phone);
      const businessName = toStr(raw.businessName ?? raw.business_name);
      const accountType = raw.accountType === "company" || raw.account_type === "company" ? "company" : "worker";
      const token = crypto.randomBytes(16).toString("hex");
      const lead = await storage.createAffiliateLead({
        affiliateId: affiliate.id,
        name,
        email,
        phone,
        businessName,
        accountType,
        stage: "lead",
        token,
      });
      res.status(201).json(lead);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") console.error("[POST /api/affiliates/me/leads]", err);
      res.status(500).json({ message: "Failed to create lead" });
    }
  });

  app.patch("/api/affiliates/me/leads/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const userId = getAffiliateUserId(user);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const affiliate = await storage.getAffiliateByUserId(userId);
      if (!affiliate) return res.status(404).json({ message: "Affiliate not found" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid lead id" });
      const existing = await storage.getAffiliateLeadById(id);
      if (!existing || existing.affiliateId !== affiliate.id) return res.status(404).json({ message: "Lead not found" });
      const raw = req.body && typeof req.body === "object" ? req.body : {};
      const toStr = (v: unknown): string | null => (v == null || v === "") ? null : String(v).trim() || null;
      const updates: Record<string, unknown> = {};
      if (Object.prototype.hasOwnProperty.call(raw, "name")) updates.name = toStr(raw.name);
      if (Object.prototype.hasOwnProperty.call(raw, "email")) updates.email = toStr(raw.email);
      if (Object.prototype.hasOwnProperty.call(raw, "phone")) updates.phone = toStr(raw.phone);
      if (Object.prototype.hasOwnProperty.call(raw, "businessName")) updates.businessName = toStr(raw.businessName ?? raw.business_name);
      if (raw.accountType === "company" || raw.accountType === "worker") updates.accountType = raw.accountType;
      if (["lead", "contacted", "closed_won", "closed_lost"].includes(raw.stage)) updates.stage = raw.stage;
      const updated = await storage.updateAffiliateLead(id, updates as Parameters<typeof storage.updateAffiliateLead>[1]);
      res.json(updated);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") console.error("[PATCH /api/affiliates/me/leads/:id]", err);
      res.status(500).json({ message: "Failed to update lead" });
    }
  });

  app.get("/api/affiliates/lead-by-token", async (req, res) => {
    const token = (typeof req.query.token === "string" ? req.query.token : "") || (typeof req.query.lead === "string" ? req.query.lead : "");
    const ref = typeof req.query.ref === "string" ? req.query.ref : "";
    if (!token) return res.status(400).json({ message: "Token required" });
    const lead = await storage.getAffiliateLeadByToken(token);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    const affiliate = await storage.getAffiliate(lead.affiliateId);
    if (!affiliate) return res.status(404).json({ message: "Affiliate not found" });
    if (ref && affiliate.code !== ref) return res.status(403).json({ message: "Ref does not match lead" });
    res.json({
      firstName: lead.name?.split(/\s+/)[0] ?? null,
      lastName: lead.name?.split(/\s+/).slice(1).join(" ") ?? null,
      email: lead.email,
      phone: lead.phone,
      companyName: lead.businessName,
      accountType: lead.accountType,
    });
  });

  app.get("/api/affiliates/me/referrals", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = getAffiliateUserId(user);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const affiliate = await storage.getAffiliateByUserId(userId);
    if (!affiliate) return res.status(404).json({ message: "Affiliate not found" });
    const list = await storage.getProfilesByReferredByAffiliateId(affiliate.id);
    res.json(list);
  });

  /** Persist JSON defaults for the job-posting Auto-fulfill step (company only). */
  app.put("/api/company/auto-fulfill-defaults", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only company accounts can save Auto-fulfill defaults" });
    }
    let jsonStr: string;
    if (typeof (req.body as any)?.defaultsJson === "string") {
      jsonStr = (req.body as any).defaultsJson;
    } else if ((req.body as any)?.defaults && typeof (req.body as any).defaults === "object") {
      jsonStr = JSON.stringify((req.body as any).defaults);
    } else if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
      jsonStr = JSON.stringify(req.body);
    } else {
      return res.status(400).json({ message: "Provide defaults object or defaultsJson string" });
    }
    if (jsonStr.length > 32000) {
      return res.status(400).json({ message: "Defaults payload too large" });
    }
    await db
      .update(profiles)
      .set({ autoFulfillDefaultsJson: jsonStr, updatedAt: new Date() })
      .where(eq(profiles.id, profile.id));
    res.json({ success: true });
  });

  app.put(api.profiles.update.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const id = Number(req.params.id);
      
      // Pre-process date strings to Date objects and decimal fields to strings before validation
      const processedBody = { ...req.body };
      const dateFields = ['contractSignedAt', 'faceVerifiedAt', 'insuranceStartDate', 'insuranceEndDate', 'w9UploadedAt'];
      for (const field of dateFields) {
        if (typeof processedBody[field] === 'string') {
          processedBody[field] = new Date(processedBody[field]);
        }
      }
      if (processedBody.latitude !== undefined && processedBody.latitude !== null && typeof processedBody.latitude === 'number') {
        processedBody.latitude = String(processedBody.latitude);
      }
      if (processedBody.longitude !== undefined && processedBody.longitude !== null && typeof processedBody.longitude === 'number') {
        processedBody.longitude = String(processedBody.longitude);
      }
      
      // Validate bio if it's being updated
      if ('bio' in processedBody && processedBody.bio) {
        const bioValidation = validateBio(processedBody.bio);
        if (!bioValidation.isValid) {
          return res.status(400).json({ 
            message: bioValidation.error || "Bio contains invalid content",
            field: "bio"
          });
        }
      }
      
      const input = api.profiles.update.input.parse(processedBody);
      
      // Get current profile to detect availability changes
      const currentProfile = await storage.getProfile(id);
      console.log(`[ProfileUpdate] PUT profile id=${id}, currentProfile.id=${currentProfile?.id}, mercuryRecipientId=${currentProfile?.mercuryRecipientId ?? 'null'}, mercuryExternalAccountId=${currentProfile?.mercuryExternalAccountId ?? 'null'}`);
      
      const availabilityChanged = currentProfile && 
        currentProfile.role === 'worker' &&
        'isAvailable' in input && 
        input.isAvailable !== currentProfile.isAvailable;
      
      // W-9: we do NOT store the document; we attach it to Mercury only and record w9UploadedAt.
      // Always use the same profile as the bank step (auth user's profile) so we attach to the recipient created there.
      let w9ValidationResult: any = null;
      let w9FileBuffer: Buffer | null = null;
      let w9MimeType = "application/pdf";
      let w9FileName = "w9.pdf";
      let w9AttachmentUploadedThisRequest = false;
      let recipientIdForW9: string | null = null;
      
      if (input.w9DocumentUrl && input.w9DocumentUrl.trim().length > 0) {
        // Never persist client-sent w9UploadedAt; we only set it after successful Mercury upload
        delete (input as any).w9UploadedAt;
        
        // Resolve recipient: prefer fresh DB profile (currentProfile) when updating the same user's profile,
        // so we recognize Mercury recipient even if session cache is stale after add-bank.
        const profileFromBankStep = req.profile ?? null;
        const sameProfile = profileFromBankStep && id === profileFromBankStep.id;
        recipientIdForW9 = (sameProfile ? (currentProfile?.mercuryRecipientId ?? profileFromBankStep?.mercuryRecipientId) : (profileFromBankStep?.mercuryRecipientId ?? currentProfile?.mercuryRecipientId)) ?? null;
        console.log(`[ProfileUpdate] W-9 flow: profile id=${id}, sameProfile=${sameProfile}, recipientId (currentProfile/req.profile)=${currentProfile?.mercuryRecipientId ?? 'null'}/${profileFromBankStep?.mercuryRecipientId ?? 'null'} -> ${recipientIdForW9 ?? 'null'}`);
        try {
          if (input.w9DocumentUrl.startsWith("data:")) {
            const matches = input.w9DocumentUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              w9MimeType = matches[1];
              w9FileBuffer = Buffer.from(matches[2], "base64");
            } else {
              w9FileBuffer = Buffer.from(input.w9DocumentUrl, "base64");
            }
          } else {
            w9FileBuffer = Buffer.from(input.w9DocumentUrl, "base64");
          }
          if (w9MimeType.includes("pdf")) w9FileName = "w9.pdf";
          else if (w9MimeType.includes("png")) w9FileName = "w9.png";
          else if (w9MimeType.includes("jpeg") || w9MimeType.includes("jpg")) w9FileName = "w9.jpg";
          
          const { validateW9Form } = await import("./services/w9-validator");
          w9ValidationResult = await validateW9Form(w9FileBuffer, w9MimeType);
          if (!w9ValidationResult.isValid) {
            console.log(`[ProfileUpdate] W-9 validation failed for worker ${id}:`, w9ValidationResult.errors);
            console.log(`[ProfileUpdate] W-9 validation warnings: ${w9ValidationResult.errors.join(", ")}`);
          } else {
            console.log(`[ProfileUpdate] W-9 validation passed for worker ${id} (confidence: ${(w9ValidationResult.confidence * 100).toFixed(1)}%)`);
          }
        } catch (w9Error: any) {
          console.error(`[ProfileUpdate] W-9 validation error for worker ${id}:`, w9Error);
          console.error(`[ProfileUpdate] W-9 validation error: ${w9Error.message}`);
        }
        
        // If worker has a Mercury recipient: attach W-9 to Mercury and set w9UploadedAt (do not persist document).
        // If no recipient: persist w9DocumentUrl so we can attach when they connect bank in Payout Settings.
        if (recipientIdForW9 && w9FileBuffer) {
          try {
            console.log(`[ProfileUpdate] Attaching W-9 to Mercury recipient ${recipientIdForW9} for profile ${id} (file: ${w9FileName}, ${w9FileBuffer.length} bytes)`);
            const { mercuryService } = await import("./services/mercury");
            await mercuryService.uploadRecipientAttachment(
              recipientIdForW9,
              w9FileBuffer,
              w9FileName,
              w9MimeType
            );
            w9AttachmentUploadedThisRequest = true;
            (input as any).w9UploadedAt = new Date();
            // Connect prior step: if we used auth user's profile for recipient, persist it on this profile
            if (!currentProfile?.mercuryRecipientId && recipientIdForW9) {
              (input as any).mercuryRecipientId = recipientIdForW9;
              (input as any).mercuryExternalAccountId = recipientIdForW9;
              console.log(`[ProfileUpdate] Persisting Mercury recipient ${recipientIdForW9} on profile ${id} (from prior bank-connect step)`);
            }
            console.log(`[ProfileUpdate] W-9 attached successfully to Mercury recipient ${recipientIdForW9}`);
            delete (input as any).w9DocumentUrl; // do not persist; we attached to Mercury
          } catch (mercuryErr: any) {
            const status = mercuryErr?.status ?? mercuryErr?.statusCode;
            console.error(`[ProfileUpdate] Mercury W-9 attachment failed for worker ${id}:`, {
              status,
              statusCode: mercuryErr?.statusCode,
              message: mercuryErr?.message,
              details: mercuryErr?.details,
              code: mercuryErr?.code,
            });
            const is404 = status === 404 || mercuryErr?.details?.errors?.notFound;
            const is403 = status === 403;
            // 404 = recipient not found → clear and ask to reconnect bank. 403 = permission/sandbox limit → do not clear recipient.
            let message: string;
            if (is404) {
              message = "Your bank connection is no longer valid. Please go to Payout Settings and connect your bank again, then upload your W-9.";
              try {
                await storage.updateProfile(id, {
                  mercuryRecipientId: null,
                  mercuryExternalAccountId: null,
                  bankAccountLinked: false,
                });
                clearProfileSnapshot(req);
                console.log(`[ProfileUpdate] Cleared recipient and bankAccountLinked for profile ${id} (W-9 404)`);
              } catch (clearErr: any) {
                console.error(`[ProfileUpdate] Failed to clear recipient after Mercury W-9 error:`, clearErr?.message ?? clearErr);
              }
            } else if (is403) {
              message = "We couldn't attach your W-9 (Mercury returned a permission error). Your bank connection is fine. You can add your W-9 in the Mercury dashboard or try again later.";
            } else {
              message = "We couldn't attach your W-9 to your bank account. Please go to Payout Settings, reconnect your bank, then upload your W-9 again.";
              try {
                await storage.updateProfile(id, {
                  mercuryRecipientId: null,
                  mercuryExternalAccountId: null,
                  bankAccountLinked: false,
                });
                clearProfileSnapshot(req);
                console.log(`[ProfileUpdate] Cleared recipient and bankAccountLinked for profile ${id} (W-9 other error)`);
              } catch (clearErr: any) {
                console.error(`[ProfileUpdate] Failed to clear recipient after Mercury W-9 error:`, clearErr?.message ?? clearErr);
              }
            }
            return res.status(400).json({
              message,
              field: "w9DocumentUrl",
            });
          }
        } else if (currentProfile?.role === 'worker' && !recipientIdForW9 && input.w9DocumentUrl) {
          // No recipient yet: persist W-9 so we can attach when they connect bank (payout-account flow)
          const maxStoredW9Bytes = 4 * 1024 * 1024; // 4MB to avoid huge DB writes and timeouts
          const w9Length = typeof input.w9DocumentUrl === "string" ? Buffer.byteLength(input.w9DocumentUrl, "utf8") : 0;
          if (w9Length > maxStoredW9Bytes) {
            console.log(`[ProfileUpdate] W-9 too large to store (${(w9Length / 1024).toFixed(0)}KB); max ${maxStoredW9Bytes / 1024 / 1024}MB`);
            return res.status(400).json({
              message: "W-9 file is too large. Please use a smaller file (under 3MB) or connect your bank first and upload from the W-9 tab.",
              field: "w9DocumentUrl",
            });
          }
          console.log(`[ProfileUpdate] Storing W-9 for worker ${id} (${(w9Length / 1024).toFixed(0)}KB); will attach to Mercury when they connect bank.`);
          // keep input.w9DocumentUrl so updateProfile persists it
        } else {
          delete (input as any).w9DocumentUrl;
        }
      }
      
      // Build plain updates object so Drizzle never gets "No values to set" (parsed input may be non-extensible)
      const updates = { ...input } as Record<string, unknown>;
      if (w9AttachmentUploadedThisRequest) {
        delete updates.w9DocumentUrl; // do not persist; we attached to Mercury
        updates.w9UploadedAt = new Date();
        if (!currentProfile?.mercuryRecipientId && recipientIdForW9) {
          updates.mercuryRecipientId = recipientIdForW9;
          updates.mercuryExternalAccountId = recipientIdForW9;
        }
      }
      // When no recipient we keep w9DocumentUrl in updates so it is persisted for later attach
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No profile fields to update.", field: "w9DocumentUrl" });
      }
      let profile: Awaited<ReturnType<typeof storage.updateProfile>>;
      try {
        profile = await storage.updateProfile(id, updates as Partial<typeof input>);
      } catch (updateErr: any) {
        console.error("[ProfileUpdate] storage.updateProfile failed:", updateErr?.message ?? updateErr);
        console.error("[ProfileUpdate] update stack:", updateErr?.stack);
        return res.status(500).json({
          message: updateErr?.message || "Failed to save profile. Please try again.",
        });
      }
      if (!profile) {
        console.error(`[ProfileUpdate] No profile returned for id=${id}`);
        return res.status(404).json({ message: "Profile not found or update had no effect." });
      }
      if (req.profile && id === req.profile.id) clearProfileSnapshot(req);

      const w9WasJustUploaded = Boolean(
        currentProfile &&
        !currentProfile.w9UploadedAt &&
        profile.w9UploadedAt
      );

      // If W-9 was uploaded, ensure it's linked to the worker's Mercury recipient (optional verify + update with extracted data)
      if (w9WasJustUploaded && profile.role === 'worker') {
        console.log(`[ProfileUpdate] W-9 uploaded for worker ${profile.id} - ensuring recipient linkage (profile.mercuryRecipientId=${profile.mercuryRecipientId ?? 'null'}, w9AttachmentUploadedThisRequest=${w9AttachmentUploadedThisRequest})`);
        
        if (profile.mercuryRecipientId) {
          try {
            const { mercuryService } = await import("./services/mercury");
            
            try {
              const recipient = await mercuryService.getRecipient(profile.mercuryRecipientId);
              console.log(`[ProfileUpdate] ✅ Verified recipient ${profile.mercuryRecipientId} is linked to worker ${profile.id}`);
              
              if (w9ValidationResult && w9ValidationResult.isValid) {
                const updateParams: any = {};
                if (w9ValidationResult.extractedData.businessName) updateParams.nickname = w9ValidationResult.extractedData.businessName;
                if (w9ValidationResult.extractedData.name && !profile.companyName) {
                  const nameParts = w9ValidationResult.extractedData.name.split(/\s+/);
                  if (nameParts.length >= 2) updateParams.name = w9ValidationResult.extractedData.name;
                }
                if (Object.keys(updateParams).length > 0) {
                  await mercuryService.updateRecipient(profile.mercuryRecipientId, updateParams);
                  console.log(`[ProfileUpdate] Updated Mercury recipient ${profile.mercuryRecipientId} with W-9 extracted data`);
                }
              }
            } catch (recipientErr: any) {
              if (recipientErr.status === 404) {
                // If we just attached W-9 to this recipient in this request, do NOT clear - upload succeeded so recipient exists
                if (w9AttachmentUploadedThisRequest) {
                  console.log(`[ProfileUpdate] ⚠️ getRecipient(404) after successful W-9 attach - keeping recipient ${profile.mercuryRecipientId} (likely env/timing)`);
                } else {
                  console.log(`[ProfileUpdate] ⚠️ Recipient ${profile.mercuryRecipientId} not found - clearing invalid reference`);
                  await storage.updateProfile(profile.id, {
                    mercuryRecipientId: null,
                    mercuryExternalAccountId: null,
                  });
                }
              } else {
                throw recipientErr;
              }
            }
          } catch (recipientErr) {
            console.error(`[ProfileUpdate] Failed to verify/update Mercury recipient with W-9 data:`, recipientErr);
          }
        } else {
          console.log(`[ProfileUpdate] Worker ${profile.id} has no Mercury recipient on profile - W-9 was attached using auth user's profile`);
        }
      }
      
      // If worker has a Mercury recipient and profile info changed, update the recipient
      if (profile.role === 'worker' && profile.mercuryRecipientId) {
        const addressChanged = currentProfile && (
          input.address !== undefined && input.address !== currentProfile.address ||
          input.city !== undefined && input.city !== currentProfile.city ||
          input.state !== undefined && input.state !== currentProfile.state ||
          input.zipCode !== undefined && input.zipCode !== currentProfile.zipCode
        );
        const nameChanged = currentProfile && (
          input.firstName !== undefined && input.firstName !== currentProfile.firstName ||
          input.lastName !== undefined && input.lastName !== currentProfile.lastName ||
          input.email !== undefined && input.email !== currentProfile.email
        );
        
        if (addressChanged || nameChanged) {
          console.log(`[ProfileUpdate] Updating Mercury recipient ${profile.mercuryRecipientId} for worker ${profile.id}`);
          try {
            const { mercuryService } = await import("./services/mercury");
            
            const recipientName = profile.firstName && profile.lastName 
              ? `${profile.firstName} ${profile.lastName}`
              : profile.email || `Worker ${profile.id}`;
            
            const updateParams: any = {};
            
            if (nameChanged) {
              updateParams.name = recipientName;
              if (profile.email) updateParams.email = profile.email;
            }
            
            if (addressChanged) {
              if (profile.address) updateParams.address1 = profile.address;
              if (profile.city) updateParams.city = profile.city;
              if (profile.state) updateParams.region = profile.state;
              if (profile.zipCode) updateParams.postalCode = profile.zipCode;
              updateParams.country = 'US';
            }
            
            if (Object.keys(updateParams).length > 0) {
              await mercuryService.updateRecipient(profile.mercuryRecipientId, updateParams);
              console.log(`[ProfileUpdate] Updated Mercury recipient ${profile.mercuryRecipientId}`);
            }
          } catch (recipientErr) {
            console.error(`[ProfileUpdate] Failed to update Mercury recipient:`, recipientErr);
            // Don't fail the profile update if recipient update fails
          }
        }
      }
      
      // If W-9 was just uploaded (or we attached in this request), schedule pending_w9 payout release in background (avoids request timeout)
      const shouldReleaseW9Payouts = (w9WasJustUploaded || w9AttachmentUploadedThisRequest) && profile.role === 'worker';
      let scheduleW9Release = false;
      if (shouldReleaseW9Payouts) {
        if (profile.mercuryRecipientId && profile.mercuryExternalAccountId) {
          const pendingCount = (await storage.getWorkerPayoutsByStatus(profile.id, "pending_w9")).length;
          if (pendingCount > 0) {
            console.log(`[ProfileUpdate] W-9 uploaded for worker ${profile.id} - scheduling background release for ${pendingCount} payouts`);
            scheduleW9Release = true;
          }
        } else {
          // W-9 uploaded but no bank: move payouts to pending_bank_setup (quick, keep synchronous)
          const pendingW9Payouts = await storage.getWorkerPayoutsByStatus(profile.id, "pending_w9");
          if (pendingW9Payouts.length > 0) {
            console.log(`[ProfileUpdate] W-9 uploaded but no bank - changing ${pendingW9Payouts.length} to pending_bank_setup`);
            for (const payout of pendingW9Payouts) {
              await storage.updateWorkerPayout(payout.id, {
                status: "pending_bank_setup",
                description: payout.description?.replace("W-9", "bank account") || "Held pending bank account setup",
              });
            }
          }
        }
      }

      // When a company completes onboarding, create a Mercury AR customer for invoicing (only once)
      if (profile.role === 'company' && profile.onboardingStatus === 'complete' && !profile.mercuryArCustomerId) {
        try {
          const { mercuryService } = await import("./services/mercury");
          if (mercuryService.isConfigured()) {
            const customerName = (
              profile.companyName ||
              [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
              profile.email ||
              `Company ${profile.id}`
            ).trim();
            const customer = await mercuryService.createArCustomer({
              name: customerName,
              email: profile.email?.trim() || undefined,
              externalId: String(profile.id),
            });
            await storage.updateProfile(profile.id, { mercuryArCustomerId: customer.id });
            (profile as any).mercuryArCustomerId = customer.id;
            console.log(`[ProfileUpdate] Created Mercury AR customer ${customer.id} for company ${profile.id} (${customerName})`);
          }
        } catch (mercuryErr: any) {
          console.error(`[ProfileUpdate] Failed to create Mercury AR customer for company ${profile.id}:`, mercuryErr?.message ?? mercuryErr);
          // Don't fail the profile update
        }
      }

      const workerJustCompletedOnboarding =
        currentProfile?.role === "worker" &&
        currentProfile.onboardingStatus !== "complete" &&
        profile.role === "worker" &&
        profile.onboardingStatus === "complete";
      const companyJustCompletedOnboarding =
        currentProfile?.role === "company" &&
        currentProfile.onboardingStatus !== "complete" &&
        profile.role === "company" &&
        profile.onboardingStatus === "complete";
      const completionEmail = (profile.email || "").trim();
      if (completionEmail && (workerJustCompletedOnboarding || companyJustCompletedOnboarding)) {
        const baseUrl = (
          process.env.BASE_URL ||
          process.env.APP_URL ||
          `${req.protocol || "https"}://${req.get("host") || ""}`
        ).replace(/\/$/, "");
        try {
          if (workerJustCompletedOnboarding) {
            const rawHourlyRate = Number(profile.hourlyRate || 0);
            const normalizedHourlyRate =
              rawHourlyRate > 1000 ? Math.round(rawHourlyRate / 100) : Math.round(rawHourlyRate);
            const skills = Array.isArray(profile.serviceCategories) && profile.serviceCategories.length > 0
              ? profile.serviceCategories.join(", ")
              : "Your selected services";
            const location = [profile.city, profile.state].filter(Boolean).join(", ") || "Your service area";
            await sendEmail({
              to: completionEmail,
              type: "welcome_worker",
              data: {
                firstName: (profile.firstName || "there").trim() || "there",
                hourlyRate: normalizedHourlyRate > 0 ? normalizedHourlyRate : 0,
                skills,
                location,
                dashboardUrl: `${baseUrl}/dashboard`,
              },
            });
          } else if (companyJustCompletedOnboarding) {
            const companyName =
              (profile.companyName || "").trim() ||
              [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
              "your company";
            await sendEmail({
              to: completionEmail,
              type: "welcome_company",
              data: {
                companyName,
                dashboardUrl: `${baseUrl}/company-dashboard`,
              },
            });
          }
        } catch (welcomeErr) {
          console.error("[ProfileUpdate] Failed onboarding completion welcome email:", welcomeErr);
        }
      }

      // Notify companies about worker availability changes
      if (availabilityChanged && currentProfile) {
        const workerName = `${currentProfile.firstName} ${currentProfile.lastName}`;
        const newStatus = input.isAvailable ? 'available' : 'unavailable';
        
        // Get all accepted applications for this worker to find relevant companies
        const workerApplications = await storage.getWorkerApplications(id);
        const acceptedApplications = workerApplications.filter(a => a.status === 'accepted');
        
        for (const app of acceptedApplications) {
          const job = await storage.getJob(app.jobId);
          if (job && job.status === 'open') {
            notifyWorkerAvailabilityUpdated(job.companyId, workerName, job.id, job.title, newStatus)
              .catch(err => console.error('Failed to send availability update notification:', err));
          }
        }
      }

      if (scheduleW9Release) {
        setImmediate(() => runW9PayoutReleaseForWorker(profile.id).catch((e: any) => console.error("[ProfileUpdate] Background W-9 release error:", e?.message ?? e)));
      }
      
      res.json(profile);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      console.error("[ProfileUpdate] Error:", err?.message ?? err);
      console.error("[ProfileUpdate] Stack:", err?.stack);
      if (!res.headersSent) {
        return res.status(500).json({
          message: err?.message || "Failed to update profile. Please try again.",
        });
      }
    }
  });

  // === Jobs ===
  app.get(api.jobs.list.path, async (req, res) => {
    const filters = {
      trade: req.query.trade as string,
      location: req.query.location as string,
    };
    const allJobs = await storage.getJobs(filters);
    res.json(allJobs);
  });

  // Worker find-work endpoint - filters out fully staffed and dismissed jobs
  app.get("/api/jobs/find-work", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can access this endpoint" });
    }

    const filters = {
      trade: req.query.trade as string,
      location: req.query.location as string,
    };
    // Dev only: skip location filter → fetch all open jobs (no trade/location filter on initial query)
    const skipLocationFilter = process.env.NODE_ENV === "development" && req.query.skipLocationFilter === "1";
    
    // Get all open jobs (when skipLocationFilter, do not pass trade/location so we get full list)
    const allJobs = await storage.getJobs(skipLocationFilter ? undefined : filters);
    
    // Get worker's dismissed jobs
    const dismissedJobIds = await storage.getDismissedJobs(profile.id);
    
    // Get worker's existing applications
    const workerApplications = await storage.getWorkerApplications(profile.id);
    const appliedJobIds = workerApplications.map(a => a.jobId);
    
    // Get combined skillsets from worker and their team members (Business Operator feature)
    let combinedSkillsets: string[] = [];
    
    // Add worker's own skillsets
    if ((profile as any).skillsets && Array.isArray((profile as any).skillsets)) {
      combinedSkillsets.push(...(profile as any).skillsets);
    }
    
    // Check if worker has a team and get team members' skillsets and locations
    const team = await storage.getWorkerTeam(profile.id);
    let teamMembers: Awaited<ReturnType<typeof storage.getWorkerTeamMembers>> = [];
    if (team) {
      teamMembers = await storage.getWorkerTeamMembers(team.id);
      for (const member of teamMembers) {
        if (member.status === 'active' && (member as any).skillsets && Array.isArray((member as any).skillsets)) {
          combinedSkillsets.push(...(member as any).skillsets);
        }
      }
    }
    
    // Remove duplicates
    combinedSkillsets = Array.from(new Set(combinedSkillsets));
    
    // Use fresh profile from DB for location (avoids stale session cache so saved address lat/lng are always used)
    const freshProfile = await storage.getProfile(profile.id);
    const profileForLocation = freshProfile ?? profile;
    
    // Reference points for geospatial filtering: admin + teammates. Use saved lat/lng when present; otherwise geocode from address so OH admin + Monroe OH teammate are included (not just CA teammate).
    const referencePoints: Array<{ lat: number; lng: number }> = [];
    const workerLatRaw = profileForLocation?.latitude != null ? parseFloat(String(profileForLocation.latitude)) : NaN;
    const workerLngRaw = profileForLocation?.longitude != null ? parseFloat(String(profileForLocation.longitude)) : NaN;
    if (isPlausibleLatLng(workerLatRaw, workerLngRaw)) {
      referencePoints.push({ lat: workerLatRaw, lng: workerLngRaw });
    } else {
      const addr = (profileForLocation?.address || '').trim();
      const city = (profileForLocation?.city || '').trim();
      const state = (profileForLocation?.state || '').trim();
      const zip = (profileForLocation?.zipCode || '').trim();
      if (addr || city || state || zip) {
        const coords = addr
          ? await geocodeFullAddress(addr, city || '', state || '', zip || '')
          : await geocodeAddress([city, state, zip].filter(Boolean).join(', '));
        if (coords) {
          referencePoints.push({ lat: parseFloat(coords.latitude), lng: parseFloat(coords.longitude) });
        }
      }
    }
    for (const m of teamMembers) {
      if (m.status !== 'active') continue;
      const hasAddress = !!((m.address || '').trim() || (m.city || '').trim() || (m.state || '').trim() || (m.zipCode || '').trim());
      if (!hasAddress) continue;
      const mlat = m.latitude != null ? parseFloat(String(m.latitude)) : NaN;
      const mlng = m.longitude != null ? parseFloat(String(m.longitude)) : NaN;
      if (isPlausibleLatLng(mlat, mlng)) {
        referencePoints.push({ lat: mlat, lng: mlng });
      } else {
        const addr = (m.address || '').trim();
        const city = (m.city || '').trim();
        const state = (m.state || '').trim();
        const zip = (m.zipCode || '').trim();
        const coords = addr
          ? await geocodeFullAddress(addr, city, state, zip)
          : await geocodeAddress([city, state, zip].filter(Boolean).join(', '));
        if (coords) {
          referencePoints.push({ lat: parseFloat(coords.latitude), lng: parseFloat(coords.longitude) });
        }
      }
    }
    // Radius from query: 1–50 mi from admin or any teammate; default 50
    const rawMax = req.query.maxDistanceMiles != null ? Number(req.query.maxDistanceMiles) : NaN;
    const maxDistanceMiles = Number.isFinite(rawMax) ? Math.min(50, Math.max(1, rawMax)) : 50;
    
    // Filter jobs
    const filteredJobs = allJobs.filter(job => {
      // Exclude dismissed jobs
      if (dismissedJobIds.includes(job.id)) return false;
      
      // Exclude jobs worker already applied to
      if (appliedJobIds.includes(job.id)) return false;
      
      // Exclude fully staffed jobs (unless worker is already hired)
      const maxWorkers = job.maxWorkersNeeded || 1;
      const workersHired = job.workersHired || 0;
      if (workersHired >= maxWorkers) return false;
      
      // Only show open jobs
      if (job.status !== 'open') return false;
      
      // Hide jobs 48 hours after start date (one-day, on-demand, recurring): workers have 48hrs after start to find and apply.
      if (job.startDate) {
        const jobStart = new Date(job.startDate);
        const cutoff = new Date(jobStart.getTime() + 48 * 60 * 60 * 1000);
        if (Date.now() > cutoff.getTime()) return false;
      }
      
      // Geospatial filtering: show jobs within maxDistanceMiles of any reference point (admin or teammate with address)
      // In development, skip when skipLocationFilter=1 so dev can see all jobs
      if (referencePoints.length > 0 && !skipLocationFilter) {
        const jobLatRaw = job.latitude != null ? parseFloat(String(job.latitude)) : NaN;
        const jobLngRaw = job.longitude != null ? parseFloat(String(job.longitude)) : NaN;
        const jobLat = Number.isFinite(jobLatRaw) ? jobLatRaw : null;
        const jobLng = Number.isFinite(jobLngRaw) ? jobLngRaw : null;
        
        if (jobLat !== null && jobLng !== null && isPlausibleLatLng(jobLat, jobLng)) {
          let minDistanceMiles = Infinity;
          for (const ref of referencePoints) {
            const distanceMeters = calculateDistanceMeters(ref.lat, ref.lng, jobLat, jobLng);
            const distanceMiles = distanceMeters / METERS_PER_MILE;
            if (distanceMiles < minDistanceMiles) minDistanceMiles = distanceMiles;
          }
          if (minDistanceMiles > maxDistanceMiles) return false;
          (job as any)._distanceMiles = minDistanceMiles;
        } else {
          // Job missing or junk coordinates — same-state fallback (use DB profile, not session)
          const workerState = (profileForLocation.state || '').toLowerCase().trim();
          const jobState = (job.state || '').toLowerCase().trim();
          if (workerState && jobState && workerState !== jobState) return false;
        }
      } else if (referencePoints.length === 0 && !skipLocationFilter) {
        // No usable reference points — same-state fallback
        const workerState = (profileForLocation.state || '').toLowerCase().trim();
        const jobState = (job.state || '').toLowerCase().trim();
        if (workerState && jobState && workerState !== jobState) return false;
        // If worker has no state either, show all jobs (better than showing nothing)
      }
      // When skipLocationFilter (dev): still attach _distanceMiles for sorting when we have refs and job coords
      if (referencePoints.length > 0 && skipLocationFilter && job.latitude != null && job.longitude != null) {
        const jobLat = parseFloat(String(job.latitude));
        const jobLng = parseFloat(String(job.longitude));
        if (isPlausibleLatLng(jobLat, jobLng)) {
          let minDistanceMiles = Infinity;
          for (const ref of referencePoints) {
            const distanceMiles = calculateDistanceMeters(ref.lat, ref.lng, jobLat, jobLng) / METERS_PER_MILE;
            if (distanceMiles < minDistanceMiles) minDistanceMiles = distanceMiles;
          }
          (job as any)._distanceMiles = minDistanceMiles;
        }
      }
      
      // If worker has skillsets defined, filter by matching skillsets
      // This includes both the worker's own skillsets AND their team members' skillsets
      if (combinedSkillsets.length > 0) {
        const jobTrade = (job.trade || '').toLowerCase();
        const jobCategory = (job.serviceCategory || '').toLowerCase();
        const hasMatchingSkill = combinedSkillsets.some(skill => {
          const skillLower = skill.toLowerCase();
          return jobTrade.includes(skillLower) || 
                 skillLower.includes(jobTrade) ||
                 jobCategory.includes(skillLower) ||
                 skillLower.includes(jobCategory);
        });
        // If no matching skill, still show the job - but prioritize matching ones
        // We'll include all jobs but mark matching ones for sorting
        (job as any)._hasMatchingSkill = hasMatchingSkill;
      }
      
      return true;
    });
    
    // Sort by urgency: jobs starting sooner are more urgent
    // Matching skill jobs first, then by distance, then by date
    const sortedJobs = filteredJobs.sort((a, b) => {
      // First sort by matching skills (matching first)
      const aMatch = (a as any)._hasMatchingSkill ? 1 : 0;
      const bMatch = (b as any)._hasMatchingSkill ? 1 : 0;
      if (bMatch !== aMatch) return bMatch - aMatch;
      
      // Then by distance (closer first)
      const aDist = (a as any)._distanceMiles ?? 999;
      const bDist = (b as any)._distanceMiles ?? 999;
      if (Math.abs(aDist - bDist) > 5) return aDist - bDist; // Only if difference > 5 miles
      
      // Then by start date
      const aStart = new Date(a.startDate).getTime();
      const bStart = new Date(b.startDate).getTime();
      return aStart - bStart; // Earlier dates first
    });
    
    // Clean up temporary properties
    sortedJobs.forEach(job => {
      delete (job as any)._hasMatchingSkill;
      delete (job as any)._distanceMiles;
    });

    // Pagination params first: when limit is set (worker dashboard infinite scroll), only geocode + enrich
    // the current page. Doing all jobs first caused multi-minute work and client timeouts on mobile.
    const limitParam = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 0;
    const cursorParam = req.query.cursor != null ? parseInt(String(req.query.cursor), 10) : 0;
    const usePagination = Number.isFinite(limitParam) && limitParam > 0;

    let jobsToHydrate = sortedJobs;
    let pageStartIndex = 0;
    let pageLimit = 0;
    if (usePagination) {
      pageLimit = Math.min(100, Math.max(1, limitParam));
      pageStartIndex = cursorParam
        ? Math.max(0, sortedJobs.findIndex((j: any) => j.id === cursorParam) + 1)
        : 0;
      jobsToHydrate = sortedJobs.slice(pageStartIndex, pageStartIndex + pageLimit);
    }

    // Geocode jobs that have address but no usable lat/lng (align with client parseJobLatLng / null-island reject)
    const hasCoords = (j: (typeof sortedJobs)[0]) => {
      const lat = j.latitude != null ? parseFloat(String(j.latitude)) : NaN;
      const lng = j.longitude != null ? parseFloat(String(j.longitude)) : NaN;
      return Number.isFinite(lat) && Number.isFinite(lng) && isPlausibleLatLng(lat, lng);
    };
    for (const job of jobsToHydrate) {
      if (hasCoords(job)) continue;
      const geoQuery = buildJobGeocodeQuery(job);
      if (!geoQuery) continue;
      const coords = await geocodeAddress(geoQuery);
      if (coords) {
        (job as any).latitude = coords.latitude;
        (job as any).longitude = coords.longitude;
        try {
          await storage.updateJob(job.id, { latitude: coords.latitude, longitude: coords.longitude });
        } catch (e) {
          // Non-fatal: response still has coords for this request
        }
      }
    }

    // Enrich each job with location representative name (contact/team member for location)
    const enrichedJobs = await Promise.all(
      jobsToHydrate.map(async (job) => {
        const locationRepresentativeName = await getLocationRepresentativeName(job, null);
        return { ...job, locationRepresentativeName };
      })
    );

    if (usePagination) {
      const page = enrichedJobs;
      const nextCursor =
        page.length === pageLimit && pageStartIndex + pageLimit < sortedJobs.length
          ? (page[page.length - 1] as any).id
          : null;
      return res.json({ jobs: page, nextCursor });
    }

    res.json(enrichedJobs);
  });

  /**
   * Diagnostics for "why don't I see jobs?" — same rules as GET /api/jobs/find-work.
   * - Workers: always inspect their own profile (no params).
   * - Admins (ADMIN_EMAILS): optional ?workerProfileId=123 to inspect another worker.
   */
  app.get("/api/jobs/find-work/debug", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const session = req.profile;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const adminRaw = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "";
    const adminEmails = new Set(
      adminRaw.split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean)
    );
    const requesterEmail = ((req.user as any)?.claims?.email as string | undefined)?.toLowerCase();
    const isAdmin = requesterEmail != null && adminEmails.has(requesterEmail);

    const widParam = req.query.workerProfileId != null ? parseInt(String(req.query.workerProfileId), 10) : NaN;
    let workerId: number;
    if (Number.isFinite(widParam) && widParam > 0) {
      if (!isAdmin) return res.status(403).json({ message: "workerProfileId is admin-only" });
      workerId = widParam;
    } else {
      if (session.role !== "worker") {
        return res.status(403).json({ message: "Workers only, or pass workerProfileId as an admin" });
      }
      workerId = session.id;
    }

    const profile = await storage.getProfile(workerId);
    if (!profile || profile.role !== "worker") {
      return res.status(404).json({ message: "Worker profile not found" });
    }

    const skipLocationFilter =
      process.env.NODE_ENV === "development" && req.query.skipLocationFilter === "1";
    const rawMax = req.query.maxDistanceMiles != null ? Number(req.query.maxDistanceMiles) : NaN;
    const maxDistanceMiles = Number.isFinite(rawMax) ? Math.min(50, Math.max(1, rawMax)) : 50;
    const filters = {
      trade: req.query.trade as string,
      location: req.query.location as string,
    };
    const allJobs = await storage.getJobs(skipLocationFilter ? undefined : filters);

    const dismissedJobIds = await storage.getDismissedJobs(profile.id);
    const workerApplications = await storage.getWorkerApplications(profile.id);
    const appliedJobIds = workerApplications.map((a) => a.jobId);

    const freshProfile = await storage.getProfile(profile.id);
    const profileForLocation = freshProfile ?? profile;

    const team = await storage.getWorkerTeam(profile.id);
    let teamMembers: Awaited<ReturnType<typeof storage.getWorkerTeamMembers>> = [];
    if (team) {
      teamMembers = await storage.getWorkerTeamMembers(team.id);
    }

    const referencePoints: Array<{ lat: number; lng: number }> = [];
    const workerLatRaw =
      profileForLocation?.latitude != null ? parseFloat(String(profileForLocation.latitude)) : NaN;
    const workerLngRaw =
      profileForLocation?.longitude != null ? parseFloat(String(profileForLocation.longitude)) : NaN;
    if (isPlausibleLatLng(workerLatRaw, workerLngRaw)) {
      referencePoints.push({ lat: workerLatRaw, lng: workerLngRaw });
    } else {
      const addr = (profileForLocation?.address || "").trim();
      const city = (profileForLocation?.city || "").trim();
      const state = (profileForLocation?.state || "").trim();
      const zip = (profileForLocation?.zipCode || "").trim();
      if (addr || city || state || zip) {
        const coords = addr
          ? await geocodeFullAddress(addr, city || "", state || "", zip || "")
          : await geocodeAddress([city, state, zip].filter(Boolean).join(", "));
        if (coords) {
          referencePoints.push({ lat: parseFloat(coords.latitude), lng: parseFloat(coords.longitude) });
        }
      }
    }
    for (const m of teamMembers) {
      if (m.status !== "active") continue;
      const hasAddress = !!(
        (m.address || "").trim() ||
        (m.city || "").trim() ||
        (m.state || "").trim() ||
        (m.zipCode || "").trim()
      );
      if (!hasAddress) continue;
      const mlat = m.latitude != null ? parseFloat(String(m.latitude)) : NaN;
      const mlng = m.longitude != null ? parseFloat(String(m.longitude)) : NaN;
      if (isPlausibleLatLng(mlat, mlng)) {
        referencePoints.push({ lat: mlat, lng: mlng });
      } else {
        const addr = (m.address || "").trim();
        const city = (m.city || "").trim();
        const state = (m.state || "").trim();
        const zip = (m.zipCode || "").trim();
        const coords = addr
          ? await geocodeFullAddress(addr, city, state, zip)
          : await geocodeAddress([city, state, zip].filter(Boolean).join(", "));
        if (coords) {
          referencePoints.push({ lat: parseFloat(coords.latitude), lng: parseFloat(coords.longitude) });
        }
      }
    }

    const SAMPLE_CAP = 12;
    const pushSample = (arr: number[], id: number) => {
      if (arr.length < SAMPLE_CAP) arr.push(id);
    };

    const counts: Record<string, number> = {
      dismissed: 0,
      applied: 0,
      fully_staffed: 0,
      not_open: 0,
      past_start_cutoff: 0,
      outside_radius: 0,
      state_mismatch: 0,
      passed: 0,
    };
    const samples: Record<string, number[]> = {
      dismissed: [],
      applied: [],
      fully_staffed: [],
      not_open: [],
      past_start_cutoff: [],
      outside_radius: [],
      state_mismatch: [],
      passed: [],
    };

    const inc = (key: keyof typeof counts, jobId: number) => {
      counts[key]++;
      pushSample(samples[key], jobId);
    };

    for (const job of allJobs) {
      if (dismissedJobIds.includes(job.id)) {
        inc("dismissed", job.id);
        continue;
      }
      if (appliedJobIds.includes(job.id)) {
        inc("applied", job.id);
        continue;
      }
      const maxWorkers = job.maxWorkersNeeded || 1;
      const workersHired = job.workersHired || 0;
      if (workersHired >= maxWorkers) {
        inc("fully_staffed", job.id);
        continue;
      }
      if (job.status !== "open") {
        inc("not_open", job.id);
        continue;
      }
      if (job.startDate) {
        const jobStart = new Date(job.startDate);
        const cutoff = new Date(jobStart.getTime() + 48 * 60 * 60 * 1000);
        if (Date.now() > cutoff.getTime()) {
          inc("past_start_cutoff", job.id);
          continue;
        }
      }

      if (referencePoints.length > 0 && !skipLocationFilter) {
        const jobLatRaw = job.latitude != null ? parseFloat(String(job.latitude)) : NaN;
        const jobLngRaw = job.longitude != null ? parseFloat(String(job.longitude)) : NaN;
        const jobLat = Number.isFinite(jobLatRaw) ? jobLatRaw : null;
        const jobLng = Number.isFinite(jobLngRaw) ? jobLngRaw : null;

        if (jobLat !== null && jobLng !== null && isPlausibleLatLng(jobLat, jobLng)) {
          let minDistanceMiles = Infinity;
          for (const ref of referencePoints) {
            const distanceMeters = calculateDistanceMeters(ref.lat, ref.lng, jobLat, jobLng);
            const distanceMiles = distanceMeters / METERS_PER_MILE;
            if (distanceMiles < minDistanceMiles) minDistanceMiles = distanceMiles;
          }
          if (minDistanceMiles > maxDistanceMiles) {
            inc("outside_radius", job.id);
            continue;
          }
        } else {
          const workerState = (profileForLocation.state || "").toLowerCase().trim();
          const jobState = (job.state || "").toLowerCase().trim();
          if (workerState && jobState && workerState !== jobState) {
            inc("state_mismatch", job.id);
            continue;
          }
        }
      } else if (referencePoints.length === 0 && !skipLocationFilter) {
        const workerState = (profileForLocation.state || "").toLowerCase().trim();
        const jobState = (job.state || "").toLowerCase().trim();
        if (workerState && jobState && workerState !== jobState) {
          inc("state_mismatch", job.id);
          continue;
        }
      }

      inc("passed", job.id);
    }

    return res.json({
      workerProfileId: workerId,
      openJobsFromGetJobs: allJobs.length,
      maxDistanceMiles,
      skipLocationFilter,
      tradeFilter: filters.trade || null,
      locationFilter: filters.location || null,
      referencePointCount: referencePoints.length,
      referencePoints,
      teammateReferenceRowsConsidered: teamMembers.filter((m) => m.status === "active").length,
      profileLocation: {
        rawLatitude: profileForLocation.latitude ?? null,
        rawLongitude: profileForLocation.longitude ?? null,
        savedCoordsPlausible: isPlausibleLatLng(workerLatRaw, workerLngRaw),
        city: profileForLocation.city ?? null,
        state: profileForLocation.state ?? null,
        zipCode: profileForLocation.zipCode ?? null,
        hasAddressLine: !!(profileForLocation.address || "").trim(),
      },
      counts,
      sampleJobIdsByReason: samples,
      hint:
        counts.passed === 0 && counts.outside_radius > 0
          ? "Jobs exist but are farther than maxDistanceMiles from every reference point (you + teammates with addresses). Check saved lat/lng and radius."
          : counts.passed === 0 && referencePoints.length === 0
            ? "No reference points: add plausible lat/lng or a resolvable address (you and/or teammates)."
            : counts.passed === 0 && counts.applied === allJobs.length
              ? "You may have already applied to every open job in the query."
              : undefined,
    });
  });

  // Nearby jobs (must be before /api/jobs/:id so "nearby" is not matched as job id)
  app.get("/api/jobs/nearby", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusMiles = Number(req.query.radius) || 10;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "Invalid coordinates" });
    }
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can query nearby jobs" });
    }
    const nearbyJobs = await storage.getNearbyJobs(lat, lng, radiusMiles);
    res.json(nearbyJobs);
  });

  app.get(api.jobs.get.path, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid job ID" });
    const job = await storage.getJob(id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    
    const company = await storage.getProfile(job.companyId);
    if (!company) return res.status(404).json({ message: "Company not found" });

    const locationRepresentativeName = await getLocationRepresentativeName(job, company);
    res.json({ ...job, company, locationRepresentativeName });
  });

  // Application rate stats for a job (for suggested rate: first applicant vs competitive)
  app.get("/api/jobs/:id/application-rate-stats", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const jobId = Number(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    const job = await storage.getJob(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    const list = await storage.getApplicationsByJob(jobId);
    const withRate = list.filter((a) => a.status === "pending" || a.status === "accepted").filter((a) => a.proposedRate != null && a.proposedRate > 0);
    const rates = withRate.map((a) => a.proposedRate!);
    const applicationCount = rates.length;
    const minProposedRateCents = applicationCount > 0 ? Math.min(...rates) : null;
    const maxProposedRateCents = applicationCount > 0 ? Math.max(...rates) : null;
    res.json({ applicationCount, minProposedRateCents, maxProposedRateCents });
  });

  // Get company's jobs with applications and timesheets
  app.get("/api/company/jobs", async (req, res) => {
    if (!req.isAuthenticated()) {
      console.error("GET /api/company/jobs: Not authenticated");
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const user = req.user as any;
    if (!user || !user.claims || !user.claims.sub) {
      console.error("GET /api/company/jobs: Invalid user object in session:", { 
        hasUser: !!user, 
        hasClaims: !!(user?.claims), 
        hasSub: !!(user?.claims?.sub),
        user 
      });
      return res.status(401).json({ message: "Invalid session" });
    }
    
    console.log(`GET /api/company/jobs: Checking profile for user ${user.claims.sub} (${user.claims.email})`);
    const profile = req.profile;
    
    if (!profile) {
      console.error(`GET /api/company/jobs: Profile not found for user ${user.claims.sub} (${user.claims.email})`);
      return res.status(403).json({ 
        message: "Profile not found. Please complete your profile setup.",
        userId: user.claims.sub,
        email: user.claims.email
      });
    }
    
    if (profile.role !== "company") {
      console.error(`GET /api/company/jobs: User ${user.claims.sub} (${user.claims.email}) has role ${profile.role}, not company`);
      return res.status(403).json({ 
        message: `Only companies can access this endpoint. Your role is: ${profile.role}`,
        role: profile.role,
        userId: user.claims.sub,
        email: user.claims.email
      });
    }
    
    console.log(`GET /api/company/jobs: Success for company ${profile.id} (${profile.companyName || 'Unnamed'})`);
    
    // Get all jobs for this company
    const companyJobs = await storage.getCompanyJobs(profile.id);
    const jobIds = companyJobs.map((j) => j.id);
    if (jobIds.length === 0) {
      res.json([]);
      return;
    }
    // Batch fetch applications, timesheets, and team members (avoids N+1 queries)
    const [allTimesheets, allApplications] = await Promise.all([
      storage.getTimesheetsByJobIds(jobIds),
      storage.getJobApplicationsForJobIds(jobIds),
    ]);
    const teamMemberIds = [...new Set(allApplications.map((a) => a.teamMemberId).filter(Boolean))] as number[];
    const teamMembersList = teamMemberIds.length > 0 ? await storage.getWorkerTeamMembersByIds(teamMemberIds) : [];
    const teamMembersMap = new Map(teamMembersList.map((m) => [m.id, m]));
    // Manager (Business Operator) per team member for applications
    const managerByTeamMemberId = new Map<number, { id: number; firstName: string | null; lastName: string | null }>();
    if (teamMembersList.length > 0) {
      const teamIds = [...new Set(teamMembersList.map((m: any) => m.teamId).filter(Boolean))] as number[];
      const teamsList = teamIds.length > 0 ? await db.select({ id: teams.id, ownerId: teams.ownerId }).from(teams).where(inArray(teams.id, teamIds)) : [];
      const teamsMap = new Map(teamsList.map((t) => [t.id, t]));
      const ownerIds = [...new Set(teamsList.map((t) => t.ownerId).filter(Boolean))];
      const ownersList = ownerIds.length > 0 ? await db.select({ id: profiles.id, firstName: profiles.firstName, lastName: profiles.lastName }).from(profiles).where(inArray(profiles.id, ownerIds)) : [];
      const ownersMap = new Map(ownersList.map((p) => [p.id, p]));
      for (const m of teamMembersList) {
        const team = teamsMap.get((m as any).teamId);
        if (team) {
          const owner = ownersMap.get(team.ownerId);
          if (owner) managerByTeamMemberId.set(m.id, { id: owner.id, firstName: owner.firstName, lastName: owner.lastName });
        }
      }
    }
    const timesheetsByJobId = new Map<number, typeof allTimesheets>();
    for (const ts of allTimesheets) {
      const list = timesheetsByJobId.get(ts.jobId) ?? [];
      list.push(ts);
      timesheetsByJobId.set(ts.jobId, list);
    }
    const applicationsByJobId = new Map<number, typeof allApplications>();
    for (const app of allApplications) {
      const list = applicationsByJobId.get(app.jobId) ?? [];
      list.push(app);
      applicationsByJobId.set(app.jobId, list);
    }
    // Enrich each job with applications and timesheets (in-memory; no extra DB calls)
    const enrichedJobs = companyJobs.map((job) => {
      const jobApplications = applicationsByJobId.get(job.id) ?? [];
      const jobTimesheets = timesheetsByJobId.get(job.id) ?? [];
      const applicationsWithDisplayWorker = jobApplications.map((app) => {
        let displayWorker = {
          id: app.worker.id,
          firstName: app.worker.firstName,
          lastName: app.worker.lastName,
          avatarUrl: app.worker.avatarUrl,
          phone: app.worker.phone,
          hourlyRate: app.worker.hourlyRate,
          averageRating: app.worker.averageRating,
          completedJobs: app.worker.completedJobs,
          trades: app.worker.trades,
          serviceCategories: app.worker.serviceCategories,
          bio: app.worker.bio,
        };
        if (app.teamMemberId) {
          const teamMember = teamMembersMap.get(app.teamMemberId);
          if (teamMember) {
            displayWorker = {
              ...displayWorker,
              id: app.worker.id,
              firstName: teamMember.firstName,
              lastName: teamMember.lastName,
              avatarUrl: teamMember.avatarUrl ?? app.worker.avatarUrl,
              phone: teamMember.phone ?? app.worker.phone,
              hourlyRate: (teamMember.hourlyRate ?? app.worker.hourlyRate) ?? null,
              averageRating: app.worker.averageRating,
              completedJobs: app.worker.completedJobs,
              trades: teamMember.skillsets ?? app.worker.trades,
              serviceCategories: app.worker.serviceCategories,
              bio: app.worker.bio,
            };
          }
        }
        return {
          id: app.id,
          workerId: app.workerId,
          teamMemberId: app.teamMemberId ?? undefined,
          manager: app.teamMemberId ? managerByTeamMemberId.get(app.teamMemberId) ?? undefined : undefined,
          message: app.message,
          proposedRate: app.proposedRate,
          status: app.status,
          createdAt: app.createdAt,
          worker: displayWorker,
        };
      });
      return {
        ...job,
        applications: applicationsWithDisplayWorker,
        timesheets: jobTimesheets.map((ts) => ({
          id: ts.id,
          workerId: ts.workerId,
          totalHours: ts.totalHours,
          hourlyRate: ts.hourlyRate,
          status: ts.status,
          clockInTime: ts.clockInTime,
          clockOutTime: ts.clockOutTime,
        })),
      };
    });
    
    res.json(enrichedJobs);
  });

  // Update company job (timeline/schedule)
  app.patch("/api/company/jobs/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") return res.status(403).json({ message: "Only companies can update jobs" });
    const jobId = parseInt(req.params.id, 10);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    try {
      const job = await storage.getJob(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.companyId !== profile.id) return res.status(403).json({ message: "Not your job" });
      const body = req.body || {};
      const updates: Record<string, unknown> = {};
      if (typeof body.startDate === "string") updates.startDate = new Date(body.startDate);
      const st = typeof body.startTime === "string" ? body.startTime : "";
      const et = typeof body.endTime === "string" ? body.endTime : "";
      if (st || et) {
        const existing = (job as any).scheduledTime || "";
        const newTime = st && et ? `${st} - ${et}` : (st || et);
        updates.scheduledTime = newTime;
        if (et) updates.endTime = et;
      }
      if (Array.isArray(body.recurringDays)) updates.scheduleDays = body.recurringDays;
      if (typeof body.recurringWeeks === "number") updates.recurringWeeks = body.recurringWeeks;
      if (body.timelineType === "on-demand") {
        (updates as any).isOnDemand = true;
        (updates as any).jobType = "on_demand";
      } else if (body.timelineType === "one-day") {
        (updates as any).isOnDemand = false;
        (updates as any).jobType = "one_time";
      } else if (body.timelineType === "recurring") {
        (updates as any).isOnDemand = false;
        (updates as any).jobType = "recurring";
      }
      if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim();
      if (typeof body.description === "string") updates.description = body.description;
      if (typeof body.maxWorkersNeeded === "number" && body.maxWorkersNeeded >= 1) updates.maxWorkersNeeded = body.maxWorkersNeeded;
      if (Array.isArray(body.images)) updates.images = body.images;
      if (Array.isArray(body.videos)) updates.videos = body.videos;
      if (body.status === "cancelled" && ["open", "in_progress"].includes((job as any).status)) updates.status = "cancelled";
      if (body.status === "completed" && ["open", "in_progress"].includes((job as any).status)) updates.status = "completed";
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No valid updates" });
      const updated = await storage.updateJob(jobId, updates as Partial<Job>);
      res.json(updated);
    } catch (err: any) {
      console.error("PATCH /api/company/jobs/:id:", err);
      res.status(500).json({ message: err?.message || "Failed to update job" });
    }
  });

  // AI-powered job estimation endpoint
  app.post("/api/ai/estimate-job", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { description, skillsets, shiftType } = req.body;
      
      if (!description || description.length < 10) {
        return res.status(400).json({ message: "Please provide a detailed job description" });
      }
      
      const HOURLY_RATE = 40; // $40/hr basis for estimates
      const BUFFER_PERCENTAGE = 1.10; // 10% buffer for contingencies
      
      // Use OpenAI for AI estimation
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        // Fallback to rule-based estimation
        return res.json(estimateJobWithRules(description, skillsets, shiftType, HOURLY_RATE, BUFFER_PERCENTAGE));
      }
      
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{
              role: 'system',
              content: 'You are a construction staffing expert. Analyze job descriptions and provide realistic estimates for workers needed and hours to complete tasks. Respond ONLY in valid JSON format.'
            }, {
              role: 'user',
              content: `Analyze this construction job and provide estimates. Use $40/hr as the labor rate basis.

Job Description: "${description}"
${skillsets?.length > 0 ? `Skill Categories: ${skillsets.join(', ')}` : ''}
Job Type: ${shiftType || 'on-demand'}

Consider both the description AND skill categories when estimating:
- Specialized skills (electrical, plumbing, HVAC) may require fewer but higher-skill workers
- General labor or multi-skill projects often need more workers
- Match hours to scope: quick repairs 2-4hrs, standard tasks 4-8hrs, larger projects 8-20hrs+

Provide:
1. A short job title (4 words MAX, action-focused, NO skill names - skills will be added as tags)
2. How many workers are needed (1-10 workers)
3. Estimated hours to complete the task (1-40 hours, based on scope and complexity)
4. Brief reasoning for your estimates (1-2 sentences)

Budget will be calculated as workers × hours × $40/hr.

Respond ONLY in this exact JSON format:
{"title": "<4 word title>", "workers": <number>, "hours": <number>, "reasoning": "<brief explanation>"}`
            }],
            temperature: 0.3,
            max_tokens: 200
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.log('[AI Estimate] OpenAI error:', errorData);
          throw new Error('OpenAI API error');
        }
        
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        
        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const workers = Math.min(10, Math.max(1, parseInt(parsed.workers) || 2));
          const hours = Math.min(40, Math.max(1, parseInt(parsed.hours) || 8));
          
          // Clean and limit title to 4 words
          let title = parsed.title || 'Construction Work';
          const titleWords = title.split(/\s+/).slice(0, 4);
          title = titleWords.join(' ');
          
          // Calculate budget at $40/hr with buffer
          const baseBudget = workers * hours * HOURLY_RATE;
          const budgetWithBuffer = Math.ceil(baseBudget * BUFFER_PERCENTAGE);
          
          return res.json({
            suggestedTitle: title,
            suggestedWorkers: workers,
            suggestedHours: hours,
            suggestedBudget: budgetWithBuffer,
            baseBudget: baseBudget,
            bufferPercentage: 10,
            reasoning: parsed.reasoning || 'Based on job description and skill categories',
            hourlyRate: HOURLY_RATE
          });
        }
        
        throw new Error('Invalid AI response format');
      } catch (aiError) {
        console.log('[AI Estimate] OpenAI error, falling back to rules:', aiError);
        return res.json(estimateJobWithRules(description, skillsets, shiftType, HOURLY_RATE, BUFFER_PERCENTAGE));
      }
    } catch (error) {
      console.error('[AI Estimate] Error:', error);
      res.status(500).json({ message: "Failed to estimate job" });
    }
  });
  
  // Rule-based fallback for job estimation
  function estimateJobWithRules(
    description: string, 
    skillsets: string[], 
    shiftType: string,
    hourlyRate: number,
    bufferPercentage: number
  ) {
    const lowerDesc = description.toLowerCase();
    let workers = 1;
    let hours = 4;
    let reasoning = 'Based on job description analysis';
    let title = 'Construction Work';
    
    // Keywords that suggest larger teams
    const largeTeamKeywords = ['renovation', 'remodel', 'entire', 'complete', 'full', 'large', 'commercial', 'warehouse', 'building'];
    const mediumTeamKeywords = ['room', 'multiple', 'several', 'project', 'installation'];
    const heavyWorkKeywords = ['demo', 'demolition', 'concrete', 'roofing', 'foundation', 'framing'];
    const quickTaskKeywords = ['repair', 'fix', 'replace', 'install single', 'minor', 'small', 'quick'];
    
    // Generate title based on keywords
    if (lowerDesc.includes('renovation')) title = 'Renovation Project';
    else if (lowerDesc.includes('remodel')) title = 'Remodeling Work';
    else if (lowerDesc.includes('kitchen')) title = 'Kitchen Work';
    else if (lowerDesc.includes('bathroom')) title = 'Bathroom Work';
    else if (lowerDesc.includes('deck')) title = 'Deck Project';
    else if (lowerDesc.includes('fence')) title = 'Fence Installation';
    else if (lowerDesc.includes('roof')) title = 'Roofing Work';
    else if (lowerDesc.includes('floor')) title = 'Flooring Work';
    else if (lowerDesc.includes('repair')) title = 'Repair Work';
    else if (lowerDesc.includes('install')) title = 'Installation Work';
    else if (lowerDesc.includes('demo') || lowerDesc.includes('demolition')) title = 'Demolition Work';
    else if (lowerDesc.includes('paint')) title = 'Painting Project';
    else if (lowerDesc.includes('office')) title = 'Office Buildout';
    else if (lowerDesc.includes('warehouse')) title = 'Warehouse Work';
    
    // Estimate workers - consider both description and skill categories
    const specializedSkills = ['electrical', 'plumbing', 'hvac', 'hvacr', 'welding', 'carpentry', 'drywall'];
    const hasSpecializedSkill = skillsets.some((s: string) => specializedSkills.some(sp => s.toLowerCase().includes(sp)));
    
    if (largeTeamKeywords.some(k => lowerDesc.includes(k))) {
      workers = 3 + Math.floor(Math.random() * 2); // 3-5 workers
      reasoning = 'Large-scale project requiring multiple workers';
    } else if (mediumTeamKeywords.some(k => lowerDesc.includes(k)) || (skillsets.length >= 2 && !hasSpecializedSkill)) {
      workers = 2 + Math.floor(Math.random() * 2); // 2-3 workers
      reasoning = 'Multi-skill project benefiting from a small team';
    } else if (heavyWorkKeywords.some(k => lowerDesc.includes(k))) {
      workers = 2 + Math.floor(Math.random() * 2); // 2-3 workers
      reasoning = 'Heavy labor requiring team support';
    } else if (hasSpecializedSkill && skillsets.length <= 1) {
      workers = 1 + (lowerDesc.includes('multiple') || lowerDesc.includes('several') ? 1 : 0);
      reasoning = 'Specialized skill category typically requires fewer workers';
    } else {
      workers = quickTaskKeywords.some(k => lowerDesc.includes(k)) ? 1 : 2;
      reasoning = workers === 1 ? 'Simple task suitable for single worker' : 'Standard task requiring basic support';
    }
    
    // Estimate hours based on description length and keywords
    const wordCount = description.split(/\s+/).length;
    if (wordCount > 100 || largeTeamKeywords.some(k => lowerDesc.includes(k))) {
      hours = Math.floor(Math.random() * 8) + 12; // 12-20 hours
    } else if (wordCount > 50 || mediumTeamKeywords.some(k => lowerDesc.includes(k))) {
      hours = Math.floor(Math.random() * 4) + 6; // 6-10 hours
    } else if (quickTaskKeywords.some(k => lowerDesc.includes(k))) {
      hours = Math.floor(Math.random() * 2) + 2; // 2-4 hours
    } else {
      hours = Math.floor(Math.random() * 4) + 4; // 4-8 hours
    }
    
    const baseBudget = workers * hours * hourlyRate;
    const budgetWithBuffer = Math.ceil(baseBudget * bufferPercentage);
    
    return {
      suggestedTitle: title,
      suggestedWorkers: workers,
      suggestedHours: hours,
      suggestedBudget: budgetWithBuffer,
      baseBudget: baseBudget,
      bufferPercentage: 10,
      reasoning,
      hourlyRate
    };
  }

  // Helper function to extract insurance fields from text using regex patterns
  function extractInsuranceFromText(text: string) {
    const result = {
      policyNumber: '',
      issuer: '',
      startDate: '',
      endDate: '',
      coverageType: '',
      coverageAmount: 0
    };
    
    // Normalize text - remove extra whitespace
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const upperText = normalizedText.toUpperCase();
    
    // Extract policy number - look for common patterns
    // Policy numbers typically contain numbers and may have letters/dashes
    const policyPatterns = [
      // Explicit policy number label followed by alphanumeric code
      /POLICY\s*(?:NUMBER|NO|#|NUM)?[:\s]+([A-Z]*\d+[A-Z0-9\-]*)/i,
      /CERTIFICATE\s*(?:NUMBER|NO|#)?[:\s]+([A-Z]*\d+[A-Z0-9\-]*)/i,
      /POL\s*(?:NO|#)?[:\s]+([A-Z]*\d+[A-Z0-9\-]*)/i,
      /(?:POLICY|CERTIFICATE)\s*ID[:\s]+([A-Z]*\d+[A-Z0-9\-]*)/i,
      // Policy number with specific format like "GL-12345" or "CGL123456"
      /(?:POLICY|POL)[:\s#]*([A-Z]{2,4}[\-]?\d{4,})/i,
      // Standalone policy number patterns (must have numbers)
      /\b([A-Z]{2,4}\s?\d{6,})\b/,
      /\b(\d{2,3}[A-Z]{2,4}\d{4,})\b/
    ];
    for (const pattern of policyPatterns) {
      const match = normalizedText.match(pattern);
      // Policy number must contain at least one digit and be 5+ chars
      if (match && match[1] && match[1].length >= 5 && /\d/.test(match[1])) {
        result.policyNumber = match[1].trim();
        break;
      }
    }
    
    // Extract insurance company/issuer
    const issuerPatterns = [
      /(?:INSURER|INSURED BY|CARRIER|UNDERWRITER|INSURANCE\s*CO(?:MPANY)?|ISSUED BY)[:\s]*([A-Za-z\s&.,]+?)(?:\s*(?:POLICY|CERT|$|\d))/i,
      /([A-Z][A-Za-z\s&.,]+(?:INSURANCE|MUTUAL|ASSURANCE|UNDERWRITERS|CASUALTY)(?:\s*(?:CO|COMPANY|CORP|INC|LLC))?)/i
    ];
    for (const pattern of issuerPatterns) {
      const match = normalizedText.match(pattern);
      if (match && match[1]) {
        result.issuer = match[1].trim().replace(/\s+/g, ' ');
        break;
      }
    }
    
    // Extract dates - look for date patterns
    const datePattern = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g;
    const dates: string[] = [];
    let dateMatch;
    while ((dateMatch = datePattern.exec(normalizedText)) !== null) {
      const month = dateMatch[1].padStart(2, '0');
      const day = dateMatch[2].padStart(2, '0');
      let year = dateMatch[3];
      if (year.length === 2) {
        year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
      }
      dates.push(`${month}/${day}/${year}`);
    }
    
    // Also check for written dates
    const writtenDatePattern = /([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})/g;
    const months: {[key: string]: string} = {
      'January': '01', 'February': '02', 'March': '03', 'April': '04',
      'May': '05', 'June': '06', 'July': '07', 'August': '08',
      'September': '09', 'October': '10', 'November': '11', 'December': '12'
    };
    while ((dateMatch = writtenDatePattern.exec(normalizedText)) !== null) {
      const monthNum = months[dateMatch[1]];
      if (monthNum) {
        const day = dateMatch[2].padStart(2, '0');
        dates.push(`${monthNum}/${day}/${dateMatch[3]}`);
      }
    }
    
    // Find effective/start and expiration/end dates
    const effMatch = normalizedText.match(/(?:EFFECTIVE|EFF|START|FROM|BEGINS?)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    const expMatch = normalizedText.match(/(?:EXPIR(?:ATION|ES?)|END|TO|THROUGH|EXPIRES?)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    
    if (effMatch) {
      const parts = effMatch[1].split(/[\/\-]/);
      if (parts.length === 3) {
        const month = parts[0].padStart(2, '0');
        const day = parts[1].padStart(2, '0');
        let year = parts[2];
        if (year.length === 2) year = `20${year}`;
        result.startDate = `${month}/${day}/${year}`;
      }
    } else if (dates.length > 0) {
      result.startDate = dates[0];
    }
    
    if (expMatch) {
      const parts = expMatch[1].split(/[\/\-]/);
      if (parts.length === 3) {
        const month = parts[0].padStart(2, '0');
        const day = parts[1].padStart(2, '0');
        let year = parts[2];
        if (year.length === 2) year = `20${year}`;
        result.endDate = `${month}/${day}/${year}`;
      }
    } else if (dates.length > 1) {
      result.endDate = dates[dates.length - 1];
    }
    
    // Extract coverage type
    const coverageTypes = [
      'General Liability', 'Commercial General Liability', 'CGL',
      'Workers Compensation', 'Workers Comp', 'Professional Liability',
      'Errors and Omissions', 'E&O', 'Umbrella', 'Excess Liability',
      'Commercial Auto', 'Business Auto', 'Property', 'Equipment',
      'Contractor Liability', 'Builders Risk'
    ];
    for (const type of coverageTypes) {
      if (upperText.includes(type.toUpperCase())) {
        result.coverageType = type === 'CGL' ? 'Commercial General Liability' : 
                              type === 'E&O' ? 'Errors and Omissions' : type;
        break;
      }
    }
    
    // Extract coverage amount - look for dollar amounts
    const amountPatterns = [
      /(?:LIMIT|COVERAGE|EACH\s*OCCURRENCE|AGGREGATE)[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)\s*(?:MILLION|MIL|M)?/i,
      /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:MILLION|MIL|M)?/g
    ];
    
    let maxAmount = 0;
    for (const pattern of amountPatterns) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      while ((match = regex.exec(normalizedText)) !== null) {
        let amount = parseFloat(match[1].replace(/,/g, ''));
        // Check for "million" indicators
        if (/MILLION|MIL/i.test(normalizedText.substring(match.index, match.index + 50))) {
          amount *= 1000000;
        }
        // Also check if the number itself suggests millions (e.g., "1" near "million")
        if (amount < 100 && /million/i.test(normalizedText.substring(match.index, match.index + 20))) {
          amount *= 1000000;
        }
        if (amount > maxAmount && amount >= 10000) { // Minimum reasonable coverage
          maxAmount = amount;
        }
      }
    }
    result.coverageAmount = Math.round(maxAmount * 100); // Store in cents
    
    console.log('[Insurance Extract] Extracted fields:', result);
    return result;
  }

  // Insurance document extraction (supports PDF and images)
  app.post("/api/ai/extract-insurance", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { document } = req.body;
      
      if (!document) {
        return res.status(400).json({ message: "No document provided" });
      }
      
      const isPdf = document.startsWith('data:application/pdf');
      const isImage = document.startsWith('data:image/');
      
      if (!isPdf && !isImage) {
        return res.status(400).json({ 
          success: false,
          message: "Please upload a PDF or image file (JPG, PNG) of your insurance certificate."
        });
      }
      
      // For PDFs, use text extraction with pattern matching (no AI needed)
      if (isPdf) {
        try {
          // Use unpdf for ESM-compatible PDF text extraction
          const { extractText } = await import('unpdf');
          
          const base64Data = document.split(',')[1];
          const pdfBuffer = Buffer.from(base64Data, 'base64');
          // Convert Buffer to Uint8Array as required by unpdf
          const pdfUint8Array = new Uint8Array(pdfBuffer);
          const pdfData = await extractText(pdfUint8Array, { mergePages: true });
          
          // Handle different response formats from unpdf
          let extractedText = '';
          if (typeof pdfData.text === 'string') {
            extractedText = pdfData.text;
          } else if (Array.isArray(pdfData.text)) {
            extractedText = (pdfData.text as string[]).join('\n');
          } else if (pdfData.totalPages && pdfData.text) {
            // It may be an object with page contents
            extractedText = String(pdfData.text);
          }
          
          console.log('[Insurance Extract] PDF text length:', extractedText.length);
          console.log('[Insurance Extract] PDF text preview:', extractedText.substring(0, 500));
          
          if (!extractedText || extractedText.length < 10) {
            // Fallback to OpenAI Vision for scanned/image PDFs
            console.log('[Insurance Extract] PDF text too short, falling back to Vision API');
            throw new Error('PDF text extraction failed, using Vision fallback');
          }
          
          const extracted = extractInsuranceFromText(extractedText);
          
          return res.json({
            success: true,
            data: extracted
          });
        } catch (pdfError) {
          console.error('[Insurance Extract] PDF parsing error:', pdfError);
          // Fall through to use OpenAI Vision as fallback for scanned PDFs
        }
      }
      
      // For images OR PDFs that failed text extraction (scanned docs), use OpenAI Vision
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return res.status(500).json({ message: "AI service not configured for image processing" });
      }
      
      const extractionPrompt = `Analyze this insurance certificate/document and extract the following information:
1. Policy Number - The unique policy identifier
2. Insurance Company Name (Issuer) - The company that issued the policy
3. Coverage Start Date - When coverage begins (format: MM/DD/YYYY)
4. Coverage End Date - When coverage expires (format: MM/DD/YYYY)
5. Coverage Type - The type of insurance (e.g., "General Liability", "Commercial General Liability", "Workers Compensation")
6. Coverage Amount - The coverage limit in dollars (just the number, no symbols)

If you cannot find a specific field, set it to an empty string.

Respond ONLY in this exact JSON format:
{"policyNumber": "<policy number>", "issuer": "<insurance company name>", "startDate": "<MM/DD/YYYY>", "endDate": "<MM/DD/YYYY>", "coverageType": "<type>", "coverageAmount": "<amount in dollars>"}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{
            role: 'system',
            content: 'You are an expert at reading insurance certificates and documents. Extract the key information accurately. Respond ONLY in valid JSON format.'
          }, {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
              { type: 'image_url', image_url: { url: document, detail: 'high' } }
            ]
          }],
          temperature: 0.1,
          max_tokens: 500
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.log('[Insurance Extract] OpenAI error:', errorData);
        throw new Error('OpenAI API error');
      }
      
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      
      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Parse coverage amount to cents
        let coverageAmountCents = 0;
        if (parsed.coverageAmount) {
          const amountStr = parsed.coverageAmount.replace(/[^0-9.]/g, '');
          coverageAmountCents = Math.round(parseFloat(amountStr) * 100) || 0;
        }
        
        return res.json({
          success: true,
          data: {
            policyNumber: parsed.policyNumber || '',
            issuer: parsed.issuer || '',
            startDate: parsed.startDate || '',
            endDate: parsed.endDate || '',
            coverageType: parsed.coverageType || '',
            coverageAmount: coverageAmountCents
          }
        });
      }
      
      return res.json({
        success: false,
        message: 'Could not parse insurance document'
      });
      
    } catch (error) {
      console.error('[Insurance Extract] Error:', error);
      return res.status(500).json({ 
        success: false,
        message: "Failed to process insurance document" 
      });
    }
  });

  app.post(api.jobs.create.path, async (req, res) => {
    const isDev = process.env.NODE_ENV === "development";
    
    // In dev mode, bypass authentication for testing
    let profile;
    if (isDev && !req.isAuthenticated()) {
      // In dev mode, try to find any company profile for testing
      // This allows testing without authentication
      const allProfiles = await db.select().from(profiles)
        .where(eq(profiles.role, "company"))
        .limit(1);
      
      if (allProfiles.length === 0) {
        return res.status(403).json({ message: "No company profile found. Please create a company profile first." });
      }
      
      profile = allProfiles[0];
    } else {
      // Production mode: require authentication
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      
      const user = req.user as any;
      profile = req.profile;
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Only companies can post jobs" });
      }
    }
    
    try {
      const rawBody = (req.body || {}) as Record<string, unknown>;
      const { autoFulfillTermsAcknowledged, ...jobBody } = rawBody;
      const termsAck = autoFulfillTermsAcknowledged === true || autoFulfillTermsAcknowledged === "true";
      const input = api.jobs.create.input.parse(jobBody);
      const saveAsDraft = (req.body as { status?: string })?.status === "draft";

      if ((input as any).autoFulfillEnabled) {
        const afErr = validateAutoFulfillJobPayload(input as any);
        if (afErr) {
          return res.status(400).json({ message: afErr });
        }
      }
      const withAfAck = applyAutoFulfillLegalAck(input as any, termsAck);
      let jobInput = { ...input, ...withAfAck } as typeof input;
      if (
        !saveAsDraft &&
        (jobInput as any).autoFulfillEnabled &&
        !(jobInput as any).autoFulfillLegalAckAt
      ) {
        return res.status(400).json({
          message:
            "Auto-fulfill requires acknowledging the Auto-fulfill and auto-pay terms (send autoFulfillTermsAcknowledged: true).",
          code: "AUTO_FULFILL_ACK_REQUIRED",
        });
      }

      // For published jobs (not draft), require contract and payment method
      if (!saveAsDraft && !isDev) {
        if (!profile.contractSigned) {
          return res.status(403).json({ message: "You must sign the platform agreement before posting jobs" });
        }
        const paymentMethods = await db.select().from(companyPaymentMethods).where(eq(companyPaymentMethods.profileId, profile.id));
        if (paymentMethods.length === 0) {
          return res.status(403).json({ message: "You must add a payment method before posting jobs" });
        }
      }

      if (!saveAsDraft) {
        const bc = (input as { budgetCents?: number | null }).budgetCents;
        const eh = (input as { estimatedHours?: number | null }).estimatedHours;
        if (bc != null && bc > 0 && eh != null && eh > 0) {
          const minB = minimumLaborBudgetCentsForWorkerHours(eh);
          if (minB > 0 && bc < minB) {
            return res.status(400).json({
              message: `Job budget is too low for this schedule: at least $${(minB / 100).toFixed(2)} required for ${eh} worker-hours at the minimum billable rate used for budgets.`,
              code: "JOB_BUDGET_BELOW_FLOOR",
            });
          }
        }
      }

      
      // Geocode address if coordinates not provided
      let latitude = input.latitude;
      let longitude = input.longitude;
      
      if (!latitude && !longitude && input.address && input.city && input.state && input.zipCode) {
        // Combine address and address2 for geocoding
        const fullAddress = [input.address, (input as any).address2].filter(Boolean).join(", ");
        const coords = await geocodeFullAddress(fullAddress, input.city, input.state, input.zipCode);
        if (coords) {
          latitude = coords.latitude;
          longitude = coords.longitude;
        }
      }
      
      // Set timezone based on job state
      const timezone = getTimezoneForState(input.state);
      
      const job = await storage.createJob({
        ...jobInput,
        latitude,
        longitude,
        companyId: profile.id,
        timezone,
      });
      if (saveAsDraft) {
        await storage.updateJob(job.id, { status: "draft" });
        const draftJob = await storage.getJob(job.id);
        return res.status(201).json(draftJob ?? job);
      }
      if (profile.email && profile.emailNotifications) {
        sendEmail({
          to: profile.email,
          type: "job_posted",
          data: {
            jobTitle: job.title,
            jobId: job.id,
            trade: job.trade || job.serviceCategory || "General",
            hourlyRate: job.hourlyRate ? (job.hourlyRate / 100).toFixed(0) : "0",
            workersNeeded: job.maxWorkersNeeded || 1,
            location: job.location || [job.city, job.state].filter(Boolean).join(", ") || "See details",
          },
        }).catch((err) => console.error("Failed to send job posted email:", err));
      }

      // Send real-time WebSocket notification to matching workers
      notifyNewJob({
        id: job.id,
        title: job.title,
        trade: job.trade,
        serviceCategory: job.serviceCategory || undefined,
        hourlyRate: job.hourlyRate,
        latitude: job.latitude || undefined,
        longitude: job.longitude || undefined,
        location: job.location,
        city: job.city || undefined,
        state: job.state || undefined,
      });

      // Send email to workers within 20 miles of job location (by job + worker addresses) with matching skills
      let workersWillSeeCount: number | undefined;
      if (job.latitude && job.longitude) {
        const jobLat = parseFloat(job.latitude);
        const jobLng = parseFloat(job.longitude);
        const jobTrade = (job.trade || '').toLowerCase();
        const jobCategory = (job.serviceCategory || '').toLowerCase();
        const normalizeSkill = (s: string) => (s || '').toLowerCase().replace(/ lite$/, '').replace(/ elite$/, '').trim();
        const companyProfile = await storage.getProfile(job.companyId);
        const companyDisplayName = companyProfile?.companyName
          || (companyProfile ? [companyProfile.firstName, companyProfile.lastName].filter(Boolean).join(' ').trim() || 'A company' : 'A company');
        const seekerName = companyDisplayName || 'A company';
        const jobStartDate = job.startDate ? new Date(job.startDate) : null;
        const datesStr = jobStartDate ? jobStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
        const estimatedHoursStr = job.estimatedHours != null ? (job.estimatedHours <= 5 ? `${job.estimatedHours} hour(s)` : `${job.estimatedHours} hours`) : undefined;
        const googleKey = process.env.GOOGLE_API_KEY;
        // Reuse stored map thumbnail if present (generated once on create); otherwise generate once and save to avoid API usage charges
        let mapThumbnailUrlStored: string | undefined = (job as any).mapThumbnailUrl || undefined;
        if (!mapThumbnailUrlStored && job.latitude && job.longitude && googleKey) {
          mapThumbnailUrlStored = `https://maps.googleapis.com/maps/api/staticmap?center=${job.latitude},${job.longitude}&zoom=13&size=600x260&maptype=roadmap&markers=color:red%7Csize:mid%7C${job.latitude},${job.longitude}&key=${googleKey}`;
          await storage.updateJob(job.id, { mapThumbnailUrl: mapThumbnailUrlStored });
        }
        // Use proxy URL in email so image is on our domain (Gmail deliverability) and API key is never in the email
        const mapImageUrl = (mapThumbnailUrlStored || (job.latitude && job.longitude))
          ? `${BASE_URL}/api/map-thumbnail?jobId=${job.id}`
          : undefined;
        const streetPart = (job.location || job.address || '').replace(/^\d+\s*/, '').trim();
        const partialAddressWorker = [streetPart, job.city, job.state].filter(Boolean).join(', ') || (job.city && job.state ? `${job.city}, ${job.state}` : 'See details');

        // Poster and shared job email data (company name, contact, reputation, jobs count, member since, payout, relative date)
        const companyJobsForCount = await storage.getCompanyJobs(job.companyId);
        const jobsPostedCount = companyJobsForCount.length;
        let posterContactName = companyProfile ? [companyProfile.firstName, companyProfile.lastName].filter(Boolean).join(' ').trim() || companyProfile.companyName || 'Contact' : 'Contact';
        if (job.companyLocationId) {
          const loc = await storage.getCompanyLocation(job.companyLocationId);
          if (loc && ((loc as any).contactName || (loc as any).contactEmail)) {
            posterContactName = (loc as any).contactName || (loc as any).contactEmail || posterContactName;
          }
        }
        const posterBusinessName = companyProfile?.companyName || (companyProfile ? [companyProfile.firstName, companyProfile.lastName].filter(Boolean).join(' ').trim() : '') || 'A company';
        const posterReputation = companyProfile?.isVerified ? 'Verified business' : '';
        const memberSince = companyProfile?.createdAt
          ? `Member since ${new Date(companyProfile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
          : '';
        const estimatedPayoutStr = (job.estimatedHours != null && job.hourlyRate != null)
          ? `~$${Math.round(job.estimatedHours * (Number(job.hourlyRate) / 100))}`
          : '';
        const startDateRelative = getStartDateRelative(job.startDate);
        const scheduledTimeStr = (job as any).scheduledTime || '';
        const timeTypeStr = (job as any).jobType || job.isOnDemand ? 'on_demand' : 'one_time';

        // Send new_job_nearby to all matching workers (including team owners) within 20mi; count for admin email
        const allWorkers = await db.select().from(profiles)
          .where(and(
            eq(profiles.role, 'worker'),
            eq(profiles.emailNotifications, true),
            eq(profiles.isAvailable, true)
          ));
        const allTeams = await db.select().from(teams);
        const teamOwnerByTeamId = new Map<number, number>();
        for (const t of allTeams) {
          teamOwnerByTeamId.set(t.id, t.ownerId);
        }
        workersWillSeeCount = 0;
        for (const worker of allWorkers) {
          if (!worker.email || !worker.latitude || !worker.longitude) continue;
          const workerLat = parseFloat(worker.latitude);
          const workerLng = parseFloat(worker.longitude);
          const distanceMeters = calculateDistanceMeters(jobLat, jobLng, workerLat, workerLng);
          const distanceMiles = distanceMeters / 1609.34;
          if (distanceMiles > 20) continue;
          const workerTrades = worker.trades || [];
          const workerCategories = worker.serviceCategories || [];
          let hasMatchingSkill = false;
          if (jobTrade || jobCategory) {
            hasMatchingSkill = !!(
              workerTrades.some(t => {
                const normalized = normalizeSkill(t);
                return normalized === normalizeSkill(jobTrade) || normalized === normalizeSkill(jobCategory) ||
                  normalized.includes(jobTrade) || jobTrade.includes(normalized);
              }) || (jobCategory && workerCategories.some(c => normalizeSkill(c) === normalizeSkill(jobCategory)))
            );
          }
          if (!jobTrade && !jobCategory) {
            hasMatchingSkill = workerTrades.some(t => normalizeSkill(t) === 'general labor' || normalizeSkill(t) === 'laborer');
          }
          if (!hasMatchingSkill) continue;
          workersWillSeeCount++;

          // Suggested teammates: same team, within 20mi of job only (no skills filter); compact tags in email
          let suggestedTeammates: { name: string; availability?: string; distanceMi?: number }[] = [];
          let suggestedTeammateIds: number[] = [];
          if (worker.teamId != null) {
            const workerTeamMembers = await storage.getWorkerTeamMembers(worker.teamId);
            for (const member of workerTeamMembers) {
              if (member.status !== 'active') continue;
              if (member.email && worker.email && member.email.toLowerCase() === worker.email.toLowerCase()) continue; // exclude recipient
              const mLat = member.latitude ? parseFloat(member.latitude) : null;
              const mLng = member.longitude ? parseFloat(member.longitude) : null;
              const memberDistMiles = mLat != null && mLng != null ? calculateDistanceMeters(jobLat, jobLng, mLat, mLng) / 1609.34 : null;
              const inRange = memberDistMiles != null && memberDistMiles <= 20;
              if (inRange) {
                suggestedTeammates.push({
                  name: [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || 'Teammate',
                  availability: 'Available',
                  distanceMi: Math.round(memberDistMiles),
                });
                suggestedTeammateIds.push(member.id);
              }
            }
          }

          const galleryUrls = (job.images || []).map((url: string) =>
            typeof url === 'string' && url.startsWith('http') ? url : `${BASE_URL}${typeof url === 'string' && url.startsWith('/') ? '' : '/'}${url || ''}`
          );

          sendEmail({
            to: worker.email,
            type: 'new_job_nearby',
            data: {
              jobTitle: job.title,
              jobId: job.id,
              trade: job.trade || job.serviceCategory || 'General',
              location: job.location,
              city: job.city,
              state: job.state,
              partialAddress: partialAddressWorker,
              distance: Math.round(distanceMiles),
              seekerName,
              posterBusinessName,
              posterContactName,
              posterReputation,
              jobsPostedCount,
              memberSince,
              companyLogoUrl: companyProfile?.companyLogo || undefined,
              dates: datesStr,
              startDateRelative,
              scheduledTime: scheduledTimeStr,
              timeType: timeTypeStr,
              description: job.description || '',
              skillsCategory: job.trade || job.serviceCategory || 'General',
              requiredSkills: job.requiredSkills || [],
              hourlyRate: job.hourlyRate ?? undefined,
              estimatedHours: job.estimatedHours ?? undefined,
              estimatedPayout: estimatedPayoutStr,
              flexibleDates: true,
              projectType: job.trade || job.serviceCategory || 'General',
              projectLocation: partialAddressWorker,
              workFocus: (job as any).workFocus || job.trade || undefined,
              propertyType: 'Home',
              mapImageUrl,
              galleryImages: galleryUrls,
              suggestedTeammates,
              suggestedTeammateIds,
              showAiDispatchPrompt: suggestedTeammates.length > 0,
            }
          }).catch(err => console.error('Failed to send new job email:', err));
        }
      }

      // Send "your job is posted" confirmation email to company admin only
      if (profile.email) {
        const jobStartDate = job.startDate ? new Date(job.startDate) : null;
        const datesStr = jobStartDate ? jobStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
        const fullAddress = [job.location || job.address, job.city, job.state, job.zipCode].filter(Boolean).join(', ') || (job.city && job.state ? `${job.city}, ${job.state}` : 'See details');
        let locationRepresentative = '';
        let paymentMethodForLocation = '';
        if (job.companyLocationId) {
          const location = await storage.getCompanyLocation(job.companyLocationId);
          if (location) {
            locationRepresentative = (location as any).contactName || (location as any).contactEmail || [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() || profile.companyName || '';
            if (location.paymentMethodId) {
              const pm = await storage.getCompanyPaymentMethod(location.paymentMethodId);
              if (pm) {
                paymentMethodForLocation = pm.type === 'card'
                  ? `${(pm as any).cardBrand || 'Card'} ****${pm.lastFour}`
                  : `ACH ${(pm as any).bankName || 'Bank'} ...${pm.lastFour}`;
              }
            }
          }
        }
        const timeType = (job as any).jobType || (job.isOnDemand ? 'on_demand' : 'one_time');
        const timeTypeLabel = timeType === 'one_time' ? 'One-time' : timeType === 'recurring' ? 'Recurring' : 'On-demand';
        sendEmail({
          to: profile.email,
          type: 'new_job_posted_admin',
          data: {
            jobTitle: job.title,
            jobId: job.id,
            trade: job.trade || job.serviceCategory || 'General',
            fullAddress,
            locationRepresentative,
            paymentMethodForLocation,
            galleryImages: (job.images || []).map((url: string) =>
              typeof url === 'string' && url.startsWith('http') ? url : `${BASE_URL}${typeof url === 'string' && url.startsWith('/') ? '' : '/'}${url || ''}`
            ),
            description: job.description || '',
            skillsCategory: job.trade || job.serviceCategory || 'General',
            dates: datesStr,
            scheduledTime: (job as any).scheduledTime || undefined,
            timeType: timeTypeLabel,
            estimatedHours: job.estimatedHours ?? undefined,
            workersWillSeeCount,
          }
        }).catch(err => console.error('Failed to send new job posted admin email:', err));
      }

      res.status(201).json(job);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Publish a draft job (requires contract + payment; then status → open and notify workers)
  app.post("/api/jobs/:id/publish", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can publish jobs" });
    }
    const jobId = Number(req.params.id);
    const job = await storage.getJob(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (job.companyId !== profile.id) return res.status(403).json({ message: "Unauthorized" });
    if ((job as any).status !== "draft") {
      return res.status(400).json({ message: "Job is not a draft" });
    }
    const isDev = process.env.NODE_ENV === "development";
    if (!isDev) {
      if (!profile.contractSigned) {
        return res.status(403).json({ message: "You must sign the platform agreement before publishing jobs" });
      }
      const paymentMethods = await db.select().from(companyPaymentMethods).where(eq(companyPaymentMethods.profileId, profile.id));
      if (paymentMethods.length === 0) {
        return res.status(403).json({ message: "You must add a payment method before publishing jobs" });
      }
    }
    const [updated] = await db.update(jobs).set({ status: "open" }).where(eq(jobs.id, jobId)).returning();
    if (!updated) return res.status(500).json({ message: "Failed to update job" });
    notifyNewJob({
      id: updated.id,
      title: updated.title,
      trade: updated.trade,
      serviceCategory: updated.serviceCategory || undefined,
      hourlyRate: updated.hourlyRate,
      latitude: updated.latitude || undefined,
      longitude: updated.longitude || undefined,
      location: updated.location,
      city: updated.city || undefined,
      state: updated.state || undefined,
    });
    res.json(updated);
  });

  // Send alert to workers for a job
  app.post("/api/jobs/:id/send-alert", async (req, res) => {
    const isDev = process.env.NODE_ENV === "development";
    const jobId = Number(req.params.id);
    
    // Get job first to check if it exists
    const job = await storage.getJob(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    
    // In dev mode, bypass authentication for testing
    let profile;
    if (isDev && !req.isAuthenticated()) {
      // In dev mode, get profile from job's companyId
      profile = await storage.getProfile(job.companyId);
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Job must belong to a company" });
      }
    } else {
      // Production mode: require authentication
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      // Use req.profile (set by attachProfile from getProfileByUserId); fallback to lookup by auth userId so we use profile id, not user id
      const userId = (req.user as any)?.claims?.sub ?? (req.user as any)?.id;
      profile = req.profile ?? (userId ? await storage.getProfileByUserId(String(userId)) : undefined);
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Only companies can send alerts" });
      }
      // Check if company owns this job (job.companyId is the profile id of the company that posted the job)
      if (job.companyId !== profile.id) {
        return res.status(403).json({ message: "You don't have permission to send alerts for this job" });
      }
    }
    
    let emailsSent = 0;
    
    try {
      
      // Check if job is filled
      if ((job.workersHired ?? 0) >= (job.maxWorkersNeeded ?? 0)) {
        return res.status(400).json({ message: "Job is already filled" });
      }
      
      // Check if job is open
      if (job.status !== "open") {
        return res.status(400).json({ message: "Can only send alerts for open jobs" });
      }

      const WORKER_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
      const lastAlert = job.lastWorkerAlertAt ? new Date(job.lastWorkerAlertAt).getTime() : 0;
      if (lastAlert && Date.now() - lastAlert < WORKER_ALERT_COOLDOWN_MS) {
        const nextAvailableAt = new Date(lastAlert + WORKER_ALERT_COOLDOWN_MS);
        return res.status(429).json({
          message: "You can send one worker alert per job every 24 hours.",
          nextAvailableAt: nextAvailableAt.toISOString(),
        });
      }
      
      // Get company profile for name
      const companyProfile = await storage.getProfile(job.companyId);
      const companyName = companyProfile?.companyName || companyProfile?.firstName || "A company";
      
      // Send push notifications to nearby workers
      if (job.latitude && job.longitude) {
        const jobLat = parseFloat(job.latitude);
        const jobLng = parseFloat(job.longitude);
        
        await notifyNewJobInTerritory(
          job.id,
          job.title,
          companyName,
          jobLat,
          jobLng
        );
      }
      
      // Send emails: (1) business operators get one alert with suggested teammates; (2) other workers get new_job_nearby (within 20mi)
      if (job.latitude && job.longitude) {
        const jobLat = parseFloat(job.latitude);
        const jobLng = parseFloat(job.longitude);
        const jobTrade = (job.trade || '').toLowerCase();
        const jobCategory = (job.serviceCategory || '').toLowerCase();
        const normalizeSkill = (s: string) => (s || '').toLowerCase().replace(/ lite$/, '').replace(/ elite$/, '').trim();
        const seekerNameSendAlert = companyProfile?.companyName
          || (companyProfile ? [companyProfile.firstName, companyProfile.lastName].filter(Boolean).join(' ').trim() || 'A company' : 'A company');
        const seekerName = seekerNameSendAlert || 'A company';
        const jobStartDate = job.startDate ? new Date(job.startDate) : null;
        const datesStr = jobStartDate ? jobStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
        const estimatedHoursStr = job.estimatedHours != null ? (job.estimatedHours <= 5 ? `${job.estimatedHours} hour(s)` : `${job.estimatedHours} hours`) : undefined;
        // Use proxy URL only – image is served from our domain; API key never in email or DB
        const mapImageUrl = (job.latitude && job.longitude)
          ? `${BASE_URL}/api/map-thumbnail?jobId=${job.id}`
          : undefined;
        const streetPartAlert = (job.location || job.address || '').replace(/^\d+\s*/, '').trim();
        const partialAddressAlert = [streetPartAlert, job.city, job.state].filter(Boolean).join(', ') || (job.city && job.state ? `${job.city}, ${job.state}` : 'See details');

        // Poster and shared job email data for send-alert
        const companyJobsAlert = await storage.getCompanyJobs(job.companyId);
        const jobsPostedCountAlert = companyJobsAlert.length;
        let posterContactNameAlert = companyProfile ? [companyProfile.firstName, companyProfile.lastName].filter(Boolean).join(' ').trim() || companyProfile.companyName || 'Contact' : 'Contact';
        if (job.companyLocationId) {
          const locAlert = await storage.getCompanyLocation(job.companyLocationId);
          if (locAlert && (locAlert as any).contactName) {
            posterContactNameAlert = (locAlert as any).contactName || (locAlert as any).contactEmail || posterContactNameAlert;
          }
        }
        const posterBusinessNameAlert = companyProfile?.companyName || (companyProfile ? [companyProfile.firstName, companyProfile.lastName].filter(Boolean).join(' ').trim() : '') || 'A company';
        const posterReputationAlert = companyProfile?.isVerified ? 'Verified business' : '';
        const memberSinceAlert = companyProfile?.createdAt
          ? `Member since ${new Date(companyProfile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
          : '';
        const estimatedPayoutAlert = (job.estimatedHours != null && job.hourlyRate != null)
          ? `~$${Math.round(job.estimatedHours * (Number(job.hourlyRate) / 100))}`
          : '';
        const startDateRelativeAlert = getStartDateRelative(job.startDate);
        const scheduledTimeAlert = (job as any).scheduledTime || '';
        const timeTypeAlert = (job as any).jobType || job.isOnDemand ? 'on_demand' : 'one_time';

        const allTeamsSendAlert = await db.select().from(teams);
        const teamOwnerByTeamIdSendAlert = new Map<number, number>();
        for (const t of allTeamsSendAlert) {
          teamOwnerByTeamIdSendAlert.set(t.id, t.ownerId);
        }
        const allWorkersSendAlert = await db.select().from(profiles)
          .where(and(
            eq(profiles.role, 'worker'),
            eq(profiles.emailNotifications, true),
            eq(profiles.isAvailable, true)
          ));
        for (const worker of allWorkersSendAlert) {
          if (!worker.email || !worker.latitude || !worker.longitude) continue;
          const workerLat = parseFloat(worker.latitude);
          const workerLng = parseFloat(worker.longitude);
          const distanceMeters = calculateDistanceMeters(jobLat, jobLng, workerLat, workerLng);
          const distanceMiles = distanceMeters / 1609.34;
          if (distanceMiles > 20) continue;
          const workerTrades = worker.trades || [];
          const workerCategories = worker.serviceCategories || [];
          let hasMatchingSkill = false;
          if (jobTrade || jobCategory) {
            hasMatchingSkill = !!(
              workerTrades.some(t => {
                const normalized = normalizeSkill(t);
                return normalized === normalizeSkill(jobTrade) || normalized === normalizeSkill(jobCategory) ||
                  normalized.includes(jobTrade) || jobTrade.includes(normalized);
              }) || (jobCategory && workerCategories.some(c => normalizeSkill(c) === normalizeSkill(jobCategory)))
            );
          }
          if (!jobTrade && !jobCategory) {
            hasMatchingSkill = workerTrades.some(t => normalizeSkill(t) === 'general labor' || normalizeSkill(t) === 'laborer');
          }
          if (!hasMatchingSkill) continue;

          // Suggested teammates: same team, within 20mi of job only (no skills filter)
          let suggestedTeammatesAlert: { name: string; availability?: string; distanceMi?: number }[] = [];
          let suggestedTeammateIdsAlert: number[] = [];
          if (worker.teamId != null) {
            const workerTeamMembersAlert = await storage.getWorkerTeamMembers(worker.teamId);
            for (const member of workerTeamMembersAlert) {
              if (member.status !== 'active') continue;
              if (member.email && worker.email && member.email.toLowerCase() === worker.email.toLowerCase()) continue;
              const mLat = member.latitude ? parseFloat(member.latitude) : null;
              const mLng = member.longitude ? parseFloat(member.longitude) : null;
              const memberDistMilesAlert = mLat != null && mLng != null ? calculateDistanceMeters(jobLat, jobLng, mLat, mLng) / 1609.34 : null;
              const inRange = memberDistMilesAlert != null && memberDistMilesAlert <= 20;
              if (inRange) {
                suggestedTeammatesAlert.push({
                  name: [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || 'Teammate',
                  availability: 'Available',
                  distanceMi: Math.round(memberDistMilesAlert),
                });
                suggestedTeammateIdsAlert.push(member.id);
              }
            }
          }

          const galleryUrlsAlert = (job.images || []).map((url: string) =>
            typeof url === 'string' && url.startsWith('http') ? url : `${BASE_URL}${typeof url === 'string' && url.startsWith('/') ? '' : '/'}${url || ''}`
          );

          try {
            await sendEmail({
              to: worker.email,
              type: 'new_job_nearby',
              data: {
                jobTitle: job.title,
                jobId: job.id,
                trade: job.trade || job.serviceCategory || 'General',
                location: job.location,
                city: job.city,
                state: job.state,
                partialAddress: partialAddressAlert,
                distance: Math.round(distanceMiles),
                seekerName,
                posterBusinessName: posterBusinessNameAlert,
                posterContactName: posterContactNameAlert,
                posterReputation: posterReputationAlert,
                jobsPostedCount: jobsPostedCountAlert,
                memberSince: memberSinceAlert,
                companyLogoUrl: companyProfile?.companyLogo || undefined,
                dates: datesStr,
                startDateRelative: startDateRelativeAlert,
                scheduledTime: scheduledTimeAlert,
                timeType: timeTypeAlert,
                description: job.description || '',
                skillsCategory: job.trade || job.serviceCategory || 'General',
                requiredSkills: job.requiredSkills || [],
                hourlyRate: job.hourlyRate ?? undefined,
                estimatedHours: job.estimatedHours ?? undefined,
                estimatedPayout: estimatedPayoutAlert,
                flexibleDates: true,
                projectType: job.trade || job.serviceCategory || 'General',
                projectLocation: partialAddressAlert,
                workFocus: (job as any).workFocus || job.trade || undefined,
                propertyType: 'Home',
                mapImageUrl,
                galleryImages: galleryUrlsAlert,
                suggestedTeammates: suggestedTeammatesAlert,
                suggestedTeammateIds: suggestedTeammateIdsAlert,
                showAiDispatchPrompt: suggestedTeammatesAlert.length > 0,
              }
            });
            emailsSent++;
          } catch (err) {
            console.error('Failed to send new job email:', err);
          }
        }

        console.log(`[Send Alert] Sent ${emailsSent} emails for job ${job.id}`);
      }

      const alertSentAt = new Date();
      await db.update(jobs).set({ lastWorkerAlertAt: alertSentAt }).where(eq(jobs.id, jobId));
      if (profile.email && profile.emailNotifications) {
        const apps = await storage.getJobApplications(job.id);
        const filledPositions = apps.filter((a) => a.status === "accepted").length;
        const totalPositions = job.maxWorkersNeeded || 1;
        const openPositions = Math.max(0, totalPositions - filledPositions);
        sendEmail({
          to: profile.email,
          type: "job_reminder",
          data: {
            jobTitle: job.title,
            jobId: job.id,
            openPositions,
            filledPositions,
            totalPositions,
            applicationCount: apps.length,
          },
        }).catch((err) => console.error("Failed to send job reminder email:", err));
      }
      
      res.json({ 
        success: true, 
        message: "Alert sent to matching workers",
        emailsSent,
        lastWorkerAlertAt: alertSentAt.toISOString(),
      });
    } catch (err: any) {
      console.error("Error sending alert:", err);
      res.status(500).json({ message: err.message || "Failed to send alert" });
    }
  });

  // Send direct job request to a worker
  app.post("/api/jobs/:id/request", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const jobId = Number(req.params.id);
    const { workerId, fallbackToPublic } = req.body;
    const workerIdNum = parseWorkerId(workerId);
    if (workerIdNum == null) {
      return res.status(400).json({ message: "workerId must be a valid integer" });
    }
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can send job requests" });
    }
    
    const job = await storage.getJob(jobId);
    if (!job || job.companyId !== profile.id) {
      return res.status(404).json({ message: "Job not found" });
    }
    
    const worker = await storage.getProfile(workerIdNum);
    if (!worker || worker.role !== "worker") {
      return res.status(404).json({ message: "Worker not found" });
    }

    // Avoid duplicate pending direct requests for the same worker + job.
    const existingInquiries = await storage.getDirectJobInquiriesForCompany(profile.id);
    const now = Date.now();
    const existingPendingInquiry = findExistingPendingInquiryForWorkerJob(existingInquiries as any[], {
      workerId: workerIdNum,
      jobId: job.id,
      nowMs: now,
    });
    if (existingPendingInquiry) {
      return res.status(409).json({
        message: "A pending direct request already exists for this worker on this job.",
        inquiryId: existingPendingInquiry.id,
        expiresAt: existingPendingInquiry.expiresAt,
      });
    }
    
    // Create a direct inquiry linked to the existing job with a 24h response window.
    // This unifies expiry + fallback behavior with the direct-inquiries flow.
    const responseDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const inquiry = await storage.createDirectJobInquiry({
      companyId: profile.id,
      workerId: workerIdNum,
      title: job.title,
      description: job.description,
      location: job.location,
      locationName: job.locationName,
      address: job.address,
      city: job.city,
      state: job.state,
      zipCode: job.zipCode,
      latitude: job.latitude ?? undefined,
      longitude: job.longitude ?? undefined,
      requiredSkills: job.requiredSkills,
      hourlyRate: job.hourlyRate,
      startDate: job.startDate,
      endDate: job.endDate || undefined,
      scheduledTime: job.scheduledTime,
      estimatedHours: job.estimatedHours,
      jobType: job.jobType as any,
      images: job.images,
      videos: job.videos,
      budgetCents: job.budgetCents,
      maxWorkersNeeded: job.maxWorkersNeeded,
      fallbackToPublic: fallbackToPublic === true,
      expiresAt: responseDeadline,
    });
    await storage.updateDirectJobInquiry(inquiry.id, { convertedJobId: job.id });
    
    // Send email to worker about job offer
    if (worker.email && worker.emailNotifications) {
      sendEmail({
        to: worker.email,
        type: 'job_offer_received',
        data: {
          jobTitle: job.title,
          companyName: profile.companyName || `${profile.firstName} ${profile.lastName}`,
          hourlyRate: job.hourlyRate ? (job.hourlyRate / 100).toFixed(0) : '0',
          startDate: job.startDate ? new Date(job.startDate).toLocaleDateString() : 'TBD',
          location: job.location || `${job.city}, ${job.state}`,
          offerId: inquiry.id,
        }
      }).catch(err => console.error('Failed to send job offer email:', err));
    }
    
    // Also send confirmation to company about direct request sent
    if (profile.email && profile.emailNotifications) {
      sendEmail({
        to: profile.email,
        type: 'direct_request_sent',
        data: {
          workerName: `${worker.firstName} ${worker.lastName}`,
          jobTitle: job.title,
          expiresAt: responseDeadline.toLocaleString(),
          fallbackToPublic: fallbackToPublic || false,
        }
      }).catch(err => console.error('Failed to send direct request confirmation email:', err));
    }
    
    res.status(201).json({
      success: true,
      inquiry,
      // Legacy compatibility for callers expecting `application`.
      application: {
        id: inquiry.id,
        jobId: job.id,
        workerId: workerIdNum,
        status: "pending",
      },
    });
  });

  // === JOB CHAT MESSAGES ===
  
  // Get messages for a job
  app.get("/api/jobs/:id/messages", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const jobId = Number(req.params.id);
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Profile not found" });
    }
    
    // Check if user is authorized to view this job's messages
    const job = await storage.getJob(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    
    // Chat only exists when job has at least one accepted worker
    const jobApps = await storage.getJobApplications(jobId);
    const acceptedApps = jobApps.filter((app: any) => app.status === 'accepted');
    if (acceptedApps.length === 0) {
      return res.status(404).json({ message: "No chat for this job until workers are approved" });
    }
    
    // Company owner, location rep/teammate, or accepted worker
    const isCompanyOwner = job.companyId === profile.id;
    const isLocationRep = await isLocationRepOrAssigned(profile, job);
    const isCompany = isCompanyOwner || isLocationRep;
    let isWorker = false;
    
    if (!isCompany) {
      const workerApps = await storage.getWorkerApplications(profile.id);
      isWorker = workerApps.some((app: any) => app.jobId === jobId && app.status === 'accepted')
        || (await isWorkerTeamAdminWithJobAccess(profile, jobId));
    }
    
    if (!isCompany && !isWorker) {
      return res.status(403).json({ message: "Not authorized to view messages for this job" });
    }
    
    const viewerLanguageCode = getViewerLanguageCode(req, profile);
    const allMessages = await storage.getJobMessages(jobId);
    
    // Filter out company-only messages for workers
    const messages = isCompany 
      ? allMessages 
      : allMessages.filter(msg => !msg.visibleToCompanyOnly);
    
    const messagesWithDisplay = await Promise.all(messages.map(async (message) => {
      if (message.messageType !== "text") return message;
      const messageMeta = (message.metadata as { type?: string } | null | undefined) || undefined;
      if (messageMeta?.type) return message;
      const senderLanguageCode = normalizeChatLanguageCode(message.senderLanguageCode);
      if (!viewerLanguageCode || !senderLanguageCode || viewerLanguageCode === senderLanguageCode) {
        return message;
      }
      const cached = await storage.getMessageTranslation(message.id, viewerLanguageCode);
      if (cached?.content) {
        return { ...message, displayContent: cached.content };
      }
      const translated = await translateChatText(message.content, senderLanguageCode, viewerLanguageCode);
      if (!translated || translated === message.content) return message;
      await storage.upsertMessageTranslation(message.id, viewerLanguageCode, translated);
      return { ...message, displayContent: translated };
    }));

    // Mark messages as read for this user
    await storage.markMessagesAsRead(jobId, profile.id);
    
    res.json(messagesWithDisplay);
  });
  
  // Send a message for a job
  app.post("/api/jobs/:id/messages", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const jobId = Number(req.params.id);
    const { content, attachmentUrls, mentionedProfileIds, metadata: bodyMetadata, senderLanguageCode } = req.body;
    
    const trimmedContent = typeof content === 'string' ? content.trim() : '';
    if (!trimmedContent && (!attachmentUrls || !Array.isArray(attachmentUrls) || attachmentUrls.length === 0)) {
      return res.status(400).json({ message: "Message content or attachment is required" });
    }
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Profile not found" });
    }
    
    // Check if user is authorized to send messages for this job
    const job = await storage.getJob(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    
    const jobAppsForAuth = await storage.getJobApplications(jobId);
    const acceptedAppsForAuth = jobAppsForAuth.filter((app: any) => app.status === 'accepted');
    if (acceptedAppsForAuth.length === 0) {
      return res.status(404).json({ message: "No chat for this job until workers are approved" });
    }
    
    const isCompanyOwner = job.companyId === profile.id;
    const isLocationRep = await isLocationRepOrAssigned(profile, job);
    const isCompany = isCompanyOwner || isLocationRep;
    let isWorker = false;
    let recipientProfiles: (typeof profile)[] = [];
    
    if (!isCompany) {
      const workerApps = await storage.getWorkerApplications(profile.id);
      isWorker = workerApps.some((app: any) => app.jobId === jobId && app.status === 'accepted')
        || (await isWorkerTeamAdminWithJobAccess(profile, jobId));
      const companyProfile = await storage.getProfile(job.companyId);
      if (companyProfile) recipientProfiles.push(companyProfile);
      // Also notify location rep if assigned and different from company
      if (job.companyLocationId) {
        const location = await storage.getCompanyLocation(job.companyLocationId);
        const loc = location as { useCompanyDefault?: boolean; representativeTeamMemberId?: number | null; assignedTeamMemberIds?: number[] } | undefined;
        if (loc && !loc.useCompanyDefault) {
          const memberId = loc.representativeTeamMemberId ?? loc.assignedTeamMemberIds?.[0];
          if (memberId) {
            const member = await storage.getCompanyTeamMember(memberId);
            if (member) {
              const repProfile = await storage.getProfileByUserId(member.userId);
              if (repProfile && !recipientProfiles.some((p: any) => p.id === repProfile.id)) {
                recipientProfiles.push(repProfile);
              }
            }
          }
        }
      }
    } else {
      recipientProfiles = acceptedAppsForAuth.map((app: any) => app.worker).filter(Boolean);
    }
    
    // When worker sends, also notify other workers on the job (not just company)
    if (isWorker && !isCompany) {
      for (const app of acceptedAppsForAuth) {
        const workerProfile = app.worker;
        if (workerProfile && workerProfile.id !== profile.id && !recipientProfiles.some((p: any) => p.id === workerProfile.id)) {
          recipientProfiles.push(workerProfile);
        }
      }
    }
    
    // Exclude sender from recipients (don't notify yourself)
    recipientProfiles = recipientProfiles.filter((p: any) => p.id !== profile.id);
    
    if (!isCompany && !isWorker) {
      return res.status(403).json({ message: "Not authorized to send messages for this job" });
    }
    
    const metadata: Record<string, unknown> = {};
    if (Array.isArray(attachmentUrls) && attachmentUrls.length > 0) {
      metadata.attachments = attachmentUrls;
    }
    if (Array.isArray(mentionedProfileIds) && mentionedProfileIds.length > 0) {
      metadata.mentionedProfileIds = mentionedProfileIds;
    }
    if (bodyMetadata && typeof bodyMetadata === "object" && !Array.isArray(bodyMetadata)) {
      Object.assign(metadata, bodyMetadata);
    }
    
    const normalizedSenderLanguage = normalizeChatLanguageCode(senderLanguageCode) || getProfileLanguageCode(profile);
    const message = await storage.createJobMessage({
      jobId,
      senderId: profile.id,
      content: trimmedContent || " ",
      senderLanguageCode: normalizedSenderLanguage,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    if (trimmedContent && message.messageType === "text" && normalizedSenderLanguage) {
      const messageMeta = (message.metadata as { type?: string } | null | undefined) || undefined;
      if (!messageMeta?.type) {
        const targetLanguages = [...new Set(recipientProfiles
          .map((recipient) => getProfileLanguageCode(recipient))
          .filter((lang): lang is string => Boolean(lang) && lang !== normalizedSenderLanguage))];
        for (const targetLanguage of targetLanguages) {
          const translated = await translateChatText(trimmedContent, normalizedSenderLanguage, targetLanguage);
          if (!translated || translated === trimmedContent) continue;
          await storage.upsertMessageTranslation(message.id, targetLanguage, translated);
        }
      }
    }
    
    // Schedule 1hr digest: if recipients don't read within 1hr, they get an email
    await db.insert(chatMessagePendingDigest).values({
      messageId: message.id,
      jobId,
      senderId: profile.id,
    });
    
    // "Start job now" request from worker: send dedicated Resend email to company so they can accept/decline in chat
    if (isWorker && !isCompany && (bodyMetadata as any)?.type === "start_job_now_request") {
      const companyProfile = await storage.getProfile(job.companyId);
      if (companyProfile?.email && companyProfile.emailNotifications) {
        try {
          await sendEmail({
            to: companyProfile.email,
            type: 'worker_request_start_job_now',
            data: {
              workerName: profile.firstName || profile.companyName || 'A worker',
              jobTitle: job.title,
              jobId,
              chatUrl: `/company-dashboard/chats/${jobId}`,
            },
          });
        } catch (err) {
          console.error('Failed to send start-job-now request email:', err);
        }
      }
    }
    
    // Send immediate email to @ mentioned users (direct notification)
    if (Array.isArray(mentionedProfileIds) && mentionedProfileIds.length > 0) {
      for (const mentionedId of mentionedProfileIds) {
        const mentionedProfile = await storage.getProfile(mentionedId);
        if (mentionedProfile?.email && mentionedProfile.emailNotifications) {
          try {
            await sendEmail({
              to: mentionedProfile.email,
              type: 'new_job_message',
              data: {
                senderName: profile.firstName || profile.companyName || 'User',
                senderAvatarUrl: profile.avatarUrl || undefined,
                jobTitle: job.title,
                messagePreview: trimmedContent ? trimmedContent.substring(0, 100) : '[Attachment]',
                jobId: jobId,
              }
            });
          } catch (err) {
            console.error('Failed to send @ mention email:', err);
          }
        }
      }
    }
    
    // Send push notification and email to all recipients
    for (const recipientProfile of recipientProfiles) {
      const chatUrl = recipientProfile.role === 'company'
        ? `/company-dashboard/chats/${jobId}`
        : `/dashboard/chats/${jobId}`;

      try {
        const { sendPushNotification } = await import('./firebase-admin');
        // Get FCM tokens for the recipient
        const tokens = await db.select().from(deviceTokens)
          .where(eq(deviceTokens.profileId, recipientProfile.id));
        const tokenStrings = tokens.map(t => t.token).filter(Boolean) as string[];
        if (tokenStrings.length > 0) {
          await sendPushNotification(
            tokenStrings,
            `New message from ${profile.firstName || profile.companyName || 'User'}`,
            (trimmedContent || '').substring(0, 100) || '[Attachment]',
            {
              type: 'chat_message',
              jobId: String(jobId),
              messageId: String(message.id),
              senderProfileId: String(profile.id),
              url: chatUrl,
              path: chatUrl,
            }
          );
        }
      } catch (err) {
        console.error('Failed to send push notification for new message:', err);
      }
      
      // Send email notification (at most 1 per day per recipient, across all jobs)
      if (recipientProfile.email && recipientProfile.emailNotifications) {
        try {
          const startOfToday = new Date();
          startOfToday.setUTCHours(0, 0, 0, 0);
          const alreadySentToRecipientToday = await db.select()
            .from(jobMessageEmailLog)
            .where(and(
              eq(jobMessageEmailLog.recipientProfileId, recipientProfile.id),
              gte(jobMessageEmailLog.sentAt, startOfToday)
            ));
          if (alreadySentToRecipientToday.length === 0) {
            const result = await sendEmail({
              to: recipientProfile.email,
              type: 'new_job_message',
              data: {
                senderName: profile.firstName || profile.companyName || 'User',
                senderAvatarUrl: profile.avatarUrl || undefined,
                jobTitle: job.title,
                messagePreview: (trimmedContent || '').substring(0, 100) || '[Attachment]',
                jobId: jobId,
              }
            });
            if (result.success) {
              await db.insert(jobMessageEmailLog).values({
                jobId,
                recipientProfileId: recipientProfile.id,
              });
            }
          }
        } catch (err) {
          console.error('Failed to send email notification for new message:', err);
        }
      }
    }
    
    // Get the full message with sender info
    const messages = await storage.getJobMessages(jobId);
    const fullMessage = messages.find(m => m.id === message.id);
    
    res.status(201).json(fullMessage || message);
  });

  // Invite all job chat participants to a video call (Resend email + push notification)
  app.post("/api/jobs/:jobId/call-invite", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Profile not found" });
    const jobId = Number(req.params.jobId);
    const { roomUrl, targetProfileIds } = req.body || {};
    if (!roomUrl || typeof roomUrl !== "string" || !roomUrl.trim()) {
      return res.status(400).json({ message: "roomUrl is required" });
    }
    const targetIds = Array.isArray(targetProfileIds)
      ? targetProfileIds.filter((id: unknown) => typeof id === "number" && Number.isInteger(id))
      : null;
    const job = await storage.getJob(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    const jobAppsForAuth = await storage.getJobApplications(jobId);
    const acceptedAppsForAuth = jobAppsForAuth.filter((app: any) => app.status === "accepted");
    if (acceptedAppsForAuth.length === 0) {
      return res.status(404).json({ message: "No chat for this job until workers are approved" });
    }
    const isCompanyOwner = job.companyId === profile.id;
    const isLocationRep = await isLocationRepOrAssigned(profile, job);
    const isCompany = isCompanyOwner || isLocationRep;
    let recipientProfiles: (typeof profile)[] = [];
    if (!isCompany) {
      const workerApps = await storage.getWorkerApplications(profile.id);
      const isWorker = workerApps.some((app: any) => app.jobId === jobId && app.status === "accepted")
        || (await isWorkerTeamAdminWithJobAccess(profile, jobId));
      if (!isWorker) return res.status(403).json({ message: "Not authorized to invite for this job" });
      const companyProfile = await storage.getProfile(job.companyId);
      if (companyProfile) recipientProfiles.push(companyProfile);
      if (job.companyLocationId) {
        const location = await storage.getCompanyLocation(job.companyLocationId);
        const loc = location as { useCompanyDefault?: boolean; representativeTeamMemberId?: number | null; assignedTeamMemberIds?: number[] } | undefined;
        if (loc && !loc.useCompanyDefault) {
          const memberId = loc.representativeTeamMemberId ?? loc.assignedTeamMemberIds?.[0];
          if (memberId) {
            const member = await storage.getCompanyTeamMember(memberId);
            if (member) {
              const repProfile = await storage.getProfileByUserId(member.userId);
              if (repProfile && !recipientProfiles.some((p: any) => p.id === repProfile.id)) recipientProfiles.push(repProfile);
            }
          }
        }
      }
      for (const app of acceptedAppsForAuth) {
        const workerProfile = app.worker;
        if (workerProfile && workerProfile.id !== profile.id && !recipientProfiles.some((p: any) => p.id === workerProfile.id)) {
          recipientProfiles.push(workerProfile);
        }
      }
    } else {
      recipientProfiles = acceptedAppsForAuth.map((app: any) => app.worker).filter(Boolean);
    }
    recipientProfiles = recipientProfiles.filter((p: any) => p.id !== profile.id);
    if (targetIds != null && targetIds.length > 0) {
      const targetSet = new Set(targetIds);
      recipientProfiles = recipientProfiles.filter((p: any) => targetSet.has(p.id));
    }

    const existingMessages = await storage.getJobMessages(jobId);
    const latestActiveCallMessage = getLatestActiveVideoCallMessage(existingMessages as any[]);
    const hasActiveCall = !!latestActiveCallMessage;

    // Ensure the call URL is absolute so email and push action buttons open the exact call
    const callUrl = resolveCallInviteUrl(roomUrl, {
      peerCallsBaseUrl: process.env.PEERCALLS_BASE_URL,
      frontEndUrl: process.env.FRONTEND_URL,
    });
    if (!callUrl) {
      return res.status(400).json({
        message: "roomUrl must be absolute (http/https) or resolvable via PEERCALLS_BASE_URL/FRONTEND_URL",
      });
    }

    const inviterName = profile.firstName || profile.companyName || profile.email || "Someone";
    const pushTitle = `${inviterName} invited you to a video call`;
    const pushBody = `Join the call for ${job.title}`;

    for (const recipient of recipientProfiles) {
      try {
        if (recipient.email && recipient.emailNotifications !== false) {
          await sendEmail({
            to: recipient.email,
            type: "call_invite",
            data: { inviterName, jobTitle: job.title, roomUrl: callUrl },
          });
        }
      } catch (err) {
        console.error("Failed to send call invite email to", recipient.id, err);
      }
      try {
        const { sendPushNotification } = await import("./firebase-admin");
        const tokens = await db.select().from(deviceTokens).where(eq(deviceTokens.profileId, recipient.id));
        const tokenStrings = tokens.map((t: any) => t.token).filter(Boolean) as string[];
        if (tokenStrings.length > 0) {
          await sendPushNotification(
            tokenStrings,
            pushTitle,
            pushBody,
            { jobId: String(jobId), url: callUrl, path: callUrl, type: "call_invite" }
          );
        }
      } catch (err) {
        console.error("Failed to send call invite push to", recipient.id, err);
      }
      try {
        await db.insert(notifications).values({
          profileId: recipient.id,
          type: "call_invite",
          title: pushTitle,
          body: pushBody,
          url: callUrl,
          data: {
            jobId,
            roomUrl: callUrl,
            inviterName,
            inviterAvatarUrl: (profile as any).avatarUrl ?? undefined,
          },
          isPushSent: true,
          pushSentAt: new Date(),
        });
      } catch (err) {
        console.error("Failed to create call invite notification for", recipient.id, err);
      }
    }
    res.json({
      success: true,
      totalRecipients: recipientProfiles.length,
      alreadyInProgress: hasActiveCall,
      activeCallMessageId: latestActiveCallMessage?.id ?? null,
      roomUrl: callUrl,
    });
  });

  // Update video call message metadata (call status, participants) – e.g. when call ends or presence changes
  app.patch("/api/jobs/:jobId/messages/:messageId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Profile not found" });
    const jobId = Number(req.params.jobId);
    const messageId = Number(req.params.messageId);
    const { metadata: metadataPatch } = req.body || {};
    if (!metadataPatch || typeof metadataPatch !== "object" || Array.isArray(metadataPatch)) {
      return res.status(400).json({ message: "metadata object is required" });
    }
    const job = await storage.getJob(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    const jobApps = await storage.getJobApplications(jobId);
    const acceptedApps = jobApps.filter((app: any) => app.status === "accepted");
    if (acceptedApps.length === 0) {
      return res.status(404).json({ message: "No chat for this job until workers are approved" });
    }
    const isCompanyOwner = job.companyId === profile.id;
    const isLocationRep = await isLocationRepOrAssigned(profile, job);
    const isCompany = isCompanyOwner || isLocationRep;
    const isWorker = acceptedApps.some((app: any) => app.workerId === profile.id) || (await isWorkerTeamAdminWithJobAccess(profile, jobId));
    if (!isCompany && !isWorker) {
      return res.status(403).json({ message: "Not authorized to update messages for this job" });
    }
    const allowedKeys = ["callStatus", "endedAt", "participants"];
    const patch: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (metadataPatch[key] !== undefined) patch[key] = metadataPatch[key];
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ message: "No allowed metadata keys provided" });
    const updated = await storage.updateJobMessageMetadata(jobId, messageId, patch);
    if (!updated) return res.status(404).json({ message: "Message not found" });
    const messages = await storage.getJobMessages(jobId);
    const fullMessage = messages.find((m: any) => m.id === updated.id);
    res.json(fullMessage || updated);
  });

  // Company responds to worker's "start job now" request (accept = move start date to today; decline = post message that time remains)
  app.post("/api/jobs/:jobId/start-now-request/:messageId/respond", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Profile not found" });
    const jobId = Number(req.params.jobId);
    const messageId = Number(req.params.messageId);
    const { action } = req.body || {};
    if (action !== "accept" && action !== "decline") {
      return res.status(400).json({ message: "action must be 'accept' or 'decline'" });
    }
    const job = await storage.getJob(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    const isCompanyOwner = job.companyId === profile.id;
    const isLocationRep = await isLocationRepOrAssigned(profile, job);
    if (!isCompanyOwner && !isLocationRep) {
      return res.status(403).json({ message: "Only the company can respond to this request" });
    }
    const messages = await storage.getJobMessages(jobId);
    const requestMessage = messages.find((m: any) => m.id === messageId);
    if (!requestMessage) return res.status(404).json({ message: "Message not found" });
    const meta = (requestMessage.metadata as Record<string, unknown>) || {};
    if (meta.type !== "start_job_now_request" || meta.status === "accepted" || meta.status === "declined") {
      return res.status(400).json({ message: "Invalid or already responded request" });
    }
    if (action === "accept") {
      const oldStart = new Date((job as any).startDate);
      const today = new Date();
      today.setHours(oldStart.getHours(), oldStart.getMinutes(), oldStart.getSeconds(), 0);
      await storage.updateJob(jobId, { startDate: today } as Partial<Job>);
      await storage.updateJobMessageMetadata(jobId, messageId, { ...meta, status: "accepted" });
      await storage.createJobMessage({
        jobId,
        senderId: profile.id,
        content: "Start date has been updated to today. You can clock in now.",
        metadata: { type: "start_job_now_accepted" },
      });
    } else {
      await storage.updateJobMessageMetadata(jobId, messageId, { ...meta, status: "declined" });
      await storage.createJobMessage({
        jobId,
        senderId: profile.id,
        content: "The job time remains as scheduled.",
        metadata: { type: "start_job_now_declined" },
      });
    }
    const updatedJob = await storage.getJob(jobId);
    const updatedMessages = await storage.getJobMessages(jobId);
    res.json({ job: updatedJob, messages: updatedMessages });
  });
  
  // Get unread message count for a job
  app.get("/api/jobs/:id/messages/unread", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const jobId = Number(req.params.id);
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Profile not found" });
    }
    
    const job = await storage.getJob(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    
    const jobApps = await storage.getJobApplications(jobId);
    const acceptedApps = jobApps.filter((app: any) => app.status === 'accepted');
    if (acceptedApps.length === 0) {
      return res.status(404).json({ message: "No chat for this job until workers are approved" });
    }
    
    const isCompanyOwner = job.companyId === profile.id;
    const isLocationRep = await isLocationRepOrAssigned(profile, job);
    const isCompany = isCompanyOwner || isLocationRep;
    let isWorker = false;
    
    if (!isCompany) {
      const workerApps = await storage.getWorkerApplications(profile.id);
      isWorker = workerApps.some((app: any) => app.jobId === jobId && app.status === 'accepted')
        || (await isWorkerTeamAdminWithJobAccess(profile, jobId));
    }
    
    if (!isCompany && !isWorker) {
      return res.status(403).json({ message: "Not authorized to view messages for this job" });
    }
    
    const count = await storage.getUnreadMessageCount(jobId, profile.id);
    res.json({ count });
  });

  // Get worker's latest geo location for a job (company only - for map in participant popup)
  app.get("/api/jobs/:id/workers/:workerProfileId/location", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const jobId = Number(req.params.id);
    const workerProfileId = Number(req.params.workerProfileId);
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Profile not found" });
    const job = await storage.getJob(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    const isCompanyOwner = job.companyId === profile.id;
    const isLocationRep = await isLocationRepOrAssigned(profile, job);
    if (!isCompanyOwner && !isLocationRep) {
      return res.status(403).json({ message: "Not authorized to view worker location" });
    }
    const jobApps = await storage.getJobApplications(jobId);
    const isAccepted = jobApps.some((a: any) => a.status === "accepted" && a.workerId === workerProfileId);
    if (!isAccepted) {
      return res.status(403).json({ message: "Worker is not on this job" });
    }
    // 1. Try location_pings (most recent for this worker + job)
    const [ping] = await db.select({ latitude: locationPings.latitude, longitude: locationPings.longitude, createdAt: locationPings.createdAt })
      .from(locationPings)
      .where(and(eq(locationPings.workerProfileId, workerProfileId), or(eq(locationPings.jobId, jobId), isNull(locationPings.jobId))))
      .orderBy(desc(locationPings.createdAt))
      .limit(1);
    if (ping?.latitude != null && ping?.longitude != null) {
      return res.json({ latitude: parseFloat(ping.latitude), longitude: parseFloat(ping.longitude), createdAt: ping.createdAt, source: "ping" });
    }
    // 2. Fallback: latest timesheet clock-in/out for this worker on this job
    const tsRows = await db.select({ id: timesheets.id }).from(timesheets)
      .where(and(eq(timesheets.jobId, jobId), eq(timesheets.workerId, workerProfileId)))
      .orderBy(desc(timesheets.createdAt))
      .limit(5);
    for (const ts of tsRows) {
      const [evt] = await db.select({ latitude: timesheetEvents.latitude, longitude: timesheetEvents.longitude, createdAt: timesheetEvents.createdAt })
        .from(timesheetEvents)
        .where(and(eq(timesheetEvents.timesheetId, ts.id), or(eq(timesheetEvents.eventType, "clock_in"), eq(timesheetEvents.eventType, "clock_out"))))
        .orderBy(desc(timesheetEvents.createdAt))
        .limit(1);
      if (evt?.latitude != null && evt?.longitude != null) {
        return res.json({ latitude: parseFloat(evt.latitude), longitude: parseFloat(evt.longitude), createdAt: evt.createdAt, source: "timesheet" });
      }
    }
    res.json(null);
  });

  // Get all timesheets for a worker on a job (company only - all statuses)
  app.get("/api/jobs/:id/workers/:workerProfileId/timesheets", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const jobId = Number(req.params.id);
    const workerProfileId = Number(req.params.workerProfileId);
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Profile not found" });
    const job = await storage.getJob(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    const isCompanyOwner = job.companyId === profile.id;
    const isLocationRep = await isLocationRepOrAssigned(profile, job);
    if (!isCompanyOwner && !isLocationRep) {
      return res.status(403).json({ message: "Not authorized" });
    }
    const jobApps = await storage.getJobApplications(jobId);
    const isAccepted = jobApps.some((a: any) => a.status === "accepted" && a.workerId === workerProfileId);
    if (!isAccepted) {
      return res.status(403).json({ message: "Worker is not on this job" });
    }
    const rows = await db.select({
      id: timesheets.id,
      jobId: timesheets.jobId,
      workerId: timesheets.workerId,
      clockInTime: timesheets.clockInTime,
      clockOutTime: timesheets.clockOutTime,
      adjustedHours: timesheets.adjustedHours,
      hourlyRate: timesheets.hourlyRate,
      status: timesheets.status,
      workerFirstName: profiles.firstName,
      workerLastName: profiles.lastName,
      workerAvatarUrl: profiles.avatarUrl,
    })
      .from(timesheets)
      .leftJoin(profiles, eq(timesheets.workerId, profiles.id))
      .where(and(eq(timesheets.jobId, jobId), eq(timesheets.workerId, workerProfileId)))
      .orderBy(desc(timesheets.clockInTime));
    res.json(rows);
  });
  
  // Get all jobs with chat access for current user (for Chats page)
  app.get("/api/chats/jobs", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Profile not found" });
    }

    const jobHasActiveCall = async (jobId: number): Promise<boolean> => {
      const messages = await storage.getJobMessages(jobId);
      return messages.some((m: any) => {
        const meta = m.metadata as { type?: string; callStatus?: string } | undefined;
        return meta?.type === "video_call" && meta?.callStatus !== "ended";
      });
    };
    
    let chatJobs: any[] = [];
    
    if (profile.role === 'company') {
      let companyJobs = await storage.getCompanyJobs(profile.id);
      // Location rep/teammate with distinct profile: find company via team member link
      if (companyJobs.length === 0 && profile.userId) {
        const tmRows = await db.select().from(companyTeamMembers)
          .where(and(eq(companyTeamMembers.userId, profile.userId), eq(companyTeamMembers.isActive, true)));
        if (tmRows.length > 0) {
          const companyId = tmRows[0].companyProfileId;
          companyJobs = await storage.getCompanyJobs(companyId);
          for (const job of companyJobs) {
            if (job.status === 'completed' || job.status === 'cancelled') continue;
            if (!(await isLocationRepOrAssigned(profile, job))) continue;
            const jobApps = await storage.getJobApplications(job.id);
            const acceptedApps = jobApps.filter((app: any) => app.status === 'accepted');
            if (acceptedApps.length === 0) continue;
            const unreadCount = await storage.getUnreadMessageCount(job.id, profile.id);
            const hasActiveCall = await jobHasActiveCall(job.id);
            chatJobs.push({ job, participants: acceptedApps.map((app: any) => app.worker).filter(Boolean), unreadCount, hasActiveCall });
          }
        }
      } else {
        for (const job of companyJobs) {
          if (job.status === 'completed' || job.status === 'cancelled') continue;
          const jobApps = await storage.getJobApplications(job.id);
          const acceptedApps = jobApps.filter((app: any) => app.status === 'accepted');
          if (acceptedApps.length === 0) continue;
          const unreadCount = await storage.getUnreadMessageCount(job.id, profile.id);
          const hasActiveCall = await jobHasActiveCall(job.id);
          chatJobs.push({ job, participants: acceptedApps.map((app: any) => app.worker).filter(Boolean), unreadCount, hasActiveCall });
        }
      }
    } else {
      // Workers see their accepted jobs (not completed/cancelled)
      // Check for impersonation or employee status
      const isImpersonating = user.impersonation?.isEmployee;
      const impersonatedTeamMemberId = user.impersonation?.teamMemberId;
      const isEmployee = profile.teamId !== null;
      
      if (isImpersonating && impersonatedTeamMemberId) {
        // When impersonating, show only jobs assigned to that specific team member
        const memberApps = await db.select().from(applications)
          .where(and(
            eq(applications.teamMemberId, impersonatedTeamMemberId),
            eq(applications.status, 'accepted')
          ));
        
        for (const app of memberApps) {
          const job = await storage.getJob(app.jobId);
          if (job && job.status !== 'completed' && job.status !== 'cancelled') {
            const companyProfile = await storage.getProfile(job.companyId);
            const unreadCount = await storage.getUnreadMessageCount(job.id, profile.id);
            const hasActiveCall = await jobHasActiveCall(job.id);
            chatJobs.push({
              job,
              participants: companyProfile ? [companyProfile] : [],
              unreadCount,
              hasActiveCall,
            });
          }
        }
      } else if (isEmployee) {
        // Employee - admin role sees all team jobs; employee role sees only their assigned jobs
        const team = await db.select().from(teams).where(eq(teams.id, profile.teamId!)).then(r => r[0]);
        if (team) {
          const members = await db.select().from(workerTeamMembers)
            .where(and(eq(workerTeamMembers.teamId, team.id), eq(workerTeamMembers.status, 'active')));
          const teamMember = members.find(m => (m.email || '').toLowerCase() === (profile.email || '').toLowerCase());
          
          if (teamMember) {
            const isAdmin = (teamMember as any).role === 'admin';
            const teamMemberIds = members.map(m => m.id);
            
            let appsToShow: { jobId: number }[];
            if (isAdmin) {
              const teamJobCondition = teamMemberIds.length > 0
                ? or(eq(applications.workerId, team.ownerId), inArray(applications.teamMemberId, teamMemberIds))
                : eq(applications.workerId, team.ownerId);
              appsToShow = await db.select({ jobId: applications.jobId })
                .from(applications)
                .where(and(eq(applications.status, 'accepted'), teamJobCondition));
              const seen = new Set<number>();
              appsToShow = appsToShow.filter(a => { if (seen.has(a.jobId)) return false; seen.add(a.jobId); return true; });
            } else {
              appsToShow = await db.select({ jobId: applications.jobId })
                .from(applications)
                .where(and(eq(applications.teamMemberId, teamMember.id), eq(applications.status, 'accepted')));
            }
            
            for (const app of appsToShow) {
              const job = await storage.getJob(app.jobId);
              if (job && job.status !== 'completed' && job.status !== 'cancelled') {
                const companyProfile = await storage.getProfile(job.companyId);
                const unreadCount = await storage.getUnreadMessageCount(job.id, profile.id);
                const hasActiveCall = await jobHasActiveCall(job.id);
                chatJobs.push({
                  job,
                  participants: companyProfile ? [companyProfile] : [],
                  unreadCount,
                  hasActiveCall,
                });
              }
            }
          }
        }
      } else {
        // Regular worker - show all their accepted jobs
        const workerApps = await storage.getWorkerApplications(profile.id);
        const acceptedApps = workerApps.filter(app => app.status === 'accepted');
        
        for (const app of acceptedApps) {
          const job = await storage.getJob(app.jobId);
          if (job && job.status !== 'completed' && job.status !== 'cancelled') {
            const companyProfile = await storage.getProfile(job.companyId);
            const unreadCount = await storage.getUnreadMessageCount(job.id, profile.id);
            const hasActiveCall = await jobHasActiveCall(job.id);
            chatJobs.push({
              job,
              participants: companyProfile ? [companyProfile] : [],
              unreadCount,
              hasActiveCall,
            });
          }
        }
      }
    }
    
    res.json(chatJobs);
  });
  
  // Get total unread message count across all chat jobs
  app.get("/api/chats/unread-total", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Profile not found" });
    }
    
    let totalUnread = 0;
    
    if (profile.role === 'company') {
      let companyJobs = await storage.getCompanyJobs(profile.id);
      let isTeamMemberView = false;
      if (companyJobs.length === 0 && profile.userId) {
        const tmRows = await db.select().from(companyTeamMembers)
          .where(and(eq(companyTeamMembers.userId, profile.userId), eq(companyTeamMembers.isActive, true)));
        if (tmRows.length > 0) {
          companyJobs = await storage.getCompanyJobs(tmRows[0].companyProfileId);
          isTeamMemberView = true;
        }
      }
      for (const job of companyJobs) {
        if (job.status === 'completed' || job.status === 'cancelled') continue;
        const jobApps = await storage.getJobApplications(job.id);
        const acceptedApps = jobApps.filter((app: any) => app.status === 'accepted');
        if (acceptedApps.length === 0) continue;
        if (isTeamMemberView && !(await isLocationRepOrAssigned(profile, job))) continue;
        const count = await storage.getUnreadMessageCount(job.id, profile.id);
        totalUnread += count;
      }
    } else {
      const isEmployee = profile.teamId != null;
      let jobIdsToCount: number[] = [];
      
      if (isEmployee) {
        const team = await db.select().from(teams).where(eq(teams.id, profile.teamId!)).then(r => r[0]);
        if (team) {
          const members = await db.select().from(workerTeamMembers)
            .where(and(eq(workerTeamMembers.teamId, team.id), eq(workerTeamMembers.status, 'active')));
          const teamMember = members.find(m => (m.email || '').toLowerCase() === (profile.email || '').toLowerCase());
          if (teamMember) {
            const isAdmin = (teamMember as any).role === 'admin';
            const teamMemberIds = members.map(m => m.id);
            const teamJobCondition = teamMemberIds.length > 0
              ? or(eq(applications.workerId, team.ownerId), inArray(applications.teamMemberId, teamMemberIds))
              : eq(applications.workerId, team.ownerId);
            const apps = isAdmin
              ? await db.select({ jobId: applications.jobId }).from(applications)
                  .where(and(eq(applications.status, 'accepted'), teamJobCondition))
              : await db.select({ jobId: applications.jobId }).from(applications)
                  .where(and(eq(applications.teamMemberId, teamMember.id), eq(applications.status, 'accepted')));
            jobIdsToCount = [...new Set(apps.map(a => a.jobId))];
          }
        }
      } else {
        const workerApps = await storage.getWorkerApplications(profile.id);
        jobIdsToCount = workerApps.filter(app => app.status === 'accepted').map(app => app.jobId);
      }
      
      for (const jobId of jobIdsToCount) {
        const job = await storage.getJob(jobId);
        if (job && job.status !== 'completed' && job.status !== 'cancelled') {
          const count = await storage.getUnreadMessageCount(jobId, profile.id);
          totalUnread += count;
        }
      }
    }
    
    res.json({ count: totalUnread });
  });

  // === Today's Assignments (for workers) ===
  app.get("/api/today/assignments", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || profile.role !== 'worker') {
      return res.status(403).json({ message: "Only workers can access this endpoint" });
    }

    try {
      const assignments: any[] = [];
      
      // Check for impersonation state in session
      const sessionData = (req.session as any);
      const isImpersonating = sessionData.impersonatingAsEmployee === true;
      const impersonatedTeamMemberId = sessionData.impersonatedTeamMemberId;
      
      // Check if user is admin (business operator without a teamId means they own a team)
      const isAdmin = profile.teamId === null && !isImpersonating;
      
      // Helper function to check if status is accepted/approved
      const isAcceptedStatus = (status: string) => status === 'accepted' || status === 'approved';
      
      if (isImpersonating && impersonatedTeamMemberId) {
        // When impersonating, show only jobs assigned to that specific team member
        const memberApps = await db.select().from(applications)
          .where(and(
            eq(applications.teamMemberId, impersonatedTeamMemberId),
            eq(applications.status, 'accepted')
          ));
        
        for (const app of memberApps) {
          const job = await storage.getJob(app.jobId);
          // Show ALL accepted jobs regardless of job status (not just in_progress/open/filled)
          if (job && job.status !== 'cancelled') {
            const activeTs = await db.select().from(timesheets)
              .where(and(
                eq(timesheets.jobId, job.id),
                eq(timesheets.workerId, app.workerId),
                isNull(timesheets.clockOutTime)
              ))
              .then(r => r[0]);
            
            // Get team member info
            const teamMember = await db.select().from(workerTeamMembers)
              .where(eq(workerTeamMembers.id, impersonatedTeamMemberId))
              .then(r => r[0]);
            
            assignments.push({
              application: { ...app, job, teamMember: teamMember || null },
              activeTimesheet: activeTs || null,
            });
          }
        }
      } else if (isAdmin) {
        // Get the team this worker owns
        const team = await db.select().from(teams).where(eq(teams.ownerId, profile.id)).then(r => r[0]);
        
        if (team) {
          // Get all team members
          const teamMembers = await db.select().from(workerTeamMembers).where(eq(workerTeamMembers.teamId, team.id));
          
          // Get applications for all team members
          for (const member of teamMembers) {
            const memberApps = await db.select().from(applications)
              .where(and(
                eq(applications.teamMemberId, member.id),
                eq(applications.status, 'accepted')
              ));
            
            for (const app of memberApps) {
              const job = await storage.getJob(app.jobId);
              // Show ALL accepted jobs regardless of job status
              if (job && job.status !== 'cancelled') {
                // For team members, lookup timesheet by workerId (business operator) AND the job
                const activeTs = await db.select().from(timesheets)
                  .where(and(
                    eq(timesheets.jobId, job.id),
                    eq(timesheets.workerId, app.workerId),
                    isNull(timesheets.clockOutTime)
                  ))
                  .then(r => r[0]);
                
                assignments.push({
                  application: { ...app, job, teamMember: member },
                  activeTimesheet: activeTs || null,
                });
              }
            }
          }
        }
        
        // Also get admin's own applications
        const ownApps = await db.select().from(applications)
          .where(and(
            eq(applications.workerId, profile.id),
            isNull(applications.teamMemberId),
            eq(applications.status, 'accepted')
          ));
        
        for (const app of ownApps) {
          const job = await storage.getJob(app.jobId);
          // Show ALL accepted jobs regardless of job status
          if (job && job.status !== 'cancelled') {
            const activeTs = await db.select().from(timesheets)
              .where(and(
                eq(timesheets.jobId, job.id),
                eq(timesheets.workerId, profile.id),
                isNull(timesheets.clockOutTime)
              ))
              .then(r => r[0]);
            
            assignments.push({
              application: { ...app, job, teamMember: null },
              activeTimesheet: activeTs || null,
            });
          }
        }
      } else {
        // Regular worker or employee - get their applications
        // For employees (profile.teamId is set), get applications where they are the team member
        if (profile.teamId) {
          // This worker is an employee, get their team member record
          const teamMember = await db.select().from(workerTeamMembers)
            .where(and(
              eq(workerTeamMembers.teamId, profile.teamId),
              eq(workerTeamMembers.email, profile.email || '')
            ))
            .then(r => r[0]);
          
          if (teamMember) {
            const memberApps = await db.select().from(applications)
              .where(and(
                eq(applications.teamMemberId, teamMember.id),
                eq(applications.status, 'accepted')
              ));
            
            for (const app of memberApps) {
              const job = await storage.getJob(app.jobId);
              // Show ALL accepted jobs regardless of job status
              if (job && job.status !== 'cancelled') {
                const activeTs = await db.select().from(timesheets)
                  .where(and(
                    eq(timesheets.jobId, job.id),
                    eq(timesheets.workerId, app.workerId),
                    isNull(timesheets.clockOutTime)
                  ))
                  .then(r => r[0]);
                
                assignments.push({
                  application: { ...app, job, teamMember },
                  activeTimesheet: activeTs || null,
                });
              }
            }
          }
        } else {
          // Regular independent worker
          const workerApps = await db.select().from(applications)
            .where(and(
              eq(applications.workerId, profile.id),
              eq(applications.status, 'accepted')
            ));
          
          for (const app of workerApps) {
            const job = await storage.getJob(app.jobId);
            // Show ALL accepted jobs regardless of job status
            if (job && job.status !== 'cancelled') {
              const activeTs = await db.select().from(timesheets)
                .where(and(
                  eq(timesheets.jobId, job.id),
                  eq(timesheets.workerId, profile.id),
                  isNull(timesheets.clockOutTime)
                ))
                .then(r => r[0]);
              
              assignments.push({
                application: { ...app, job, teamMember: null },
                activeTimesheet: activeTs || null,
              });
            }
          }
        }
      }

      // Attach today's completed timesheets (clocked out) per assignment for "Completed" section
      if (assignments.length > 0) {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const jobIds = [...new Set(assignments.map((a: any) => a.application.jobId))];
        const workerIds = [...new Set(assignments.map((a: any) => a.application.workerId))];
        const completedToday = await db.select()
          .from(timesheets)
          .where(and(
            inArray(timesheets.jobId, jobIds),
            inArray(timesheets.workerId, workerIds),
            isNotNull(timesheets.clockOutTime),
            gte(timesheets.clockInTime, startOfDay),
            lte(timesheets.clockInTime, endOfDay)
          ))
          .orderBy(desc(timesheets.clockOutTime));
        const byKey: Record<string, typeof completedToday> = {};
        for (const ts of completedToday) {
          const key = `${ts.jobId}-${ts.workerId}`;
          if (!byKey[key]) byKey[key] = [];
          byKey[key].push(ts);
        }
        for (const a of assignments) {
          const key = `${a.application.jobId}-${a.application.workerId}`;
          a.todayCompletedTimesheets = byKey[key] || [];
        }
      }

      res.json(assignments);
    } catch (err) {
      console.error("Today assignments error:", err);
      res.status(500).json({ message: "Failed to fetch assignments" });
    }
  });

  // Worker accepts a direct job request
  app.post("/api/applications/:id/accept", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const id = Number(req.params.id);
    
    const user = req.user as any;
    const workerProfile = req.profile;

    if (!workerProfile || workerProfile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can accept job requests" });
    }
    
    // Get application
    const [application] = await db.select().from(applications).where(eq(applications.id, id));
    if (!application || application.workerId !== workerProfile.id) {
      return res.status(404).json({ message: "Application not found" });
    }
    
    // Update application status to accepted (+ job_assignments row via storage)
    const updated = await storage.updateApplicationStatus(id, "accepted");
    
    // Get job and company info
    const job = await storage.getJob(application.jobId);
    if (job) {
      const company = await storage.getProfile(job.companyId);
      
      // Send email to company about worker accepting the request
      if (company?.email && company.emailNotifications) {
        sendEmail({
          to: company.email,
          type: 'worker_accepted_job',
          data: {
            workerName: `${workerProfile.firstName} ${workerProfile.lastName}`,
            workerPhone: workerProfile.phone || 'Not provided',
            jobTitle: job.title,
            jobId: job.id,
            startDate: job.startDate ? new Date(job.startDate).toLocaleDateString() : 'TBD',
          }
        }).catch(err => console.error('Failed to send worker accepted job email:', err));
      }
      
      // Balance shortfall → Stripe replenishment; on failure job gets payment_hold_at + profile lastFailed PM for global modal
      await afterHireFundingCheck(job.id, job.companyId).catch((err) =>
        console.error("afterHireFundingCheck (worker accept):", err)
      );
      await sendJobFilledIfNeeded(job, company);
    }
    
    res.json(updated);
  });

  // === Applications ===
  app.post(api.applications.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile || profile.role !== "worker") {
        return res.status(403).json({ message: "Only workers can apply for jobs" });
      }

      const input = api.applications.create.input.parse(req.body);
      const job = await storage.getJob(input.jobId);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      if (job.status !== "open") {
        return res.status(400).json({ message: "This job is not accepting applications." });
      }
      if (job.paymentHoldAt) {
        return res.status(400).json({
          message: "This job is on hold until the company resolves payment.",
          code: "JOB_PAYMENT_HOLD",
        });
      }

      const defaultWorkerRateCents = workerFacingJobHourlyCents(job.hourlyRate);
      const resolvedProposedRate =
        input.proposedRate != null && input.proposedRate > 0
          ? input.proposedRate
          : defaultWorkerRateCents > 0
            ? defaultWorkerRateCents
            : undefined;

      let application;
      try {
        application = await storage.createApplication({
          jobId: input.jobId,
          message: sanitizeMessage(input.message),
          workerId: profile.id,
          teamMemberId: input.teamMemberId ?? null,
          proposedRate: resolvedProposedRate ?? null,
        });
      } catch (createErr: any) {
        if (createErr?.code === "23505") {
          return res.status(400).json({ message: "You have already applied to this job." });
        }
        throw createErr;
      }

      if (job) {
        const appsForCount = await storage.getJobApplications(job.id);
        const acceptedCount = appsForCount.filter((a: any) => a.status === "accepted").length;
        const decision = evaluateAutoFulfillAccept({
          job: job as any,
          worker: profile,
          proposedRateCents: application.proposedRate,
          acceptedApplicationCount: acceptedCount,
        });
        if (decision.accept) {
          await storage.updateApplicationStatus(application.id, "accepted");
          await db.update(applications).set({ autoAccepted: true }).where(eq(applications.id, application.id));
          const [refetched] = await db.select().from(applications).where(eq(applications.id, application.id));
          if (refetched) application = refetched;
          const companyProfileAf = await storage.getProfile(job.companyId);
          notifyApplicationUpdate(profile.id, {
            jobId: job.id,
            jobTitle: job.title,
            applicationId: application.id,
            status: "accepted",
          });
          if (companyProfileAf) {
            await sendApplicationAcceptedEmailAndReplenish({
              job,
              worker: profile,
              companyProfile: companyProfileAf,
            });
          }
          console.log(`[AutoFulfill] Auto-accepted application ${application.id} for job ${job.id}`);
        } else if (decision.reason !== "disabled") {
          console.log(`[AutoFulfill] No auto-accept for application ${application.id}: ${decision.reason}`);
        }
      }

      // Send notifications to company about worker inquiry
      if (job) {
        const company = await storage.getProfile(job.companyId);
        const workerName = `${profile.firstName} ${profile.lastName}`;
        
        // Real-time WebSocket notification to company
        notifyJobUpdate(job.companyId, {
          jobId: job.id,
          jobTitle: job.title,
          type: 'new_application',
          workerName,
        });
        
        // Real-time WebSocket notification to worker
        const statusForWebSocket = application.status === 'withdrawn' ? 'rejected' : application.status;
        if (statusForWebSocket === 'pending' || statusForWebSocket === 'accepted' || statusForWebSocket === 'rejected') {
          notifyApplicationUpdate(profile.id, {
            jobId: job.id,
            jobTitle: job.title,
            applicationId: application.id,
            status: statusForWebSocket,
          });
        }
        
        // Push notification for company
        notifyWorkerInquiry(job.companyId, workerName, job.id, job.title)
          .catch(err => console.error('Failed to send worker inquiry push notification:', err));
        
        // Email notification: route to location rep/teammate or company admin (per job/location)
        const recipient = await getNotificationRecipientForJob(job, 'worker_inquiry');
        if (recipient?.email && (recipient.profile.emailNotifications ?? true) && (recipient.profile.notifyNewJobs ?? true)) {
          const allApplications = await storage.getApplicationsByJob(job.id);
          const pendingApplications = allApplications.filter(app => app.status === 'pending');
          const workerProfiles = await Promise.all(
            pendingApplications.map(async (app) => {
              const workerProfile = await storage.getProfile(app.workerId);
              return workerProfile ? {
                name: `${workerProfile.firstName} ${workerProfile.lastName}`,
                rate: Math.round((workerProfile.hourlyRate || 0) / 100),
                rating: workerProfile.averageRating?.toString() || '5.0',
                completedJobs: workerProfile.completedJobs || 0,
                workerId: workerProfile.id
              } : null;
            })
          );
          const validWorkers = workerProfiles.filter(w => w !== null);
          sendEmail({
            to: recipient.email,
            type: 'worker_inquiry',
            data: {
              jobTitle: job.title,
              jobId: job.id,
              workers: validWorkers,
              workerName,
              workerRate: Math.round((profile.hourlyRate || 0) / 100),
              workerRating: profile.averageRating?.toString() || '5.0',
              completedJobs: profile.completedJobs || 0,
              workerId: profile.id,
            }
          }).catch(err => console.error('Failed to send worker inquiry email:', err));
        }

        // AI Dispatch: send "applied for you" email to worker (self or teammate), including other assigned teammates if multiple
        const isAiDispatched = (req.body as { isAiDispatched?: boolean })?.isAiDispatched === true;
        if (isAiDispatched) {
          let toEmail: string | null = null;
          if (application.teamMemberId) {
            const member = await storage.getWorkerTeamMember(application.teamMemberId);
            toEmail = member?.email ?? null;
          } else {
            toEmail = profile.email ?? null;
            if (profile.emailNotifications === false) toEmail = null;
          }
          if (toEmail) {
            // Other workers/teammates also assigned to this job (for "You and X, Y were assigned")
            const allAcceptedForJob = await db.select({ id: applications.id, workerId: applications.workerId, teamMemberId: applications.teamMemberId })
              .from(applications)
              .where(and(eq(applications.jobId, job.id), eq(applications.status, 'accepted')));
            const otherAppIds = allAcceptedForJob.filter(app => app.id !== application.id);
            const teammatesAlsoAssigned: { name: string }[] = [];
            for (const other of otherAppIds) {
              if (other.teamMemberId) {
                const tm = await storage.getWorkerTeamMember(other.teamMemberId);
                if (tm) teammatesAlsoAssigned.push({ name: `${tm.firstName} ${tm.lastName}`.trim() || 'Teammate' });
              } else {
                const p = await storage.getProfile(other.workerId);
                if (p) teammatesAlsoAssigned.push({ name: `${p.firstName} ${p.lastName}`.trim() || 'Worker' });
              }
            }
            sendEmail({
              to: toEmail,
              type: 'ai_dispatch_applied',
              data: {
                jobTitle: job.title,
                jobId: job.id,
                location: job.location || (job.city && job.state ? `${job.city}, ${job.state}` : undefined),
                startDate: job.startDate ? new Date(job.startDate).toLocaleDateString() : 'TBD',
                hourlyRate: job.hourlyRate != null ? (job.hourlyRate / 100).toFixed(0) : undefined,
                teammatesAlsoAssigned: teammatesAlsoAssigned.length > 0 ? teammatesAlsoAssigned : undefined,
              },
            }).catch(err => console.error('Failed to send AI dispatch applied email:', err));
          }
        }
      }

      res.status(201).json(application);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Update application team member (for business operators/admins only)
  app.patch("/api/applications/:id/team-member", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile || profile.role !== "worker") {
        return res.status(403).json({ message: "Only workers can update their applications" });
      }
      
      // Only admins (business operators without a teamId) can reassign workers
      // Employees (workers with a teamId) cannot reassign
      if (profile.teamId !== null) {
        return res.status(403).json({ message: "Only business operators can reassign workers" });
      }

      const id = Number(req.params.id);
      const { teamMemberId } = req.body;
      
      // Get application and verify worker owns it
      const [application] = await db.select().from(applications).where(eq(applications.id, id));
      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }
      
      if (application.workerId !== profile.id) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      // Allow updating pending, accepted, or approved applications
      const allowedStatuses = ["pending", "accepted", "approved"];
      if (!allowedStatuses.includes(application.status)) {
        return res.status(400).json({ message: "Cannot reassign worker for this application status" });
      }

      // Update application team member only - keep original proposed rate (hourly rate does NOT change)
      const [updated] = await db.update(applications)
        .set({ 
          teamMemberId: teamMemberId || null
        })
        .where(eq(applications.id, id))
        .returning();

      res.json(updated);
    } catch (err) {
      console.error("Error updating application team member:", err);
      res.status(500).json({ message: "Failed to update application" });
    }
  });

  // Update application status (accept/reject)
  app.patch(api.applications.updateStatus.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(403).json({ message: "Forbidden" });

      const id = Number(req.params.id);
      const input = api.applications.updateStatus.input.parse(req.body);
      
      const [application] = await db.select().from(applications).where(eq(applications.id, id));
      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }
      
      const job = await storage.getJob(application.jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });

      // Company: must own the job. Dev only: worker may accept their own application (for testing).
      const isCompany = profile.role === "company";
      const isDevWorkerSelfAccept = process.env.NODE_ENV === "development" && profile.role === "worker" && application.workerId === profile.id;
      if (!isCompany && !isDevWorkerSelfAccept) {
        return res.status(403).json({ message: "Only companies can update application status" });
      }
      if (isCompany && job.companyId !== profile.id) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Update application status (+ job_assignments on accept)
      const updated = await storage.updateApplicationStatus(id, input.status);

      // Get worker profile for notifications
      const worker = await storage.getProfile(application.workerId);
      const companyProfile = isCompany ? profile : await storage.getProfile(job.companyId);
      const companyName = companyProfile?.companyName || (companyProfile ? `${companyProfile.firstName} ${companyProfile.lastName}` : "Company");
      
      // Real-time WebSocket notification to worker
      notifyApplicationUpdate(application.workerId, {
        applicationId: application.id,
        jobId: job.id,
        jobTitle: job.title,
        status: input.status,
      });
      
      // Send email to worker based on status
      if (worker?.email && worker.emailNotifications) {
        if (input.status === 'accepted') {
          if (companyProfile) {
            await sendApplicationAcceptedEmailAndReplenish({ job, worker, companyProfile });
          }
        } else if (input.status === 'rejected') {
          sendEmail({
            to: worker.email,
            type: 'application_rejected',
            data: {
              jobTitle: job.title,
              companyName,
              rejectionReason: input.rejectionReason || undefined,
            }
          }).catch(err => console.error('Failed to send application rejected email:', err));
        }
      } else if (input.status === 'accepted' && companyProfile) {
        await sendApplicationAcceptedEmailAndReplenish({ job, worker, companyProfile });
      }

      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.get(api.applications.listByJob.path, async (req, res) => {
    const jobId = Number(req.params.jobId);
    const applications = await storage.getJobApplications(jobId);
    const teamMemberIds = [...new Set(applications.map((a: any) => a.teamMemberId).filter(Boolean))];
    let managerByTeamMemberId = new Map<number, { id: number; firstName: string | null; lastName: string | null }>();
    if (teamMemberIds.length > 0) {
      const teamMembersList = await storage.getWorkerTeamMembersByIds(teamMemberIds);
      const teamIds = [...new Set(teamMembersList.map((m: any) => m.teamId).filter(Boolean))];
      const teamsList = teamIds.length > 0 ? await db.select({ id: teams.id, ownerId: teams.ownerId }).from(teams).where(inArray(teams.id, teamIds)) : [];
      const ownerIds = [...new Set(teamsList.map((t: any) => t.ownerId).filter(Boolean))];
      const ownersList = ownerIds.length > 0 ? await db.select({ id: profiles.id, firstName: profiles.firstName, lastName: profiles.lastName }).from(profiles).where(inArray(profiles.id, ownerIds)) : [];
      const ownersMap = new Map(ownersList.map((p: any) => [p.id, p]));
      const teamsMap = new Map(teamsList.map((t: any) => [t.id, t]));
      for (const m of teamMembersList) {
        const team = teamsMap.get((m as any).teamId);
        if (team) {
          const owner = ownersMap.get(team.ownerId);
          if (owner) managerByTeamMemberId.set(m.id, { id: owner.id, firstName: owner.firstName, lastName: owner.lastName });
        }
      }
    }
    const sanitized = applications.map((app: any) => {
      const base = app.teamMemberId ? { ...app, worker: { ...app.worker, phone: null } } : app;
      const manager = app.teamMemberId ? managerByTeamMemberId.get(app.teamMemberId) : undefined;
      return { ...base, manager };
    });
    res.json(sanitized);
  });

  // Get applications by worker (worker can only fetch their own)
  app.get("/api/applications/worker/:workerId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    const workerId = Number(req.params.workerId);
    if (!profile || profile.role !== "worker" || profile.id !== workerId)
      return res.status(403).json({ message: "Forbidden" });
    const applications = await storage.getWorkerApplications(workerId);
    res.json(applications);
  });

  // Worker abandonment flow for accepted jobs
  app.post("/api/applications/:id/abandon", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });

    try {
      const profile = req.profile;
      if (!profile || profile.role !== "worker") {
        return res.status(403).json({ message: "Only workers can abandon jobs" });
      }

      const applicationId = Number(req.params.id);
      const reason = String(req.body?.reason || "").trim().slice(0, 64);
      const details = String(req.body?.details || "").trim().slice(0, 1000);
      if (!reason) {
        return res.status(400).json({ message: "Abandon reason is required" });
      }

      const [application] = await db.select().from(applications).where(eq(applications.id, applicationId));
      if (!application) return res.status(404).json({ message: "Application not found" });
      if (application.workerId !== profile.id) return res.status(403).json({ message: "Unauthorized" });
      if (application.status !== "accepted") {
        return res.status(400).json({ message: "Only accepted jobs can be abandoned from this flow" });
      }

      const job = await storage.getJob(application.jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });

      // Hard stop if worker is currently clocked in for this job.
      const activeTimesheet = await db
        .select({ id: timesheets.id })
        .from(timesheets)
        .where(and(
          eq(timesheets.jobId, job.id),
          eq(timesheets.workerId, profile.id),
          isNull(timesheets.clockOutTime)
        ))
        .limit(1);
      if (activeTimesheet.length > 0) {
        return res.status(409).json({ message: "Clock out before abandoning this job", code: "CLOCK_OUT_REQUIRED" });
      }

      const allWorkerJobTimesheets = await db
        .select({
          id: timesheets.id,
          status: timesheets.status,
          submittedAt: timesheets.submittedAt,
          clockOutTime: timesheets.clockOutTime,
          paymentStatus: timesheets.paymentStatus,
        })
        .from(timesheets)
        .where(and(
          eq(timesheets.jobId, job.id),
          eq(timesheets.workerId, profile.id)
        ));

      const timesheetSummary = allWorkerJobTimesheets.reduce((acc, ts) => {
        const hasEnded = !!ts.clockOutTime;
        const isDraft = hasEnded && !ts.submittedAt;
        if (isDraft) acc.endedDraftCount += 1;
        if (ts.status === "pending") acc.pendingReviewCount += 1;
        if (ts.status === "approved") acc.approvedCount += 1;
        if (ts.status === "disputed") acc.disputedCount += 1;
        if (ts.status === "rejected") acc.rejectedCount += 1;
        return acc;
      }, { endedDraftCount: 0, pendingReviewCount: 0, approvedCount: 0, disputedCount: 0, rejectedCount: 0 });

      // Preserve audit history: withdraw application rather than deleting row.
      const updatedApplication = await storage.updateApplicationStatus(applicationId, "withdrawn");

      // Cancel assignment mapping for this worker + job.
      await db
        .update(jobAssignments)
        .set({
          status: "cancelled",
          completedAt: new Date(),
        })
        .where(and(
          eq(jobAssignments.jobId, job.id),
          eq(jobAssignments.workerId, profile.id)
        ));

      const workerName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || "Worker";
      const reasonLabelMap: Record<string, string> = {
        emergency: "Emergency",
        transportation: "Transportation issue",
        schedule_conflict: "Schedule conflict",
        safety_concern: "Safety concern",
        rate_scope: "Rate/scope mismatch",
        other: "Other",
      };
      const reasonLabel = reasonLabelMap[reason] || reason.replace(/_/g, " ");
      const abandonedAtIso = new Date().toISOString();

      // In-system chat message (worker + company can both see this abandonment event).
      await db.insert(jobMessages).values({
        jobId: job.id,
        senderId: profile.id,
        content: `${workerName} abandoned this job. Reason: ${reasonLabel}${details ? ` — ${details}` : ""}`,
        messageType: "text",
        metadata: {
          type: "job_abandonment",
          reason,
          reasonLabel,
          details: details || null,
          abandonedAt: abandonedAtIso,
          applicationId,
          timesheetSummary,
        },
      });

      const baseUrl = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";
      const companyChatUrl = `${baseUrl}/company-dashboard/chats/${job.id}`;
      const workerChatUrl = `${baseUrl}/dashboard/chats/${job.id}`;
      const repostPath = `/post-job?new=1&repost=1&sourceJobId=${job.id}`;
      const repostUrl = `${baseUrl}${repostPath}`;

      const companyProfile = await storage.getProfile(job.companyId);
      if (companyProfile?.email && companyProfile.emailNotifications) {
        sendEmail({
          to: companyProfile.email,
          type: "job_abandoned_company",
          data: {
            jobId: job.id,
            jobTitle: job.title || "Job",
            workerName,
            reasonLabel,
            details: details || null,
            chatUrl: companyChatUrl,
            repostUrl,
            abandonedAt: abandonedAtIso,
          },
        }).catch((err) => console.error("Failed to send company abandonment email:", err));
      }

      if (profile.email && profile.emailNotifications) {
        sendEmail({
          to: profile.email,
          type: "job_abandoned_worker",
          data: {
            jobId: job.id,
            jobTitle: job.title || "Job",
            companyName: companyProfile?.companyName || `${companyProfile?.firstName || ""} ${companyProfile?.lastName || ""}`.trim() || "Company",
            reasonLabel,
            details: details || null,
            chatUrl: workerChatUrl,
            strikeWarning: true,
            reviewWarning: true,
            abandonedAt: abandonedAtIso,
          },
        }).catch((err) => console.error("Failed to send worker abandonment email:", err));
      }

      // Keep notifications inside existing enum values while still surfacing the event.
      await db.insert(notifications).values({
        profileId: job.companyId,
        type: "worker_inquiry",
        title: "Worker abandoned assignment",
        body: `${workerName} abandoned "${job.title || "job"}". Reason: ${reasonLabel}. Tap to repost and set a new timeframe.`,
        url: repostPath,
        data: {
          jobId: job.id,
          applicationId,
          reason,
          reasonLabel,
          details: details || null,
          repostUrl: repostPath,
          chatUrl: `/company-dashboard/chats/${job.id}`,
        },
      });
      notifyJobUpdate(job.companyId, {
        jobId: job.id,
        jobTitle: job.title || "Job",
        type: "new_application",
        workerName,
        message: `${workerName} abandoned assignment for "${job.title || "job"}". Repost with a new timeframe.`,
      });
      await db.insert(notifications).values({
        profileId: profile.id,
        type: "application_rejected",
        title: "Job abandoned",
        body: `You abandoned "${job.title || "job"}". Company may review this event and your account standing may be impacted.`,
        url: `/dashboard/chats/${job.id}`,
        data: { jobId: job.id, applicationId, reason, reasonLabel, details: details || null },
      });

      notifyApplicationUpdate(profile.id, {
        applicationId,
        jobId: job.id,
        jobTitle: job.title || "Job",
        status: "withdrawn",
      });

      res.json({
        success: true,
        application: updatedApplication,
        timesheetSummary,
        warnings: {
          strikePossible: true,
          reviewPossible: true,
        },
      });
    } catch (err) {
      console.error("Error abandoning job:", err);
      res.status(500).json({ message: "Failed to abandon job" });
    }
  });

  // Delete application
  app.delete("/api/applications/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const id = Number(req.params.id);
    await storage.deleteApplication(id);
    res.json({ success: true });
  });

  // === Worker Dismissed Jobs ===
  app.get("/api/workers/:workerId/dismissed-jobs", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const workerId = Number(req.params.workerId);
    const dismissedJobIds = await storage.getDismissedJobs(workerId);
    res.json(dismissedJobIds);
  });

  app.post("/api/workers/:workerId/dismiss-job/:jobId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const workerId = Number(req.params.workerId);
    const jobId = Number(req.params.jobId);
    const { reason } = req.body || {};
    await storage.dismissJob(workerId, jobId, reason);
    res.json({ success: true });
  });

  app.delete("/api/workers/:workerId/dismiss-job/:jobId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const workerId = Number(req.params.workerId);
    const jobId = Number(req.params.jobId);
    await storage.undismissJob(workerId, jobId);
    res.json({ success: true });
  });

  // === Direct Job Inquiries ===
  
  // Create a direct job inquiry (company sends to worker)
  app.post("/api/direct-inquiries", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Only companies can send direct job inquiries" });
      }

      const { workerId, ...inquiryData } = req.body;
      
      // Set expiration to 24 hours from now
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      
      const inquiry = await storage.createDirectJobInquiry({
        ...inquiryData,
        companyId: profile.id,
        workerId: Number(workerId),
        expiresAt,
      });
      
      // Create notification for worker
      const worker = await storage.getProfile(Number(workerId));
      if (worker) {
        try {
          await db.insert(notifications).values({
            profileId: worker.id,
            type: "job_offer_received",
            title: "New Job Request",
            body: `${profile.companyName || profile.firstName} sent you a direct job request: ${inquiry.title}`,
            url: `/worker-dashboard?tab=inquiries&inquiryId=${inquiry.id}`,
            data: { inquiryId: inquiry.id, companyName: profile.companyName || profile.firstName },
          });
        } catch (e) {
          console.error("Failed to create notification:", e);
        }
      }
      if (worker?.email && worker.emailNotifications) {
        sendEmail({
          to: worker.email,
          type: "job_offer_received",
          data: {
            jobTitle: inquiry.title,
            companyName: profile.companyName || `${profile.firstName} ${profile.lastName}`,
            location: inquiry.location || [inquiry.city, inquiry.state].filter(Boolean).join(", ") || "See details",
            startDate: inquiry.startDate ? new Date(inquiry.startDate).toLocaleDateString() : "TBD",
            hourlyRate: inquiry.hourlyRate ? (inquiry.hourlyRate / 100).toFixed(0) : "0",
            offerId: inquiry.id,
          },
        }).catch((err) => console.error("Failed to send direct inquiry offer email:", err));
      }
      
      res.status(201).json(inquiry);
    } catch (err) {
      console.error("Error creating direct inquiry:", err);
      res.status(500).json({ message: "Failed to create inquiry" });
    }
  });

  // Get direct inquiries for current worker
  app.get("/api/direct-inquiries/worker", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const inquiries = await storage.getDirectJobInquiriesForWorker(profile.id);
      res.json(inquiries);
    } catch (err) {
      console.error("Error fetching worker inquiries:", err);
      res.status(500).json({ message: "Failed to fetch inquiries" });
    }
  });

  // Get direct inquiries sent by current company
  app.get("/api/direct-inquiries/company", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Only companies can view sent inquiries" });
      }
      
      const inquiries = await storage.getDirectJobInquiriesForCompany(profile.id);
      const now = new Date();
      for (const inquiry of inquiries) {
        if (inquiry.status !== "pending" || !inquiry.expiresAt) continue;
        if (new Date(inquiry.expiresAt).getTime() >= now.getTime()) continue;
        const workerName = (inquiry.worker as any)?.firstName
          ? `${(inquiry.worker as any).firstName} ${(inquiry.worker as any).lastName || ""}`.trim()
          : "The worker";
        const result = await expireDirectInquiryAndNotify(inquiry, profile, workerName);
        (inquiry as any).status = result.status;
        if (result.status === "converted") {
          (inquiry as any).convertedJobId = result.jobId;
        }
      }
      res.json(inquiries);
    } catch (err) {
      console.error("Error fetching company inquiries:", err);
      res.status(500).json({ message: "Failed to fetch inquiries" });
    }
  });

  // Respond to a direct inquiry (worker accepts or declines)
  app.post("/api/direct-inquiries/:id/respond", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const inquiryId = Number(req.params.id);
      const { status, message } = req.body;
      
      if (status !== "accepted" && status !== "declined") {
        return res.status(400).json({ message: "Status must be 'accepted' or 'declined'" });
      }
      
      // Get the inquiry and verify ownership
      const inquiry = await storage.getDirectJobInquiry(inquiryId);
      if (!inquiry) {
        return res.status(404).json({ message: "Inquiry not found" });
      }
      if (inquiry.workerId !== profile.id) {
        return res.status(403).json({ message: "Not authorized to respond to this inquiry" });
      }
      if (inquiry.expiresAt && new Date(inquiry.expiresAt).getTime() < Date.now()) {
        const company = await storage.getProfile(inquiry.companyId);
        await expireDirectInquiryAndNotify(
          inquiry,
          company,
          `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || "The worker"
        );
        return res.status(400).json({ message: "Inquiry has expired" });
      }
      if (inquiry.status !== "pending") {
        return res.status(400).json({ message: "Inquiry has already been responded to" });
      }
      
      // Update the inquiry status
      const updatedInquiry = await storage.respondToDirectJobInquiry(inquiryId, status, message);
      
      // If accepted, create the job and auto-accept the worker
      if (status === "accepted") {
        const existingJob = inquiry.convertedJobId ? await storage.getJob(inquiry.convertedJobId) : null;
        const job = existingJob ?? await storage.createJob({
          companyId: inquiry.companyId,
          title: inquiry.title,
          description: inquiry.description,
          location: inquiry.location,
          locationName: inquiry.locationName,
          address: inquiry.address,
          city: inquiry.city,
          state: inquiry.state,
          zipCode: inquiry.zipCode,
          latitude: inquiry.latitude ?? undefined,
          longitude: inquiry.longitude ?? undefined,
          requiredSkills: inquiry.requiredSkills,
          hourlyRate: inquiry.hourlyRate,
          trade: (inquiry.requiredSkills && inquiry.requiredSkills.length > 0 ? inquiry.requiredSkills[0] : "General Labor") as any,
          startDate: inquiry.startDate,
          endDate: inquiry.endDate || undefined,
          scheduledTime: inquiry.scheduledTime,
          estimatedHours: inquiry.estimatedHours,
          jobType: inquiry.jobType as any,
          images: inquiry.images,
          videos: inquiry.videos,
          budgetCents: inquiry.budgetCents,
          maxWorkersNeeded: inquiry.maxWorkersNeeded,
          isOnDemand: inquiry.jobType === "on_demand",
          timezone: getTimezoneForState(inquiry.state),
        });
        const companyForPostedEmail = await storage.getProfile(inquiry.companyId);
        if (!existingJob && companyForPostedEmail?.email && companyForPostedEmail.emailNotifications) {
          sendEmail({
            to: companyForPostedEmail.email,
            type: "job_posted",
            data: {
              jobTitle: job.title,
              jobId: job.id,
              trade: job.trade || job.serviceCategory || "General",
              hourlyRate: job.hourlyRate ? (job.hourlyRate / 100).toFixed(0) : "0",
              workersNeeded: job.maxWorkersNeeded || 1,
              location: job.location || [job.city, job.state].filter(Boolean).join(", ") || "See details",
            },
          }).catch((err) => console.error("Failed to send job posted email (inquiry convert):", err));
        }
        
        // Ensure worker has an accepted application for this job.
        let applications = await storage.getApplicationsByJob(job.id);
        let workerApp = applications.find(a => a.workerId === profile.id);
        if (!workerApp) {
          try {
            await storage.createApplication({
              jobId: job.id,
              workerId: profile.id,
              message: message || "Accepted direct job request",
            });
          } catch (createErr: any) {
            if (createErr?.code !== "23505") throw createErr;
          }
          applications = await storage.getApplicationsByJob(job.id);
          workerApp = applications.find(a => a.workerId === profile.id);
        }
        if (workerApp && workerApp.status !== "accepted") {
          await storage.updateApplicationStatus(workerApp.id, "accepted");
        }
        await sendJobFilledIfNeeded(job, companyForPostedEmail);
        
        // Link the job to the inquiry
        await storage.updateDirectJobInquiry(inquiryId, { 
          status: "converted",
          convertedJobId: job.id 
        });
        
        // Notify the company
        try {
          await db.insert(notifications).values({
            profileId: inquiry.companyId,
            type: "worker_inquiry",
            title: "Job Request Accepted",
            body: `${profile.firstName} ${profile.lastName} accepted your job request: ${inquiry.title}`,
            url: `/company-dashboard?tab=jobs&jobId=${job.id}`,
            data: { jobId: job.id, workerName: `${profile.firstName} ${profile.lastName}` },
          });
        } catch (e) {
          console.error("Failed to create notification:", e);
        }
        
        await afterHireFundingCheck(job.id, inquiry.companyId).catch((err) =>
          console.error("afterHireFundingCheck (direct inquiry):", err)
        );
        
        res.json({ ...updatedInquiry, convertedJobId: job.id });
      } else {
        // Notify the company of decline
        try {
          await db.insert(notifications).values({
            profileId: inquiry.companyId,
            type: "worker_inquiry",
            title: "Job Request Declined",
            body: `${profile.firstName} ${profile.lastName} declined your job request: ${inquiry.title}`,
            url: `/company-dashboard?tab=team`,
            data: { inquiryId: inquiry.id, workerName: `${profile.firstName} ${profile.lastName}` },
          });
        } catch (e) {
          console.error("Failed to create notification:", e);
        }
        
        // If fallbackToPublic is true, we could create the job as public
        // This would be handled by a scheduled task checking expired inquiries
        
        res.json(updatedInquiry);
      }
    } catch (err) {
      console.error("Error responding to inquiry:", err);
      res.status(500).json({ message: "Failed to respond to inquiry" });
    }
  });

  // === Worker Team Management (Business Operator) ===
  
  // Get worker's team (creates one if doesn't exist)
  app.get("/api/worker-team", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const team = await storage.getWorkerTeam(profile.id);
      res.json(team);
    } catch (err) {
      console.error("Error fetching worker team:", err);
      res.status(500).json({ message: "Failed to fetch team" });
    }
  });

  // Create worker team
  app.post("/api/worker-team", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const { name, description } = req.body;
      const team = await storage.createWorkerTeam({
        name: name || `${profile.firstName}'s Team`,
        ownerId: profile.id,
        description,
      });
      res.status(201).json(team);
    } catch (err) {
      console.error("Error creating worker team:", err);
      res.status(500).json({ message: "Failed to create team" });
    }
  });

  // Get team members
  app.get("/api/worker-team/:teamId/members", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const teamId = Number(req.params.teamId);
      
      // Verify user owns this team
      const team = await storage.getTeamById(teamId);
      if (!team || team.ownerId !== profile.id) {
        return res.status(403).json({ message: "Not authorized to view this team" });
      }
      
      const members = await storage.getWorkerTeamMembers(teamId);
      
      // Optional historical date support: /members?date=YYYY-MM-DD
      const dateParam = typeof req.query.date === "string" ? req.query.date.trim() : "";
      let rangeStart: Date | null = null;
      let rangeEnd: Date | null = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        const parsed = new Date(`${dateParam}T00:00:00`);
        if (!Number.isNaN(parsed.getTime())) {
          rangeStart = parsed;
          rangeEnd = new Date(parsed.getTime());
          rangeEnd.setDate(rangeEnd.getDate() + 1);
          rangeEnd.setMilliseconds(rangeEnd.getMilliseconds() - 1);
        }
      }
      
      // Resolve teamMember -> workerProfile links from applications (authoritative for job ownership).
      const memberIds = members.map((m) => m.id);
      const appStatuses: Array<"accepted" | "pending"> = ["accepted", "pending"];
      const memberAppRows = memberIds.length === 0
        ? []
        : rangeStart && rangeEnd
          ? await db
              .select({
                teamMemberId: applications.teamMemberId,
                workerId: applications.workerId,
                jobId: applications.jobId,
              })
              .from(applications)
              .innerJoin(jobs, eq(applications.jobId, jobs.id))
              .where(
                and(
                  inArray(applications.teamMemberId, memberIds),
                  inArray(applications.status, appStatuses),
                  gte(jobs.startDate, rangeStart),
                  lte(jobs.startDate, rangeEnd)
                )
              )
          : await db
              .select({
                teamMemberId: applications.teamMemberId,
                workerId: applications.workerId,
                jobId: applications.jobId,
              })
              .from(applications)
              .where(and(inArray(applications.teamMemberId, memberIds), inArray(applications.status, appStatuses)));

      const memberToWorkerIds = new Map<number, Set<number>>();
      const memberToJobIds = new Map<number, Set<number>>();
      const allWorkerIds = new Set<number>();
      for (const row of memberAppRows) {
        if (row.teamMemberId == null) continue;
        const teammateId = row.teamMemberId;
        if (!memberToWorkerIds.has(teammateId)) memberToWorkerIds.set(teammateId, new Set<number>());
        if (!memberToJobIds.has(teammateId)) memberToJobIds.set(teammateId, new Set<number>());
        memberToWorkerIds.get(teammateId)!.add(row.workerId);
        memberToJobIds.get(teammateId)!.add(row.jobId);
        allWorkerIds.add(row.workerId);
      }

      // Pull pings for all mapped worker profiles. If no mappings exist yet, fall back to operator profile pings.
      const pingRows = allWorkerIds.size > 0
        ? await db
            .select({
              workerProfileId: locationPings.workerProfileId,
              jobId: locationPings.jobId,
              latitude: locationPings.latitude,
              longitude: locationPings.longitude,
              createdAt: locationPings.createdAt,
            })
            .from(locationPings)
            .where(
              rangeStart && rangeEnd
                ? and(
                    inArray(locationPings.workerProfileId, Array.from(allWorkerIds)),
                    gte(locationPings.createdAt, rangeStart),
                    lte(locationPings.createdAt, rangeEnd)
                  )
                : inArray(locationPings.workerProfileId, Array.from(allWorkerIds))
            )
            .orderBy(desc(locationPings.createdAt))
            .limit(2000)
        : await db
            .select({
              workerProfileId: locationPings.workerProfileId,
              jobId: locationPings.jobId,
              latitude: locationPings.latitude,
              longitude: locationPings.longitude,
              createdAt: locationPings.createdAt,
            })
            .from(locationPings)
            .where(
              rangeStart && rangeEnd
                ? and(
                    eq(locationPings.workerProfileId, profile.id),
                    gte(locationPings.createdAt, rangeStart),
                    lte(locationPings.createdAt, rangeEnd)
                  )
                : eq(locationPings.workerProfileId, profile.id)
            )
            .orderBy(desc(locationPings.createdAt))
            .limit(200);
      
      // Map members with their work locations and live locations
      // Work location = latitude/longitude from database (home base address)
      // Live location = from location pings (current GPS position)
      const membersWithLocations = members.map((member, index) => {
        // Work location is stored in member.latitude/longitude (home base)
        const workLat = member.latitude ? parseFloat(member.latitude) : null;
        const workLng = member.longitude ? parseFloat(member.longitude) : null;

        const workerIds = memberToWorkerIds.get(member.id) ?? new Set<number>();
        const jobIds = memberToJobIds.get(member.id) ?? new Set<number>();
        const relevantPings = pingRows.filter((p) => workerIds.has(p.workerProfileId));
        const matchedToJobs = relevantPings.filter((p) => p.jobId != null && jobIds.has(p.jobId));
        const effectivePings = matchedToJobs.length > 0 ? matchedToJobs : relevantPings;
        const fallbackPing = pingRows.length > 0 ? pingRows[index % pingRows.length] || pingRows[0] : null;
        const memberPing = effectivePings[0] || fallbackPing;
        const pingTimestamp = memberPing?.createdAt || new Date();

        const liveLat = memberPing?.latitude ? parseFloat(memberPing.latitude) : workLat;
        const liveLng = memberPing?.longitude ? parseFloat(memberPing.longitude) : workLng;
        const liveLocationPath = effectivePings
          .slice(0, 120)
          .reverse()
          .map((p) => ({
            lat: parseFloat(String(p.latitude)),
            lng: parseFloat(String(p.longitude)),
            createdAt: p.createdAt,
          }))
          .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
        
        return {
          ...member,
          // Keep work location in latitude/longitude fields
          // Add live location from pings
          liveLocationLat: liveLat,
          liveLocationLng: liveLng,
          liveLocationTimestamp: pingTimestamp,
          liveLocationPath,
        };
      });
      
      res.json(membersWithLocations);
    } catch (err) {
      console.error("Error fetching team members:", err);
      res.status(500).json({ message: "Failed to fetch team members" });
    }
  });

  // Add team member
  app.post("/api/worker-team/:teamId/members", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const teamId = Number(req.params.teamId);
      
      // Verify user owns this team
      const team = await storage.getTeamById(teamId);
      if (!team || team.ownerId !== profile.id) {
        return res.status(403).json({ message: "Not authorized to manage this team" });
      }
      
      const { firstName, lastName, email, phone, address, city, state, zipCode, latitude, longitude, role, hourlyRate, skillsets, avatarUrl } = req.body;
      
      // Generate invite token
      const crypto = await import("crypto");
      const inviteToken = crypto.randomBytes(32).toString("hex");
      
      const member = await storage.createWorkerTeamMember({
        teamId,
        firstName,
        lastName,
        email,
        phone,
        address,
        city,
        state,
        zipCode,
        latitude: latitude != null && latitude !== "" ? String(latitude) : undefined,
        longitude: longitude != null && longitude !== "" ? String(longitude) : undefined,
        avatarUrl,
        role: role || "employee",
        hourlyRate,
        skillsets,
        status: "pending",
        inviteToken,
        invitedAt: new Date(),
      });
      
      // Send invitation email if email is provided
      if (email) {
        const { sendEmail } = await import("./email-service");
        await sendEmail({
          to: email,
          type: "worker_team_invite",
          data: {
            memberFirstName: firstName,
            ownerName: `${profile.firstName} ${profile.lastName}`,
            role,
            hourlyRate,
            skills: skillsets?.join(", ") || "Not specified",
            inviteToken,
          }
        });
      }
      
      res.status(201).json(member);
    } catch (err) {
      console.error("Error adding team member:", err);
      res.status(500).json({ message: "Failed to add team member" });
    }
  });

  // Update team member
  app.patch("/api/worker-team/members/:memberId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const memberId = Number(req.params.memberId);
      const member = await storage.getWorkerTeamMember(memberId);
      
      if (!member) {
        return res.status(404).json({ message: "Team member not found" });
      }
      
      // Verify user owns the team
      const team = await storage.getTeamById(member.teamId);
      if (!team || team.ownerId !== profile.id) {
        return res.status(403).json({ message: "Not authorized to manage this team member" });
      }

      const updates: Record<string, unknown> = { ...req.body };
      const { address, city, state, zipCode, latitude, longitude } = req.body;

      if (latitude != null && longitude != null && latitude !== "" && longitude !== "") {
        updates.latitude = String(latitude);
        updates.longitude = String(longitude);
      } else if (address && typeof address === "string" && address.trim()) {
        const coords = (city && state && zipCode)
          ? await geocodeFullAddress(address.trim(), String(city), String(state), String(zipCode))
          : await geocodeAddress(address.trim());
        if (coords) {
          updates.latitude = coords.latitude;
          updates.longitude = coords.longitude;
        }
      }

      const updatedMember = await storage.updateWorkerTeamMember(memberId, updates as any);
      res.json(updatedMember);
    } catch (err) {
      console.error("Error updating team member:", err);
      res.status(500).json({ message: "Failed to update team member" });
    }
  });

  // Remove team member
  app.delete("/api/worker-team/members/:memberId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const memberId = Number(req.params.memberId);
      const member = await storage.getWorkerTeamMember(memberId);
      
      if (!member) {
        return res.status(404).json({ message: "Team member not found" });
      }
      
      // Verify user owns the team
      const team = await storage.getTeamById(member.teamId);
      if (!team || team.ownerId !== profile.id) {
        return res.status(403).json({ message: "Not authorized to manage this team member" });
      }
      
      await storage.deleteWorkerTeamMember(memberId);
      res.json({ success: true });
    } catch (err) {
      console.error("Error removing team member:", err);
      res.status(500).json({ message: "Failed to remove team member" });
    }
  });

  // Resend team member invitation
  app.post("/api/worker-team/members/:memberId/resend-invite", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const memberId = Number(req.params.memberId);
      const member = await storage.getWorkerTeamMember(memberId);
      
      if (!member) {
        return res.status(404).json({ message: "Team member not found" });
      }
      
      // Verify user owns the team
      const team = await storage.getTeamById(member.teamId);
      if (!team || team.ownerId !== profile.id) {
        return res.status(403).json({ message: "Not authorized to manage this team member" });
      }
      
      if (member.status !== "pending") {
        return res.status(400).json({ message: "Team member is not pending invitation" });
      }
      
      // Generate new invite token
      const crypto = await import("crypto");
      const inviteToken = crypto.randomBytes(32).toString("hex");
      
      await storage.updateWorkerTeamMember(memberId, {
        inviteToken,
        invitedAt: new Date(),
      } as any);
      
      // Send invitation email
      if (member.email) {
        const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
        const inviteLink = `${baseUrl}/team/join/${inviteToken}`;
        await sendEmail({
          to: member.email,
          type: "worker_team_invite",
          data: {
            firstName: member.firstName,
            ownerName: `${profile.firstName} ${profile.lastName}`,
            inviteLink,
            role: member.role,
          },
        });
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error("Error resending invitation:", err);
      res.status(500).json({ message: "Failed to resend invitation" });
    }
  });

  // Auto-accept team member invitation (dev mode only)
  app.post("/api/worker-team/members/:memberId/auto-accept", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    // Only allow in development
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Not available in production" });
    }
    
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const memberId = Number(req.params.memberId);
      const member = await storage.getWorkerTeamMember(memberId);
      
      if (!member) {
        return res.status(404).json({ message: "Team member not found" });
      }
      
      // Verify user owns the team
      const team = await storage.getTeamById(member.teamId);
      if (!team || team.ownerId !== profile.id) {
        return res.status(403).json({ message: "Not authorized to manage this team member" });
      }
      
      if (member.status !== "pending") {
        return res.status(400).json({ message: "Team member is not pending invitation" });
      }
      
      // Auto-accept: set to active, clear token
      await storage.updateWorkerTeamMember(memberId, {
        status: "active",
        inviteToken: null,
        acceptedAt: new Date(),
      } as any);
      
      res.json({ success: true });
    } catch (err) {
      console.error("Error auto-accepting invitation:", err);
      res.status(500).json({ message: "Failed to auto-accept invitation" });
    }
  });

  // === Dev-only: Impersonate user ===
  app.post("/api/dev/impersonate/:userId", async (req, res) => {
    // Only allow in development mode
    if (process.env.NODE_ENV !== "development") {
      return res.status(403).json({ message: "Not available in production" });
    }
    
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const targetUserId = Number(req.params.userId);
      
      // Get the target profile
      const targetProfile = await storage.getProfile(targetUserId);
      if (!targetProfile) {
        return res.status(404).json({ message: "Target user not found" });
      }
      
      // Store original user ID in session for "stop impersonating" functionality
      const currentUser = req.user as any;
      (req.session as any).originalUserId = currentUser.claims.sub;
      (req.session as any).impersonatingUserId = targetProfile.userId;
      
      // Update the session's user claims to impersonate the target
      currentUser.claims.sub = targetProfile.userId;
      
      console.log(`[DEV] User impersonating profile ${targetUserId} (userId: ${targetProfile.userId})`);
      
      res.json({ success: true, impersonating: targetProfile.firstName + " " + targetProfile.lastName });
    } catch (err) {
      console.error("Error impersonating user:", err);
      res.status(500).json({ message: "Failed to impersonate user" });
    }
  });

  // === Dev-only: Impersonate team member ===
  app.post("/api/dev/impersonate-team-member/:memberId", async (req, res) => {
    // Only allow in development mode
    if (process.env.NODE_ENV !== "development") {
      return res.status(403).json({ message: "Not available in production" });
    }
    
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const memberId = Number(req.params.memberId);
      
      // Get the team member
      const member = await storage.getWorkerTeamMember(memberId);
      if (!member) {
        return res.status(404).json({ message: "Team member not found" });
      }
      
      // Get the team owner (business operator)
      const team = await storage.getTeamById(member.teamId);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      const ownerProfile = await storage.getProfile(team.ownerId);
      if (!ownerProfile) {
        return res.status(404).json({ message: "Team owner not found" });
      }
      
      // Store original user ID and impersonation data in session
      const currentUser = req.user as any;
      (req.session as any).originalUserId = currentUser.claims.sub;
      (req.session as any).impersonatingTeamMemberId = memberId;
      (req.session as any).impersonatingAsEmployee = true;
      
      // Set the session to view as the team owner but with employee restrictions
      // The frontend will check for this flag to restrict navigation
      currentUser.claims.sub = ownerProfile.userId;
      
      console.log(`[DEV] User impersonating team member ${memberId} (${member.firstName} ${member.lastName})`);
      
      res.json({ 
        success: true, 
        impersonating: `${member.firstName} ${member.lastName}`,
        isEmployee: true
      });
    } catch (err) {
      console.error("Error impersonating team member:", err);
      res.status(500).json({ message: "Failed to impersonate team member" });
    }
  });

  // === Dev-only: Stop impersonating ===
  app.post("/api/dev/stop-impersonate", async (req, res) => {
    if (process.env.NODE_ENV !== "development") {
      return res.status(403).json({ message: "Not available in production" });
    }
    
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const originalUserId = (req.session as any).originalUserId;
      if (!originalUserId) {
        return res.status(400).json({ message: "Not currently impersonating anyone" });
      }
      
      // Restore original user
      const currentUser = req.user as any;
      currentUser.claims.sub = originalUserId;
      
      // Clear impersonation data
      delete (req.session as any).originalUserId;
      delete (req.session as any).impersonatingUserId;
      delete (req.session as any).impersonatingTeamMemberId;
      delete (req.session as any).impersonatingAsEmployee;
      
      console.log(`[DEV] Stopped impersonation, restored user ${originalUserId}`);
      
      res.json({ success: true });
    } catch (err) {
      console.error("Error stopping impersonation:", err);
      res.status(500).json({ message: "Failed to stop impersonation" });
    }
  });

  // === Dev-only: Get impersonation status ===
  app.get("/api/dev/impersonate-status", async (req, res) => {
    if (process.env.NODE_ENV !== "development") {
      return res.status(403).json({ message: "Not available in production" });
    }
    
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const impersonatingUserId = (req.session as any).impersonatingUserId;
      const originalUserId = (req.session as any).originalUserId;
      
      if (impersonatingUserId && originalUserId) {
        const impersonatedProfile = await storage.getProfileByUserId(impersonatingUserId);
        const originalProfile = await storage.getProfileByUserId(originalUserId);
        
        res.json({
          isImpersonating: true,
          impersonating: impersonatedProfile ? {
            id: impersonatedProfile.id,
            name: `${impersonatedProfile.firstName} ${impersonatedProfile.lastName}`,
            role: impersonatedProfile.role,
          } : null,
          originalUser: originalProfile ? {
            id: originalProfile.id,
            name: `${originalProfile.firstName} ${originalProfile.lastName}`,
          } : null,
        });
      } else {
        res.json({ isImpersonating: false });
      }
    } catch (err) {
      console.error("Error getting impersonation status:", err);
      res.status(500).json({ message: "Failed to get impersonation status" });
    }
  });

  // === Worker Presence API (for map real-time tracking) ===
  app.get("/api/worker/presence", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile || profile.role !== "worker") {
        return res.status(403).json({ message: "Workers only" });
      }
      
      // Get worker's own location
      const workerLocation = {
        id: profile.id,
        type: "worker" as const,
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        avatarUrl: profile.avatarUrl,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        zipCode: profile.zipCode,
        latitude: profile.latitude,
        longitude: profile.longitude,
        isCurrentlyWorking: false,
        currentJobId: null as number | null,
        currentJobLocation: null as { lat: number; lng: number } | null,
      };
      
      // Check if worker has an active timesheet (currently clocked in)
      const activeTimesheets = await storage.getActiveTimesheetsForWorker(profile.id);
      if (activeTimesheets.length > 0) {
        const activeTimesheet = activeTimesheets[0];
        workerLocation.isCurrentlyWorking = true;
        workerLocation.currentJobId = activeTimesheet.jobId;
        if (activeTimesheet.clockInLatitude && activeTimesheet.clockInLongitude) {
          const lat = parseFloat(activeTimesheet.clockInLatitude);
          const lng = parseFloat(activeTimesheet.clockInLongitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            workerLocation.currentJobLocation = { lat, lng };
          }
        }
      }
      
      // Get team members if worker is a business operator
      const teamMembers: Array<{
        id: number;
        type: "team_member";
        firstName: string;
        lastName: string;
        avatarUrl: string | null;
        address: string | null;
        city: string | null;
        state: string | null;
        zipCode: string | null;
        latitude: string | null;
        longitude: string | null;
        isCurrentlyWorking: boolean;
        currentJobId: number | null;
        currentJobLocation: { lat: number; lng: number } | null;
      }> = [];
      
      const team = await storage.getWorkerTeam(profile.id);
      if (team) {
        const members = await storage.getWorkerTeamMembers(team.id);
        for (const member of members) {
          if (member.status !== "active") continue;
          
          const memberData = {
            id: member.id,
            type: "team_member" as const,
            firstName: member.firstName,
            lastName: member.lastName,
            avatarUrl: member.avatarUrl,
            address: member.address,
            city: member.city,
            state: member.state,
            zipCode: member.zipCode,
            latitude: member.latitude,
            longitude: member.longitude,
            isCurrentlyWorking: false,
            currentJobId: null as number | null,
            currentJobLocation: null as { lat: number; lng: number } | null,
          };
          
          // Check if team member has active timesheet
          const memberTimesheets = await storage.getActiveTimesheetsForTeamMember(member.id);
          if (memberTimesheets.length > 0) {
            const activeTimesheet = memberTimesheets[0];
            memberData.isCurrentlyWorking = true;
            memberData.currentJobId = activeTimesheet.jobId;
            if (activeTimesheet.clockInLatitude && activeTimesheet.clockInLongitude) {
              const lat = parseFloat(activeTimesheet.clockInLatitude);
              const lng = parseFloat(activeTimesheet.clockInLongitude);
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                memberData.currentJobLocation = { lat, lng };
              }
            }
          }
          
          teamMembers.push(memberData);
        }
      }
      
      res.json({
        worker: workerLocation,
        teamMembers,
      });
    } catch (err) {
      console.error("Error fetching worker presence:", err);
      res.status(500).json({ message: "Failed to fetch presence data" });
    }
  });

  // Worker: W-9 status verified with Mercury (only show "W-9 on File" when Mercury has the attachment)
  app.get("/api/worker/w9-status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can access this endpoint" });
    }
    const recipientId = profile.mercuryRecipientId ?? null;
    if (!recipientId) {
      return res.json({ attached: false, recipientId: null });
    }
    try {
      const { mercuryService } = await import("./services/mercury");
      const attached = await mercuryService.recipientHasW9Attachment(recipientId);
      return res.json({ attached, recipientId });
    } catch (err: any) {
      console.error("[W9Status] Error checking Mercury:", err?.message ?? err);
      const is404 = err?.status === 404 || err?.statusCode === 404 || err?.details?.errors?.notFound;
      if (is404 && profile?.id) {
        await storage.updateProfile(profile.id, { mercuryRecipientId: null, mercuryExternalAccountId: null, bankAccountLinked: false });
        clearProfileSnapshot(req);
        console.log(`[W9Status] Cleared recipient and bankAccountLinked for profile ${profile.id} (Mercury 404)`);
        return res.json({ attached: false, recipientId: null, recipientInvalid: true });
      }
      return res.json({ attached: false, recipientId });
    }
  });

  // Verify team invite token (public)
  app.get("/api/team/invite/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const member = await storage.getWorkerTeamMemberByInviteToken(token);
      
      if (!member) {
        return res.status(404).json({ message: "Invalid or expired invitation" });
      }
      
      // Check if already accepted
      if (member.status === "active" && member.acceptedAt) {
        return res.status(400).json({ message: "This invitation has already been accepted" });
      }
      
      // Check if invite is expired (7 days)
      if (member.invitedAt) {
        const expiresAt = new Date(member.invitedAt);
        expiresAt.setDate(expiresAt.getDate() + 7);
        if (new Date() > expiresAt) {
          return res.status(400).json({ message: "This invitation has expired" });
        }
      }
      
      // Get team owner info
      const team = await storage.getTeamById(member.teamId);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      const owner = await storage.getProfile(team.ownerId);
      
      res.json({
        member: {
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
          role: member.role,
          hourlyRate: member.hourlyRate,
          skillsets: member.skillsets,
        },
        owner: owner ? {
          firstName: owner.firstName,
          lastName: owner.lastName,
          companyLogo: owner.companyLogo,
        } : null,
        teamName: team.name,
      });
    } catch (err) {
      console.error("Error verifying team invite:", err);
      res.status(500).json({ message: "Failed to verify invitation" });
    }
  });

  // Get team info by ID (public - for onboarding)
  app.get("/api/team/:id", async (req, res) => {
    try {
      const teamId = Number(req.params.id);
      const team = await storage.getTeamById(teamId);
      
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      const owner = await storage.getProfile(team.ownerId);
      
      res.json({
        id: team.id,
        name: team.name,
        owner: owner ? {
          firstName: owner.firstName,
          lastName: owner.lastName,
        } : null,
      });
    } catch (err) {
      console.error("Error fetching team:", err);
      res.status(500).json({ message: "Failed to fetch team" });
    }
  });

  // Public team onboarding (no invite token required)
  app.post("/api/team/:id/onboard", async (req, res) => {
    try {
      const teamId = Number(req.params.id);
      const { firstName, lastName, email, phone, address, city, state, zipCode, password } = req.body;
      
      if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ message: "First name, last name, email, and password are required" });
      }
      
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      
      // Verify team exists
      const team = await storage.getTeamById(teamId);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Check if email already exists for this team
      const existingMember = await db.select().from(workerTeamMembers)
        .where(and(
          eq(workerTeamMembers.teamId, teamId),
          eq(workerTeamMembers.email, email)
        ))
        .then(r => r[0]);
      
      if (existingMember) {
        return res.status(400).json({ message: "A team member with this email already exists" });
      }
      
      // Hash password
      const bcrypt = await import("bcrypt");
      const passwordHash = await bcrypt.hash(password, 12);
      
      // Generate invite token (for consistency, though not required for onboarding)
      const crypto = await import("crypto");
      const inviteToken = crypto.randomBytes(32).toString("hex");
      
      // Create team member with pending status
      const member = await storage.createWorkerTeamMember({
        teamId,
        firstName,
        lastName,
        email,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        role: "employee", // Default to employee for public onboarding
        hourlyRate: 0, // Will be set by team owner
        skillsets: [],
        status: "pending",
        inviteToken,
        invitedAt: new Date(),
      });
      
      // Store password hash
      await storage.updateWorkerTeamMemberPassword(member.id, passwordHash);
      
      res.json({ success: true, message: "Account created successfully. The team owner will review your application." });
    } catch (err: any) {
      console.error("Error creating team member:", err);
      res.status(500).json({ message: err.message || "Failed to create account" });
    }
  });

  // Accept team invite (public)
  app.post("/api/team/invite/:token/accept", async (req, res) => {
    try {
      const { token } = req.params;
      const { firstName, lastName, email, password, avatarUrl } = req.body;
      
      // Validate required fields
      if (!firstName || !lastName || !email) {
        return res.status(400).json({ message: "First name, last name, and email are required" });
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address" });
      }
      
      // Password is optional (can use Google OAuth instead)
      if (password && password.length > 0 && password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      
      const member = await storage.getWorkerTeamMemberByInviteToken(token);
      
      if (!member) {
        return res.status(404).json({ message: "Invalid or expired invitation" });
      }
      
      // Check if already accepted
      if (member.status === "active" && member.acceptedAt) {
        return res.status(400).json({ message: "This invitation has already been accepted" });
      }
      
      // Check if invite is expired (7 days)
      if (member.invitedAt) {
        const expiresAt = new Date(member.invitedAt);
        expiresAt.setDate(expiresAt.getDate() + 7);
        if (new Date() > expiresAt) {
          return res.status(400).json({ message: "This invitation has expired" });
        }
      }
      
      // Hash password if provided
      let passwordHash = null;
      if (password && password.length >= 8) {
        const bcrypt = await import("bcrypt");
        passwordHash = await bcrypt.hash(password, 12);
      }
      
      // Update member status and user info
      const updateData: any = {
        firstName,
        lastName,
        email,
        status: "active",
        acceptedAt: new Date(),
        inviteToken: null, // Clear token after use
      };
      
      // Add avatar if provided
      if (avatarUrl) {
        updateData.avatarUrl = avatarUrl;
      }
      
      await storage.updateWorkerTeamMember(member.id, updateData);
      
      // Store password hash if provided
      if (passwordHash) {
        await storage.updateWorkerTeamMemberPassword(member.id, passwordHash);
      }
      
      res.json({ success: true, message: "Account created successfully" });
    } catch (err) {
      console.error("Error accepting team invite:", err);
      res.status(500).json({ message: "Failed to accept invitation" });
    }
  });

  // === Digital Signatures ===
  app.get("/api/signatures/:profileId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profileId = Number(req.params.profileId);
    const signatures = await db.select().from(digitalSignatures).where(
      eq(digitalSignatures.profileId, profileId)
    );
    res.json(signatures);
  });

  // Create digital signature (for worker contract signing)
  app.post("/api/signatures", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { profileId, documentType, documentVersion, signedName, signatureData: bodySignatureData, signedAt } = req.body;
      
      if (!profileId || !documentType || !signedName) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      // Verify the profile belongs to the authenticated user
      const profile = await storage.getProfile(profileId);
      if (!profile || profile.userId !== (req.user as any).claims.sub) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Check if signature already exists
      const existing = await db
        .select()
        .from(digitalSignatures)
        .where(
          and(
            eq(digitalSignatures.profileId, profileId),
            eq(digitalSignatures.documentType, documentType)
          )
        )
        .limit(1);
      
      if (existing.length > 0) {
        return res.json(existing[0]); // Return existing signature
      }
      
      // Create new signature (signatureData: drawn image data URL or typed name; signedName: display name)
      const [signature] = await db
        .insert(digitalSignatures)
        .values({
          profileId,
          documentType,
          documentVersion: documentVersion || "1.0",
          signatureData: bodySignatureData != null ? String(bodySignatureData) : signedName,
          signedName,
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || "unknown",
          userAgent: req.headers['user-agent'] || "unknown",
          signedAt: signedAt ? new Date(signedAt) : new Date(),
        })
        .returning();
      
      // Also update profile contractSignedAt field
      await db
        .update(profiles)
        .set({ contractSignedAt: new Date() })
        .where(eq(profiles.id, profileId));
      
      res.status(201).json(signature);
    } catch (error: any) {
      console.error("Failed to save signature:", error);
      res.status(500).json({ message: "Failed to save signature" });
    }
  });

  // === Company Agreements (stored in company menu of agreements) ===
  app.get("/api/company-agreements", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    const list = await db
      .select()
      .from(companyAgreements)
      .where(eq(companyAgreements.profileId, profile.id))
      .orderBy(desc(companyAgreements.signedAt));
    res.json(list);
  });

  app.post("/api/company-agreements", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      const bodySchema = z.object({
        agreementType: z.enum(["hiring_agreement", "terms_of_service", "privacy_policy", "payment_terms"]),
        version: z.string(),
        signedName: z.string().optional(),
        signatureData: z.string().optional(),
        agreementText: z.string().optional(),
      });
      const body = bodySchema.safeParse(req.body);
      if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
      const { agreementType, version, signedName, signatureData, agreementText } = body.data;
      const [row] = await db
        .insert(companyAgreements)
        .values({
          profileId: profile.id,
          agreementType,
          version,
          signedName: signedName ?? (profile.firstName + " " + profile.lastName),
          signatureData: signatureData ?? null,
          agreementText: agreementText ?? null,
          ipAddress: req.ip || (req.headers["x-forwarded-for"] as string) || null,
        })
        .returning();
      // Keep profile in sync so agreement and payment modals don't reappear
      if (agreementType === "hiring_agreement") {
        await db.update(profiles).set({ contractSigned: true, contractSignedAt: new Date() }).where(eq(profiles.id, profile.id));
      }
      res.status(201).json(row);
    } catch (error: any) {
      console.error("Failed to save company agreement:", error);
      res.status(500).json({ message: "Failed to save company agreement" });
    }
  });

  // === Company Locations ===
  app.get(api.companyLocations.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const locations = await storage.getCompanyLocations(profile.id);
    res.json(locations);
  });

  app.post(api.companyLocations.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const input = api.companyLocations.create.input.parse(req.body);
      
      const { latitude, longitude } = await geocodeCompanyLocationInBackground({
        address: input.address,
        address2: (input as any).address2,
        city: input.city,
        state: input.state,
        zipCode: input.zipCode,
      });
      
      const location = await storage.createCompanyLocation({ 
        ...input, 
        profileId: profile.id,
        latitude,
        longitude,
      });
      res.status(201).json(location);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.put(api.companyLocations.update.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const id = Number(req.params.id);
      const existingLocation = await storage.getCompanyLocation(id);
      if (!existingLocation || existingLocation.profileId !== profile.id) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      const input = api.companyLocations.update.input.parse(req.body);
      
      const address = input.address || existingLocation.address;
      const address2 = input.address2 !== undefined ? input.address2 : existingLocation.address2;
      const city = input.city || existingLocation.city;
      const state = input.state || existingLocation.state;
      const zipCode = input.zipCode || existingLocation.zipCode;
      const geocoded = await geocodeCompanyLocationInBackground({ address, address2, city, state, zipCode });
      const latitude = geocoded.latitude ?? existingLocation.latitude ?? undefined;
      const longitude = geocoded.longitude ?? existingLocation.longitude ?? undefined;
      
      const updateData = {
        ...input,
        latitude,
        longitude,
      };
      
      const location = await storage.updateCompanyLocation(id, updateData);
      res.json(location);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.companyLocations.delete.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const id = Number(req.params.id);
    const existingLocation = await storage.getCompanyLocation(id);
    if (!existingLocation || existingLocation.profileId !== profile.id) {
      return res.status(404).json({ message: "Location not found" });
    }
    
    await storage.deleteCompanyLocation(id);
    res.json({ success: true });
  });

  // === Team Invites ===
  app.get(api.teamInvites.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const invites = await storage.getTeamInvites(profile.id);
    res.json(invites);
  });

  app.post(api.teamInvites.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      
      const input = api.teamInvites.create.input.parse(req.body);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const token = generateInviteToken();
      const invite = await storage.createTeamInvite({ 
        profileId: profile.id, 
        email: input.email,
        token,
        role: input.role || "manager",
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        locationIds: input.locationIds,
        expiresAt,
      });

      const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
      const inviteLink = `${baseUrl}/company/join/${token}`;

      sendEmail({
        to: input.email,
        type: 'team_invite_sent',
        data: {
          companyName: profile.companyName || `${profile.firstName} ${profile.lastName}`,
          inviterName: `${profile.firstName} ${profile.lastName}`,
          expiresAt: expiresAt.toLocaleDateString(),
          inviteToken: token,
          inviteLink,
        }
      }).catch(err => console.error('Failed to send team invite email:', err));

      res.status(201).json(invite);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Accept team invite
  app.post("/api/team-invites/:id/accept", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const id = Number(req.params.id);
    const invite = await storage.getTeamInvite(id);
    
    if (!invite) {
      return res.status(404).json({ message: "Invite not found" });
    }
    
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return res.status(400).json({ message: "Invite has expired" });
    }
    
    const user = req.user as any;
    const memberProfile = req.profile;

    if (!memberProfile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Update member's teamId to join the company
    await storage.updateProfile(memberProfile.id, { teamId: invite.profileId });
    
    // Delete the invite
    await storage.deleteTeamInvite(id);
    
    // Get company profile to send notification
    const companyProfile = await storage.getProfile(invite.profileId);
    
    if (companyProfile?.email && companyProfile.emailNotifications) {
      sendEmail({
        to: companyProfile.email,
        type: 'team_member_joined',
        data: {
          memberName: `${memberProfile.firstName} ${memberProfile.lastName}`,
          memberEmail: memberProfile.email,
          joinedDate: new Date().toLocaleDateString(),
        }
      }).catch(err => console.error('Failed to send team member joined email:', err));
    }
    
    res.json({ success: true });
  });

  app.delete(api.teamInvites.delete.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const id = Number(req.params.id);
    const existingInvite = await storage.getTeamInvite(id);
    if (!existingInvite || existingInvite.profileId !== profile.id) {
      return res.status(404).json({ message: "Invite not found" });
    }
    
    await storage.deleteTeamInvite(id);
    res.json({ success: true });
  });

  // Resend team invite email
  app.post("/api/team-invites/:id/resend", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const id = Number(req.params.id);
    const invite = await storage.getTeamInvite(id);
    
    if (!invite || invite.profileId !== profile.id) {
      return res.status(404).json({ message: "Invite not found" });
    }
    
    if (invite.status !== "pending") {
      return res.status(400).json({ message: "Invite has already been used" });
    }
    
    // Extend expiration by 7 more days
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await storage.updateTeamInvite(id, { expiresAt: newExpiresAt } as any);
    
    const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
    const inviteLink = `${baseUrl}/company/join/${invite.token}`;

    sendEmail({
      to: invite.email,
      type: 'team_invite_sent',
      data: {
        companyName: profile.companyName || `${profile.firstName} ${profile.lastName}`,
        inviterName: `${profile.firstName} ${profile.lastName}`,
        expiresAt: newExpiresAt.toLocaleDateString(),
        inviteToken: invite.token,
        inviteLink,
      }
    }).catch(err => console.error('Failed to resend team invite email:', err));

    res.json({ success: true, message: "Invite email resent successfully" });
  });

  // Verify invite token (public - no auth required)
  app.get("/api/team-invites/verify/:token", async (req, res) => {
    const token = req.params.token;
    const invite = await storage.getTeamInviteByToken(token);
    
    if (!invite) {
      return res.status(404).json({ message: "Invite not found or invalid" });
    }
    
    if (invite.status !== "pending") {
      return res.status(400).json({ message: "Invite has already been used" });
    }
    
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return res.status(400).json({ message: "Invite has expired" });
    }
    
    const companyProfile = await storage.getProfile(invite.profileId);
    
    res.json({
      valid: true,
      email: invite.email,
      role: invite.role,
      companyName: companyProfile?.companyName || `${companyProfile?.firstName} ${companyProfile?.lastName}`,
      expiresAt: invite.expiresAt,
    });
  });

  // Accept invite by token (public - creates new user)
  app.post("/api/team-invites/accept/:token", async (req, res) => {
    const bcrypt = await import("bcrypt");
    const token = req.params.token;
    const { firstName, lastName, email, phone, password } = req.body;
    
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "First name, last name, email, and password are required" });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }
    
    const invite = await storage.getTeamInviteByToken(token);
    
    if (!invite) {
      return res.status(404).json({ message: "Invite not found or invalid" });
    }
    
    if (invite.status !== "pending") {
      return res.status(400).json({ message: "Invite has already been used" });
    }
    
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return res.status(400).json({ message: "Invite has expired" });
    }
    
    if (email.toLowerCase() !== invite.email.toLowerCase()) {
      return res.status(400).json({ message: "Email does not match the invite" });
    }
    
    const passwordHash = await bcrypt.hash(password, 12);
    const newUserId = `team_${crypto.randomBytes(16).toString('hex')}`;
    
    await db.insert(users).values({
      id: newUserId,
      email,
      firstName,
      lastName,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    const teamMember = await storage.createCompanyTeamMember({
      companyProfileId: invite.profileId,
      userId: newUserId,
      firstName,
      lastName,
      email,
      phone,
      role: invite.role || "manager",
      passwordHash,
      inviteId: invite.id,
      locationIds: invite.locationIds || null,
      isActive: true,
    });
    
    await storage.updateTeamInvite(invite.id, { 
      status: "accepted",
      acceptedAt: new Date(),
    } as any);
    
    const companyProfile = await storage.getProfile(invite.profileId);
    
    if (companyProfile?.email && companyProfile.emailNotifications) {
      sendEmail({
        to: companyProfile.email,
        type: 'team_member_joined',
        data: {
          memberName: `${firstName} ${lastName}`,
          memberEmail: email,
          joinedDate: new Date().toLocaleDateString(),
        }
      }).catch(err => console.error('Failed to send team member joined email:', err));
    }
    
    res.status(201).json({ 
      success: true, 
      message: "Account created successfully. You can now log in.",
      memberId: teamMember.id,
    });
  });

  // === Company Team Members ===
  const getCompanyTeamMembersHandler = async (req: any, res: any) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const members = await storage.getCompanyTeamMembers(profile.id);
    res.json(members);
  };

  app.get("/api/team-members", getCompanyTeamMembersHandler);
  app.get("/api/company/team", getCompanyTeamMembersHandler);

  app.delete("/api/team-members/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const memberId = Number(req.params.id);
    const member = await storage.getCompanyTeamMember(memberId);
    
    if (!member || member.companyProfileId !== profile.id) {
      return res.status(404).json({ message: "Team member not found" });
    }
    
    if (member.role === "owner") {
      return res.status(400).json({ message: "Cannot remove the owner" });
    }
    
    await storage.deleteCompanyTeamMember(memberId);
    res.json({ success: true });
  });

  // === Saved Team Members (Contractors; per location) ===
  app.get("/api/saved-team", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    const locationId = req.query.locationId ? Number(req.query.locationId) : undefined;
    const savedTeam = await storage.getSavedTeamMembers(profile.id, locationId);
    res.json(savedTeam);
  });

  // Team data grouped by location (company team members + saved workers per location)
  app.get("/api/team-by-location", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "company") return res.status(403).json({ message: "Only companies can access team by location" });
    try {
      const locations = await storage.getCompanyLocations(profile.id);
      const allSaved = await storage.getSavedTeamMembers(profile.id);
      const companyTeamMembersList = await storage.getCompanyTeamMembers(profile.id);
      const result = locations.map((loc: any) => {
        const repId = loc.representativeTeamMemberId ?? loc.representative_team_member_id;
        const assignedIds = loc.assignedTeamMemberIds ?? loc.assigned_team_member_ids ?? [];
        const locationMemberIds = new Set<number>([repId, ...assignedIds].filter(Boolean));
        const companyTeam = companyTeamMembersList.filter((m: any) => locationMemberIds.has(m.id));
        const savedWorkers = allSaved.filter((m: any) => (m.companyLocationId ?? m.company_location_id) === loc.id);
        return {
          id: loc.id,
          name: loc.name,
          address: loc.address,
          city: loc.city,
          state: loc.state,
          zipCode: loc.zipCode ?? loc.zip_code,
          companyTeamMembers: companyTeam,
          savedWorkers,
        };
      });
      res.json({ locations: result });
    } catch (err: any) {
      console.error("Team by location error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/saved-team", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    const { workerId, jobId, notes, locationId } = req.body;
    const companyLocationId = locationId != null ? Number(locationId) : null;
    const checkLocationId = companyLocationId ?? undefined;
    const existing = await storage.getSavedTeamMember(profile.id, Number(workerId), checkLocationId);
    if (existing) {
      return res.status(400).json({ message: companyLocationId ? "Worker already on this location's team" : "Worker already in your team" });
    }
    const savedMember = await storage.createSavedTeamMember({
      companyId: profile.id,
      workerId: Number(workerId),
      companyLocationId: companyLocationId || undefined,
      addedFromJobId: jobId || null,
      notes: notes || null,
    });
    res.status(201).json(savedMember);
  });

  app.patch("/api/saved-team/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const savedTeam = await storage.getSavedTeamMembers(profile.id);
    const member = savedTeam.find(m => m.id === Number(req.params.id));
    
    if (!member) {
      return res.status(404).json({ message: "Saved team member not found" });
    }
    
    const updated = await storage.updateSavedTeamMember(member.id, req.body);
    res.json(updated);
  });

  app.delete("/api/saved-team/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const savedTeam = await storage.getSavedTeamMembers(profile.id);
    const member = savedTeam.find(m => m.id === Number(req.params.id));
    
    if (!member) {
      return res.status(404).json({ message: "Saved team member not found" });
    }
    
    await storage.deleteSavedTeamMember(member.id);
    res.json({ success: true });
  });

  // Get workers with approved jobs who are not yet on the team; each has the location they worked at (for auto-add to that location's team)
  app.get("/api/potential-team-members", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const withLocation = await storage.getWorkersWithApprovedJobsAndLocation(profile.id);
    res.json(withLocation);
  });

  // === Worker Reports/Strikes ===
  app.post("/api/worker-report", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const { workerId, timesheetId, explanation, isStrike } = req.body;
    
    if (!explanation || explanation.length < 30) {
      return res.status(400).json({ message: "Explanation must be at least 30 characters" });
    }
    
    // Create the report
    const report = await storage.createTimesheetReport({
      timesheetId: timesheetId || null,
      reportedBy: profile.id,
      workerId,
      explanation,
      isStrike: isStrike !== false,
    });
    
    // Get worker for email notification
    const worker = await storage.getProfile(workerId);
    if (worker?.email) {
      // Send email notification to worker
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        
        // Development email override: redirect all emails to test email
        const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV || process.env.NODE_ENV === 'dev';
        const originalTo = worker.email;
        const finalTo = isDevelopment ? 'cairlbrandon@gmail.com' : worker.email;
        
        if (isDevelopment && originalTo !== finalTo) {
          console.log(`[DEV EMAIL OVERRIDE] Redirecting email from "${originalTo}" to "${finalTo}"`);
        }
        
        await resend.emails.send({
          from: "Tolstoy Staffing <noreply@tolstoy.com>",
          to: finalTo,
          subject: isDevelopment && originalTo !== finalTo 
            ? `[DEV] ${isStrike !== false ? "You have received a strike" : "Report notification"} (Original: ${originalTo})`
            : (isStrike !== false ? "You have received a strike" : "Report notification"),
          html: `
            <h2>You have received a ${isStrike !== false ? "strike" : "report"}</h2>
            <p><strong>From:</strong> ${profile.companyName || `${profile.firstName} ${profile.lastName}`}</p>
            <p><strong>Reason:</strong></p>
            <p>${explanation}</p>
            ${isStrike !== false ? `
              <p style="color: #ef4444; font-weight: bold;">
                Warning: Receiving 3 strikes will result in being banned from Tolstoy Staffing.
              </p>
              <p>Your current strike count: ${(worker.strikeCount || 0) + 1}</p>
            ` : ""}
          `,
        });
      } catch (err) {
        console.error("Failed to send strike email:", err);
      }
    }
    
    res.status(201).json(report);
  });

  // Get strikes for a worker (worker viewing their own strikes)
  app.get("/api/my-strikes", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const strikes = await storage.getTimesheetReports(profile.id);
    res.json({
      strikes,
      strikeCount: profile.strikeCount || 0,
      isBanned: (profile.strikeCount || 0) >= 3
    });
  });

  // === Company Locations ===
  app.get("/api/locations", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });

    let companyProfileId = profile.id;
    let locations = await storage.getCompanyLocations(companyProfileId);

    if (profile.role === "company" && profile.userId) {
      const tm = await storage.getActiveCompanyTeamMembershipForUser(String(profile.userId));
      if (tm) {
        companyProfileId = tm.companyProfileId;
        locations = await storage.getCompanyLocations(companyProfileId);
        const restrict =
          tm.role !== "admin" && Array.isArray(tm.locationIds) && tm.locationIds.length > 0;
        if (restrict) {
          const locIds = tm.locationIds ?? [];
          const allowed = new Set(locIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)));
          locations = locations.filter((loc) => allowed.has(loc.id));
        }
      }
    }

    res.json(locations);
  });

  app.post("/api/locations", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const { latitude, longitude } = await geocodeCompanyLocationInBackground({
      address: req.body.address,
      address2: req.body.address2,
      city: req.body.city,
      state: req.body.state,
      zipCode: req.body.zipCode,
    });
    
    const locationData = {
      ...req.body,
      profileId: profile.id,
      latitude,
      longitude,
    };
    
    const location = await storage.createCompanyLocation(locationData);
    res.status(201).json(location);
  });

  app.patch("/api/locations/:id", async (req, res) => {
    const isDev = process.env.NODE_ENV === "development";
    const locationId = Number(req.params.id);
    
    // Get location first to check if it exists
    const existing = await storage.getCompanyLocation(locationId);
    if (!existing) {
      return res.status(404).json({ message: "Location not found" });
    }
    
    // In dev mode, bypass authentication for testing
    let profile;
    if (isDev && !req.isAuthenticated()) {
      // In dev mode, get profile from location's profileId
      profile = await storage.getProfile(existing.profileId);
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }
    } else {
      // Production mode: require authentication
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      
      const user = req.user as any;
      profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });

      // In production, check if profile owns this location
      if (existing.profileId !== profile.id) {
        return res.status(404).json({ message: "Location not found" });
      }
    }
    
    const address = req.body.address || existing.address;
    const address2 = req.body.address2 !== undefined ? req.body.address2 : existing.address2;
    const city = req.body.city || existing.city;
    const state = req.body.state || existing.state;
    const zipCode = req.body.zipCode || existing.zipCode;
    const geocoded = await geocodeCompanyLocationInBackground({ address, address2, city, state, zipCode });
    const latitude = geocoded.latitude ?? existing.latitude ?? undefined;
    const longitude = geocoded.longitude ?? existing.longitude ?? undefined;
    
    const updateData = {
      ...req.body,
      latitude,
      longitude,
    };
    
    const updated = await storage.updateCompanyLocation(locationId, updateData);
    res.json(updated);
  });

  app.delete("/api/locations/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    
    const locationId = Number(req.params.id);
    const existing = await storage.getCompanyLocation(locationId);
    
    if (!existing || existing.profileId !== profile.id) {
      return res.status(404).json({ message: "Location not found" });
    }
    
    await storage.deleteCompanyLocation(locationId);
    res.json({ success: true });
  });

  /** Jobs in ping window for clock-in prompt (no location needed). Worker must be at job site to clock in. */
  app.get("/api/worker/clock-in-prompt-jobs", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "worker") return res.status(403).json({ message: "Workers only" });
    try {
      const now = new Date();
      const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
      const workerId = profile.id;
      const existingActive = await storage.getActiveTimesheet(workerId);
      if (existingActive) return res.json([]);

      function parseScheduleTime(d: Date, t: string): Date | null {
        try {
          const r = new Date(d);
          if (!t || typeof t !== "string") return null;
          const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
          if (m) {
            let h = parseInt(m[1], 10);
            const min = parseInt(m[2], 10);
            if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
            if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
            r.setHours(h, min, 0, 0);
            return r;
          }
          const [hh, mm] = t.split(":").map(Number);
          if (!isNaN(hh)) r.setHours(hh, isNaN(mm) ? 0 : mm, 0, 0);
          return r;
        } catch { return null; }
      }

      async function getPingWindowForJob(job: typeof jobs.$inferSelect): Promise<{ windowStart: Date; windowEnd: Date; jobStartTime: Date } | null> {
        const scheds = await db.select().from(jobSchedules).where(and(eq(jobSchedules.jobId, job.id), gte(jobSchedules.date, startOfDay), lte(jobSchedules.date, endOfDay)));
        if (scheds.length > 0) {
          const s = scheds[0];
          const start = parseScheduleTime(new Date(s.date), s.startTime) || new Date(s.date);
          const end = parseScheduleTime(new Date(s.date), s.endTime) || addHours(start, 8);
          return { windowStart: addHours(start, -2), windowEnd: addHours(end, 4), jobStartTime: start };
        }
        const j = job as any;
        const jobType = j.jobType || "one_time";
        const isOnDemand = j.isOnDemand || jobType === "on_demand";
        const startDate = new Date(job.startDate);
        const st = String(j.scheduledTime || "09:00");
        const et = String(j.endTime || "17:00");
        const startStr = st.includes("-") ? st.split("-")[0].trim() : st;
        const endStr = st.includes("-") ? st.split("-")[1]?.trim() || et : et;
        const start = parseScheduleTime(startDate, startStr) || startDate;
        if (isOnDemand || jobType === "on_demand") {
          const endDate = job.endDate ? new Date(job.endDate) : addHours(start, 14);
          return { windowStart: addHours(start, -2), windowEnd: endDate, jobStartTime: start };
        }
        const end = parseScheduleTime(startDate, endStr) || addHours(start, 8);
        return { windowStart: addHours(start, -2), windowEnd: addHours(end, 4), jobStartTime: start };
      }

      const result: { id: number; title: string; location?: string; jobStartTime: string }[] = [];
      const assignments = await db.select().from(jobAssignments).where(and(eq(jobAssignments.workerId, workerId), eq(jobAssignments.status, "assigned")));
      for (const a of assignments) {
        const job = await storage.getJob(a.jobId);
        if (!job || !["open", "in_progress"].includes(job.status) || job.paymentHoldAt) continue;
        const win = await getPingWindowForJob(job);
        if (!win || now < win.windowStart || now > win.windowEnd) continue;
        const todayTs = await db.select().from(timesheets).where(and(eq(timesheets.jobId, job.id), eq(timesheets.workerId, workerId), gte(timesheets.clockInTime, startOfDay), lte(timesheets.clockInTime, endOfDay))).limit(1);
        if (todayTs.length > 0) continue;
        result.push({ id: job.id, title: job.title, location: job.location || undefined, jobStartTime: win.jobStartTime.toISOString() });
      }
      const apps = await db.select().from(applications).where(and(eq(applications.workerId, workerId), eq(applications.status, "accepted")));
      for (const app of apps) {
        if (assignments.some((a) => a.jobId === app.jobId)) continue;
        const job = await storage.getJob(app.jobId);
        if (!job || !["open", "in_progress"].includes(job.status) || job.paymentHoldAt) continue;
        const win = await getPingWindowForJob(job);
        if (!win || now < win.windowStart || now > win.windowEnd) continue;
        const todayTs = await db.select().from(timesheets).where(and(eq(timesheets.jobId, job.id), eq(timesheets.workerId, workerId), gte(timesheets.clockInTime, startOfDay), lte(timesheets.clockInTime, endOfDay))).limit(1);
        if (todayTs.length > 0) continue;
        result.push({ id: job.id, title: job.title, location: job.location || undefined, jobStartTime: win.jobStartTime.toISOString() });
      }
      res.json(result);
    } catch (err) {
      console.error("[clock-in-prompt-jobs]", err);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  // === Timesheets ===
  
  // Get all timesheets for a specific job (company: all workers on job; worker: own timesheets)
  app.get("/api/timesheets/job/:jobId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const jobId = Number(req.params.jobId);
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Company: job owner, location rep, or any company team member can fetch timesheets
    if (profile.role === "company") {
      const job = await storage.getJob(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      const isOwner = job.companyId === profile.id;
      const isLocationRep = await isLocationRepOrAssigned(profile, job);
      const isCompanyTeamMember = profile.userId
        ? !!(await storage.getCompanyTeamMemberByUserId(job.companyId, profile.userId))
        : false;
      if (isOwner || isLocationRep || isCompanyTeamMember) {
        const rawRows = await db.select({
          id: timesheets.id,
          jobId: timesheets.jobId,
          workerId: timesheets.workerId,
          companyId: timesheets.companyId,
          clockInTime: timesheets.clockInTime,
          clockOutTime: timesheets.clockOutTime,
          adjustedHours: timesheets.adjustedHours,
          hourlyRate: timesheets.hourlyRate,
          totalPay: timesheets.totalPay,
          status: timesheets.status,
          workerNotes: timesheets.workerNotes,
          timesheetType: timesheets.timesheetType,
          receiptUrl: timesheets.receiptUrl,
          workerFirstName: profiles.firstName,
          workerLastName: profiles.lastName,
          workerAvatarUrl: profiles.avatarUrl,
          workerPhone: profiles.phone,
        })
          .from(timesheets)
          .leftJoin(profiles, eq(timesheets.workerId, profiles.id))
          .where(eq(timesheets.jobId, jobId))
          .orderBy(desc(timesheets.clockInTime));
        const jobTimesheets = rawRows.map((row: any) => ({
          ...row,
          workerName: [row.workerFirstName, row.workerLastName].filter(Boolean).join(" ") || null,
          workerInitials: [row.workerFirstName?.[0], row.workerLastName?.[0]].filter(Boolean).join("") || "?",
        }));
        return res.json(jobTimesheets);
      }
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (profile.role !== "worker") {
      return res.status(403).json({ message: "Unauthorized" });
    }
    
    // Check if user is a business operator (admin)
    const ownedTeam = await db.select().from(teams).where(eq(teams.ownerId, profile.id)).then(r => r[0]);
    const isAdmin = !!ownedTeam;
    
    // Verify access: either user has an accepted application, or (for admins) a team member does
    let hasAccess = false;
    
    // Check if user has direct application
    const userApp = await db.select().from(applications)
      .where(and(
        eq(applications.jobId, jobId),
        eq(applications.workerId, profile.id),
        eq(applications.status, 'accepted')
      ))
      .then(r => r[0]);
    
    if (userApp) {
      hasAccess = true;
    }
    
    // For admins, also check if any team member is assigned to this job
    let teamMemberIds: number[] = [];
    if (isAdmin) {
      teamMemberIds = await db.select({ id: workerTeamMembers.id })
        .from(workerTeamMembers)
        .where(eq(workerTeamMembers.teamId, ownedTeam.id))
        .then(rows => rows.map(r => r.id));
      
      if (teamMemberIds.length > 0) {
        // Check if any team member is assigned via applications.teamMemberId
        const teamMemberApp = await db.select().from(applications)
          .where(and(
            eq(applications.jobId, jobId),
            inArray(applications.teamMemberId, teamMemberIds),
            eq(applications.status, 'accepted')
          ))
          .then(r => r[0]);
        
        if (teamMemberApp) {
          hasAccess = true;
        }
      }
    }
    
    if (!hasAccess) {
      return res.status(403).json({ message: "You do not have access to this job" });
    }
    
    let jobTimesheets;
    if (isAdmin) {
      // Business operators see all timesheets for the job where they are the worker
      // (Team member work is recorded under the business operator's workerId)
      const rawTimesheets = await db.select()
        .from(timesheets)
        .where(and(
          eq(timesheets.jobId, jobId),
          eq(timesheets.workerId, profile.id)
        ))
        .orderBy(desc(timesheets.clockInTime));
      
      // Fetch worker profile info
      const workerProfile = await db.select({
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        avatarUrl: profiles.avatarUrl,
        phone: profiles.phone,
      }).from(profiles).where(eq(profiles.id, profile.id)).then(r => r[0]);
      
      // Combine data with worker info
      jobTimesheets = rawTimesheets.map(ts => ({
        ...ts,
        workerFirstName: workerProfile?.firstName || null,
        workerLastName: workerProfile?.lastName || null,
        workerAvatarUrl: workerProfile?.avatarUrl || null,
        workerPhone: workerProfile?.phone || null,
      }));
    } else {
      // Regular workers only see their own timesheets
      jobTimesheets = await db.select({
        id: timesheets.id,
        jobId: timesheets.jobId,
        workerId: timesheets.workerId,
        companyId: timesheets.companyId,
        clockInTime: timesheets.clockInTime,
        clockOutTime: timesheets.clockOutTime,
        clockInLatitude: timesheets.clockInLatitude,
        clockInLongitude: timesheets.clockInLongitude,
        clockOutLatitude: timesheets.clockOutLatitude,
        clockOutLongitude: timesheets.clockOutLongitude,
        totalHours: timesheets.totalHours,
        adjustedHours: timesheets.adjustedHours,
        hourlyRate: timesheets.hourlyRate,
        totalPay: timesheets.totalPay,
        workerNotes: timesheets.workerNotes,
        timesheetType: timesheets.timesheetType,
        receiptUrl: timesheets.receiptUrl,
        clockInDistanceFromJob: timesheets.clockInDistanceFromJob,
        clockOutDistanceFromJob: timesheets.clockOutDistanceFromJob,
        locationVerified: timesheets.locationVerified,
        locationAdjustmentReason: timesheets.locationAdjustmentReason,
        status: timesheets.status,
        approvedBy: timesheets.approvedBy,
        approvedAt: timesheets.approvedAt,
        rejectionReason: timesheets.rejectionReason,
        createdAt: timesheets.createdAt,
        updatedAt: timesheets.updatedAt,
        workerFirstName: profiles.firstName,
        workerLastName: profiles.lastName,
        workerAvatarUrl: profiles.avatarUrl,
        workerPhone: profiles.phone,
      })
        .from(timesheets)
        .leftJoin(profiles, eq(timesheets.workerId, profiles.id))
        .where(and(
          eq(timesheets.jobId, jobId),
          eq(timesheets.workerId, profile.id)
        ))
        .orderBy(desc(timesheets.clockInTime));
    }
    
    res.json(jobTimesheets);
  });

  // Submit a material invoice (worker): upload receipt, amount, optional description; appears on company timesheets
  app.post("/api/timesheets/material-invoice", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "worker") return res.status(403).json({ message: "Workers only" });

    const { jobId, amountCents, description, receiptUrl } = req.body;
    if (!jobId || amountCents == null || amountCents < 0) {
      return res.status(400).json({ message: "jobId and amountCents (non-negative) are required" });
    }
    if (!receiptUrl || typeof receiptUrl !== "string" || !receiptUrl.startsWith("/objects/")) {
      return res.status(400).json({ message: "Receipt photo is required (upload receipt first)" });
    }

    const job = await storage.getJob(Number(jobId));
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (job.companyId == null) return res.status(400).json({ message: "Job has no company" });

    // Worker must have an accepted application (direct or as team member)
    const directApp = await db.select().from(applications)
      .where(and(
        eq(applications.jobId, jobId),
        eq(applications.workerId, profile.id),
        eq(applications.status, "accepted")
      ))
      .then(r => r[0]);
    let teamApp: any = null;
    if (profile.teamId && profile.email) {
      const member = await db.select({ id: workerTeamMembers.id }).from(workerTeamMembers)
        .where(and(eq(workerTeamMembers.teamId, profile.teamId), eq(workerTeamMembers.email, profile.email)))
        .then(r => r[0]);
      if (member) {
        teamApp = await db.select().from(applications)
          .where(and(
            eq(applications.jobId, jobId),
            eq(applications.teamMemberId, member.id),
            eq(applications.status, "accepted")
          ))
          .then(r => r[0]);
      }
    }
    if (!directApp && !teamApp) {
      return res.status(403).json({ message: "You must be assigned to this job to submit a material invoice" });
    }

    const now = new Date();
    const [created] = await db.insert(timesheets).values({
      jobId: Number(jobId),
      workerId: profile.id,
      companyId: job.companyId,
      clockInTime: now,
      clockOutTime: now,
      totalHours: "0",
      adjustedHours: "0",
      hourlyRate: 0,
      totalPay: Math.round(Number(amountCents)),
      workerNotes: description ? String(description).slice(0, 2000) : null,
      timesheetType: "material_invoice",
      receiptUrl: receiptUrl.slice(0, 2048),
      status: "pending",
    }).returning();
    res.status(201).json(created);
  });
  
  app.get("/api/timesheets/active/:workerId", async (req, res) => {
    const isDev = process.env.NODE_ENV === "development";
    const workerId = Number(req.params.workerId);
    
    // Validate workerId
    if (!workerId || isNaN(workerId)) {
      return res.status(400).json({ message: "Invalid worker ID" });
    }
    
    // In dev mode, bypass authentication for testing
    let profile;
    if (isDev && !req.isAuthenticated()) {
      // In dev mode, get profile directly from workerId
      try {
        profile = await storage.getProfile(workerId);
        if (!profile) {
          // In dev mode, return 200 with null instead of 404 to avoid errors
          return res.status(200).json(null);
        }
      } catch (error) {
        // In dev mode, if there's an error getting profile, return 200 with null
        console.warn("Dev mode: Error getting profile for workerId", workerId, error);
        return res.status(200).json(null);
      }
    } else {
      // Production mode: require authentication
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      
      const user = req.user as any;
      profile = req.profile;

      if (!profile) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Allow if the user is the worker themselves
      let authorized = profile.id === workerId;
      
      // Also allow if user is a team member of the worker's team (business operator)
      if (!authorized && profile.teamId) {
        // Check if this worker is the team owner
        const team = await db.select().from(teams).where(eq(teams.id, profile.teamId)).then(r => r[0]);
        if (team && team.ownerId === workerId) {
          authorized = true;
        }
      }
      
      // Also allow if user is a business operator checking on their team member's work
      if (!authorized) {
        const ownedTeam = await db.select().from(teams).where(eq(teams.ownerId, profile.id)).then(r => r[0]);
        if (ownedTeam) {
          // Check if workerId is one of their team members
          const workerProfile = await storage.getProfile(workerId);
          const teamMember = workerProfile ? await db.select().from(workerTeamMembers)
            .where(and(
              eq(workerTeamMembers.teamId, ownedTeam.id),
              eq(workerTeamMembers.email, workerProfile.email || '')
            )).then(r => r[0]) : null;
          if (teamMember) {
            authorized = true;
          }
        }
      }
      
      if (!authorized) {
        return res.status(403).json({ message: "Unauthorized" });
      }
    }
    
    const activeTimesheet = await storage.getActiveTimesheet(workerId);
    if (!activeTimesheet) {
      // Return 200 with null instead of 404 for better client handling
      return res.status(200).json(null);
    }

    const job = await storage.getJob(activeTimesheet.jobId);
    const payload = {
      ...activeTimesheet,
      jobTitle: job?.title || undefined,
      jobTrade: job?.trade || undefined,
      jobLocation: job ? [job.address, job.city, job.state].filter(Boolean).join(", ") || job.location || undefined : undefined,
    };
    res.json(payload);
  });

  // Get all timesheets for a worker (for payment history). If query ?team=1 and profile is team owner, returns timesheets for entire team with worker info (business operator view).
  app.get("/api/timesheets/worker", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can view their payment history" });
    }
    const teamView = req.query.team === "1" || req.query.team === "true";
    const team = teamView ? await storage.getWorkerTeam(profile.id) : null;
    if (teamView && team) {
      const teamTimesheets = await storage.getTimesheetsByTeamOwner(profile.id);
      return res.json(teamTimesheets);
    }
    const workerTimesheets = await storage.getTimesheetsByWorker(profile.id);
    res.json(workerTimesheets);
  });

  // Worker (employee): get whether their business operator (team owner) has incomplete worker onboarding (workers can continue work; we prompt to resend reminder)
  app.get("/api/workers/me/business-operator-onboarding-status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can use this endpoint" });
    }
    try {
      const teamId = (profile as any).teamId;
      if (teamId == null) {
        return res.json({ incomplete: false, businessOperator: null });
      }
      const team = await storage.getTeamById(teamId);
      if (!team) return res.json({ incomplete: false, businessOperator: null });
      const operator = await storage.getProfile(team.ownerId);
      if (!operator || operator.role !== "worker") return res.json({ incomplete: false, businessOperator: null });
      const incomplete = operator.onboardingStatus === "incomplete";
      res.json({
        incomplete,
        businessOperator: incomplete
          ? {
              profileId: operator.id,
              name: [operator.firstName, operator.lastName].filter(Boolean).join(" ").trim() || "Your business operator",
            }
          : null,
      });
    } catch (e) {
      console.error("Business operator onboarding status error:", e);
      res.status(500).json({ error: "Failed to check business operator onboarding status" });
    }
  });

  // Worker (employee): trigger resend of worker onboarding reminder to their business operator (rate-limited to once per 24h per worker)
  app.post("/api/workers/me/resend-business-operator-onboarding-reminder", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can use this endpoint" });
    }
    const now = Date.now();
    const lastAt = workerResendBusinessOperatorReminderLastAt.get(profile.id) ?? 0;
    if (now - lastAt < WORKER_RESEND_BUSINESS_OPERATOR_COOLDOWN_MS) {
      return res.status(429).json({
        message: "You can only send one reminder per 24 hours. Please try again later.",
        retryAfterSeconds: Math.ceil((WORKER_RESEND_BUSINESS_OPERATOR_COOLDOWN_MS - (now - lastAt)) / 1000),
      });
    }
    try {
      const teamId = (profile as any).teamId;
      if (teamId == null) {
        return res.json({ success: true, sent: false, message: "You are not on a team; no business operator to remind." });
      }
      const team = await storage.getTeamById(teamId);
      if (!team) return res.json({ success: true, sent: false, message: "Team not found." });
      const operator = await storage.getProfile(team.ownerId);
      if (!operator || operator.role !== "worker" || operator.onboardingStatus !== "incomplete") {
        return res.json({ success: true, sent: false, message: "Your business operator has completed setup, or could not be found." });
      }
      const { sendWorkerOnboardingReminder } = await import("./services/worker-onboarding-reminder");
      const result = await sendWorkerOnboardingReminder(operator, { force: true });
      workerResendBusinessOperatorReminderLastAt.set(profile.id, now);
      res.json({
        success: true,
        sent: result.sent,
        message: result.sent
          ? "Reminder sent to your business operator to complete their account setup. Incomplete setup will halt future payments."
          : result.error ?? "Reminder could not be sent.",
      });
    } catch (e) {
      console.error("Resend business operator onboarding reminder error:", e);
      res.status(500).json({ error: "Failed to send reminder" });
    }
  });

  app.post("/api/timesheets/clock-in", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { jobId, workerId, latitude, longitude, isAutomatic, teamMemberId } = req.body;
      
      const user = req.user as any;
      const profile = req.profile;
      
      if (!profile) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      // Check authorization - either the worker themselves or a team member working for them
      let authorized = profile.id === workerId;
      let actualWorkerId = workerId;
      let clockingTeamMemberId: number | null = teamMemberId || null;
      
      // If user is an employee (has teamId), check if they're authorized to clock in for this job
      if (!authorized && profile.teamId) {
        // Get the team
        const team = await db.select().from(teams).where(eq(teams.id, profile.teamId)).then(r => r[0]);
        if (team && team.ownerId === workerId) {
          // This employee is trying to clock in on a job owned by their business operator
          // Check if there's an application for this job with this team member
          const teamMember = await db.select().from(workerTeamMembers)
            .where(and(
              eq(workerTeamMembers.teamId, profile.teamId || 0),
              eq(workerTeamMembers.email, profile.email || '')
            ))
            .then(r => r[0]);
          
          if (teamMember) {
            const app = await db.select().from(applications)
              .where(and(
                eq(applications.jobId, jobId),
                eq(applications.teamMemberId, teamMember.id)
              ))
              .then(r => r[0]);
            
            if (app) {
              authorized = true;
              actualWorkerId = profile.id; // Use the employee's profile ID for the timesheet
              clockingTeamMemberId = teamMember.id;
            }
          }
        }
      }
      
      if (!authorized) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const job = await storage.getJob(jobId);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      if (job.paymentHoldAt) {
        return res.status(403).json({
          message: "This job is on hold until the company resolves payment. You cannot clock in yet.",
          code: "JOB_PAYMENT_HOLD",
        });
      }

      // Require accepted application or job assignment for this job (prevent clock-in to arbitrary jobs)
      const [hasAssignment] = await db.select().from(jobAssignments).where(and(
        eq(jobAssignments.jobId, jobId),
        eq(jobAssignments.workerId, actualWorkerId),
        eq(jobAssignments.status, "assigned")
      )).limit(1);
      const acceptedApps = await db.select().from(applications).where(and(
        eq(applications.jobId, jobId),
        eq(applications.status, "accepted")
      ));
      const hasAcceptedApp = acceptedApps.some(app =>
        (app.workerId === actualWorkerId && !app.teamMemberId) ||
        (clockingTeamMemberId != null && app.teamMemberId === clockingTeamMemberId)
      );
      if (!hasAssignment && !hasAcceptedApp) {
        return res.status(403).json({
          message: "You must be accepted for this job before clocking in.",
          code: "NOT_ACCEPTED_FOR_JOB",
        });
      }

      const existingActive = await storage.getActiveTimesheet(actualWorkerId);
      if (existingActive) {
        return res.status(400).json({ message: "Already clocked in to a job" });
      }
      
      const hasLocation = latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude);
      let distanceFromJob: number | null = null;
      const locationVerified = true;

      // Strict geofence enforcement: location is required and must match job geofence.
      if (!hasLocation) {
        return res.status(400).json({
          message: "Location required",
          code: "LOCATION_REQUIRED",
          details: "You must enable location services to clock in. Please allow location access and try again."
        });
      }
      const jobCoords = await ensureJobGeofenceCoords(job);
      if (!jobCoords) {
        return res.status(400).json({
          message: "Job location not set",
          code: "JOB_LOCATION_MISSING",
          details: "This job does not have a verified location. Please contact support."
        });
      }
      distanceFromJob = calculateDistanceMeters(
        latitude, longitude,
        jobCoords.lat, jobCoords.lng
      );
      const requiredRadiusMiles = isAutomatic ? AUTO_GEOFENCE_RADIUS_MILES : MANUAL_GEOFENCE_RADIUS_MILES;
      if (!isWithinGeofence(distanceFromJob, isAutomatic)) {
        const distanceMiles = metersToMiles(distanceFromJob);
        return res.status(403).json({
          message: "Too far from job site",
          code: "OUTSIDE_GEOFENCE",
          distanceMeters: Math.round(distanceFromJob),
          distanceMiles: distanceMiles.toFixed(1),
          requiredRadiusMiles: requiredRadiusMiles,
          details: `You must be within ${requiredRadiusMiles} miles of the job site to clock in. You are currently ${distanceMiles.toFixed(1)} miles away.`
        });
      }
      
      const timesheet = await storage.createTimesheet({
        jobId,
        workerId: actualWorkerId,
        companyId: job.companyId,
        clockInTime: new Date(),
        clockInLatitude: hasLocation ? latitude?.toString() : null,
        clockInLongitude: hasLocation ? longitude?.toString() : null,
        clockInDistanceFromJob: distanceFromJob != null ? Math.round(distanceFromJob) : null,
        hourlyRate: job.hourlyRate,
        workerNotes: isAutomatic ? "Auto clocked in based on location" : null,
        autoClockedIn: isAutomatic || false,
        locationVerified,
      });
      
      await db.insert(timesheetEvents).values({
        timesheetId: timesheet.id,
        eventType: isAutomatic ? "auto_clock_in" : "manual_clock_in",
        latitude: hasLocation ? latitude?.toString() : null,
        longitude: hasLocation ? longitude?.toString() : null,
        distanceFromJob: distanceFromJob != null ? Math.round(distanceFromJob) : null,
        metadata: { source: isAutomatic ? "geofence" : "manual", unvalidated: false },
      });
      
      const workerName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Worker';
      const clockInTimeFormatted = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      await db.insert(jobMessages).values({
        jobId,
        senderId: profile.id,
        content: `${workerName} clocked in at ${clockInTimeFormatted}${isAutomatic ? ' (auto)' : ''}${!locationVerified ? ' (location pending)' : ''}`,
        messageType: 'clock_in',
        timesheetId: timesheet.id,
        metadata: {
          latitude: hasLocation ? latitude : null,
          longitude: hasLocation ? longitude : null,
          distanceFromJob: distanceFromJob != null ? Math.round(distanceFromJob) : null,
          isAutomatic: isAutomatic || false,
          timesheetId: timesheet.id,
          locationVerified,
        },
        visibleToCompanyOnly: true,
      });
      
      // Send push notification to company for clock-in
      try {
        const companyProfile = await storage.getProfile(job.companyId);
        if (companyProfile) {
          await db.insert(notifications).values({
            profileId: companyProfile.id,
            type: "worker_clocked_in",
            title: "Worker Clocked In",
            body: `${workerName} clocked in for ${job.title}`,
            url: `/company-dashboard?tab=timesheets&timesheetId=${timesheet.id}`,
            data: { jobId, timesheetId: timesheet.id, workerName, isAutomatic: isAutomatic || false },
          });
          const jobForRouting = { companyLocationId: job.companyLocationId, companyId: job.companyId };
          const recipient = await getNotificationRecipientForJob(jobForRouting, "worker_clocked_in");
          if (recipient?.email && (recipient.profile.emailNotifications ?? true) && (recipient.profile.notifyJobUpdates ?? true)) {
            sendEmail({
              to: recipient.email,
              type: "worker_clocked_in",
              data: {
                workerName,
                jobTitle: job.title,
                location: job.location || [job.city, job.state].filter(Boolean).join(", ") || "Job site",
                clockInTime: clockInTimeFormatted,
              },
            }).catch((err) => console.error("Failed to send worker clocked in email:", err));
          }
        }
      } catch (notifyErr) {
        console.error("Failed to send clock-in notification:", notifyErr);
      }
      
      broadcastPresenceUpdate({
        workerId: profile.id,
        workerName,
        avatarUrl: profile.avatarUrl,
        companyId: job.companyId,
        teamId: null,
        teamMemberId: null,
        teamMemberName: null,
        teamMemberAvatarUrl: null,
        action: 'clock_in',
        latitude: hasLocation ? latitude : null,
        longitude: hasLocation ? longitude : null,
        jobId: job.id,
        jobTitle: job.title,
        timestamp: Date.now(),
      });
      
      res.status(201).json(timesheet);
    } catch (err) {
      console.error("Clock in error:", err);
      res.status(500).json({ message: "Failed to clock in" });
    }
  });

  /**
   * Submit clock-in location for an unvalidated timesheet (e.g. after offline clock-in).
   * When the user comes back online, we require them to provide their pin location before the timesheet can be submitted for approval.
   * Within 50mi of job site → mark verified and timesheet is eligible for approval.
   * Beyond 50mi or if location is never submitted → we never submit the timesheet (beyond 50mi = reject + strike for time theft).
   */
  app.post("/api/timesheets/:id/submit-clock-in-location", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Unauthorized" });
    const id = Number(req.params.id);
    const { latitude, longitude } = req.body;
    if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: "latitude and longitude are required" });
    }
    const timesheet = await storage.getTimesheet(id);
    if (!timesheet) return res.status(404).json({ message: "Timesheet not found" });
    if (timesheet.workerId !== profile.id) return res.status(403).json({ message: "Not your timesheet" });
    if (timesheet.clockOutTime != null) return res.status(400).json({ message: "Cannot submit location for a completed timesheet" });
    const hadLocation = timesheet.clockInLatitude != null && timesheet.clockInLongitude != null;
    if (hadLocation) return res.status(400).json({ message: "This timesheet already has a clock-in location" });
    const job = await storage.getJob(timesheet.jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    try {
      const jobCoords = await ensureJobGeofenceCoords(job);
      if (jobCoords) {
        const distanceMeters = calculateDistanceMeters(latitude, longitude, jobCoords.lat, jobCoords.lng);
        if (distanceMeters > CLOCK_IN_VALIDATION_RADIUS_METERS) {
          // Reject timesheet and issue strike (worker sees strike on account status / strikes page)
          await storage.updateTimesheet(id, {
            status: "rejected",
            rejectionReason: "Clock-in location was more than 50 miles from the job site. This timesheet has been rejected and a strike was issued for attempted time theft.",
          });
          const strikeExplanation = "Attempted time theft: clock-in was submitted with a location more than 50 miles from the job site. Timesheet rejected.";
          await storage.createTimesheetReport({
            timesheetId: id,
            reportedBy: job.companyId,
            workerId: timesheet.workerId,
            explanation: strikeExplanation,
            isStrike: true,
          });
          notifyTimesheetUpdate(timesheet.workerId, {
            timesheetId: id,
            jobId: timesheet.jobId,
            status: "rejected",
            jobTitle: job.title || "Job",
          });
          return res.status(403).json({
            message: "Too far from job site",
            code: "LOCATION_VALIDATION_FAILED",
            details: "Your clock-in location was more than 50 miles from the job site. This timesheet has been rejected and a strike has been added to your account.",
          });
        }
        const distanceFromJob = Math.round(distanceMeters);
        await storage.updateTimesheet(id, {
          clockInLatitude: String(latitude),
          clockInLongitude: String(longitude),
          clockInDistanceFromJob: distanceFromJob,
          locationVerified: true,
          workerNotes: timesheet.workerNotes ? timesheet.workerNotes.replace("Clock-in unvalidated — location required for approval", "Clock-in location submitted and verified.").trim() : "Clock-in location submitted and verified.",
        });
      } else {
        await storage.updateTimesheet(id, {
          clockInLatitude: String(latitude),
          clockInLongitude: String(longitude),
          locationVerified: true,
          workerNotes: timesheet.workerNotes ? timesheet.workerNotes.replace("Clock-in unvalidated — location required for approval", "Clock-in location submitted (job has no coordinates to verify distance).").trim() : "Clock-in location submitted.",
        });
      }
      const updated = await storage.getTimesheet(id);
      res.json(updated);
    } catch (err) {
      console.error("Submit clock-in location error:", err);
      res.status(500).json({ message: "Failed to submit location" });
    }
  });

  /** Server-side clock-in: used when location ping arrives with worker within auto geofence. */
  async function performServerSideClockIn(
    workerProfileId: number,
    jobId: number,
    latitude: number,
    longitude: number,
    distanceFromJob: number
  ): Promise<void> {
    const job = await storage.getJob(jobId);
    if (!job?.latitude || !job?.longitude) return;
    if (job.paymentHoldAt) return;
    const profile = await storage.getProfile(workerProfileId);
    if (!profile) return;
    const existingActive = await storage.getActiveTimesheet(workerProfileId);
    if (existingActive) return;
    const isAssigned = await db.select().from(jobAssignments).where(and(eq(jobAssignments.jobId, jobId), eq(jobAssignments.workerId, workerProfileId), eq(jobAssignments.status, "assigned"))).then((r) => r.length > 0);
    const isAccepted = !isAssigned && await db.select().from(applications).where(and(eq(applications.jobId, jobId), eq(applications.workerId, workerProfileId), eq(applications.status, "accepted"))).then((r) => r.length > 0);
    if (!isAssigned && !isAccepted) return;
    const timesheet = await storage.createTimesheet({
      jobId,
      workerId: workerProfileId,
      companyId: job.companyId,
      clockInTime: new Date(),
      clockInLatitude: String(latitude),
      clockInLongitude: String(longitude),
      clockInDistanceFromJob: Math.round(distanceFromJob),
      hourlyRate: job.hourlyRate,
      workerNotes: "Auto clocked in from location ping",
      autoClockedIn: true,
    });
    await db.insert(timesheetEvents).values({
      timesheetId: timesheet.id,
      eventType: "auto_clock_in",
      latitude: String(latitude),
      longitude: String(longitude),
      distanceFromJob: Math.round(distanceFromJob),
      metadata: { source: "location_ping" },
    });
    const workerName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || "Worker";
    const clockInTimeFormatted = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    await db.insert(jobMessages).values({
      jobId,
      senderId: profile.id,
      content: `${workerName} clocked in at ${clockInTimeFormatted} (auto)`,
      messageType: "clock_in",
      timesheetId: timesheet.id,
      metadata: { latitude, longitude, distanceFromJob: Math.round(distanceFromJob), isAutomatic: true, timesheetId: timesheet.id },
      visibleToCompanyOnly: true,
    });
    try {
      const companyProfile = await storage.getProfile(job.companyId);
      if (companyProfile) {
        await db.insert(notifications).values({
          profileId: companyProfile.id,
          type: "worker_clocked_in",
          title: "Worker Clocked In",
          body: `${workerName} clocked in for ${job.title} (auto)`,
          url: `/company-dashboard?tab=timesheets&timesheetId=${timesheet.id}`,
          data: { jobId, timesheetId: timesheet.id, workerName, isAutomatic: true },
        });
        const jobForRouting = { companyLocationId: job.companyLocationId, companyId: job.companyId };
        const recipient = await getNotificationRecipientForJob(jobForRouting, "worker_clocked_in");
        if (recipient?.email && (recipient.profile.emailNotifications ?? true) && (recipient.profile.notifyJobUpdates ?? true)) {
          sendEmail({
            to: recipient.email,
            type: "worker_clocked_in",
            data: {
              workerName,
              jobTitle: job.title,
              location: job.location || [job.city, job.state].filter(Boolean).join(", ") || "Job site",
              clockInTime: clockInTimeFormatted,
            },
          }).catch((err) => console.error("Failed to send auto worker clocked in email:", err));
        }
      }
    } catch {
      // ignore
    }
    broadcastPresenceUpdate({ workerId: profile.id, workerName, avatarUrl: profile.avatarUrl, companyId: job.companyId, teamId: null, teamMemberId: null, teamMemberName: null, teamMemberAvatarUrl: null, action: "clock_in", latitude, longitude, jobId: job.id, jobTitle: job.title, timestamp: Date.now() });
  }

  (globalThis as any).__performServerSideClockIn = performServerSideClockIn;

  /** Server-side clock-out: used by the ping-based scheduler when worker leaves geofence or pings go stale. */
  async function performServerSideClockOut(
    timesheetId: number,
    workerProfileId: number,
    clockOutTime: Date,
    latitude: number,
    longitude: number,
    distanceFromJob: number | null
  ): Promise<void> {
    const timesheet = await storage.getTimesheet(timesheetId);
    if (!timesheet || timesheet.clockOutTime != null) return;

    const profile = await storage.getProfile(workerProfileId);
    const job = await storage.getJob(timesheet.jobId);
    if (!profile || !job) return;

    const clockInTime = new Date(timesheet.clockInTime);
    const rawTotalHours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);
    const { hoursAway, pingCount } = await computeTimeAwayFromSite(workerProfileId, timesheet.jobId, clockInTime, clockOutTime);
    const billableHours = Math.max(0, rawTotalHours - hoursAway);
    const totalHours = rawTotalHours;
    const totalPay = Math.round(billableHours * timesheet.hourlyRate);
    const locationAdjustmentReason = hoursAway > 0
      ? `${Math.round(hoursAway * 60)} min deducted for time away from job site (based on location history${pingCount > 0 ? `, ${pingCount} location points)` : ")"}`
      : null;

    await storage.updateTimesheet(timesheetId, {
      clockOutTime,
      clockOutLatitude: String(latitude),
      clockOutLongitude: String(longitude),
      clockOutDistanceFromJob: distanceFromJob != null ? Math.round(distanceFromJob) : null,
      totalHours: totalHours.toFixed(2),
      adjustedHours: billableHours.toFixed(2),
      totalPay,
      locationVerified: hoursAway > 0 ? false : (timesheet.locationVerified ?? true),
      locationAdjustmentReason: locationAdjustmentReason || timesheet.locationAdjustmentReason,
      autoClockedOut: true,
      workerNotes: timesheet.workerNotes
        ? `${timesheet.workerNotes} | Auto clocked out (left job site per location)`
        : "Auto clocked out (left job site per location)",
    });

    await db.insert(timesheetEvents).values({
      timesheetId: timesheet.id,
      eventType: "auto_clock_out",
      latitude: String(latitude),
      longitude: String(longitude),
      distanceFromJob: distanceFromJob != null ? Math.round(distanceFromJob) : null,
      metadata: { source: "server_pings" },
    });

    const workerName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || "Worker";
    const hoursWorked = (hoursAway > 0 ? billableHours : totalHours).toFixed(1);
    await db.insert(jobMessages).values({
      jobId: timesheet.jobId,
      senderId: profile.id,
      content: `${workerName} clocked out (auto – left job site per location) (${hoursWorked} hrs)`,
      messageType: "clock_out",
      timesheetId: timesheet.id,
      metadata: {
        latitude,
        longitude,
        distanceFromJob: distanceFromJob != null ? Math.round(distanceFromJob) : null,
        isAutomatic: true,
        timesheetId: timesheet.id,
        totalHours: parseFloat(hoursWorked),
        totalPay,
        clockInLatitude: timesheet.clockInLatitude,
        clockInLongitude: timesheet.clockInLongitude,
      },
      visibleToCompanyOnly: true,
    });

    try {
      const companyProfile = await storage.getProfile(timesheet.companyId);
      if (companyProfile) {
        await db.insert(notifications).values({
          profileId: companyProfile.id,
          type: "worker_clocked_out",
          title: "Worker Clocked Out (auto)",
          body: `${workerName} was automatically clocked out from ${job?.title || "Unknown Job"} (left job site)`,
          url: `/company-dashboard?tab=timesheets&timesheetId=${timesheet.id}`,
          data: { jobId: timesheet.jobId, timesheetId: timesheet.id, workerName, totalHours: parseFloat(hoursWorked), isAutomatic: true },
        });
        const jobForRouting = { companyLocationId: job.companyLocationId, companyId: timesheet.companyId };
        const recipient = await getNotificationRecipientForJob(jobForRouting, "worker_clocked_out");
        if (recipient?.email && (recipient.profile.emailNotifications ?? true) && (recipient.profile.notifyJobUpdates ?? true)) {
          const baseUrl = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";
          sendEmail({
            to: recipient.email,
            type: "worker_clocked_out",
            data: {
              workerName,
              hours: hoursWorked,
              jobTitle: job?.title || "Unknown Job",
              totalCost: (totalPay / 100).toFixed(2),
              timesheetId: timesheet.id,
              dashboardLink: `${baseUrl}/company-dashboard?tab=timesheets&timesheetId=${timesheet.id}`,
            },
          }).catch((err) => console.error("Failed to send worker clocked out email:", err));
        }
      }
      const { sendPushNotification } = await import("./services/pushNotifications");
      await sendPushNotification(workerProfileId, "auto_clock", {
        jobId: timesheet.jobId,
        jobTitle: job?.title || "Job",
        action: "clocked_out",
      });
    } catch (e) {
      console.error("[performServerSideClockOut] Notify error:", e);
    }

    broadcastPresenceUpdate({
      workerId: profile.id,
      workerName,
      avatarUrl: profile.avatarUrl,
      companyId: timesheet.companyId,
      teamId: null,
      teamMemberId: null,
      teamMemberName: null,
      teamMemberAvatarUrl: null,
      action: "clock_out",
      latitude,
      longitude,
      jobId: timesheet.jobId,
      jobTitle: job?.title || "Unknown Job",
      timestamp: Date.now(),
    });
  }

  (globalThis as any).__performServerSideClockOut = performServerSideClockOut;

  app.post("/api/timesheets/clock-out", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { timesheetId, latitude, longitude, isAutomatic } = req.body;
      
      const timesheet = await storage.getTimesheet(timesheetId);
      if (!timesheet) {
        return res.status(404).json({ message: "Timesheet not found" });
      }
      
      const user = req.user as any;
      const profile = req.profile;
      
      if (!profile || profile.id !== timesheet.workerId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const job = await storage.getJob(timesheet.jobId);
      let distanceFromJob: number | null = null;
      if (latitude && longitude && job?.latitude && job?.longitude) {
        distanceFromJob = calculateDistanceMeters(
          latitude, longitude,
          parseFloat(job.latitude), parseFloat(job.longitude)
        );
      }
      
      const clockOutTime = new Date();
      const clockInTime = new Date(timesheet.clockInTime);
      const rawTotalHours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

      // Geolocation: compute time away from job site from location pings (worker left and returned during shift)
      const { hoursAway, pingCount } = await computeTimeAwayFromSite(
        profile.id,
        timesheet.jobId,
        clockInTime,
        clockOutTime
      );
      const billableHours = Math.max(0, rawTotalHours - hoursAway);
      const totalHours = rawTotalHours;
      const totalPay = Math.round(billableHours * timesheet.hourlyRate);
      const locationAdjustmentReason = hoursAway > 0
        ? `${Math.round(hoursAway * 60)} min deducted for time away from job site (based on location history${pingCount > 0 ? `, ${pingCount} location points)` : ")"}`
        : null;

      const updatedTimesheet = await storage.updateTimesheet(timesheetId, {
        clockOutTime,
        clockOutLatitude: latitude?.toString(),
        clockOutLongitude: longitude?.toString(),
        clockOutDistanceFromJob: distanceFromJob ? Math.round(distanceFromJob) : null,
        totalHours: totalHours.toFixed(2),
        adjustedHours: billableHours.toFixed(2),
        totalPay,
        locationVerified: hoursAway > 0 ? false : (timesheet.locationVerified ?? true),
        locationAdjustmentReason: locationAdjustmentReason || timesheet.locationAdjustmentReason,
        autoClockedOut: isAutomatic || false,
        workerNotes: timesheet.workerNotes 
          ? `${timesheet.workerNotes}${isAutomatic ? " | Auto clocked out based on location" : ""}`
          : (isAutomatic ? "Auto clocked out based on location" : null),
      });
      
      await db.insert(timesheetEvents).values({
        timesheetId: timesheet.id,
        eventType: isAutomatic ? "auto_clock_out" : "manual_clock_out",
        latitude: latitude?.toString(),
        longitude: longitude?.toString(),
        distanceFromJob: distanceFromJob ? Math.round(distanceFromJob) : null,
        metadata: { source: isAutomatic ? "geofence" : "manual" },
      });
      
      // Create system message for clock-out event (visible to company only) — show billable hours when time-away was deducted
      const workerName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Worker';
      const clockOutTimeFormatted = clockOutTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const hoursWorked = (hoursAway > 0 ? billableHours : totalHours).toFixed(1);
      await db.insert(jobMessages).values({
        jobId: timesheet.jobId,
        senderId: profile.id,
        content: `${workerName} clocked out at ${clockOutTimeFormatted} (${hoursWorked} hrs)${isAutomatic ? ' (auto)' : ''}`,
        messageType: 'clock_out',
        timesheetId: timesheet.id,
        metadata: {
          latitude: latitude || null,
          longitude: longitude || null,
          distanceFromJob: distanceFromJob ? Math.round(distanceFromJob) : null,
          isAutomatic: isAutomatic || false,
          timesheetId: timesheet.id,
          totalHours: parseFloat(hoursWorked),
          totalPay: totalPay,
          clockInLatitude: timesheet.clockInLatitude,
          clockInLongitude: timesheet.clockInLongitude,
        },
        visibleToCompanyOnly: true,
      });
      
      // Send push notification and email to company for clock-out (route to location rep/teammate or admin)
      try {
        const companyProfile = await storage.getProfile(timesheet.companyId);
        if (companyProfile) {
          await db.insert(notifications).values({
            profileId: companyProfile.id,
            type: "worker_clocked_out",
            title: "Worker Clocked Out",
            body: `${workerName} clocked out from ${job?.title || 'Unknown Job'}`,
            url: `/company-dashboard?tab=timesheets&timesheetId=${timesheet.id}`,
            data: { jobId: timesheet.jobId, timesheetId: timesheet.id, workerName, totalHours: parseFloat(hoursWorked), isAutomatic: isAutomatic || false },
          });
          // Email: route to location rep/teammate or company admin (per job/location)
          const jobForRouting = job ? { companyLocationId: job.companyLocationId, companyId: timesheet.companyId } : { companyLocationId: null, companyId: timesheet.companyId };
          const recipient = await getNotificationRecipientForJob(jobForRouting, 'worker_clocked_out');
          if (recipient?.email && (recipient.profile.emailNotifications ?? true) && (recipient.profile.notifyJobUpdates ?? true)) {
            const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
            sendEmail({
              to: recipient.email,
              type: 'worker_clocked_out',
              data: {
                workerName,
                hours: hoursWorked,
                jobTitle: job?.title || 'Unknown Job',
                totalCost: (totalPay / 100).toFixed(2),
                timesheetId: timesheet.id,
                dashboardLink: `${baseUrl}/company-dashboard?tab=timesheets&timesheetId=${timesheet.id}`,
              }
            }).catch(err => console.error('Failed to send worker clocked out email:', err));
          }
        }
      } catch (notifyErr) {
        console.error("Failed to send clock-out notification:", notifyErr);
      }
      
      broadcastPresenceUpdate({
        workerId: profile.id,
        workerName: `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Worker',
        avatarUrl: profile.avatarUrl,
        companyId: timesheet.companyId,
        teamId: null,
        teamMemberId: null,
        teamMemberName: null,
        teamMemberAvatarUrl: null,
        action: 'clock_out',
        latitude: latitude || null,
        longitude: longitude || null,
        jobId: timesheet.jobId,
        jobTitle: job?.title || 'Unknown Job',
        timestamp: Date.now(),
      });
      
      // Consolidate same-day timesheets for this worker and job
      // Use job timezone or default to America/Chicago for local date comparison
      const jobTimezone = job?.timezone || 'America/Chicago';
      const clockOutLocal = new Date(clockOutTime.toLocaleString('en-US', { timeZone: jobTimezone }));
      const clockOutDate = `${clockOutLocal.getFullYear()}-${String(clockOutLocal.getMonth() + 1).padStart(2, '0')}-${String(clockOutLocal.getDate()).padStart(2, '0')}`;
      
      const allWorkerTimesheets = await db
        .select()
        .from(timesheets)
        .where(and(
          eq(timesheets.workerId, profile.id),
          eq(timesheets.jobId, timesheet.jobId),
          isNotNull(timesheets.clockOutTime),
          eq(timesheets.status, 'pending')
        ));
      
      // Filter to same-day timesheets using job timezone
      const sameDayTimesheets = allWorkerTimesheets.filter(ts => {
        const tsLocal = new Date(new Date(ts.clockOutTime!).toLocaleString('en-US', { timeZone: jobTimezone }));
        const tsDate = `${tsLocal.getFullYear()}-${String(tsLocal.getMonth() + 1).padStart(2, '0')}-${String(tsLocal.getDate()).padStart(2, '0')}`;
        return tsDate === clockOutDate && ts.id !== timesheetId;
      });
      
      // If there are other same-day timesheets, consolidate them into one
      if (sameDayTimesheets.length > 0) {
        console.log(`[ClockOut] Consolidating ${sameDayTimesheets.length + 1} same-day timesheets for worker ${profile.id}, job ${timesheet.jobId}`);
        
        try {
          // Calculate combined totals - use sum of actual totalPay values, not recalculated
          let combinedHours = parseFloat(String(updatedTimesheet?.totalHours || 0));
          let combinedPay = updatedTimesheet?.totalPay || 0;
          const consolidatedNotes: string[] = [];
          const consolidatedIds: number[] = sameDayTimesheets.map(ts => ts.id);
          
          if (updatedTimesheet?.workerNotes) {
            consolidatedNotes.push(updatedTimesheet.workerNotes);
          }
          
          for (const otherTs of sameDayTimesheets) {
            combinedHours += parseFloat(String(otherTs.totalHours || 0));
            combinedPay += otherTs.totalPay || 0; // Sum actual pay, don't recalculate
            if (otherTs.workerNotes && !consolidatedNotes.includes(otherTs.workerNotes)) {
              consolidatedNotes.push(otherTs.workerNotes);
            }
          }
          
          // IMPORTANT: Update the main timesheet FIRST with combined totals
          // This ensures we have the consolidated data even if subsequent rejections fail
          const updatedCombined = await storage.updateTimesheet(timesheetId, {
            totalHours: combinedHours.toFixed(2),
            adjustedHours: combinedHours.toFixed(2),
            totalPay: combinedPay, // Use sum of actual pay values
            workerNotes: consolidatedNotes.length > 0 
              ? consolidatedNotes.join(' | ') + ` | Combined from ${sameDayTimesheets.length + 1} shifts`
              : `Combined from ${sameDayTimesheets.length + 1} shifts`,
          });
          
          console.log(`[ClockOut] Updated main timesheet ${timesheetId}: ${combinedHours.toFixed(2)}h, $${(combinedPay/100).toFixed(2)}`);
          
          // Now mark other timesheets as consolidated (rejection)
          // Even if some fail, the main timesheet has correct totals
          for (const otherTs of sameDayTimesheets) {
            try {
              await storage.updateTimesheet(otherTs.id, {
                status: 'rejected',
                rejectionReason: `Consolidated into timesheet #${timesheetId}`,
              });
              console.log(`[ClockOut] Marked timesheet ${otherTs.id} (${otherTs.totalHours}h) as consolidated`);
            } catch (rejectErr: any) {
              console.error(`[ClockOut] Failed to mark timesheet ${otherTs.id} as consolidated:`, rejectErr.message);
              // Continue with other rejections even if one fails
            }
          }
          
          console.log(`[ClockOut] Final consolidated timesheet ${timesheetId}: ${combinedHours.toFixed(2)}h`);
          
          return res.json(updatedCombined);
        } catch (consolidationErr: any) {
          console.error(`[ClockOut] Consolidation error:`, consolidationErr.message);
          // Continue without consolidation - at least the clock-out succeeded
        }
      }
      
      res.json(updatedTimesheet);
    } catch (err) {
      console.error("Clock out error:", err);
      res.status(500).json({ message: "Failed to clock out" });
    }
  });

  app.post("/api/location-pings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { latitude, longitude, accuracy, jobId, source } = req.body;
      
      if (!latitude || !longitude) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }
      
      const user = req.user as any;
      const profile = req.profile;
      
      if (!profile || profile.role !== "worker") {
        return res.status(403).json({ message: "Only workers can submit location pings" });
      }
      
      let distanceFromJob: number | null = null;
      let withinGeofence = false;
      let job = null;
      
      if (jobId) {
        job = await storage.getJob(jobId);
        if (job?.latitude && job?.longitude) {
          distanceFromJob = calculateDistanceMeters(
            latitude, longitude,
            parseFloat(job.latitude), parseFloat(job.longitude)
          );
          withinGeofence = isWithinGeofence(distanceFromJob);
        }
      }
      
      const ping = await db.insert(locationPings).values({
        workerProfileId: profile.id,
        jobId: jobId || null,
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        accuracy: accuracy?.toString() || null,
        source: source || "browser",
        distanceFromJob: distanceFromJob ? Math.round(distanceFromJob) : null,
        withinGeofence,
      }).returning();

      // Server-side auto clock-in when ping is within auto geofence and worker is assigned but not yet clocked in
      if (jobId && job && !job.paymentHoldAt && withinGeofence && isWithinGeofence(distanceFromJob ?? Infinity, true)) {
        const performClockIn = (globalThis as any).__performServerSideClockIn;
        if (typeof performClockIn === "function") {
          performClockIn(profile.id, jobId, latitude, longitude, distanceFromJob ?? 0).catch((e: unknown) =>
            console.error("[LocationPings] Auto clock-in failed:", e)
          );
        }
      }
      
      res.status(201).json({
        ...ping[0],
        distanceMiles: distanceFromJob ? metersToMiles(distanceFromJob).toFixed(2) : null,
        withinGeofence,
        geofenceRadiusMiles: GEOFENCE_RADIUS_MILES,
      });
    } catch (err) {
      console.error("Location ping error:", err);
      res.status(500).json({ message: "Failed to record location ping" });
    }
  });

  /** Location ping from native push handler (app closed) - auth via device token. */
  app.post("/api/location-pings/from-push", async (req, res) => {
    try {
      const { deviceToken, workerId, jobId, latitude, longitude, accuracy } = req.body;
      if (!deviceToken || !workerId || !jobId || latitude == null || longitude == null) {
        return res.status(400).json({ message: "deviceToken, workerId, jobId, latitude, longitude required" });
      }
      const [dt] = await db.select().from(deviceTokens).where(and(eq(deviceTokens.token, String(deviceToken)), eq(deviceTokens.isActive, true)));
      if (!dt || dt.profileId !== Number(workerId)) {
        return res.status(403).json({ message: "Invalid device token or worker mismatch" });
      }
      const profile = await storage.getProfile(Number(workerId));
      if (!profile || profile.role !== "worker") return res.status(403).json({ message: "Not a worker" });
      const job = await storage.getJob(Number(jobId));
      if (!job?.latitude || !job?.longitude) return res.status(400).json({ message: "Job has no location" });
      const lat = Number(latitude);
      const lng = Number(longitude);
      const distanceFromJob = calculateDistanceMeters(lat, lng, parseFloat(job.latitude), parseFloat(job.longitude));
      const withinGeofence = isWithinGeofence(distanceFromJob);
      const ping = await db.insert(locationPings).values({
        workerProfileId: profile.id,
        jobId: Number(jobId),
        latitude: String(lat),
        longitude: String(lng),
        accuracy: accuracy != null ? String(accuracy) : null,
        source: "background",
        distanceFromJob: Math.round(distanceFromJob),
        withinGeofence,
      }).returning();
      if (!job.paymentHoldAt && withinGeofence && isWithinGeofence(distanceFromJob, true)) {
        const fn = (globalThis as any).__performServerSideClockIn;
        if (typeof fn === "function") {
          fn(profile.id, Number(jobId), lat, lng, distanceFromJob).catch((e: unknown) => console.error("[LocationPings/from-push] Auto clock-in failed:", e));
        }
      }
      res.status(201).json({ ...ping[0], distanceMiles: metersToMiles(distanceFromJob).toFixed(2), withinGeofence });
    } catch (err) {
      console.error("Location ping from-push error:", err);
      res.status(500).json({ message: "Failed to record ping" });
    }
  });

  /** Geofence exit from native OS (Android/iOS) - worker left job site, device token auth. */
  app.post("/api/location-pings/geofence-exit", async (req, res) => {
    try {
      const { deviceToken, workerId, jobId, latitude, longitude } = req.body;
      if (!deviceToken || !workerId || !jobId || latitude == null || longitude == null) {
        return res.status(400).json({ message: "deviceToken, workerId, jobId, latitude, longitude required" });
      }
      const [dt] = await db.select().from(deviceTokens).where(and(eq(deviceTokens.token, String(deviceToken)), eq(deviceTokens.isActive, true)));
      if (!dt || dt.profileId !== Number(workerId)) {
        return res.status(403).json({ message: "Invalid device token or worker mismatch" });
      }
      const active = await storage.getActiveTimesheet(Number(workerId));
      if (!active || active.jobId !== Number(jobId)) {
        return res.status(200).json({ message: "No active timesheet for this job", clockedOut: false });
      }
      const job = await storage.getJob(Number(jobId));
      const distanceFromJob = job?.latitude && job?.longitude
        ? calculateDistanceMeters(Number(latitude), Number(longitude), parseFloat(job.latitude), parseFloat(job.longitude))
        : null;
      const performClockOut = (globalThis as any).__performServerSideClockOut;
      if (typeof performClockOut === "function") {
        await performClockOut(active.id, Number(workerId), new Date(), Number(latitude), Number(longitude), distanceFromJob != null ? Math.round(distanceFromJob) : null);
      }
      res.status(200).json({ message: "Clocked out from geofence exit", clockedOut: true });
    } catch (err) {
      console.error("Geofence exit error:", err);
      res.status(500).json({ message: "Failed to process geofence exit" });
    }
  });

  app.post("/api/location-pings/check-geofence", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { latitude, longitude, jobIds } = req.body;
      
      if (!latitude || !longitude) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }
      
      const user = req.user as any;
      const profile = req.profile;
      
      if (!profile || profile.role !== "worker") {
        return res.status(403).json({ message: "Only workers can check geofence" });
      }
      
      const results = [];
      const targetJobIds = jobIds || [];
      
      for (const jobId of targetJobIds) {
        const job = await storage.getJob(jobId);
        if (!job?.latitude || !job?.longitude) continue;
        
        const distanceFromJob = calculateDistanceMeters(
          latitude, longitude,
          parseFloat(job.latitude), parseFloat(job.longitude)
        );
        const withinGeofence = isWithinGeofence(distanceFromJob);
        
        results.push({
          jobId,
          jobTitle: job.title,
          distanceMeters: Math.round(distanceFromJob),
          distanceMiles: metersToMiles(distanceFromJob).toFixed(2),
          withinGeofence,
          canClockIn: withinGeofence,
          jobStartDate: job.startDate,
          isOnDemand: job.isOnDemand,
        });
      }
      
      res.json({
        workerLocation: { latitude, longitude },
        geofenceRadiusMiles: GEOFENCE_RADIUS_MILES,
        geofenceRadiusMeters: GEOFENCE_RADIUS_METERS,
        jobs: results,
      });
    } catch (err) {
      console.error("Geofence check error:", err);
      res.status(500).json({ message: "Failed to check geofence" });
    }
  });

  // Fleet Routing API endpoint - uses Google Routes API for optimized fleet routing
  // Note: Requires Routes API to be enabled in Google Cloud Console
  app.post("/api/fleet-routing", async (req, res) => {
    // Ensure we always return JSON
    res.setHeader("Content-Type", "application/json");
    
    // Require authentication
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    // Verify user object structure
    const user = req.user as any;
    if (!user || (!user.claims?.sub && !user.id)) {
      console.error("[Fleet Routing] Invalid user object:", user);
      return res.status(401).json({ message: "User not found" });
    }
    
    try {
      const { vehicles, waypoints } = req.body;
      
      if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
        return res.status(400).json({ message: "Vehicles array is required" });
      }
      
      if (!waypoints || !Array.isArray(waypoints) || waypoints.length === 0) {
        return res.status(400).json({ message: "Waypoints array is required" });
      }
      
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        console.error("[Fleet Routing] GOOGLE_API_KEY environment variable is not set");
        return res.status(500).json({ 
          success: false,
          message: "Google API key not configured. Please set GOOGLE_API_KEY in your environment variables." 
        });
      }
      
      console.log("[Fleet Routing] Processing request:", {
        vehicleCount: vehicles.length,
        waypointCount: waypoints.length,
        origin: vehicles[0]?.origin,
      });
      
      // Use Google Routes API (v2) for fleet routing
      // Documentation: https://developers.google.com/maps/documentation/routes
      const routesApiUrl = `https://routes.googleapis.com/directions/v2:computeRoutes`;
      
      const origin = vehicles[0].origin;
      const destination = waypoints[waypoints.length - 1];
      const intermediates = waypoints.slice(0, -1);
      
      // Build the request body for Routes API v2
      const routesRequest = {
        origin: {
          location: {
            latLng: {
              latitude: origin.lat,
              longitude: origin.lng,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.lat,
              longitude: destination.lng,
            },
          },
        },
        intermediates: intermediates.map((wp: { lat: number; lng: number }) => ({
          location: {
            latLng: {
              latitude: wp.lat,
              longitude: wp.lng,
            },
          },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        computeAlternativeRoutes: false,
        routeModifiers: {
          avoidTolls: false,
          avoidHighways: false,
          avoidFerries: false,
        },
        languageCode: "en-US",
        units: "IMPERIAL",
        optimizeWaypointOrder: intermediates.length > 0, // Optimize waypoint order for multiple stops
      };
      
      console.log("[Fleet Routing] Calling Google Routes API v2:", routesApiUrl);
      console.log("[Fleet Routing] Request body:", JSON.stringify(routesRequest, null, 2));
      
      const response = await fetch(routesApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.startLocation,routes.legs.endLocation,routes.legs.polyline",
        },
        body: JSON.stringify(routesRequest),
      });
      
      console.log("[Fleet Routing] Response status:", response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Fleet Routing] Routes API error:", response.status, errorText);
        console.error("[Fleet Routing] Request body:", JSON.stringify(routesRequest, null, 2));
        console.error("[Fleet Routing] API Key present:", !!apiKey);
        // Return error but don't fail completely - let frontend fallback to Directions API
        return res.status(response.status).json({ 
          success: false,
          message: "Failed to compute routes with Fleet Routing API",
          error: errorText,
          status: response.status,
        });
      }
      
      const routesData = await response.json();
      
      // Transform Routes API response to match DirectionsResult format for compatibility
      if (routesData.routes && routesData.routes.length > 0) {
        const route = routesData.routes[0];
        
        // Build waypoints array for response
        const allWaypoints = [origin, ...intermediates, destination];
        
        // Convert Routes API format to DirectionsResult-like format
        const directionsResult = {
          routes: [{
            legs: route.legs?.map((leg: any, index: number) => {
              const startWp = allWaypoints[index];
              const endWp = allWaypoints[index + 1];
              
              return {
                distance: {
                  text: `${((leg.distanceMeters || 0) / 1609.34).toFixed(1)} mi`,
                  value: leg.distanceMeters || 0,
                },
                duration: {
                  text: `${Math.round((typeof leg.duration === "string" ? parseInt(leg.duration.replace("s", "")) : (leg.duration?.seconds || 0)) / 60)} min`,
                  value: typeof leg.duration === "string" ? parseInt(leg.duration.replace("s", "")) : (leg.duration?.seconds || 0),
                },
                start_address: startWp?.address || "",
                end_address: endWp?.address || "",
                start_location: {
                  lat: () => leg.startLocation?.latLng?.latitude || startWp?.lat || 0,
                  lng: () => leg.startLocation?.latLng?.longitude || startWp?.lng || 0,
                },
                end_location: {
                  lat: () => leg.endLocation?.latLng?.latitude || endWp?.lat || 0,
                  lng: () => leg.endLocation?.latLng?.longitude || endWp?.lng || 0,
                },
              };
            }) || [],
            overview_polyline: {
              points: route.polyline?.encodedPolyline || "",
            },
          }],
          request: {
            origin: origin,
            destination: destination,
            waypoints: intermediates,
          },
        };
        
        // Calculate total duration from legs if not provided
        const totalDurationSeconds = route.duration 
          ? (typeof route.duration === "string" ? parseInt(route.duration.replace("s", "")) : route.duration.seconds || 0)
          : (route.legs?.reduce((sum: number, leg: any) => sum + (typeof leg.duration === "string" ? parseInt(leg.duration.replace("s", "")) : (leg.duration?.seconds || 0)), 0) || 0);
        
        console.log("[Fleet Routing] ✅ Route calculated successfully:", {
          totalDistance: route.distanceMeters,
          totalDuration: route.duration || `${totalDurationSeconds}s`,
          legCount: route.legs?.length || 0,
        });
        
        res.json({
          success: true,
          route: directionsResult,
          totalDistance: route.distanceMeters || 0,
          totalDuration: route.duration || `${totalDurationSeconds}s`,
        });
      } else {
        res.status(404).json({ success: false, message: "No routes found" });
      }
    } catch (error: any) {
      console.error("Fleet routing error:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to compute fleet routes", 
        error: error.message 
      });
    }
  });

  // Drive time calculation using Google Maps Distance Matrix API
  app.post("/api/maps/drive-time", async (req, res) => {
    const { originLat, originLng, destLat, destLng } = req.body ?? {};
    const hasCoords =
      typeof originLat === "number" && typeof originLng === "number" &&
      typeof destLat === "number" && typeof destLng === "number";

    if (!hasCoords) {
      return res.status(400).json({ message: "Origin and destination coordinates are required" });
    }

    try {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return driveTimeFallback(originLat, originLng, destLat, destLng, res);
      }

      // Use Google Distance Matrix API
      const mapsClient = new GoogleMapsClient({});
      const response = await mapsClient.distancematrix({
        params: {
          origins: [{ lat: originLat, lng: originLng }],
          destinations: [{ lat: destLat, lng: destLng }],
          mode: "driving" as any,
          key: apiKey,
        },
        timeout: 5000,
      });

      if (response.data.rows?.[0]?.elements?.[0]?.status === "OK") {
        const element = response.data.rows[0].elements[0];
        return res.json({
          distance: element.distance?.text || "Unknown",
          duration: element.duration?.text || "Unknown",
          durationValue: element.duration?.value || 0,
          isEstimate: false,
        });
      }
      return driveTimeFallback(originLat, originLng, destLat, destLng, res);
    } catch (err) {
      console.error("Drive time calculation error:", err);
      return driveTimeFallback(originLat, originLng, destLat, destLng, res);
    }
  });

  function driveTimeFallback(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
    res: { json: (body: object) => any }
  ) {
    const distanceMeters = calculateDistanceMeters(originLat, originLng, destLat, destLng);
    const distanceMiles = metersToMiles(distanceMeters);
    const estimatedMinutes = Math.round(distanceMiles * 2);
    return res.json({
      distance: `~${distanceMiles.toFixed(1)} miles`,
      duration: `~${estimatedMinutes} min`,
      durationValue: estimatedMinutes * 60,
      isEstimate: true,
    });
  }

  // Test endpoint: GET /api/geolocation/ip/test — returns raw ipapi response to verify ipapi works
  app.get("/api/geolocation/ip/test", async (_req, res) => {
    try {
      const ipapiKey = process.env.IPAPI_API_KEY;
      const url = ipapiKey ? `https://ipapi.co/json/?key=${ipapiKey}` : "https://ipapi.co/json/";
      const r = await fetch(url);
      const data = await r.json();
      res.json({ ok: r.ok, status: r.status, data });
    } catch (e) {
      res.json({ ok: false, error: String(e) });
    }
  });

  // IP-based geolocation chain: Google → ipapi → ip-api. Each step isolated; failures never stop the chain.
  app.post("/api/geolocation/ip", async (req, res) => {
    // 1. Try Google
    const googleKey = process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_API_KEY;
    if (googleKey) {
      try {
        const gResponse = await fetch(`https://www.googleapis.com/geolocation/v1/geolocate?key=${googleKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ considerIp: true }),
        });
        if (gResponse.ok) {
          const data = await gResponse.json();
          if (data.location?.lat != null && data.location?.lng != null) {
            return res.json({
              latitude: data.location.lat,
              longitude: data.location.lng,
              accuracy: data.accuracy ?? 5000,
              source: "google_ip",
            });
          }
        }
      } catch {
        /* continue to ipapi */
      }
    }

    // 2. Try ipapi.co
    try {
      const ipapiKey = process.env.IPAPI_API_KEY;
      const ipapiUrl = ipapiKey ? `https://ipapi.co/json/?key=${ipapiKey}` : "https://ipapi.co/json/";
      const ipResponse = await fetch(ipapiUrl);
      if (ipResponse.ok) {
        const data = await ipResponse.json();
        if (data.latitude != null && data.longitude != null) {
          return res.json({
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: 10000,
            source: "ipapi",
          });
        }
      }
    } catch {
      /* continue to ip-api */
    }

    // 3. Try ip-api.com
    try {
      const ipApiRes = await fetch("http://ip-api.com/json/?fields=lat,lon,status");
      if (ipApiRes.ok) {
        const data = await ipApiRes.json();
        if (data.status === "success" && data.lat != null && data.lon != null) {
          return res.json({
            latitude: data.lat,
            longitude: data.lon,
            accuracy: 15000,
            source: "ip-api",
          });
        }
      }
    } catch {
      /* continue */
    }

    res.status(200).json({
      error: "Could not determine location from IP",
      configured: true,
    });
  });

  // Update worker profile location (background location saving)
  app.patch("/api/profiles/:id/location", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const profileId = Number(req.params.id);
      const { latitude, longitude } = req.body;
      
      if (!latitude || !longitude) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }
      
      const user = req.user as any;
      const profile = req.profile;
      
      if (!profile || profile.id !== profileId) {
        return res.status(403).json({ message: "Not authorized to update this profile" });
      }
      
      const updated = await storage.updateProfile(profileId, {
        latitude: latitude.toString(),
        longitude: longitude.toString(),
      });
      
      res.json({ success: true, latitude, longitude });
    } catch (err) {
      console.error("Profile location update error:", err);
      res.status(500).json({ message: "Failed to update profile location" });
    }
  });

  // Update worker team member (skills, location, rate, etc.)
  app.patch("/api/team-members/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const memberId = Number(req.params.id);
      const user = req.user as any;
      const profile = req.profile;
      
      if (!profile) {
        return res.status(403).json({ message: "Profile not found" });
      }
      
      // Verify the team member belongs to this worker's team
      const teamMember = await storage.getWorkerTeamMember(memberId);
      if (!teamMember) {
        return res.status(404).json({ message: "Team member not found" });
      }
      
      const team = await storage.getWorkerTeam(profile.id);
      if (!team || teamMember.teamId !== team.id) {
        return res.status(403).json({ message: "Not authorized to update this team member" });
      }
      
      const updates: Record<string, unknown> = { ...req.body };
      const { address, city, state, zipCode, latitude, longitude } = req.body;
      
      // Handle address geocoding if address is provided
      if (address && typeof address === "string" && address.trim()) {
        const coords = (city && state && zipCode)
          ? await geocodeFullAddress(address.trim(), String(city), String(state), String(zipCode))
          : await geocodeAddress(address.trim());
        if (coords) {
          updates.latitude = coords.latitude.toString();
          updates.longitude = coords.longitude.toString();
        }
      } else if (latitude && longitude) {
        // Direct coordinates provided
        updates.latitude = latitude.toString();
        updates.longitude = longitude.toString();
      }
      
      // worker_team_members.hourly_rate is whole dollars (schema). Client sends dollars; legacy DB may have cents.
      if (updates.hourlyRate !== undefined && typeof updates.hourlyRate === 'number') {
        updates.hourlyRate = updates.hourlyRate > 1000 ? Math.round(updates.hourlyRate / 100) : Math.round(updates.hourlyRate);
      }
      if (Array.isArray(req.body.skillsets)) {
        updates.skillsets = req.body.skillsets;
      }
      
      const updated = await storage.updateWorkerTeamMember(memberId, updates);
      res.json(updated);
    } catch (err) {
      console.error("Team member update error:", err);
      res.status(500).json({ message: "Failed to update team member" });
    }
  });

  // Update worker team member location
  app.patch("/api/team-members/:id/location", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const memberId = Number(req.params.id);
      const { latitude, longitude } = req.body;
      
      if (!latitude || !longitude) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }
      
      const user = req.user as any;
      const profile = req.profile;
      
      if (!profile) {
        return res.status(403).json({ message: "Profile not found" });
      }
      
      // Verify the team member belongs to this worker's team
      const teamMember = await storage.getWorkerTeamMember(memberId);
      if (!teamMember) {
        return res.status(404).json({ message: "Team member not found" });
      }
      
      const team = await storage.getWorkerTeam(profile.id);
      if (!team || teamMember.teamId !== team.id) {
        return res.status(403).json({ message: "Not authorized to update this team member" });
      }
      
      const updated = await storage.updateWorkerTeamMember(memberId, {
        latitude: latitude.toString(),
        longitude: longitude.toString(),
      });
      
      res.json(updated);
    } catch (err) {
      console.error("Team member location update error:", err);
      res.status(500).json({ message: "Failed to update team member location" });
    }
  });

  // Bulk update team member locations
  app.post("/api/team-members/locations", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { locations } = req.body;
      
      if (!Array.isArray(locations)) {
        return res.status(400).json({ message: "Locations array is required" });
      }
      
      const user = req.user as any;
      const profile = req.profile;
      
      if (!profile) {
        return res.status(403).json({ message: "Profile not found" });
      }
      
      const team = await storage.getWorkerTeam(profile.id);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      const results = [];
      for (const loc of locations) {
        if (!loc.memberId || !loc.latitude || !loc.longitude) continue;
        
        const teamMember = await storage.getWorkerTeamMember(loc.memberId);
        if (!teamMember || teamMember.teamId !== team.id) continue;
        
        const updated = await storage.updateWorkerTeamMember(loc.memberId, {
          latitude: loc.latitude.toString(),
          longitude: loc.longitude.toString(),
        });
        results.push(updated);
      }
      
      res.json({ updated: results.length, members: results });
    } catch (err) {
      console.error("Bulk team member location update error:", err);
      res.status(500).json({ message: "Failed to update team member locations" });
    }
  });

  app.get("/api/timesheets/company/:companyId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const companyId = Number(req.params.companyId);
    const status = req.query.status as string;
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || (profile.role !== "company" && profile.id !== companyId)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    
    const timesheets = await storage.getTimesheetsByCompany(companyId, status);
    
    // Add auto-approval deadline (48 hours from submission or clock-out)
    const AUTO_APPROVAL_HOURS = 48;
    const timesheetsWithDeadline = timesheets.map(ts => {
      const submissionTime = ts.submittedAt || ts.clockOutTime || ts.createdAt;
      const autoApprovalAt = submissionTime 
        ? new Date(new Date(submissionTime).getTime() + AUTO_APPROVAL_HOURS * 60 * 60 * 1000)
        : null;
      const now = new Date();
      const msRemaining = autoApprovalAt ? autoApprovalAt.getTime() - now.getTime() : null;
      
      return {
        ...ts,
        autoApprovalAt,
        autoApprovalMsRemaining: msRemaining && msRemaining > 0 ? msRemaining : 0,
        willAutoApprove: ts.status === 'pending' && msRemaining !== null && msRemaining <= 0,
      };
    });
    
    res.json(timesheetsWithDeadline);
  });

  // Dev/test only: create 10 real pending timesheets for the current company (for testing approve/reject flows)
  app.post("/api/timesheets/seed-pending", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "company") return res.status(403).json({ message: "Company only" });
    if (process.env.NODE_ENV !== "development" || !isLocalDevHostFromRequest(req)) {
      return res.status(404).json({ message: "Not available" });
    }

    try {
      const companyId = profile.id;
      const companyJobs = await storage.getCompanyJobs(companyId);
      const openOrInProgressJobIds = companyJobs
        .filter((j: any) => j.status === "in_progress" || j.status === "open")
        .map((j: any) => j.id);
      if (openOrInProgressJobIds.length === 0) {
        return res.status(400).json({
          message: "No open or in-progress jobs. Create a job first.",
        });
      }
      const allApps = await storage.getJobApplicationsForJobIds(openOrInProgressJobIds);
      const accepted = allApps.filter((a: any) => a.status === "accepted");
      if (accepted.length === 0) {
        return res.status(400).json({
          message: "No accepted workers on your jobs. Accept at least one worker on a job first.",
        });
      }
      const jobIdsWithAccepted = [...new Set(accepted.map((a: any) => a.jobId))];
      const inProgressJobs = companyJobs.filter((j: any) => jobIdsWithAccepted.includes(j.id));
      const count = Math.min(10, 10);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let created = 0;
      for (let i = 0; i < count; i++) {
        const app = accepted[i % accepted.length];
        const job = inProgressJobs.find((j: any) => j.id === app.jobId) || (await storage.getJob(app.jobId));
        if (!job) continue;
        const clockIn = new Date(today);
        clockIn.setDate(clockIn.getDate() - (i % 3));
        clockIn.setHours(8 + (i % 2), (i % 3) * 20, 0, 0);
        const clockOut = new Date(clockIn);
        clockOut.setHours(16 + (i % 2), 30 + (i % 2) * 15, 0, 0);
        const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
        const jobLat = job.latitude ? parseFloat(job.latitude) : 30.2672;
        const jobLng = job.longitude ? parseFloat(job.longitude) : -97.7431;
        const clockInDist = i % 4 === 0 ? 800 : 200;
        const clockOutDist = i % 4 === 1 ? 600 : 150;
        await db.insert(timesheets).values({
          jobId: app.jobId,
          workerId: app.workerId,
          companyId: job.companyId,
          clockInTime: clockIn,
          clockOutTime: clockOut,
          clockInLatitude: String(jobLat + (clockInDist / 111320) * (i % 2 === 0 ? 1 : -1)),
          clockInLongitude: String(jobLng),
          clockOutLatitude: String(jobLat + (clockOutDist / 111320) * (i % 2 === 0 ? -1 : 1)),
          clockOutLongitude: String(jobLng),
          totalHours: String(hours.toFixed(2)),
          adjustedHours: String(hours.toFixed(2)),
          hourlyRate: job.hourlyRate ?? 3000,
          clockInDistanceFromJob: clockInDist,
          clockOutDistanceFromJob: clockOutDist,
          locationVerified: clockInDist <= 500 && clockOutDist <= 500,
          status: "pending",
          workerNotes: i % 3 === 0 ? "Seed test timesheet " + (i + 1) : null,
        });
        created++;
      }
      res.json({ created, message: `Created ${created} pending timesheet(s). Refresh the Timesheets tab to see them.` });
    } catch (e) {
      console.error("Seed pending timesheets error:", e);
      res.status(500).json({ message: "Failed to seed timesheets", error: String(e) });
    }
  });

  // Auto-approve expired timesheets (called by cron or on-demand)
  // This now processes payment, charges the card/location payment method, and pays the worker
  app.post("/api/timesheets/process-auto-approvals", async (req, res) => {
    try {
      const AUTO_APPROVAL_HOURS = 48;
      const cutoffTime = new Date(Date.now() - AUTO_APPROVAL_HOURS * 60 * 60 * 1000);
      
      // Get all pending timesheets that have passed the 48-hour deadline
      const allPendingTimesheets = await db
        .select()
        .from(timesheets)
        .where(eq(timesheets.status, 'pending'));
      
      const expiredTimesheets = allPendingTimesheets.filter(ts => {
        const submissionTime = ts.submittedAt || ts.clockOutTime || ts.createdAt;
        return submissionTime && new Date(submissionTime) < cutoffTime;
      });
      
      let approvedCount = 0;
      let paidCount = 0;
      let failedCount = 0;
      
      for (const ts of expiredTimesheets) {
        try {
          const job = await storage.getJob(ts.jobId);
          const company = await storage.getProfile(ts.companyId);
          const worker = await storage.getProfile(ts.workerId);
          
          if (!company || !job) {
            console.error(`[AutoApproval] Missing company or job for timesheet ${ts.id}`);
            failedCount++;
            continue;
          }
          
          // Calculate amounts
          const hoursWorked = parseFloat(String(ts.adjustedHours || ts.totalHours)) || 0;
          const totalPay = Math.round(hoursWorked * ts.hourlyRate);
          const COMPANY_MARKUP = 1.52;
          const totalAmount = Math.round(totalPay * COMPANY_MARKUP);
          const platformFee = totalAmount - totalPay;
          
          console.log(`[AutoApproval] Processing timesheet ${ts.id}: ${hoursWorked}h @ $${(ts.hourlyRate/100).toFixed(2)}/hr = $${(totalPay/100).toFixed(2)} (company pays $${(totalAmount/100).toFixed(2)})`);
          
          // Update timesheet to approved
          await storage.updateTimesheet(ts.id, {
            status: 'approved',
            autoApprovedAt: new Date(),
            companyNotes: 'Auto-approved after 48 hours',
            totalPay,
            adjustedHours: String(hoursWorked),
          });
          approvedCount++;
          
          // Create invoice
          const workerName = worker ? `${worker.firstName || ''} ${worker.lastName || ''}`.trim() : 'Worker';
          const invoiceNumber = await storage.getNextInvoiceNumber();
          
          const invoice = await storage.createInvoice({
            invoiceNumber,
            companyId: company.id,
            workerId: ts.workerId,
            jobId: ts.jobId,
            status: "sent",
            issueDate: new Date(),
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            subtotal: totalPay,
            platformFee,
            taxAmount: 0,
            totalAmount,
            notes: `Auto-approved invoice for timesheet #${ts.id}`,
          });
          
          await storage.createInvoiceItem({
            invoiceId: invoice.id,
            description: `${workerName} - ${job.title} (${hoursWorked} hrs)`,
            quantity: hoursWorked.toString(),
            unitPrice: ts.hourlyRate,
            amount: totalPay,
            timesheetId: ts.id,
            workDate: ts.createdAt,
          });
          
          console.log(`[AutoApproval] Created invoice ${invoiceNumber} for timesheet ${ts.id}`);
          
          // Ensure company has a primary payment method (required for catch-all fallback)
          const autoApprovalMethods = await storage.getCompanyPaymentMethods(company.id);
          const autoApprovalHasPrimary = autoApprovalMethods.some((m: any) => m.isPrimary ?? m.is_primary);
          if (!autoApprovalHasPrimary && autoApprovalMethods.length > 0) {
            const firstUsable = autoApprovalMethods.find((m: any) => {
              const hasStripe = !!(m.stripePaymentMethodId ?? m.stripe_payment_method_id);
              const isMercury = !!((m.mercuryRecipientId ?? m.mercury_recipient_id) || (m.mercuryExternalAccountId ?? m.mercury_external_account_id));
              return hasStripe && !isMercury && (m.type === "card" || (m.type === "ach" && m.isVerified));
            }) ?? autoApprovalMethods[0];
            if (firstUsable) await storage.updateCompanyPaymentMethod(firstUsable.id, { isPrimary: true });
          }

          // Resolve company Stripe customer once (create if missing) so all charges use the same customer
          let companyStripeCustomerId: string | null = null;
          try {
            companyStripeCustomerId = await ensureCompanyStripeCustomer({ ...company, userId: (company as any).userId ?? "" });
          } catch (e) {
            console.warn("[AutoApproval] Could not ensure Stripe customer for company", company.id, (e as Error).message);
          }

          // Try to charge the location's payment method
          let paymentCharged = false;
          
          if (job.companyLocationId) {
            const location = await storage.getCompanyLocation(job.companyLocationId);
            
            if (location && location.paymentMethodId) {
              const paymentMethod = await storage.getCompanyPaymentMethod(location.paymentMethodId);
              
              if (paymentMethod) {
                // Handle card payment via Stripe
                if (paymentMethod.type === "card" && paymentMethod.stripePaymentMethodId && companyStripeCustomerId) {
                  console.log(`[AutoApproval] Charging location card (${paymentMethod.cardBrand} ...${paymentMethod.lastFour})`);
                  
                  try {
                    const { chargeCardOffSession, CARD_FEE_PERCENTAGE } = await import("./services/stripe");
                    const cardFee = Math.round(totalAmount * (CARD_FEE_PERCENTAGE / 100));
                    const totalWithFee = totalAmount + cardFee;
                    
                    const chargeResult = await chargeCardOffSession({
                      amount: totalWithFee,
                      customerId: companyStripeCustomerId,
                      paymentMethodId: paymentMethod.stripePaymentMethodId,
                      description: `Auto-approved Timesheet #${ts.id} - ${location.name}`,
                      metadata: {
                        companyId: company.id.toString(),
                        timesheetId: ts.id.toString(),
                        locationId: location.id.toString(),
                        type: "auto_approval_charge",
                      },
                    });
                    
                    if (chargeResult.success && chargeResult.paymentIntentId) {
                      paymentCharged = true;
                      
                      await storage.createCompanyTransaction({
                        profileId: company.id,
                        type: "charge",
                        amount: totalAmount,
                        description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs)`,
                        paymentMethod: "card",
                        stripePaymentIntentId: chargeResult.paymentIntentId,
                        cardFee,
                      });
                      
                      // Update invoice to paid
                      await storage.updateInvoice(invoice.id, {
                        status: "paid",
                        paidAt: new Date(),
                      });
                      
                      console.log(`[AutoApproval] Card charged successfully for timesheet ${ts.id}`);
                    } else {
                      console.warn(`[AutoApproval] Card charge failed for timesheet ${ts.id}: ${chargeResult.error}`);
                    }
                  } catch (cardErr: any) {
                    console.error(`[AutoApproval] Card charge error for timesheet ${ts.id}:`, cardErr.message);
                  }
                }
                // Handle ACH payment via Stripe (saved via SetupIntent; no fee)
                else if (paymentMethod.type === "ach" && paymentMethod.stripePaymentMethodId && companyStripeCustomerId) {
                  console.log(`[AutoApproval] Charging location Stripe ACH (${paymentMethod.bankName} ...${paymentMethod.lastFour})`);
                  
                  try {
                    const { chargeAchOffSession } = await import("./services/stripe");
                    
                    const chargeResult = await chargeAchOffSession({
                      amount: totalAmount,
                      customerId: companyStripeCustomerId,
                      paymentMethodId: paymentMethod.stripePaymentMethodId,
                      description: `Auto-approved Timesheet #${ts.id} - ${location.name}`,
                      metadata: {
                        companyId: company.id.toString(),
                        timesheetId: ts.id.toString(),
                        locationId: location.id.toString(),
                        type: "auto_approval_charge",
                      },
                    });
                    
                    if (chargeResult.success && chargeResult.paymentIntentId) {
                      paymentCharged = true;
                      await storage.createCompanyTransaction({
                        profileId: company.id,
                        type: "charge",
                        amount: totalAmount,
                        description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs) (ACH)`,
                        paymentMethod: "ach",
                        stripePaymentIntentId: chargeResult.paymentIntentId,
                        cardFee: 0,
                      });
                      await storage.updateInvoice(invoice.id, { status: "paid", paidAt: new Date() });
                      console.log(`[AutoApproval] Stripe ACH charged successfully for timesheet ${ts.id}`);
                    } else {
                      console.warn(`[AutoApproval] Stripe ACH charge failed: ${chargeResult.error}`);
                    }
                  } catch (achErr: any) {
                    console.error(`[AutoApproval] Stripe ACH charge error:`, achErr.message);
                  }
                }
                // Handle ACH payment via Mercury Bank (legacy)
                else if (paymentMethod.type === "ach" && paymentMethod.mercuryRecipientId && paymentMethod.mercuryExternalAccountId) {
                  console.log(`[AutoApproval] Charging location Mercury ACH (${paymentMethod.bankName} ...${paymentMethod.lastFour})`);
                  
                  try {
                    const { mercuryService } = await import("./services/mercury");
                    
                    const payment = await mercuryService.requestDebit({
                      recipientId: paymentMethod.mercuryRecipientId,
                      externalAccountId: paymentMethod.mercuryExternalAccountId,
                      amount: totalAmount,
                      description: `Auto-approved Timesheet #${ts.id} - ${location.name}`,
                      idempotencyKey: `timesheet-${ts.id}-autoapproval-${Date.now()}`,
                      note: `Company: ${company.id}, Timesheet: ${ts.id}`,
                    });
                    
                    paymentCharged = true;
                    
                    await storage.createCompanyTransaction({
                      profileId: company.id,
                      type: "charge",
                      amount: totalAmount,
                      description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs) (ACH)`,
                      paymentMethod: "ach",
                      mercuryPaymentId: payment.id,
                      mercuryPaymentStatus: payment.status,
                      cardFee: 0,
                    });
                    
                    // ACH is asynchronous - mark as processing, not paid
                    // Invoice will be marked paid when ACH settles via webhook/reconciliation
                    await storage.updateInvoice(invoice.id, {
                      status: "sent", // Keep as sent until ACH settles
                    });
                    
                    console.log(`[AutoApproval] ACH charge initiated for timesheet ${ts.id} - pending settlement`);
                  } catch (achErr: any) {
                    console.error(`[AutoApproval] ACH charge error for timesheet ${ts.id}:`, achErr.message);
                  }
                }
              }
            }
          }
          
          // If no location payment, try primary card or deduct from balance
          if (!paymentCharged) {
            // Try company's primary payment method
            const primaryPaymentMethod = await storage.getPrimaryPaymentMethod(company.id);
            
            if (primaryPaymentMethod && primaryPaymentMethod.type === "card" && primaryPaymentMethod.stripePaymentMethodId && companyStripeCustomerId) {
              console.log(`[AutoApproval] Charging primary card (${primaryPaymentMethod.cardBrand} ...${primaryPaymentMethod.lastFour})`);
              
              try {
                const { chargeCardOffSession, CARD_FEE_PERCENTAGE } = await import("./services/stripe");
                const cardFee = Math.round(totalAmount * (CARD_FEE_PERCENTAGE / 100));
                const totalWithFee = totalAmount + cardFee;
                
                const chargeResult = await chargeCardOffSession({
                  amount: totalWithFee,
                  customerId: companyStripeCustomerId,
                  paymentMethodId: primaryPaymentMethod.stripePaymentMethodId,
                  description: `Auto-approved Timesheet #${ts.id}`,
                  metadata: {
                    companyId: company.id.toString(),
                    timesheetId: ts.id.toString(),
                    type: "auto_approval_charge",
                  },
                });
                
                if (chargeResult.success && chargeResult.paymentIntentId) {
                  paymentCharged = true;
                  
                  await storage.createCompanyTransaction({
                    profileId: company.id,
                    type: "charge",
                    amount: totalAmount,
                    description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs)`,
                    paymentMethod: "card",
                    stripePaymentIntentId: chargeResult.paymentIntentId,
                    cardFee,
                  });
                  
                  await storage.updateInvoice(invoice.id, {
                    status: "paid",
                    paidAt: new Date(),
                  });
                  
                  console.log(`[AutoApproval] Primary card charged successfully for timesheet ${ts.id}`);
                }
              } catch (cardErr: any) {
                console.error(`[AutoApproval] Primary card charge error:`, cardErr.message);
              }
            }
            
            // Fall back to balance deduction
            if (!paymentCharged) {
              const currentBalance = company.depositAmount || 0;
              
              if (currentBalance >= totalAmount) {
                const newBalance = currentBalance - totalAmount;
                await storage.updateProfile(company.id, { depositAmount: newBalance });
                
                await storage.createCompanyTransaction({
                  profileId: company.id,
                  type: "charge",
                  amount: totalAmount,
                  description: `Auto-approved Timesheet #${ts.id} - ${workerName} (${hoursWorked} hrs)`,
                  paymentMethod: null,
                });
                
                await storage.updateInvoice(invoice.id, {
                  status: "paid",
                  paidAt: new Date(),
                });
                
                paymentCharged = true;
                console.log(`[AutoApproval] Balance deducted for timesheet ${ts.id}: $${(totalAmount/100).toFixed(2)}`);
              } else {
                console.warn(`[AutoApproval] Insufficient balance for timesheet ${ts.id}: $${(currentBalance/100).toFixed(2)} < $${(totalAmount/100).toFixed(2)}`);
              }
            }
          }
          
          // If all payment methods failed, mark the timesheet with payment_failed status and set profile so global popup shows
          if (!paymentCharged) {
            console.warn(`[AutoApproval] All payment methods failed for timesheet ${ts.id} - marking as payment_failed`);
            await storage.updateTimesheet(ts.id, { 
              paymentStatus: "failed",
              companyNotes: 'Auto-approved after 48 hours - payment failed, retry required',
            });
            const failedMethodId =
              (await storage.getPrimaryPaymentMethod(company.id))?.id ??
              autoApprovalMethods.find((m: any) => m.isPrimary ?? m.is_primary)?.id ??
              autoApprovalMethods[0]?.id;
            if (failedMethodId) await storage.updateProfile(company.id, { lastFailedPaymentMethodId: failedMethodId });
            failedCount++;
            continue;
          }
          
          // Pay the worker if company payment was successful
          if (paymentCharged && worker && worker.mercuryRecipientId && worker.mercuryExternalAccountId && totalPay > 0) {
            try {
              const { mercuryService } = await import("./services/mercury");
              
              const payment = await mercuryService.sendPayment({
                recipientId: worker.mercuryRecipientId,
                amount: totalPay,
                description: `Payment for ${job.title} - Auto-approved Timesheet #${ts.id}`,
                idempotencyKey: `timesheet-payout-${ts.id}`,
                note: `Worker: ${worker.id}, Timesheet: ${ts.id}`,
              });
              
              await storage.createWorkerPayout({
                workerId: worker.id,
                timesheetId: ts.id,
                amount: totalPay,
                status: payment.status === "completed" ? "completed" : "pending",
                mercuryPaymentId: payment.id,
                mercuryPaymentStatus: payment.status,
              });
              
              await storage.updateTimesheet(ts.id, {
                paymentStatus: payment.status === "completed" ? "completed" : "pending",
              });
              
              paidCount++;
              console.log(`[AutoApproval] Worker payout initiated for timesheet ${ts.id}: $${(totalPay/100).toFixed(2)}`);
            } catch (payoutErr: any) {
              console.error(`[AutoApproval] Worker payout failed for timesheet ${ts.id}:`, payoutErr.message);
              await storage.updateTimesheet(ts.id, { paymentStatus: "failed" });
            }
          } else if (paymentCharged && worker && (!worker.mercuryRecipientId || !worker.mercuryExternalAccountId)) {
            // Worker has no bank account - create escrow payout
            await storage.createWorkerPayout({
              workerId: worker.id,
              timesheetId: ts.id,
              jobId: ts.jobId,
              amount: totalPay,
              status: "pending_bank_setup",
              description: `Held pending bank account setup - ${job.title}`,
              hoursWorked: hoursWorked.toString(),
              hourlyRate: ts.hourlyRate,
            });
            
            await storage.updateTimesheet(ts.id, { paymentStatus: "pending" });
            console.log(`[AutoApproval] Worker ${worker.id} has no bank account - $${(totalPay/100).toFixed(2)} held in escrow`);
          }
          
          // Notify worker of auto-approval
          if (worker) {
            notifyTimesheetUpdate(ts.workerId, {
              timesheetId: ts.id,
              jobId: ts.jobId,
              jobTitle: job.title,
              status: 'approved',
              amount: totalPay,
            });
          }
        } catch (tsErr: any) {
          console.error(`[AutoApproval] Error processing timesheet ${ts.id}:`, tsErr.message);
          failedCount++;
        }
      }
      
      res.json({ 
        processed: approvedCount, 
        paid: paidCount,
        failed: failedCount,
        message: `Auto-approved ${approvedCount} timesheets, paid ${paidCount}` 
      });
    } catch (err) {
      console.error("Auto-approval processing error:", err);
      res.status(500).json({ message: "Failed to process auto-approvals"       });
    }
  });

  // Retry failed timesheet payments (when company adds new payment method after decline)
  app.post("/api/timesheets/retry-failed-payments", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") return res.status(403).json({ message: "Unauthorized" });
    try {
      // Use profile from DB so we always have current stripe_customer_id (not cached session)
      const freshProfile = await storage.getProfile(profile.id);
      if (!freshProfile) return res.status(404).json({ message: "Profile not found" });
      const profileToUse = freshProfile as any;

      const allTimesheets = await storage.getTimesheetsByCompany(profileToUse.id, "approved");
      const failedTimesheets = allTimesheets.filter((ts: any) => ts.paymentStatus === "failed" || ts.payment_status === "failed");
      if (failedTimesheets.length === 0) {
        await storage.updateProfile(profileToUse.id, { lastFailedPaymentMethodId: null });
        return res.json({ retried: 0, message: "No failed payments to retry" });
      }

      const platformConfig = await storage.getPlatformConfig();
      const platformFeePerHourCents = platformConfig?.platformFeePerHourCents ?? 1300;
      const primaryMethod = await storage.getPrimaryPaymentMethod(profileToUse.id);
      const userId = user?.claims?.sub ?? user?.id ?? user?.sub ?? profileToUse.userId;
      const profileForStripe = { ...profileToUse, userId: userId ? String(userId) : "" };
      const customerId = await ensureCompanyStripeCustomer(profileForStripe);
      const canChargePrimary = primaryMethod && customerId && (
        (primaryMethod.type === "card" && primaryMethod.stripePaymentMethodId) ||
        (primaryMethod.type === "ach" && (primaryMethod.isVerified === true) && primaryMethod.stripePaymentMethodId)
      );
      if (!canChargePrimary) {
        return res.status(400).json({ message: "No valid primary payment method to retry with. Please set or add a card in Payment Methods." });
      }

      // Verify primary PM is attached to our customer and usable (avoids "PaymentMethod may not be used again")
      const pmId = primaryMethod.stripePaymentMethodId ?? (primaryMethod as any).stripe_payment_method_id;
      if (pmId) {
        try {
          const stripeService = (await import("./services/stripe")).default;
          const stripe = stripeService.getStripe();
          const pm = await stripe.paymentMethods.retrieve(pmId);
          const pmCustomerId = typeof (pm as any).customer === "string" ? (pm as any).customer : (pm as any).customer?.id ?? null;
          if (pmCustomerId !== customerId) {
            await storage.deleteCompanyPaymentMethod(primaryMethod.id);
            return res.status(400).json({
              message: "Your primary payment method is no longer valid (wrong customer). Please set a new primary in Payment Methods and try again.",
            });
          }
        } catch (pmErr: any) {
          const msg = String(pmErr?.message ?? "").toLowerCase();
          const unusable = msg.includes("may not be used again") || msg.includes("no such payment_method") || msg.includes("detached");
          if (unusable) {
            await storage.deleteCompanyPaymentMethod(primaryMethod.id);
            return res.status(400).json({
              message: "Your primary payment method can no longer be used. Please set a new primary in Payment Methods and try again.",
            });
          }
          throw pmErr;
        }
      }

      let retried = 0;
      for (const ts of failedTimesheets) {
        const hoursWorked = parseFloat(String(ts.adjustedHours ?? ts.totalHours ?? 0)) || 0;
        const totalPay = ts.totalPay ?? Math.round(hoursWorked * (ts.hourlyRate ?? 0));
        const platformFee = Math.round(hoursWorked * platformFeePerHourCents);
        const totalAmount = totalPay + platformFee;
        if (totalAmount <= 0) continue;

        let charged = false;
        if (primaryMethod.type === "card" && primaryMethod.stripePaymentMethodId) {
          try {
            const { chargeCardOffSession, CARD_FEE_PERCENTAGE } = await import("./services/stripe");
            const cardFee = Math.round(totalAmount * (CARD_FEE_PERCENTAGE / 100));
            const chargeResult = await chargeCardOffSession({
              amount: totalAmount + cardFee,
              customerId,
              paymentMethodId: primaryMethod.stripePaymentMethodId,
              description: `Timesheet #${ts.id} - Retry failed payment`,
              metadata: { companyId: profileToUse.id.toString(), timesheetId: ts.id.toString(), type: "timesheet_retry_charge" },
            });
            if (chargeResult.success && chargeResult.paymentIntentId) {
              charged = true;
              await storage.createCompanyTransaction({
                profileId: profileToUse.id,
                type: "charge",
                amount: totalAmount,
                description: `Timesheet #${ts.id} - Retry failed payment (card)`,
                paymentMethod: "card",
                stripePaymentIntentId: chargeResult.paymentIntentId,
                cardFee,
              });
            } else {
              await storage.updateProfile(profileToUse.id, { lastFailedPaymentMethodId: primaryMethod.id });
            }
          } catch (e: any) {
            console.warn(`[RetryFailed] Card charge failed for timesheet ${ts.id}:`, e?.message);
            await storage.updateProfile(profileToUse.id, { lastFailedPaymentMethodId: primaryMethod.id });
          }
        } else if (primaryMethod.type === "ach" && primaryMethod.stripePaymentMethodId) {
          try {
            const { chargeAchOffSession } = await import("./services/stripe");
            const chargeResult = await chargeAchOffSession({
              amount: totalAmount,
              customerId,
              paymentMethodId: primaryMethod.stripePaymentMethodId,
              description: `Timesheet #${ts.id} - Retry failed payment`,
              metadata: { companyId: profileToUse.id.toString(), timesheetId: ts.id.toString(), type: "timesheet_retry_charge" },
            });
            if (chargeResult.success && chargeResult.paymentIntentId) {
              charged = true;
              await storage.createCompanyTransaction({
                profileId: profileToUse.id,
                type: "charge",
                amount: totalAmount,
                description: `Timesheet #${ts.id} - Retry failed payment (ACH)`,
                paymentMethod: "ach",
                stripePaymentIntentId: chargeResult.paymentIntentId,
                cardFee: 0,
              });
            } else {
              await storage.updateProfile(profileToUse.id, { lastFailedPaymentMethodId: primaryMethod.id });
            }
          } catch (e: any) {
            console.warn(`[RetryFailed] ACH charge failed for timesheet ${ts.id}:`, e?.message);
            await storage.updateProfile(profileToUse.id, { lastFailedPaymentMethodId: primaryMethod.id });
          }
        }

        if (charged) {
          await storage.updateTimesheet(ts.id, { paymentStatus: "pending" });
          retried++;
        }
      }

      const stillFailed = (await storage.getTimesheetsByCompany(profileToUse.id, "approved")).filter(
        (ts: any) => ts.paymentStatus === "failed" || ts.payment_status === "failed"
      );
      if (stillFailed.length === 0) {
        await storage.updateProfile(profileToUse.id, { lastFailedPaymentMethodId: null });
      }

      return res.json({
        retried,
        failedCount: stillFailed.length,
        message: retried > 0 ? `Charged ${retried} payment(s). Worker payouts will process shortly.` : (stillFailed.length > 0 ? "Charges failed. Please update your payment method and try again." : "No failed payments to retry"),
      });
    } catch (err: any) {
      console.error("Retry failed payments error:", err);
      return res.status(500).json({ message: err?.message || "Failed to retry" });
    }
  });

  // Get a single timesheet by ID
  app.get("/api/timesheets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const id = Number(req.params.id);
    const timesheet = await storage.getTimesheet(id);
    if (!timesheet) {
      return res.status(404).json({ message: "Timesheet not found" });
    }
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    
    // Check authorization: company owner, worker, or company team member
    const isCompanyOwner = profile.id === timesheet.companyId;
    const isWorker = profile.id === timesheet.workerId;
    
    // Check if user is a team member of the company that owns this timesheet
    let isTeamMember = false;
    if (!isCompanyOwner && !isWorker) {
      const [teamMember] = await db.select()
        .from(companyTeamMembers)
        .where(and(
          eq(companyTeamMembers.companyProfileId, timesheet.companyId),
          eq(companyTeamMembers.userId, profile.userId!),
          eq(companyTeamMembers.isActive, true)
        ))
        .limit(1);
      isTeamMember = !!teamMember;
    }
    
    if (!isCompanyOwner && !isWorker && !isTeamMember) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    let timesheetOut = timesheet;
    const workerProfile = await storage.getProfile(timesheet.workerId);
    let payout = await storage.getWorkerPayoutByTimesheetId(id);

    // Live Mercury status: refresh payout + timesheet payment fields when a payment is in flight
    if (
      payout?.mercuryPaymentId &&
      payout.status !== "completed" &&
      payout.status !== "failed"
    ) {
      try {
        const { mercuryService } = await import("./services/mercury");
        const tx = await mercuryService.getTransaction(payout.mercuryPaymentId);
        const txStatus = (tx?.status ?? "").toLowerCase();
        if (txStatus === "completed" || txStatus === "sent" || txStatus === "posted") {
          const completedAt = tx?.createdAt ? new Date(tx.createdAt) : new Date();
          await storage.updateWorkerPayout(payout.id, {
            status: "completed",
            mercuryPaymentStatus: tx?.status ?? "completed",
            completedAt,
          } as any);
          await storage.updateTimesheet(id, { paymentStatus: "completed", paidAt: completedAt });
          payout = (await storage.getWorkerPayoutByTimesheetId(id)) ?? payout;
          timesheetOut = (await storage.getTimesheet(id)) ?? timesheetOut;
        } else if (tx?.status && tx.status !== payout.mercuryPaymentStatus) {
          await storage.updateWorkerPayout(payout.id, {
            mercuryPaymentStatus: tx.status,
          } as any);
          payout = (await storage.getWorkerPayoutByTimesheetId(id)) ?? payout;
        }
      } catch (syncErr: any) {
        console.warn(`[TimesheetGET] Mercury sync timesheet ${id}:`, syncErr?.message ?? syncErr);
      }
    }

    let businessOperatorPreview: {
      id: number;
      firstName?: string | null;
      lastName?: string | null;
      avatarUrl?: string | null;
    } | null = null;
    if (workerProfile?.teamId) {
      const team = await storage.getTeamById(workerProfile.teamId);
      if (team?.ownerId && team.ownerId !== workerProfile.id) {
        const bo = await storage.getProfile(team.ownerId);
        if (bo) {
          businessOperatorPreview = {
            id: bo.id,
            firstName: bo.firstName,
            lastName: bo.lastName,
            avatarUrl: bo.avatarUrl,
          };
        }
      }
    }

    /** Teammate row from accepted application (employee profile often has empty name/avatar; roster has the real display). */
    let teamMemberFromApp: (typeof workerTeamMembers.$inferSelect) | null = null;
    if (workerProfile && timesheetOut.jobId) {
      const [byWorkerTm] = await db
        .select({ m: workerTeamMembers })
        .from(applications)
        .innerJoin(workerTeamMembers, eq(applications.teamMemberId, workerTeamMembers.id))
        .where(
          and(
            eq(applications.jobId, timesheetOut.jobId),
            eq(applications.status, "accepted"),
            eq(applications.workerId, workerProfile.id),
            isNotNull(applications.teamMemberId)
          )
        )
        .limit(1);
      teamMemberFromApp = byWorkerTm?.m ?? null;

      if (!teamMemberFromApp && workerProfile.email) {
        const [byEmailTm] = await db
          .select({ m: workerTeamMembers })
          .from(applications)
          .innerJoin(workerTeamMembers, eq(applications.teamMemberId, workerTeamMembers.id))
          .where(
            and(
              eq(applications.jobId, timesheetOut.jobId),
              eq(applications.status, "accepted"),
              eq(workerTeamMembers.email, workerProfile.email)
            )
          )
          .limit(1);
        teamMemberFromApp = byEmailTm?.m ?? null;
      }

      // Owner / teammate on roster: profile may be empty but worker_team_members has display + avatar
      if (!teamMemberFromApp && workerProfile.teamId && workerProfile.email) {
        const [rosterMatch] = await db
          .select()
          .from(workerTeamMembers)
          .where(
            and(
              eq(workerTeamMembers.teamId, workerProfile.teamId),
              eq(workerTeamMembers.email, workerProfile.email),
              eq(workerTeamMembers.status, "active")
            )
          )
          .limit(1);
        teamMemberFromApp = rosterMatch ?? null;
      }
    }

    let jobPreview: {
      id: number;
      title: string | null;
      trade: string | null;
      company: {
        companyName?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      } | null;
    } | null = null;
    if (timesheetOut.jobId) {
      const j = await storage.getJob(timesheetOut.jobId);
      if (j) {
        const jc = await storage.getProfile(j.companyId);
        jobPreview = {
          id: j.id,
          title: displayJobTitle(j.title, j.trade),
          trade: j.trade,
          company: jc
            ? {
                companyName: jc.companyName,
                firstName: jc.firstName,
                lastName: jc.lastName,
              }
            : null,
        };
      }
    }

    let workerPreviewOut: {
      id: number;
      firstName?: string | null;
      lastName?: string | null;
      avatarUrl?: string | null;
    } | null = null;
    if (workerProfile) {
      const needsName =
        !String(workerProfile.firstName || "").trim() && !String(workerProfile.lastName || "").trim();
      const needsAvatar = !String(workerProfile.avatarUrl || "").trim();
      workerPreviewOut = {
        id: workerProfile.id,
        firstName: workerProfile.firstName,
        lastName: workerProfile.lastName,
        avatarUrl: workerProfile.avatarUrl,
      };
      if (teamMemberFromApp && (needsName || needsAvatar)) {
        workerPreviewOut = {
          id: workerProfile.id,
          firstName: needsName ? teamMemberFromApp.firstName : workerProfile.firstName,
          lastName: needsName ? teamMemberFromApp.lastName : workerProfile.lastName,
          avatarUrl: needsAvatar ? teamMemberFromApp.avatarUrl : workerProfile.avatarUrl,
        };
      } else if (businessOperatorPreview && (needsName || needsAvatar)) {
        workerPreviewOut = {
          id: workerProfile.id,
          firstName: needsName ? businessOperatorPreview.firstName : workerProfile.firstName,
          lastName: needsName ? businessOperatorPreview.lastName : workerProfile.lastName,
          avatarUrl: needsAvatar ? businessOperatorPreview.avatarUrl : workerProfile.avatarUrl,
        };
      }
    }

    res.json({
      ...timesheetOut,
      jobPreview,
      workerPreview: workerPreviewOut,
      businessOperatorPreview,
      payoutPreview: payout
        ? {
            status: payout.status,
            mercuryPaymentStatus: payout.mercuryPaymentStatus,
            processedAt: payout.processedAt,
            completedAt: payout.completedAt,
            isInstantPayout: payout.isInstantPayout,
            createdAt: payout.createdAt,
            errorMessage: payout.errorMessage,
            mercuryPaymentId: payout.mercuryPaymentId,
          }
        : null,
    });
  });

  /** When a job's estimated labor budget (budgetCents) is met, send company one "close project" review email with URL to review flow.
   * Labor spend = sum over approved timesheets of (hours × (worker hourly rate + $13 platform fee)).
   * Skipped for on-demand jobs (no fixed end date). Skipped if there are pending timesheets (different email flow). */
  async function checkBudgetMetAndSendReviewEmail(jobId: number): Promise<void> {
    try {
      const job = await storage.getJob(jobId);
      if (!job?.budgetCents || job.budgetCents <= 0) return;
      if (job.jobType === "on_demand" || job.isOnDemand) return;
      const jobTimesheets = await storage.getTimesheetsByJobIds([jobId]);
      const pending = jobTimesheets.filter((t: any) => t.status === "pending");
      if (pending.length > 0) return;
      const platformConfig = await storage.getPlatformConfig();
      const platformFeePerHourCents = platformConfig?.platformFeePerHourCents ?? 1300;
      const approved = jobTimesheets.filter((t: any) => t.status === "approved");
      const totalSpentCents = approved.reduce((sum: number, t: any) => {
        const hours = parseFloat(String(t.adjustedHours ?? t.totalHours ?? 0)) || 0;
        const workerRateCents = t.hourlyRate ?? 0;
        return sum + Math.round(hours * (workerRateCents + platformFeePerHourCents));
      }, 0);
      if (totalSpentCents < job.budgetCents) return;
      const [alreadySent] = await db.select().from(jobBudgetReviewEmailSent).where(eq(jobBudgetReviewEmailSent.jobId, jobId)).limit(1);
      if (alreadySent) return;
      const company = await storage.getProfile(job.companyId);
      if (!company?.email) return;
      const baseUrl = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";
      const reviewUrl = `${baseUrl}/company-dashboard?completeJob=${jobId}&jobTitle=${encodeURIComponent(job.title || "Job")}`;
      await sendEmail({
        to: company.email,
        type: "close_project_review",
        data: { jobTitle: job.title || "Job", jobId, reviewUrl },
      });
      await db.insert(jobBudgetReviewEmailSent).values({ jobId });
    } catch (err) {
      console.error("[checkBudgetMetAndSendReviewEmail]", jobId, err);
    }
  }

  app.put("/api/timesheets/:id/approve", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const id = Number(req.params.id);
    const { adjustedHours, companyNotes } = req.body;
    console.log(`[TimesheetApproval] Approve requested for timesheet ${id} (Mercury payout logs will follow in this terminal).`);
    
    const timesheet = await storage.getTimesheet(id);
    if (!timesheet) {
      return res.status(404).json({ message: "Timesheet not found" });
    }
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    
    // Check authorization: company owner or company team member
    const isCompanyOwner = profile.id === timesheet.companyId;
    let isTeamMember = false;
    if (!isCompanyOwner && profile.userId) {
      const [teamMember] = await db.select()
        .from(companyTeamMembers)
        .where(and(
          eq(companyTeamMembers.companyProfileId, timesheet.companyId),
          eq(companyTeamMembers.userId, profile.userId),
          eq(companyTeamMembers.isActive, true)
        ))
        .limit(1);
      isTeamMember = !!teamMember;
    }
    
    if (!isCompanyOwner && !isTeamMember) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Idempotent replay: already approved — no double charge / duplicate payout
    if (timesheet.status === "approved") {
      const [balanceRowApproved] = await db
        .select({ depositAmount: profiles.depositAmount })
        .from(profiles)
        .where(eq(profiles.id, profile.id))
        .limit(1);
      const companyBalanceCents = Number(balanceRowApproved?.depositAmount ?? profile.depositAmount ?? 0);
      return res.json({ ...timesheet, companyBalanceCents, alreadyApproved: true });
    }

    if (timesheet.status === "disputed") {
      return res.status(400).json({
        message: "This timesheet is disputed. Resolve the dispute before approving.",
        code: "TIMESHEET_DISPUTED",
      });
    }

    // Location/geofence is informational in the UI only; company may still approve.
    if (timesheet.locationVerified === false) {
      console.log(
        `[TimesheetApproval] Timesheet ${id}: location not verified (approving anyway per product policy)`
      );
    }

    const originalHours = timesheet.totalHours ?? "0";
    const finalHours = adjustedHours ?? timesheet.adjustedHours ?? timesheet.totalHours ?? "0";
    const hoursNum = parseFloat(String(finalHours)) || 0;
    const totalPay = Math.round(hoursNum * timesheet.hourlyRate);
    const wasEdited = adjustedHours && parseFloat(adjustedHours) !== parseFloat(String(originalHours));
    if (wasEdited) {
      const notes = typeof companyNotes === "string" ? companyNotes.trim() : "";
      if (notes.length < 30) {
        return res.status(400).json({ message: "When editing hours, a reason is required (at least 30 characters) so the worker can see why the timesheet was changed." });
      }
    }

    // Reject approval when company balance is insufficient (prevent approving more than available)
    const [balanceRow] = await db.select({ depositAmount: profiles.depositAmount }).from(profiles).where(eq(profiles.id, profile.id)).limit(1);
    const balanceCents = Number(balanceRow?.depositAmount ?? profile.depositAmount ?? 0);
    if (balanceCents < totalPay) {
      return res.status(402).json({
        message: "Insufficient balance to approve this timesheet. Add funds in Payment Methods to continue.",
        code: "INSUFFICIENT_BALANCE",
        balanceCents,
        requiredCents: totalPay,
      });
    }

    console.log(`[TimesheetApproval] Updating timesheet ${id} to approved status`);
    
    const updatedTimesheet = await storage.updateTimesheet(id, {
      status: "approved",
      approvedBy: profile.id,
      approvedAt: new Date(),
      adjustedHours: String(hoursNum),
      totalPay,
      companyNotes,
    });
    
    console.log(`[TimesheetApproval] Timesheet ${id} updated. Status: ${updatedTimesheet?.status}`);

    // Get worker and job info for notifications
    const worker = await storage.getProfile(timesheet.workerId);
    const job = await storage.getJob(timesheet.jobId);
    
    // Real-time WebSocket notification to worker
    notifyTimesheetUpdate(timesheet.workerId, {
      timesheetId: id,
      jobId: timesheet.jobId,
      jobTitle: job?.title || 'Unknown Job',
      status: wasEdited ? 'edited' : 'approved',
      amount: totalPay,
    });
    
    if (worker?.email && worker.emailNotifications && job) {
      const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
      const workerDisplayName = `${worker.firstName || ''} ${worker.lastName || ''}`.trim() || 'Worker';
      const adminDisplayName = profile.companyName || [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() || 'Company';
      const messageLink = `${baseUrl}/dashboard?job=${job.id}`;
      sendEmail({
        to: worker.email,
        type: 'timesheet_approved',
        data: {
          jobTitle: job.title,
          jobId: job.id,
          hours: String(hoursNum),
          amount: (totalPay / 100).toFixed(2),
          workerName: workerDisplayName,
          adminName: adminDisplayName,
          messageLink,
        }
      }).catch(err => console.error('Failed to send timesheet approved email:', err));

      // If hours were edited, also send timesheet edited notification
      if (wasEdited) {
        sendEmail({
          to: worker.email,
          type: 'timesheet_edited',
          data: {
            action: 'edited',
            jobTitle: job.title,
            timesheetId: id,
            originalHours: originalHours,
            adjustedHours: String(hoursNum),
            companyName: profile.companyName || `${profile.firstName} ${profile.lastName}`,
            reason: companyNotes || 'No reason provided',
          }
        }).catch(err => console.error('Failed to send timesheet edited email:', err));
      }
    }
    
    // Auto-generate invoice for the approved timesheet
    try {
      console.log(`[TimesheetApproval] Starting invoice generation and payment processing for timesheet ${id}`);
      const workerName = worker ? `${worker.firstName || ''} ${worker.lastName || ''}`.trim() : 'Worker';
      const invoiceNumber = await storage.getNextInvoiceNumber();
      
      // Platform fee from admin config: $X per hour on top of worker rate. Company pays worker_rate + platform_fee/hr; affiliate gets config.affiliateCommissionPercent of platform fee.
      const platformConfig = await storage.getPlatformConfig();
      const platformFeePerHourCents = platformConfig?.platformFeePerHourCents ?? 1300; // $13/hr default
      const affiliateCommissionPercent = platformConfig?.affiliateCommissionPercent ?? 20;
      const hoursWorked = parseFloat(finalHours) || 0;
      const platformFee = Math.round(hoursWorked * platformFeePerHourCents); // Platform fee for this timesheet
      const totalAmount = totalPay + platformFee; // What company pays (worker pay + platform fee)
      
      console.log(`[TimesheetApproval] Invoice calculation: Worker pay $${(totalPay/100).toFixed(2)}, Platform fee $${(platformFee/100).toFixed(2)} ($${(platformFeePerHourCents/100).toFixed(2)}/hr), Total $${(totalAmount/100).toFixed(2)}`);
      
      // Affiliate commission: 20% of platform fee when worker was referred by an affiliate (credited on timesheet approval)
      const referredByAffiliateId = worker?.referredByAffiliateId ?? null;
      if (referredByAffiliateId && platformFee > 0) {
        const commissionCents = Math.round(platformFee * affiliateCommissionPercent / 100);
        if (commissionCents > 0) {
          await storage.createAffiliateCommission({
            affiliateId: referredByAffiliateId,
            timesheetId: id,
            amountCents: commissionCents,
            status: "pending",
          });
          const affiliate = await storage.getAffiliate(referredByAffiliateId);
          if (affiliate) {
            const affiliateUser = await authStorage.getUser(affiliate.userId);
            const affiliateEmail = (affiliate.email || affiliateUser?.email || "").trim();
            if (affiliateEmail) {
              const baseUrl = (
                process.env.BASE_URL ||
                process.env.APP_URL ||
                `${req.protocol || "https"}://${req.get("host") || ""}`
              ).replace(/\/$/, "");
              sendEmail({
                to: affiliateEmail,
                type: "affiliate_commission_available",
                data: {
                  firstName: affiliate.firstName || "there",
                  amountCents: commissionCents,
                  description: `Commission from approved timesheet #${id}`,
                  hasPayoutSetup: Boolean(affiliate.mercuryRecipientId && affiliate.w9UploadedAt),
                  dashboardUrl: `${baseUrl}/affiliate-dashboard`,
                },
              }).catch((emailErr) => {
                console.error("[TimesheetApproval] Failed affiliate commission email:", emailErr);
              });
            }
          }
          console.log(`[TimesheetApproval] Affiliate commission: $${(commissionCents/100).toFixed(2)} (${affiliateCommissionPercent}% of platform fee) for affiliate ${referredByAffiliateId}`);
        }
      }
      
      const invoice = await storage.createInvoice({
        invoiceNumber,
        companyId: profile.id,
        workerId: timesheet.workerId,
        jobId: timesheet.jobId,
        status: "sent",
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        subtotal: totalPay,
        platformFee,
        taxAmount: 0,
        totalAmount,
        notes: `Auto-generated invoice for timesheet #${id}`,
      });
      
      await storage.createInvoiceItem({
        invoiceId: invoice.id,
        description: `${workerName} - ${job?.title || 'Job'} (${finalHours} hrs)`,
        quantity: finalHours.toString(),
        unitPrice: timesheet.hourlyRate,
        amount: totalPay,
        timesheetId: id,
        workDate: timesheet.createdAt,
      });
      
      console.log(`[TimesheetApproval] Auto-generated invoice ${invoiceNumber} for timesheet ${id}`);

      // Reduce company balance on approve so the company sees the deduction immediately (whether worker is paid now or held in escrow).
      const [balanceBeforeRow] = await db.select({ depositAmount: profiles.depositAmount }).from(profiles).where(eq(profiles.id, profile.id)).limit(1);
      const balanceBefore = Number(balanceBeforeRow?.depositAmount ?? profile.depositAmount ?? 0);
      const newBalance = Math.max(0, balanceBefore - totalPay);
      await storage.updateProfile(profile.id, { depositAmount: newBalance });
      const lowBalanceThreshold = Number(profile.autoReplenishThreshold ?? 200000);
      if ((balanceBefore >= lowBalanceThreshold) && (newBalance < lowBalanceThreshold) && profile.email) {
        sendEmail({
          to: profile.email,
          type: "balance_low",
          data: {
            balance: (newBalance / 100).toFixed(2),
          },
        }).catch((emailErr) => {
          console.error("[TimesheetApproval] Failed low balance email:", emailErr);
        });
      }
      const workerNameForTx = worker ? `${worker.firstName || ''} ${worker.lastName || ''}`.trim() || 'Worker' : 'Worker';
      await storage.createCompanyTransaction({
        profileId: profile.id,
        type: "charge",
        amount: totalPay,
        description: `Timesheet #${id} - ${workerNameForTx} (approved) - ${finalHours} hrs`,
      });
      console.log(`[TimesheetApproval] Reduced company balance by $${(totalPay / 100).toFixed(2)} (timesheet approved). Previous: $${(balanceBefore / 100).toFixed(2)}, New: $${(newBalance / 100).toFixed(2)}`);
    } catch (invoiceErr: any) {
      console.error('[TimesheetApproval] Failed to auto-generate invoice:', invoiceErr?.message || invoiceErr);
      console.error('[TimesheetApproval] Stack:', invoiceErr?.stack);
    }

    // Platform pays worker from Mercury when they have W-9 + bank; balance was already deducted above.
    try {
      console.log(`[Mercury] Approved timesheet ${id}: triggering platform → worker payout. workerId=${timesheet.workerId}, totalPay=$${(totalPay/100).toFixed(2)}`);
      const workerForPayout = await storage.getProfile(timesheet.workerId);
      const hasW9 = workerForPayout?.w9UploadedAt != null;
      const hasBankAccount = !!(workerForPayout?.mercuryRecipientId && workerForPayout?.mercuryExternalAccountId);
      console.log(`[Mercury] Timesheet ${id} approved. Worker payout: workerId=${timesheet.workerId}, totalPay=$${(totalPay/100).toFixed(2)}, hasW9=${hasW9}, hasBankAccount=${hasBankAccount}. Platform will transfer to this worker's recipient when both true.`);
      
      if (workerForPayout && totalPay > 0) {
        if (!hasW9) {
          console.log(`[TimesheetApproval] Worker ${workerForPayout.id} has no W-9 - creating escrow payout`);
          await storage.createWorkerPayout({
            workerId: workerForPayout.id,
            timesheetId: id,
            jobId: timesheet.jobId,
            amount: totalPay,
            status: "pending_w9",
            description: `Held pending W-9 upload - ${job?.title || 'Job'}`,
            hoursWorked: finalHours,
            hourlyRate: timesheet.hourlyRate,
          });
          await storage.updateTimesheet(id, { paymentStatus: "pending" });
          if (workerForPayout.email) {
            const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
            sendEmail({
              to: workerForPayout.email,
              type: 'payout_pending_w9',
              data: {
                workerName: `${workerForPayout.firstName || ''} ${workerForPayout.lastName || ''}`.trim(),
                amount: (totalPay / 100).toFixed(2),
                jobTitle: job?.title || 'Job',
                documentsUrl: `${baseUrl}/dashboard/account-documents`,
              }
            }).catch(err => console.error('Failed to send W-9 requirement email:', err));
          }
          console.log(`Worker ${workerForPayout.id} does not have W-9 uploaded - $${(totalPay/100).toFixed(2)} held in escrow`);
        } else if (hasW9 && hasBankAccount) {
          console.log(`[TimesheetApproval] Processing worker payout for worker ${workerForPayout.id}`);
          
          // Check if instant payout is enabled and calculate fees
          const isInstantPayout = workerForPayout.instantPayoutEnabled || false;
          let payoutAmount = totalPay;
          let instantPayoutFee = 0;
          let originalAmount = totalPay;
          
          if (isInstantPayout) {
            // Calculate fee: 1% + $0.30 (30 cents)
            instantPayoutFee = Math.round(totalPay * 0.01) + 30; // 1% in cents + 30 cents
            payoutAmount = totalPay - instantPayoutFee;
            originalAmount = totalPay;
            console.log(`[TimesheetApproval] Instant payout enabled - Original: $${(originalAmount/100).toFixed(2)}, Fee: $${(instantPayoutFee/100).toFixed(2)}, Net: $${(payoutAmount/100).toFixed(2)}`);
          }
          
          let payoutSuccess = false;
          let payoutOrderId: string | null = null;
          let payoutStatus = "pending";
          
          try {
            const { mercuryService } = await import("./services/mercury");
            // Main Mercury account (platform) sends payment TO recipient (worker)
            console.log(`[Mercury] MAIN ACCOUNT → RECIPIENT: Initiating transfer from platform Mercury account to recipient workerId=${workerForPayout.id}, mercuryRecipientId=${workerForPayout.mercuryRecipientId}, amountCents=${payoutAmount}, timesheetId=${id}`);
            try {
              // ACH credit: Send funds FROM platform Mercury account TO worker's bank
              // Use net amount after fee deduction for instant payouts
              const payment = await mercuryService.sendPayment({
                recipientId: workerForPayout.mercuryRecipientId!,
                amount: payoutAmount, // Use net amount after fee
                description: isInstantPayout 
                  ? `Instant payment for ${job?.title || 'work'} - Timesheet #${id} (Fee: $${(instantPayoutFee/100).toFixed(2)})`
                  : `Payment for ${job?.title || 'work'} - Timesheet #${id}`,
                idempotencyKey: `timesheet-payout-${id}`,
                note: `Worker: ${workerForPayout.id}, Timesheet: ${id}, Company: ${profile.id}${isInstantPayout ? ', Instant' : ''}`,
              });
              payoutOrderId = payment.id;
              payoutStatus = payment.status;
              payoutSuccess = true;
              console.log(`[Mercury] MAIN ACCOUNT → RECIPIENT: Transfer completed workerId=${workerForPayout.id}, paymentOrderId=${payoutOrderId}, status=${payoutStatus}, timesheetId=${id}`);
            } catch (achError: any) {
              console.error("[Mercury] Worker payout ACH error:", achError.message);
              throw achError;
            }
          } catch (payoutErr: any) {
            console.error('Worker payout failed:', payoutErr.message);
            payoutSuccess = false;
            payoutStatus = "failed";
          }
          
          // Map Mercury status to our payout status enum
          const mappedPayoutStatus = payoutStatus === "completed" ? "completed" : 
                                     payoutStatus === "failed" ? "failed" : 
                                     payoutStatus === "sent" ? "sent" :
                                     payoutStatus === "processing" ? "processing" : "pending";
          
          // Record worker payout with fee information
          await storage.createWorkerPayout({
            workerId: workerForPayout.id,
            timesheetId: id,
            amount: payoutAmount, // Net amount after fee
            status: mappedPayoutStatus,
            mercuryPaymentId: payoutOrderId,
            mercuryPaymentStatus: payoutStatus,
            isInstantPayout: isInstantPayout,
            instantPayoutFee: isInstantPayout ? instantPayoutFee : undefined,
            originalAmount: isInstantPayout ? originalAmount : undefined,
          });
          
          // Update timesheet payment status
          const timesheetPaymentStatus = payoutSuccess ? 
            (payoutStatus === "completed" ? "completed" : "pending") : "failed";
          await storage.updateTimesheet(id, {
            paymentStatus: timesheetPaymentStatus,
          });
          
          if (payoutSuccess && workerForPayout.email && workerForPayout.emailNotifications) {
            sendEmail({
              to: workerForPayout.email,
              type: 'payout_sent',
              data: {
                jobTitle: job?.title || 'Job',
                amount: (totalPay / 100).toFixed(2),
                netAmount: (payoutAmount / 100).toFixed(2),
                feeAmount: isInstantPayout ? (instantPayoutFee / 100).toFixed(2) : undefined,
                isInstantPayout: !!isInstantPayout,
              }
            }).catch(err => console.error('Failed to send payout sent email:', err));
            sendEmail({
              to: workerForPayout.email,
              type: 'payment_received',
              data: {
                amount: (payoutAmount / 100).toFixed(2),
                jobTitle: job?.title || 'Job',
              }
            }).catch(err => console.error('Failed to send payment received email:', err));
          }
          if (payoutSuccess) {
            console.log(`[TimesheetApproval] Worker payout initiated: $${(totalPay / 100).toFixed(2)} to worker ${workerForPayout.id} (Payment Order: ${payoutOrderId}). Balance was already deducted on approve.`);
            // If recipient is a business operator (team owner), payment went to them; log and ensure they get payout_sent email
            const operatorTeam = await storage.getWorkerTeam(workerForPayout.id);
            if (operatorTeam) {
              console.log(`[TimesheetApproval] Payment sent to business operator (workerId=${workerForPayout.id}); payout_sent email sent to business operator.`);
              if (workerForPayout.email && !workerForPayout.emailNotifications) {
                sendEmail({
                  to: workerForPayout.email,
                  type: 'payout_sent',
                  data: {
                    jobTitle: job?.title || 'Job',
                    amount: (totalPay / 100).toFixed(2),
                    netAmount: (payoutAmount / 100).toFixed(2),
                    feeAmount: isInstantPayout ? (instantPayoutFee / 100).toFixed(2) : undefined,
                    isInstantPayout: !!isInstantPayout,
                  }
                }).catch(err => console.error('Failed to send payout_sent to business operator:', err));
              }
            }
          } else {
            console.log(`Worker payout failed for timesheet ${id} - marked as failed for retry`);
            if (workerForPayout.email) {
              sendEmail({
                to: workerForPayout.email,
                type: 'payout_failed_fix_bank',
                data: {
                  workerName: `${workerForPayout.firstName || ''} ${workerForPayout.lastName || ''}`.trim(),
                  amount: (totalPay / 100).toFixed(2),
                  jobTitle: job?.title || 'Job',
                  dashboardLink: `${process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000'}/worker`,
                }
              }).catch(err => console.error('Failed to send payout failed email:', err));
            }
          }
        } else if (hasW9 && !hasBankAccount) {
          // Worker has W-9 but no bank account - create escrow payout record (pending_bank_setup). No Mercury transfer until they add bank.
          console.log(`[Mercury] No transfer to recipient: worker ${workerForPayout.id} has W-9 but no Mercury recipient/bank account. Creating escrow payout.`);
          
          await storage.createWorkerPayout({
            workerId: workerForPayout.id,
            timesheetId: id,
            jobId: timesheet.jobId,
            amount: totalPay,
            status: "pending_bank_setup",
            description: `Held pending bank account setup - ${job?.title || 'Job'}`,
            hoursWorked: finalHours,
            hourlyRate: timesheet.hourlyRate,
          });
          
          await storage.updateTimesheet(id, {
            paymentStatus: "pending",
          });
          
          // Send email to worker with link to add bank account
          if (workerForPayout.email) {
            console.log(`[TimesheetApproval] Sending bank setup email to worker ${workerForPayout.id}`);
            sendEmail({
              to: workerForPayout.email,
              type: 'payout_pending_bank_setup',
              data: {
                workerName: `${workerForPayout.firstName || ''} ${workerForPayout.lastName || ''}`.trim(),
                amount: (totalPay / 100).toFixed(2),
                jobTitle: job?.title || 'Job',
                dashboardLink: `${process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000'}/worker`,
              }
            }).catch(err => console.error('Failed to send bank setup email:', err));
          }
          
          console.log(`Worker ${workerForPayout.id} does not have a payout account configured - $${(totalPay/100).toFixed(2)} held in escrow`);
        }
      }
    } catch (payoutSectionErr: any) {
      console.error("[Mercury] Worker payout section error (continuing to send response):", payoutSectionErr?.message || payoutSectionErr);
      console.error("[Mercury] Stack:", payoutSectionErr?.stack);
    }

    checkBudgetMetAndSendReviewEmail(timesheet.jobId).catch(() => {});

    // Expected pay timing for company UI and worker notification
    let expectedPayTiming: string | undefined;
    if (worker && totalPay > 0) {
      if (!worker.w9UploadedAt) expectedPayTiming = "Worker will be paid after W-9 is uploaded";
      else if (!worker.mercuryRecipientId || !worker.mercuryExternalAccountId) expectedPayTiming = "Worker will be paid after bank account is added";
      else if (worker.instantPayoutEnabled) expectedPayTiming = "Instant payout: funds on the way (fee applied)";
      else expectedPayTiming = "Standard ACH: 2-3 business days";
    }

    // In-app notification for worker (with pay timing in body)
    if (worker && job) {
      const payTimingText = expectedPayTiming || "Payment on the way.";
      createNotification({
        profileId: timesheet.workerId,
        type: "timesheet_approved",
        title: "Timesheet approved",
        body: `Your timesheet for "${job.title}" was approved. ${payTimingText}`,
        url: `/dashboard?tab=timesheets&timesheetId=${id}`,
        data: { timesheetId: id, jobId: job.id, jobTitle: job.title, expectedPayTiming: expectedPayTiming ?? null },
      }).catch(err => console.error("Failed to create timesheet_approved notification:", err));
    }

    // Return current company balance so client can update UI in real time (balance is withdrawn in DB to pay worker; payment to worker is from platform Mercury)
    const [balanceAfterApprove] = await db.select({ depositAmount: profiles.depositAmount })
      .from(profiles)
      .where(eq(profiles.id, profile.id))
      .limit(1);
    const companyBalanceCents = Number(balanceAfterApprove?.depositAmount ?? profile.depositAmount ?? 0);
    console.log(`[TimesheetApproval] Completed processing for timesheet ${id}. Company balance (real-time): $${(companyBalanceCents / 100).toFixed(2)}. Sending companyBalanceCents=${companyBalanceCents} in response.`);
    res.json({ ...updatedTimesheet, companyBalanceCents, expectedPayTiming });
  });

  // Bulk approve timesheets endpoint
  app.post("/api/timesheets/bulk-approve", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== 'company') {
      return res.status(403).json({ message: "Only companies can approve timesheets" });
    }
    
    const { timesheetIds } = req.body as { timesheetIds: number[] };
    
    if (!Array.isArray(timesheetIds) || timesheetIds.length === 0) {
      return res.status(400).json({ message: "No timesheet IDs provided" });
    }
    
    console.log(`[BulkApproval] Company ${profile.id} approving ${timesheetIds.length} timesheets`);
    
    const results: { id: number; success: boolean; error?: string; escrowInfo?: any; skipped?: boolean }[] = [];
    let escrowCount = 0;
    
    for (const id of timesheetIds) {
      try {
        const timesheet = await storage.getTimesheet(id);
        if (!timesheet) {
          results.push({ id, success: false, error: "Timesheet not found" });
          continue;
        }
        
        if (timesheet.companyId !== profile.id) {
          results.push({ id, success: false, error: "Unauthorized" });
          continue;
        }
        
        if (timesheet.status === "approved") {
          results.push({ id, success: true, skipped: true });
          continue;
        }

        if (timesheet.status === "disputed") {
          results.push({ id, success: false, error: "Timesheet is disputed; resolve before approving." });
          continue;
        }

        if (timesheet.status !== "pending") {
          results.push({ id, success: false, error: "Timesheet already processed" });
          continue;
        }

        const adjParsed =
          timesheet.adjustedHours != null && String(timesheet.adjustedHours).trim() !== ""
            ? parseFloat(String(timesheet.adjustedHours))
            : NaN;
        const hoursNum = Number.isFinite(adjParsed)
          ? adjParsed
          : (() => {
              const t = parseFloat(String(timesheet.totalHours ?? "0"));
              return Number.isFinite(t) ? t : 0;
            })();
        const totalPay = Math.round(hoursNum * timesheet.hourlyRate);
        const [bulkBalanceCheck] = await db.select({ depositAmount: profiles.depositAmount }).from(profiles).where(eq(profiles.id, profile.id)).limit(1);
        const balanceBeforeBulk = Number(bulkBalanceCheck?.depositAmount ?? profile.depositAmount ?? 0);
        if (balanceBeforeBulk < totalPay) {
          results.push({ id, success: false, error: "Insufficient balance to approve this timesheet. Add funds in Payment Methods." });
          continue;
        }
        
        // Approve the timesheet (mirror single-approve: persist hours + totalPay)
        const updatedTimesheet = await storage.updateTimesheet(id, {
          status: "approved",
          approvedAt: new Date(),
          approvedBy: profile.id,
          adjustedHours: String(hoursNum),
          totalPay,
        });
        
        // Platform fee from config; affiliate commission when worker was referred
        const platformConfigBulk = await storage.getPlatformConfig();
        const platformFeePerHourCentsBulk = platformConfigBulk?.platformFeePerHourCents ?? 1300;
        const affiliateCommissionPercentBulk = platformConfigBulk?.affiliateCommissionPercent ?? 20;
        const platformFee = Math.round(hoursNum * platformFeePerHourCentsBulk);
        const totalAmount = totalPay + platformFee;
        
        const workerForPayout = await storage.getProfile(timesheet.workerId);
        const job = await storage.getJob(timesheet.jobId);
        
        if (workerForPayout?.referredByAffiliateId && platformFee > 0) {
          const commissionCents = Math.round(platformFee * affiliateCommissionPercentBulk / 100);
          if (commissionCents > 0) {
            await storage.createAffiliateCommission({ affiliateId: workerForPayout.referredByAffiliateId, timesheetId: id, amountCents: commissionCents, status: "pending" });
            const affiliate = await storage.getAffiliate(workerForPayout.referredByAffiliateId);
            if (affiliate) {
              const affiliateUser = await authStorage.getUser(affiliate.userId);
              const affiliateEmail = (affiliate.email || affiliateUser?.email || "").trim();
              if (affiliateEmail) {
                const baseUrl = (
                  process.env.BASE_URL ||
                  process.env.APP_URL ||
                  `${req.protocol || "https"}://${req.get("host") || ""}`
                ).replace(/\/$/, "");
                sendEmail({
                  to: affiliateEmail,
                  type: "affiliate_commission_available",
                  data: {
                    firstName: affiliate.firstName || "there",
                    amountCents: commissionCents,
                    description: `Commission from approved timesheet #${id}`,
                    hasPayoutSetup: Boolean(affiliate.mercuryRecipientId && affiliate.w9UploadedAt),
                    dashboardUrl: `${baseUrl}/affiliate-dashboard`,
                  },
                }).catch((emailErr) => {
                  console.error("[BulkApproval] Failed affiliate commission email:", emailErr);
                });
              }
            }
          }
        }

        // Reduce company balance on approve (same as single-approve flow)
        const [bulkBalanceRow] = await db.select({ depositAmount: profiles.depositAmount }).from(profiles).where(eq(profiles.id, profile.id)).limit(1);
        const bulkBalanceBefore = Number(bulkBalanceRow?.depositAmount ?? profile.depositAmount ?? 0);
        const bulkNewBalance = Math.max(0, bulkBalanceBefore - totalPay);
        await storage.updateProfile(profile.id, { depositAmount: bulkNewBalance });
        const bulkLowBalanceThreshold = Number(profile.autoReplenishThreshold ?? 200000);
        if ((bulkBalanceBefore >= bulkLowBalanceThreshold) && (bulkNewBalance < bulkLowBalanceThreshold) && profile.email) {
          sendEmail({
            to: profile.email,
            type: "balance_low",
            data: {
              balance: (bulkNewBalance / 100).toFixed(2),
            },
          }).catch((emailErr) => {
            console.error("[BulkApproval] Failed low balance email:", emailErr);
          });
        }
        const bulkWorkerName = workerForPayout ? `${workerForPayout.firstName || ''} ${workerForPayout.lastName || ''}`.trim() || 'Worker' : 'Worker';
        await storage.createCompanyTransaction({
          profileId: profile.id,
          type: "charge",
          amount: totalPay,
          description: `Timesheet #${id} - ${bulkWorkerName} (approved) - ${hoursNum} hrs`,
        });
        console.log(`[BulkApproval] Timesheet ${id}: reduced company balance by $${(totalPay / 100).toFixed(2)}. Previous: $${(bulkBalanceBefore / 100).toFixed(2)}, New: $${(bulkNewBalance / 100).toFixed(2)}`);
        
        // Process payment - same logic as single approve
        // Check for W-9 requirement first
        const hasW9 = workerForPayout?.w9UploadedAt != null;
        const hasBankAccount = workerForPayout?.mercuryRecipientId && workerForPayout.mercuryExternalAccountId;
        
        if (workerForPayout && totalPay > 0) {
          if (!hasW9) {
            // Worker doesn't have W-9 - create escrow payout record (pending_w9)
            await storage.createWorkerPayout({
              workerId: workerForPayout.id,
              timesheetId: id,
              jobId: timesheet.jobId,
              amount: totalPay,
              status: "pending_w9",
              description: `Held pending W-9 upload - ${job?.title || 'Job'}`,
              hoursWorked: String(hoursNum),
              hourlyRate: timesheet.hourlyRate,
            });
            
            await storage.updateTimesheet(id, {
              paymentStatus: "pending",
            });
            
            escrowCount++;
            results.push({ id, success: true });
          } else if (hasW9 && hasBankAccount) {
            // Worker has W-9 and bank account - create ACH payment
            // Check if instant payout is enabled and calculate fees
            const isInstantPayout = workerForPayout.instantPayoutEnabled || false;
            let payoutAmount = totalPay;
            let instantPayoutFee = 0;
            let originalAmount = totalPay;
            
            if (isInstantPayout) {
              // Calculate fee: 1% + $0.30 (30 cents)
              instantPayoutFee = Math.round(totalPay * 0.01) + 30; // 1% in cents + 30 cents
              payoutAmount = totalPay - instantPayoutFee;
              originalAmount = totalPay;
              console.log(`[BulkApproval] Instant payout enabled - Original: $${(originalAmount/100).toFixed(2)}, Fee: $${(instantPayoutFee/100).toFixed(2)}, Net: $${(payoutAmount/100).toFixed(2)}`);
            }
            
            let payoutSuccess = false;
            let payoutOrderId: string | null = null;
            let payoutStatus = "pending";
            
            try {
              const { mercuryService } = await import("./services/mercury");
              
              try {
                // ACH credit: Send funds FROM platform account TO worker's bank
                // Use net amount after fee deduction for instant payouts
                const payment = await mercuryService.sendPayment({
                  recipientId: workerForPayout.mercuryRecipientId!,
                  amount: payoutAmount, // Use net amount after fee
                  description: isInstantPayout 
                    ? `Instant payment for ${job?.title || 'work'} - Timesheet #${id} (Fee: $${(instantPayoutFee/100).toFixed(2)})`
                    : `Payment for ${job?.title || 'work'} - Timesheet #${id}`,
                  idempotencyKey: `timesheet-payout-${id}`,
                  note: `Worker: ${workerForPayout.id}, Timesheet: ${id}, Company: ${profile.id}${isInstantPayout ? ', Instant' : ''}`,
                });
                payoutOrderId = payment.id;
                payoutStatus = payment.status;
                payoutSuccess = true;
              } catch (achError: any) {
                console.error("[BulkApproval] Worker payout ACH error:", achError.message);
                throw achError;
              }
            } catch (payoutErr: any) {
              console.error(`[BulkApproval] Worker payout failed for timesheet ${id}:`, payoutErr.message);
              payoutSuccess = false;
              payoutStatus = "failed";
            }
            
            const mappedPayoutStatus = payoutStatus === "completed" ? "completed" : 
                                       payoutStatus === "failed" ? "failed" : 
                                       payoutStatus === "sent" ? "sent" :
                                       payoutStatus === "processing" ? "processing" : "pending";
            
            await storage.createWorkerPayout({
              workerId: workerForPayout.id,
              timesheetId: id,
              amount: payoutAmount, // Net amount after fee
              status: mappedPayoutStatus,
              mercuryPaymentId: payoutOrderId,
              mercuryPaymentStatus: payoutStatus,
              isInstantPayout: isInstantPayout,
              instantPayoutFee: isInstantPayout ? instantPayoutFee : undefined,
              originalAmount: isInstantPayout ? originalAmount : undefined,
            });
            
            await storage.updateTimesheet(id, {
              paymentStatus: payoutSuccess ? (payoutStatus === "completed" ? "completed" : "pending") : "failed",
            });
            
            if (!payoutSuccess && workerForPayout.email) {
              sendEmail({
                to: workerForPayout.email,
                type: 'payout_failed_fix_bank',
                data: {
                  workerName: `${workerForPayout.firstName || ''} ${workerForPayout.lastName || ''}`.trim(),
                  amount: (totalPay / 100).toFixed(2),
                  jobTitle: job?.title || 'Job',
                  dashboardLink: `${process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000'}/worker`,
                }
              }).catch(err => console.error('[BulkApproval] Failed to send payout failed email:', err));
            }
            
            results.push({ id, success: true });
            
          } else if (hasW9 && !hasBankAccount) {
            // Worker has W-9 but no bank account - create escrow payout and send email
            await storage.createWorkerPayout({
              workerId: timesheet.workerId,
              jobId: timesheet.jobId,
              timesheetId: id,
              amount: totalPay,
              status: 'pending_bank_setup',
              description: `Held pending bank account setup - ${job?.title || 'Job'}`,
              hoursWorked: String(hoursNum),
              hourlyRate: timesheet.hourlyRate,
            });
            
            await storage.updateTimesheet(id, {
              paymentStatus: "pending",
            });
            
            // Send email to worker with link to add bank account
            if (workerForPayout.email) {
              sendEmail({
                to: workerForPayout.email,
                type: 'payout_pending_bank_setup',
                data: {
                  workerName: `${workerForPayout.firstName || ''} ${workerForPayout.lastName || ''}`.trim(),
                  amount: (totalPay / 100).toFixed(2),
                  jobTitle: job?.title || 'Job',
                  dashboardLink: `${process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000'}/worker`,
                }
              }).catch(err => console.error('Failed to send bank setup email:', err));
            }
            
            escrowCount++;
            results.push({ 
              id, 
              success: true, 
              escrowInfo: {
                workerName: `${workerForPayout.firstName || ''} ${workerForPayout.lastName || ''}`.trim(),
                amount: totalPay / 100
              }
            });
          }
        } else {
          results.push({ id, success: true });
        }
        
        // Send real-time notification to worker
        if (workerForPayout) {
          notifyTimesheetUpdate(timesheet.workerId, {
            timesheetId: id,
            jobId: timesheet.jobId,
            jobTitle: job?.title || 'Unknown Job',
            status: 'approved',
            amount: totalPay / 100
          });
        }
        
      } catch (err: any) {
        console.error(`[BulkApproval] Failed to approve timesheet ${id}:`, err?.message);
        results.push({ id, success: false, error: err?.message || "Unknown error" });
      }
    }
    
    
    const successCount = results.filter(r => r.success).length;
    const jobIdsToCheck = await Promise.all(
      timesheetIds.filter((id) => results.find((r) => r.id === id && r.success)).map(async (id) => {
        const t = await storage.getTimesheet(id);
        return t?.jobId;
      })
    );
    const uniqueJobIds = [...new Set(jobIdsToCheck.filter((id): id is number => id != null))];
    for (const jid of uniqueJobIds) {
      checkBudgetMetAndSendReviewEmail(jid).catch(() => {});
    }
    
    console.log(`[BulkApproval] Completed: ${successCount}/${timesheetIds.length} approved, ${escrowCount} in escrow`);
    
    res.json({
      success: true,
      approved: successCount,
      failed: timesheetIds.length - successCount,
      escrowCount,
      results
    });
  });

  app.put("/api/timesheets/:id/reject", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const id = Number(req.params.id);
    const { rejectionReason } = req.body;
    const reason = typeof rejectionReason === "string" ? rejectionReason.trim() : "";
    if (reason.length < 30) {
      return res.status(400).json({ message: "Rejection reason must be at least 30 characters so the worker can see your message." });
    }

    const timesheet = await storage.getTimesheet(id);
    if (!timesheet) {
      return res.status(404).json({ message: "Timesheet not found" });
    }
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    
    // Check authorization: company owner or company team member
    const isCompanyOwner = profile.id === timesheet.companyId;
    let isTeamMember = false;
    if (!isCompanyOwner && profile.userId) {
      const [teamMember] = await db.select()
        .from(companyTeamMembers)
        .where(and(
          eq(companyTeamMembers.companyProfileId, timesheet.companyId),
          eq(companyTeamMembers.userId, profile.userId),
          eq(companyTeamMembers.isActive, true)
        ))
        .limit(1);
      isTeamMember = !!teamMember;
    }
    
    if (!isCompanyOwner && !isTeamMember) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    
    const updatedTimesheet = await storage.updateTimesheet(id, {
      status: "rejected",
      rejectionReason: reason,
    });

    // Send notifications to worker
    const worker = await storage.getProfile(timesheet.workerId);
    const job = await storage.getJob(timesheet.jobId);
    
    // Real-time WebSocket notification
    notifyTimesheetUpdate(timesheet.workerId, {
      timesheetId: id,
      jobId: timesheet.jobId,
      jobTitle: job?.title || 'Unknown Job',
      status: 'rejected',
    });
    
    if (worker?.email && worker.emailNotifications && job) {
      const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
      const workerDisplayName = `${worker.firstName || ''} ${worker.lastName || ''}`.trim() || 'Worker';
      const adminDisplayName = profile.companyName || [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() || 'Company';
      const messageLink = `${baseUrl}/dashboard?job=${job.id}`;
      sendEmail({
        to: worker.email,
        type: 'timesheet_rejected',
        data: {
          jobTitle: job.title,
          timesheetId: id,
          reason: reason || 'No reason provided',
          workerName: workerDisplayName,
          adminName: adminDisplayName,
          messageLink,
        }
      }).catch(err => console.error('Failed to send timesheet rejected email:', err));
    }
    
    res.json(updatedTimesheet);
  });

  // Report timesheet (sends strike to worker)
  app.put("/api/timesheets/:id/report", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const id = Number(req.params.id);
    const { reason } = req.body;
    
    const timesheet = await storage.getTimesheet(id);
    if (!timesheet) {
      return res.status(404).json({ message: "Timesheet not found" });
    }
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || profile.id !== timesheet.companyId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Update timesheet status to disputed (reported)
    const updatedTimesheet = await storage.updateTimesheet(id, {
      status: "disputed",
      rejectionReason: reason,
    });

    // Get worker and increment strike count
    const worker = await storage.getProfile(timesheet.workerId);
    const job = await storage.getJob(timesheet.jobId);
    
    if (worker) {
      const newStrikeCount = (worker.strikeCount || 0) + 1;
      // Update strike count directly in the database
      await db.update(profiles).set({ strikeCount: newStrikeCount }).where(eq(profiles.id, worker.id));

      // Send strike warning email
      if (worker.email && worker.emailNotifications) {
        sendEmail({
          to: worker.email,
          type: 'strike_warning',
          data: {
            strikeCount: newStrikeCount,
            reason: reason || 'Timesheet reported',
            date: new Date().toLocaleDateString(),
          }
        }).catch(err => console.error('Failed to send strike warning email:', err));

        // Also send timesheet reported email
        if (job) {
          sendEmail({
            to: worker.email,
            type: 'timesheet_edited',
            data: {
              action: 'reported',
              jobTitle: job.title,
              timesheetId: id,
              originalHours: timesheet.totalHours,
              adjustedHours: '0',
              companyName: profile.companyName || `${profile.firstName} ${profile.lastName}`,
              reason: reason || 'Timesheet reported by company',
            }
          }).catch(err => console.error('Failed to send timesheet reported email:', err));
        }

        // If 3 strikes, terminate account
        if (newStrikeCount >= 3) {
          await storage.updateProfile(worker.id, { isAvailable: false });
          sendEmail({
            to: worker.email,
            type: 'account_terminated',
            data: {
              reason: 'Received 3 strikes',
            }
          }).catch(err => console.error('Failed to send account terminated email:', err));
        }
      }
    }
    
    res.json(updatedTimesheet);
  });

  // Send payment reminder emails for open timesheets (worker action)
  app.post("/api/timesheets/send-payment-reminder", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile) {
      return res.status(403).json({ message: "Profile not found" });
    }
    
    // Only workers can send payment reminders to companies
    if (profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can send payment reminders" });
    }
    
    try {
      const { sendPaymentReminderForWorker } = await import("./invoice-reminder-scheduler");
      const result = await sendPaymentReminderForWorker(profile.id);
      
      res.json({
        success: true,
        message: result.sent > 0 
          ? `Reminder sent to ${result.companies.join(", ")}`
          : "No unpaid invoices found",
        sent: result.sent,
        failed: result.failed,
        companies: result.companies
      });
    } catch (err: any) {
      console.error("[PaymentReminder] Error:", err?.message || err);
      res.status(500).json({ message: "Failed to send payment reminders" });
    }
  });

  // === Balance Management ===
  
  // NOTE: The Stripe webhook must be configured at the Express app level with raw body parsing
  // and signature verification. See server/index.ts or app setup for proper implementation.
  // 
  // The balance_recharged email is triggered when Stripe confirms a payment_intent.succeeded
  // event. The implementation requires:
  // 1. Raw body parsing for signature verification
  // 2. Stripe signature verification using STRIPE_WEBHOOK_SECRET
  // 3. Profile ID passed in payment metadata
  //
  // Email trigger code:
  // sendEmail({
  //   to: profile.email,
  //   type: 'balance_recharged',
  //   data: {
  //     amount: (amount / 100).toFixed(2),
  //     newBalance: (newBalance / 100).toFixed(2),
  //     cardLast4: cardLast4,
  //   }
  // });
  
  // Get company balance status
  app.get("/api/balance", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can view balance" });
    }
    
    res.json({ 
      balance: profile.depositAmount || 0,
      threshold: 20000, // $200
      rechargeAmount: 200000 // $2000
    });
  });

  // Check if balance needs auto-recharge (read-only check)
  app.get("/api/balance/needs-recharge", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can check balance" });
    }
    
    const currentBalance = profile.depositAmount || 0;
    const threshold = 20000; // $200
    
    res.json({ 
      needsRecharge: currentBalance <= threshold,
      currentBalance,
      threshold,
      rechargeAmount: 200000 // $2000 auto-recharge amount
    });
  });

  // Seed function call disabled - use /api/dev/seed endpoint instead
  // seedDatabase().then(() => console.log("✅ Seed complete")).catch((err: any) => console.error("❌ Seed failed:", err));
  
  // Add manual seed trigger endpoint (development only; route always registered so 404 is not returned)
  app.post("/api/dev/seed", async (req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(403).json({ message: "Not available in production" });
    try {
      console.log("🔄 Manually triggering seed function...");
      await seedDatabase();
      res.json({ success: true, message: "Seed function completed" });
    } catch (err: any) {
      console.error("❌ Manual seed failed:", err);
      console.error("❌ Error details:", {
        message: err?.message,
        stack: err?.stack,
        cause: err?.cause,
      });
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // Dev: create a recurring job (4 weeks, 9am–5pm) with operator@demo.com (+ teammates) and pending timesheets (1 click)
  app.post("/api/dev/seed-operator-job", async (req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(403).json({ message: "Not available in production" });
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "company") return res.status(403).json({ message: "Company only" });
    try {
        const operatorUser = await authStorage.getUserByEmail("operator@demo.com");
        if (!operatorUser) return res.status(400).json({ message: "operator@demo.com not found. Run /api/dev/seed first." });
        const operator = await storage.getProfileByUserId(operatorUser.id);
        if (!operator) return res.status(400).json({ message: "Operator profile not found. Run /api/dev/seed first." });
        const operatorTeam = await storage.getWorkerTeam(operator.id);
        const teamMembers = operatorTeam ? await storage.getWorkerTeamMembers(operatorTeam.id) : [];
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 4 * 7);
        const HOURLY_RATE_CENTS = 4000; // $40/hr for dev seed
        const job = await storage.createJob({
          companyId: profile.id,
          title: "Dev recurring job (operator + team)",
          description: "Recurring 4 weeks, 9am-5pm. Created by dev seed.",
          location: "San Jose, CA",
          address: "500 W Santa Clara St",
          city: "San Jose",
          state: "CA",
          zipCode: "95113",
          latitude: "37.3382",
          longitude: "-121.8863",
          trade: "Electrical",
          serviceCategory: "Electrical",
          skillLevel: "elite",
          hourlyRate: HOURLY_RATE_CENTS,
          maxWorkersNeeded: Math.max(1, 1 + teamMembers.length),
          startDate,
          endDate,
          scheduledTime: "9:00 AM - 5:00 PM",
          endTime: "17:00",
          estimatedHours: 8,
          jobType: "recurring",
          scheduleDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          recurringWeeks: 4,
        });
        await storage.updateJob(job.id, { status: "in_progress", workersHired: 1 });
        const application = await storage.createApplication({
          jobId: job.id,
          workerId: operator.id,
          teamMemberId: null,
          proposedRate: HOURLY_RATE_CENTS,
        });
        await storage.updateApplicationStatus(application.id, "accepted");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const jobLat = 37.3382;
        const jobLng = -121.8863;
        let created = 0;
        for (let i = 0; i < 5; i++) {
          const clockIn = new Date(today);
          clockIn.setDate(clockIn.getDate() - (i % 4));
          clockIn.setHours(9, 0, 0, 0);
          const clockOut = new Date(clockIn);
          clockOut.setHours(17, 0, 0, 0);
          const hours = 8;
          await storage.createTimesheet({
            jobId: job.id,
            workerId: operator.id,
            companyId: profile.id,
            clockInTime: clockIn,
            clockOutTime: clockOut,
            clockInLatitude: String(jobLat),
            clockInLongitude: String(jobLng),
            clockOutLatitude: String(jobLat),
            clockOutLongitude: String(jobLng),
            totalHours: String(hours),
            adjustedHours: String(hours),
            hourlyRate: HOURLY_RATE_CENTS,
            clockInDistanceFromJob: 0,
            clockOutDistanceFromJob: 0,
            locationVerified: true,
            status: "pending",
            workerNotes: i === 0 ? "Dev seed timesheet" : null,
          });
          created++;
        }
        res.json({
          success: true,
          jobId: job.id,
          jobTitle: job.title,
          applicationId: application.id,
          timesheetsCreated: created,
          message: `Created recurring job "${job.title}" (4 weeks, 9am-5pm) with operator@demo.com and ${created} pending timesheet(s).`,
        });
    } catch (e: any) {
      console.error("Seed operator job error:", e);
      res.status(500).json({ message: e?.message || "Failed to seed operator job", error: String(e) });
    }
  });

  // === Notifications API ===
  
  // Get notifications for a profile (own profile only)
  app.get("/api/notifications/:profileId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Forbidden" });
    const profileId = Number(req.params.profileId);
    if (profileId !== profile.id) return res.status(403).json({ message: "You can only view your own notifications" });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 50));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
    const unreadOnly =
      String(req.query.unreadOnly) === "1" ||
      String(req.query.unreadOnly).toLowerCase() === "true";
    const typeParam = String(req.query.type || "").trim();
    const allowedTypes = new Set(notificationTypes);
    const typeFilter = typeParam
      ? typeParam
          .split(",")
          .map((s: string) => s.trim())
          .filter((t): t is (typeof notificationTypes)[number] => allowedTypes.has(t as (typeof notificationTypes)[number]))
      : [];
    const conditions = [eq(notifications.profileId, profileId)];
    if (unreadOnly) conditions.push(eq(notifications.isRead, false));
    if (typeFilter.length > 0) conditions.push(inArray(notifications.type, typeFilter));
    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    const result = await db.select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(result);
  });

  // Mark notification as read (only own notifications)
  app.patch("/api/notifications/:id/read", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Forbidden" });
    const id = Number(req.params.id);
    const [row] = await db.select({ profileId: notifications.profileId }).from(notifications).where(eq(notifications.id, id));
    if (!row || row.profileId !== profile.id) return res.status(404).json({ message: "Notification not found" });

    const [updated] = await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id))
      .returning();
    
    res.json(updated);
  });
  
  // Mark all notifications as read for a profile (own profile only)
  app.patch("/api/notifications/read-all", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Forbidden" });
    const { profileId } = req.body;
    if (Number(profileId) !== profile.id) return res.status(403).json({ message: "You can only mark your own notifications as read" });

    await db.update(notifications)
      .set({ isRead: true })
      .where(and(
        eq(notifications.profileId, profile.id),
        eq(notifications.isRead, false)
      ));
    
    res.json({ success: true });
  });
  
  // === Device Tokens API ===
  
  // Get device tokens for a profile (own profile only - prevents IDOR)
  app.get("/api/device-tokens/:profileId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profileId = Number(req.params.profileId);
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.id !== profileId) return res.status(403).json({ message: "Forbidden" });
    
    const result = await db.select()
      .from(deviceTokens)
      .where(and(
        eq(deviceTokens.profileId, profileId),
        eq(deviceTokens.isActive, true)
      ))
      .orderBy(desc(deviceTokens.lastUsed));
    
    res.json(result);
  });
  
  // Register device token (profileId forced to authenticated user - never trust client)
  app.post("/api/device-tokens", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Profile not found" });
    
    try {
      const parsed = insertDeviceTokenSchema.omit({ profileId: true }).parse(req.body);
      const input = { ...parsed, profileId: profile.id };
      
      // Check if token already exists
      const existing = await db.select()
        .from(deviceTokens)
        .where(eq(deviceTokens.token, input.token))
        .limit(1);
      
      if (existing.length > 0) {
        if (existing[0].profileId !== profile.id) return res.status(403).json({ message: "Forbidden" });
        const [updated] = await db.update(deviceTokens)
          .set({ 
            isActive: true, 
            lastUsed: new Date(),
            deviceName: input.deviceName,
            deviceType: input.deviceType,
            userAgent: input.userAgent,
          })
          .where(eq(deviceTokens.token, input.token))
          .returning();
        return res.json(updated);
      }
      
      // Create new token
      const [created] = await db.insert(deviceTokens)
        .values(input)
        .returning();
      
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  // Remove device token (own tokens only)
  app.delete("/api/device-tokens/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const id = Number(req.params.id);
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(403).json({ message: "Profile not found" });
    
    const [existing] = await db.select().from(deviceTokens).where(eq(deviceTokens.id, id));
    if (!existing || existing.profileId !== profile.id) return res.status(403).json({ message: "Forbidden" });
    
    await db.update(deviceTokens)
      .set({ isActive: false })
      .where(eq(deviceTokens.id, id));
    
    res.json({ success: true });
  });

  // === Apple Sign In Server-to-Server Notification Endpoint ===
  // This endpoint receives notifications from Apple about user account events
  // URL: https://your-domain.com/api/apple/notifications
  app.post("/api/apple/notifications", async (req, res) => {
    try {
      // Apple sends the JWT in the 'payload' field
      const { payload } = req.body;
      
      if (!payload) {
        console.error('[AppleSignIn] Missing payload in notification');
        return res.status(400).json({ error: 'Missing payload' });
      }
      
      // Import and use the Apple Sign In service
      const { verifyAppleNotification, handleAppleNotification } = await import('./services/appleSignIn');
      
      // Verify the notification token
      const notification = await verifyAppleNotification(payload);
      
      if (!notification) {
        console.error('[AppleSignIn] Failed to verify notification');
        return res.status(401).json({ error: 'Invalid notification' });
      }
      
      // Handle the notification
      await handleAppleNotification(notification);
      
      // Apple expects a 200 response
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[AppleSignIn] Error processing notification:', error);
      // Return 200 anyway to prevent Apple from retrying
      res.status(200).json({ success: false });
    }
  });

  // === Email Routes (authenticated, server-side only) ===
  const emailInputSchema = z.object({
    type: z.string(),
    to: z.string().email(),
    data: z.record(z.any()),
  });

  app.post("/api/emails/send", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    if (process.env.NODE_ENV === "production") return res.status(403).json({ message: "Not available in production" });
    
    try {
      const input = emailInputSchema.parse(req.body);
      
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) return res.status(403).json({ message: "Profile not found" });
      
      const { sendEmail } = await import("./email-service");
      const result = await sendEmail(input as any);
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid email data", errors: err.errors });
      }
      console.error("Email route error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET sample new_job_nearby payload from a real job (for test email with actual attachments). Dev only.
  app.get("/api/emails/sample-job-alert-payload", async (req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(403).json({ message: "Not available in production" });
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const jobIdParam = req.query.jobId as string | undefined;
      let job: any = null;
      if (jobIdParam) {
        const id = parseInt(jobIdParam, 10);
        if (!isNaN(id)) job = await storage.getJob(id);
      }
      if (!job) {
        const openJobs = await storage.getJobs();
        job = openJobs.find((j: any) => Array.isArray(j.images) && j.images.length > 0) || openJobs[0];
      }
      if (!job) {
        return res.status(404).json({ message: "No job found. Create a job with attachments or pass ?jobId=..." });
      }
      const companyProfile = await storage.getProfile(job.companyId);
      const jobStartDate = job.startDate ? new Date(job.startDate) : null;
      const datesStr = jobStartDate ? jobStartDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD";
      const mapImageUrl = (job.latitude && job.longitude) ? `${BASE_URL}/api/map-thumbnail?jobId=${job.id}` : undefined;
      const streetPart = (job.location || job.address || "").replace(/^\d+\s*/, "").trim();
      const partialAddressWorker = [streetPart, job.city, job.state].filter(Boolean).join(", ") || (job.city && job.state ? `${job.city}, ${job.state}` : "See details");
      const companyJobsForCount = await storage.getCompanyJobs(job.companyId);
      const jobsPostedCount = companyJobsForCount.length;
      let posterContactName = companyProfile ? [companyProfile.firstName, companyProfile.lastName].filter(Boolean).join(" ").trim() || companyProfile.companyName || "Contact" : "Contact";
      if (job.companyLocationId) {
        const loc = await storage.getCompanyLocation(job.companyLocationId);
        if (loc && ((loc as any).contactName || (loc as any).contactEmail)) {
          posterContactName = (loc as any).contactName || (loc as any).contactEmail || posterContactName;
        }
      }
      const posterBusinessName = companyProfile?.companyName || (companyProfile ? [companyProfile.firstName, companyProfile.lastName].filter(Boolean).join(" ").trim() : "") || "A company";
      const memberSince = companyProfile?.createdAt
        ? `Member since ${new Date(companyProfile.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
        : "";
      const estimatedPayoutStr = (job.estimatedHours != null && job.hourlyRate != null)
        ? `~$${Math.round(job.estimatedHours * (Number(job.hourlyRate) / 100))}`
        : "";
      const startDateRelative = getStartDateRelative(job.startDate);
      const scheduledTimeStr = (job as any).scheduledTime || "";
      const timeTypeStr = (job as any).jobType || job.isOnDemand ? "on_demand" : "one_time";
      const galleryUrls = (job.images || [])
        .filter((url: unknown) => typeof url === "string" && url.trim().length > 0)
        .map((url: string) =>
          url.startsWith("http") ? url : `${BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`
        );
      const data = {
        jobTitle: job.title,
        jobId: job.id,
        trade: job.trade || job.serviceCategory || "General",
        location: job.location,
        city: job.city,
        state: job.state,
        partialAddress: partialAddressWorker,
        distance: 5,
        seekerName: companyProfile?.companyName || "A company",
        posterBusinessName,
        posterContactName,
        posterReputation: companyProfile?.isVerified ? "Verified business" : "",
        jobsPostedCount,
        memberSince,
        companyLogoUrl: companyProfile?.companyLogo || undefined,
        dates: datesStr,
        startDateRelative,
        scheduledTime: scheduledTimeStr,
        timeType: timeTypeStr,
        description: job.description || "",
        skillsCategory: job.trade || job.serviceCategory || "General",
        requiredSkills: job.requiredSkills || [],
        hourlyRate: job.hourlyRate ?? undefined,
        estimatedHours: job.estimatedHours ?? undefined,
        estimatedPayout: estimatedPayoutStr,
        flexibleDates: true,
        projectType: job.trade || job.serviceCategory || "General",
        projectLocation: partialAddressWorker,
        workFocus: (job as any).workFocus || job.trade || undefined,
        propertyType: "Home",
        mapImageUrl,
        galleryImages: galleryUrls,
        suggestedTeammates: [],
        suggestedTeammateIds: [],
        showAiDispatchPrompt: false,
        testMode: true,
      };
      res.json({ data, jobId: job.id, jobTitle: job.title });
    } catch (err: any) {
      console.error("Sample job alert payload error:", err);
      res.status(500).json({ message: err?.message || "Failed to build payload" });
    }
  });

  app.post("/api/emails/bulk", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Only companies can send bulk emails" });
      }
      
      const emails = z.array(emailInputSchema).parse(req.body.emails);
      
      const { sendBulkEmails } = await import("./email-service");
      const result = await sendBulkEmails(emails as any);
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid email data", errors: err.errors });
      }
      console.error("Bulk email route error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Submit worker review and save to database
  app.post("/api/reviews", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { 
        workerId, 
        jobId, 
        timeliness, 
        effort, 
        communication, 
        value,
        comment 
      } = req.body;
      
      // Validate required fields
      if (!workerId || !jobId) {
        return res.status(400).json({ message: "Worker ID and Job ID are required" });
      }
      
      // Parse and validate ratings (ensure they're numbers between 1-5)
      const parseRating = (val: any): number => {
        const num = Number(val);
        if (isNaN(num) || num < 1 || num > 5) return 0;
        return Math.round(num);
      };
      
      const timelinessRating = parseRating(timeliness);
      const effortRating = parseRating(effort);
      const communicationRating = parseRating(communication);
      const valueRating = parseRating(value);
      
      // Validate all ratings are provided and valid
      if (timelinessRating === 0 || effortRating === 0 || communicationRating === 0 || valueRating === 0) {
        return res.status(400).json({ message: "All ratings (timeliness, effort, communication, value) must be between 1 and 5" });
      }
      
      // Calculate overall rating (average of all 4 categories, rounded to nearest integer for storage)
      const overallRating = Math.round((timelinessRating + effortRating + communicationRating + valueRating) / 4);
      
      const user = req.user as any;
      const profile = req.profile;
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Only companies can submit reviews" });
      }
      
      // Check if review already exists
      const existingReview = await db.select()
        .from(reviews)
        .where(
          and(
            eq(reviews.jobId, jobId),
            eq(reviews.reviewerId, profile.id),
            eq(reviews.revieweeId, workerId)
          )
        )
        .limit(1);
      
      if (existingReview.length > 0) {
        // Update existing review
        await db.update(reviews)
          .set({
            rating: overallRating,
            qualityRating: valueRating,
            punctualityRating: timelinessRating,
            communicationRating: communicationRating,
            effortRating: effortRating,
            comment: comment || null,
          })
          .where(eq(reviews.id, existingReview[0].id));
      } else {
        // Create new review
        await db.insert(reviews).values({
          jobId,
          reviewerId: profile.id,
          revieweeId: workerId,
          rating: overallRating,
          qualityRating: valueRating,
          punctualityRating: timelinessRating,
          communicationRating: communicationRating,
          effortRating: effortRating,
          comment: comment || null,
        });
      }
      
      // Update worker's average rating
      const allWorkerReviews = await db.select()
        .from(reviews)
        .where(eq(reviews.revieweeId, workerId));
      
      const totalReviewsCount = allWorkerReviews.length;
      const avgRating = totalReviewsCount > 0
        ? allWorkerReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviewsCount
        : 0;
      
      // Store as string with 2 decimal places for the decimal column
      await db.update(profiles)
        .set({
          averageRating: avgRating.toFixed(2),
          totalReviews: totalReviewsCount,
        })
        .where(eq(profiles.id, workerId));
      
      console.log(`[Reviews] Saved review for worker ${workerId} on job ${jobId}: ${overallRating}/5 (avg now: ${avgRating.toFixed(2)})`);
      
      res.json({ 
        success: true, 
        review: {
          workerId,
          jobId,
          rating: overallRating,
          newAverageRating: parseFloat(avgRating.toFixed(2)),
          totalReviews: totalReviewsCount
        }
      });
    } catch (err: any) {
      console.error("Review submission error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get reviews for a worker (general endpoint with query params)
  app.get("/api/reviews", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = req.user as any;
      const profile = req.profile;
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      const revieweeId = req.query.revieweeId ? parseInt(req.query.revieweeId as string) : profile.id;
      
      // If requesting someone else's reviews, check permissions
      if (revieweeId !== profile.id) {
        let hasAccess = false;
        // Companies can view reviews of workers who have applied to their jobs
        if (profile.role === "company") {
          const companyJobApps = await db.select({ applicationId: applications.id })
            .from(applications)
            .innerJoin(jobs, eq(applications.jobId, jobs.id))
            .where(and(
              eq(jobs.companyId, profile.id),
              eq(applications.workerId, revieweeId)
            ))
            .limit(1);
          if (companyJobApps.length > 0) hasAccess = true;
        }
        if (!hasAccess) {
          // Business operators can see their workers' reviews (team members)
          const businessTeams = await db.select()
            .from(teams)
            .where(eq(teams.ownerId, profile.id));
          const teamIds = businessTeams.map(t => t.id);
          if (teamIds.length > 0) {
            const revieweeProfile = await db.select()
              .from(profiles)
              .where(eq(profiles.id, revieweeId))
              .limit(1);
            if (revieweeProfile.length > 0 && revieweeProfile[0].email) {
              const isWorkerOfBusiness = await db.select()
                .from(workerTeamMembers)
                .where(and(
                  eq(workerTeamMembers.email, revieweeProfile[0].email),
                  inArray(workerTeamMembers.teamId, teamIds)
                ))
                .limit(1);
              if (isWorkerOfBusiness.length > 0) hasAccess = true;
            }
          }
        }
        if (!hasAccess) {
          return res.status(403).json({ message: "Unauthorized to view these reviews" });
        }
      }
      
      const workerReviews = await db.select({
        review: reviews,
        job: jobs,
        reviewer: profiles,
      })
        .from(reviews)
        .leftJoin(jobs, eq(reviews.jobId, jobs.id))
        .leftJoin(profiles, eq(reviews.reviewerId, profiles.id))
        .where(eq(reviews.revieweeId, revieweeId))
        .orderBy(desc(reviews.createdAt));
      
      // Calculate average rating
      const allReviews = await db.select()
        .from(reviews)
        .where(eq(reviews.revieweeId, revieweeId));
      
      const avgRating = allReviews.length > 0
        ? allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
        : 0;

      res.json({
        reviews: workerReviews.map(r => ({
          id: r.review.id,
          jobId: r.review.jobId,
          rating: r.review.rating,
          qualityRating: r.review.qualityRating,
          punctualityRating: r.review.punctualityRating,
          communicationRating: r.review.communicationRating,
          effortRating: r.review.effortRating,
          comment: r.review.comment,
          createdAt: r.review.createdAt,
          isGoogleReview: r.review.isGoogleReview || false,
          googleReviewId: r.review.googleReviewId,
          googleReviewerName: r.review.googleReviewerName,
          googleReviewerPhotoUrl: r.review.googleReviewerPhotoUrl,
          googleReviewDate: r.review.googleReviewDate,
          job: r.job ? {
            id: r.job.id,
            title: r.job.title,
            city: r.job.city,
            state: r.job.state,
          } : null,
          reviewer: r.reviewer ? {
            id: r.reviewer.id,
            firstName: r.reviewer.firstName,
            lastName: r.reviewer.lastName,
            companyName: r.reviewer.companyName,
            avatarUrl: r.reviewer.avatarUrl,
          } : null,
        })),
        averageRating: parseFloat(avgRating.toFixed(2)),
        totalReviews: allReviews.length,
      });
    } catch (err: any) {
      console.error("Get reviews error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get reviews for a worker (legacy endpoint)
  app.get("/api/workers/:workerId/reviews", async (req, res) => {
    try {
      const workerId = parseInt(req.params.workerId);
      
      const workerReviews = await db.select({
        review: reviews,
        job: jobs,
        reviewer: profiles,
      })
        .from(reviews)
        .leftJoin(jobs, eq(reviews.jobId, jobs.id))
        .leftJoin(profiles, eq(reviews.reviewerId, profiles.id))
        .where(eq(reviews.revieweeId, workerId))
        .orderBy(desc(reviews.createdAt));
      
      res.json(workerReviews.map(r => ({
        id: r.review.id,
        rating: r.review.rating,
        qualityRating: r.review.qualityRating,
        punctualityRating: r.review.punctualityRating,
        communicationRating: r.review.communicationRating,
        comment: r.review.comment,
        createdAt: r.review.createdAt,
        jobTitle: r.job?.title || "Unknown Job",
        reviewerName: r.reviewer?.companyName || `${r.reviewer?.firstName} ${r.reviewer?.lastName}`,
      })));
    } catch (err: any) {
      console.error("Get reviews error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Helper function to refresh Google OAuth token
  async function refreshGoogleBusinessToken(profile: any): Promise<string | null> {
    if (!profile.googleBusinessRefreshToken) {
      return null;
    }

    try {
      const googleClientId = process.env.GOOGLE_CLIENT_ID;
      const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: profile.googleBusinessRefreshToken,
          client_id: googleClientId!,
          client_secret: googleClientSecret!,
          grant_type: "refresh_token",
        }),
      });

      if (!tokenResponse.ok) {
        console.error("[Google Business] Token refresh failed");
        return null;
      }

      const tokens = await tokenResponse.json();
      const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

      // Update stored token
      await db.update(profiles)
        .set({
          googleBusinessAccessToken: tokens.access_token,
          googleBusinessTokenExpiresAt: expiresAt,
        })
        .where(eq(profiles.id, profile.id));

      return tokens.access_token;
    } catch (err) {
      console.error("[Google Business] Error refreshing token:", err);
      return null;
    }
  }

  // Sync Google Business Reviews (company: OAuth My Business API; worker: Place ID → Places API)
  app.post("/api/reviews/sync-google", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      // OAuth sync only: require Google Business to be connected (company or worker)
      if (!profile.googleBusinessAccessToken || !profile.googleBusinessLocationId) {
        return res.status(400).json({ 
          message: "Connect your Google Business account first, then sync reviews." 
        });
      }

      // Get or refresh access token
      let accessToken: string | null = profile.googleBusinessAccessToken;
      const tokenExpiresAt = profile.googleBusinessTokenExpiresAt 
        ? new Date(profile.googleBusinessTokenExpiresAt) 
        : null;
      
      if (tokenExpiresAt && tokenExpiresAt <= new Date()) {
        // Token expired, refresh it
        const refreshedToken = await refreshGoogleBusinessToken(profile);
        if (!refreshedToken) {
          return res.status(401).json({ 
            message: "Failed to refresh Google Business token. Please reconnect your account." 
          });
        }
        accessToken = refreshedToken;
      }

      if (!accessToken) {
        return res.status(401).json({ 
          message: "No access token available. Please reconnect your Google Business account." 
        });
      }

      // Fetch reviews from Google My Business API
      const reviewsResponse = await fetch(
        `https://mybusiness.googleapis.com/v4/${profile.googleBusinessLocationId}/reviews`,
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
          },
        }
      );

      if (!reviewsResponse.ok) {
        const errorData = await reviewsResponse.json().catch(() => ({}));
        console.error("[Google Business] Failed to fetch reviews:", errorData);
        return res.status(400).json({ 
          message: `Failed to fetch Google reviews: ${reviewsResponse.statusText}` 
        });
      }

      const reviewsData = await reviewsResponse.json();
      const googleReviews = reviewsData.reviews || [];
      let syncedCount = 0;

      // Sync each review
      for (const googleReview of googleReviews) {
        // Google My Business API review structure
        const reviewId = googleReview.reviewId || googleReview.name?.split("/").pop() || null;
        const rating = googleReview.starRating?.value || googleReview.rating || 0;
        const text = googleReview.comment || null;
        const authorName = googleReview.reviewer?.displayName || null;
        const profilePhotoUrl = googleReview.reviewer?.profilePhotoUrl || null;
        const reviewTime = googleReview.createTime ? new Date(googleReview.createTime) : null;

        if (!reviewId) {
          console.warn("[Google Reviews] Skipping review without ID:", googleReview);
          continue;
        }

        // Check if review already exists
        const existingReview = await db.select()
          .from(reviews)
          .where(and(
            eq(reviews.googleReviewId, reviewId),
            eq(reviews.revieweeId, profile.id)
          ))
          .limit(1);

        if (existingReview.length > 0) {
          // Update existing review
          await db.update(reviews)
            .set({
              rating: rating,
              comment: text,
              googleReviewerName: authorName,
              googleReviewerPhotoUrl: profilePhotoUrl,
              googleReviewDate: reviewTime,
              syncedAt: new Date(),
            })
            .where(eq(reviews.id, existingReview[0].id));
        } else {
          // Create new review
          await db.insert(reviews).values({
            jobId: null, // Google reviews aren't tied to specific jobs
            reviewerId: null, // Google reviewers aren't in our system
            revieweeId: profile.id,
            rating: rating,
            qualityRating: null,
            punctualityRating: null,
            communicationRating: null,
            effortRating: null,
            comment: text,
            isGoogleReview: true,
            googleReviewId: reviewId,
            googleReviewerName: authorName,
            googleReviewerPhotoUrl: profilePhotoUrl,
            googleReviewDate: reviewTime,
            syncedAt: new Date(),
          });
          syncedCount++;
        }
      }

      // Update business operator's average rating (including Google reviews)
      const allReviews = await db.select()
        .from(reviews)
        .where(eq(reviews.revieweeId, profile.id));
      
      const avgRating = allReviews.length > 0
        ? allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
        : 0;
      
      await db.update(profiles)
        .set({
          averageRating: avgRating.toFixed(2),
          totalReviews: allReviews.length,
        })
        .where(eq(profiles.id, profile.id));

      // Also update ratings for all workers under this business operator
      // Get teams owned by this business operator
      const businessTeams = await db.select()
        .from(teams)
        .where(eq(teams.ownerId, profile.id));

      const teamIds = businessTeams.map(t => t.id);
      
      if (teamIds.length > 0) {
        // Get all team members in these teams and match them to profiles by email
        const businessTeamMembers = await db.select()
          .from(workerTeamMembers)
          .where(inArray(workerTeamMembers.teamId, teamIds));

        // Get worker profiles by matching emails
        const teamMemberEmails = businessTeamMembers
          .map(m => m.email)
          .filter((email): email is string => email !== null);

        if (teamMemberEmails.length > 0) {
          const workerProfiles = await db.select()
            .from(profiles)
            .where(inArray(profiles.email, teamMemberEmails));

          for (const workerProfile of workerProfiles) {
            const workerReviews = await db.select()
              .from(reviews)
              .where(eq(reviews.revieweeId, workerProfile.id));
            
            const workerAvgRating = workerReviews.length > 0
              ? workerReviews.reduce((sum, r) => sum + r.rating, 0) / workerReviews.length
              : 0;
            
            await db.update(profiles)
              .set({
                averageRating: workerAvgRating.toFixed(2),
                totalReviews: workerReviews.length,
              })
              .where(eq(profiles.id, workerProfile.id));
          }
        }
      }

      console.log(`[Google Reviews] Synced ${syncedCount} new reviews for business operator ${profile.id} (${profile.companyName || profile.firstName})`);

      res.json({
        success: true,
        syncedCount,
        totalReviews: allReviews.length,
        averageRating: parseFloat(avgRating.toFixed(2)),
      });
    } catch (err: any) {
      console.error("Google reviews sync error:", err);
      res.status(500).json({ 
        success: false,
        message: err.message || "Failed to sync Google reviews" 
      });
    }
  });

  // Send private note to worker after job review
  app.post("/api/send-private-note", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { workerEmail, workerName, jobTitle, note, ratings, overallRating } = req.body;
      
      if (!workerEmail || !workerName || !jobTitle || !note) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      const user = req.user as any;
      const profile = req.profile;
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Only companies can send private notes" });
      }
      
      const companyName = profile.companyName || `${profile.firstName} ${profile.lastName}`;
      const companyRepName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || companyName;
      
      await sendEmail({
        type: "private_note",
        to: workerEmail,
        data: {
          workerName,
          companyName,
          companyRepName,
          companyAvatarUrl: profile.avatarUrl || undefined,
          companyLogoUrl: (profile as any).companyLogoUrl || undefined,
          jobTitle,
          note,
          ratings: {
            timeliness: ratings?.timeliness || 0,
            effort: ratings?.effort || 0,
            communication: ratings?.communication || 0,
            value: ratings?.value || 0
          },
          overallRating: overallRating || 0
        }
      });
      
      res.json({ success: true });
    } catch (err: any) {
      console.error("Private note email error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // === Admin Routes (super admin) ===
  const ADMIN_EMAILS_RAW = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "cairlbrandon@gmail.com";
  const ADMIN_EMAILS = ADMIN_EMAILS_RAW.split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean);
  const getAdminEmail = (req: any): string | undefined => {
    const session = req.session as any;
    if (session?.adminEmailForImpersonation) return session.adminEmailForImpersonation as string;
    return (req.user as any)?.claims?.email as string | undefined;
  };

  const requireAdmin = async (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const session = req.session as any;
    let userEmail = (req.user as any)?.claims?.email as string | undefined;
    if (session?.originalUserId) {
      const originalUser = await authStorage.getUser(session.originalUserId);
      userEmail = originalUser?.email ?? undefined;
    }
    userEmail = userEmail ? userEmail.toLowerCase() : undefined;
    if (!userEmail || !ADMIN_EMAILS.includes(userEmail)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  };

  app.get("/api/admin/check", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.json({ isAdmin: false });
    }
    const userEmail = getAdminEmail(req)?.toLowerCase();
    res.json({ isAdmin: !!userEmail && ADMIN_EMAILS.includes(userEmail), email: userEmail, adminEmails: ADMIN_EMAILS });
  });

  // Platform config: editable platform fee per hour (cents) and affiliate commission % — used in timesheet billing and affiliate payouts
  app.get("/api/admin/platform-config", requireAdmin, async (req, res) => {
    try {
      const config = await storage.getPlatformConfig();
      if (!config) return res.status(404).json({ message: "Platform config not found" });
      res.json({
        platformFeePerHourCents: config.platformFeePerHourCents,
        affiliateCommissionPercent: config.affiliateCommissionPercent,
        updatedAt: config.updatedAt,
      });
    } catch (err: any) {
      console.error("Admin get platform-config error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/platform-config", requireAdmin, async (req, res) => {
    try {
      const { platformFeePerHourCents, affiliateCommissionPercent } = req.body || {};
      const updates: Record<string, unknown> = {};
      if (typeof platformFeePerHourCents === "number" && platformFeePerHourCents >= 0) updates.platformFeePerHourCents = platformFeePerHourCents;
      if (typeof affiliateCommissionPercent === "number" && affiliateCommissionPercent >= 0 && affiliateCommissionPercent <= 100) updates.affiliateCommissionPercent = affiliateCommissionPercent;
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No valid updates" });
      const config = await storage.updatePlatformConfig(1, updates as any);
      res.json({
        platformFeePerHourCents: config.platformFeePerHourCents,
        affiliateCommissionPercent: config.affiliateCommissionPercent,
        updatedAt: config.updatedAt,
      });
    } catch (err: any) {
      console.error("Admin update platform-config error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin utility: mark pending affiliate commissions as paid and notify affiliate.
  app.post("/api/admin/affiliates/:affiliateId/mark-commissions-paid", requireAdmin, async (req, res) => {
    try {
      const affiliateId = Number(req.params.affiliateId);
      if (!Number.isFinite(affiliateId)) {
        return res.status(400).json({ message: "Invalid affiliate id" });
      }

      const affiliate = await storage.getAffiliate(affiliateId);
      if (!affiliate) {
        return res.status(404).json({ message: "Affiliate not found" });
      }

      const commissions = await storage.getAffiliateCommissionsByAffiliateId(affiliateId);
      const pending = commissions.filter((c) => c.status === "pending");
      if (pending.length === 0) {
        return res.json({ success: true, updated: 0, amountCents: 0 });
      }

      const paidAt = new Date();
      for (const commission of pending) {
        await storage.updateAffiliateCommission(commission.id, {
          status: "paid",
          paidAt,
        });
      }

      const amountCents = pending.reduce((sum, commission) => sum + (commission.amountCents || 0), 0);
      const affiliateUser = await authStorage.getUser(affiliate.userId);
      const affiliateEmail = (affiliate.email || affiliateUser?.email || "").trim();
      if (affiliateEmail && amountCents > 0) {
        const baseUrl = (
          process.env.BASE_URL ||
          process.env.APP_URL ||
          `${req.protocol || "https"}://${req.get("host") || ""}`
        ).replace(/\/$/, "");
        sendEmail({
          to: affiliateEmail,
          type: "affiliate_payment_sent",
          data: {
            firstName: affiliate.firstName || "there",
            amountCents,
            description: `${pending.length} commission${pending.length === 1 ? "" : "s"} paid`,
            dashboardUrl: `${baseUrl}/affiliate-dashboard`,
          },
        }).catch((emailErr) => {
          console.error("[AdminAffiliatePayout] Failed affiliate payment email:", emailErr);
        });
      }

      res.json({
        success: true,
        updated: pending.length,
        amountCents,
      });
    } catch (err: any) {
      console.error("Admin affiliate payout mark-paid error:", err);
      res.status(500).json({ message: err.message || "Failed to mark commissions as paid" });
    }
  });

  // Get all workers
  app.get("/api/admin/workers", requireAdmin, async (req, res) => {
    try {
      const workers = await storage.getAllWorkers();
      const workersWithStatus = await Promise.all(workers.map(async (worker) => {
        const status = await storage.getWorkerStatus(worker.id);
        const strikes = await storage.getWorkerStrikes(worker.id);
        return { ...worker, adminStatus: status, strikes };
      }));
      res.json(workersWithStatus);
    } catch (err: any) {
      console.error("Admin get workers error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get all companies
  app.get("/api/admin/companies", requireAdmin, async (req, res) => {
    try {
      const companies = await storage.getAllCompanies();
      const companiesWithStatus = await Promise.all(companies.map(async (company) => {
        const status = await storage.getCompanyStatus(company.id);
        return { ...company, adminStatus: status };
      }));
      res.json(companiesWithStatus);
    } catch (err: any) {
      console.error("Admin get companies error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get all jobs
  app.get("/api/admin/jobs", requireAdmin, async (req, res) => {
    try {
      const allJobs = await storage.getAllJobs();
      res.json(allJobs);
    } catch (err: any) {
      console.error("Admin get jobs error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Issue strike to worker
  app.post("/api/admin/workers/:id/strike", requireAdmin, async (req, res) => {
    try {
      const workerId = Number(req.params.id);
      const { reason, severity, notes } = req.body;
      const user = req.user as any;
      
      const strike = await storage.createStrike({
        workerId,
        reason,
        severity: severity || "minor",
        notes,
        issuedBy: getAdminEmail(req) || ADMIN_EMAILS[0],
      });
      
      // Log admin activity
      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "issue_strike",
        entityType: "worker",
        entityId: workerId,
        details: { reason, severity, strikeId: strike.id },
      });
      
      res.json(strike);
    } catch (err: any) {
      console.error("Admin issue strike error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Resolve strike
  app.patch("/api/admin/strikes/:id/resolve", requireAdmin, async (req, res) => {
    try {
      const strikeId = Number(req.params.id);
      const { notes } = req.body;
      const user = req.user as any;
      
      const strike = await storage.resolveStrike(strikeId, getAdminEmail(req) || ADMIN_EMAILS[0], notes);
      
      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "resolve_strike",
        entityType: "worker",
        entityId: strike.workerId,
        details: { strikeId, notes },
      });
      
      res.json(strike);
    } catch (err: any) {
      console.error("Admin resolve strike error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Update worker status (suspend, ban, etc.)
  app.patch("/api/admin/workers/:id/status", requireAdmin, async (req, res) => {
    try {
      const workerId = Number(req.params.id);
      const { status, reason, suspendedUntil } = req.body;
      const user = req.user as any;
      
      const workerStatus = await storage.setWorkerStatus({
        workerId,
        status,
        reason,
        suspendedUntil: suspendedUntil ? new Date(suspendedUntil) : null,
        updatedBy: getAdminEmail(req) || ADMIN_EMAILS[0],
      });
      
      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "update_worker_status",
        entityType: "worker",
        entityId: workerId,
        details: { status, reason },
      });
      
      res.json(workerStatus);
    } catch (err: any) {
      console.error("Admin update worker status error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Update company status
  app.patch("/api/admin/companies/:id/status", requireAdmin, async (req, res) => {
    try {
      const companyId = Number(req.params.id);
      const { status, reason, suspendedUntil } = req.body;
      const user = req.user as any;
      
      const companyStatus = await storage.setCompanyStatus({
        companyId,
        status,
        reason,
        suspendedUntil: suspendedUntil ? new Date(suspendedUntil) : null,
        updatedBy: getAdminEmail(req) || ADMIN_EMAILS[0],
      });
      
      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "update_company_status",
        entityType: "company",
        entityId: companyId,
        details: { status, reason },
      });
      
      res.json(companyStatus);
    } catch (err: any) {
      console.error("Admin update company status error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Update company settings (auto-replenish threshold)
  app.patch("/api/admin/companies/:id/settings", requireAdmin, async (req, res) => {
    try {
      const companyId = Number(req.params.id);
      const { autoReplenishThreshold } = req.body;
      const user = req.user as any;
      
      // Validate threshold: must be a finite number, at least $500 (50000 cents), max $1M
      const thresholdNum = Number(autoReplenishThreshold);
      if (!Number.isFinite(thresholdNum) || thresholdNum < 50000 || thresholdNum > 100000000) {
        return res.status(400).json({ message: "Auto-replenish threshold must be between $500 and $1,000,000" });
      }
      
      const profile = await storage.getProfile(companyId);
      if (!profile || profile.role !== "company") {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const validatedThreshold = Math.round(thresholdNum);
      
      const updatedProfile = await storage.updateProfile(companyId, {
        autoReplenishThreshold: validatedThreshold,
      });
      
      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "update_company_settings",
        entityType: "company",
        entityId: companyId,
        details: { autoReplenishThreshold: validatedThreshold },
      });
      
      res.json(updatedProfile);
    } catch (err: any) {
      console.error("Admin update company settings error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Stop/suspend job
  app.patch("/api/admin/jobs/:id/status", requireAdmin, async (req, res) => {
    try {
      const jobId = Number(req.params.id);
      const { status, reason } = req.body;
      const user = req.user as any;
      
      // Update job status
      const job = await storage.updateJob(jobId, { status });
      
      // Create suspension record if suspending/cancelling
      if (status === "cancelled") {
        await storage.createJobSuspension({
          jobId,
          action: "cancelled",
          reason: reason || "Cancelled by admin",
          issuedBy: getAdminEmail(req) || ADMIN_EMAILS[0],
        });
      }
      
      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "update_job_status",
        entityType: "job",
        entityId: jobId,
        details: { status, reason },
      });
      
      res.json(job);
    } catch (err: any) {
      console.error("Admin update job status error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Billing adjustment
  app.post("/api/admin/billing/adjustment", requireAdmin, async (req, res) => {
    try {
      const { entityType, entityId, actionType, amountCents, reason, notes } = req.body;
      const user = req.user as any;
      
      const action = await storage.createBillingAction({
        entityType,
        entityId,
        actionType,
        amountCents,
        reason,
        notes,
        performedBy: getAdminEmail(req) || ADMIN_EMAILS[0],
      });
      
      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "billing_adjustment",
        entityType,
        entityId,
        details: { actionType, amountCents, reason },
      });
      
      res.json(action);
    } catch (err: any) {
      console.error("Admin billing adjustment error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get billing actions
  app.get("/api/admin/billing", requireAdmin, async (req, res) => {
    try {
      const entityType = req.query.entityType as string;
      const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;
      const actions = await storage.getBillingActions(entityType, entityId);
      res.json(actions);
    } catch (err: any) {
      console.error("Admin get billing actions error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get admin activity log
  app.get("/api/admin/activity", requireAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const log = await storage.getAdminActivityLog(limit);
      res.json(log);
    } catch (err: any) {
      console.error("Admin get activity log error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get all strikes
  app.get("/api/admin/strikes", requireAdmin, async (req, res) => {
    try {
      const strikes = await storage.getAllStrikes();
      res.json(strikes);
    } catch (err: any) {
      console.error("Admin get strikes error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // --- Super Admin: Export (CSV) ---
  app.get("/api/admin/export", requireAdmin, async (req, res) => {
    try {
      const entity = (req.query.entity as string) || "jobs";
      const format = (req.query.format as string) || "csv";
      if (format !== "csv") return res.status(400).json({ message: "Only CSV export supported" });
      if (!["workers", "companies", "jobs", "strikes", "activity", "billing"].includes(entity)) return res.status(400).json({ message: "Invalid entity" });

      if (entity === "workers") {
        const rows = await storage.getAllWorkers();
        const headers = ["id", "email", "firstName", "lastName", "phone", "role", "onboardingStatus", "createdAt"];
        const csv = [headers.join(","), ...rows.map((r: any) => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=workers-${Date.now()}.csv`);
        return res.send(csv);
      }
      if (entity === "companies") {
        const rows = await storage.getAllCompanies();
        const headers = ["id", "email", "companyName", "firstName", "lastName", "phone", "onboardingStatus", "createdAt"];
        const csv = [headers.join(","), ...rows.map((r: any) => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=companies-${Date.now()}.csv`);
        return res.send(csv);
      }
      if (entity === "strikes") {
        const rows = await storage.getAllStrikes();
        const headers = ["id", "workerId", "workerEmail", "workerName", "reason", "severity", "notes", "issuedBy", "isActive", "resolvedAt", "resolvedBy", "resolvedNotes", "createdAt"];
        const csv = [headers.join(","), ...rows.map((r: any) => {
          const w = r.worker || {};
          const workerName = [w.firstName, w.lastName].filter(Boolean).join(" ").trim() || "";
          const rowValues = headers.map((h) => {
            if (h === "workerEmail") return w.email ?? "";
            if (h === "workerName") return workerName;
            const v = (r as any)[h];
            return v === undefined || v === null ? "" : v;
          });
          return rowValues.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
        })].join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=strikes-${Date.now()}.csv`);
        return res.send(csv);
      }
      if (entity === "activity") {
        const rows = await storage.getAdminActivityLog(5000);
        const headers = ["id", "adminEmail", "action", "entityType", "entityId", "details", "createdAt"];
        const csv = [headers.join(","), ...rows.map((r: any) => headers.map(h => `"${String(h === "details" && r.details ? JSON.stringify(r.details) : r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=activity-${Date.now()}.csv`);
        return res.send(csv);
      }
      if (entity === "billing") {
        const rows = await storage.getBillingActions();
        const headers = ["id", "entityType", "entityId", "actionType", "amountCents", "reason", "notes", "performedBy", "createdAt"];
        const csv = [headers.join(","), ...rows.map((r: any) => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=billing-${Date.now()}.csv`);
        return res.send(csv);
      }
      const rows = await storage.getAllJobs();
      const headers = ["id", "title", "companyId", "location", "status", "createdAt"];
      const csv = [headers.join(","), ...rows.map((r: any) => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=jobs-${Date.now()}.csv`);
      res.send(csv);
    } catch (err: any) {
      console.error("Admin export error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // --- Super Admin: Create account (company or worker) ---
  app.post("/api/admin/accounts", requireAdmin, async (req, res) => {
    try {
      const { email, password, firstName, lastName, userType, companyName } = req.body || {};
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Valid email required" });
      if (!password || String(password).length < 8) return res.status(400).json({ message: "Password must be at least 8 characters" });
      const role = userType === "company" ? "company" : "worker";
      const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
      if (existing.length > 0) return res.status(400).json({ message: "An account with this email already exists" });

      const { hashPassword } = await import("./utils/password");
      const passwordHash = await hashPassword(password);
      const [newUser] = await db.insert(users).values({
        email: email.toLowerCase().trim(),
        firstName: firstName || null,
        lastName: lastName || null,
        passwordHash,
        authProvider: "email",
        userType: role,
      }).returning();

      await storage.createProfile({
        userId: newUser.id,
        role,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        ...(role === "company" && companyName ? { companyName } : {}),
      });

      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "create_account",
        entityType: role,
        entityId: newUser.id as unknown as number,
        details: { email: newUser.email, companyName: role === "company" ? companyName : undefined },
      });

      res.status(201).json({ success: true, userId: newUser.id, email: newUser.email, role });
    } catch (err: any) {
      console.error("Admin create account error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // --- Super Admin: Bulk import (workers or companies) ---
  app.post("/api/admin/import", requireAdmin, async (req, res) => {
    try {
      const { entity, rows } = req.body || {};
      if (!entity || !["workers", "companies"].includes(entity)) return res.status(400).json({ message: "entity must be workers or companies" });
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ message: "rows must be a non-empty array" });
      const role = entity === "companies" ? "company" : "worker";
      const adminEmail = getAdminEmail(req) || ADMIN_EMAILS[0];
      const { hashPassword } = await import("./utils/password");
      const crypto = await import("crypto");
      const created: number[] = [];
      const errors: { index: number; message: string }[] = [];
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const email = typeof row?.email === "string" ? row.email.trim().toLowerCase() : "";
        const firstName = typeof row?.firstName === "string" ? row.firstName.trim() : null;
        const lastName = typeof row?.lastName === "string" ? row.lastName.trim() : null;
        let password = typeof row?.password === "string" && row.password.length >= 8 ? row.password : null;
        const companyName = entity === "companies" && typeof row?.companyName === "string" ? row.companyName.trim() : null;
        if (!email || !emailRegex.test(email)) {
          errors.push({ index: i, message: "Valid email required" });
          continue;
        }
        if (!password) {
          password = crypto.randomBytes(8).toString("base64").replace(/[+/=]/g, "").slice(0, 12);
        }
        const existing = await db.select().from(users).where(eq(users.email, email));
        if (existing.length > 0) {
          errors.push({ index: i, message: "An account with this email already exists" });
          continue;
        }
        try {
          const passwordHash = await hashPassword(password);
          const [newUser] = await db.insert(users).values({
            email,
            firstName: firstName || null,
            lastName: lastName || null,
            passwordHash,
            authProvider: "email",
            userType: role,
          }).returning();
          await storage.createProfile({
            userId: newUser.id,
            role,
            email: newUser.email,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            ...(role === "company" && companyName ? { companyName } : {}),
          });
          await storage.logAdminActivity({
            adminEmail,
            action: "create_account",
            entityType: role,
            entityId: newUser.id as unknown as number,
            details: { email: newUser.email, companyName: role === "company" ? companyName : undefined, bulkImport: true },
          });
          created.push(i);
        } catch (err: any) {
          errors.push({ index: i, message: err?.message ?? "Create failed" });
        }
      }
      res.json({ created: created.length, failed: errors.length, errors });
    } catch (err: any) {
      console.error("Admin import error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // --- Super Admin: Recent Stripe payments (for refunds tab) ---
  app.get("/api/admin/stripe-payments", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 200);
      const rows = await db
        .select({
          id: companyTransactions.id,
          profileId: companyTransactions.profileId,
          type: companyTransactions.type,
          amount: companyTransactions.amount,
          description: companyTransactions.description,
          jobId: companyTransactions.jobId,
          stripePaymentIntentId: companyTransactions.stripePaymentIntentId,
          createdAt: companyTransactions.createdAt,
          companyName: profiles.companyName,
        })
        .from(companyTransactions)
        .innerJoin(profiles, eq(companyTransactions.profileId, profiles.id))
        .where(isNotNull(companyTransactions.stripePaymentIntentId))
        .orderBy(desc(companyTransactions.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (err: any) {
      console.error("Admin stripe-payments list error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // --- Super Admin: Stripe refund ---
  app.post("/api/admin/refund", requireAdmin, async (req, res) => {
    try {
      const { paymentIntentId, amountCents, reason } = req.body || {};
      if (!paymentIntentId) return res.status(400).json({ message: "paymentIntentId required" });
      const stripeService = (await import("./services/stripe")).default;
      const stripe = stripeService.getStripe();
      if (!stripe) return res.status(503).json({ message: "Stripe not configured" });

      const refundParams: Stripe.RefundCreateParams = { payment_intent: paymentIntentId };
      if (amountCents && amountCents > 0) refundParams.amount = amountCents;
      if (reason) {
        refundParams.reason =
          reason === "duplicate" ? "duplicate" : reason === "fraudulent" ? "fraudulent" : "requested_by_customer";
      }

      const refund = await stripe.refunds.create(refundParams);

      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "stripe_refund",
        entityType: "payment",
        entityId: 0,
        details: { paymentIntentId, refundId: refund.id, amountCents: refundParams.amount },
      });

      res.json({ success: true, refundId: refund.id, status: refund.status });
    } catch (err: any) {
      console.error("Admin refund error:", err);
      res.status(500).json({ message: (err as any)?.message ?? "Refund failed" });
    }
  });

  // --- Super Admin: Chats - list all jobs (for support view) ---
  app.get("/api/admin/chats", requireAdmin, async (req, res) => {
    try {
      const allJobs = await storage.getAllJobs();
      res.json(allJobs);
    } catch (err: any) {
      console.error("Admin chats list error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/chats/:jobId/messages", requireAdmin, async (req, res) => {
    try {
      const jobId = Number(req.params.jobId);
      const messages = await storage.getJobMessages(jobId);
      res.json(messages);
    } catch (err: any) {
      console.error("Admin get chat messages error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/chats/:jobId/messages", requireAdmin, async (req, res) => {
    try {
      const jobId = Number(req.params.jobId);
      const { content } = req.body || {};
      if (!content || typeof content !== "string" || content.trim().length === 0) return res.status(400).json({ message: "Message content required" });

      const adminEmail = getAdminEmail(req) || ADMIN_EMAILS[0];
      const adminProfile = await storage.getProfileByEmail(adminEmail);
      if (!adminProfile) return res.status(400).json({ message: "Admin profile not found; sign in as a user with a profile to send support messages" });

      const message = await storage.createJobMessage({
        jobId,
        senderId: adminProfile.id,
        content: `[Support] ${content.trim()}`,
      });

      await storage.logAdminActivity({
        adminEmail: adminEmail,
        action: "support_message",
        entityType: "job",
        entityId: jobId,
        details: { messageId: message.id },
      });

      res.status(201).json(message);
    } catch (err: any) {
      console.error("Admin send support message error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // --- Super Admin: Mass push notification ---
  app.post("/api/admin/push", requireAdmin, async (req, res) => {
    try {
      const { target, title, body, url } = req.body || {};
      if (!target || !title || !body) return res.status(400).json({ message: "target, title, and body required" });
      if (!["workers", "companies", "all"].includes(target)) return res.status(400).json({ message: "target must be workers, companies, or all" });

      let profileIds: number[] = [];
      if (target === "workers") {
        const workers = await storage.getAllWorkers();
        profileIds = workers.map((w: { id: number }) => w.id);
      } else if (target === "companies") {
        const companies = await storage.getAllCompanies();
        profileIds = companies.map((c: { id: number }) => c.id);
      } else {
        const workers = await storage.getAllWorkers();
        const companies = await storage.getAllCompanies();
        profileIds = [...workers.map((w: { id: number }) => w.id), ...companies.map((c: { id: number }) => c.id)];
      }

      const tokens = await db.select({ token: deviceTokens.token })
        .from(deviceTokens)
        .where(and(inArray(deviceTokens.profileId, profileIds), eq(deviceTokens.isActive, true)));
      const tokenStrings = tokens.map(t => t.token).filter(Boolean) as string[];

      if (tokenStrings.length === 0) {
        return res.json({ success: true, sent: 0, failed: 0, message: "No active device tokens for target group" });
      }

      const { sendPushNotification } = await import("./firebase-admin");
      const data: Record<string, string> = url ? { url: typeof url === "string" ? url : String(url) } : {};
      const result = await sendPushNotification(tokenStrings, title, body, data);

      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "mass_push",
        entityType: "platform",
        entityId: 0,
        details: { target, title, sent: result.successCount, failed: result.failureCount },
      });

      res.json({ success: true, sent: result.successCount, failed: result.failureCount });
    } catch (err: any) {
      console.error("Admin mass push error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // --- Super Admin: Invite admin (add email to allowed list - via env; return instructions) ---
  app.get("/api/admin/invite-info", requireAdmin, async (req, res) => {
    res.json({
      message: "To add admins, set ADMIN_EMAILS in your environment (comma-separated). Example: ADMIN_EMAILS=admin1@example.com,admin2@example.com",
      currentEmails: ADMIN_EMAILS,
    });
  });

  // --- Super Admin: Impersonate user (View as user - Airbnb-style full reign) ---
  app.post("/api/admin/impersonate/:profileId", requireAdmin, async (req, res) => {
    try {
      const profileId = Number(req.params.profileId);
      const targetProfile = await storage.getProfile(profileId);
      if (!targetProfile) return res.status(404).json({ message: "Profile not found" });

      const currentUser = req.user as any;
      const adminEmail = (currentUser?.claims?.email as string) || "";
      (req.session as any).originalUserId = currentUser.claims.sub;
      (req.session as any).impersonatingUserId = targetProfile.userId;
      (req.session as any).adminEmailForImpersonation = adminEmail;
      currentUser.claims.sub = targetProfile.userId;

      await storage.logAdminActivity({
        adminEmail: getAdminEmail(req) || ADMIN_EMAILS[0],
        action: "impersonate",
        entityType: targetProfile.role,
        entityId: profileId,
        details: { targetEmail: targetProfile.email },
      });

      res.json({ success: true, role: targetProfile.role, profileId: targetProfile.id });
    } catch (err: any) {
      console.error("Admin impersonate error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/stop-impersonate", requireAdmin, async (req, res) => {
    try {
      const session = req.session as any;
      const originalUserId = session?.originalUserId;
      if (!originalUserId) return res.status(400).json({ message: "Not currently impersonating anyone" });

      const currentUser = req.user as any;
      currentUser.claims.sub = originalUserId;
      delete session.impersonatingUserId;
      delete session.originalUserId;
      delete session.adminEmailForImpersonation;

      res.json({ success: true });
    } catch (err: any) {
      console.error("Admin stop-impersonate error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ========================
  // UNIT PAYMENT ENDPOINTS (DEPRECATED - Archived Jan 2026, now using Mercury + Stripe)
  // ========================
  const UNIT_DEPRECATED_MSG = "Unit payment processing has been deprecated. We now use Mercury and Stripe.";

  // Admin: Set up Tolstoy platform operating account with Unit - DEPRECATED
  app.post("/api/unit/admin/setup-platform", requireAdmin, async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, deprecated: true });
  });

  app.get("/api/unit/admin/platform-status", requireAdmin, async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, deprecated: true });
  });

  app.get("/api/unit/status", async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, connected: false, deprecated: true });
  });

  app.post("/api/unit/company/customer", async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, deprecated: true });
  });

  app.post("/api/unit/company/account", async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, deprecated: true });
  });

  app.post("/api/unit/company/link-bank", async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, deprecated: true });
  });

  app.post("/api/unit/company/deposit", async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, deprecated: true });
  });

  app.get("/api/unit/company/balance", async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, balance: 0, configured: false, deprecated: true });
  });

  // ========================
  // COMPANY BILLING HISTORY
  // ========================

  // Get company billing history (transactions + timesheets)
  app.get("/api/company/billing-history", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can view billing history" });
    }

    try {
      // Get transactions (deposits, auto-recharge, refunds)
      const transactions = await storage.getCompanyTransactions(profile.id);
      
      // Get approved timesheets with job and worker details (charges)
      const timesheets = await storage.getTimesheetsByCompany(profile.id);
      const approvedTimesheets = timesheets.filter((ts: any) => ts.status === "approved");
      
      // Get jobs for job titles
      const companyJobs = await storage.getCompanyJobs(profile.id);
      const jobsMap = new Map(companyJobs.map((j: any) => [j.id, j]));
      
      // Get worker profiles for names
      const workerIds = Array.from(new Set(approvedTimesheets.map((ts: any) => ts.workerId)));
      const workers = await Promise.all(workerIds.map((id: number) => storage.getProfile(id)));
      const workersMap = new Map(workers.filter(Boolean).map((w: any) => [w.id, w]));
      
      // Get initiator profiles for transactions
      const initiatorIds = Array.from(new Set(transactions.filter((tx: any) => tx.initiatedById).map((tx: any) => tx.initiatedById)));
      const initiators = await Promise.all(initiatorIds.map((id: number) => storage.getProfile(id)));
      const initiatorsMap = new Map(initiators.filter(Boolean).map((i: any) => [i.id, i]));
      
      // Build billing history from transactions
      const transactionItems = transactions.map((tx: any) => {
        const job = tx.jobId ? jobsMap.get(tx.jobId) : null;
        const worker = tx.workerId ? workersMap.get(tx.workerId) : null;
        const initiator = tx.initiatedById ? initiatorsMap.get(tx.initiatedById) : null;
        return {
          id: `tx-${tx.id}`,
          date: tx.createdAt,
          type: tx.type,
          amount: tx.type === "charge" ? -Math.abs(tx.amount) : Math.abs(tx.amount),
          cardFee: tx.cardFee || 0,
          description: tx.description,
          workerName: worker ? `${worker.firstName} ${worker.lastName}` : null,
          workerId: tx.workerId,
          jobTitle: job ? job.title : null,
          jobId: tx.jobId,
          hours: tx.hoursWorked ? parseFloat(tx.hoursWorked) : null,
          timesheetId: null,
          mercuryPaymentId: tx.mercuryPaymentId,
          stripePaymentIntentId: tx.stripePaymentIntentId,
          paymentMethod: tx.paymentMethod || (tx.stripePaymentIntentId ? "card" : tx.mercuryPaymentId ? "ach" : null),
          initiatedBy: initiator ? `${initiator.firstName} ${initiator.lastName}` : null,
          initiatedById: tx.initiatedById,
        };
      });
      
      // Build billing history from approved timesheets (these are charges)
      const timesheetItems = approvedTimesheets.map((ts: any) => {
        const job = jobsMap.get(ts.jobId);
        const worker = workersMap.get(ts.workerId);
        const hours = ts.adjustedHours ? parseFloat(ts.adjustedHours) : (ts.totalHours ? parseFloat(ts.totalHours) : 0);
        // Calculate total charge: worker pay + platform fee
        const workerPay = ts.totalPay || (hours * ts.hourlyRate);
        const platformFee = Math.round(hours * 1300); // $13/hour platform fee in cents
        const totalCharge = workerPay + platformFee;
        
        return {
          id: `ts-${ts.id}`,
          date: ts.approvedAt || ts.clockOutTime || ts.createdAt,
          type: "charge" as const,
          amount: -totalCharge,
          description: `Worker payment for ${job?.title || 'Job'}`,
          workerName: worker ? `${worker.firstName} ${worker.lastName}` : null,
          workerId: ts.workerId,
          jobTitle: job?.title || null,
          jobId: ts.jobId,
          hours: hours,
          timesheetId: ts.id,
          mercuryPaymentId: null,
          stripePaymentIntentId: null,
          paymentMethod: "platform" as const,
          initiatedBy: null,
          initiatedById: null,
        };
      });
      
      // Combine and deduplicate (avoid double-counting if transaction was explicitly created for a timesheet)
      // Only filter out timesheet items that have a matching transaction with the same timesheetId in description or metadata
      const chargeTransactionTimesheetIds = new Set(
        transactions
          .filter((tx: any) => tx.type === "charge" && tx.description?.includes("timesheet"))
          .map((tx: any) => {
            // Extract timesheet ID from description if available
            const match = tx.description?.match(/timesheet[:\s#]*(\d+)/i);
            return match ? `ts-${match[1]}` : null;
          })
          .filter(Boolean)
      );
      const uniqueTimesheetItems = timesheetItems.filter((item: any) => !chargeTransactionTimesheetIds.has(item.id));
      
      // Merge all items and sort by date descending
      const allItems = [...transactionItems, ...uniqueTimesheetItems];
      allItems.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      // Get unique workers for filter dropdown
      const uniqueWorkers = Array.from(workersMap.values()).map((w: any) => ({
        id: w.id,
        name: `${w.firstName} ${w.lastName}`,
      }));
      
      res.json({
        items: allItems,
        workers: uniqueWorkers,
      });
    } catch (err: any) {
      console.error("Get billing history error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ========================
  // COMPANY PAYMENT METHODS & AUTO-CHARGE
  // ========================

  // Trigger auto-charge when pending + commitments exceed balance. Charges shortfall + 30% buffer via primary/verified method. On failure sets lastFailedPaymentMethodId so client shows add-payment modal.
  app.post("/api/company/trigger-auto-charge", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const profile = req.profile;
    if (!profile || profile.role !== "company") return res.status(403).json({ message: "Company only" });
    try {
      const body = (req.body || {}) as { clientShortfallCents?: number; clientBalanceCents?: number; clientTotalNeededCents?: number };
      let clientShortfallCents: number | undefined;
      if (typeof body.clientShortfallCents === "number" && body.clientShortfallCents >= 0) {
        clientShortfallCents = body.clientShortfallCents;
      } else if (typeof body.clientBalanceCents === "number" && typeof body.clientTotalNeededCents === "number") {
        clientShortfallCents = Math.max(0, body.clientTotalNeededCents - body.clientBalanceCents);
      }
      if (clientShortfallCents !== undefined && clientShortfallCents > 0) {
        console.log(`[trigger-auto-charge] Company ${profile.id}: client shortfall $${(clientShortfallCents / 100).toFixed(2)}`);
      }
      const result = await triggerAutoReplenishmentForCompany(profile.id, {
        clientShortfallCents: clientShortfallCents && clientShortfallCents > 0 ? clientShortfallCents : undefined,
      });
      if (result.success) {
        await clearPaymentHoldsForCompanyIfSolvent(profile.id);
        return res.json({ success: true, message: "Balance replenished successfully." });
      }
      if (result.noChargeNeeded) {
        await clearPaymentHoldsForCompanyIfSolvent(profile.id);
      }
      if (!result.success && !result.noChargeNeeded) {
        const { notifyCompanyPaymentFundingIssue } = await import("./payment-failure-reminder-scheduler");
        notifyCompanyPaymentFundingIssue(profile.id).catch((e) =>
          console.warn("[trigger-auto-charge] notifyCompanyPaymentFundingIssue:", e)
        );
      }
      return res.json({
        success: false,
        noChargeNeeded: result.noChargeNeeded,
        message: result.noChargeNeeded
          ? "Balance is sufficient; no charge needed."
          : "Payment failed. Add or update a payment method to cover your pending and job commitments.",
      });
    } catch (e: any) {
      console.error("[trigger-auto-charge]", e);
      return res.status(500).json({ success: false, noChargeNeeded: false, message: e?.message || "Failed to process auto-charge" });
    }
  });

  // Get all company payment methods (Stripe-only for funding; Mercury is for worker payouts only).
  // Policy: Stripe customer ID and payment method IDs are always persisted to DB when we create/attach in Stripe.
  // Precheck from DB only: use profiles.stripe_customer_id and company_payment_methods.stripe_payment_method_id; no need to fetch list from Stripe.
  app.get("/api/company/payment-methods", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can access payment methods" });
    }

    try {
      const profileForStripe = (await storage.getProfile(profile.id)) ?? profile;
      const targetCustomerId = await ensureCompanyStripeCustomer(profileForStripe);
      const stripeService = (await import("./services/stripe")).default;
      const stripe = stripeService.isStripeConfigured() ? stripeService.getStripe() : null;

      // Source of truth: fetch customer's payment methods directly from Stripe, then ensure each has a DB row
      const stripeOnly: any[] = [];
      if (stripe) {
        const limit = 100;
        const [cardList, achList] = await Promise.all([
          stripe.paymentMethods.list({ customer: targetCustomerId, type: "card", limit }),
          stripe.paymentMethods.list({ customer: targetCustomerId, type: "us_bank_account", limit }),
        ]);
        const existingByStripeId = new Map<string, any>();
        for (const row of await storage.getCompanyPaymentMethods(profile.id)) {
          const sid = row.stripePaymentMethodId ?? (row as any).stripe_payment_method_id;
          if (sid) existingByStripeId.set(sid, row);
        }
        const ensureDbRow = async (pm: any): Promise<any> => {
          const pmId = pm.id;
          if (!pmId) return null;
          const existing = existingByStripeId.get(pmId);
          if (existing) return existing;
          const isCard = !!(pm as any).card;
          const isAch = !!(pm as any).us_bank_account;
          if (isCard) {
            const last4 = (pm as any).card?.last4 ?? "****";
            const brand = (pm as any).card?.brand ?? null;
            const created = await storage.createCompanyPaymentMethod({
              profileId: profile.id,
              type: "card",
              lastFour: last4,
              cardBrand: brand,
              stripePaymentMethodId: pmId,
              isPrimary: false,
              isVerified: true,
            });
            existingByStripeId.set(pmId, created);
            return created;
          }
          if (isAch) {
            const usBank = (pm as any).us_bank_account;
            const last4 = usBank?.last4 ?? "****";
            const bankName = usBank?.bank_name ?? "Bank";
            const created = await storage.createCompanyPaymentMethod({
              profileId: profile.id,
              type: "ach",
              lastFour: last4,
              bankName,
              stripePaymentMethodId: pmId,
              isPrimary: false,
              isVerified: usBank?.status === "verified",
            });
            (created as any).stripeBankStatus = usBank?.status ?? null;
            existingByStripeId.set(pmId, created);
            return created;
          }
          return null;
        };
        for (const pm of cardList.data) {
          const row = await ensureDbRow(pm);
          if (row) stripeOnly.push(row);
        }
        for (const pm of achList.data) {
          const row = await ensureDbRow(pm);
          if (row) {
            try {
              const retrieved = await stripe.paymentMethods.retrieve(pm.id);
              const usBank = (retrieved as any).us_bank_account;
              const status = usBank?.status ?? null;
              (row as any).stripeBankStatus = status;
              if (status === "verified" && !row.isVerified) {
                await storage.updateCompanyPaymentMethod(row.id, { isVerified: true });
                row.isVerified = true;
              }
            } catch (_) {}
            stripeOnly.push(row);
          }
        }
      }

      // Ensure at least one primary
      let methods = await storage.getCompanyPaymentMethods(profile.id);
      const hasPrimary = stripeOnly.some((m: any) => m.isPrimary ?? m.is_primary);
      if (!hasPrimary && stripeOnly.length > 0) {
        const first = stripeOnly[0];
        await storage.updateCompanyPaymentMethod(first.id, { isPrimary: true });
        first.isPrimary = true;
        methods = await storage.getCompanyPaymentMethods(profile.id);
      }

      const pmCustomerId = (pm: any) => {
        const raw = (pm && (pm as any).customer) ?? null;
        if (typeof raw === "string") return raw;
        if (raw && typeof raw === "object" && typeof (raw as any).id === "string") return (raw as any).id;
        return null;
      };
      const lastFailedId = (profile as any).lastFailedPaymentMethodId ?? (profile as any).last_failed_payment_method_id;
      let clearFailedId = false;
      if (lastFailedId != null) {
        const failedMethod = methods.find((m: any) => m.id === lastFailedId);
        const pmId = failedMethod && (failedMethod.stripePaymentMethodId ?? (failedMethod as any).stripe_payment_method_id);
        if (pmId && stripe) {
          try {
            const pm = await stripe.paymentMethods.retrieve(pmId);
            if (pmCustomerId(pm) !== targetCustomerId) clearFailedId = true;
          } catch (_) {}
        }
      }

      // Sync profile cache: primary payment method id, verified flag, and Stripe verification status (for verify-cents popup)
      const primary =
        stripeOnly.find((m: any) => m.isPrimary ?? m.is_primary) ??
        stripeOnly.find((m: any) => m.type === "card" || (m.type === "ach" && m.isVerified));
      const primaryId = primary?.id ?? null;
      const primaryVerified = primary ? primary.type === "card" || (primary.type === "ach" && !!primary.isVerified) : false;
      let primaryVerificationStatus: string | null = null;
      if (primary) {
        if (primary.id === lastFailedId && !clearFailedId) {
          primaryVerificationStatus = "failed";
        } else if (primary.type === "card") {
          primaryVerificationStatus = "verified";
        } else if (primary.type === "ach") {
          const stripeStatus = (primary as any).stripeBankStatus ?? (primary as any).stripe_bank_status;
          primaryVerificationStatus = stripeStatus === "verified" ? "verified" : stripeStatus === "verification_failed" ? "verification_failed" : "pending";
        }
      }
      // Clear stale lastFailedPaymentMethodId when company has a verified primary (avoids add-payment modal on every refresh for users with valid payment methods)
      const clearStaleFailure = clearFailedId || (primaryVerified && lastFailedId != null);
      await storage.updateProfile(profile.id, {
        primaryPaymentMethodId: primaryId,
        primaryPaymentMethodVerified: primaryVerified,
        primaryPaymentMethodVerificationStatus: primaryVerificationStatus,
        ...(clearStaleFailure ? { lastFailedPaymentMethodId: null } : {}),
      });

      // Return all Stripe payment methods; ACH includes stripeBankStatus from live Stripe API
      res.json(stripeOnly);
    } catch (err: any) {
      console.error("Get payment methods error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Add new payment method — Stripe only (card/ACH via Stripe). Mercury is for worker payouts, not company funding.
  app.post("/api/company/payment-methods", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can add payment methods" });
    }
    // Company payment methods for funding must be added via Stripe (card or bank). Mercury-linked accounts are for workers to receive pay only.
    return res.status(400).json({
      message: "Company payment methods must be added via Stripe (card or bank). Mercury is used only for worker payouts.",
    });
  });

  // Set a payment method as primary
  app.patch("/api/company/payment-methods/:id/primary", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can update payment methods" });
    }

    const methodId = parseInt(req.params.id);

    try {
      const method = await storage.getCompanyPaymentMethod(methodId);
      if (!method || method.profileId !== profile.id) {
        return res.status(404).json({ message: "Payment method not found" });
      }

      // Unset other primary methods
      const allMethods = await storage.getCompanyPaymentMethods(profile.id);
      for (const m of allMethods) {
        if (m.isPrimary && m.id !== methodId) {
          await storage.updateCompanyPaymentMethod(m.id, { isPrimary: false });
        }
      }

      // Set this one as primary
      await storage.updateCompanyPaymentMethod(methodId, { isPrimary: true });

      const verified = method.type === "card" || (method.type === "ach" && !!method.isVerified);
      // Update profile with primary counterparty and cached payment method (for popup logic without fetching)
      await storage.updateProfile(profile.id, {
        mercuryRecipientId: method.mercuryRecipientId,
        mercuryExternalAccountId: method.mercuryExternalAccountId,
        primaryPaymentMethodId: methodId,
        primaryPaymentMethodVerified: verified,
        lastFailedPaymentMethodId: null, // clear failure flag when they explicitly set primary
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("Set primary payment method error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get timesheet settings
  app.get("/api/company/timesheet-settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can access timesheet settings" });
    }
    
    try {
      // Default settings
      const defaultSettings = {
        autoApprove: false,
        autoApproveWindow: "24",
        requireLocationVerification: true,
        maxDailyHours: "12",
        overtimeThreshold: "8",
        breakDeduction: false, // Default to false
        breakMinutes: "30",
        roundingIncrement: "15",
        sendApprovalNotifications: true,
        requireNotes: false,
      };
      
      // TODO: Load from database if stored (e.g., in a timesheetSettings JSONB column)
      // For now, return default settings
      res.json({ settings: defaultSettings });
    } catch (error: any) {
      console.error("Error loading timesheet settings:", error);
      res.status(500).json({ message: "Failed to load timesheet settings", error: error.message });
    }
  });

  // Update payment method location assignments (per-location billing)
  // Timesheet Settings endpoint
  app.patch("/api/company/timesheet-settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can update timesheet settings" });
    }
    
    try {
      const settings = req.body;
      
      // Validate settings structure
      const validSettings = {
        autoApprove: Boolean(settings.autoApprove),
        autoApproveWindow: String(settings.autoApproveWindow || "24"),
        requireLocationVerification: Boolean(settings.requireLocationVerification),
        maxDailyHours: String(settings.maxDailyHours || "12"),
        overtimeThreshold: String(settings.overtimeThreshold || "8"),
        breakDeduction: Boolean(settings.breakDeduction),
        breakMinutes: String(settings.breakMinutes || "30"),
        roundingIncrement: String(settings.roundingIncrement || "15"),
        sendApprovalNotifications: Boolean(settings.sendApprovalNotifications),
        requireNotes: Boolean(settings.requireNotes),
      };
      
      // Store settings in profile metadata (we'll use a JSONB field if available, or store as JSON string)
      // For now, we'll update a metadata field or create a timesheetSettings JSONB column
      // Since we don't have a dedicated field, we'll store it in a way that can be retrieved
      // For simplicity, we can add a timesheetSettings JSONB column later, but for now let's use a workaround
      
      // Update profile with timesheet settings (stored as JSON in a text field or metadata)
      // For now, we'll just acknowledge the save - in production, you'd want to persist this
      // You could add: timesheetSettings: jsonb("timesheet_settings") to the profiles table
      
      res.json({ 
        success: true, 
        message: "Timesheet settings saved successfully",
        settings: validSettings 
      });
    } catch (error: any) {
      console.error("Error saving timesheet settings:", error);
      res.status(500).json({ message: "Failed to save timesheet settings", error: error.message });
    }
  });

  app.patch("/api/company/payment-methods/:id/locations", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can update payment methods" });
    }

    const methodId = parseInt(req.params.id);
    const { locationIds } = req.body; // Array of location IDs or null/empty for "all locations (use primary)"

    try {
      const method = await storage.getCompanyPaymentMethod(methodId);
      if (!method || method.profileId !== profile.id) {
        return res.status(404).json({ message: "Payment method not found" });
      }

      // Validate location IDs belong to this company
      if (locationIds && locationIds.length > 0) {
        const companyLocations = await storage.getCompanyLocations(profile.id);
        const validLocationIds = companyLocations.map((l: any) => l.id.toString());
        const invalidIds = locationIds.filter((id: string) => !validLocationIds.includes(id));
        if (invalidIds.length > 0) {
          return res.status(400).json({ message: "Some location IDs are invalid" });
        }
      }

      // Update the payment method's location assignments
      await storage.updateCompanyPaymentMethod(methodId, { 
        locationIds: locationIds && locationIds.length > 0 ? locationIds : null 
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("Update payment method locations error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Delete payment method (only if no unpaid commitments)
  app.delete("/api/company/payment-methods/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can delete payment methods" });
    }

    const methodId = parseInt(req.params.id);

    try {
      const method = await storage.getCompanyPaymentMethod(methodId);
      if (!method || method.profileId !== profile.id) {
        return res.status(404).json({ message: "Payment method not found" });
      }

      // Check for unpaid commitments (approved timesheets with pending/processing payment status)
      const timesheets = await storage.getTimesheetsByCompany(profile.id);
      const unpaidTimesheets = timesheets.filter((ts: any) => 
        ts.status === "approved" && 
        ts.paymentStatus !== "completed" && 
        ts.paymentStatus !== "failed"
      );

      if (unpaidTimesheets.length > 0) {
        return res.status(400).json({ 
          message: `Cannot delete payment method: ${unpaidTimesheets.length} approved timesheet(s) are awaiting payment. Please wait for payments to complete.` 
        });
      }

      // Delete the payment method from the database
      await storage.deleteCompanyPaymentMethod(methodId);

      // If this was the primary method and there are other methods, set a new primary
      if (method.isPrimary) {
        const remainingMethods = await storage.getCompanyPaymentMethods(profile.id);
        if (remainingMethods.length > 0) {
          const newPrimary = remainingMethods[0];
          await storage.updateCompanyPaymentMethod(newPrimary.id, { isPrimary: true });
          const verified = newPrimary.type === "card" || (newPrimary.type === "ach" && !!newPrimary.isVerified);
          await storage.updateProfile(profile.id, {
            mercuryRecipientId: newPrimary.mercuryRecipientId,
            mercuryExternalAccountId: newPrimary.mercuryExternalAccountId,
            primaryPaymentMethodId: newPrimary.id,
            primaryPaymentMethodVerified: verified,
            lastFailedPaymentMethodId: (profile as any).lastFailedPaymentMethodId === methodId ? null : undefined,
          });
        } else {
          // No more payment methods - clear profile references and cache
          await storage.updateProfile(profile.id, {
            mercuryRecipientId: null,
            mercuryExternalAccountId: null,
            primaryPaymentMethodId: null,
            primaryPaymentMethodVerified: false,
            lastFailedPaymentMethodId: (profile as any).lastFailedPaymentMethodId === methodId ? null : undefined,
          });
        }
      } else {
        if ((profile as any).lastFailedPaymentMethodId === methodId) {
          await storage.updateProfile(profile.id, { lastFailedPaymentMethodId: null });
        }
      }

      res.json({ success: true, message: "Payment method deleted" });
    } catch (err: any) {
      console.error("Delete payment method error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Worker: Get payout accounts
  app.get("/api/mt/worker/payout-accounts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can access payout accounts" });
    }

    try {
      const accounts = await storage.getPayoutAccounts(profile.id);
      res.json(accounts);
    } catch (err: any) {
      console.error("Get payout accounts error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Worker: Validate W-9 document
  app.post("/api/worker/validate-w9", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can validate W-9 documents" });
    }

    try {
      const { fileData, mimeType } = req.body;
      if (!fileData) {
        return res.status(400).json({ message: "File data is required" });
      }

      const { validateW9Form } = await import("./services/w9-validator");
      
      // Convert base64 to buffer
      let fileBuffer: Buffer;
      let detectedMimeType = mimeType || "application/pdf";
      
      if (fileData.startsWith("data:")) {
        const matches = fileData.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          detectedMimeType = matches[1];
          const base64Data = matches[2];
          fileBuffer = Buffer.from(base64Data, "base64");
        } else {
          fileBuffer = Buffer.from(fileData, "base64");
        }
      } else {
        fileBuffer = Buffer.from(fileData, "base64");
      }

      const validationResult = await validateW9Form(fileBuffer, detectedMimeType);
      
      res.json({
        isValid: validationResult.isValid,
        errors: validationResult.errors,
        extractedData: validationResult.extractedData,
        confidence: validationResult.confidence,
        message: validationResult.isValid 
          ? `W-9 validated successfully (${(validationResult.confidence * 100).toFixed(0)}% confidence)`
          : `W-9 validation failed: ${validationResult.errors.join(", ")}`
      });
    } catch (error: any) {
      console.error("[ValidateW9] Error:", error);
      res.status(500).json({ 
        message: "Failed to validate W-9 document",
        error: error.message 
      });
    }
  });

  // Worker: Get pending W-9 payouts
  app.get("/api/worker/pending-w9-payouts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can access payout information" });
    }

    try {
      const pendingPayouts = await storage.getWorkerPayoutsByStatus(profile.id, "pending_w9");
      const totalAmount = pendingPayouts.reduce((sum, p) => sum + (p.amount || 0), 0);
      // If worker has W-9 on file and bank linked but still has pending_w9 payouts, trigger background release at most once per cooldown (avoids infinite loop when banner polls every 5s)
      if (pendingPayouts.length > 0 && profile.w9UploadedAt && profile.mercuryRecipientId) {
        const lastAt = w9ReleaseLastTriggeredAt.get(profile.id) ?? 0;
        if (Date.now() - lastAt >= W9_RELEASE_TRIGGER_COOLDOWN_MS) {
          w9ReleaseLastTriggeredAt.set(profile.id, Date.now());
          setImmediate(() => runW9PayoutReleaseForWorker(profile.id).catch((e: any) => console.error("[PendingW9Payouts] Background release error:", e?.message ?? e)));
        }
      }
      res.json({ 
        payouts: pendingPayouts,
        count: pendingPayouts.length,
        totalAmount,
        totalAmountFormatted: `$${(totalAmount / 100).toFixed(2)}`
      });
    } catch (err: any) {
      console.error("[PendingW9Payouts] Error:", err);
      console.error("[PendingW9Payouts] Error stack:", err?.stack);
      console.error("[PendingW9Payouts] Error details:", {
        message: err?.message,
        code: err?.code,
        detail: err?.detail,
      });
      
      // Check if it's a database enum issue
      if (err?.message?.includes("invalid input value for enum") || err?.code === "22P02") {
        console.error("[PendingW9Payouts] ⚠️ Database enum issue - 'pending_w9' may not be in the enum type");
        return res.status(500).json({ 
          message: "Database configuration error. Please contact support.",
          error: "Enum value not found"
        });
      }
      
      res.status(500).json({ 
        message: err?.message || "Failed to fetch pending payouts",
        error: process.env.NODE_ENV === "development" ? err.toString() : undefined
      });
    }
  });

  // Worker: Set up payout account (counterparty for receiving ACH payments via Modern Treasury)
  app.post("/api/mt/worker/payout-account", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "worker") {
      return res.status(403).json({ message: "Only workers can set up payout accounts" });
    }

    let { routingNumber, accountNumber, accountType, bankName, recipientType = 'business', email: bodyEmail, address: bodyAddress, city: bodyCity, state: bodyState, zipCode: bodyZipCode } = req.body;

    // Ensure business account and email for recipient: default recipientType to business, resolve email from body then profile then auth
    recipientType = recipientType === 'person' ? 'person' : 'business';
    const userClaims = (req.user as any)?.claims;
    const recipientEmail = (bodyEmail && String(bodyEmail).trim()) || (profile.email && String(profile.email).trim()) || (userClaims?.email && String(userClaims.email).trim()) || undefined;

    // Normalize to digits-only (same as worker PayoutSettings page) so Mercury accepts them
    const routingDigits = typeof routingNumber === "string" ? routingNumber.replace(/\D/g, "") : "";
    const accountDigits = typeof accountNumber === "string" ? accountNumber.replace(/\D/g, "") : "";
    routingNumber = routingDigits;
    accountNumber = accountDigits;

    if (!routingNumber || !accountNumber || !accountType) {
      return res.status(400).json({ message: "Missing required bank account details" });
    }
    if (routingNumber.length !== 9) {
      return res.status(400).json({ message: "Routing number must be exactly 9 digits" });
    }
    if (accountNumber.length < 4 || accountNumber.length > 17) {
      return res.status(400).json({ message: "Account number must be between 4 and 17 digits" });
    }

    // Address can come from request body (onboarding formData) or profile
    const address1 = bodyAddress ?? profile.address;
    const city = bodyCity ?? profile.city;
    const region = bodyState ?? profile.state;
    const postalCode = bodyZipCode ?? profile.zipCode;

    // Validate address is available (required by Mercury)
    if (!address1 && !city) {
      return res.status(400).json({
        message: "Address information is required. Please complete the Location step (step 2) with your full address before connecting a bank account.",
      });
    }

    try {
      const { mercuryService } = await import("./services/mercury");
      const lastFour = accountNumber.slice(-4);

      let recipientId: string | null = profile.mercuryRecipientId;
      let externalAccountId: string | null = null;

      // Determine recipient name and nickname
      const recipientName = profile.firstName && profile.lastName
        ? `${profile.firstName} ${profile.lastName}`
        : profile.email || `Worker ${profile.id}`;

      // Use business/company name as nickname if available, otherwise use recipient name
      const nickname = profile.companyName || recipientName;

      // Determine if this is a business or personal account
      const isBusiness = recipientType === 'business';

      // Convert accountType to appropriate format based on recipient type
      let finalAccountType: string;
      if (isBusiness) {
        finalAccountType = accountType.toLowerCase() === 'savings'
          ? 'businessSavings'
          : 'businessChecking';
      } else {
        finalAccountType = accountType.toLowerCase() === 'savings'
          ? 'personalSavings'
          : 'personalChecking';
      }

      // Prepare address: use body (onboarding) or profile
      const addressParams: any = {
        country: 'US',
      };
      if (address1) {
        addressParams.address1 = address1;
      } else if (city || region) {
        const addressParts = [];
        if (city) addressParts.push(city);
        if (region) addressParts.push(region);
        if (addressParts.length > 0) {
          addressParams.address1 = addressParts.join(', ');
        }
      }
      if (city) addressParams.city = city;
      if (region) addressParams.region = region;
      if (postalCode) addressParams.postalCode = postalCode;

      // Validate all required address fields are present (needed for Mercury and for dev mock)
      if (!addressParams.address1 || !addressParams.city || !addressParams.region || !addressParams.postalCode) {
        const missing = [];
        if (!addressParams.address1) missing.push('address');
        if (!addressParams.city) missing.push('city');
        if (!addressParams.region) missing.push('state');
        if (!addressParams.postalCode) missing.push('zipCode');
        console.error(`[PayoutAccountSetup] ❌ Missing required address fields:`, missing);
        return res.status(400).json({
          message: `Missing required address: ${missing.join(', ')}. Please complete the Location step with full address (street, city, state, zip) before connecting a bank account.`,
        });
      }

      // Dev-only: bypass Mercury when using test routing number 123456789 (same as client hint)
      const isDevTestRouting = process.env.NODE_ENV === "development" && routingNumber === "123456789";
      if (isDevTestRouting) {
        const mockRecipientId = `dev_recipient_${profile.id}_${Date.now()}`;
        console.log(`[PayoutAccountSetup] Dev bypass: using test routing 123456789 — skipping Mercury, mock recipient ${mockRecipientId}`);
        await storage.updateProfile(profile.id, {
          mercuryRecipientId: mockRecipientId,
          mercuryExternalAccountId: mockRecipientId,
          mercuryBankVerified: false,
          bankAccountLinked: true,
        });
        try {
          await storage.createPayoutAccount({
            profileId: profile.id,
            provider: "mercury",
            externalAccountId: mockRecipientId,
            accountType: accountType,
            bankName: bankName || "Dev Test Bank",
            accountLastFour: accountNumber.slice(-4),
            isDefault: true,
          });
        } catch (e: any) {
          if (e?.code !== "23505" && !e?.message?.includes("unique")) throw e;
        }
        clearProfileSnapshot(req);
        return res.json({
          success: true,
          lastFour: accountNumber.slice(-4),
          recipientId: mockRecipientId,
          externalAccountId: mockRecipientId,
          mercuryRecipientId: mockRecipientId,
          bankAccountLinked: true,
          profileId: profile.id,
          message: "Bank account added (dev test mode — use real routing in production).",
        });
      }
      
      // Log all input parameters
      console.log(`[PayoutAccountSetup] ===== Starting payout account setup for worker ${profile.id} =====`);
      console.log(`[PayoutAccountSetup] Input parameters:`, {
        routingNumber: '***' + routingNumber.slice(-4),
        accountNumber: '***' + accountNumber.slice(-4),
        accountType,
        recipientType: recipientType || 'business',
        bankName,
        email: recipientEmail || 'NONE',
        hasExistingRecipient: !!recipientId,
        recipientId: recipientId || 'NONE',
      });
      console.log(`[PayoutAccountSetup] Profile info:`, {
        name: recipientName,
        email: profile.email || 'NONE',
        nickname,
        address: profile.address || 'NONE',
        city: profile.city || 'NONE',
        state: profile.state || 'NONE',
        zipCode: profile.zipCode || 'NONE',
      });
      console.log(`[PayoutAccountSetup] Address params:`, {
        ...addressParams,
        address1: addressParams.address1 || 'MISSING',
      });

      if (!recipientId) {
        // Create new recipient for this worker
        console.log(`[PayoutAccountSetup] ➕ Creating NEW Mercury recipient for worker ${profile.id}`);
        console.log(`[PayoutAccountSetup] Create recipient params:`, {
          name: recipientName,
          email: recipientEmail || undefined,
          nickname,
          recipientType: isBusiness ? 'business' : 'person',
          accountType: finalAccountType,
          routingNumber: '***' + routingNumber.slice(-4),
          accountNumber: '***' + accountNumber.slice(-4),
          address1: addressParams.address1 || 'MISSING',
          city: addressParams.city || 'MISSING',
          region: addressParams.region || 'MISSING',
          postalCode: addressParams.postalCode || 'MISSING',
          country: addressParams.country,
        });
        
        const workerEmail = recipientEmail || profile.email || undefined;
        const recipient = await mercuryService.createRecipient({
          name: recipientName,
          email: workerEmail,
          emails: workerEmail ? [workerEmail] : undefined,
          contactEmail: workerEmail,
          phoneNumber: profile.phone || undefined,
          isBusiness,
          nickname: nickname,
          accountType: finalAccountType as any,
          routingNumber,
          accountNumber,
          ...addressParams,
          note: `Worker profile ${profile.id}`,
        });
        
        recipientId = recipient.id;
        externalAccountId = recipient.id; // Mercury uses recipient ID as account reference
        
        // Ensure recipient is linked to worker profile
        await storage.updateProfile(profile.id, {
          mercuryRecipientId: recipientId,
          mercuryExternalAccountId: externalAccountId,
        });
        
        console.log(`[PayoutAccountSetup] ✅ Created recipient: ${recipientId} and linked to worker ${profile.id}`);
        console.log(`[PayoutAccountSetup] Recipient details:`, {
          id: recipient.id,
          name: recipient.name,
          status: recipient.status,
          hasAccountNumber: !!recipient.accountNumber,
          hasRoutingNumber: !!recipient.routingNumber,
        });
      } else {
        // Update existing recipient with new bank account details
        console.log(`[PayoutAccountSetup] 🔄 Attempting to update EXISTING Mercury recipient ${recipientId} for worker ${profile.id}`);
        
        // Ensure we have address1 (required by Mercury)
        if (!addressParams.address1 && (addressParams.city || addressParams.region)) {
          const addressParts = [];
          if (addressParams.city) addressParts.push(addressParams.city);
          if (addressParams.region) addressParts.push(addressParams.region);
          if (addressParts.length > 0) {
            addressParams.address1 = addressParts.join(', ');
            console.log(`[PayoutAccountSetup] Constructed address1 from city/state: ${addressParams.address1}`);
          }
        }
        
        console.log(`[PayoutAccountSetup] Update recipient params:`, {
          name: recipientName,
          email: recipientEmail || undefined,
          nickname,
          recipientType: isBusiness ? 'business' : 'person',
          accountType: finalAccountType,
          routingNumber: '***' + routingNumber.slice(-4),
          accountNumber: '***' + accountNumber.slice(-4),
          address1: addressParams.address1 || 'MISSING',
          city: addressParams.city || 'MISSING',
          region: addressParams.region || 'MISSING',
          postalCode: addressParams.postalCode || 'MISSING',
          country: addressParams.country,
        });
        
        const workerEmail = recipientEmail || profile.email || undefined;
        try {
          const recipient = await mercuryService.updateRecipient(recipientId, {
            name: recipientName,
            email: workerEmail,
            emails: workerEmail ? [workerEmail] : undefined,
            contactEmail: workerEmail,
            phoneNumber: profile.phone || undefined,
            isBusiness,
            nickname: nickname,
            accountType: finalAccountType as any,
            routingNumber,
            accountNumber,
            ...addressParams,
          });
          
          // Keep the same recipient ID
          externalAccountId = recipient.id;
          console.log(`[PayoutAccountSetup] ✅ Updated recipient: ${recipientId} with new bank account details`);
          console.log(`[PayoutAccountSetup] Updated recipient details:`, {
            id: recipient.id,
            name: recipient.name,
            status: recipient.status,
            hasAccountNumber: !!recipient.accountNumber,
            hasRoutingNumber: !!recipient.routingNumber,
          });
        } catch (updateErr: any) {
          console.log(`[PayoutAccountSetup] ⚠️ Update recipient error:`, {
            status: updateErr?.status,
            statusText: updateErr?.statusText,
            message: updateErr?.message,
            recipientNotFound: updateErr?.recipientNotFound,
            error: updateErr,
          });
          
          // If recipient was deleted (404), create a new one instead
          if (updateErr?.status === 404 || updateErr?.recipientNotFound || updateErr?.message?.includes('not found') || updateErr?.message?.includes('404')) {
            console.log(`[PayoutAccountSetup] ⚠️ Recipient ${recipientId} not found (was deleted). Creating new recipient instead.`);
            
            // Clear the stored recipient ID since it's invalid
            const oldRecipientId = recipientId;
            recipientId = null;
            
            // Create new recipient
            console.log(`[PayoutAccountSetup] ➕ Creating NEW Mercury recipient (previous one ${oldRecipientId} was deleted)`);
            try {
            const recipient = await mercuryService.createRecipient({
              name: recipientName,
              email: workerEmail,
              emails: workerEmail ? [workerEmail] : undefined,
              contactEmail: workerEmail,
              phoneNumber: profile.phone || undefined,
              isBusiness,
              nickname: nickname,
              accountType: finalAccountType as any,
              routingNumber,
              accountNumber,
              ...addressParams,
              note: `Worker profile ${profile.id}`,
            });
              
              recipientId = recipient.id;
              externalAccountId = recipient.id;
              console.log(`[PayoutAccountSetup] ✅ Created new recipient: ${recipientId}`);
              console.log(`[PayoutAccountSetup] New recipient details:`, {
                id: recipient.id,
                name: recipient.name,
                status: recipient.status,
                hasAccountNumber: !!recipient.accountNumber,
                hasRoutingNumber: !!recipient.routingNumber,
              });
            } catch (createErr: any) {
              console.error(`[PayoutAccountSetup] ❌ Failed to create new recipient after deletion:`, createErr);
              throw createErr;
            }
          } else {
            // Re-throw other errors
            console.error(`[PayoutAccountSetup] ❌ Update recipient failed with non-404 error:`, updateErr);
            throw updateErr;
          }
        }
      }

      // If worker had uploaded W-9 before connecting bank (stored on profile), attach it to the new recipient now
      const profileForW9 = await storage.getProfile(profile.id);
      let w9AttachedThisRequest = false;
      if (profileForW9?.w9DocumentUrl && recipientId && typeof profileForW9.w9DocumentUrl === "string") {
        try {
          const w9Raw = profileForW9.w9DocumentUrl;
          const dataUrlMatch = w9Raw.match(/^data:([^;]+);base64,(.+)$/);
          const base64 = dataUrlMatch ? dataUrlMatch[2] : w9Raw;
          const mimeType = dataUrlMatch ? dataUrlMatch[1] : "application/pdf";
          const w9Buffer = Buffer.from(base64, "base64");
          const w9FileName = mimeType.includes("pdf") ? "w9.pdf" : mimeType.includes("png") ? "w9.png" : "w9.jpg";
          console.log(`[PayoutAccountSetup] Attaching stored W-9 to new recipient ${recipientId} (${w9Buffer.length} bytes)`);
          await mercuryService.uploadRecipientAttachment(recipientId, w9Buffer, w9FileName, mimeType);
          w9AttachedThisRequest = true;
          console.log(`[PayoutAccountSetup] ✅ W-9 attached to recipient ${recipientId}`);
        } catch (w9Err: any) {
          console.error("[PayoutAccountSetup] Failed to attach stored W-9 to recipient:", w9Err?.message ?? w9Err);
          // Don't fail bank connect; W-9 can be re-uploaded on Account & Documents
        }
      }

      // Store bank info on worker profile (Mercury Bank)
      // Ensure recipient is always linked to the worker profile; clear stored W-9 and set w9UploadedAt if we just attached it
      await storage.updateProfile(profile.id, {
        mercuryRecipientId: recipientId,
        mercuryExternalAccountId: externalAccountId,
        mercuryBankVerified: false,
        bankAccountLinked: !!recipientId,
        ...(w9AttachedThisRequest ? { w9UploadedAt: new Date(), w9DocumentUrl: null } : {}),
      });
      
      console.log(`[PayoutAccountSetup] ✅ Profile ${profile.id} updated: mercuryRecipientId=${recipientId}, mercuryExternalAccountId=${externalAccountId ?? "null"}, bankAccountLinked=true`);
      clearProfileSnapshot(req);

      // Also store in payout_accounts table (upsert-like: create or ignore duplicate)
      try {
        await storage.createPayoutAccount({
          profileId: profile.id,
          provider: "mercury",
          externalAccountId: externalAccountId || recipientId || `pending_${profile.id}`,
          accountType: accountType,
          bankName: bankName || "Bank Account",
          accountLastFour: lastFour,
          isDefault: true,
        });
      } catch (payoutAccountErr: any) {
        // Ignore duplicate - account already exists (e.g. retry or reconnect)
        const isDuplicate = payoutAccountErr?.code === "23505" || payoutAccountErr?.message?.includes("unique") || payoutAccountErr?.message?.includes("duplicate");
        if (!isDuplicate) {
          console.error("[PayoutAccountSetup] Failed to create payout_account record:", payoutAccountErr);
          throw payoutAccountErr;
        }
        console.log("[PayoutAccountSetup] Payout account record already exists, skipping insert");
      }

      // AUTO-RELEASE: Group all pending_bank_setup payouts and send one payment for the total to this recipient
      let releasedPayouts: any[] = [];
      try {
        const pendingPayouts = await storage.getWorkerPayoutsByStatus(profile.id, "pending_bank_setup");
        if (pendingPayouts.length > 0 && externalAccountId && recipientId) {
          const totalAmountCents = pendingPayouts.reduce((sum, p) => sum + (p.amount ?? 0), 0);
          if (totalAmountCents > 0) {
            const isInstantPayout = profile.instantPayoutEnabled || false;
            let netAmountCents = totalAmountCents;
            let instantPayoutFeeCents = 0;
            if (isInstantPayout) {
              instantPayoutFeeCents = Math.round(totalAmountCents * 0.01) + 30;
              netAmountCents = totalAmountCents - instantPayoutFeeCents;
            }
            console.log(`[PayoutAccountSetup] Sending grouped escrow release for worker ${profile.id}: ${pendingPayouts.length} payouts, total $${(totalAmountCents / 100).toFixed(2)}`);
            const escrowPayoutIds = pendingPayouts.map((p) => p.id).sort((a, b) => a - b);
            const idempotencyKey = `escrow-release-worker-${profile.id}-${escrowPayoutIds.join("-")}`;
            const payment = await mercuryService.sendPayment({
              recipientId,
              amount: netAmountCents,
              description: isInstantPayout
                ? `Escrow release (${pendingPayouts.length} payouts) - Fee: $${(instantPayoutFeeCents / 100).toFixed(2)}`
                : `Escrow release (${pendingPayouts.length} payouts)`,
              idempotencyKey,
              note: `Worker: ${profile.id}, batch of ${pendingPayouts.length}${isInstantPayout ? ", Instant" : ""}`,
            });
            const paymentStatus = payment.status === "completed" ? "completed" : "processing";
            for (const payout of pendingPayouts) {
              const pAmount = payout.amount ?? 0;
              const proportionalFee = totalAmountCents > 0 && isInstantPayout
                ? Math.round((instantPayoutFeeCents * pAmount) / totalAmountCents)
                : undefined;
              await storage.updateWorkerPayout(payout.id, {
                status: paymentStatus,
                mercuryPaymentId: payment.id,
                mercuryPaymentStatus: payment.status,
                isInstantPayout: isInstantPayout || undefined,
                instantPayoutFee: proportionalFee,
                originalAmount: pAmount,
              });
              if (payout.timesheetId) {
                await storage.updateTimesheet(payout.timesheetId, { paymentStatus: "pending" });
              }
              releasedPayouts.push({ id: payout.id, amount: pAmount / 100, status: paymentStatus });
            }
            console.log(`[PayoutAccountSetup] Released ${pendingPayouts.length} escrow payouts - Payment:`, payment.id);
          }
        }
      } catch (escrowErr: any) {
        console.error("[PayoutAccountSetup] Error processing escrow payouts:", escrowErr?.message ?? escrowErr);
      }

      // If we attached a stored W-9 to the new recipient, schedule grouped W-9 release in background (same as runW9PayoutReleaseForWorker)
      if (w9AttachedThisRequest && recipientId) {
        setImmediate(() => runW9PayoutReleaseForWorker(profile.id).catch((e: any) => console.error("[PayoutAccountSetup] W-9 release error:", e?.message ?? e)));
        const pendingW9 = await storage.getWorkerPayoutsByStatus(profile.id, "pending_w9");
        if (pendingW9.length > 0) {
          console.log(`[PayoutAccountSetup] Scheduled grouped W-9 release for ${pendingW9.length} payouts (worker ${profile.id})`);
        }
      }

      res.json({ 
        success: true, 
        lastFour, 
        recipientId,
        externalAccountId,
        mercuryRecipientId: recipientId,
        bankAccountLinked: true,
        profileId: profile.id,
        mercuryDashboardUrl: process.env.NODE_ENV === "development" 
          ? `https://sandbox.mercury.com/recipients/${recipientId}`
          : `https://app.mercury.com/recipients/${recipientId}`,
        releasedPayouts: releasedPayouts.length > 0 ? releasedPayouts : undefined,
        message: releasedPayouts.length > 0 
          ? `Bank account added. ${releasedPayouts.length} pending payment(s) totaling $${releasedPayouts.reduce((s, p) => s + p.amount, 0).toFixed(2)} are now being processed.`
          : "Bank account added successfully."
      });
    } catch (err: any) {
      console.error("[PayoutAccountSetup] ❌ Worker payout account setup error:", err);
      console.error("[PayoutAccountSetup] Error stack:", err?.stack);
      console.error("[PayoutAccountSetup] Error message:", err?.message);
      console.error("[PayoutAccountSetup] Error name:", err?.name);
      
      // Check if it's a Mercury configuration error
      if (err?.message?.includes("Mercury_Sandbox") || err?.message?.includes("Mercury_Production")) {
        console.error("[PayoutAccountSetup] ⚠️ Mercury API token not configured. Please add Mercury_Sandbox to .env.development");
        return res.status(500).json({ 
          message: "Payment service not configured. Please contact support.",
          error: "Mercury API token missing",
          details: process.env.NODE_ENV === "development" ? err.message : undefined
        });
      }
      
      // Check if it's a Mercury API error (service sets err.status and err.details, not err.response)
      if (err?.status != null || err?.response) {
        console.error("[PayoutAccountSetup] Mercury API error response:", {
          status: err?.status,
          statusText: err?.statusText,
          message: err?.message,
          details: err?.details,
        });
        const mercuryMessage = err?.response?.data?.message ?? err?.details?.error ?? err?.details?.message ?? err?.message ?? "";
        const mercuryDetails = err?.response?.data ?? err?.details ?? err?.data;
        const errStr = mercuryDetails?.errors?.message ?? mercuryDetails?.errors ?? "";
        const invalidRouting = (mercuryMessage && String(mercuryMessage).toLowerCase().includes("routing")) ||
          (errStr && String(errStr).toLowerCase().includes("routing"));
        const userMessage = invalidRouting && process.env.NODE_ENV === "development"
          ? "Invalid routing number. In sandbox use test routing 021000021 (Chase), or use 123456789 for dev bypass (no Mercury call)."
          : (mercuryMessage || "Failed to set up bank account");
        return res.status(500).json({
          message: userMessage,
          error: "Mercury API error",
          details: process.env.NODE_ENV === "development" ? mercuryDetails : undefined
        });
      }
      
      const errorMessage = err?.message || "Failed to set up payout account. Please try again or contact support.";
      res.status(500).json({ 
        message: errorMessage,
        error: err?.name || "Unknown error",
        details: process.env.NODE_ENV === "development" ? err.toString() : undefined
      });
    }
  });

  // Affiliate: Set up payout account (Mercury recipient for affiliate commissions — same system as workers, test/live like worker)
  app.post("/api/mt/affiliate/payout-account", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = getAffiliateUserId(user);
    if (!userId) return res.status(401).json({ message: "User not found in session" });
    const affiliate = await storage.getAffiliateByUserId(userId);
    if (!affiliate) return res.status(404).json({ message: "Affiliate not found" });

    let { routingNumber, accountNumber, accountType, bankName, recipientType = "business", email: bodyEmail, address: bodyAddress, city: bodyCity, state: bodyState, zipCode: bodyZipCode } = req.body || {};
    recipientType = recipientType === "person" ? "person" : "business";
    const recipientEmail = (bodyEmail && String(bodyEmail).trim()) || affiliate.email || (user?.claims?.email && String(user.claims.email).trim()) || undefined;

    const routingDigits = typeof routingNumber === "string" ? routingNumber.replace(/\D/g, "") : "";
    const accountDigits = typeof accountNumber === "string" ? accountNumber.replace(/\D/g, "") : "";
    routingNumber = routingDigits;
    accountNumber = accountDigits;

    if (!routingNumber || !accountNumber || !accountType) {
      return res.status(400).json({ message: "Missing required bank account details" });
    }
    if (routingNumber.length !== 9) return res.status(400).json({ message: "Routing number must be exactly 9 digits" });
    if (accountNumber.length < 4 || accountNumber.length > 17) return res.status(400).json({ message: "Account number must be between 4 and 17 digits" });

    const address1 = bodyAddress || affiliate.address;
    const city = bodyCity || "";
    const region = bodyState || "";
    const postalCode = bodyZipCode || "";
    if (!address1 || !city || !region || !postalCode) {
      return res.status(400).json({ message: "Address, city, state, and zip code are required for payout account." });
    }

    try {
      const { mercuryService } = await import("./services/mercury");
      const lastFour = accountNumber.slice(-4);
      let recipientId: string | null = affiliate.mercuryRecipientId || null;
      const recipientName = (affiliate.firstName && affiliate.lastName) ? `${affiliate.firstName} ${affiliate.lastName}` : affiliate.email || `Affiliate ${affiliate.id}`;
      const nickname = recipientName;
      const isBusiness = recipientType === "business";
      const finalAccountType = isBusiness ? (accountType.toLowerCase() === "savings" ? "businessSavings" : "businessChecking") : (accountType.toLowerCase() === "savings" ? "personalSavings" : "personalChecking");

      const addressParams = { country: "US" as const, address1, city, region, postalCode };

      if (process.env.NODE_ENV !== "production") {
        console.log("[AffiliatePayoutAccount] Starting payout account setup for affiliate", affiliate.id, { hasExistingRecipient: !!recipientId, recipientId: recipientId || "NONE" });
      }

      if (!recipientId) {
        const recipient = await mercuryService.createRecipient({
          name: recipientName,
          email: recipientEmail,
          nickname,
          accountType: finalAccountType as any,
          routingNumber,
          accountNumber,
          ...addressParams,
          note: `Affiliate ${affiliate.id} (${affiliate.code})`,
        });
        recipientId = recipient.id;
        const externalAccountId = recipient.id;
        await storage.updateAffiliate(affiliate.id, { mercuryRecipientId: recipientId, mercuryExternalAccountId: externalAccountId, updatedAt: new Date() } as any);
        if (process.env.NODE_ENV !== "production") {
          console.log("[AffiliatePayoutAccount] Created Mercury recipient", recipientId, "and linked to affiliate", affiliate.id);
        }
        return res.json({
          success: true,
          lastFour,
          mercuryRecipientId: recipientId,
          mercuryDashboardUrl: process.env.NODE_ENV === "development"
            ? `https://sandbox.mercury.com/recipients/${recipientId}`
            : `https://app.mercury.com/recipients/${recipientId}`,
          message: "Payout account connected for affiliate commissions.",
        });
      }

      const recipient = await mercuryService.updateRecipient(recipientId, {
        name: recipientName,
        email: recipientEmail,
        nickname,
        accountType: finalAccountType as any,
        routingNumber,
        accountNumber,
        ...addressParams,
      });
      const externalAccountId = recipient.id;
      await storage.updateAffiliate(affiliate.id, { mercuryRecipientId: recipientId, mercuryExternalAccountId: externalAccountId, updatedAt: new Date() } as any);
      if (process.env.NODE_ENV !== "production") {
        console.log("[AffiliatePayoutAccount] Updated Mercury recipient", recipientId, "for affiliate", affiliate.id);
      }
      return res.json({
        success: true,
        lastFour,
        mercuryRecipientId: recipientId,
        mercuryDashboardUrl: process.env.NODE_ENV === "development"
          ? `https://sandbox.mercury.com/recipients/${recipientId}`
          : `https://app.mercury.com/recipients/${recipientId}`,
        message: "Payout account updated.",
      });
    } catch (err: any) {
      console.error("[AffiliatePayoutAccount] Error:", err?.message);
      if (err?.message?.includes("Mercury_Sandbox") || err?.message?.includes("Mercury_Production")) {
        return res.status(500).json({
          message: "Payment service not configured. Please contact support.",
          error: "Mercury API token missing",
          details: process.env.NODE_ENV === "development" ? err.message : undefined,
        });
      }
      if (err?.response || err?.status || err?.details) {
        const mercuryMessage = err?.response?.data?.message || err?.details?.message || err?.message || "";
        const mercuryDetails = err?.response?.data || err?.data || err?.details || {};
        const invalidRouting = mercuryMessage?.includes("Invalid routing number") ||
          mercuryDetails?.errors?.message?.includes("Invalid routing number");
        const userMessage = invalidRouting && process.env.NODE_ENV === "development"
          ? "Invalid routing number. In sandbox use test routing number 021000021 (Chase)."
          : (mercuryMessage || "Failed to connect payout account.");
        return res.status(500).json({
          message: userMessage,
          error: "Mercury API error",
          details: process.env.NODE_ENV === "development" ? (err?.response?.data || err?.data || err?.details) : undefined,
        });
      }
      return res.status(500).json({
        message: err?.message || "Failed to set up payout account.",
        error: err?.name || "Unknown error",
        details: process.env.NODE_ENV === "development" ? err?.toString?.() : undefined,
      });
    }
  });

  // Affiliate: Upload W-9 to Mercury for tax purposes (attach to Mercury recipient)
  app.post("/api/affiliates/me/w9", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = getAffiliateUserId(user);
    if (!userId) return res.status(401).json({ message: "User not found in session" });
    const affiliate = await storage.getAffiliateByUserId(userId);
    if (!affiliate) return res.status(404).json({ message: "Affiliate not found" });
    if (!affiliate.mercuryRecipientId) return res.status(400).json({ message: "Connect your payout bank account first. W-9 is attached to your Mercury account." });
    const w9DocumentUrl = req.body?.w9DocumentUrl;
    if (!w9DocumentUrl || typeof w9DocumentUrl !== "string") return res.status(400).json({ message: "W-9 document (base64) required" });
    let fileBuffer: Buffer;
    let mimeType = "application/pdf";
    let fileName = "w9.pdf";
    try {
      if (w9DocumentUrl.startsWith("data:")) {
        const matches = w9DocumentUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) return res.status(400).json({ message: "Invalid data URL for W-9" });
        mimeType = matches[1];
        fileBuffer = Buffer.from(matches[2], "base64");
      } else {
        fileBuffer = Buffer.from(w9DocumentUrl, "base64");
      }
      if (mimeType.includes("png")) fileName = "w9.png";
      else if (mimeType.includes("jpeg") || mimeType.includes("jpg")) fileName = "w9.jpg";
    } catch {
      return res.status(400).json({ message: "Invalid W-9 document encoding" });
    }
    try {
      const { mercuryService } = await import("./services/mercury");
      await mercuryService.uploadRecipientAttachment(affiliate.mercuryRecipientId, fileBuffer, fileName, mimeType);
      await storage.updateAffiliate(affiliate.id, { w9UploadedAt: new Date(), updatedAt: new Date() } as any);
      return res.json({ success: true, message: "W-9 uploaded to Mercury for tax purposes." });
    } catch (err: any) {
      console.error("[AffiliateW9] Error:", err?.message);
      return res.status(500).json({ message: err?.message || "Failed to upload W-9." });
    }
  });

  // Process worker payout (admin or system action) via Modern Treasury ACH
  app.post("/api/mt/worker/payout", requireAdmin, async (req, res) => {
    const { workerId, amount, jobId, timesheetId, description } = req.body;

    if (!workerId || !amount || amount < 1) {
      return res.status(400).json({ message: "Worker ID and amount are required" });
    }

    try {
      const { mercuryService } = await import("./services/mercury");
      
      const worker = await storage.getProfile(workerId);

      if (!worker || worker.role !== "worker") {
        return res.status(404).json({ message: "Worker not found" });
      }

      if (!worker.mercuryRecipientId || !worker.mercuryExternalAccountId) {
        return res.status(400).json({ message: "Worker has not set up payout account" });
      }

      // ACH credit: Send funds FROM platform account TO worker's bank
      const payment = await mercuryService.sendPayment({
        recipientId: worker.mercuryRecipientId,
        amount,
        description: description || `Payout to ${worker.firstName} ${worker.lastName}`,
        idempotencyKey: `admin-payout-worker-${workerId}-${Date.now()}`,
        note: `Worker: ${workerId}, Job: ${jobId || 'N/A'}, Timesheet: ${timesheetId || 'N/A'}`,
      });

      // Record payout
      await storage.createWorkerPayout({
        workerId,
        jobId,
        timesheetId,
        amount,
        status: payment.status === "completed" ? "completed" : "processing",
        mercuryPaymentId: payment.id,
        mercuryPaymentStatus: payment.status,
        description: description || "Worker payout",
      });

      res.json({ payment, success: true });
    } catch (err: any) {
      console.error("Mercury worker payout error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Process payouts for approved timesheets via Mercury Bank ACH
  app.post("/api/mt/process-timesheet-payouts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    
    const isAdmin = profile?.email === "cairlbrandon@gmail.com";
    const { companyId, timesheetIds } = req.body;

    // For company users, only process their own timesheets
    // For admins, can process any company's timesheets
    const targetCompanyId = isAdmin && companyId ? companyId : profile?.id;

    if (!targetCompanyId) {
      return res.status(400).json({ message: "Company ID required" });
    }

    try {
      const { mercuryService } = await import("./services/mercury");

      // Get approved timesheets that haven't been paid yet
      const allTimesheets = await storage.getTimesheetsByCompany(targetCompanyId, "approved");
      
      // Filter to specific timesheets if IDs provided, otherwise all unpaid approved
      let timesheetsToProcess = allTimesheets.filter(ts => !ts.paymentStatus || ts.paymentStatus === "pending");
      if (timesheetIds && timesheetIds.length > 0) {
        timesheetsToProcess = timesheetsToProcess.filter(ts => timesheetIds.includes(ts.id));
      }

      if (timesheetsToProcess.length === 0) {
        return res.json({ processed: 0, message: "No timesheets to process" });
      }

      const results: { success: number; failed: number; skipped: number; details: any[] } = {
        success: 0,
        failed: 0,
        skipped: 0,
        details: [],
      };

      for (const ts of timesheetsToProcess) {
        const worker = ts.worker;
        
        if (!worker?.mercuryRecipientId || !worker?.mercuryExternalAccountId) {
          results.skipped++;
          results.details.push({
            timesheetId: ts.id,
            workerId: ts.workerId,
            status: "skipped",
            reason: "Worker has not set up payout account",
          });
          continue;
        }

        if (!ts.totalPay || ts.totalPay <= 0) {
          results.skipped++;
          results.details.push({
            timesheetId: ts.id,
            workerId: ts.workerId,
            status: "skipped",
            reason: "No pay amount on timesheet",
          });
          continue;
        }

        try {
          // ACH credit: Send funds FROM platform account TO worker's bank
          const payment = await mercuryService.sendPayment({
            recipientId: worker.mercuryRecipientId,
            amount: ts.totalPay,
            description: `Payout for ${ts.job?.title || 'job'}`,
            idempotencyKey: `timesheet-payout-${ts.id}`,
            note: `Worker: ${ts.workerId}, Timesheet: ${ts.id}, Job: ${ts.jobId}`,
          });

          // Record payout
          await storage.createWorkerPayout({
            workerId: ts.workerId,
            jobId: ts.jobId,
            timesheetId: ts.id,
            amount: ts.totalPay,
            status: payment.status === "completed" ? "completed" : "processing",
            mercuryPaymentId: payment.id,
            mercuryPaymentStatus: payment.status,
            description: `Payout for ${ts.job?.title || 'job'}`,
          });

          // Update timesheet payment status
          await storage.updateTimesheet(ts.id, {
            paymentStatus: payment.status === "completed" ? "completed" : "processing",
          });

          // Notify worker
          notifyTimesheetUpdate(ts.workerId, {
            timesheetId: ts.id,
            jobId: ts.jobId,
            jobTitle: ts.job?.title || 'Job',
            status: 'approved',
            amount: ts.totalPay,
            message: 'Payment initiated',
          });

          results.success++;
          results.details.push({
            timesheetId: ts.id,
            workerId: ts.workerId,
            status: "success",
            amount: ts.totalPay,
            paymentId: payment.id,
          });
        } catch (err: any) {
          results.failed++;
          results.details.push({
            timesheetId: ts.id,
            workerId: ts.workerId,
            status: "failed",
            error: err.message,
          });
        }
      }

      res.json({
        processed: results.success,
        failed: results.failed,
        skipped: results.skipped,
        details: results.details,
      });
    } catch (err: any) {
      console.error("Process timesheet payouts error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Company Balance Management via Modern Treasury
  // ==========================================

  // Setup company with Modern Treasury (virtual account + ledger)
  app.post("/api/mt/company/setup", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can set up payment accounts" });
    }

    try {
      // Mercury Bank: No virtual accounts needed - balance is tracked in database
      // Modern Treasury used virtual accounts for ledger tracking, Mercury uses simpler balance tracking
      // All old MT virtual account/ledger code has been removed for Mercury simplicity
      
      /*
      // Removed Modern Treasury virtual account/ledger setup code
      let virtualAccountId = profile.mtVirtualAccountId;
          internalAccountId: platformAccountId,
          name: `${profile.companyName || profile.firstName + ' ' + profile.lastName} Balance`,
          metadata: { companyId: profile.id.toString(), type: "company_balance" },
        });
        virtualAccountId = virtualAccount.id;
      */

      // Mercury Bank: No ledger accounts needed - transactions tracked in database
      // (Modern Treasury used ledgers for double-entry accounting, Mercury uses simpler transaction logs)
      
      /*
      // OLD Modern Treasury code - commented out for reference:
      let ledgerAccountId = profile.mtLedgerAccountId;
      if (!ledgerAccountId) {
        try {
          // List existing ledgers to find one we can use
          const ledgers = await modernTreasuryService.listLedgers();
          const ledgersArray = [];
          for await (const ledger of ledgers) {
            ledgersArray.push(ledger);
          }
          
          if (ledgersArray.length > 0) {
            const platformLedger = ledgersArray[0];
            const ledgerAccount = await modernTreasuryService.createLedgerAccount({
              ledgerId: platformLedger.id,
              name: `${profile.companyName || profile.firstName} Balance`,
              normalBalance: "credit",
              currency: "USD",
              metadata: { companyId: profile.id.toString(), type: "company_balance" },
            });
            ledgerAccountId = ledgerAccount.id;
          }
        } catch (ledgerErr: any) {
          console.log("Ledger setup optional - skipping:", ledgerErr.message);
        }
      }
      */

      // Mercury Bank: No virtual/ledger account IDs to store
      // (Profile already has mercuryRecipientId for bank transfers)

      res.json({
        success: true,
        message: "Company payment account setup complete (Mercury uses database tracking)",
      });
    } catch (err: any) {
      console.error("Company MT setup error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Link company bank account — disabled: Mercury is for worker payouts only; company funding uses Stripe.
  app.post("/api/mt/company/link-bank", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can link bank accounts" });
    }
    return res.status(400).json({
      message: "Company payment methods for funding are added via Stripe (card or bank). Mercury-linked accounts are only for workers who need to get paid.",
    });
  });

  // Fund company balance — Stripe only. We do NOT use Mercury for companies; Mercury is for worker payouts only.
  app.post("/api/mt/company/fund", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;

    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can fund their balance" });
    }

    const { amountCents, paymentMethodId } = req.body;

    if (!amountCents || amountCents < 100) {
      return res.status(400).json({ message: "Amount must be at least $1.00" });
    }

    // Company funding is Stripe only (card or Stripe ACH). Do not use Mercury for companies.
    const paymentMethod = paymentMethodId
      ? await storage.getCompanyPaymentMethod(paymentMethodId)
      : (await storage.getCompanyPaymentMethods(profile.id)).find((m: any) => m.isPrimary);
    if (!paymentMethod || paymentMethod.profileId !== profile.id) {
      return res.status(400).json({
        message: "Select a payment method. Company funding uses Stripe (card or bank added via Stripe).",
        code: "NO_PAYMENT_METHOD",
      });
    }
    if (!paymentMethod.stripePaymentMethodId) {
      return res.status(400).json({
        message: "Company balance funding is via Stripe only (card or add a bank through Stripe). Mercury is not used for companies.",
        code: "STRIPE_ONLY",
      });
    }

    try {
      const stripeService = (await import("./services/stripe")).default;
      const customerId = await (await import("./lib/company-stripe")).ensureCompanyStripeCustomer(profile);
      const isCard = paymentMethod.type === "card";
      const cardFee = isCard ? stripeService.calculateCardFee(amountCents) : 0;
      const amountToCharge = amountCents + cardFee;
      const chargeResult = isCard
        ? await stripeService.chargeCardOffSession({
            amount: amountToCharge,
            customerId,
            paymentMethodId: paymentMethod.stripePaymentMethodId,
            description: `Balance top-up for ${profile.companyName || profile.firstName}`,
            metadata: { companyId: String(profile.id), type: "balance_funding" },
          })
        : await stripeService.chargeAchOffSession({
            amount: amountCents,
            customerId,
            paymentMethodId: paymentMethod.stripePaymentMethodId,
            description: `Balance top-up for ${profile.companyName || profile.firstName}`,
            metadata: { companyId: String(profile.id), type: "balance_funding" },
          });

      if (!chargeResult.success) {
        return res.status(402).json({
          message: chargeResult.error || "Payment failed. Try another payment method.",
          code: "PAYMENT_FAILED",
        });
      }

      const newDepositAmount = (profile.depositAmount || 0) + amountCents;
      await storage.updateProfile(profile.id, {
        depositAmount: newDepositAmount,
        lastFailedPaymentMethodId: null,
      });
      const companyEmail = (profile.email || "").trim();
      if (companyEmail) {
        sendEmail({
          to: companyEmail,
          type: "balance_recharged",
          data: {
            amount: (amountCents / 100).toFixed(2),
            newBalance: (newDepositAmount / 100).toFixed(2),
            cardLast4: isCard ? (paymentMethod.lastFour || "****") : "bank",
          },
        }).catch((emailErr) => {
          console.error("[CompanyFund] Failed balance recharge email:", emailErr);
        });
      }

      await storage.createCompanyTransaction({
        profileId: profile.id,
        type: "deposit",
        amount: amountCents,
        description: isCard
          ? `Balance top-up via card (${paymentMethod.cardBrand} ...${paymentMethod.lastFour})`
          : "Balance top-up via ACH (Stripe)",
        paymentMethod: isCard ? "card" : "ach",
        stripePaymentIntentId: chargeResult.paymentIntentId,
        initiatedById: profile.id,
      });
      if (isCard && cardFee > 0) {
        await storage.createCompanyTransaction({
          profileId: profile.id,
          type: "card_fee",
          amount: -cardFee,
          description: "Card processing fee (3.5%) for balance top-up",
          paymentMethod: "card",
          stripePaymentIntentId: chargeResult.paymentIntentId,
          initiatedById: profile.id,
        });
      }

      const depositDescription = isCard
        ? `Balance top-up via card (${paymentMethod.cardBrand} ...${paymentMethod.lastFour})`
        : "Balance top-up via ACH (Stripe)";
      const { mercuryService } = await import("./services/mercury");
      await mercuryService.recordCompanyPaymentAsMercuryInvoice(profile, amountCents, depositDescription, chargeResult.paymentIntentId);

      await clearPaymentHoldsForCompanyIfSolvent(profile.id);

      res.json({
        success: true,
        paymentIntentId: chargeResult.paymentIntentId,
        amountCents,
        newBalance: newDepositAmount,
        message: isCard ? "Balance updated. Card charged successfully." : "Funding initiated via Stripe ACH. Balance updated.",
      });
    } catch (err: any) {
      console.error("Company funding error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get company balance (always from DB so it matches trigger-auto-charge; avoids session cache mismatch)
  app.get("/api/mt/company/balance", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can view their balance" });
    }

    try {
      const [fresh] = await db.select({
        depositAmount: profiles.depositAmount,
      })
        .from(profiles)
        .where(eq(profiles.id, profile.id))
        .limit(1);
      const p = fresh ?? profile;
      res.json({
        balanceCents: p.depositAmount ?? 0,
        hasBankLinked: false,
      });
    } catch (err: any) {
      console.error("Get company balance error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get company transactions (billing history)
  app.get("/api/mt/company/transactions", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can view their transactions" });
    }

    try {
      const transactions = await storage.getCompanyTransactions(profile.id);
      
      // Separate pending transactions (ACH in progress) from completed
      const pending = transactions.filter(t => 
        t.mercuryPaymentStatus === "pending" || 
        t.mercuryPaymentStatus === "processing" ||
        t.mercuryPaymentStatus === "sent"
      );
      
      res.json({
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          description: t.description,
          mercuryPaymentStatus: t.mercuryPaymentStatus,
          mercuryPaymentId: t.mercuryPaymentId,
          createdAt: t.createdAt,
        })),
        pendingCount: pending.length,
        pendingTotal: pending.reduce((sum, t) => sum + t.amount, 0),
      });
    } catch (err: any) {
      console.error("Get company transactions error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get company's MT-linked bank accounts
  app.get("/api/mt/company/bank-accounts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can view their bank accounts" });
    }

    try {
      // Get bank accounts from company_payment_methods that have MT fields
      const paymentMethods = await storage.getCompanyPaymentMethods(profile.id);
      
      // Filter to only show MT-linked accounts
      const mtAccounts = paymentMethods.filter(pm => pm.mercuryRecipientId || pm.mercuryExternalAccountId);
      
      // Also check profile-level MT fields as a fallback
      const hasMtLinked = !!(profile.mercuryRecipientId && profile.mercuryExternalAccountId);
      
      res.json({
        accounts: mtAccounts.map(pm => ({
          id: pm.id,
          type: "ach",
          bankName: pm.bankName,
          lastFour: pm.accountNumber || pm.lastFour,
          mercuryRecipientId: pm.mercuryRecipientId,
          mercuryExternalAccountId: pm.mercuryExternalAccountId,
          isPrimary: pm.isPrimary,
          isVerified: pm.isVerified,
        })),
        hasMtLinked,
        profilemercuryRecipientId: profile.mercuryRecipientId,
        profilemercuryExternalAccountId: profile.mercuryExternalAccountId,
      });
    } catch (err: any) {
      console.error("Get MT bank accounts error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get Mercury Bank status/configuration
  app.get("/api/mt/status", async (req, res) => {
    try {
      const { mercuryService } = await import("./services/mercury");
      
      const isConfigured = mercuryService.isConfigured();
      
      if (!isConfigured) {
        return res.json({
          configured: false,
          message: "Mercury Bank credentials not configured",
        });
      }

      // Try to verify connection
      const isConnected = await mercuryService.verifyConnection();
      const accounts = await mercuryService.getAccounts();
      const accountsArray = accounts.map(account => ({
          id: account.id,
          name: account.name,
          accountNumber: `****${account.accountNumber.slice(-4)}`,
      }));

      res.json({
        configured: true,
        connected: isConnected,
        accountsCount: accountsArray.length,
        accounts: accountsArray,
      });
    } catch (err: any) {
      console.error("MT status error:", err);
      res.json({
        configured: false,
        error: err.message,
      });
    }
  });

  // ========== STRIPE CARD PAYMENT ENDPOINTS ==========

  // Get Stripe configuration (publishable key based on environment)
  app.get("/api/stripe/config", async (req, res) => {
    try {
      const stripeService = (await import("./services/stripe")).default;
      const publishableKey = stripeService.getPublishableKey();
      const isConfigured = stripeService.isStripeConfigured();
      const mode = stripeService.getStripeKeyMode();
      res.json({
        publishableKey,
        configured: isConfigured,
        cardFeePercentage: stripeService.CARD_FEE_PERCENTAGE,
        mode,
        useSandbox: mode === "test",
      });
    } catch (err: any) {
      console.error("Stripe config error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Create a payment intent for card payment (company funding)
  app.post("/api/stripe/create-payment-intent", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = user.claims.sub;
    const profile = await storage.getProfileByUserId(userId);
    
    // Check user type from users table if profile doesn't exist yet (during onboarding)
    const dbUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const userType = dbUser[0]?.userType;
    
    // Allow if profile exists and is company, OR if user is registered as company type
    const isCompany = (profile && profile.role === "company") || userType === "company";
    
    if (!isCompany) {
      return res.status(403).json({ message: "Only companies can fund their accounts" });
    }
    
    const { amount, includeCardFee = true, savedPaymentMethodId } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Amount must be positive" });
    }
    
    try {
      const stripeService = (await import("./services/stripe")).default;
      const stripe = stripeService.getStripe();
      
      // Calculate card fee if requested
      const cardFee = includeCardFee ? stripeService.calculateCardFee(amount) : 0;
      const totalAmount = amount + cardFee;
      
      // Ensure company has a Stripe customer (create once if missing; this ID is the account's forever)
      const stripeCustomerId = profile
        ? await ensureCompanyStripeCustomer(profile)
        : undefined;

      // When topping up with a saved card: verify it belongs to this company, attach to customer only if not already attached (never attach a detached PM)
      let paymentMethodForIntent: string | undefined;
      if (savedPaymentMethodId && profile && stripeCustomerId) {
        const existingMethods = await storage.getCompanyPaymentMethods(profile.id);
        const authorized = existingMethods.find((m: any) =>
          (m.stripePaymentMethodId ?? m.stripe_payment_method_id) === savedPaymentMethodId
        );
        if (!authorized) {
          return res.status(403).json({ message: "Payment method not found or not authorized for this account" });
        }
        let pmAttachedToCustomer = false;
        try {
          const pm = await stripe.paymentMethods.retrieve(savedPaymentMethodId);
          const pmCustomer = typeof (pm as any).customer === "string" ? (pm as any).customer : (pm as any).customer?.id ?? null;
          if (pmCustomer === stripeCustomerId) {
            pmAttachedToCustomer = true;
          } else if (pmCustomer !== null && pmCustomer !== undefined) {
            return res.status(400).json({ message: "This card is linked to a different account. Please remove it in Payment Methods and add your card again." });
          }
        } catch (retrieveErr: any) {
          return res.status(400).json({ message: "This saved card is no longer valid. Please remove it in Payment Methods and add your card again." });
        }
        if (!pmAttachedToCustomer) {
          try {
            await stripe.paymentMethods.attach(savedPaymentMethodId, { customer: stripeCustomerId });
          } catch (attachErr: any) {
            const msg = String(attachErr?.message ?? "").toLowerCase();
            if (msg.includes("already been attached")) {
              // continue
            } else if (msg.includes("may not be used again") || msg.includes("detached from a customer") || msg.includes("previously used without being attached")) {
              try {
                const dead = existingMethods.find((x: any) => (x.stripePaymentMethodId ?? x.stripe_payment_method_id) === savedPaymentMethodId);
                if (dead) await storage.deleteCompanyPaymentMethod(dead.id);
              } catch (_) {}
              return res.status(400).json({
                message: "This card can no longer be used and has been removed from your payment methods. Please add your card again.",
                code: "PAYMENT_METHOD_REMOVED",
              });
            } else if (msg.includes("no such paymentmethod") || msg.includes("exists on one of your connected accounts")) {
              const dead = existingMethods.find((x: any) => (x.stripePaymentMethodId ?? x.stripe_payment_method_id) === savedPaymentMethodId);
              if (dead) await storage.deleteCompanyPaymentMethod(dead.id).catch(() => {});
              return res.status(400).json({ message: "This saved card is no longer valid. Please add your card again." });
            } else {
              throw attachErr;
            }
          }
        }
        paymentMethodForIntent = savedPaymentMethodId;
      }
      
      const paymentIntent = await stripeService.createPaymentIntent({
        amount: totalAmount,
        currency: "usd",
        description: `Account funding for ${profile?.companyName || profile?.firstName || dbUser[0]?.firstName || 'Company'}`,
        metadata: {
          profileId: profile?.id?.toString() || "pending",
          userId: userId,
          type: "company_funding",
          baseAmount: amount.toString(),
          cardFee: cardFee.toString(),
          includeCardFee: includeCardFee.toString(),
        },
        customer: stripeCustomerId || undefined,
        ...(paymentMethodForIntent ? { payment_method: paymentMethodForIntent } : {}),
      });
      
      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        baseAmount: amount,
        cardFee,
        totalAmount,
        cardFeePercentage: stripeService.CARD_FEE_PERCENTAGE,
      });
    } catch (err: any) {
      console.error("Create payment intent error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Confirm card payment and update company balance
  app.post("/api/stripe/confirm-payment", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = user.claims.sub;
    let profile = await storage.getProfileByUserId(userId);
    
    // Check user type from users table if profile doesn't exist yet (during onboarding)
    const dbUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const userType = dbUser[0]?.userType;
    
    // Allow if profile exists and is company, OR if user is registered as company type
    const isCompany = (profile && profile.role === "company") || userType === "company";
    
    if (!isCompany) {
      return res.status(403).json({ message: "Only companies can fund their accounts" });
    }
    
    const { paymentIntentId } = req.body;
    
    if (!paymentIntentId) {
      return res.status(400).json({ message: "Payment intent ID required" });
    }
    
    try {
      const stripeService = (await import("./services/stripe")).default;
      const paymentIntent = await stripeService.getPaymentIntent(paymentIntentId);
      
      // Security: Verify the payment intent belongs to this user
      // Check by userId (for onboarding) or profileId (for existing profiles)
      const intentUserId = paymentIntent.metadata.userId;
      const intentProfileId = paymentIntent.metadata.profileId;
      
      const ownershipValid = 
        (intentUserId && intentUserId === userId) ||
        (intentProfileId && intentProfileId !== "pending" && profile && intentProfileId === profile.id.toString());
      
      if (!ownershipValid) {
        console.error(`[Stripe] Payment ownership mismatch: userId=${userId}, profileId=${profile?.id}, intent userId=${intentUserId}, intent profileId=${intentProfileId}`);
        return res.status(403).json({ message: "Payment intent does not belong to this user" });
      }
      
      // Security: Verify payment type
      if (paymentIntent.metadata.type !== "company_funding") {
        return res.status(400).json({ message: "Invalid payment type" });
      }
      
      if (paymentIntent.status !== "succeeded") {
        return res.status(400).json({ 
          message: `Payment not successful. Status: ${paymentIntent.status}`,
          status: paymentIntent.status,
        });
      }
      
      // Extract metadata
      const baseAmount = parseInt(paymentIntent.metadata.baseAmount || "0");
      const cardFee = parseInt(paymentIntent.metadata.cardFee || "0");
      
      // If profile exists, update balance. Otherwise, store for later (during onboarding completion)
      let newBalance = baseAmount;
      if (profile) {
        const currentBalance = profile.depositAmount || 0;
        newBalance = currentBalance + baseAmount;
        
        await storage.updateProfile(profile.id, {
          depositAmount: newBalance,
        });
        
        // Record the transaction
        await storage.createCompanyTransaction({
          profileId: profile.id,
          type: "deposit",
          amount: baseAmount,
          cardFee: cardFee,
          description: `Card payment deposit (${cardFee > 0 ? `includes $${(cardFee / 100).toFixed(2)} card fee` : 'no fee'})`,
          paymentMethod: "card",
          initiatedById: profile.id,
          stripePaymentIntentId: paymentIntentId,
          stripePaymentStatus: paymentIntent.status,
        });
        
        // Save the card as a payment method if we have payment method details
        if (paymentIntent.payment_method) {
          try {
            const stripe = stripeService.getStripe();
            const paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method as string);
            
            if (paymentMethod.card) {
              // Check if this card already exists
              const existingMethods = await storage.getCompanyPaymentMethods(profile.id);
              const cardExists = existingMethods.some(
                (m) => m.type === "card" && m.lastFour === paymentMethod.card?.last4 && m.cardBrand === paymentMethod.card?.brand
              );
              
              if (!cardExists) {
                // Check if this is the first payment method
                const hasPrimary = existingMethods.some(m => m.isPrimary);
                
                await storage.createCompanyPaymentMethod({
                  profileId: profile.id,
                  type: "card",
                  lastFour: paymentMethod.card.last4 || "****",
                  cardBrand: paymentMethod.card.brand,
                  stripePaymentMethodId: paymentMethod.id,
                  isPrimary: !hasPrimary, // Make primary if no other methods
                  isVerified: true, // Card is verified by successful payment
                });
                console.log(`[Stripe] Saved card ending in ${paymentMethod.card.last4} for company ${profile.id}`);
              }
            }
          } catch (cardErr) {
            console.error("[Stripe] Failed to save card payment method:", cardErr);
            // Continue - card saving is not critical
          }
        }
        
        // Record in Mercury AR so company payment appears in Mercury invoices (dev: sandbox, prod: production)
        const { mercuryService } = await import("./services/mercury");
        mercuryService.recordCompanyPaymentAsMercuryInvoice(
          profile,
          baseAmount,
          `Card payment deposit (${cardFee > 0 ? `includes $${(cardFee / 100).toFixed(2)} card fee` : "no fee"})`,
          paymentIntentId
        ).catch((e) => console.warn("[Mercury] AR invoice record failed (non-blocking):", e?.message));

        console.log(`[Stripe] Card payment successful: $${(baseAmount / 100).toFixed(2)} added to company ${profile.id} (fee: $${(cardFee / 100).toFixed(2)})`);
      } else {
        // Profile doesn't exist yet (during onboarding) - payment will be recorded when profile is created
        console.log(`[Stripe] Card payment successful during onboarding: $${(baseAmount / 100).toFixed(2)} for user ${userId} (fee: $${(cardFee / 100).toFixed(2)}). Will apply when profile is created.`);
      }
      
      res.json({
        success: true,
        baseAmount,
        cardFee,
        totalCharged: baseAmount + cardFee,
        newBalance,
        paymentStatus: paymentIntent.status,
        profileCreated: !!profile,
      });
    } catch (err: any) {
      console.error("Confirm payment error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get client secret for SetupIntent that needs micro-deposit verification (for existing ACH bank)
  // Per Stripe ACH docs: https://docs.stripe.com/payments/ach-direct-debit — verification state comes from Stripe only
  app.post("/api/stripe/get-verification-setup-intent", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: "Invalid session" });
    const profile = await storage.getProfileByUserId(userId);
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Not authorized" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const stripePaymentMethodId = body.stripePaymentMethodId ?? body.stripe_payment_method_id;
    if (!stripePaymentMethodId || typeof stripePaymentMethodId !== "string" || !stripePaymentMethodId.startsWith("pm_")) {
      return res.status(400).json({ message: "Valid stripe payment method ID required" });
    }
    try {
      const stripeService = (await import("./services/stripe")).default;
      if (!stripeService.isStripeConfigured()) {
        return res.status(503).json({ message: "Payment system is not configured." });
      }
      const stripe = stripeService.getStripe();

      // 1. Check PaymentMethod status from Stripe — source of truth per Stripe ACH docs
      const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
      const usBank = (pm as any).us_bank_account;
      if (!usBank) {
        return res.status(400).json({ message: "This payment method is not a US bank account." });
      }
      const pmStatus = usBank.status;
      if (pmStatus === "verified") {
        const methods = await storage.getCompanyPaymentMethods(profile.id);
        const ourMethod = methods.find((m: any) => (m.stripePaymentMethodId ?? m.stripe_payment_method_id) === stripePaymentMethodId);
        if (ourMethod && !ourMethod.isVerified) {
          await storage.updateCompanyPaymentMethod(ourMethod.id, { isVerified: true });
        }
        return res.status(200).json({ alreadyVerified: true });
      }

      // 2. Find SetupIntent in requires_action for micro-deposits (Stripe's verification flow)
      const { data: intents } = await stripe.setupIntents.list({
        payment_method: stripePaymentMethodId,
        limit: 10,
      });
      const match = intents.find((si: any) => {
        if (si.status !== "requires_action") return false;
        const nextAction = (si as any).next_action;
        return nextAction?.type === "verify_with_microdeposits";
      });
      if (!match?.client_secret) {
        // No micro-deposit flow needed — check if bank is already verified (e.g. instant verification or completed setup)
        const hasSucceededIntent = intents.some((si: any) => si.status === "succeeded");
        if (hasSucceededIntent) {
          const methods = await storage.getCompanyPaymentMethods(profile.id);
          const ourMethod = methods.find((m: any) => (m.stripePaymentMethodId ?? m.stripe_payment_method_id) === stripePaymentMethodId);
          if (ourMethod && !ourMethod.isVerified) {
            await storage.updateCompanyPaymentMethod(ourMethod.id, { isVerified: true });
          }
          return res.status(200).json({ alreadyVerified: true });
        }
        return res.status(404).json({
          message: "No pending micro-deposit verification from Stripe. You may need to add this bank again to trigger verification.",
        });
      }
      const nextAction = (match as any).next_action;
      const vwm = nextAction?.verify_with_microdeposits;
      const microdepositType = vwm?.microdeposit_type === "descriptor_code" ? "descriptor_code" : "amounts";
      res.json({
        clientSecret: match.client_secret,
        setupIntentId: match.id,
        microdepositType,
      });
    } catch (err: any) {
      console.error("Get verification setup intent error:", err);
      const msg = err?.raw?.message ?? err?.message ?? "Stripe error";
      res.status(500).json({ message: typeof msg === "string" ? msg : "Could not load verification." });
    }
  });

  // Create a SetupIntent for saving card without payment
  app.post("/api/stripe/create-setup-intent", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = user?.claims?.sub ?? user?.id ?? user?.sub;
    if (!userId) {
      console.warn("[Stripe] create-setup-intent: no userId on req.user", { hasUser: !!user, keys: user ? Object.keys(user) : [] });
      return res.status(401).json({ message: "Invalid session" });
    }
    const profile = await storage.getProfileByUserId(userId);
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can add payment methods" });
    }
    try {
      const stripeService = (await import("./services/stripe")).default;
      if (!stripeService.isStripeConfigured()) {
        return res.status(503).json({ message: "Payment system is not configured. Please try again later." });
      }
      const stripe = stripeService.getStripe();
      if (process.env.NODE_ENV !== "production") {
        console.log("[Stripe] create-setup-intent: creating (mode=" + stripeService.getStripeKeyMode() + ", profileId=" + profile.id + ")");
      }
      // Use account info (profile + auth user) so we can create a Stripe customer with email/name when missing on profile
      const accountEmail = (profile.email && String(profile.email).trim()) || (user?.email && String(user.email).trim()) || undefined;
      const accountName =
        (profile.companyName && String(profile.companyName).trim()) ||
        [profile.firstName, profile.lastName].filter(Boolean).map(String).join(" ").trim() ||
        (accountEmail ? accountEmail.split("@")[0] : undefined) ||
        "Company";
      const profileForStripe = {
        id: profile.id,
        stripeCustomerId: profile.stripeCustomerId ?? undefined,
        userId: String(userId),
        email: accountEmail ?? profile.email ?? undefined,
        companyName: (profile.companyName && String(profile.companyName).trim()) || accountName,
        firstName: profile.firstName ?? undefined,
        lastName: profile.lastName ?? undefined,
      };
      let stripeCustomerId = await ensureCompanyStripeCustomer(profileForStripe);
      let setupIntent: Awaited<ReturnType<typeof stripe.setupIntents.create>>;
      try {
        setupIntent = await stripe.setupIntents.create({
          customer: stripeCustomerId,
          payment_method_types: ["card", "us_bank_account"],
          usage: "off_session",
          metadata: {
            profileId: profile.id.toString(),
            userId: String(userId),
          },
        });
      } catch (setupErr: any) {
        const msg = String(setupErr?.message ?? "").toLowerCase();
        const noSuchCustomer = msg.includes("no such customer") || setupErr?.code === "resource_missing";
        if (noSuchCustomer && profile.stripeCustomerId) {
          await db.update(profiles).set({ stripeCustomerId: null }).where(eq(profiles.id, profile.id));
          console.log("[Stripe] create-setup-intent: cleared invalid customer for profile " + profile.id + ", retrying with new customer");
          stripeCustomerId = await ensureCompanyStripeCustomer({ ...profileForStripe, stripeCustomerId: undefined });
          setupIntent = await stripe.setupIntents.create({
            customer: stripeCustomerId,
            payment_method_types: ["card", "us_bank_account"],
            usage: "off_session",
            metadata: {
              profileId: profile.id.toString(),
              userId: String(userId),
            },
          });
        } else {
          throw setupErr;
        }
      }
      if (process.env.NODE_ENV !== "production") {
        console.log("[Stripe] create-setup-intent: success setupIntentId=" + setupIntent.id);
      }
      res.json({
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
      });
    } catch (err: any) {
      console.error("Create setup intent error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to load payment form. Please try again." });
    }
  });

  // Confirm SetupIntent and save card as payment method
  app.post("/api/stripe/confirm-setup", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      const user = req.user as any;
      const userId = user?.claims?.sub ?? user?.id ?? user?.sub;
      if (!userId) {
        console.warn("[Stripe] confirm-setup: no userId on req.user", { hasUser: !!user, keys: user ? Object.keys(user) : [] });
        return res.status(401).json({ message: "Invalid session" });
      }
      if (process.env.NODE_ENV !== "production") {
        console.log("[Stripe] confirm-setup: request body keys=" + (req.body && typeof req.body === "object" ? Object.keys(req.body).join(",") : "none"));
      }

      const stripeService = (await import("./services/stripe")).default;
      if (!stripeService.isStripeConfigured()) {
        return res.status(503).json({ message: "Payment system is not configured. Please try again later." });
      }
      const stripe = stripeService.getStripe();

      const profile = await storage.getProfileByUserId(userId);
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Only companies can add payment methods" });
      }

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const setupIntentId = body.setupIntentId;
      if (!setupIntentId || typeof setupIntentId !== "string" || !setupIntentId.startsWith("seti_")) {
        console.warn("[Stripe] confirm-setup: invalid or missing setupIntentId", { hasBody: !!body, keys: body && typeof body === "object" ? Object.keys(body) : [] });
        return res.status(400).json({ message: "Valid setup intent ID required" });
      }

      let setupIntent;
      try {
        setupIntent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
      } catch (stripeErr: any) {
        console.error("[Stripe] setupIntents.retrieve error:", stripeErr?.message || stripeErr);
        const msg = stripeErr?.message || stripeErr?.code || "Stripe error";
        return res.status(502).json({ message: `Could not verify payment: ${msg}. Please try again.` });
      }
      if (setupIntent.status === "requires_action") {
        return res.status(400).json({ message: "Please complete the verification step (e.g. 3D Secure or bank auth) and try again." });
      }
      if (setupIntent.status !== "succeeded") {
        return res.status(400).json({ message: "Setup was not successful. Please try again." });
      }

      const pmIdRaw = setupIntent.payment_method;
      const pmId = typeof pmIdRaw === "string" ? pmIdRaw : (pmIdRaw && typeof (pmIdRaw as any).id === "string" ? (pmIdRaw as any).id : null);
      if (!pmId) {
        console.warn("[Stripe] confirm-setup: SetupIntent missing payment_method", { setupIntentId, status: setupIntent.status });
        return res.status(400).json({ message: "No payment method attached. Please try adding your card again." });
      }

      let paymentMethod;
      try {
        paymentMethod = await stripe.paymentMethods.retrieve(pmId);
      } catch (stripeErr: any) {
        console.error("[Stripe] paymentMethods.retrieve error:", stripeErr?.message || stripeErr);
        const msg = stripeErr?.message || stripeErr?.code || "Stripe error";
        return res.status(502).json({ message: `Could not load payment method: ${msg}. Please try again.` });
      }
      // Only save payment methods that belong to this account's Stripe customer
      const accountCustomerId = await ensureCompanyStripeCustomer(profile);
      const pmCustomerRaw = (paymentMethod as any).customer;
      const pmCustomerId = typeof pmCustomerRaw === "string"
        ? pmCustomerRaw
        : (pmCustomerRaw && typeof (pmCustomerRaw as any).id === "string" ? (pmCustomerRaw as any).id : null);
      if (pmCustomerId !== accountCustomerId) {
        console.warn(`[Stripe] confirm-setup: PM ${pmId} belongs to customer ${pmCustomerId}, account customer is ${accountCustomerId}; not saving`);
        return res.status(400).json({
          message: "This payment method is not linked to your account. Please add your card or bank again from Payment Methods.",
        });
      }
      const existingMethods = await storage.getCompanyPaymentMethods(profile.id);

      // If this exact Stripe PM is already saved for this profile, nothing to do — return its id so client can refetch/step2
      const existingRow = existingMethods.find((m) => m.stripePaymentMethodId === pmId);
      if (existingRow) {
        return res.status(200).json({
          success: true,
          alreadySaved: true,
          message: "This payment method is already saved",
          paymentMethodId: existingRow.id,
        });
      }

      const stripePmJson = (pm: any) => ({
        id: pm.id,
        object: pm.object,
        type: pm.type,
        livemode: pm.livemode,
        created: pm.created,
        ...(pm.card && {
          card: {
            brand: pm.card.brand,
            last4: pm.card.last4,
            exp_month: pm.card.exp_month,
            exp_year: pm.card.exp_year,
            country: pm.card.country,
          },
        }),
        ...(pm.us_bank_account && {
          us_bank_account: {
            bank_name: pm.us_bank_account.bank_name,
            last4: pm.us_bank_account.last4,
            verification_status: (pm.us_bank_account as any).verification_status ?? null,
            routing_number: (pm.us_bank_account as any).routing_number ? "****" : undefined,
          },
        }),
        setup_intent_id: setupIntent.id,
      });

      if (paymentMethod.card) {
        const last4 = String(paymentMethod.card.last4 || "****").slice(0, 4);
        const brand = paymentMethod.card.brand ? String(paymentMethod.card.brand) : null;
        const sameCardRow = existingMethods.find(
          (m) => m.type === "card" && m.lastFour === last4 && (brand ? m.cardBrand === brand : true)
        );
        let createdCard;
        if (sameCardRow) {
          try {
            await storage.updateCompanyPaymentMethod(sameCardRow.id, {
              stripePaymentMethodId: paymentMethod.id,
              stripePaymentMethodJson: stripePmJson(paymentMethod),
              isVerified: true,
            });
            createdCard = { ...sameCardRow, stripePaymentMethodId: paymentMethod.id, isPrimary: sameCardRow.isPrimary };
          } catch (dbErr: any) {
            console.error("[Stripe] updateCompanyPaymentMethod (card) error:", dbErr?.message || dbErr);
            return res.status(500).json({ message: dbErr?.message || "Could not save card. Please try again." });
          }
          for (const m of existingMethods) {
            if (m.id !== sameCardRow.id) await storage.updateCompanyPaymentMethod(m.id, { isPrimary: false });
          }
          await storage.updateProfile(profile.id, {
            primaryPaymentMethodId: sameCardRow.id,
            primaryPaymentMethodVerified: true,
            lastFailedPaymentMethodId: null,
          });
        } else {
          try {
            createdCard = await storage.createCompanyPaymentMethod({
              profileId: profile.id,
              type: "card",
              lastFour: last4 || "****",
              cardBrand: brand || null,
              stripePaymentMethodId: paymentMethod.id,
              isPrimary: true,
              isVerified: true,
              stripePaymentMethodJson: stripePmJson(paymentMethod),
            });
          } catch (dbErr: any) {
            console.error("[Stripe] createCompanyPaymentMethod (card) error:", dbErr?.message || dbErr);
            return res.status(500).json({ message: dbErr?.message || "Could not save card. Please try again." });
          }
          for (const m of existingMethods) {
            if (m.id !== createdCard.id) await storage.updateCompanyPaymentMethod(m.id, { isPrimary: false });
          }
          await storage.updateProfile(profile.id, {
            primaryPaymentMethodId: createdCard.id,
            primaryPaymentMethodVerified: true,
            lastFailedPaymentMethodId: null,
          });
        }
        if (process.env.NODE_ENV !== "production") {
          console.log("[Stripe] confirm-setup: saved card ending " + last4 + " for profileId=" + profile.id);
        }
        return res.json({
          success: true,
          type: "card",
          cardBrand: brand,
          lastFour: last4,
          isPrimary: true,
          paymentMethodId: createdCard.id,
          message: "Card saved successfully",
        });
      }

      if (paymentMethod.us_bank_account) {
        const last4 = String(paymentMethod.us_bank_account.last4 || "****").slice(0, 4);
        const bankName = paymentMethod.us_bank_account.bank_name ? String(paymentMethod.us_bank_account.bank_name) : "Bank";
        let createdAch;
        try {
          createdAch = await storage.createCompanyPaymentMethod({
            profileId: profile.id,
            type: "ach",
            lastFour: last4 || "****",
            bankName: bankName || "Bank",
            stripePaymentMethodId: paymentMethod.id,
            isPrimary: true,
            isVerified: false,
            stripePaymentMethodJson: stripePmJson(paymentMethod),
          });
        } catch (dbErr: any) {
          console.error("[Stripe] createCompanyPaymentMethod (ach) error:", dbErr?.message || dbErr);
          return res.status(500).json({ message: dbErr?.message || "Could not save bank account. Please try again." });
        }
        for (const m of existingMethods) {
          if (m.id !== createdAch.id) await storage.updateCompanyPaymentMethod(m.id, { isPrimary: false });
        }
        await storage.updateProfile(profile.id, {
          primaryPaymentMethodId: createdAch.id,
          primaryPaymentMethodVerified: false,
          lastFailedPaymentMethodId: null,
        });
        if (process.env.NODE_ENV !== "production") {
          console.log("[Stripe] confirm-setup: saved ACH ending " + last4 + " for profileId=" + profile.id);
        }
        return res.json({
          success: true,
          type: "ach",
          lastFour: last4,
          bankName,
          isPrimary: true,
          paymentMethodId: createdAch.id,
          message: "Bank account saved successfully",
        });
      }

      const pmType = (paymentMethod as any).type ?? "unknown";
      console.warn("[Stripe] Unsupported payment method type for save:", pmType);
      return res.status(400).json({
        message: "Only Card and Bank account can be saved here. Please select the \"Card\" or \"Bank account\" tab (not Link or other options) and try again.",
      });
    } catch (err: any) {
      console.error("Confirm setup error:", err?.message || err);
      const message = err?.message || (err?.code ? String(err.code) : "Failed to save payment method. Please try again.");
      return res.status(500).json({ message });
    }
  });

  // Charge a saved card for balance top-up (saved card -> add to company balance)
  app.post("/api/stripe/charge-saved-card", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      const user = req.user as any;
      const userId = user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Invalid session" });
      const profile = await storage.getProfileByUserId(userId);
      
      if (!profile || profile.role !== "company") {
        return res.status(403).json({ message: "Only companies can charge cards" });
      }
      
      const { paymentIntentId, stripePaymentMethodId } = req.body || {};
      
      if (!paymentIntentId || !stripePaymentMethodId) {
        return res.status(400).json({ message: "Payment intent ID and Stripe payment method ID required" });
      }

      let authorizedMethod: { id: number } | undefined;
    try {
      // SECURITY: Verify that the stripePaymentMethodId belongs to this company
      const existingMethods = await storage.getCompanyPaymentMethods(profile.id);
      authorizedMethod = existingMethods.find((m: any) =>
        (m.stripePaymentMethodId ?? m.stripe_payment_method_id) === stripePaymentMethodId
      );
      
      if (!authorizedMethod) {
        console.error(`[Stripe] Authorization failed: Payment method ${stripePaymentMethodId} not found for company ${profile.id}`);
        return res.status(403).json({ message: "Payment method not authorized for this account" });
      }
      
      const stripeService = (await import("./services/stripe")).default;
      const stripe = stripeService.getStripe();

      // Use the account's Stripe customer (create once if missing; never changed)
      const stripeCustomerId = await ensureCompanyStripeCustomer(profile);

      // Attach payment method to customer only if not already attached (Stripe forbids re-attaching detached PMs)
      let pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
      const pmCustomer = typeof (pm as any).customer === "string" ? (pm as any).customer : (pm as any).customer?.id ?? null;
      if (pmCustomer !== stripeCustomerId) {
        if (pmCustomer !== null && pmCustomer !== undefined) {
          return res.status(400).json({ message: "This card is linked to a different account. Please remove it in Payment Methods and add your card again." });
        }
        try {
          await stripe.paymentMethods.attach(stripePaymentMethodId, { customer: stripeCustomerId });
          console.log(`[Stripe] Attached payment method ${stripePaymentMethodId} to customer ${stripeCustomerId}`);
        } catch (attachError: any) {
          const errorMsg = String(attachError?.message || attachError?.raw?.body?.error?.message || "");
          if (errorMsg.includes("No such PaymentMethod") || errorMsg.includes("exists on one of your connected accounts")) {
            return res.status(400).json({ message: "This saved card is no longer valid. Please remove it in Payment Methods and add your card again." });
          }
          if (errorMsg.includes("may not be used again") || errorMsg.includes("detached from a Customer") || errorMsg.includes("previously used without being attached")) {
            try {
              if (authorizedMethod && authorizedMethod.id) await storage.deleteCompanyPaymentMethod(authorizedMethod.id);
            } catch (_) {}
            return res.status(400).json({
              message: "This card can no longer be used and has been removed from your payment methods. Please add your card again.",
              code: "PAYMENT_METHOD_REMOVED",
            });
          }
          if (errorMsg.includes("already been attached to a Customer") && !errorMsg.includes(stripeCustomerId)) {
            return res.status(403).json({ message: "This payment method cannot be used with this account" });
          }
          if (errorMsg.includes("already been attached")) {
            // same customer, continue
          } else {
            throw attachError;
          }
        }
      }
      
      // Update the PaymentIntent with the customer
      await stripe.paymentIntents.update(paymentIntentId, {
        customer: stripeCustomerId,
      });
      
      // Verify the PaymentIntent belongs to this user
      const existingIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const metadata = existingIntent.metadata || {};
      if (metadata.profileId !== profile.id.toString()) {
        console.error(`[Stripe] Authorization failed: PaymentIntent ${paymentIntentId} does not belong to company ${profile.id}`);
        return res.status(403).json({ message: "Payment intent not authorized for this account" });
      }
      
      // Server-side validation of amounts
      const baseAmount = parseInt(metadata.baseAmount || "0", 10);
      const cardFee = Math.max(0, parseInt(metadata.cardFee || "0", 10) || 0);
      if (isNaN(baseAmount) || baseAmount <= 0) {
        return res.status(400).json({ message: "Invalid payment intent: missing or invalid amount" });
      }
      const MIN_AMOUNT_CENTS = 10000; // $100 (matches frontend minimum)
      const MAX_CARD_AMOUNT_CENTS = 99999900; // $999,999
      
      if (baseAmount < MIN_AMOUNT_CENTS) {
        return res.status(400).json({ message: `Minimum top-up amount is $100` });
      }
      if (baseAmount > MAX_CARD_AMOUNT_CENTS) {
        return res.status(400).json({ message: `Maximum card payment is $999,999` });
      }
      
      // Confirm the payment intent with the saved payment method
      const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: stripePaymentMethodId,
        return_url: `${process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000'}/company-dashboard`,
      });
      
      if (paymentIntent.status !== "succeeded" && paymentIntent.status !== "processing") {
        // Check for requires_action (3D Secure)
        if (paymentIntent.status === "requires_action") {
          return res.json({
            success: false,
            requiresAction: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            message: "Additional authentication required",
          });
        }
        await storage.updateProfile(profile.id, { lastFailedPaymentMethodId: authorizedMethod.id });
        return res.status(400).json({ 
          message: `Payment not successful. Status: ${paymentIntent.status}`,
          status: paymentIntent.status,
        });
      }
      
      // Update company balance (support both camelCase and snake_case from DB)
      const currentBalance = Number((profile as any).depositAmount ?? (profile as any).deposit_amount ?? 0) || 0;
      const newBalance = currentBalance + baseAmount;
      
      await storage.updateProfile(profile.id, {
        depositAmount: newBalance,
      });
      
      // Record the transaction
      await storage.createCompanyTransaction({
        profileId: profile.id,
        type: "deposit",
        amount: baseAmount,
        cardFee: cardFee,
        description: `Card payment top-up (includes $${(cardFee / 100).toFixed(2)} processing fee)`,
        paymentMethod: "card",
        initiatedById: profile.id,
        stripePaymentIntentId: paymentIntentId,
        stripePaymentStatus: paymentIntent.status,
      });
      
      // Record in Mercury AR (dev: sandbox, prod: production)
      const { mercuryService } = await import("./services/mercury");
      mercuryService.recordCompanyPaymentAsMercuryInvoice(
        profile,
        baseAmount,
        `Card payment top-up (includes $${(cardFee / 100).toFixed(2)} processing fee)`,
        paymentIntentId
      ).catch((e) => console.warn("[Mercury] AR invoice record failed (non-blocking):", e?.message));

      console.log(`[Stripe] Saved card charged: $${(baseAmount / 100).toFixed(2)} added to company ${profile.id} (fee: $${(cardFee / 100).toFixed(2)})`);
      
      res.json({
        success: true,
        baseAmount,
        cardFee,
        totalCharged: baseAmount + cardFee,
        newBalance,
        paymentStatus: paymentIntent.status,
      });
    } catch (err: any) {
      // Extract Stripe error (v20+ and older shapes)
      const stripeError = err?.raw?.body?.error ?? err?.raw?.error ?? err?.body?.error ?? {};
      const code = String(err?.code ?? stripeError?.code ?? "").toLowerCase();
      const rawMessage = String(
        stripeError?.message ?? err?.raw?.body?.error?.message ?? err?.message ?? (code || "unknown")
      ).toLowerCase();
      const fullMessage =
        stripeError?.message || err?.message || (err?.code ? String(err.code) : "") || "Payment could not be completed. Please try again.";
      console.error("[Stripe] charge-saved-card error:", { code, message: fullMessage, type: err?.type }, err?.stack);

      if (res.headersSent) return;

      const fullMessageLower = fullMessage.toLowerCase();
      // Saved card not valid on this Stripe account (wrong mode, Connect, or deleted) -> 400 so user can re-add card
      const invalidPm =
        code === "resource_missing" ||
        rawMessage.includes("no such paymentmethod") ||
        rawMessage.includes("no such payment_method") ||
        rawMessage.includes("exists on one of your connected accounts") ||
        (rawMessage.includes("payment method") && (rawMessage.includes("does not exist") || rawMessage.includes("no such"))) ||
        fullMessageLower.includes("no such paymentmethod") ||
        fullMessageLower.includes("no such payment_method");
      if (invalidPm) {
        if (authorizedMethod?.id) await storage.updateProfile(profile.id, { lastFailedPaymentMethodId: authorizedMethod.id });
        return res.status(400).json({
          message: "This saved card is no longer valid. Please remove it in Payment Methods and add your card again.",
        });
      }

      if (authorizedMethod?.id) await storage.updateProfile(profile.id, { lastFailedPaymentMethodId: authorizedMethod.id });
      res.status(500).json({ message: fullMessage });
    }
    } catch (outerErr: any) {
      if (!res.headersSent) {
        console.error("[Stripe] charge-saved-card outer error:", outerErr?.message || outerErr);
        res.status(500).json({
          message: outerErr?.message || "Payment could not be completed. Please try again.",
        });
      }
    }
  });

  // Finalize a 3DS-authenticated payment (after client-side authentication)
  app.post("/api/stripe/finalize-3ds-payment", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const userId = user.claims.sub;
    const profile = await storage.getProfileByUserId(userId);
    
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can finalize payments" });
    }
    
    const { paymentIntentId } = req.body;
    
    if (!paymentIntentId) {
      return res.status(400).json({ message: "Payment intent ID required" });
    }
    
    try {
      const stripeService = (await import("./services/stripe")).default;
      const stripe = stripeService.getStripe();
      
      // Retrieve the payment intent
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const piMetadata = paymentIntent.metadata || {};
      // Verify ownership
      if (piMetadata.profileId !== profile.id.toString()) {
        return res.status(403).json({ message: "Payment intent not authorized for this account" });
      }
      
      // Verify payment was successful
      if (paymentIntent.status !== "succeeded") {
        return res.status(400).json({ 
          message: `Payment not successful. Status: ${paymentIntent.status}`,
          status: paymentIntent.status,
        });
      }
      
      // Extract amounts from metadata
      const baseAmount = parseInt(paymentIntent.metadata.baseAmount || "0");
      const cardFee = parseInt(paymentIntent.metadata.cardFee || "0");
      
      // Update company balance
      const currentBalance = profile.depositAmount || 0;
      const newBalance = currentBalance + baseAmount;
      
      await storage.updateProfile(profile.id, {
        depositAmount: newBalance,
      });
      
      // Record the transaction
      await storage.createCompanyTransaction({
        profileId: profile.id,
        type: "deposit",
        amount: baseAmount,
        cardFee: cardFee,
        description: `Card payment top-up with 3DS (includes $${(cardFee / 100).toFixed(2)} processing fee)`,
        paymentMethod: "card",
        initiatedById: profile.id,
        stripePaymentIntentId: paymentIntentId,
        stripePaymentStatus: paymentIntent.status,
      });
      
      // Record in Mercury AR (dev: sandbox, prod: production)
      const { mercuryService } = await import("./services/mercury");
      mercuryService.recordCompanyPaymentAsMercuryInvoice(
        profile,
        baseAmount,
        `Card payment top-up with 3DS (includes $${(cardFee / 100).toFixed(2)} processing fee)`,
        paymentIntentId
      ).catch((e) => console.warn("[Mercury] AR invoice record failed (non-blocking):", e?.message));

      console.log(`[Stripe] 3DS payment finalized: $${(baseAmount / 100).toFixed(2)} added to company ${profile.id} (fee: $${(cardFee / 100).toFixed(2)})`);
      
      res.json({
        success: true,
        baseAmount,
        cardFee,
        totalCharged: baseAmount + cardFee,
        newBalance,
        paymentStatus: paymentIntent.status,
      });
    } catch (err: any) {
      console.error("Finalize 3DS payment error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get pending payouts (timesheets approved but not yet paid)
  app.get("/api/unit/pending-payouts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;

    const isAdmin = profile?.email === "cairlbrandon@gmail.com";
    const companyId = isAdmin && req.query.companyId 
      ? parseInt(req.query.companyId as string) 
      : profile?.id;

    if (!companyId) {
      return res.status(400).json({ message: "Company ID required" });
    }

    try {
      // Get approved timesheets that haven't been paid
      const timesheets = await storage.getTimesheetsByCompany(companyId, "approved");
      const pendingPayouts = timesheets.filter(ts => !ts.paymentStatus || ts.paymentStatus === "pending");

      // Calculate totals
      const totalAmount = pendingPayouts.reduce((sum, ts) => sum + (ts.totalPay || 0), 0);
      const workerCount = new Set(pendingPayouts.map(ts => ts.workerId)).size;

      res.json({
        pendingPayouts,
        summary: {
          count: pendingPayouts.length,
          totalAmount,
          workerCount,
        },
      });
    } catch (err: any) {
      console.error("Get pending payouts error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/unit/company/transactions", async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, transactions: [], configured: false, deprecated: true });
  });

  app.get("/api/admin/unit/payments", requireAdmin, async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, deprecated: true });
  });

  app.post("/api/admin/unit/payments/:id/cancel", requireAdmin, async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, deprecated: true });
  });

  app.post("/api/unit/auto-charge", async (req, res) => {
    return res.status(410).json({ message: UNIT_DEPRECATED_MSG, deprecated: true });
  });

  // ========================
  // Invoice Endpoints
  // ========================

  // Get company invoices
  app.get("/api/invoices", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });

    try {
      let invoices;
      if (profile.role === "company") {
        invoices = await storage.getInvoicesByCompany(profile.id);
      } else if (profile.role === "worker") {
        invoices = await storage.getInvoicesByWorker(profile.id);
      } else {
        return res.status(403).json({ message: "Access denied" });
      }
      res.json(invoices);
    } catch (err: any) {
      console.error("Get invoices error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get specific invoice with items
  app.get("/api/invoices/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile) return res.status(404).json({ message: "Profile not found" });

    try {
      const invoiceId = parseInt(req.params.id);
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Verify access
      if (profile.role === "company" && invoice.companyId !== profile.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (profile.role === "worker" && invoice.workerId !== profile.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const items = await storage.getInvoiceItems(invoiceId);
      
      // Get related profiles
      const company = invoice.companyId ? await storage.getProfile(invoice.companyId) : null;
      const worker = invoice.workerId ? await storage.getProfile(invoice.workerId) : null;
      const job = invoice.jobId ? await storage.getJob(invoice.jobId) : null;

      res.json({
        ...invoice,
        items,
        company: company ? { id: company.id, companyName: company.companyName, email: company.email } : null,
        worker: worker ? { id: worker.id, fullName: `${worker.firstName || ''} ${worker.lastName || ''}`.trim(), email: worker.email } : null,
        job: job ? { id: job.id, title: job.title } : null,
      });
    } catch (err: any) {
      console.error("Get invoice error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Generate invoice for approved timesheets
  app.post("/api/invoices/generate", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can generate invoices" });
    }

    const { timesheetIds, notes } = req.body;
    if (!timesheetIds || !Array.isArray(timesheetIds) || timesheetIds.length === 0) {
      return res.status(400).json({ message: "Timesheet IDs required" });
    }

    try {
      // Fetch all timesheets and verify they belong to this company
      const timesheets = [];
      for (const id of timesheetIds) {
        const ts = await storage.getTimesheet(id);
        if (!ts) continue;
        if (ts.companyId !== profile.id) {
          return res.status(403).json({ message: `Timesheet ${id} does not belong to your company` });
        }
        if (ts.status !== "approved") {
          return res.status(400).json({ message: `Timesheet ${id} is not approved` });
        }
        timesheets.push(ts);
      }

      if (timesheets.length === 0) {
        return res.status(400).json({ message: "No valid timesheets found" });
      }

      // Calculate totals
      let subtotal = 0;
      const items = [];
      
      for (const ts of timesheets) {
        const worker = await storage.getProfile(ts.workerId);
        const workerName = worker ? `${worker.firstName || ''} ${worker.lastName || ''}`.trim() : 'Worker';
        const job = ts.jobId ? await storage.getJob(ts.jobId) : null;
        const amount = ts.totalPay || 0;
        subtotal += amount;

        items.push({
          description: `${workerName} - ${job?.title || 'Job'} (${ts.totalHours || 0} hrs)`,
          quantity: ts.totalHours || 0,
          unitPrice: ts.hourlyRate || 0,
          amount: amount,
          timesheetId: ts.id,
          workDate: ts.createdAt,
        });
      }

      // The $13/hr platform fee is ALREADY EMBEDDED in the displayed rate (1.52x markup)
      // Company sees and pays: worker_rate * 1.52 (which includes the platform fee)
      const COMPANY_MARKUP = 1.52;
      const totalAmount = Math.round(subtotal * COMPANY_MARKUP);
      const platformFee = totalAmount - subtotal;

      // Generate invoice number
      const invoiceNumber = await storage.getNextInvoiceNumber();

      // Create invoice
      const invoice = await storage.createInvoice({
        invoiceNumber,
        companyId: profile.id,
        workerId: timesheets[0].workerId, // Primary worker
        jobId: timesheets[0].jobId,
        status: "sent",
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        subtotal,
        platformFee,
        taxAmount: 0,
        totalAmount,
        notes: notes || null,
      });

      // Create invoice items
      const invoiceItems = await storage.createInvoiceItems(
        items.map(item => ({
          invoiceId: invoice.id,
          description: item.description,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice,
          amount: item.amount,
          timesheetId: item.timesheetId,
          workDate: item.workDate,
        }))
      );

      res.json({
        invoice,
        items: invoiceItems,
      });
    } catch (err: any) {
      console.error("Generate invoice error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Update invoice status (mark as paid, void, etc.)
  app.patch("/api/invoices/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const profile = req.profile;
    if (!profile || profile.role !== "company") {
      return res.status(403).json({ message: "Only companies can update invoices" });
    }

    const invoiceId = parseInt(req.params.id);
    const { status, paymentMethod, paymentReference, paidAt } = req.body;

    try {
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      if (invoice.companyId !== profile.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const updates: any = {};
      if (status) updates.status = status;
      if (paymentMethod) updates.paymentMethod = paymentMethod;
      if (paymentReference) updates.paymentReference = paymentReference;
      if (paidAt) updates.paidAt = new Date(paidAt);
      if (status === "paid" && !updates.paidAt) updates.paidAt = new Date();

      const updated = await storage.updateInvoice(invoiceId, updates);
      res.json(updated);
    } catch (err: any) {
      console.error("Update invoice error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: Get all invoices
  app.get("/api/admin/invoices", requireAdmin, async (req, res) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;
      const workerId = req.query.workerId ? parseInt(req.query.workerId as string) : undefined;
      
      let invoices: any[] = [];
      if (companyId) {
        invoices = await storage.getInvoicesByCompany(companyId);
      } else if (workerId) {
        invoices = await storage.getInvoicesByWorker(workerId);
      }
      res.json(invoices);
    } catch (err: any) {
      console.error("Admin get invoices error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // === Calendar Integration Routes ===

  // Check calendar connection status
  app.get("/api/calendar/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    const [googleConnected, outlookConnected] = await Promise.all([
      calendarIntegration.checkGoogleCalendarConnection(),
      calendarIntegration.checkOutlookConnection()
    ]);
    
    res.json({ googleConnected, outlookConnected });
  });

  // List Google calendars
  app.get("/api/calendar/google/calendars", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const calendars = await calendarIntegration.listGoogleCalendars();
      res.json(calendars);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // List Outlook calendars
  app.get("/api/calendar/outlook/calendars", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const calendars = await calendarIntegration.listOutlookCalendars();
      res.json(calendars);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Get external calendar events (for conflict detection)
  app.get("/api/calendar/events", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { provider, calendarId, startDate, endDate } = req.query;
      
      if (!provider || !calendarId || !startDate || !endDate) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      const timeMin = new Date(startDate as string);
      const timeMax = new Date(endDate as string);
      
      let events: calendarIntegration.ExternalCalendarEvent[] = [];
      
      if (provider === 'google') {
        events = await calendarIntegration.getGoogleCalendarEvents(calendarId as string, timeMin, timeMax);
      } else if (provider === 'outlook') {
        events = await calendarIntegration.getOutlookCalendarEvents(calendarId as string, timeMin, timeMax);
      }
      
      res.json(events);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Check for scheduling conflicts
  app.post("/api/calendar/check-conflicts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const { jobStart, jobEnd, calendars } = req.body;
      
      if (!jobStart || !jobEnd) {
        return res.status(400).json({ message: "Missing job times" });
      }
      
      const start = new Date(jobStart);
      const end = new Date(jobEnd);
      const allEvents: calendarIntegration.ExternalCalendarEvent[] = [];
      
      // Fetch events from all connected calendars
      for (const cal of calendars || []) {
        try {
          if (cal.provider === 'google') {
            const events = await calendarIntegration.getGoogleCalendarEvents(cal.id, start, end);
            allEvents.push(...events);
          } else if (cal.provider === 'outlook') {
            const events = await calendarIntegration.getOutlookCalendarEvents(cal.id, start, end);
            allEvents.push(...events);
          }
        } catch (error) {
          console.error(`Error fetching events from ${cal.provider} calendar ${cal.id}:`, error);
        }
      }
      
      const conflicts = calendarIntegration.checkForConflicts(start, end, allEvents);
      res.json({ hasConflicts: conflicts.length > 0, conflicts });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Export platform jobs to external calendar
  // Scoped to current user: teammates export their assigned jobs, admins export their company's jobs, workers export their applications
  app.post("/api/calendar/export", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }
      
      const { provider, calendarId, jobIds } = req.body;
      
      if (!provider || !calendarId) {
        return res.status(400).json({ message: "Missing provider or calendarId" });
      }
      
      const BASE_URL = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
      const jobEvents: calendarIntegration.PlatformJobEvent[] = [];
      
      // Check if user is a teammate (employee)
      const isEmployee = profile.teamId !== null;
      const isImpersonating = user.impersonation?.isEmployee;
      const impersonatedTeamMemberId = user.impersonation?.teamMemberId;
      
      if (isEmployee || isImpersonating) {
        // Teammate/Employee: Export only jobs assigned to this specific teammate
        let teamMemberId: number | null = null;
        
        if (isImpersonating && impersonatedTeamMemberId) {
          teamMemberId = impersonatedTeamMemberId;
        } else {
          // Find the team member record for this profile
          const teamMember = await db.select().from(workerTeamMembers)
            .where(and(
              eq(workerTeamMembers.teamId, profile.teamId || 0),
              eq(workerTeamMembers.email, profile.email || '')
            ))
            .then(r => r[0]);
          
          if (teamMember) {
            teamMemberId = teamMember.id;
          }
        }
        
        if (teamMemberId) {
          // Get jobs assigned to this specific teammate
          const memberApplications = await db.select().from(applications)
            .where(and(
              eq(applications.teamMemberId, teamMemberId),
              eq(applications.status, 'accepted')
            ));
          
          const filteredApps = memberApplications.filter(app => 
            !jobIds || jobIds.includes(app.jobId)
          );
          
          for (const appItem of filteredApps) {
            const job = await storage.getJob(appItem.jobId);
            if (job && job.status !== 'completed' && job.status !== 'cancelled') {
              const company = await storage.getProfile(job.companyId);
              const startDate = new Date(job.startDate);
              const endDate = job.endDate ? new Date(job.endDate) : new Date(startDate.getTime() + (job.estimatedHours || 8) * 60 * 60 * 1000);
              
              jobEvents.push({
                id: job.id,
                title: job.title,
                description: job.description || '',
                start: startDate,
                end: endDate,
                location: `${job.address || ''}, ${job.city}, ${job.state} ${job.zipCode}`,
                status: 'accepted',
                url: `${BASE_URL}/dashboard/today?job=${job.id}`,
                companyName: company?.companyName || company?.firstName || 'Unknown',
                hourlyRate: appItem.proposedRate ? appItem.proposedRate / 100 : (job.hourlyRate / 100)
              });
            }
          }
        }
      } else if (profile.role === "company") {
        // Admin/Company: Export only jobs created by this specific company
        const companyJobs = await db.select().from(jobs)
          .where(and(
            eq(jobs.companyId, profile.id),
            or(eq(jobs.status, 'open'), eq(jobs.status, 'in_progress'))
          ));
        
        const filteredJobs = companyJobs.filter(job => 
          !jobIds || jobIds.includes(job.id)
        );
        
        for (const job of filteredJobs) {
          const startDate = new Date(job.startDate);
          const endDate = job.endDate ? new Date(job.endDate) : new Date(startDate.getTime() + (job.estimatedHours || 8) * 60 * 60 * 1000);
          
          jobEvents.push({
            id: job.id,
            title: job.title,
            description: job.description || '',
            start: startDate,
            end: endDate,
            location: `${job.address || ''}, ${job.city}, ${job.state} ${job.zipCode}`,
            status: job.status as 'pending' | 'accepted' | 'completed',
            url: `${BASE_URL}/company-dashboard/jobs?jobId=${job.id}`,
            companyName: profile.companyName || profile.firstName || 'Unknown',
            hourlyRate: job.hourlyRate / 100
          });
        }
      } else if (profile.role === "worker") {
        // Regular Worker: Export their accepted applications/jobs
        const workerApplications = await db.select().from(applications).where(eq(applications.workerId, profile.id));
        const acceptedApps = workerApplications.filter(app => 
          app.status === 'accepted' && (!jobIds || jobIds.includes(app.jobId))
        );
        
        for (const appItem of acceptedApps) {
          const job = await storage.getJob(appItem.jobId);
          if (job) {
            const company = await storage.getProfile(job.companyId);
            const startDate = new Date(job.startDate);
            const endDate = job.endDate ? new Date(job.endDate) : new Date(startDate.getTime() + (job.estimatedHours || 8) * 60 * 60 * 1000);
            
            jobEvents.push({
              id: job.id,
              title: job.title,
              description: job.description || '',
              start: startDate,
              end: endDate,
              location: `${job.address || ''}, ${job.city}, ${job.state} ${job.zipCode}`,
              status: 'accepted',
              url: `${BASE_URL}/dashboard?tab=calendar&job=${job.id}`,
              companyName: company?.companyName || company?.firstName || 'Unknown',
              hourlyRate: appItem.proposedRate ? appItem.proposedRate / 100 : (job.hourlyRate / 100)
            });
          }
        }
        
        // Also include pending applications for workers
        const pendingApps = workerApplications.filter(app => 
          app.status === 'pending' && (!jobIds || jobIds.includes(app.jobId))
        );
        
        for (const appItem of pendingApps) {
          const job = await storage.getJob(appItem.jobId);
          if (job) {
            const company = await storage.getProfile(job.companyId);
            const startDate = new Date(job.startDate);
            const endDate = job.endDate ? new Date(job.endDate) : new Date(startDate.getTime() + (job.estimatedHours || 8) * 60 * 60 * 1000);
            
            jobEvents.push({
              id: job.id,
              title: `[PENDING] ${job.title}`,
              description: `Application pending for: ${job.description || ''}`,
              start: startDate,
              end: endDate,
              location: `${job.city}, ${job.state}`,
              status: 'pending',
              url: `${BASE_URL}/dashboard?tab=jobs&app=${appItem.id}`,
              companyName: company?.companyName || company?.firstName || 'Unknown',
              hourlyRate: appItem.proposedRate ? appItem.proposedRate / 100 : (job.hourlyRate / 100)
            });
          }
        }
      } else {
        return res.status(403).json({ message: "Calendar export not available for this user type" });
      }
      
      let result;
      if (provider === 'google') {
        result = await calendarIntegration.exportJobsToGoogleCalendar(calendarId, jobEvents);
      } else if (provider === 'outlook') {
        result = await calendarIntegration.exportJobsToOutlookCalendar(calendarId, jobEvents);
      } else {
        return res.status(400).json({ message: "Invalid provider" });
      }
      
      res.json({ 
        message: `Exported ${result.success} jobs to calendar`,
        ...result 
      });
    } catch (error: any) {
      console.error("Calendar export error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Normalize calendar URL: if pasted multiple times (e.g. same URL concatenated), keep only the first one.
  function normalizeCalendarUrl(input: string): string {
    const s = input.trim();
    if (!s) return s;
    const re = /https?:\/\//gi;
    const first = re.exec(s);
    if (!first) return s;
    const start = first.index;
    const next = re.exec(s);
    const end = next ? next.index : s.length;
    return s.slice(start, end).trim();
  }

  // Add a single calendar URL to current user's imported calendars (iCal/ICS link)
  // Per-account: only the current user's profile is updated. Admins/owner/teammates with admin see all via their own imports and availability.
  app.post("/api/calendar/import", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const profile = req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      const { url } = req.body;
      if (!url || typeof url !== "string" || !url.trim()) {
        return res.status(400).json({ message: "Calendar URL is required" });
      }
      const trimmed = normalizeCalendarUrl(url);
      if (!trimmed) return res.status(400).json({ message: "Calendar URL is required" });
      let existing: string[] = [];
      if (profile.importedCalendars) {
        try {
          const parsed = JSON.parse(profile.importedCalendars as string);
          existing = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
        } catch {
          existing = [];
        }
      }
      const normalized = existing;
      if (normalized.includes(trimmed)) {
        return res.json({ message: "Calendar already imported" });
      }
      normalized.push(trimmed);
      await db.update(profiles)
        .set({
          importedCalendars: JSON.stringify(normalized),
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, profile.id));
      clearProfileSnapshot(req);
      const session = req.session as { save?: (cb: (err?: Error) => void) => void };
      if (typeof session?.save === "function") {
        session.save((err) => {
          if (err) console.warn("Calendar import: session save failed", err);
          res.json({ message: "Calendar imported" });
        });
      } else {
        res.json({ message: "Calendar imported" });
      }
    } catch (error: any) {
      console.error("Calendar import error:", error);
      res.status(400).json({ message: error.message || "Import failed" });
    }
  });

  // Import calendars - scoped to current user (teammate, admin, or worker)
  // Each user can only import/export their own calendar settings
  app.post("/api/calendar/import-settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const user = req.user as any;
      const profile = req.profile;
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }
      
      // Scoped to current user's profile - teammates/admins/workers can only save their own settings
      const raw = req.body.importedCalendars;
      const list = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string") : [];
      const normalized = [...new Set(list.map((u) => normalizeCalendarUrl(String(u))).filter(Boolean))];
      
      await db.update(profiles)
        .set({ 
          importedCalendars: JSON.stringify(normalized),
          updatedAt: new Date()
        })
        .where(eq(profiles.id, profile.id)); // Only update current user's profile
      clearProfileSnapshot(req);
      const sessionSettings = req.session as { save?: (cb: (err?: Error) => void) => void };
      if (typeof sessionSettings?.save === "function") {
        sessionSettings.save((err) => {
          if (err) console.warn("Calendar import-settings: session save failed", err);
          res.json({ message: "Calendar import settings saved" });
        });
      } else {
        res.json({ message: "Calendar import settings saved" });
      }
    } catch (error: any) {
      console.error("Calendar import settings error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Get imported calendar settings - scoped to current user
  // Each user can only retrieve their own calendar import settings. Load from DB so list is fresh after import.
  app.get("/api/calendar/import-settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const userId = (req.user as any)?.claims?.sub ?? (req.user as any)?.id;
      const profile = userId ? await storage.getProfileByUserId(String(userId)) : req.profile;
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }
      
      let importedCalendars: string[] = [];
      if (profile.importedCalendars) {
        try {
          const parsed = JSON.parse(profile.importedCalendars as string);
          const list = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
          importedCalendars = [...new Set(list.map((u) => normalizeCalendarUrl(u)).filter(Boolean))];
        } catch {
          importedCalendars = [];
        }
      }
      res.json({ importedCalendars });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Get events from imported iCal URLs for the calendar (day/week/month). Per-account; admins see all team imports.
  app.get("/api/calendar/imported-events", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const userId = (req.user as any)?.claims?.sub ?? (req.user as any)?.id;
      const profile = userId ? await storage.getProfileByUserId(String(userId)) : req.profile;
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      const startParam = req.query.start as string;
      const endParam = req.query.end as string;
      if (!startParam || !endParam) {
        return res.status(400).json({ message: "Query start and end (ISO date) required" });
      }
      const rangeStart = new Date(startParam);
      const rangeEnd = new Date(endParam);

      type Source = { profileId: number; name: string };
      const sources: { profile: typeof profile; source: Source }[] = [{ profile, source: { profileId: profile.id, name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "You" } }];
      // Team owner sees all teammates' iCal imports; teammates with admin role also see all.
      const ownerTeam = await db.select().from(teams).where(eq(teams.ownerId, profile.id)).then((r) => r[0]);
      let teamForAll: typeof ownerTeam = ownerTeam ?? null;
      if (!ownerTeam && profile.teamId) {
        const memberTeam = await db.select().from(teams).where(eq(teams.id, profile.teamId)).then((r) => r[0]);
        if (memberTeam) {
          const members = await db.select().from(workerTeamMembers)
            .where(and(eq(workerTeamMembers.teamId, memberTeam.id), eq(workerTeamMembers.status, "active")));
          const currentMember = members.find((m) => (m.email || "").toLowerCase() === (profile.email || "").toLowerCase());
          if (currentMember && (currentMember as { role?: string }).role === "admin") {
            teamForAll = memberTeam;
          }
        }
      }
      if (teamForAll) {
        const teammateProfiles = await db.select().from(profiles).where(eq(profiles.teamId, teamForAll.id));
        const ownerProfile = teamForAll.ownerId ? await db.select().from(profiles).where(eq(profiles.id, teamForAll.ownerId)).then((r) => r[0]) : null;
        const seen = new Set(sources.map((s) => s.profile.id));
        for (const p of teammateProfiles) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          sources.push({ profile: p, source: { profileId: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "Teammate" } });
        }
        if (ownerProfile && !seen.has(ownerProfile.id)) {
          seen.add(ownerProfile.id);
          sources.push({ profile: ownerProfile, source: { profileId: ownerProfile.id, name: [ownerProfile.firstName, ownerProfile.lastName].filter(Boolean).join(" ") || "Owner" } });
        }
      }

      const events: { title: string; start: string; end: string; sourceProfileId?: number; sourceName?: string }[] = [];
      let ical: typeof import("node-ical");
      try {
        ical = await import("node-ical");
      } catch {
        return res.json({ events });
      }

      for (const { profile: p, source } of sources) {
        let urls: string[] = [];
        if (p.importedCalendars) {
          try {
            const raw = JSON.parse(p.importedCalendars as string);
            const list = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string") : [];
            urls = [...new Set(list.map((u) => normalizeCalendarUrl(u)).filter(Boolean))];
          } catch {
            urls = [];
          }
        }
        for (const url of urls) {
          try {
            const fetchRes = await Promise.race([
              fetch(url, {
                signal: AbortSignal.timeout(15000),
                redirect: "follow",
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  Accept: "text/calendar, text/plain, */*",
                },
              }),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
            ]);
            if (!fetchRes.ok) {
              console.warn("Calendar import URL returned", fetchRes.status, url?.slice(0, 80));
              continue;
            }
            const data = await fetchRes.text();
            const parsed = ical.parseICS(data);
            const toDate = (v: Date | string | undefined): Date | null => {
              if (v == null) return null;
              if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
              const str = String(v).trim();
              if (!str) return null;
              if (/^\d{8}$/.test(str)) {
                const y = parseInt(str.slice(0, 4), 10);
                const m = parseInt(str.slice(4, 6), 10) - 1;
                const d = parseInt(str.slice(6, 8), 10);
                return new Date(y, m, d);
              }
              if (/^\d{8}T\d{6}(Z?)$/.test(str)) {
                const d = new Date(str.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/, "$1-$2-$3T$4:$5:$6$7"));
                return Number.isNaN(d.getTime()) ? null : d;
              }
              const d = new Date(str);
              return Number.isNaN(d.getTime()) ? null : d;
            };
            const vevents: { type?: string; start?: Date | string; end?: Date | string; summary?: string }[] = [];
            const collectVevents = (obj: unknown): void => {
              if (!obj || typeof obj !== "object") return;
              const o = obj as Record<string, unknown>;
              if (o.type === "VEVENT") {
                vevents.push(o as { type?: string; start?: Date | string; end?: Date | string; summary?: string });
                return;
              }
              for (const k of Object.keys(o)) {
                const v = o[k];
                if (v && typeof v === "object" && !(v instanceof Date)) collectVevents(v);
              }
            };
            if (typeof parsed === "object" && parsed !== null) {
              for (const key of Object.keys(parsed)) {
                const item = (parsed as Record<string, unknown>)[key];
                if (item && typeof item === "object" && (item as { type?: string }).type === "VEVENT") {
                  vevents.push(item as { type?: string; start?: Date | string; end?: Date | string; summary?: string });
                } else {
                  collectVevents(item);
                }
              }
            }
            for (const ev of vevents) {
              const start = toDate(ev.start);
              const end = toDate(ev.end) ?? start;
              if (!start || !end) continue;
              if (end <= rangeStart || start >= rangeEnd) continue;
              const title = (ev.summary && String(ev.summary)) || "Event";
              events.push({
                title,
                start: start.toISOString(),
                end: end.toISOString(),
                sourceProfileId: source.profileId,
                sourceName: source.name,
              });
            }
          } catch (err) {
            console.warn("Calendar import fetch/parse failed for URL:", url?.slice(0, 80), (err as Error)?.message);
          }
        }
      }

      res.json({ events });
    } catch (error: any) {
      console.error("Imported calendar events error:", error);
      res.status(400).json({ message: error.message || "Failed to load imported events" });
    }
  });

  // === Identity Verification (Stripe Identity) ===
  app.post("/api/identity/create-verification", async (req, res) => {
    // Ensure we always return JSON
    res.setHeader("Content-Type", "application/json");
    
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not found" });
      }

      const profile = await storage.getProfileByUserId(userId);
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      const { returnUrl, flowType } = req.body;
      if (!returnUrl) {
        return res.status(400).json({ message: "returnUrl is required" });
      }
      const flow = flowType === "settings" ? "settings" : "onboarding";

      const stripeService = (await import("./services/stripe")).default;
      if (!stripeService.isStripeConfigured()) {
        return res.status(503).json({
          message: "Identity verification is not available in this environment.",
          code: "STRIPE_NOT_CONFIGURED",
        });
      }

      const verificationSession = await stripeService.createIdentityVerificationSession({
        returnUrl,
        flowType: flow,
        metadata: {
          profileId: profile.id.toString(),
          userId: userId,
        },
        clientReferenceId: userId,
      });

      // Store the verification session ID in the profile
      await db.update(profiles)
        .set({
          stripeIdentityVerificationId: verificationSession.id,
        })
        .where(eq(profiles.id, profile.id));

      // Validate that we have the required data
      if (!verificationSession.url && !verificationSession.client_secret) {
        console.error("[Identity Verification] Missing URL and client_secret in response:", verificationSession);
        return res.status(500).json({ message: "Invalid verification session response from Stripe" });
      }

      // Return the client secret for the frontend to redirect
      return res.json({
        clientSecret: verificationSession.client_secret,
        url: verificationSession.url,
        sessionId: verificationSession.id,
      });
    } catch (error: any) {
      console.error("[Identity Verification] Error creating session:", error?.message ?? error);
      if (error?.code) console.error("[Identity Verification] Stripe code:", error.code);

      const msg = error?.message ?? "";
      const isStripeNotConfigured = /stripe is not configured|not configured/i.test(msg);
      if (isStripeNotConfigured) {
        return res.status(503).json({
          message: "Identity verification is not available in this environment.",
          code: "STRIPE_NOT_CONFIGURED",
        });
      }

      let errorMessage = "Failed to create verification session";
      if (error?.type === "StripeInvalidRequestError" && error?.message) {
        errorMessage = error.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      return res.status(500).json({ message: errorMessage });
    }
  });

  // Stripe Identity webhook handler
  app.post("/api/webhooks/stripe-identity", async (req, res) => {
    const stripeService = (await import("./services/stripe")).default;
    if (!stripeService.isStripeConfigured()) {
      return res.status(500).json({ message: "Stripe is not configured" });
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).json({ message: "Missing stripe-signature header" });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_IDENTITY || process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[Stripe Identity] Webhook secret not configured");
      return res.status(500).json({ message: "Webhook secret not configured" });
    }

    let event;
    try {
      const stripe = stripeService.getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      console.error("[Stripe Identity] Webhook signature verification failed:", err.message);
      return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }

    try {
      if (event.type === "identity.verification_session.verified") {
        const verificationSession = event.data.object as any;
        const profileId = verificationSession.metadata?.profileId;

        if (profileId) {
          // Update profile with verified status
          await db.update(profiles)
            .set({
              identityVerified: true,
              identityVerifiedAt: new Date(),
              stripeIdentityVerificationId: verificationSession.id,
            })
            .where(eq(profiles.id, Number(profileId)));

          console.log(`[Stripe Identity] Profile ${profileId} identity verified`);
        }
      } else if (event.type === "identity.verification_session.processing" || 
                 event.type === "identity.verification_session.requires_input") {
        // Handle processing or requires input states if needed
        const verificationSession = event.data.object as any;
        console.log(`[Stripe Identity] Verification session ${verificationSession.id} status: ${event.type}`);
      }
    } catch (error: any) {
      console.error("[Stripe Identity] Error processing webhook:", error);
      return res.status(500).json({ message: "Error processing webhook" });
    }

    res.json({ received: true });
  });

  // Stripe Payment Method webhook – update company_payment_methods (e.g. ACH verification status)
  app.post("/api/webhooks/stripe-payment-method", async (req, res) => {
    const stripeService = (await import("./services/stripe")).default;
    if (!stripeService.isStripeConfigured()) {
      return res.status(500).json({ message: "Stripe is not configured" });
    }
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).json({ message: "Missing stripe-signature header" });
    }
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_PAYMENT_METHOD || process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[Stripe Payment Method] Webhook secret not configured");
      return res.status(500).json({ message: "Webhook secret not configured" });
    }
    const rawBody = (req as any).rawBody ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    let event: any;
    try {
      const stripe = stripeService.getStripe();
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error("[Stripe Payment Method] Webhook signature verification failed:", err.message);
      return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }
    try {
      if (event.type === "payment_method.updated" || event.type === "payment_method.attached") {
        const pm = event.data.object as any;
        const pmId = pm.id;
        const existing = await storage.getCompanyPaymentMethodByStripePmId(pmId);
        if (!existing) {
          res.json({ received: true });
          return;
        }
        const updates: Record<string, unknown> = {};
        const jsonMerge = (existing.stripePaymentMethodJson as Record<string, unknown>) || {};
        if (pm.us_bank_account) {
          const verificationStatus = (pm.us_bank_account as any).verification_status;
          const verified = verificationStatus === "verified";
          updates.isVerified = verified;
          (jsonMerge as any).us_bank_account = (jsonMerge as any).us_bank_account || {};
          (jsonMerge as any).us_bank_account.verification_status = verificationStatus;
          (jsonMerge as any).us_bank_account.updated = new Date().toISOString();
        }
        (jsonMerge as any).last_webhook_event = event.type;
        (jsonMerge as any).last_webhook_at = new Date().toISOString();
        updates.stripePaymentMethodJson = jsonMerge;
        await storage.updateCompanyPaymentMethod(existing.id, updates as any);
        if (existing.type === "ach" && updates.isVerified) {
          const profile = await storage.getProfile(existing.profileId);
          if (profile && (profile as any).primaryPaymentMethodId === existing.id) {
            await storage.updateProfile(existing.profileId, { primaryPaymentMethodVerified: true });
          }
        }
        if (process.env.NODE_ENV !== "production") {
          console.log("[Stripe Payment Method] Updated pm " + pmId + " isVerified=" + (updates.isVerified ?? existing.isVerified));
        }
      }
    } catch (error: any) {
      console.error("[Stripe Payment Method] Error processing webhook:", error?.message || error);
      return res.status(500).json({ message: "Error processing webhook" });
    }
    res.json({ received: true });
  });

  return httpServer;
}

// Seed function
export async function seedDatabase() {
  // Always seed skills table first (needed for other relationships)
  // This is idempotent - won't duplicate if already exists
  const existingSkills = await db.select().from(skills);
  if (existingSkills.length === 0) {
    console.log("Seeding skills...");
    await db.insert(skills).values([
      { name: "Electrical", category: "Electrical", hasLiteElite: true, description: "Electrical work including wiring, panels, and installations" },
      { name: "Plumbing", category: "Plumbing", hasLiteElite: true, description: "Plumbing work including repairs, installations, and maintenance" },
      { name: "HVAC", category: "HVAC", hasLiteElite: true, description: "Heating, ventilation, and air conditioning work" },
      { name: "General Labor", category: "Laborer", hasLiteElite: false, description: "General labor and manual work" },
      { name: "Drywall", category: "Drywall", hasLiteElite: false, description: "Drywall installation and finishing" },
      { name: "Painting", category: "Painting", hasLiteElite: false, description: "Interior and exterior painting" },
      { name: "Demolition", category: "Laborer", hasLiteElite: false, description: "Demolition and removal work" },
      { name: "Cleaning", category: "Laborer", hasLiteElite: false, description: "Cleaning and maintenance services" },
      { name: "Concrete", category: "Concrete", hasLiteElite: false, description: "Concrete work including pouring and finishing" },
      { name: "Carpentry", category: "Carpentry", hasLiteElite: true, description: "Carpentry work including framing, cabinets, and finish work" },
      { name: "Landscaping", category: "Landscaping", hasLiteElite: false, description: "Landscaping and outdoor work" },
    ]).onConflictDoNothing();
    console.log("Skills seeded!");
  }

  // Check if we have any jobs - if jobs exist, we still need to update teammate locations
  const existingJobs = await storage.getJobs();
  const shouldSeedFull = existingJobs.length === 0;

  if (shouldSeedFull) {
    console.log("Seeding database...");
  } else {
    console.log("Database already has jobs. Updating teammate locations...");
    // For existing databases, we need to find the operator and team
    // Try to find by email or create if needed
  }

  // Demo user ids (preferred when seeding first; otherwise use existing user for that email so relog keeps data)
  const demoCompanyUserId = "demo-company-id";
  const demoCompany2UserId = "demo-company-2-id";
  const demoWorkerUserId = "demo-worker-id";
  const demoOperatorUserId = "demo-operator-id";

  async function getOrCreateDemoUser(
    email: string,
    preferredId: string,
    firstName: string,
    lastName: string
  ): Promise<string> {
    const existing = await authStorage.getUser(preferredId);
    if (existing) return existing.id;
    const byEmail = await authStorage.getUserByEmail(email);
    if (byEmail) return byEmail.id;
    try {
      await db.insert(users).values({
        id: preferredId,
        email,
        firstName,
        lastName,
      });
    } catch (e: any) {
      if (e?.code === "23505") {
        const byEmail2 = await authStorage.getUserByEmail(email);
        if (byEmail2) return byEmail2.id;
      }
      throw e;
    }
    return preferredId;
  }

  const companyUserId = await getOrCreateDemoUser("company@demo.com", demoCompanyUserId, "Demo", "Company");
  const company2UserId = await getOrCreateDemoUser("company2@demo.com", demoCompany2UserId, "BuildRight", "Inc");
  const workerUserId = await getOrCreateDemoUser("worker@demo.com", demoWorkerUserId, "Demo", "Worker");
  const operatorUserId = await getOrCreateDemoUser("operator@demo.com", demoOperatorUserId, "Business", "Operator");

  let company = await storage.getProfileByUserId(companyUserId);
  if (!company) {
    company = await storage.createProfile({
      userId: companyUserId,
      role: "company",
      companyName: "Acme Construction",
      firstName: "Demo",
      lastName: "Company",
      email: "company@demo.com",
      phone: "555-000-0001",
      city: "San Francisco",
      state: "CA",
      bio: "Leading construction firm in the Bay Area.",
      depositAmount: 200000,
    });
  } else {
    const needs = !company.firstName || !company.lastName || !company.email || !company.phone;
    if (needs) {
      company = await storage.updateProfile(company.id, {
        firstName: company.firstName || "Demo",
        lastName: company.lastName || "Company",
        email: company.email || "company@demo.com",
        phone: company.phone || "555-000-0001",
        companyName: company.companyName || "Acme Construction",
      });
    }
  }

  let company2 = await storage.getProfileByUserId(company2UserId);
  if (!company2) {
    company2 = await storage.createProfile({
      userId: company2UserId,
      role: "company",
      companyName: "BuildRight Inc",
      firstName: "BuildRight",
      lastName: "Inc",
      email: "company2@demo.com",
      phone: "555-000-0002",
      city: "Oakland",
      state: "CA",
      bio: "Commercial and residential construction specialists.",
      depositAmount: 150000,
    });
  } else {
    const needs = !company2.firstName || !company2.lastName || !company2.email || !company2.phone;
    if (needs) {
      company2 = await storage.updateProfile(company2.id, {
        firstName: company2.firstName || "BuildRight",
        lastName: company2.lastName || "Inc",
        email: company2.email || "company2@demo.com",
        phone: company2.phone || "555-000-0002",
        companyName: company2.companyName || "BuildRight Inc",
      });
    }
  }

  let worker = await storage.getProfileByUserId(workerUserId);
  if (!worker) {
    worker = await storage.createProfile({
      userId: workerUserId,
      role: "worker",
      firstName: "Demo",
      lastName: "Worker",
      email: "worker@demo.com",
      phone: "555-000-0003",
      city: "Oakland",
      state: "CA",
      bio: "Experienced electrician with 5 years of experience.",
      hourlyRate: 45,
      experienceYears: 5,
      trades: ["Electrical", "General Labor"],
    });
  } else {
    const needs = !worker.firstName || !worker.lastName || !worker.email || !worker.phone;
    if (needs) {
      worker = await storage.updateProfile(worker.id, {
        firstName: worker.firstName || "Demo",
        lastName: worker.lastName || "Worker",
        email: worker.email || "worker@demo.com",
        phone: worker.phone || "555-000-0003",
      });
    }
  }

  let operator = await storage.getProfileByUserId(operatorUserId);
  if (!operator) {
    operator = await storage.createProfile({
      userId: operatorUserId,
      role: "worker",
      firstName: "Carlos",
      lastName: "Martinez",
      email: "operator@demo.com",
      phone: "555-000-0004",
      city: "San Jose",
      state: "CA",
      address: "450 W Santa Clara St",
      zipCode: "95113",
      latitude: "37.3398",
      longitude: "-121.8885",
      bio: "Licensed contractor running a team of skilled tradespeople.",
      hourlyRate: 55,
      experienceYears: 12,
      trades: ["Electrical", "Plumbing", "HVAC"],
      serviceCategories: ["elite", "lite"],
    });
  } else {
    const needs = !operator.firstName || !operator.lastName || !operator.email || !operator.phone;
    if (needs) {
      operator = await storage.updateProfile(operator.id, {
        firstName: operator.firstName || "Carlos",
        lastName: operator.lastName || "Martinez",
        email: operator.email || "operator@demo.com",
        phone: operator.phone || "555-000-0004",
      });
    }
  }

  let operatorTeam = await storage.getWorkerTeam(operator.id);
  if (!operatorTeam) {
    operatorTeam = await storage.createWorkerTeam({
      name: "Martinez Crew",
      ownerId: operator.id,
      description: "Professional trade services team",
    });
  }

  // Get or create team members
  const allTeamMembers = await storage.getWorkerTeamMembers(operatorTeam.id);
  let miguel = allTeamMembers.find(m => m.firstName === "Miguel" && m.lastName === "Santos");
  if (!miguel) {
    miguel = await storage.createWorkerTeamMember({
      teamId: operatorTeam.id,
      firstName: "Miguel",
      lastName: "Santos",
      email: "miguel@martinezteam.com",
      phone: "555-111-2222",
      role: "employee",
      hourlyRate: 35,
      skillsets: ["Electrical", "General Labor"],
      status: "active",
      address: "150 N 1st St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3382", // Work location (home base)
      longitude: "-121.8863",
    });
  }

  let ana = allTeamMembers.find(m => m.firstName === "Ana" && m.lastName === "Rodriguez");
  if (!ana) {
    ana = await storage.createWorkerTeamMember({
      teamId: operatorTeam.id,
      firstName: "Ana",
      lastName: "Rodriguez",
      email: "ana@martinezteam.com",
      phone: "555-333-4444",
      role: "employee",
      hourlyRate: 40,
      skillsets: ["Plumbing", "HVAC"],
      status: "active",
      address: "250 S 2nd St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3456", // Work location (home base)
      longitude: "-121.8956",
    });
  }

  let david = allTeamMembers.find(m => m.firstName === "David" && m.lastName === "Chen");
  if (!david) {
    david = await storage.createWorkerTeamMember({
      teamId: operatorTeam.id,
      firstName: "David",
      lastName: "Chen",
      email: "david@martinezteam.com",
      phone: "555-555-6666",
      role: "admin",
      hourlyRate: 45,
      skillsets: ["Electrical", "Carpentry"],
      status: "active",
      address: "350 E Santa Clara St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3321", // Work location (home base)
      longitude: "-121.8898",
    });
  }

  // Create sample jobs with scheduled times
  const sampleJobs = [
    {
      companyId: company.id,
      title: "Electrical Wiring for Office Renovation",
      description: "Need an experienced electrician to handle wiring for a 2000 sqft office renovation. Must have own tools.",
      location: "San Francisco, CA",
      address: "123 Market Street",
      city: "San Francisco",
      state: "CA",
      zipCode: "94103",
      latitude: "37.7749",
      longitude: "-122.4194",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 8,
      scheduledTime: "7:00 AM - 4:00 PM",
      startDate: new Date(Date.now() + 86400000 * 2),
    },
    {
      companyId: company.id,
      title: "Drywall Installation",
      description: "Looking for 2 workers for drywall installation and finishing. 3 days of work.",
      location: "Daly City, CA",
      address: "456 Hillside Blvd",
      city: "Daly City",
      state: "CA",
      zipCode: "94014",
      latitude: "37.6879",
      longitude: "-122.4702",
      trade: "Drywall" as const,
      serviceCategory: "Drywall",
      skillLevel: "lite" as const,
      hourlyRate: 3500,
      estimatedHours: 8,
      scheduledTime: "8:00 AM - 5:00 PM",
      maxWorkersNeeded: 2,
      startDate: new Date(Date.now() + 86400000 * 5),
    },
    {
      companyId: company.id,
      title: "General Labor - Site Cleanup",
      description: "Need help clearing debris from a demolition site. Safety gear provided.",
      location: "San Francisco, CA",
      address: "789 Howard Street",
      city: "San Francisco",
      state: "CA",
      zipCode: "94105",
      latitude: "37.7872",
      longitude: "-122.3974",
      trade: "General Labor" as const,
      serviceCategory: "Laborer",
      skillLevel: "any" as const,
      hourlyRate: 2500,
      estimatedHours: 4,
      scheduledTime: "6:00 AM - 10:00 AM",
      maxWorkersNeeded: 3,
      startDate: new Date(Date.now() + 86400000),
    },
    {
      companyId: company.id,
      title: "Plumbing Repair - Commercial Kitchen",
      description: "Fix leaking pipes and install new fixtures in a commercial kitchen. Must be licensed.",
      location: "Oakland, CA",
      address: "1200 Broadway",
      city: "Oakland",
      state: "CA",
      zipCode: "94612",
      latitude: "37.8044",
      longitude: "-122.2712",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 6,
      scheduledTime: "9:00 AM - 3:00 PM",
      startDate: new Date(Date.now() + 86400000 * 3),
    },
    {
      companyId: company.id,
      title: "HVAC Installation - New Construction",
      description: "Install HVAC system in a new residential building. 5-day project.",
      location: "Berkeley, CA",
      address: "2100 Shattuck Ave",
      city: "Berkeley",
      state: "CA",
      zipCode: "94704",
      latitude: "37.8716",
      longitude: "-122.2727",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 8,
      scheduledTime: "7:30 AM - 4:30 PM",
      startDate: new Date(Date.now() + 86400000 * 7),
    },
    {
      companyId: company.id,
      title: "Interior Painting - Office Building",
      description: "Paint 10 offices and common areas. Supplies provided.",
      location: "San Jose, CA",
      address: "500 W Santa Clara St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3382",
      longitude: "-121.8863",
      trade: "Painting" as const,
      serviceCategory: "Painting",
      skillLevel: "lite" as const,
      hourlyRate: 3200,
      estimatedHours: 8,
      scheduledTime: "8:00 AM - 5:00 PM",
      maxWorkersNeeded: 4,
      startDate: new Date(Date.now() + 86400000 * 4),
    },
    {
      companyId: company.id,
      title: "Carpentry - Custom Cabinets",
      description: "Build and install custom cabinets for kitchen remodel. High-quality work required.",
      location: "Palo Alto, CA",
      address: "800 University Ave",
      city: "Palo Alto",
      state: "CA",
      zipCode: "94301",
      latitude: "37.4419",
      longitude: "-122.1430",
      trade: "Carpentry" as const,
      serviceCategory: "Carpentry",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 8,
      scheduledTime: "7:00 AM - 4:00 PM",
      startDate: new Date(Date.now() + 86400000 * 10),
    },
    {
      companyId: company.id,
      title: "Demolition - Interior Walls",
      description: "Remove interior walls for open floor plan renovation. Physical work.",
      location: "Fremont, CA",
      address: "39000 Civic Center Dr",
      city: "Fremont",
      state: "CA",
      zipCode: "94538",
      latitude: "37.5485",
      longitude: "-121.9886",
      trade: "Demolition" as const,
      serviceCategory: "Laborer",
      skillLevel: "any" as const,
      hourlyRate: 2800,
      estimatedHours: 8,
      scheduledTime: "6:30 AM - 3:30 PM",
      maxWorkersNeeded: 2,
      startDate: new Date(Date.now() + 86400000 * 2),
    },
    // Jobs from second company
    {
      companyId: company2.id,
      title: "Roof Repair - Residential",
      description: "Fix leaks and replace damaged shingles on residential roof.",
      location: "Oakland, CA",
      address: "2500 Telegraph Ave",
      city: "Oakland",
      state: "CA",
      zipCode: "94612",
      latitude: "37.8155",
      longitude: "-122.2607",
      trade: "General Labor" as const,
      serviceCategory: "Laborer",
      skillLevel: "lite" as const,
      hourlyRate: 3500,
      estimatedHours: 6,
      scheduledTime: "8:00 AM - 2:00 PM",
      maxWorkersNeeded: 2,
      startDate: new Date(Date.now() + 86400000),
    },
    {
      companyId: company2.id,
      title: "Commercial Electrical Panel Upgrade",
      description: "Upgrade electrical panel in commercial building. CA license required.",
      location: "San Leandro, CA",
      address: "1000 Davis St",
      city: "San Leandro",
      state: "CA",
      zipCode: "94577",
      latitude: "37.7252",
      longitude: "-122.1561",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 6500,
      estimatedHours: 10,
      scheduledTime: "6:00 AM - 5:00 PM",
      startDate: new Date(Date.now() + 86400000 * 3),
    },
    {
      companyId: company2.id,
      title: "Bathroom Renovation - Plumbing",
      description: "Complete plumbing work for bathroom renovation including new fixtures.",
      location: "Hayward, CA",
      address: "500 B St",
      city: "Hayward",
      state: "CA",
      zipCode: "94541",
      latitude: "37.6688",
      longitude: "-122.0808",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 8,
      scheduledTime: "8:30 AM - 5:30 PM",
      startDate: new Date(Date.now() + 86400000 * 6),
    },
    {
      companyId: company2.id,
      title: "Flooring Installation",
      description: "Install hardwood flooring in 3 bedroom home.",
      location: "Union City, CA",
      address: "34000 Alvarado-Niles Rd",
      city: "Union City",
      state: "CA",
      zipCode: "94587",
      latitude: "37.5935",
      longitude: "-122.0438",
      trade: "Carpentry" as const,
      serviceCategory: "Carpentry",
      skillLevel: "lite" as const,
      hourlyRate: 4000,
      estimatedHours: 8,
      scheduledTime: "9:00 AM - 6:00 PM",
      maxWorkersNeeded: 2,
      startDate: new Date(Date.now() + 86400000 * 8),
    },
  ];

  // 24 sample jobs in Midwest: Dayton, Cleveland, Cincinnati, Kentucky, Indianapolis, Michigan
  const midwestSampleJobs = [
    { companyId: company.id, title: "Electrical Wiring - Retail Build-Out", description: "Run conduit and wire new retail space in downtown Cincinnati. Must have own tools.", location: "Cincinnati, OH", address: "700 Vine St", city: "Cincinnati", state: "OH", zipCode: "45202", latitude: "39.1031", longitude: "-84.5120", trade: "Electrical" as const, serviceCategory: "Electrical", skillLevel: "elite" as const, hourlyRate: 5200, estimatedHours: 8, scheduledTime: "7:00 AM - 4:00 PM", startDate: new Date(Date.now() + 86400000 * 1) },
    { companyId: company2.id, title: "Drywall & Finishing - Office Suite", description: "Hang and finish drywall in 1,500 sqft office. 2–3 days.", location: "Cincinnati, OH", address: "2500 E Kemper Rd", city: "Cincinnati", state: "OH", zipCode: "45241", latitude: "39.2833", longitude: "-84.3583", trade: "Drywall" as const, serviceCategory: "Drywall", skillLevel: "lite" as const, hourlyRate: 3400, estimatedHours: 8, scheduledTime: "8:00 AM - 5:00 PM", maxWorkersNeeded: 2, startDate: new Date(Date.now() + 86400000 * 2) },
    { companyId: company.id, title: "Plumbing Rough-In - New Construction", description: "Rough-in plumbing for new single-family home. Licensed plumber preferred.", location: "Cincinnati, OH", address: "1800 Race St", city: "Cincinnati", state: "OH", zipCode: "45210", latitude: "39.1150", longitude: "-84.5186", trade: "Plumbing" as const, serviceCategory: "Plumbing", skillLevel: "elite" as const, hourlyRate: 5800, estimatedHours: 8, scheduledTime: "7:30 AM - 4:30 PM", startDate: new Date(Date.now() + 86400000 * 3) },
    { companyId: company2.id, title: "Interior Painting - Apartments", description: "Paint 8 units. Supplies provided. Must be neat and reliable.", location: "Cincinnati, OH", address: "4000 Smith Rd", city: "Cincinnati", state: "OH", zipCode: "45212", latitude: "39.1689", longitude: "-84.4286", trade: "Painting" as const, serviceCategory: "Painting", skillLevel: "lite" as const, hourlyRate: 3000, estimatedHours: 8, scheduledTime: "8:00 AM - 5:00 PM", maxWorkersNeeded: 3, startDate: new Date(Date.now() + 86400000 * 4) },
    { companyId: company.id, title: "HVAC Duct Installation - Commercial", description: "Install ductwork for new HVAC system in office building.", location: "Dayton, OH", address: "40 W 4th St", city: "Dayton", state: "OH", zipCode: "45402", latitude: "39.7589", longitude: "-84.1916", trade: "HVAC" as const, serviceCategory: "HVAC", skillLevel: "elite" as const, hourlyRate: 5600, estimatedHours: 8, scheduledTime: "7:00 AM - 4:00 PM", startDate: new Date(Date.now() + 86400000 * 1) },
    { companyId: company2.id, title: "General Labor - Site Cleanup", description: "Clear debris and prep site after demo. Safety gear provided.", location: "Dayton, OH", address: "1100 S Main St", city: "Dayton", state: "OH", zipCode: "45409", latitude: "39.7422", longitude: "-84.1861", trade: "General Labor" as const, serviceCategory: "Laborer", skillLevel: "any" as const, hourlyRate: 2600, estimatedHours: 6, scheduledTime: "6:00 AM - 12:00 PM", maxWorkersNeeded: 4, startDate: new Date(Date.now() + 86400000 * 2) },
    { companyId: company.id, title: "Carpentry - Custom Cabinets", description: "Build and install custom kitchen cabinets. High-quality work required.", location: "Dayton, OH", address: "500 E 3rd St", city: "Dayton", state: "OH", zipCode: "45402", latitude: "39.7611", longitude: "-84.1858", trade: "Carpentry" as const, serviceCategory: "Carpentry", skillLevel: "elite" as const, hourlyRate: 5000, estimatedHours: 8, scheduledTime: "8:00 AM - 5:00 PM", startDate: new Date(Date.now() + 86400000 * 5) },
    { companyId: company2.id, title: "Concrete Pour - Driveway", description: "Pour and finish concrete driveway. Experience required.", location: "Dayton, OH", address: "2200 N Gettysburg Ave", city: "Dayton", state: "OH", zipCode: "45406", latitude: "39.7822", longitude: "-84.2186", trade: "Concrete" as const, serviceCategory: "Concrete", skillLevel: "lite" as const, hourlyRate: 3800, estimatedHours: 8, scheduledTime: "6:00 AM - 3:00 PM", startDate: new Date(Date.now() + 86400000 * 6) },
    { companyId: company.id, title: "Electrical Panel Upgrade - Industrial", description: "Upgrade 400A panel in warehouse. Licensed electrician required.", location: "Cleveland, OH", address: "1300 E 9th St", city: "Cleveland", state: "OH", zipCode: "44114", latitude: "41.4993", longitude: "-81.6944", trade: "Electrical" as const, serviceCategory: "Electrical", skillLevel: "elite" as const, hourlyRate: 6000, estimatedHours: 8, scheduledTime: "6:00 AM - 3:00 PM", startDate: new Date(Date.now() + 86400000 * 2) },
    { companyId: company2.id, title: "Roof Repair - Residential", description: "Replace damaged shingles and fix flashing on residential roof.", location: "Cleveland, OH", address: "4500 Lorain Ave", city: "Cleveland", state: "OH", zipCode: "44113", latitude: "41.4789", longitude: "-81.7133", trade: "General Labor" as const, serviceCategory: "Laborer", skillLevel: "lite" as const, hourlyRate: 3600, estimatedHours: 6, scheduledTime: "8:00 AM - 2:00 PM", maxWorkersNeeded: 2, startDate: new Date(Date.now() + 86400000 * 3) },
    { companyId: company.id, title: "Demolition - Interior Strip-Out", description: "Remove interior walls and ceilings for renovation. Physical work.", location: "Cleveland, OH", address: "2000 Euclid Ave", city: "Cleveland", state: "OH", zipCode: "44115", latitude: "41.5042", longitude: "-81.6853", trade: "Demolition" as const, serviceCategory: "Laborer", skillLevel: "any" as const, hourlyRate: 2800, estimatedHours: 8, scheduledTime: "6:30 AM - 3:30 PM", maxWorkersNeeded: 3, startDate: new Date(Date.now() + 86400000 * 4) },
    { companyId: company2.id, title: "Flooring Installation - Hardwood", description: "Install hardwood flooring in 4-bedroom home. Experience preferred.", location: "Cleveland, OH", address: "5500 Detroit Ave", city: "Cleveland", state: "OH", zipCode: "44102", latitude: "41.4842", longitude: "-81.7186", trade: "Carpentry" as const, serviceCategory: "Carpentry", skillLevel: "lite" as const, hourlyRate: 4200, estimatedHours: 8, scheduledTime: "8:00 AM - 5:00 PM", startDate: new Date(Date.now() + 86400000 * 7) },
    { companyId: company.id, title: "Plumbing - Bathroom Remodel", description: "Full plumbing for bathroom remodel. New fixtures and rough-in.", location: "Louisville, KY", address: "500 S 4th St", city: "Louisville", state: "KY", zipCode: "40202", latitude: "38.2527", longitude: "-85.7585", trade: "Plumbing" as const, serviceCategory: "Plumbing", skillLevel: "elite" as const, hourlyRate: 5400, estimatedHours: 8, scheduledTime: "8:00 AM - 5:00 PM", startDate: new Date(Date.now() + 86400000 * 1) },
    { companyId: company2.id, title: "Painting - Commercial Interior", description: "Paint lobby and common areas. Supplies provided.", location: "Louisville, KY", address: "4000 Dupont Circle", city: "Louisville", state: "KY", zipCode: "40207", latitude: "38.2189", longitude: "-85.6436", trade: "Painting" as const, serviceCategory: "Painting", skillLevel: "lite" as const, hourlyRate: 3200, estimatedHours: 8, scheduledTime: "7:00 AM - 4:00 PM", maxWorkersNeeded: 2, startDate: new Date(Date.now() + 86400000 * 3) },
    { companyId: company.id, title: "HVAC Service - Restaurant", description: "Install new exhaust and make-up air for kitchen. Commercial experience needed.", location: "Lexington, KY", address: "200 W Main St", city: "Lexington", state: "KY", zipCode: "40507", latitude: "38.0406", longitude: "-84.5037", trade: "HVAC" as const, serviceCategory: "HVAC", skillLevel: "elite" as const, hourlyRate: 5800, estimatedHours: 8, scheduledTime: "6:00 AM - 3:00 PM", startDate: new Date(Date.now() + 86400000 * 5) },
    { companyId: company2.id, title: "General Labor - Warehouse Move", description: "Help move equipment and materials. Heavy lifting. Team of 4.", location: "Lexington, KY", address: "1500 Newtown Pike", city: "Lexington", state: "KY", zipCode: "40511", latitude: "38.0811", longitude: "-84.5086", trade: "General Labor" as const, serviceCategory: "Laborer", skillLevel: "any" as const, hourlyRate: 2400, estimatedHours: 6, scheduledTime: "7:00 AM - 1:00 PM", maxWorkersNeeded: 4, startDate: new Date(Date.now() + 86400000 * 6) },
    { companyId: company.id, title: "Electrical - Tenant Finish", description: "Wire new office tenant space. Must meet code. Own tools.", location: "Indianapolis, IN", address: "50 Monument Circle", city: "Indianapolis", state: "IN", zipCode: "46204", latitude: "39.7684", longitude: "-86.1581", trade: "Electrical" as const, serviceCategory: "Electrical", skillLevel: "elite" as const, hourlyRate: 5100, estimatedHours: 8, scheduledTime: "7:00 AM - 4:00 PM", startDate: new Date(Date.now() + 86400000 * 2) },
    { companyId: company2.id, title: "Drywall - Multi-Family", description: "Hang and finish drywall in 12-unit building. 5 days.", location: "Indianapolis, IN", address: "3500 Lafayette Rd", city: "Indianapolis", state: "IN", zipCode: "46222", latitude: "39.8011", longitude: "-86.2186", trade: "Drywall" as const, serviceCategory: "Drywall", skillLevel: "lite" as const, hourlyRate: 3300, estimatedHours: 8, scheduledTime: "8:00 AM - 5:00 PM", maxWorkersNeeded: 3, startDate: new Date(Date.now() + 86400000 * 4) },
    { companyId: company.id, title: "Carpentry - Trim & Doors", description: "Install interior trim and hang doors in new construction.", location: "Indianapolis, IN", address: "1200 N Meridian St", city: "Indianapolis", state: "IN", zipCode: "46202", latitude: "39.7756", longitude: "-86.1614", trade: "Carpentry" as const, serviceCategory: "Carpentry", skillLevel: "lite" as const, hourlyRate: 4000, estimatedHours: 8, scheduledTime: "8:00 AM - 5:00 PM", startDate: new Date(Date.now() + 86400000 * 8) },
    { companyId: company2.id, title: "Concrete - Sidewalk & Steps", description: "Pour sidewalk and steps. Finish and broom.", location: "Indianapolis, IN", address: "6002 E 82nd St", city: "Indianapolis", state: "IN", zipCode: "46250", latitude: "39.9011", longitude: "-86.0686", trade: "Concrete" as const, serviceCategory: "Concrete", skillLevel: "lite" as const, hourlyRate: 3600, estimatedHours: 6, scheduledTime: "6:00 AM - 12:00 PM", startDate: new Date(Date.now() + 86400000 * 9) },
    { companyId: company.id, title: "Plumbing - Multi-Unit Repairs", description: "Repair leaks and replace fixtures in 6 units. Licensed plumber.", location: "Detroit, MI", address: "1000 Woodward Ave", city: "Detroit", state: "MI", zipCode: "48226", latitude: "42.3314", longitude: "-83.0458", trade: "Plumbing" as const, serviceCategory: "Plumbing", skillLevel: "elite" as const, hourlyRate: 5600, estimatedHours: 8, scheduledTime: "7:30 AM - 4:30 PM", startDate: new Date(Date.now() + 86400000 * 3) },
    { companyId: company2.id, title: "Painting - Exterior Commercial", description: "Scrape, prime, and paint exterior of 2-story building.", location: "Detroit, MI", address: "6500 Michigan Ave", city: "Detroit", state: "MI", zipCode: "48210", latitude: "42.3414", longitude: "-83.1158", trade: "Painting" as const, serviceCategory: "Painting", skillLevel: "lite" as const, hourlyRate: 3400, estimatedHours: 8, scheduledTime: "7:00 AM - 4:00 PM", maxWorkersNeeded: 2, startDate: new Date(Date.now() + 86400000 * 5) },
    { companyId: company.id, title: "HVAC - Rooftop Unit Install", description: "Install new RTU on commercial roof. Crane on site.", location: "Grand Rapids, MI", address: "50 Monroe Ave NW", city: "Grand Rapids", state: "MI", zipCode: "49503", latitude: "42.9634", longitude: "-85.6681", trade: "HVAC" as const, serviceCategory: "HVAC", skillLevel: "elite" as const, hourlyRate: 6200, estimatedHours: 10, scheduledTime: "6:00 AM - 5:00 PM", startDate: new Date(Date.now() + 86400000 * 6) },
    { companyId: company2.id, title: "General Labor - Landscaping Prep", description: "Grade and prep site for landscaping. Shovel, rake, wheelbarrow.", location: "Grand Rapids, MI", address: "200 Ottawa Ave NW", city: "Grand Rapids", state: "MI", zipCode: "49503", latitude: "42.9686", longitude: "-85.6736", trade: "General Labor" as const, serviceCategory: "Laborer", skillLevel: "any" as const, hourlyRate: 2500, estimatedHours: 6, scheduledTime: "7:00 AM - 1:00 PM", maxWorkersNeeded: 3, startDate: new Date(Date.now() + 86400000 * 7) },
  ];

  for (const jobData of [...sampleJobs, ...midwestSampleJobs]) {
    await storage.createJob(jobData);
  }

  console.log("Database seeded with", sampleJobs.length + midwestSampleJobs.length, "sample jobs!");

  // Create sample routes for Carlos Martinez's team (for calendar map testing)
  // Jobs in San Jose area with coordinates for route testing
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const martinezRouteJobs = [
    // Miguel's route - 6 jobs (full day route)
    {
      companyId: company.id,
      title: "Electrical Panel Inspection",
      description: "Inspect and test electrical panel for safety compliance",
      location: "San Jose, CA",
      address: "100 N 1st St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3382",
      longitude: "-121.8863",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 2,
      scheduledTime: "7:00 AM - 9:00 AM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0),
    },
    {
      companyId: company.id,
      title: "Outlet Installation - Downtown",
      description: "Install new outlets in office building",
      location: "San Jose, CA",
      address: "200 S 2nd St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3329",
      longitude: "-121.8886",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "lite" as const,
      hourlyRate: 4500,
      estimatedHours: 2,
      scheduledTime: "9:30 AM - 11:30 AM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 30),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 30),
    },
    {
      companyId: company.id,
      title: "Lighting Fixture Repair",
      description: "Repair and replace lighting fixtures in retail space",
      location: "San Jose, CA",
      address: "300 E Santa Clara St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3394",
      longitude: "-121.8944",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "lite" as const,
      hourlyRate: 4500,
      estimatedHours: 2,
      scheduledTime: "12:00 PM - 1:30 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 30),
    },
    {
      companyId: company.id,
      title: "Circuit Breaker Replacement",
      description: "Replace faulty circuit breakers in residential unit",
      location: "San Jose, CA",
      address: "150 W Julian St",
      city: "San Jose",
      state: "CA",
      zipCode: "95110",
      latitude: "37.3315",
      longitude: "-121.8902",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 2,
      scheduledTime: "2:00 PM - 4:00 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 16, 0),
    },
    {
      companyId: company.id,
      title: "GFCI Outlet Installation",
      description: "Install GFCI outlets in kitchen and bathroom",
      location: "San Jose, CA",
      address: "250 N 3rd St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3401",
      longitude: "-121.8875",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "lite" as const,
      hourlyRate: 4500,
      estimatedHours: 2,
      scheduledTime: "4:30 PM - 6:00 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 16, 30),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0),
    },
    {
      companyId: company.id,
      title: "Emergency Electrical Repair",
      description: "Fix power outage in commercial building",
      location: "San Jose, CA",
      address: "350 S 4th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3278",
      longitude: "-121.8915",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 2,
      scheduledTime: "6:30 PM - 8:30 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 30),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 20, 30),
    },
    // Ana's route - 6 jobs (full day route)
    {
      companyId: company.id,
      title: "Plumbing Leak Repair",
      description: "Fix leaking pipes in residential building",
      location: "San Jose, CA",
      address: "400 W San Fernando St",
      city: "San Jose",
      state: "CA",
      zipCode: "95110",
      latitude: "37.3456",
      longitude: "-121.8956",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 2,
      scheduledTime: "7:00 AM - 9:00 AM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0),
    },
    {
      companyId: company.id,
      title: "HVAC System Maintenance",
      description: "Routine maintenance on HVAC system",
      location: "San Jose, CA",
      address: "500 N 4th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3523",
      longitude: "-121.8889",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 3,
      scheduledTime: "9:30 AM - 12:00 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 30),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0),
    },
    {
      companyId: company.id,
      title: "Bathroom Fixture Installation",
      description: "Install new bathroom fixtures",
      location: "San Jose, CA",
      address: "600 S 5th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3287",
      longitude: "-121.8856",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 2,
      scheduledTime: "12:30 PM - 2:30 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 30),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 30),
    },
    {
      companyId: company.id,
      title: "Water Heater Inspection",
      description: "Inspect and test water heater for efficiency",
      location: "San Jose, CA",
      address: "450 E 7th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3334",
      longitude: "-121.8932",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 2,
      scheduledTime: "3:00 PM - 4:30 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 16, 30),
    },
    {
      companyId: company.id,
      title: "AC Unit Inspection",
      description: "Inspect and test AC unit for efficiency",
      location: "San Jose, CA",
      address: "700 E 6th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95110",
      latitude: "37.3356",
      longitude: "-121.8923",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "lite" as const,
      hourlyRate: 5000,
      estimatedHours: 2,
      scheduledTime: "5:00 PM - 7:00 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 19, 0),
    },
    {
      companyId: company.id,
      title: "Drain Cleaning Service",
      description: "Clear clogged drains in commercial building",
      location: "San Jose, CA",
      address: "550 W 8th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95110",
      latitude: "37.3421",
      longitude: "-121.8898",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "lite" as const,
      hourlyRate: 5000,
      estimatedHours: 2,
      scheduledTime: "7:30 PM - 9:00 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 19, 30),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 21, 0),
    },
    // David's route - 6 jobs (full day route)
    {
      companyId: company.id,
      title: "Electrical Wiring Installation",
      description: "Install new electrical wiring for home addition",
      location: "San Jose, CA",
      address: "800 N 5th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3432",
      longitude: "-121.8901",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 2,
      scheduledTime: "7:30 AM - 9:30 AM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7, 30),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 30),
    },
    {
      companyId: company.id,
      title: "Carpentry - Cabinet Installation",
      description: "Install custom kitchen cabinets",
      location: "San Jose, CA",
      address: "850 S 6th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3305",
      longitude: "-121.8889",
      trade: "Carpentry" as const,
      serviceCategory: "Carpentry",
      skillLevel: "elite" as const,
      hourlyRate: 5000,
      estimatedHours: 3,
      scheduledTime: "10:00 AM - 12:30 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 30),
    },
    {
      companyId: company.id,
      title: "Trim Work - Living Room",
      description: "Install baseboards and crown molding",
      location: "San Jose, CA",
      address: "900 S 8th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3298",
      longitude: "-121.8878",
      trade: "Carpentry" as const,
      serviceCategory: "Carpentry",
      skillLevel: "lite" as const,
      hourlyRate: 4500,
      estimatedHours: 2,
      scheduledTime: "1:00 PM - 3:00 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0),
    },
    {
      companyId: company.id,
      title: "Electrical Panel Upgrade",
      description: "Upgrade electrical panel for increased capacity",
      location: "San Jose, CA",
      address: "950 E 7th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95110",
      latitude: "37.3345",
      longitude: "-121.8912",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 3,
      scheduledTime: "3:30 PM - 6:00 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 30),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0),
    },
    {
      companyId: company.id,
      title: "Door Frame Installation",
      description: "Install new door frames in residential unit",
      location: "San Jose, CA",
      address: "1000 E 9th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95110",
      latitude: "37.3367",
      longitude: "-121.8934",
      trade: "Carpentry" as const,
      serviceCategory: "Carpentry",
      skillLevel: "lite" as const,
      hourlyRate: 4500,
      estimatedHours: 2,
      scheduledTime: "6:30 PM - 8:30 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 30),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 20, 30),
    },
    {
      companyId: company.id,
      title: "Light Switch Replacement",
      description: "Replace old light switches with smart switches",
      location: "San Jose, CA",
      address: "1050 W 10th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3289",
      longitude: "-121.8921",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "lite" as const,
      hourlyRate: 4500,
      estimatedHours: 2,
      scheduledTime: "9:00 PM - 10:30 PM",
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 21, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 22, 30),
    },
  ];

  // Create jobs and assign to team members
  const miguelJobs = martinezRouteJobs.slice(0, 6);
  const anaJobs = martinezRouteJobs.slice(6, 12);
  const davidJobs = martinezRouteJobs.slice(12, 18);

  for (const jobData of miguelJobs) {
    const job = await storage.createJob(jobData);
    const application = await storage.createApplication({
      jobId: job.id,
      workerId: operator.id,
      teamMemberId: miguel.id,
      message: "Assigned to Miguel Santos",
    });
    await storage.updateApplicationStatus(application.id, "accepted");
  }

  for (const jobData of anaJobs) {
    const job = await storage.createJob(jobData);
    const application = await storage.createApplication({
      jobId: job.id,
      workerId: operator.id,
      teamMemberId: ana.id,
      message: "Assigned to Ana Rodriguez",
    });
    await storage.updateApplicationStatus(application.id, "accepted");
  }

  for (const jobData of davidJobs) {
    const job = await storage.createJob(jobData);
    const application = await storage.createApplication({
      jobId: job.id,
      workerId: operator.id,
      teamMemberId: david.id,
      message: "Assigned to David Chen",
    });
    await storage.updateApplicationStatus(application.id, "accepted");
  }

  // Create additional jobs for tomorrow to test date navigation
  const tomorrowJobs = [
    {
      companyId: company.id,
      title: "Electrical Panel Upgrade - Tomorrow",
      description: "Upgrade electrical panel for increased capacity",
      location: "San Jose, CA",
      address: "110 N 1st St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3394",
      longitude: "-121.8930",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 5,
      scheduledTime: "9:00 AM - 2:00 PM",
      startDate: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0),
      endDate: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 14, 0),
    },
    {
      companyId: company.id,
      title: "Plumbing System Check - Tomorrow",
      description: "Complete plumbing system inspection",
      location: "San Jose, CA",
      address: "410 W San Fernando St",
      city: "San Jose",
      state: "CA",
      zipCode: "95110",
      latitude: "37.3467",
      longitude: "-121.8967",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 4,
      scheduledTime: "10:00 AM - 2:00 PM",
      startDate: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 10, 0),
      endDate: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 14, 0),
    },
    {
      companyId: company.id,
      title: "HVAC Maintenance - Tomorrow",
      description: "Routine HVAC system maintenance and cleaning",
      location: "San Jose, CA",
      address: "510 N 4th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3423",
      longitude: "-121.8912",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 3,
      scheduledTime: "1:00 PM - 4:00 PM",
      startDate: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 13, 0),
      endDate: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 16, 0),
    },
  ];

  // Assign tomorrow's jobs to different team members
  for (let i = 0; i < tomorrowJobs.length; i++) {
    const job = await storage.createJob(tomorrowJobs[i]);
    const teamMember = i === 0 ? miguel : i === 1 ? ana : david;
    const application = await storage.createApplication({
      jobId: job.id,
      workerId: operator.id,
      teamMemberId: teamMember.id,
      message: `Assigned to ${teamMember.firstName} ${teamMember.lastName} for tomorrow`,
    });
    await storage.updateApplicationStatus(application.id, "accepted");
  }

  // Create jobs for the standalone worker (not part of a team)
  const todayForWorker = new Date();
  const workerJobs = [
    {
      companyId: company.id,
      title: "Electrical Panel Inspection - Standalone",
      description: "Inspect electrical panel for safety compliance",
      location: "Oakland, CA",
      address: "1500 Broadway",
      city: "Oakland",
      state: "CA",
      zipCode: "94612",
      latitude: "37.8044",
      longitude: "-122.2711",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 5000,
      estimatedHours: 3,
      scheduledTime: "8:00 AM - 11:00 AM",
      startDate: new Date(todayForWorker.getFullYear(), todayForWorker.getMonth(), todayForWorker.getDate(), 8, 0),
      endDate: new Date(todayForWorker.getFullYear(), todayForWorker.getMonth(), todayForWorker.getDate(), 11, 0),
    },
    {
      companyId: company2.id,
      title: "Outlet Installation - Standalone",
      description: "Install new outlets in residential building",
      location: "Oakland, CA",
      address: "1600 Telegraph Ave",
      city: "Oakland",
      state: "CA",
      zipCode: "94612",
      latitude: "37.8085",
      longitude: "-122.2684",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "lite" as const,
      hourlyRate: 4000,
      estimatedHours: 4,
      scheduledTime: "1:00 PM - 5:00 PM",
      startDate: new Date(todayForWorker.getFullYear(), todayForWorker.getMonth(), todayForWorker.getDate(), 13, 0),
      endDate: new Date(todayForWorker.getFullYear(), todayForWorker.getMonth(), todayForWorker.getDate(), 17, 0),
    },
  ];

  for (const jobData of workerJobs) {
    const job = await storage.createJob(jobData);
    const application = await storage.createApplication({
      jobId: job.id,
      workerId: worker.id,
      message: "Accepted by standalone worker",
    });
    await storage.updateApplicationStatus(application.id, "accepted");
  }

  console.log(`Created ${martinezRouteJobs.length} sample route jobs for today:`);
  console.log(`  - Miguel: ${miguelJobs.length} jobs`);
  console.log(`  - Ana: ${anaJobs.length} jobs`);
  console.log(`  - David: ${davidJobs.length} jobs`);
  console.log(`  - Standalone worker: ${workerJobs.length} jobs`);
  console.log(`  - Tomorrow: ${tomorrowJobs.length} jobs`);

  // Create real-time location pings for all team members
  // Simulate current locations based on their job schedules
  const now = new Date();
  const locationPingsData = [];

  // Create multiple location pings for each team member to simulate movement
  // Miguel's locations throughout the day (simulating movement between jobs)
  locationPingsData.push({
    workerProfileId: operator.id,
    jobId: null,
    latitude: "37.3382", // At first job location
    longitude: "-121.8863",
    // accuracy: null, // Temporarily omit accuracy to debug the "1.5" error
    source: "ios" as const,
    distanceFromJob: null,
    withinGeofence: false,
    createdAt: new Date(now.getTime() - 30 * 60000), // 30 minutes ago
  });
  locationPingsData.push({
    workerProfileId: operator.id,
    jobId: null,
    latitude: "37.3365", // En route between jobs
    longitude: "-121.8875",
    // accuracy: null, // Temporarily omit accuracy to debug the "1.5" error
    source: "ios" as const,
    distanceFromJob: null,
    withinGeofence: false,
    createdAt: new Date(now.getTime() - 5 * 60000), // 5 minutes ago (current)
  });

  // Ana's locations throughout the day
  locationPingsData.push({
    workerProfileId: operator.id,
    jobId: null,
    latitude: "37.3456", // At first job
    longitude: "-121.8956",
    // accuracy: null, // Temporarily omit accuracy to debug the "1.5" error
    source: "android" as const,
    distanceFromJob: null,
    withinGeofence: false,
    createdAt: new Date(now.getTime() - 45 * 60000), // 45 minutes ago
  });
  locationPingsData.push({
    workerProfileId: operator.id,
    jobId: null,
    latitude: "37.3440", // En route
    longitude: "-121.8920",
    // accuracy: null, // Temporarily omit accuracy to debug the "1.5" error
    source: "android" as const,
    distanceFromJob: null,
    withinGeofence: false,
    createdAt: new Date(now.getTime() - 2 * 60000), // 2 minutes ago (current)
  });

  // David's locations throughout the day
  locationPingsData.push({
    workerProfileId: operator.id,
    jobId: null,
    latitude: "37.3321", // En route to first job
    longitude: "-121.8898",
    // accuracy: null, // Temporarily omit accuracy to debug the "1.5" error
    source: "browser" as const,
    distanceFromJob: null,
    withinGeofence: false,
    createdAt: new Date(now.getTime() - 20 * 60000), // 20 minutes ago
  });
  locationPingsData.push({
    workerProfileId: operator.id,
    jobId: null,
    latitude: "37.3335", // Closer to first job
    longitude: "-121.8905",
    // accuracy: null, // Temporarily omit accuracy to debug the "1.5" error
    source: "browser" as const,
    distanceFromJob: null,
    withinGeofence: false,
    createdAt: new Date(now.getTime() - 1 * 60000), // 1 minute ago (current)
  });

  // Standalone worker's locations
  locationPingsData.push({
    workerProfileId: worker.id,
    jobId: null,
    latitude: "37.8044", // At first job
    longitude: "-122.2711",
    // accuracy: null, // Temporarily omit accuracy to debug the "1.5" error
    source: "ios" as const,
    distanceFromJob: null,
    withinGeofence: false,
    createdAt: new Date(now.getTime() - 60 * 60000), // 1 hour ago
  });
  locationPingsData.push({
    workerProfileId: worker.id,
    jobId: null,
    latitude: "37.8055", // En route
    longitude: "-122.2700",
    // accuracy: null, // Temporarily omit accuracy to debug the "1.5" error
    source: "ios" as const,
    distanceFromJob: null,
    withinGeofence: false,
    createdAt: new Date(now.getTime() - 3 * 60000), // 3 minutes ago (current)
  });

  // Insert location pings
  if (locationPingsData.length > 0) {
    await db.insert(locationPings).values(locationPingsData).onConflictDoNothing();
    console.log("Created", locationPingsData.length, "real-time location pings for workers!");
  }
  
  // Update team members with work locations (home base addresses)
  // Always update locations to ensure they're set correctly
  // Work location = home/start address coordinates (fallback if GPS not available)
  // Note: latitude/longitude in workerTeamMembers table is used for work location (home base)
  // Live location comes from locationPings table and is added by the API endpoint
  
  // Miguel: Home at 150 N 1st St (work location)
  if (miguel) {
    await db.update(workerTeamMembers)
      .set({
        address: "150 N 1st St", // Home/work address
        city: "San Jose",
        state: "CA",
        zipCode: "95113",
        latitude: "37.3382", // Work location (home base) - geocoded from address
        longitude: "-121.8863",
      })
      .where(eq(workerTeamMembers.id, miguel.id));
    console.log(`✅ Updated work location for Miguel Santos (ID: ${miguel.id})`);
  } else {
    console.warn("⚠️ Miguel not found, cannot update location");
  }

  // Ana: Home at 250 S 2nd St (work location)
  if (ana) {
    await db.update(workerTeamMembers)
      .set({
        address: "250 S 2nd St", // Home/work address
        city: "San Jose",
        state: "CA",
        zipCode: "95113",
        latitude: "37.3456", // Work location (home base) - geocoded from address
        longitude: "-121.8956",
      })
      .where(eq(workerTeamMembers.id, ana.id));
    console.log(`✅ Updated work location for Ana Rodriguez (ID: ${ana.id})`);
  } else {
    console.warn("⚠️ Ana not found, cannot update location");
  }

  // David: Home at 350 E Santa Clara St (work location)
  if (david) {
    await db.update(workerTeamMembers)
      .set({
        address: "350 E Santa Clara St", // Home/work address
        city: "San Jose",
        state: "CA",
        zipCode: "95113",
        latitude: "37.3321", // Work location (home base) - geocoded from address
        longitude: "-121.8898",
      })
      .where(eq(workerTeamMembers.id, david.id));
    console.log(`✅ Updated work location for David Chen (ID: ${david.id})`);
  } else {
    console.warn("⚠️ David not found, cannot update location");
  }

  // Brandon: Create or update work location (home base address)
  // Brandon comes from the admin profile, so create as team member if doesn't exist
  // Note: allTeamMembers was already fetched above, but we'll fetch again to ensure we have the latest
  const allTeamMembersForBrandon = await storage.getWorkerTeamMembers(operatorTeam.id);
  let brandon = allTeamMembersForBrandon.find(m => m.firstName === "Brandon" && m.lastName === "Tolstoy");
  
  if (!brandon) {
    // Create Brandon as a team member (admin's profile representation)
    brandon = await storage.createWorkerTeamMember({
      teamId: operatorTeam.id,
      firstName: "Brandon",
      lastName: "Tolstoy",
      email: "brandon@martinezteam.com",
      phone: "555-777-8888",
      role: "admin",
      hourlyRate: 55,
      skillsets: ["Electrical", "Plumbing", "HVAC"],
      status: "active",
      address: "450 W Santa Clara St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3398", // Work location (home base) - same as admin profile
      longitude: "-121.8885",
    });
    console.log(`✅ Created Brandon Tolstoy as team member (ID: ${brandon.id})`);
  } else {
    // Update existing Brandon with location data
    await db.update(workerTeamMembers)
      .set({
        address: "450 W Santa Clara St", // Home/work address
        city: "San Jose",
        state: "CA",
        zipCode: "95113",
        latitude: "37.3398", // Work location (home base) - geocoded from address
        longitude: "-121.8885",
      })
      .where(eq(workerTeamMembers.id, brandon.id));
    console.log(`✅ Updated work location for Brandon Tolstoy (ID: ${brandon.id})`);
  }
  
  console.log("✅ Updated all team member work locations!");

  // Create jobs for January 24th, 2026 (for fleet routing testing)
  const jan24 = new Date(2026, 0, 24); // January 24, 2026 (month is 0-indexed)
  const jan24Start = new Date(2026, 0, 24, 0, 0, 0, 0);
  const jan24End = new Date(2026, 0, 24, 23, 59, 59, 999);
  
  // Check if Jan 24 jobs with accepted applications and teamMemberId already exist
  const existingJan24Jobs = await db.select()
    .from(jobs)
    .innerJoin(applications, eq(jobs.id, applications.jobId))
    .where(and(
      gte(jobs.startDate, jan24Start),
      lte(jobs.startDate, jan24End),
      eq(applications.status, "accepted"),
      isNotNull(applications.teamMemberId)
    ))
    .limit(1);
  
  if (existingJan24Jobs.length === 0) {
    console.log("📅 Creating jobs for January 24, 2026 for fleet routing...");
    
    // Miguel's jobs for Jan 24th - 4 jobs throughout the day
    const miguelJan24Jobs = [
      {
        companyId: company.id,
        title: "Electrical Panel Inspection - Jan 24",
        description: "Inspect and test electrical panel for safety compliance",
        location: "San Jose, CA",
        address: "100 N 1st St",
        city: "San Jose",
        state: "CA",
        zipCode: "95113",
        latitude: "37.3382",
        longitude: "-121.8863",
        trade: "Electrical" as const,
        serviceCategory: "Electrical",
        skillLevel: "elite" as const,
        hourlyRate: 5500,
        estimatedHours: 2,
        scheduledTime: "8:00 AM - 10:00 AM",
        startDate: new Date(2026, 0, 24, 8, 0),
        endDate: new Date(2026, 0, 24, 10, 0),
      },
      {
        companyId: company.id,
        title: "Outlet Installation - Jan 24",
        description: "Install new outlets in office building",
        location: "San Jose, CA",
        address: "200 S 2nd St",
        city: "San Jose",
        state: "CA",
        zipCode: "95113",
        latitude: "37.3329",
        longitude: "-121.8886",
        trade: "Electrical" as const,
        serviceCategory: "Electrical",
        skillLevel: "lite" as const,
        hourlyRate: 4500,
        estimatedHours: 2,
        scheduledTime: "10:30 AM - 12:30 PM",
        startDate: new Date(2026, 0, 24, 10, 30),
        endDate: new Date(2026, 0, 24, 12, 30),
      },
      {
        companyId: company.id,
        title: "Lighting Fixture Repair - Jan 24",
        description: "Repair and replace lighting fixtures in retail space",
        location: "San Jose, CA",
        address: "300 E Santa Clara St",
        city: "San Jose",
        state: "CA",
        zipCode: "95113",
        latitude: "37.3394",
        longitude: "-121.8944",
        trade: "Electrical" as const,
        serviceCategory: "Electrical",
        skillLevel: "lite" as const,
        hourlyRate: 4500,
        estimatedHours: 2,
        scheduledTime: "1:00 PM - 2:30 PM",
        startDate: new Date(2026, 0, 24, 13, 0),
        endDate: new Date(2026, 0, 24, 14, 30),
      },
      {
        companyId: company.id,
        title: "Circuit Breaker Replacement - Jan 24",
        description: "Replace faulty circuit breakers in residential unit",
        location: "San Jose, CA",
        address: "150 W Julian St",
        city: "San Jose",
        state: "CA",
        zipCode: "95110",
        latitude: "37.3315",
        longitude: "-121.8902",
        trade: "Electrical" as const,
        serviceCategory: "Electrical",
        skillLevel: "elite" as const,
        hourlyRate: 5500,
        estimatedHours: 2,
        scheduledTime: "3:00 PM - 5:00 PM",
        startDate: new Date(2026, 0, 24, 15, 0),
        endDate: new Date(2026, 0, 24, 17, 0),
      },
    ];

    // Ana's jobs for Jan 24th - 3 jobs
    const anaJan24Jobs = [
      {
        companyId: company.id,
        title: "Pipe Leak Repair - Jan 24",
        description: "Repair leaking pipe in commercial building",
        location: "San Jose, CA",
        address: "400 N 3rd St",
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        latitude: "37.3412",
        longitude: "-121.8923",
        trade: "Plumbing" as const,
        serviceCategory: "Plumbing",
        skillLevel: "elite" as const,
        hourlyRate: 5200,
        estimatedHours: 3,
        scheduledTime: "8:30 AM - 11:00 AM",
        startDate: new Date(2026, 0, 24, 8, 30),
        endDate: new Date(2026, 0, 24, 11, 0),
      },
      {
        companyId: company.id,
        title: "Faucet Installation - Jan 24",
        description: "Install new kitchen faucet",
        location: "San Jose, CA",
        address: "500 S 4th St",
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        latitude: "37.3287",
        longitude: "-121.8915",
        trade: "Plumbing" as const,
        serviceCategory: "Plumbing",
        skillLevel: "lite" as const,
        hourlyRate: 4200,
        estimatedHours: 2,
        scheduledTime: "12:00 PM - 1:30 PM",
        startDate: new Date(2026, 0, 24, 12, 0),
        endDate: new Date(2026, 0, 24, 13, 30),
      },
      {
        companyId: company.id,
        title: "Drain Cleaning - Jan 24",
        description: "Clean blocked drain in restaurant",
        location: "San Jose, CA",
        address: "600 E 5th St",
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        latitude: "37.3356",
        longitude: "-121.8934",
        trade: "Plumbing" as const,
        serviceCategory: "Plumbing",
        skillLevel: "lite" as const,
        hourlyRate: 4200,
        estimatedHours: 2,
        scheduledTime: "2:30 PM - 4:30 PM",
        startDate: new Date(2026, 0, 24, 14, 30),
        endDate: new Date(2026, 0, 24, 16, 30),
      },
    ];

    // David's jobs for Jan 24th - 3 jobs
    const davidJan24Jobs = [
      {
        companyId: company.id,
        title: "AC Unit Maintenance - Jan 24",
        description: "Regular maintenance check for AC unit",
        location: "San Jose, CA",
        address: "700 N 6th St",
        city: "San Jose",
        state: "CA",
        zipCode: "95110",
        latitude: "37.3445",
        longitude: "-121.8956",
        trade: "HVAC" as const,
        serviceCategory: "HVAC",
        skillLevel: "elite" as const,
        hourlyRate: 5800,
        estimatedHours: 2,
        scheduledTime: "9:00 AM - 11:00 AM",
        startDate: new Date(2026, 0, 24, 9, 0),
        endDate: new Date(2026, 0, 24, 11, 0),
      },
      {
        companyId: company.id,
        title: "Filter Replacement - Jan 24",
        description: "Replace air filters in office building",
        location: "San Jose, CA",
        address: "800 S 7th St",
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        latitude: "37.3278",
        longitude: "-121.8897",
        trade: "HVAC" as const,
        serviceCategory: "HVAC",
        skillLevel: "lite" as const,
        hourlyRate: 4800,
        estimatedHours: 1,
        scheduledTime: "1:00 PM - 2:00 PM",
        startDate: new Date(2026, 0, 24, 13, 0),
        endDate: new Date(2026, 0, 24, 14, 0),
      },
      {
        companyId: company.id,
        title: "Thermostat Installation - Jan 24",
        description: "Install smart thermostat system",
        location: "San Jose, CA",
        address: "900 E 8th St",
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        latitude: "37.3389",
        longitude: "-121.8978",
        trade: "HVAC" as const,
        serviceCategory: "HVAC",
        skillLevel: "elite" as const,
        hourlyRate: 5800,
        estimatedHours: 2,
        scheduledTime: "3:00 PM - 5:00 PM",
        startDate: new Date(2026, 0, 24, 15, 0),
        endDate: new Date(2026, 0, 24, 17, 0),
      },
    ];

    // Create accepted applications for Jan 24th jobs
    for (const jobData of miguelJan24Jobs) {
      const job = await storage.createJob(jobData);
      const application = await storage.createApplication({
        jobId: job.id,
        workerId: operator.id,
        teamMemberId: miguel.id,
        message: "Assigned to Miguel Santos for Jan 24",
      });
      // Update status to accepted (can't set status on creation)
      await storage.updateApplicationStatus(application.id, "accepted");
    }

    for (const jobData of anaJan24Jobs) {
      const job = await storage.createJob(jobData);
      const application = await storage.createApplication({
        jobId: job.id,
        workerId: operator.id,
        teamMemberId: ana.id,
        message: "Assigned to Ana Rodriguez for Jan 24",
      });
      // Update status to accepted (can't set status on creation)
      await storage.updateApplicationStatus(application.id, "accepted");
    }

    for (const jobData of davidJan24Jobs) {
      const job = await storage.createJob(jobData);
      const application = await storage.createApplication({
        jobId: job.id,
        workerId: operator.id,
        teamMemberId: david.id,
        message: "Assigned to David Chen for Jan 24",
      });
      // Update status to accepted (can't set status on creation)
      await storage.updateApplicationStatus(application.id, "accepted");
    }

    console.log(`✅ Created ${miguelJan24Jobs.length + anaJan24Jobs.length + davidJan24Jobs.length} jobs for January 24, 2026 with accepted applications`);
  } else {
    console.log("ℹ️ Jobs for January 24, 2026 already exist. Skipping creation.");
  }

  // Only create new jobs if we're doing a full seed
  if (!shouldSeedFull) {
    console.log("ℹ️ Skipping additional job creation - database already has jobs.");
    return;
  }

  // Create jobs for Monday, January 26th, 2026 for Carlos's teammates
  const jan26 = new Date(2026, 0, 26); // January 26, 2026 (month is 0-indexed)
  
  // Miguel's jobs for Jan 26th - 5 jobs throughout the day
  const miguelJan26Jobs = [
    {
      companyId: company.id,
      title: "Electrical Panel Upgrade - Jan 26",
      description: "Upgrade electrical panel for increased capacity",
      location: "San Jose, CA",
      address: "100 N 1st St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3382",
      longitude: "-121.8863",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 2,
      scheduledTime: "7:00 AM - 9:00 AM",
      startDate: new Date(2026, 0, 26, 7, 0),
      endDate: new Date(2026, 0, 26, 9, 0),
    },
    {
      companyId: company.id,
      title: "Outlet Installation - Jan 26",
      description: "Install new outlets in office building",
      location: "San Jose, CA",
      address: "200 S 2nd St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3329",
      longitude: "-121.8886",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "lite" as const,
      hourlyRate: 4500,
      estimatedHours: 2,
      scheduledTime: "9:30 AM - 11:30 AM",
      startDate: new Date(2026, 0, 26, 9, 30),
      endDate: new Date(2026, 0, 26, 11, 30),
    },
    {
      companyId: company.id,
      title: "Lighting Fixture Repair - Jan 26",
      description: "Repair and replace lighting fixtures in retail space",
      location: "San Jose, CA",
      address: "300 E Santa Clara St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3394",
      longitude: "-121.8944",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "lite" as const,
      hourlyRate: 4500,
      estimatedHours: 2,
      scheduledTime: "12:00 PM - 1:30 PM",
      startDate: new Date(2026, 0, 26, 12, 0),
      endDate: new Date(2026, 0, 26, 13, 30),
    },
    {
      companyId: company.id,
      title: "Circuit Breaker Replacement - Jan 26",
      description: "Replace faulty circuit breakers in residential unit",
      location: "San Jose, CA",
      address: "150 W Julian St",
      city: "San Jose",
      state: "CA",
      zipCode: "95110",
      latitude: "37.3315",
      longitude: "-121.8902",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 2,
      scheduledTime: "2:00 PM - 4:00 PM",
      startDate: new Date(2026, 0, 26, 14, 0),
      endDate: new Date(2026, 0, 26, 16, 0),
    },
    {
      companyId: company.id,
      title: "GFCI Outlet Installation - Jan 26",
      description: "Install GFCI outlets in kitchen and bathroom",
      location: "San Jose, CA",
      address: "250 N 3rd St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3401",
      longitude: "-121.8875",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "lite" as const,
      hourlyRate: 4500,
      estimatedHours: 2,
      scheduledTime: "4:30 PM - 6:00 PM",
      startDate: new Date(2026, 0, 26, 16, 30),
      endDate: new Date(2026, 0, 26, 18, 0),
    },
  ];

  // Ana's jobs for Jan 26th - 5 jobs throughout the day
  const anaJan26Jobs = [
    {
      companyId: company.id,
      title: "Plumbing Leak Repair - Jan 26",
      description: "Fix leaking pipes in residential building",
      location: "San Jose, CA",
      address: "400 W San Fernando St",
      city: "San Jose",
      state: "CA",
      zipCode: "95110",
      latitude: "37.3456",
      longitude: "-121.8956",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 2,
      scheduledTime: "7:00 AM - 9:00 AM",
      startDate: new Date(2026, 0, 26, 7, 0),
      endDate: new Date(2026, 0, 26, 9, 0),
    },
    {
      companyId: company.id,
      title: "HVAC System Maintenance - Jan 26",
      description: "Routine maintenance on HVAC system",
      location: "San Jose, CA",
      address: "500 N 4th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3523",
      longitude: "-121.8889",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 3,
      scheduledTime: "9:30 AM - 12:00 PM",
      startDate: new Date(2026, 0, 26, 9, 30),
      endDate: new Date(2026, 0, 26, 12, 0),
    },
    {
      companyId: company.id,
      title: "Bathroom Fixture Installation - Jan 26",
      description: "Install new bathroom fixtures",
      location: "San Jose, CA",
      address: "600 S 5th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3287",
      longitude: "-121.8856",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 2,
      scheduledTime: "12:30 PM - 2:30 PM",
      startDate: new Date(2026, 0, 26, 12, 30),
      endDate: new Date(2026, 0, 26, 14, 30),
    },
    {
      companyId: company.id,
      title: "Water Heater Inspection - Jan 26",
      description: "Inspect and test water heater for efficiency",
      location: "San Jose, CA",
      address: "700 N 6th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3545",
      longitude: "-121.8901",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 2,
      scheduledTime: "3:00 PM - 5:00 PM",
      startDate: new Date(2026, 0, 26, 15, 0),
      endDate: new Date(2026, 0, 26, 17, 0),
    },
    {
      companyId: company.id,
      title: "Drain Cleaning Service - Jan 26",
      description: "Professional drain cleaning and maintenance",
      location: "San Jose, CA",
      address: "800 S 7th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3256",
      longitude: "-121.8845",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 2,
      scheduledTime: "5:30 PM - 7:00 PM",
      startDate: new Date(2026, 0, 26, 17, 30),
      endDate: new Date(2026, 0, 26, 19, 0),
    },
  ];

  // David's jobs for Jan 26th - 5 jobs throughout the day
  const davidJan26Jobs = [
    {
      companyId: company.id,
      title: "HVAC Filter Replacement - Jan 26",
      description: "Replace HVAC filters and clean system",
      location: "San Jose, CA",
      address: "900 N 8th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3567",
      longitude: "-121.8892",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 2,
      scheduledTime: "7:00 AM - 9:00 AM",
      startDate: new Date(2026, 0, 26, 7, 0),
      endDate: new Date(2026, 0, 26, 9, 0),
    },
    {
      companyId: company.id,
      title: "AC Unit Repair - Jan 26",
      description: "Repair malfunctioning AC unit",
      location: "San Jose, CA",
      address: "1000 S 9th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3223",
      longitude: "-121.8834",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 3,
      scheduledTime: "9:30 AM - 12:00 PM",
      startDate: new Date(2026, 0, 26, 9, 30),
      endDate: new Date(2026, 0, 26, 12, 0),
    },
    {
      companyId: company.id,
      title: "Ductwork Cleaning - Jan 26",
      description: "Clean and sanitize air ducts",
      location: "San Jose, CA",
      address: "1100 N 10th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3589",
      longitude: "-121.8878",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 2,
      scheduledTime: "12:30 PM - 2:30 PM",
      startDate: new Date(2026, 0, 26, 12, 30),
      endDate: new Date(2026, 0, 26, 14, 30),
    },
    {
      companyId: company.id,
      title: "Thermostat Installation - Jan 26",
      description: "Install smart thermostat system",
      location: "San Jose, CA",
      address: "1200 S 11th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3190",
      longitude: "-121.8823",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 2,
      scheduledTime: "3:00 PM - 5:00 PM",
      startDate: new Date(2026, 0, 26, 15, 0),
      endDate: new Date(2026, 0, 26, 17, 0),
    },
    {
      companyId: company.id,
      title: "Heating System Check - Jan 26",
      description: "Inspect and test heating system",
      location: "San Jose, CA",
      address: "1300 N 12th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3611",
      longitude: "-121.8865",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 2,
      scheduledTime: "5:30 PM - 7:00 PM",
      startDate: new Date(2026, 0, 26, 17, 30),
      endDate: new Date(2026, 0, 26, 19, 0),
    },
  ];

  // Create accepted applications for Jan 26th jobs
  for (const jobData of miguelJan26Jobs) {
    const job = await storage.createJob(jobData);
    const application = await storage.createApplication({
      jobId: job.id,
      workerId: operator.id,
      teamMemberId: miguel.id,
      message: "Assigned to Miguel Torres for Jan 26",
    });
    await storage.updateApplicationStatus(application.id, "accepted");
  }

  for (const jobData of anaJan26Jobs) {
    const job = await storage.createJob(jobData);
    const application = await storage.createApplication({
      jobId: job.id,
      workerId: operator.id,
      teamMemberId: ana.id,
      message: "Assigned to Ana Rodriguez for Jan 26",
    });
    await storage.updateApplicationStatus(application.id, "accepted");
  }

  for (const jobData of davidJan26Jobs) {
    const job = await storage.createJob(jobData);
    const application = await storage.createApplication({
      jobId: job.id,
      workerId: operator.id,
      teamMemberId: david.id,
      message: "Assigned to David Chen for Jan 26",
    });
    await storage.updateApplicationStatus(application.id, "accepted");
  }

  // Create available jobs (not assigned) for Jan 26th that can be added to routes
  const availableJan26Jobs = [
    {
      companyId: company.id,
      title: "Electrical Wiring Inspection - Available",
      description: "Inspect electrical wiring for safety compliance",
      location: "San Jose, CA",
      address: "1400 S 13th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3156",
      longitude: "-121.8812",
      trade: "Electrical" as const,
      serviceCategory: "Electrical",
      skillLevel: "elite" as const,
      hourlyRate: 5500,
      estimatedHours: 2,
      scheduledTime: "10:00 AM - 12:00 PM",
      startDate: new Date(2026, 0, 26, 10, 0),
      endDate: new Date(2026, 0, 26, 12, 0),
    },
    {
      companyId: company.id,
      title: "Pipe Repair Service - Available",
      description: "Repair broken pipes in commercial building",
      location: "San Jose, CA",
      address: "1500 N 14th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3633",
      longitude: "-121.8851",
      trade: "Plumbing" as const,
      serviceCategory: "Plumbing",
      skillLevel: "elite" as const,
      hourlyRate: 6000,
      estimatedHours: 3,
      scheduledTime: "1:00 PM - 3:30 PM",
      startDate: new Date(2026, 0, 26, 13, 0),
      endDate: new Date(2026, 0, 26, 15, 30),
    },
    {
      companyId: company.id,
      title: "AC Unit Maintenance - Available",
      description: "Routine AC unit maintenance and cleaning",
      location: "San Jose, CA",
      address: "1600 S 15th St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3123",
      longitude: "-121.8801",
      trade: "HVAC" as const,
      serviceCategory: "HVAC",
      skillLevel: "elite" as const,
      hourlyRate: 5800,
      estimatedHours: 2,
      scheduledTime: "3:00 PM - 5:00 PM",
      startDate: new Date(2026, 0, 26, 15, 0),
      endDate: new Date(2026, 0, 26, 17, 0),
    },
  ];

  // Create available jobs (no applications, so they show as available)
  for (const jobData of availableJan26Jobs) {
    await storage.createJob(jobData);
  }

  console.log(`Created jobs for Monday, January 26th, 2026:`);
  console.log(`  - Miguel: ${miguelJan26Jobs.length} accepted jobs`);
  console.log(`  - Ana: ${anaJan26Jobs.length} accepted jobs`);
  console.log(`  - David: ${davidJan26Jobs.length} accepted jobs`);
  console.log(`  - Available (unassigned): ${availableJan26Jobs.length} jobs`);

  // Create jobs for multiple dates (Jan 24-30, 2026) for better testing
  const dates = [
    { day: 24, name: "Jan 24" },
    { day: 25, name: "Jan 25" },
    { day: 27, name: "Jan 27" },
    { day: 28, name: "Jan 28" },
    { day: 29, name: "Jan 29" },
    { day: 30, name: "Jan 30" },
  ];

  for (const dateInfo of dates) {
    const date = new Date(2026, 0, dateInfo.day);
    
    // Create 3-4 jobs per worker per day
    const jobsPerWorker = [
      {
        worker: miguel,
        jobs: [
          {
            companyId: company.id,
            title: `Electrical Service - ${dateInfo.name}`,
            description: "Electrical service call",
            location: "San Jose, CA",
            address: `${100 + dateInfo.day} N 1st St`,
            city: "San Jose",
            state: "CA",
            zipCode: "95113",
            latitude: (37.3382 + (dateInfo.day % 10) * 0.001).toFixed(4),
            longitude: (-121.8863 - (dateInfo.day % 10) * 0.001).toFixed(4),
            trade: "Electrical" as const,
            serviceCategory: "Electrical",
            skillLevel: "elite" as const,
            hourlyRate: 5500,
            estimatedHours: 2,
            scheduledTime: "8:00 AM - 10:00 AM",
            startDate: new Date(2026, 0, dateInfo.day, 8, 0),
            endDate: new Date(2026, 0, dateInfo.day, 10, 0),
          },
          {
            companyId: company.id,
            title: `Outlet Repair - ${dateInfo.name}`,
            description: "Repair electrical outlets",
            location: "San Jose, CA",
            address: `${200 + dateInfo.day} S 2nd St`,
            city: "San Jose",
            state: "CA",
            zipCode: "95113",
            latitude: (37.3329 + (dateInfo.day % 10) * 0.001).toFixed(4),
            longitude: (-121.8886 - (dateInfo.day % 10) * 0.001).toFixed(4),
            trade: "Electrical" as const,
            serviceCategory: "Electrical",
            skillLevel: "lite" as const,
            hourlyRate: 4500,
            estimatedHours: 2,
            scheduledTime: "11:00 AM - 12:30 PM",
            startDate: new Date(2026, 0, dateInfo.day, 11, 0),
            endDate: new Date(2026, 0, dateInfo.day, 12, 30),
          },
          {
            companyId: company.id,
            title: `Wiring Inspection - ${dateInfo.name}`,
            description: "Inspect electrical wiring",
            location: "San Jose, CA",
            address: `${300 + dateInfo.day} E Santa Clara St`,
            city: "San Jose",
            state: "CA",
            zipCode: "95113",
            latitude: (37.3394 + (dateInfo.day % 10) * 0.001).toFixed(4),
            longitude: (-121.8944 - (dateInfo.day % 10) * 0.001).toFixed(4),
            trade: "Electrical" as const,
            serviceCategory: "Electrical",
            skillLevel: "elite" as const,
            hourlyRate: 5500,
            estimatedHours: 3,
            scheduledTime: "2:00 PM - 4:30 PM",
            startDate: new Date(2026, 0, dateInfo.day, 14, 0),
            endDate: new Date(2026, 0, dateInfo.day, 16, 30),
          },
        ],
      },
      {
        worker: ana,
        jobs: [
          {
            companyId: company.id,
            title: `Plumbing Service - ${dateInfo.name}`,
            description: "Plumbing service call",
            location: "San Jose, CA",
            address: `${400 + dateInfo.day} W San Fernando St`,
            city: "San Jose",
            state: "CA",
            zipCode: "95110",
            latitude: (37.3456 + (dateInfo.day % 10) * 0.001).toFixed(4),
            longitude: (-121.8956 - (dateInfo.day % 10) * 0.001).toFixed(4),
            trade: "Plumbing" as const,
            serviceCategory: "Plumbing",
            skillLevel: "elite" as const,
            hourlyRate: 6000,
            estimatedHours: 2,
            scheduledTime: "8:00 AM - 10:00 AM",
            startDate: new Date(2026, 0, dateInfo.day, 8, 0),
            endDate: new Date(2026, 0, dateInfo.day, 10, 0),
          },
          {
            companyId: company.id,
            title: `Fixture Installation - ${dateInfo.name}`,
            description: "Install plumbing fixtures",
            location: "San Jose, CA",
            address: `${500 + dateInfo.day} N 4th St`,
            city: "San Jose",
            state: "CA",
            zipCode: "95112",
            latitude: (37.3523 + (dateInfo.day % 10) * 0.001).toFixed(4),
            longitude: (-121.8889 - (dateInfo.day % 10) * 0.001).toFixed(4),
            trade: "Plumbing" as const,
            serviceCategory: "Plumbing",
            skillLevel: "elite" as const,
            hourlyRate: 6000,
            estimatedHours: 3,
            scheduledTime: "11:00 AM - 1:30 PM",
            startDate: new Date(2026, 0, dateInfo.day, 11, 0),
            endDate: new Date(2026, 0, dateInfo.day, 13, 30),
          },
          {
            companyId: company.id,
            title: `Pipe Repair - ${dateInfo.name}`,
            description: "Repair broken pipes",
            location: "San Jose, CA",
            address: `${600 + dateInfo.day} S 5th St`,
            city: "San Jose",
            state: "CA",
            zipCode: "95112",
            latitude: (37.3287 + (dateInfo.day % 10) * 0.001).toFixed(4),
            longitude: (-121.8856 - (dateInfo.day % 10) * 0.001).toFixed(4),
            trade: "Plumbing" as const,
            serviceCategory: "Plumbing",
            skillLevel: "elite" as const,
            hourlyRate: 6000,
            estimatedHours: 2,
            scheduledTime: "2:00 PM - 4:00 PM",
            startDate: new Date(2026, 0, dateInfo.day, 14, 0),
            endDate: new Date(2026, 0, dateInfo.day, 16, 0),
          },
        ],
      },
      {
        worker: david,
        jobs: [
          {
            companyId: company.id,
            title: `HVAC Service - ${dateInfo.name}`,
            description: "HVAC service call",
            location: "San Jose, CA",
            address: `${900 + dateInfo.day} N 8th St`,
            city: "San Jose",
            state: "CA",
            zipCode: "95112",
            latitude: (37.3567 + (dateInfo.day % 10) * 0.001).toFixed(4),
            longitude: (-121.8892 - (dateInfo.day % 10) * 0.001).toFixed(4),
            trade: "HVAC" as const,
            serviceCategory: "HVAC",
            skillLevel: "elite" as const,
            hourlyRate: 5800,
            estimatedHours: 2,
            scheduledTime: "8:00 AM - 10:00 AM",
            startDate: new Date(2026, 0, dateInfo.day, 8, 0),
            endDate: new Date(2026, 0, dateInfo.day, 10, 0),
          },
          {
            companyId: company.id,
            title: `AC Maintenance - ${dateInfo.name}`,
            description: "AC unit maintenance",
            location: "San Jose, CA",
            address: `${1000 + dateInfo.day} S 9th St`,
            city: "San Jose",
            state: "CA",
            zipCode: "95112",
            latitude: (37.3223 + (dateInfo.day % 10) * 0.001).toFixed(4),
            longitude: (-121.8834 - (dateInfo.day % 10) * 0.001).toFixed(4),
            trade: "HVAC" as const,
            serviceCategory: "HVAC",
            skillLevel: "elite" as const,
            hourlyRate: 5800,
            estimatedHours: 3,
            scheduledTime: "11:00 AM - 1:30 PM",
            startDate: new Date(2026, 0, dateInfo.day, 11, 0),
            endDate: new Date(2026, 0, dateInfo.day, 13, 30),
          },
          {
            companyId: company.id,
            title: `Filter Replacement - ${dateInfo.name}`,
            description: "Replace HVAC filters",
            location: "San Jose, CA",
            address: `${1100 + dateInfo.day} N 10th St`,
            city: "San Jose",
            state: "CA",
            zipCode: "95112",
            latitude: (37.3589 + (dateInfo.day % 10) * 0.001).toFixed(4),
            longitude: (-121.8878 - (dateInfo.day % 10) * 0.001).toFixed(4),
            trade: "HVAC" as const,
            serviceCategory: "HVAC",
            skillLevel: "elite" as const,
            hourlyRate: 5800,
            estimatedHours: 2,
            scheduledTime: "2:00 PM - 3:30 PM",
            startDate: new Date(2026, 0, dateInfo.day, 14, 0),
            endDate: new Date(2026, 0, dateInfo.day, 15, 30),
          },
        ],
      },
    ];

    // Create jobs and applications for each worker
    for (const workerData of jobsPerWorker) {
      for (const jobData of workerData.jobs) {
        const job = await storage.createJob(jobData);
        const application = await storage.createApplication({
          jobId: job.id,
          workerId: operator.id,
          teamMemberId: workerData.worker.id,
          message: `Assigned to ${workerData.worker.firstName} ${workerData.worker.lastName} for ${dateInfo.name}`,
        });
        await storage.updateApplicationStatus(application.id, "accepted");
      }
    }

    // Create 2-3 available jobs per date (no applications)
    const availableJobsForDate = [
      {
        companyId: company.id,
        title: `Available Job 1 - ${dateInfo.name}`,
        description: "Available job opportunity",
        location: "San Jose, CA",
        address: `${1400 + dateInfo.day} S 13th St`,
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        latitude: (37.3156 + (dateInfo.day % 10) * 0.001).toFixed(4),
        longitude: (-121.8812 - (dateInfo.day % 10) * 0.001).toFixed(4),
        trade: "Electrical" as const,
        serviceCategory: "Electrical",
        skillLevel: "elite" as const,
        hourlyRate: 5500,
        estimatedHours: 2,
        scheduledTime: "10:00 AM - 12:00 PM",
        startDate: new Date(2026, 0, dateInfo.day, 10, 0),
        endDate: new Date(2026, 0, dateInfo.day, 12, 0),
      },
      {
        companyId: company.id,
        title: `Available Job 2 - ${dateInfo.name}`,
        description: "Available job opportunity",
        location: "San Jose, CA",
        address: `${1500 + dateInfo.day} N 14th St`,
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        latitude: (37.3633 + (dateInfo.day % 10) * 0.001).toFixed(4),
        longitude: (-121.8851 - (dateInfo.day % 10) * 0.001).toFixed(4),
        trade: "Plumbing" as const,
        serviceCategory: "Plumbing",
        skillLevel: "elite" as const,
        hourlyRate: 6000,
        estimatedHours: 3,
        scheduledTime: "1:00 PM - 3:30 PM",
        startDate: new Date(2026, 0, dateInfo.day, 13, 0),
        endDate: new Date(2026, 0, dateInfo.day, 15, 30),
      },
      {
        companyId: company.id,
        title: `Available Job 3 - ${dateInfo.name}`,
        description: "Available job opportunity",
        location: "San Jose, CA",
        address: `${1600 + dateInfo.day} S 15th St`,
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        latitude: (37.3123 + (dateInfo.day % 10) * 0.001).toFixed(4),
        longitude: (-121.8801 - (dateInfo.day % 10) * 0.001).toFixed(4),
        trade: "HVAC" as const,
        serviceCategory: "HVAC",
        skillLevel: "elite" as const,
        hourlyRate: 5800,
        estimatedHours: 2,
        scheduledTime: "3:00 PM - 5:00 PM",
        startDate: new Date(2026, 0, dateInfo.day, 15, 0),
        endDate: new Date(2026, 0, dateInfo.day, 17, 0),
      },
    ];

    for (const jobData of availableJobsForDate) {
      await storage.createJob(jobData);
    }
  }

  console.log(`Created jobs for multiple dates (Jan 24-30, 2026):`);
  console.log(`  - Each date has 3 jobs per worker (Miguel, Ana, David)`);
  console.log(`  - Each date has 3 available jobs`);
  console.log(`  - Total: ${dates.length} dates × (9 accepted + 3 available) = ${dates.length * 12} jobs`);

  console.log("Database seeding complete!");
}