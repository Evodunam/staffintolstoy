/**
 * Feature flag evaluator.
 *
 * Usage:
 *   if (await isFeatureEnabled("safety-incident-emails", profile.id)) { ... }
 *
 * Resolution order:
 *   1. Allowlist (profileId in allowlistProfileIds → enabled)
 *   2. enabled=false → disabled
 *   3. rolloutPercent=100 → enabled
 *   4. rolloutPercent=0 → disabled
 *   5. Otherwise: deterministic hash of (flagName + profileId) % 100 < rolloutPercent
 *
 * Cached in-process for 60s to avoid hammering the DB. Cache invalidated on
 * any UPDATE via the optional invalidateFlag() call (admin UI should call it).
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { featureFlags } from "@shared/schema";
import { createHash } from "crypto";

interface CacheEntry {
  row: typeof featureFlags.$inferSelect | null;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

async function getFlagRow(name: string) {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.row;
  const [row] = await db.select().from(featureFlags).where(eq(featureFlags.name, name)).limit(1);
  cache.set(name, { row: row ?? null, fetchedAt: Date.now() });
  return row ?? null;
}

export function invalidateFlag(name: string): void {
  cache.delete(name);
}

export async function isFeatureEnabled(name: string, profileId?: number | null): Promise<boolean> {
  const flag = await getFlagRow(name);
  if (!flag) return false;
  if (!flag.enabled) return false;

  // Allowlist override
  if (profileId != null && Array.isArray(flag.allowlistProfileIds)) {
    if ((flag.allowlistProfileIds as number[]).includes(profileId)) return true;
  }

  const pct = flag.rolloutPercent ?? 0;
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  if (profileId == null) return false;

  // Deterministic hash → bucket 0..99
  const hash = createHash("sha256").update(`${name}:${profileId}`).digest();
  const bucket = hash[0] % 100; // first byte modulo 100
  return bucket < pct;
}
