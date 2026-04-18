/**
 * Checkr API adapter — vendor implementation of the FCRA-compliant
 * background-check workflow defined in server/services/backgroundCheck.ts.
 *
 * Configure with:
 *   - CHECKR_API_KEY      — your live or test API key (required)
 *   - CHECKR_WEBHOOK_SECRET — secret for signature verification on inbound
 *                             webhook events (required for production)
 *
 * Two-stage flow:
 *   1. createCandidate(workerProfile) — pushes the worker's PII to Checkr,
 *      returns a candidate ID we persist on backgroundCheckOrders.vendorReference.
 *   2. createReport(candidateId, packageCode) — actually orders the report.
 *      Webhook events ("report.completed", etc.) update our order row
 *      asynchronously via /api/webhooks/checkr.
 *
 * Reference: https://docs.checkr.com/
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { backgroundCheckOrders } from "@shared/schema";

const CHECKR_BASE = "https://api.checkr.com/v1";

function authHeader(): string {
  const key = process.env.CHECKR_API_KEY;
  if (!key) throw new Error("CHECKR_API_KEY not configured");
  // Checkr uses HTTP Basic with the API key as username and an empty password.
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function callCheckr<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CHECKR_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: authHeader(),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Checkr ${path} ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : ({} as T);
}

export interface CheckrCandidateInput {
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  phone?: string;
  dob?: string;     // YYYY-MM-DD
  ssn?: string;     // XXX-XX-XXXX
  zipcode?: string;
  driverLicenseNumber?: string;
  driverLicenseState?: string;
  workLocations?: Array<{ country: "US"; state?: string; city?: string }>;
}

export interface CheckrCandidate { id: string; object: "candidate"; uri: string }
export interface CheckrReport {
  id: string; object: "report"; status: "pending" | "complete" | "suspended" | "consider" | "clear";
  result?: "clear" | "consider" | null;
  candidate_id: string; package: string; turnaround_time?: number; uri: string;
  completed_at?: string;
}

export async function createCandidate(input: CheckrCandidateInput): Promise<CheckrCandidate> {
  const body = new URLSearchParams();
  body.append("first_name", input.firstName);
  if (input.middleName) body.append("middle_name", input.middleName);
  body.append("last_name", input.lastName);
  body.append("email", input.email);
  if (input.phone) body.append("phone", input.phone);
  if (input.dob) body.append("dob", input.dob);
  if (input.ssn) body.append("ssn", input.ssn);
  if (input.zipcode) body.append("zipcode", input.zipcode);
  if (input.driverLicenseNumber) body.append("driver_license_number", input.driverLicenseNumber);
  if (input.driverLicenseState) body.append("driver_license_state", input.driverLicenseState);
  for (const loc of input.workLocations ?? []) {
    body.append("work_locations[][country]", loc.country);
    if (loc.state) body.append("work_locations[][state]", loc.state);
    if (loc.city) body.append("work_locations[][city]", loc.city);
  }
  return callCheckr<CheckrCandidate>("/candidates", { method: "POST", body });
}

export async function createReport(candidateId: string, packageCode: string): Promise<CheckrReport> {
  const body = new URLSearchParams();
  body.append("candidate_id", candidateId);
  body.append("package", packageCode);
  const report = await callCheckr<CheckrReport>("/reports", { method: "POST", body });
  return report;
}

export async function getReport(reportId: string): Promise<CheckrReport> {
  return callCheckr<CheckrReport>(`/reports/${reportId}`, { method: "GET" });
}

/**
 * Verify a Checkr webhook signature (HMAC-SHA256).
 * Header: X-Checkr-Signature: t=...,v1=...
 */
export function verifyCheckrWebhook(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = process.env.CHECKR_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  if (!parts.t || !parts.v1) return false;
  const { createHmac, timingSafeEqual } = require("crypto") as typeof import("crypto");
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Apply a webhook event to our order row. Idempotent.
 */
export async function applyReportEvent(report: CheckrReport): Promise<void> {
  // Find the order by vendorReference. We persist either the candidate ID or
  // the report ID — both are searchable here.
  const [byReport] = await db.select().from(backgroundCheckOrders)
    .where(eq(backgroundCheckOrders.vendorReference, report.id)).limit(1);
  const [byCandidate] = byReport ? [] : await db.select().from(backgroundCheckOrders)
    .where(eq(backgroundCheckOrders.vendorReference, report.candidate_id)).limit(1);
  const order = byReport ?? byCandidate;
  if (!order) {
    console.warn(`[Checkr] Webhook for report ${report.id} but no matching order`);
    return;
  }

  const updates: Partial<typeof backgroundCheckOrders.$inferInsert> = {};
  if (report.status === "complete") {
    updates.status = "complete";
    updates.completedAt = report.completed_at ? new Date(report.completed_at) : new Date();
  } else if (report.status === "pending") {
    updates.status = "pending";
  } else if (report.status === "suspended") {
    updates.status = "suspended";
  }
  if (report.result === "clear" || report.result === "consider") {
    updates.result = report.result;
  }
  if (report.uri) updates.reportUrl = `https://dashboard.checkr.com${report.uri}`;
  if (!order.vendorReference || order.vendorReference !== report.id) {
    updates.vendorReference = report.id;
  }

  if (Object.keys(updates).length === 0) return;
  await db.update(backgroundCheckOrders).set(updates).where(eq(backgroundCheckOrders.id, order.id));
}
