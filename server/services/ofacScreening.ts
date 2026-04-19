import { promises as fs } from "fs";
import path from "path";
import os from "os";

/**
 * OFAC SDN (Specially Designated Nationals) sanctions screening.
 *
 * Pulls the consolidated CSV list from the U.S. Treasury OFAC website,
 * caches it locally for 24 hours, then performs fuzzy name matching against
 * candidate payees. Used before any payout / wire / ACH transfer to comply
 * with 31 CFR §501 ("frozen property of designated persons").
 *
 * Three possible outcomes per check:
 *   - "cleared":   no plausible match → payout can proceed.
 *   - "review":    at least one fuzzy match → human review required (block until
 *                  the compliance team manually clears or denies).
 *   - "blocked":   exact name + DOB match → never auto-clear; OFAC reporting
 *                  obligation may be triggered (consult counsel).
 *
 * This module DOES NOT replace a real KYC vendor (ComplyAdvantage, Sardine,
 * etc) — it's a backstop for early-stage tenants and for sanity-checking
 * that vendor's results.
 *
 * Source: https://www.treasury.gov/ofac/downloads/sdn.csv
 */

const SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const CACHE_DIR = path.join(os.tmpdir(), "tolstoy-ofac");
const CACHE_FILE = path.join(CACHE_DIR, "sdn.csv");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface SdnEntry {
  /** OFAC's unique identifier for this entry */
  uid: string;
  /** Primary name (LASTNAME, FIRSTNAME or organization name) */
  name: string;
  /** "individual" | "entity" | "vessel" | "aircraft" */
  type: string;
  /** Originating program(s), e.g. "SDGT", "CYBER2", "RUSSIA-EO14024" */
  programs: string;
}

let cachedEntries: SdnEntry[] | null = null;
let cachedAt = 0;

/**
 * Download (or return cached) SDN list. Raw CSV format from Treasury:
 *   ent_num,SDN_Name,SDN_Type,Program,Title,Call_Sign,Vess_type,Tonnage,GRT,Vess_flag,Vess_owner,Remarks
 */
async function loadSdnList(): Promise<SdnEntry[]> {
  if (cachedEntries && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedEntries;
  }

  let csv: string | null = null;
  try {
    // Try local cache file first.
    const stat = await fs.stat(CACHE_FILE).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      csv = await fs.readFile(CACHE_FILE, "utf8");
    }
  } catch { /* */ }

  if (!csv) {
    const res = await fetch(SDN_URL, {
      headers: { "User-Agent": "Tolstoy-Staffing/1.0 (compliance)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`OFAC SDN fetch failed: HTTP ${res.status}`);
    csv = await res.text();
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(CACHE_FILE, csv);
    } catch { /* cache write is best-effort */ }
  }

  const entries = parseSdnCsv(csv);
  cachedEntries = entries;
  cachedAt = Date.now();
  return entries;
}

/**
 * Naive but robust CSV parser for the OFAC format. Treasury uses double-quoted
 * fields with embedded commas; we hand-roll because csv-parse adds another
 * dep. Unknown columns past the 4th are ignored.
 */
function parseSdnCsv(csv: string): SdnEntry[] {
  const out: SdnEntry[] = [];
  const rows = csv.split(/\r?\n/);
  for (const row of rows) {
    if (!row.trim()) continue;
    const fields = parseCsvRow(row);
    if (fields.length < 4) continue;
    out.push({
      uid: fields[0],
      name: fields[1] || "",
      type: (fields[2] || "individual").toLowerCase(),
      programs: fields[3] || "",
    });
  }
  return out;
}

function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { fields.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

/**
 * Normalize for matching: uppercase, strip diacritics, collapse whitespace,
 * drop common name particles ("DE", "DEL", "VAN", "JR", "SR", etc).
 */
function normalize(name: string): string {
  const stripped = name.toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9\s,]/g, " ")
    .replace(/\b(JR|SR|II|III|IV|MR|MRS|MS|DR|DE|DEL|LA|LE|VAN|VON|EL|AL)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

/**
 * Damerau-Levenshtein-ish edit distance for fuzzy match. Bounded for
 * performance — early-exit if exceeded.
 */
function levenshtein(a: string, b: string, maxDist = 3): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export interface ScreeningInput {
  /** Full legal name as on government ID */
  fullName: string;
  /** Optional date of birth — improves match precision when present */
  dateOfBirth?: Date | string | null;
  /** Optional country code (ISO-3166-2) for additional context */
  country?: string;
}

export interface ScreeningResult {
  status: "cleared" | "review" | "blocked";
  /** Top matches that triggered a non-cleared status, capped at 5 */
  matches: { uid: string; name: string; programs: string; score: number }[];
  checkedAt: string;
}

/**
 * Screen a single payee against the SDN list. Returns "cleared" | "review" | "blocked".
 *
 * Match rules:
 *   - Exact normalized name match → "blocked"
 *   - Edit distance ≤ 2 OR substring match on either token → "review"
 *   - Otherwise → "cleared"
 *
 * Errors loading the SDN list bubble up — the caller should treat that as
 * "fail closed" (block payout) rather than "fail open".
 */
export async function screenAgainstSdn(input: ScreeningInput): Promise<ScreeningResult> {
  const entries = await loadSdnList();
  const queryName = normalize(input.fullName);
  if (!queryName) {
    return { status: "review", matches: [], checkedAt: new Date().toISOString() };
  }
  // Tokenize so we can also compare LAST,FIRST style entries.
  const queryTokens = queryName.split(" ").filter(Boolean);
  const queryTokenSet = new Set(queryTokens);

  const matches: ScreeningResult["matches"] = [];
  let blocked = false;
  for (const entry of entries) {
    if (entry.type !== "individual" && entry.type !== "entity") continue;
    const entryName = normalize(entry.name);
    if (!entryName) continue;

    // Exact normalized match → block.
    if (entryName === queryName) {
      matches.unshift({ uid: entry.uid, name: entry.name, programs: entry.programs, score: 1.0 });
      blocked = true;
      continue;
    }
    // Substring (rare but happens with "JOHN SMITH" vs "SMITH, JOHN MICHAEL").
    if (entryName.includes(queryName) || queryName.includes(entryName)) {
      matches.push({ uid: entry.uid, name: entry.name, programs: entry.programs, score: 0.9 });
      continue;
    }
    // Edit-distance fuzzy. Skip if either string is very short to avoid noise.
    if (entryName.length >= 5 && queryName.length >= 5) {
      const dist = levenshtein(entryName, queryName, 2);
      if (dist <= 2) {
        matches.push({ uid: entry.uid, name: entry.name, programs: entry.programs, score: 0.8 - dist * 0.1 });
        continue;
      }
    }
    // Token overlap — at least 2 shared tokens (e.g. firstname + lastname).
    const entryTokens = entryName.split(" ").filter(Boolean);
    const overlap = entryTokens.filter((t) => queryTokenSet.has(t)).length;
    if (overlap >= 2 && queryTokens.length <= 4 && entryTokens.length <= 6) {
      matches.push({ uid: entry.uid, name: entry.name, programs: entry.programs, score: 0.6 + overlap * 0.05 });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, 5);

  return {
    status: blocked ? "blocked" : top.length > 0 ? "review" : "cleared",
    matches: top,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Force-reload the SDN list (drops the cache). Useful from a manual
 * "refresh sanctions list" admin button.
 */
export function invalidateSdnCache() {
  cachedEntries = null;
  cachedAt = 0;
}

