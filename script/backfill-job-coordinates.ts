/**
 * Backfill missing jobs.latitude / jobs.longitude from address fields.
 *
 * Usage:
 *   # Dry run (prints what would be updated)
 *   npx dotenv -e .env.development -- tsx script/backfill-job-coordinates.ts
 *
 *   # Apply updates
 *   npx dotenv -e .env.development -- tsx script/backfill-job-coordinates.ts --apply
 *
 *   # Limit rows
 *   npx dotenv -e .env.development -- tsx script/backfill-job-coordinates.ts --apply --limit=200
 */
import { db } from "../server/db";
import { jobs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { geocodeAddress, geocodeFullAddress } from "../server/geocoding";

const APPLY = process.argv.includes("--apply");
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : undefined;

function hasCoords(job: { latitude: string | null; longitude: string | null }) {
  return !!job.latitude && !!job.longitude;
}

function buildAddressCandidates(job: {
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  location: string;
  locationName: string | null;
}) {
  const address = (job.address || "").trim();
  const city = (job.city || "").trim();
  const state = (job.state || "").trim();
  const zip = (job.zipCode || "").trim();
  const location = (job.location || "").trim();
  const locationName = (job.locationName || "").trim();

  const candidates: string[] = [];
  if (address && city && state) {
    candidates.push([address, city, state, zip].filter(Boolean).join(", "));
  }
  if (location) candidates.push(location);
  if (locationName && city && state) {
    candidates.push([locationName, city, state, zip].filter(Boolean).join(", "));
  }
  if (city && state) candidates.push([city, state, zip].filter(Boolean).join(", "));

  return Array.from(new Set(candidates.filter(Boolean)));
}

async function geocodeWithNominatim(query: string): Promise<{ latitude: string; longitude: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "tolstoy-staffing-backfill/1.0",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const first = data?.[0];
    if (!first?.lat || !first?.lon) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { latitude: lat.toFixed(7), longitude: lng.toFixed(7) };
  } catch {
    return null;
  }
}

async function geocodeJob(job: {
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  location: string;
  locationName: string | null;
}) {
  const address = (job.address || "").trim();
  const city = (job.city || "").trim();
  const state = (job.state || "").trim();
  const zip = (job.zipCode || "").trim();

  if (address && city && state) {
    const full = await geocodeFullAddress(address, city, state, zip);
    if (full) return full;
  }

  const candidates = buildAddressCandidates(job);
  for (const query of candidates) {
    const result = await geocodeAddress(query);
    if (result) return result;
  }
  for (const query of candidates) {
    const fallback = await geocodeWithNominatim(query);
    if (fallback) {
      console.log(`[Nominatim] Geocoded "${query}" to ${fallback.latitude}, ${fallback.longitude}`);
      return fallback;
    }
  }

  return null;
}

async function main() {
  const allJobs = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      location: jobs.location,
      locationName: jobs.locationName,
      address: jobs.address,
      city: jobs.city,
      state: jobs.state,
      zipCode: jobs.zipCode,
      latitude: jobs.latitude,
      longitude: jobs.longitude,
      status: jobs.status,
    })
    .from(jobs);

  const missing = allJobs.filter((job) => !hasCoords(job));
  const queue = typeof LIMIT === "number" && Number.isFinite(LIMIT) && LIMIT > 0 ? missing.slice(0, LIMIT) : missing;

  console.log(
    `[backfill-job-coordinates] Total jobs=${allJobs.length}, missing coords=${missing.length}, queued=${queue.length}, mode=${APPLY ? "apply" : "dry-run"}`
  );

  let geocoded = 0;
  let updated = 0;
  let skippedNoAddress = 0;
  let failed = 0;

  for (const job of queue) {
    const candidates = buildAddressCandidates(job);
    if (candidates.length === 0) {
      skippedNoAddress++;
      console.log(`[skip:no-address] jobId=${job.id} title="${job.title}"`);
      continue;
    }

    const coords = await geocodeJob(job);
    if (!coords) {
      failed++;
      console.log(`[fail:geocode] jobId=${job.id} title="${job.title}" query="${candidates[0]}"`);
      continue;
    }

    geocoded++;
    console.log(
      `[ok:geocode] jobId=${job.id} title="${job.title}" -> ${coords.latitude},${coords.longitude}`
    );

    if (!APPLY) continue;

    await db
      .update(jobs)
      .set({
        latitude: coords.latitude,
        longitude: coords.longitude,
      })
      .where(eq(jobs.id, job.id));
    updated++;
  }

  console.log(
    `[backfill-job-coordinates] done geocoded=${geocoded} updated=${updated} skippedNoAddress=${skippedNoAddress} failed=${failed}`
  );
  if (!APPLY) {
    console.log("[backfill-job-coordinates] Dry run only. Re-run with --apply to persist coordinates.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[backfill-job-coordinates] fatal", e);
    process.exit(1);
  });
