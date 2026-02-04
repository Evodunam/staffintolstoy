/**
 * Send job alert sample emails using real job data (actual attachments + map).
 *
 * Run: npx dotenv -e .env.development -- tsx script/send-job-alert-email-sample.ts
 *
 * 1. Start the server first: npm run dev
 * 2. By default fetches a real job (prefers one with attachments) from GET /api/emails/sample-job-alert-payload
 * 3. All button/link URLs include &test=1 (test mode)
 *
 * Optional: SAMPLE_JOB_ID=<id> to use a specific job. USE_REAL_JOB=0 to use fake sample data instead.
 * For images to load in the email, set BASE_URL in .env.development to your public app URL (e.g. ngrok).
 */
if (process.env.NODE_ENV !== "production") {
  process.env.DISABLE_DEV_EMAIL_OVERRIDE = "1";
}

import { sendEmail, getSampleDataForType } from "../server/email-service";

const TO = process.env.EMAIL_SAMPLES_TO || "b.tolstoy@tolstoystaffing.com";
const BASE_URL = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5000";
const USE_REAL_JOB = process.env.USE_REAL_JOB !== "0" && process.env.USE_REAL_JOB !== "false";
const SAMPLE_JOB_ID = process.env.SAMPLE_JOB_ID ? process.env.SAMPLE_JOB_ID.trim() : undefined;

const JOB_ALERT_TYPES = ["new_job_nearby", "new_job_posted_admin"] as const;

async function fetchRealJobPayload(): Promise<{ data: Record<string, any>; jobId: number; jobTitle: string } | null> {
  const url = SAMPLE_JOB_ID
    ? `${BASE_URL}/api/emails/sample-job-alert-payload?jobId=${encodeURIComponent(SAMPLE_JOB_ID)}`
    : `${BASE_URL}/api/emails/sample-job-alert-payload`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ⚠ Sample payload API ${res.status}: ${await res.text()}`);
      return null;
    }
    const json = await res.json();
    return json;
  } catch (e: any) {
    console.warn("  ⚠ Could not fetch real job payload (is the server running?). Using sample data.", e?.message);
    return null;
  }
}

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.error("❌ RESEND_API_KEY is not set. Set it in .env.development or env.");
    process.exit(1);
  }

  const useRealJob = USE_REAL_JOB || !!SAMPLE_JOB_ID;
  let realPayload: { data: Record<string, any>; jobId: number; jobTitle: string } | null = null;
  if (useRealJob) {
    console.log("Fetching real job payload (prefer job with attachments)...");
    realPayload = await fetchRealJobPayload();
    if (realPayload) {
      console.log(`  Using job #${realPayload.jobId}: ${realPayload.jobTitle}\n`);
    } else {
      console.log("  No real job (start server with npm run dev, or create a job with attachments). Using sample data.\n");
    }
  }

  console.log(`Sending job alert sample emails to ${TO}...\n`);
  let sent = 0;
  let failed = 0;
  for (const type of JOB_ALERT_TYPES) {
    const data =
      type === "new_job_nearby" && realPayload
        ? realPayload.data
        : getSampleDataForType(type as "new_job_nearby" | "new_job_posted_admin");
    const payload = { to: TO, type, data };
    const result = await sendEmail(payload);
    if (result.success) {
      sent++;
      console.log(`  ✓ ${type}`);
    } else {
      failed++;
      console.log(`  ✗ ${type}: ${result.error}`);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log(`\n✅ Done. Sent ${sent}, failed ${failed}. Check inbox at ${TO}.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
