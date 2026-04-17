import type { Express, Request, Response } from "express";
import allTheCities from "all-the-cities";
import { storage } from "./storage";
import { workerFacingJobHourlyCents } from "@shared/platformPayPolicy";

type LandingPage = {
  id: number;
  path: string;
  service: string;
  city: string;
  state: string;
  intent: string;
  buyerType: string;
  slug: string;
};

type HireCityPage = {
  city: string;
  state: string;
  stateSlug: string;
  citySlug: string;
  population: number;
  lat: number;
  lon: number;
  path: string;
};

const SITE_NAME = "Tolstoy Staffing";
const FALLBACK_BASE_URL = "https://tolstoystaffing.com";
const URLS_PER_SITEMAP = 5000;
const HUB_PAGE_SIZE = 250;
const CITY_HUB_PAGE_SIZE = 200;
const DEFAULT_CITY_MIN_POPULATION = 1000;
const DEFAULT_INDEX_ORDER_STRIDE = 65537;
const DEFAULT_INDEX_ORDER_MODE = "shuffled";
const LASTMOD_ISO = (() => {
  const configured = process.env.SEO_LASTMOD_DATE?.trim();
  if (configured) {
    const parsed = new Date(configured);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
})();
const LASTMOD_UTC = new Date(LASTMOD_ISO).toUTCString();
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { value: string; expiresAt: number };
const responseCache = new Map<string, CacheEntry>();

const SERVICES = [
  "General Labor",
  "Carpentry",
  "Electrical Staffing",
  "Plumbing Staffing",
  "HVAC Staffing",
  "Painting Staffing",
  "Warehouse Staffing",
  "Landscaping Staffing",
  "Drywall Staffing",
  "Demolition Crews",
  "Event Setup Crews",
  "Forklift Operators",
  "Retail Merchandising",
  "Janitorial Staffing",
  "Moving Labor",
  "Concrete Crews",
  "Roofing Labor",
  "Maintenance Technicians",
  "Solar Installers",
  "Production Line Staffing",
];

const WORKER_TRADE_OPTIONS = SERVICES.map((service) => ({
  name: service,
  slug: slugify(service),
}));

const MARKETS = [
  { city: "Miami", state: "FL" },
  { city: "Orlando", state: "FL" },
  { city: "Tampa", state: "FL" },
  { city: "Jacksonville", state: "FL" },
  { city: "Atlanta", state: "GA" },
  { city: "Savannah", state: "GA" },
  { city: "Dallas", state: "TX" },
  { city: "Houston", state: "TX" },
  { city: "Austin", state: "TX" },
  { city: "San Antonio", state: "TX" },
  { city: "Fort Worth", state: "TX" },
  { city: "Phoenix", state: "AZ" },
  { city: "Las Vegas", state: "NV" },
  { city: "Reno", state: "NV" },
  { city: "Charlotte", state: "NC" },
  { city: "Raleigh", state: "NC" },
  { city: "Greensboro", state: "NC" },
  { city: "Nashville", state: "TN" },
  { city: "Memphis", state: "TN" },
  { city: "Denver", state: "CO" },
  { city: "Colorado Springs", state: "CO" },
  { city: "Seattle", state: "WA" },
  { city: "Spokane", state: "WA" },
  { city: "Portland", state: "OR" },
  { city: "Salem", state: "OR" },
  { city: "Los Angeles", state: "CA" },
  { city: "San Diego", state: "CA" },
  { city: "San Jose", state: "CA" },
  { city: "San Francisco", state: "CA" },
  { city: "Sacramento", state: "CA" },
  { city: "Riverside", state: "CA" },
  { city: "Chicago", state: "IL" },
  { city: "Springfield", state: "IL" },
  { city: "Boston", state: "MA" },
  { city: "Worcester", state: "MA" },
  { city: "New York", state: "NY" },
  { city: "Buffalo", state: "NY" },
  { city: "Philadelphia", state: "PA" },
  { city: "Pittsburgh", state: "PA" },
  { city: "Columbus", state: "OH" },
  { city: "Cleveland", state: "OH" },
  { city: "Detroit", state: "MI" },
  { city: "Minneapolis", state: "MN" },
  { city: "Kansas City", state: "MO" },
  { city: "St. Louis", state: "MO" },
  { city: "New Orleans", state: "LA" },
  { city: "Baton Rouge", state: "LA" },
  { city: "Birmingham", state: "AL" },
  { city: "Indianapolis", state: "IN" },
  { city: "Louisville", state: "KY" },
];

const INTENTS = [
  { slug: "same-day", label: "same day" },
  { slug: "next-day", label: "next day" },
  { slug: "weekend", label: "weekend" },
  { slug: "night-shift", label: "night shift" },
  { slug: "seasonal", label: "seasonal" },
  { slug: "project-based", label: "project based" },
  { slug: "emergency", label: "emergency" },
  { slug: "recurring", label: "recurring" },
  { slug: "temp-to-hire", label: "temp to hire" },
  { slug: "peak-demand", label: "peak demand" },
];

const BUYER_TYPES = [
  { slug: "construction", label: "construction companies" },
  { slug: "facilities", label: "facility operators" },
  { slug: "property-mgmt", label: "property management teams" },
  { slug: "hospitality", label: "hospitality operators" },
  { slug: "retail", label: "retail groups" },
  { slug: "warehousing", label: "warehouse operators" },
  { slug: "events", label: "event teams" },
  { slug: "franchises", label: "franchise owners" },
  { slug: "municipal", label: "municipal teams" },
  { slug: "manufacturing", label: "manufacturing teams" },
];

const INTENT_EXPLAINERS: Record<string, string> = {
  "same day": "Use this when you need labor coverage within hours and cannot wait for a traditional staffing cycle.",
  "next day": "Best for teams that can schedule one day ahead but still need fast fulfillment.",
  weekend: "Designed for Saturday/Sunday job coverage when standard crews are unavailable.",
  "night shift": "Ideal for overnight projects, reset work, and off-hours maintenance windows.",
  seasonal: "Supports peak-period demand spikes without long-term payroll expansion.",
  "project based": "Fits jobs with a defined start/end date and clear output goals.",
  emergency: "For urgent situations where speed and reliable attendance matter most.",
  recurring: "A good model for repeating weekly/monthly labor requirements.",
  "temp to hire": "Lets you evaluate workers on the job before making longer commitments.",
  "peak demand": "Absorb sudden order surges or schedule compression without burning out your core team.",
};

const BUYER_TYPE_EXPLAINERS: Record<string, string> = {
  "construction companies": "Construction teams use this model to fill punch lists, framing support, cleanup, and rapid crew expansion.",
  "facility operators": "Facility operators rely on flexible staffing to keep uptime high and backlog low.",
  "property management teams": "Property managers use on-demand labor for turnover work, maintenance bursts, and capex projects.",
  "hospitality operators": "Hospitality teams use staffing bursts for renovation cycles and high-occupancy weekends.",
  "retail groups": "Retail operators hire project crews for resets, remodels, and seasonal floor changes.",
  "warehouse operators": "Warehouse teams use this for inbound/outbound spikes, kitting, and dock support.",
  "event teams": "Event operators need short-window labor for setup, strike, and logistics support.",
  "franchise owners": "Franchise owners use rapid staffing to keep multi-location operations moving.",
  "municipal teams": "Public teams use flexible labor for projects that exceed regular department bandwidth.",
  "manufacturing teams": "Manufacturing operators use staffing support to protect throughput during demand shifts.",
};

const SERVICE_TASKS: Record<string, string[]> = {
  "General Labor": ["site cleanup", "material movement", "basic setup work"],
  Carpentry: ["framing support", "trim installation", "light repair work"],
  "Electrical Staffing": ["fixture replacement", "panel support tasks", "wiring prep work"],
  "Plumbing Staffing": ["fixture installs", "line support work", "repair assistance"],
  "HVAC Staffing": ["unit support tasks", "duct support work", "maintenance assistance"],
  "Painting Staffing": ["surface prep", "interior coating", "exterior painting support"],
  "Warehouse Staffing": ["pick/pack", "inventory moves", "dock operations support"],
  "Landscaping Staffing": ["grounds cleanup", "installation support", "maintenance rounds"],
  "Drywall Staffing": ["hanging support", "mud/tape support", "patch/repair work"],
  "Demolition Crews": ["tear-out work", "debris handling", "site reset support"],
  "Event Setup Crews": ["booth setup", "staging support", "event strike operations"],
  "Forklift Operators": ["pallet movement", "dock loading", "warehouse relocation work"],
  "Retail Merchandising": ["planogram resets", "shelf setup", "display installation"],
  "Janitorial Staffing": ["deep cleaning", "turnover cleaning", "facility sanitation"],
  "Moving Labor": ["loading", "unloading", "furniture placement"],
  "Concrete Crews": ["prep work", "pour support", "finishing support"],
  "Roofing Labor": ["material handling", "tear-off support", "installation assistance"],
  "Maintenance Technicians": ["work order completion", "preventive maintenance", "basic repairs"],
  "Solar Installers": ["panel mounting support", "site prep", "system installation support"],
  "Production Line Staffing": ["line support", "packaging", "throughput balancing support"],
};

const INTRO_VARIANTS = [
  "Need a faster way to secure dependable labor without slowing down operations?",
  "When project timelines tighten, flexible staffing can keep work moving without overhiring.",
  "For teams under delivery pressure, on-demand labor helps close staffing gaps quickly.",
  "If your workload changes week to week, variable staffing can protect margins and output.",
  "When internal crews are fully booked, supplemental labor keeps schedules on track.",
];

const PROCESS_VARIANTS = [
  "Post your role requirements, review matched worker profiles, and confirm coverage in minutes.",
  "Define shift details and scope, then move from request to staffed job with less admin overhead.",
  "Share timeline, location, and required skills, and our workflow routes matches to available workers.",
  "Use a single flow for intake, staffing, and timesheet visibility to reduce coordination friction.",
  "From job posting to attendance tracking, each step is built for rapid operational execution.",
];

const PAGE_COUNT = SERVICES.length * MARKETS.length * INTENTS.length * BUYER_TYPES.length;
const ENV_INDEX_LIMIT_RAW = process.env.SEO_INDEXABLE_PAGE_LIMIT?.trim();
const ENV_HUB_LINK_LIMIT_RAW = process.env.SEO_HUB_LINK_LIMIT?.trim();
const ENV_INDEX_ORDER_STRIDE_RAW = process.env.SEO_INDEX_ORDER_STRIDE?.trim();
const ENV_INDEX_ORDER_MODE_RAW = process.env.SEO_INDEX_ORDER_MODE?.trim().toLowerCase();
const ENV_ENFORCE_RELEVANCE_RAW = process.env.SEO_ENFORCE_RELEVANCE_FILTER?.trim().toLowerCase();
const ENV_CITY_MIN_POPULATION_RAW = process.env.SEO_CITY_MIN_POPULATION?.trim();
const ENV_CITY_INDEXABLE_LIMIT_RAW = process.env.SEO_CITY_INDEXABLE_LIMIT?.trim();
const ENV_CITY_HUB_LINK_LIMIT_RAW = process.env.SEO_CITY_HUB_LINK_LIMIT?.trim();
const ENV_WORKER_CITY_INDEXABLE_LIMIT_RAW = process.env.SEO_WORKER_CITY_INDEXABLE_LIMIT?.trim();
const ENV_WORKER_CITY_HUB_LINK_LIMIT_RAW = process.env.SEO_WORKER_CITY_HUB_LINK_LIMIT?.trim();
const ENV_WORKER_CITY_TRADE_INDEXABLE_LIMIT_RAW = process.env.SEO_WORKER_CITY_TRADE_INDEXABLE_LIMIT?.trim();
const ENV_SERVICE_BUYER_COMPATIBILITY_JSON = process.env.SEO_SERVICE_BUYER_COMPATIBILITY_JSON?.trim();
const ENV_INTENT_BUYER_COMPATIBILITY_JSON = process.env.SEO_INTENT_BUYER_COMPATIBILITY_JSON?.trim();

const PUBLIC_PATHS = [
  "/",
  "/about",
  "/careers",
  "/press",
  "/terms",
  "/privacy",
  "/legal",
  "/support",
  "/contact",
  "/for-service-professionals",
  "/for-affiliates",
  "/how-time-keeping-works",
  "/worker-onboarding",
  "/company-onboarding",
  "/find-work",
  "/jobs",
];

/**
 * Tuned sitemap entries for the core site.
 * Priority + changefreq matter to crawlers; tune per page importance.
 */
const CORE_SITEMAP_URLS: Array<{ path: string; priority: string; changefreq: string }> = [
  // Top-level + revenue critical
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/find-work", priority: "0.95", changefreq: "daily" },
  { path: "/jobs", priority: "0.9", changefreq: "daily" },
  { path: "/for-service-professionals", priority: "0.9", changefreq: "weekly" },
  { path: "/for-affiliates", priority: "0.9", changefreq: "weekly" },
  { path: "/worker-onboarding", priority: "0.9", changefreq: "weekly" },
  { path: "/company-onboarding", priority: "0.9", changefreq: "weekly" },

  // Programmatic SEO hubs (chunked sitemaps cover individual leaves)
  { path: "/services", priority: "0.85", changefreq: "weekly" },
  { path: "/company-onboarding/cities", priority: "0.85", changefreq: "weekly" },
  { path: "/worker-onboarding/cities", priority: "0.85", changefreq: "weekly" },

  // Trust + product info
  { path: "/how-time-keeping-works", priority: "0.8", changefreq: "monthly" },

  // Brand + corporate
  { path: "/about", priority: "0.6", changefreq: "monthly" },
  { path: "/careers", priority: "0.6", changefreq: "weekly" },
  { path: "/press", priority: "0.5", changefreq: "monthly" },
  { path: "/contact", priority: "0.5", changefreq: "monthly" },
  { path: "/support", priority: "0.5", changefreq: "monthly" },

  // Legal / compliance
  { path: "/terms", priority: "0.4", changefreq: "monthly" },
  { path: "/privacy", priority: "0.4", changefreq: "monthly" },
  { path: "/legal", priority: "0.4", changefreq: "monthly" },
];

const ROBOTS_DISALLOW_PATHS = [
  "/api/",
  "/dashboard",
  "/company-dashboard",
  "/affiliate-dashboard",
  "/admin",
  "/accepted-job",
  "/chats",
  "/onboarding",
  "/affiliate-onboarding",
  "/reset-password",
  "/login",
];

const DEFAULT_SERVICE_BUYER_COMPATIBILITY: Record<string, string[]> = {
  "General Labor": BUYER_TYPES.map((b) => b.label),
  Carpentry: ["construction companies", "property management teams", "franchise owners", "facility operators", "hospitality operators"],
  "Electrical Staffing": ["construction companies", "facility operators", "property management teams", "hospitality operators", "franchise owners"],
  "Plumbing Staffing": ["construction companies", "facility operators", "property management teams", "hospitality operators", "franchise owners"],
  "HVAC Staffing": ["construction companies", "facility operators", "property management teams", "hospitality operators", "manufacturing teams"],
  "Painting Staffing": ["construction companies", "property management teams", "hospitality operators", "retail groups", "franchise owners"],
  "Warehouse Staffing": ["warehouse operators", "retail groups", "manufacturing teams", "franchise owners"],
  "Landscaping Staffing": ["property management teams", "municipal teams", "hospitality operators", "franchise owners"],
  "Drywall Staffing": ["construction companies", "property management teams", "hospitality operators"],
  "Demolition Crews": ["construction companies", "property management teams", "municipal teams"],
  "Event Setup Crews": ["event teams", "hospitality operators", "retail groups", "franchise owners"],
  "Forklift Operators": ["warehouse operators", "manufacturing teams", "retail groups"],
  "Retail Merchandising": ["retail groups", "franchise owners", "warehouse operators"],
  "Janitorial Staffing": ["facility operators", "property management teams", "hospitality operators", "retail groups", "municipal teams"],
  "Moving Labor": ["property management teams", "facility operators", "retail groups", "franchise owners"],
  "Concrete Crews": ["construction companies", "municipal teams", "property management teams"],
  "Roofing Labor": ["construction companies", "property management teams", "facility operators"],
  "Maintenance Technicians": ["facility operators", "property management teams", "hospitality operators", "manufacturing teams", "retail groups"],
  "Solar Installers": ["construction companies", "municipal teams", "facility operators"],
  "Production Line Staffing": ["manufacturing teams", "warehouse operators", "retail groups"],
};

const DEFAULT_INTENT_BUYER_COMPATIBILITY: Record<string, string[]> = {
  "same day": BUYER_TYPES.map((b) => b.label),
  "next day": BUYER_TYPES.map((b) => b.label),
  weekend: ["hospitality operators", "retail groups", "event teams", "property management teams", "franchise owners", "facility operators"],
  "night shift": ["warehouse operators", "manufacturing teams", "facility operators", "retail groups", "construction companies"],
  seasonal: ["retail groups", "hospitality operators", "warehouse operators", "event teams", "franchise owners"],
  "project based": BUYER_TYPES.map((b) => b.label),
  emergency: ["facility operators", "property management teams", "construction companies", "hospitality operators", "municipal teams"],
  recurring: ["facility operators", "property management teams", "warehouse operators", "manufacturing teams", "retail groups", "franchise owners"],
  "temp to hire": ["warehouse operators", "manufacturing teams", "retail groups", "facility operators", "construction companies"],
  "peak demand": ["retail groups", "warehouse operators", "manufacturing teams", "event teams", "hospitality operators"],
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parsePositiveInt(input: string): number | null {
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function clampRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function modInverse(a: number, m: number): number {
  let t = 0;
  let newT = 1;
  let r = m;
  let newR = mod(a, m);
  while (newR !== 0) {
    const q = Math.floor(r / newR);
    const tempT = t - q * newT;
    t = newT;
    newT = tempT;
    const tempR = r - q * newR;
    r = newR;
    newR = tempR;
  }
  if (r !== 1) return 0;
  return mod(t, m);
}

function resolveIndexOrderStride(): number {
  const fallback = gcd(DEFAULT_INDEX_ORDER_STRIDE, PAGE_COUNT) === 1 ? DEFAULT_INDEX_ORDER_STRIDE : 1;
  if (!ENV_INDEX_ORDER_STRIDE_RAW) return fallback;
  const parsed = Number(ENV_INDEX_ORDER_STRIDE_RAW);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return gcd(parsed, PAGE_COUNT) === 1 ? parsed : fallback;
}

function resolveIndexOrderMode(): "sequential" | "shuffled" {
  if (ENV_INDEX_ORDER_MODE_RAW === "sequential") return "sequential";
  if (ENV_INDEX_ORDER_MODE_RAW === "shuffled") return "shuffled";
  return DEFAULT_INDEX_ORDER_MODE as "shuffled";
}

function resolveEnforceRelevanceFilter(): boolean {
  return ENV_ENFORCE_RELEVANCE_RAW === "1" || ENV_ENFORCE_RELEVANCE_RAW === "true";
}

function resolveCityMinPopulation(): number {
  if (!ENV_CITY_MIN_POPULATION_RAW) return DEFAULT_CITY_MIN_POPULATION;
  const parsed = Number(ENV_CITY_MIN_POPULATION_RAW);
  if (!Number.isInteger(parsed) || parsed < 1000) return DEFAULT_CITY_MIN_POPULATION;
  return parsed;
}

function parseCompatibilityMapFromEnv(
  raw: string | undefined,
  fallback: Record<string, string[]>,
): Record<string, string[]> {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
    const normalized: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const labels = value.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (labels.length > 0) normalized[key] = labels;
    }
    const hasEntries = Object.keys(normalized).length > 0;
    return hasEntries ? normalized : fallback;
  } catch {
    return fallback;
  }
}

function resolveIndexablePageLimit(): number {
  if (!ENV_INDEX_LIMIT_RAW) return PAGE_COUNT;
  const parsed = Number(ENV_INDEX_LIMIT_RAW);
  if (!Number.isInteger(parsed)) return PAGE_COUNT;
  return clampRange(parsed, 0, PAGE_COUNT);
}

function resolveHubLinkLimit(indexablePageLimit: number): number {
  if (!ENV_HUB_LINK_LIMIT_RAW) return indexablePageLimit;
  const parsed = Number(ENV_HUB_LINK_LIMIT_RAW);
  if (!Number.isInteger(parsed)) return indexablePageLimit;
  return clampRange(parsed, 0, indexablePageLimit);
}

function getCachedOrCompute(key: string, producer: () => string): string {
  const now = Date.now();
  const existing = responseCache.get(key);
  if (existing && existing.expiresAt > now) return existing.value;
  const value = producer();
  responseCache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

function isNotModifiedSince(req: Request): boolean {
  const ifModifiedSince = req.headers["if-modified-since"];
  if (typeof ifModifiedSince !== "string") return false;
  const clientTs = Date.parse(ifModifiedSince);
  const serverTs = Date.parse(LASTMOD_UTC);
  if (Number.isNaN(clientTs) || Number.isNaN(serverTs)) return false;
  return clientTs >= serverTs;
}

function respondNotModifiedIfFresh(req: Request, res: Response): boolean {
  if (!isNotModifiedSince(req)) return false;
  res.status(304).end();
  return true;
}

const INDEXABLE_PAGE_LIMIT = resolveIndexablePageLimit();
const HUB_LINK_LIMIT = resolveHubLinkLimit(INDEXABLE_PAGE_LIMIT);
const INDEX_ORDER_MODE = resolveIndexOrderMode();
const INDEX_ORDER_STRIDE = resolveIndexOrderStride();
const INDEX_ORDER_STRIDE_INVERSE = modInverse(INDEX_ORDER_STRIDE, PAGE_COUNT);
const ENFORCE_RELEVANCE_FILTER = resolveEnforceRelevanceFilter();
const CITY_MIN_POPULATION = resolveCityMinPopulation();
const SERVICE_BUYER_COMPATIBILITY = parseCompatibilityMapFromEnv(
  ENV_SERVICE_BUYER_COMPATIBILITY_JSON,
  DEFAULT_SERVICE_BUYER_COMPATIBILITY,
);
const INTENT_BUYER_COMPATIBILITY = parseCompatibilityMapFromEnv(
  ENV_INTENT_BUYER_COMPATIBILITY_JSON,
  DEFAULT_INTENT_BUYER_COMPATIBILITY,
);
const ALL_HIRE_CITY_PAGES = buildHireCityPages(CITY_MIN_POPULATION);
const CITY_INDEXABLE_LIMIT = clampRange(
  Number(ENV_CITY_INDEXABLE_LIMIT_RAW ?? ALL_HIRE_CITY_PAGES.length) || ALL_HIRE_CITY_PAGES.length,
  0,
  ALL_HIRE_CITY_PAGES.length,
);
const CITY_HUB_LINK_LIMIT = clampRange(
  Number(ENV_CITY_HUB_LINK_LIMIT_RAW ?? CITY_INDEXABLE_LIMIT) || CITY_INDEXABLE_LIMIT,
  0,
  CITY_INDEXABLE_LIMIT,
);
const INDEXABLE_HIRE_CITY_PAGES = ALL_HIRE_CITY_PAGES.slice(0, CITY_INDEXABLE_LIMIT);
const HIRE_CITY_HUB_PAGES = INDEXABLE_HIRE_CITY_PAGES.slice(0, CITY_HUB_LINK_LIMIT);
const HIRE_CITY_BY_SLUG = new Map(
  INDEXABLE_HIRE_CITY_PAGES.map((city) => [`${city.stateSlug}:${city.citySlug}`, city]),
);
const ALL_WORKER_CITY_PAGES: HireCityPage[] = ALL_HIRE_CITY_PAGES.map((city) => ({
  ...city,
  path: `/worker-onboarding/${city.stateSlug}/${city.citySlug}`,
}));
const WORKER_CITY_INDEXABLE_LIMIT = clampRange(
  Number(ENV_WORKER_CITY_INDEXABLE_LIMIT_RAW ?? ALL_WORKER_CITY_PAGES.length) || ALL_WORKER_CITY_PAGES.length,
  0,
  ALL_WORKER_CITY_PAGES.length,
);
const WORKER_CITY_HUB_LINK_LIMIT = clampRange(
  Number(ENV_WORKER_CITY_HUB_LINK_LIMIT_RAW ?? WORKER_CITY_INDEXABLE_LIMIT) || WORKER_CITY_INDEXABLE_LIMIT,
  0,
  WORKER_CITY_INDEXABLE_LIMIT,
);
const INDEXABLE_WORKER_CITY_PAGES = ALL_WORKER_CITY_PAGES.slice(0, WORKER_CITY_INDEXABLE_LIMIT);
const WORKER_CITY_HUB_PAGES = INDEXABLE_WORKER_CITY_PAGES.slice(0, WORKER_CITY_HUB_LINK_LIMIT);
const WORKER_CITY_BY_SLUG = new Map(
  INDEXABLE_WORKER_CITY_PAGES.map((city) => [`${city.stateSlug}:${city.citySlug}`, city]),
);
const WORKER_TRADE_BY_SLUG = new Map(
  WORKER_TRADE_OPTIONS.map((trade) => [trade.slug, trade.name] as const),
);
const WORKER_CITY_TRADE_PAGE_COUNT = INDEXABLE_WORKER_CITY_PAGES.length * WORKER_TRADE_OPTIONS.length;
const WORKER_CITY_TRADE_INDEXABLE_LIMIT = clampRange(
  Number(ENV_WORKER_CITY_TRADE_INDEXABLE_LIMIT_RAW ?? WORKER_CITY_TRADE_PAGE_COUNT) ||
    WORKER_CITY_TRADE_PAGE_COUNT,
  0,
  WORKER_CITY_TRADE_PAGE_COUNT,
);

function idFromIndexPosition(positionZeroBased: number): number {
  if (INDEX_ORDER_MODE === "sequential") {
    return mod(positionZeroBased, PAGE_COUNT) + 1;
  }
  const normalized = mod(positionZeroBased, PAGE_COUNT);
  return mod(normalized * INDEX_ORDER_STRIDE, PAGE_COUNT) + 1;
}

function indexPositionFromId(id: number): number {
  if (INDEX_ORDER_MODE === "sequential") {
    return id - 1;
  }
  const idZeroBased = id - 1;
  return mod(idZeroBased * INDEX_ORDER_STRIDE_INVERSE, PAGE_COUNT);
}

function isIdIndexable(id: number): boolean {
  return EFFECTIVE_INDEXABLE_ID_SET.has(id);
}

function idFromHubPosition(positionOneBased: number): number {
  return idFromIndexPosition(positionOneBased - 1);
}

function isBusinessRelevant(page: LandingPage): boolean {
  const serviceAllowedBuyers = SERVICE_BUYER_COMPATIBILITY[page.service] ?? [];
  if (!serviceAllowedBuyers.includes(page.buyerType)) return false;

  const intentAllowedBuyers = INTENT_BUYER_COMPATIBILITY[page.intent] ?? [];
  if (!intentAllowedBuyers.includes(page.buyerType)) return false;

  return true;
}

const ORDERED_PAGE_IDS = Array.from({ length: PAGE_COUNT }, (_, i) => idFromIndexPosition(i));
const RELEVANT_ORDERED_PAGE_IDS = ORDERED_PAGE_IDS.filter((id) => {
  const page = getPageFromId(id);
  return page ? isBusinessRelevant(page) : false;
});
const EFFECTIVE_ORDERED_INDEXABLE_IDS = (ENFORCE_RELEVANCE_FILTER
  ? RELEVANT_ORDERED_PAGE_IDS
  : ORDERED_PAGE_IDS).slice(0, INDEXABLE_PAGE_LIMIT);
const EFFECTIVE_INDEXABLE_ID_SET = new Set(EFFECTIVE_ORDERED_INDEXABLE_IDS);
const EFFECTIVE_INDEXABLE_PAGE_COUNT = EFFECTIVE_ORDERED_INDEXABLE_IDS.length;
const EFFECTIVE_HUB_LINK_COUNT = Math.min(HUB_LINK_LIMIT, EFFECTIVE_INDEXABLE_PAGE_COUNT);
const EFFECTIVE_HUB_IDS = EFFECTIVE_ORDERED_INDEXABLE_IDS.slice(0, EFFECTIVE_HUB_LINK_COUNT);
const SITEMAP_CHUNK_COUNT = Math.ceil(EFFECTIVE_INDEXABLE_PAGE_COUNT / URLS_PER_SITEMAP);
const CITY_SITEMAP_CHUNK_COUNT = Math.ceil(INDEXABLE_HIRE_CITY_PAGES.length / URLS_PER_SITEMAP);
const WORKER_CITY_SITEMAP_CHUNK_COUNT = Math.ceil(INDEXABLE_WORKER_CITY_PAGES.length / URLS_PER_SITEMAP);
const WORKER_CITY_TRADE_SITEMAP_CHUNK_COUNT = Math.ceil(
  WORKER_CITY_TRADE_INDEXABLE_LIMIT / URLS_PER_SITEMAP,
);

function buildIndexOrderPreviewIds(sampleSize: number): number[] {
  const safeSize = Math.max(0, sampleSize);
  const max = Math.min(PAGE_COUNT, safeSize);
  const ids: number[] = [];
  for (let i = 0; i < max; i++) {
    ids.push(idFromIndexPosition(i));
  }
  return ids;
}

function buildHubPreviewIds(sampleSize: number): number[] {
  const safeSize = Math.max(0, sampleSize);
  const max = Math.min(EFFECTIVE_HUB_LINK_COUNT, safeSize);
  const ids: number[] = [];
  for (let i = 0; i < max; i++) {
    ids.push(EFFECTIVE_HUB_IDS[i]);
  }
  return ids;
}

function buildEffectiveIndexPreviewIds(sampleSize: number): number[] {
  const safeSize = Math.max(0, sampleSize);
  return EFFECTIVE_ORDERED_INDEXABLE_IDS.slice(0, safeSize);
}

function getNonIndexablePreviewId(): number | null {
  if (EFFECTIVE_INDEXABLE_PAGE_COUNT >= PAGE_COUNT) return null;
  for (const id of ORDERED_PAGE_IDS) {
    if (!EFFECTIVE_INDEXABLE_ID_SET.has(id)) return id;
  }
  return null;
}

function getBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = req.get("host");
  if (!host) return FALLBACK_BASE_URL;
  const isLocal = host.includes("localhost") || host.startsWith("127.0.0.1");
  const protocol = isLocal ? "http" : "https";
  return `${protocol}://${host}`;
}

function buildHireCityPages(minPopulation: number): HireCityPage[] {
  const deduped = new Map<string, HireCityPage>();
  const source = allTheCities as Array<{
    name: string;
    country: string;
    adminCode: string;
    population: number;
    loc?: { coordinates?: [number, number] };
  }>;

  for (const city of source) {
    if (city.country !== "US") continue;
    if (!city.name || !city.adminCode) continue;
    if (Number(city.population ?? 0) < minPopulation) continue;
    const state = city.adminCode.toUpperCase();
    const citySlug = slugify(city.name);
    if (!citySlug) continue;
    const stateSlug = slugify(state);
    const key = `${stateSlug}:${citySlug}`;
    const population = Number(city.population ?? 0);
    const current = deduped.get(key);
    if (current && current.population >= population) continue;
    const lon = city.loc?.coordinates?.[0] ?? 0;
    const lat = city.loc?.coordinates?.[1] ?? 0;
    deduped.set(key, {
      city: city.name,
      state,
      stateSlug,
      citySlug,
      population,
      lat,
      lon,
      path: `/company-onboarding/${stateSlug}/${citySlug}`,
    });
  }

  return Array.from(deduped.values()).sort(
    (a, b) => b.population - a.population || a.state.localeCompare(b.state) || a.city.localeCompare(b.city),
  );
}

function getWorkerCityTradePageByIndex(indexZeroBased: number): {
  city: HireCityPage;
  tradeName: string;
  tradeSlug: string;
  path: string;
} | null {
  if (indexZeroBased < 0 || indexZeroBased >= WORKER_CITY_TRADE_INDEXABLE_LIMIT) return null;
  if (WORKER_TRADE_OPTIONS.length === 0 || INDEXABLE_WORKER_CITY_PAGES.length === 0) return null;
  const tradeIndex = indexZeroBased % WORKER_TRADE_OPTIONS.length;
  const cityIndex = Math.floor(indexZeroBased / WORKER_TRADE_OPTIONS.length);
  const city = INDEXABLE_WORKER_CITY_PAGES[cityIndex];
  const trade = WORKER_TRADE_OPTIONS[tradeIndex];
  if (!city || !trade) return null;
  const path = `/worker-onboarding/${city.stateSlug}/${city.citySlug}/${trade.slug}`;
  return { city, tradeName: trade.name, tradeSlug: trade.slug, path };
}

function getPageFromId(id: number): LandingPage | null {
  if (id < 1 || id > PAGE_COUNT) return null;
  const idx = id - 1;
  const serviceCount = SERVICES.length;
  const marketCount = MARKETS.length;
  const intentCount = INTENTS.length;

  const serviceIndex = idx % serviceCount;
  const marketIndex = Math.floor(idx / serviceCount) % marketCount;
  const intentIndex = Math.floor(idx / (serviceCount * marketCount)) % intentCount;
  const buyerTypeIndex = Math.floor(idx / (serviceCount * marketCount * intentCount));

  const service = SERVICES[serviceIndex];
  const market = MARKETS[marketIndex];
  const intent = INTENTS[intentIndex];
  const buyerType = BUYER_TYPES[buyerTypeIndex];
  const slug = `${slugify(service)}-${slugify(market.city)}-${market.state.toLowerCase()}-${intent.slug}-${buyerType.slug}`;
  const path = `/services/p/${id}/${slug}`;

  return {
    id,
    path,
    slug,
    service,
    city: market.city,
    state: market.state,
    intent: intent.label,
    buyerType: buyerType.label,
  };
}

function renderLandingHtml(page: LandingPage, baseUrl: string, isIndexable: boolean): string {
  const title = `${page.service} in ${page.city}, ${page.state} (${page.intent}) | ${SITE_NAME}`;
  const description = `Need ${page.intent} ${page.service.toLowerCase()} in ${page.city}, ${page.state}? ${SITE_NAME} helps ${page.buyerType} hire vetted contract labor fast.`;
  const canonical = `${baseUrl}${page.path}`;
  const heading = `${page.service} in ${page.city}, ${page.state}`;
  const serviceTasks = SERVICE_TASKS[page.service] ?? ["project support", "labor coverage", "on-site execution"];
  const introVariant = INTRO_VARIANTS[page.id % INTRO_VARIANTS.length];
  const processVariant = PROCESS_VARIANTS[page.id % PROCESS_VARIANTS.length];
  const intentBlurb =
    INTENT_EXPLAINERS[page.intent] ??
    "Flexible staffing helps your team respond quickly to changing demand.";
  const buyerTypeBlurb =
    BUYER_TYPE_EXPLAINERS[page.buyerType] ??
    "Business teams use this model when they need reliable workers fast.";
  const relatedIds = [page.id + 1, page.id + 37, page.id + 911]
    .map((id) => (id > PAGE_COUNT ? id - PAGE_COUNT : id))
    .map((id) => getPageFromId(id))
    .filter((candidate): candidate is LandingPage => !!candidate);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        serviceType: page.service,
        areaServed: `${page.city}, ${page.state}`,
        provider: {
          "@type": "Organization",
          name: SITE_NAME,
          url: baseUrl,
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: `How quickly can we hire ${page.service.toLowerCase()} in ${page.city}?`,
            acceptedAnswer: {
              "@type": "Answer",
              text: `Many teams use this page for ${page.intent} needs. Timing depends on shift details and worker availability in ${page.city}, ${page.state}.`,
            },
          },
          {
            "@type": "Question",
            name: `Is this service built for ${page.buyerType}?`,
            acceptedAnswer: {
              "@type": "Answer",
              text: `Yes. Workflows on Tolstoy Staffing are designed for business operators including ${page.buyerType}, with fast staffing and transparent time tracking.`,
            },
          },
          {
            "@type": "Question",
            name: `What tasks are common for ${page.service.toLowerCase()} projects?`,
            acceptedAnswer: {
              "@type": "Answer",
              text: `Common tasks include ${serviceTasks[0]}, ${serviceTasks[1]}, and ${serviceTasks[2]}.`,
            },
          },
        ],
      },
    ],
  };

  const faqHtml = [
    {
      q: `How quickly can we hire ${page.service.toLowerCase()} in ${page.city}?`,
      a: `Many teams use this page for ${page.intent} coverage. Timing depends on shift details and worker availability in ${page.city}, ${page.state}.`,
    },
    {
      q: `Is this built for ${page.buyerType}?`,
      a: `Yes. This page is tuned for operational buyers like ${page.buyerType} that need faster staffing execution.`,
    },
    {
      q: `What tasks are common for ${page.service.toLowerCase()}?`,
      a: `Typical requests include ${serviceTasks[0]}, ${serviceTasks[1]}, and ${serviceTasks[2]}.`,
    },
  ]
    .map(
      (item) =>
        `<details><summary>${escapeHtml(item.q)}</summary><p>${escapeHtml(item.a)}</p></details>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="${isIndexable ? "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1" : "noindex,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1f2937; background: #f8fafc; }
      main { max-width: 980px; margin: 0 auto; padding: 40px 20px 72px; }
      h1 { margin: 0 0 12px; font-size: 2rem; line-height: 1.2; color: #0f172a; }
      h2 { margin-top: 28px; font-size: 1.2rem; color: #0f172a; }
      p, li { line-height: 1.7; color: #334155; }
      .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; }
      .cta { margin-top: 18px; display: inline-block; text-decoration: none; background: #00a86b; color: #fff; font-weight: 600; border-radius: 10px; padding: 12px 18px; }
      .links { margin-top: 20px; display: flex; gap: 12px; flex-wrap: wrap; }
      .links a { color: #0f766e; text-decoration: none; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <article class="card">
        <h1>${escapeHtml(heading)}</h1>
        <p>${escapeHtml(introVariant)}</p>
        <p><strong>Use case:</strong> ${escapeHtml(`${page.intent} staffing for ${page.buyerType}`)}</p>
        <p>${escapeHtml(
          `${SITE_NAME} connects ${page.buyerType} in ${page.city}, ${page.state} with reliable ${page.service.toLowerCase()} workers for short-term, project-based, and recurring needs.`,
        )}</p>
        <p>${escapeHtml(intentBlurb)}</p>
        <p>${escapeHtml(buyerTypeBlurb)}</p>
        <p>${escapeHtml(processVariant)}</p>
        <p>${escapeHtml(
          `If you need ${page.intent} coverage, our platform helps you post jobs quickly, match with qualified workers, and scale labor up or down based on demand.`,
        )}</p>
        <h2>Why businesses choose ${escapeHtml(SITE_NAME)}</h2>
        <ul>
          <li>${escapeHtml(`Faster hiring for ${page.service.toLowerCase()} projects in ${page.city}`)}</li>
          <li>${escapeHtml(`Built for ${page.buyerType} with practical staffing workflows`)}</li>
          <li>${escapeHtml(
            `Common ${page.service.toLowerCase()} tasks include ${serviceTasks[0]}, ${serviceTasks[1]}, and ${serviceTasks[2]}.`,
          )}</li>
          <li>Flexible on-demand staffing without long-term lock-in</li>
          <li>Transparent rates, time tracking, and simple onboarding</li>
        </ul>
        <a class="cta" href="/company-onboarding">Start hiring now</a>
        <div class="links">
          <a href="/services">Browse all service areas</a>
          <a href="/for-service-professionals">For service professionals</a>
          <a href="/support">Support</a>
        </div>
        <h2>Related service pages</h2>
        <ul>
          ${relatedIds
            .map(
              (related) =>
                `<li><a href="${escapeHtml(related.path)}">${escapeHtml(
                  `${related.service} in ${related.city}, ${related.state} (${related.intent})`,
                )}</a></li>`,
            )
            .join("")}
        </ul>
        <h2>Frequently asked questions</h2>
        ${faqHtml}
      </article>
    </main>
  </body>
</html>`;
}

function renderServicesHubHtml(baseUrl: string, pageNumber: number): string {
  const title = `Service Areas | ${SITE_NAME}`;
  const description = `${SITE_NAME} service pages by trade, city, intent, and buyer type.`;
  const visibleCount = EFFECTIVE_HUB_LINK_COUNT;
  const pageCount = Math.max(1, Math.ceil(Math.max(1, visibleCount) / HUB_PAGE_SIZE));
  const safePage = Math.max(1, Math.min(pageNumber, pageCount));
  const startId = (safePage - 1) * HUB_PAGE_SIZE + 1;
  const endId = Math.min(visibleCount, safePage * HUB_PAGE_SIZE);
  let listHtml = "";
  if (visibleCount > 0) {
    for (let position = startId - 1; position <= endId - 1; position++) {
      const id = EFFECTIVE_HUB_IDS[position];
      const page = getPageFromId(id);
      if (!page) continue;
      listHtml += `<li><a href="${escapeHtml(page.path)}">${escapeHtml(
        `${page.service} in ${page.city}, ${page.state} (${page.intent}, ${page.buyerType})`,
      )}</a></li>`;
    }
  }
  const prevPage = safePage > 1 ? safePage - 1 : null;
  const nextPage = safePage < pageCount ? safePage + 1 : null;
  const canonicalHubUrl = safePage === 1 ? `${baseUrl}/services` : `${baseUrl}/services?page=${safePage}`;
  const prevLinkTag = prevPage
    ? `<link rel="prev" href="${escapeHtml(prevPage === 1 ? `${baseUrl}/services` : `${baseUrl}/services?page=${prevPage}`)}" />`
    : "";
  const nextLinkTag = nextPage
    ? `<link rel="next" href="${escapeHtml(`${baseUrl}/services?page=${nextPage}`)}" />`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalHubUrl)}" />
    <meta name="robots" content="index,follow" />
    ${prevLinkTag}
    ${nextLinkTag}
    <style>
      body { margin: 0; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0f172a; background: #f8fafc; }
      main { max-width: 980px; margin: 0 auto; padding: 28px 20px 60px; }
      .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; }
      ul { columns: 2; padding-left: 18px; }
      li { margin: 0 0 10px; break-inside: avoid; }
      a { color: #0f766e; text-decoration: none; }
      .pager { margin-top: 18px; display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
      .pager a { color: #0369a1; font-weight: 600; }
      @media (max-width: 768px) { ul { columns: 1; } }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Service Area Pages</h1>
        <p>Total generated pages: ${PAGE_COUNT.toLocaleString()}. Indexable pages: ${EFFECTIVE_INDEXABLE_PAGE_COUNT.toLocaleString()}. Hub-linked pages: ${visibleCount.toLocaleString()}.</p>
        <p>Showing ${visibleCount > 0 ? `${startId.toLocaleString()}-${endId.toLocaleString()}` : "0-0"} of ${visibleCount.toLocaleString()} hub-linked pages.</p>
        <ul>${listHtml}</ul>
        <div class="pager">
          ${prevPage ? `<a href="/services?page=${prevPage}">Previous</a>` : ""}
          ${nextPage ? `<a href="/services?page=${nextPage}">Next</a>` : ""}
          <span>Page ${safePage.toLocaleString()} of ${pageCount.toLocaleString()}</span>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderHireCityHubHtml(baseUrl: string, pageNumber: number): string {
  const title = `Hire Staff by City | ${SITE_NAME}`;
  const description =
    "City-specific staffing pages for companies looking to hire vetted workers across the United States.";
  const visibleCount = HIRE_CITY_HUB_PAGES.length;
  const pageCount = Math.max(1, Math.ceil(Math.max(1, visibleCount) / CITY_HUB_PAGE_SIZE));
  const safePage = Math.max(1, Math.min(pageNumber, pageCount));
  const startIndex = (safePage - 1) * CITY_HUB_PAGE_SIZE;
  const endIndex = Math.min(visibleCount, safePage * CITY_HUB_PAGE_SIZE);
  const pageCities = HIRE_CITY_HUB_PAGES.slice(startIndex, endIndex);
  const listHtml = pageCities
    .map(
      (city) =>
        `<li><a href="${escapeHtml(city.path)}">${escapeHtml(
          `Hire staff in ${city.city}, ${city.state}`,
        )}</a></li>`,
    )
    .join("");
  const prevPage = safePage > 1 ? safePage - 1 : null;
  const nextPage = safePage < pageCount ? safePage + 1 : null;
  const canonical =
    safePage === 1 ? `${baseUrl}/company-onboarding/cities` : `${baseUrl}/company-onboarding/cities?page=${safePage}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="index,follow" />
  </head>
  <body>
    <main style="max-width:980px;margin:0 auto;padding:28px 20px 60px;font-family:Inter,system-ui,sans-serif;">
      <h1>Hire Staff by US City</h1>
      <p>Explore city pages for companies hiring on-demand workers. CTA on every page routes to company onboarding.</p>
      <p>Showing ${visibleCount > 0 ? `${startIndex + 1}-${endIndex}` : "0-0"} of ${visibleCount.toLocaleString()} city onboarding pages.</p>
      <ul style="columns:2;">
        ${listHtml}
      </ul>
      <div style="display:flex;gap:14px;align-items:center;">
        ${prevPage ? `<a href="/company-onboarding/cities?page=${prevPage}">Previous</a>` : ""}
        ${nextPage ? `<a href="/company-onboarding/cities?page=${nextPage}">Next</a>` : ""}
        <span>Page ${safePage} of ${pageCount}</span>
      </div>
    </main>
  </body>
</html>`;
}

function renderHireCityPageHtml(city: HireCityPage, baseUrl: string): string {
  const title = `Hire Staff in ${city.city}, ${city.state} | ${SITE_NAME}`;
  const description = `Companies in ${city.city}, ${city.state} can hire vetted staff quickly through ${SITE_NAME}. Start onboarding and fill roles faster.`;
  const canonical = `${baseUrl}${city.path}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "On-demand staffing",
    areaServed: `${city.city}, ${city.state}`,
    provider: {
      "@type": "Organization",
      name: SITE_NAME,
      url: baseUrl,
    },
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body>
    <main style="max-width:980px;margin:0 auto;padding:40px 20px 72px;font-family:Inter,system-ui,sans-serif;">
      <article style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px;">
        <h1>Hire Staff in ${escapeHtml(city.city)}, ${escapeHtml(city.state)}</h1>
        <p>${escapeHtml(
          `${SITE_NAME} helps companies in ${city.city} build staffing coverage for projects, seasonal demand, and recurring operations.`,
        )}</p>
        <p>${escapeHtml(
          `With a 2024 city estimate around ${city.population.toLocaleString()}, ${city.city} has strong demand for flexible labor and rapid hiring workflows.`,
        )}</p>
        <p>Need staff now? Start company onboarding to post jobs and hire vetted workers.</p>
        <a href="/company-onboarding" style="display:inline-block;margin-top:14px;background:#00a86b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">Start Company Onboarding</a>
        <div style="margin-top:16px;">
          <a href="/company-onboarding/cities">Browse all city pages</a>
        </div>
      </article>
    </main>
  </body>
</html>`;
}

function renderWorkerCityHubHtml(baseUrl: string, pageNumber: number): string {
  const title = `Find Gig Work by City | ${SITE_NAME}`;
  const description =
    "City-specific onboarding pages for workers looking for service gig opportunities across the United States.";
  const visibleCount = WORKER_CITY_HUB_PAGES.length;
  const pageCount = Math.max(1, Math.ceil(Math.max(1, visibleCount) / CITY_HUB_PAGE_SIZE));
  const safePage = Math.max(1, Math.min(pageNumber, pageCount));
  const startIndex = (safePage - 1) * CITY_HUB_PAGE_SIZE;
  const endIndex = Math.min(visibleCount, safePage * CITY_HUB_PAGE_SIZE);
  const pageCities = WORKER_CITY_HUB_PAGES.slice(startIndex, endIndex);
  const listHtml = pageCities
    .map(
      (city) =>
        `<li><a href="${escapeHtml(city.path)}">${escapeHtml(
          `Find service gig work in ${city.city}, ${city.state}`,
        )}</a></li>`,
    )
    .join("");
  const prevPage = safePage > 1 ? safePage - 1 : null;
  const nextPage = safePage < pageCount ? safePage + 1 : null;
  const canonical =
    safePage === 1 ? `${baseUrl}/worker-onboarding/cities` : `${baseUrl}/worker-onboarding/cities?page=${safePage}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="index,follow" />
  </head>
  <body>
    <main style="max-width:980px;margin:0 auto;padding:28px 20px 60px;font-family:Inter,system-ui,sans-serif;">
      <h1>Find Service Gig Work by US City</h1>
      <p>Explore city pages for workers joining on-demand service gigs. CTA on every page routes to worker onboarding.</p>
      <p>Showing ${visibleCount > 0 ? `${startIndex + 1}-${endIndex}` : "0-0"} of ${visibleCount.toLocaleString()} worker city pages.</p>
      <ul style="columns:2;">
        ${listHtml}
      </ul>
      <div style="display:flex;gap:14px;align-items:center;">
        ${prevPage ? `<a href="/worker-onboarding/cities?page=${prevPage}">Previous</a>` : ""}
        ${nextPage ? `<a href="/worker-onboarding/cities?page=${nextPage}">Next</a>` : ""}
        <span>Page ${safePage} of ${pageCount}</span>
      </div>
    </main>
  </body>
</html>`;
}

function renderWorkerCityPageHtml(city: HireCityPage, baseUrl: string): string {
  const title = `Service Gig Work in ${city.city}, ${city.state} | ${SITE_NAME}`;
  const description = `Workers in ${city.city}, ${city.state} can find service gig opportunities with ${SITE_NAME}. Start worker onboarding today.`;
  const canonical = `${baseUrl}${city.path}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: `Service Gig Opportunities in ${city.city}, ${city.state}`,
    description: `Service gig opportunities for workers in ${city.city}, ${city.state}.`,
    employmentType: "CONTRACTOR",
    hiringOrganization: {
      "@type": "Organization",
      name: SITE_NAME,
      sameAs: baseUrl,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: city.city,
        addressRegion: city.state,
        addressCountry: "US",
      },
    },
  };
  const topTradeLinks = WORKER_TRADE_OPTIONS.slice(0, 12)
    .map(
      (trade) =>
        `<li><a href="/worker-onboarding/${city.stateSlug}/${city.citySlug}/${trade.slug}">${escapeHtml(
          `${trade.name} gigs in ${city.city}, ${city.state}`,
        )}</a></li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body>
    <main style="max-width:980px;margin:0 auto;padding:40px 20px 72px;font-family:Inter,system-ui,sans-serif;">
      <article style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px;">
        <h1>Service Gig Work in ${escapeHtml(city.city)}, ${escapeHtml(city.state)}</h1>
        <p>${escapeHtml(
          `If you are a service professional in ${city.city}, ${city.state}, ${SITE_NAME} helps you connect with local companies hiring gig workers.`,
        )}</p>
        <p>${escapeHtml(
          `With a city population around ${city.population.toLocaleString()}, there is strong demand for flexible labor and recurring project work.`,
        )}</p>
        <p>Ready to start? Complete worker onboarding and begin applying to gig opportunities.</p>
        <a href="/worker-onboarding" style="display:inline-block;margin-top:14px;background:#00a86b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">Start Worker Onboarding</a>
        <h2 style="margin-top:20px;">Popular Gig Categories in ${escapeHtml(city.city)}</h2>
        <ul style="columns:2;">
          ${topTradeLinks}
        </ul>
        <div style="margin-top:16px;">
          <a href="/worker-onboarding/cities">Browse all worker city pages</a>
        </div>
      </article>
    </main>
  </body>
</html>`;
}

function renderWorkerCityTradePageHtml(
  city: HireCityPage,
  tradeName: string,
  tradeSlug: string,
  baseUrl: string,
): string {
  const title = `${tradeName} Gig Work in ${city.city}, ${city.state} | ${SITE_NAME}`;
  const description = `Workers in ${city.city}, ${city.state} can find ${tradeName.toLowerCase()} gig opportunities with ${SITE_NAME}. Start worker onboarding today.`;
  const canonical = `${baseUrl}/worker-onboarding/${city.stateSlug}/${city.citySlug}/${tradeSlug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: `${tradeName} Gig Opportunities in ${city.city}, ${city.state}`,
    description: `${tradeName} gig opportunities for workers in ${city.city}, ${city.state}.`,
    employmentType: "CONTRACTOR",
    occupationalCategory: tradeName,
    hiringOrganization: {
      "@type": "Organization",
      name: SITE_NAME,
      sameAs: baseUrl,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: city.city,
        addressRegion: city.state,
        addressCountry: "US",
      },
    },
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body>
    <main style="max-width:980px;margin:0 auto;padding:40px 20px 72px;font-family:Inter,system-ui,sans-serif;">
      <article style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px;">
        <h1>${escapeHtml(tradeName)} Gig Work in ${escapeHtml(city.city)}, ${escapeHtml(city.state)}</h1>
        <p>${escapeHtml(
          `${SITE_NAME} helps workers in ${city.city}, ${city.state} find ${tradeName.toLowerCase()} gigs with local businesses that need reliable service coverage.`,
        )}</p>
        <p>${escapeHtml(
          `This page is built for workers seeking ${tradeName.toLowerCase()} shifts, recurring jobs, and fast onboarding into city-level demand.`,
        )}</p>
        <p>Ready to start? Complete worker onboarding and begin applying to gig opportunities.</p>
        <a href="/worker-onboarding" style="display:inline-block;margin-top:14px;background:#00a86b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">Start Worker Onboarding</a>
        <div style="margin-top:16px;display:flex;gap:14px;flex-wrap:wrap;">
          <a href="/worker-onboarding/${city.stateSlug}/${city.citySlug}">Back to ${escapeHtml(city.city)} worker page</a>
          <a href="/worker-onboarding/cities">Browse all worker city pages</a>
        </div>
      </article>
    </main>
  </body>
</html>`;
}

function renderCoreSitemapXml(baseUrl: string): string {
  const seen = new Set<string>();
  const urlNodes: string[] = [];
  for (const { path, priority, changefreq } of CORE_SITEMAP_URLS) {
    if (seen.has(path)) continue;
    seen.add(path);
    urlNodes.push(`<url>
  <loc>${escapeHtml(`${baseUrl}${path}`)}</loc>
  <lastmod>${LASTMOD_ISO}</lastmod>
  <changefreq>${changefreq}</changefreq>
  <priority>${priority}</priority>
</url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlNodes.join("\n")}
</urlset>`;
}

function renderSitemapIndexXml(baseUrl: string): string {
  const chunkNodes: string[] = [];
  chunkNodes.push(`<sitemap><loc>${escapeHtml(`${baseUrl}/sitemaps/core.xml`)}</loc><lastmod>${LASTMOD_ISO}</lastmod></sitemap>`);
  for (let chunk = 1; chunk <= SITEMAP_CHUNK_COUNT; chunk++) {
    chunkNodes.push(
      `<sitemap><loc>${escapeHtml(`${baseUrl}/sitemaps/services-${chunk}.xml`)}</loc><lastmod>${LASTMOD_ISO}</lastmod></sitemap>`,
    );
  }
  for (let chunk = 1; chunk <= CITY_SITEMAP_CHUNK_COUNT; chunk++) {
    chunkNodes.push(
      `<sitemap><loc>${escapeHtml(`${baseUrl}/sitemaps/hire-cities-${chunk}.xml`)}</loc><lastmod>${LASTMOD_ISO}</lastmod></sitemap>`,
    );
  }
  for (let chunk = 1; chunk <= WORKER_CITY_SITEMAP_CHUNK_COUNT; chunk++) {
    chunkNodes.push(
      `<sitemap><loc>${escapeHtml(`${baseUrl}/sitemaps/worker-cities-${chunk}.xml`)}</loc><lastmod>${LASTMOD_ISO}</lastmod></sitemap>`,
    );
  }
  for (let chunk = 1; chunk <= WORKER_CITY_TRADE_SITEMAP_CHUNK_COUNT; chunk++) {
    chunkNodes.push(
      `<sitemap><loc>${escapeHtml(`${baseUrl}/sitemaps/worker-city-trades-${chunk}.xml`)}</loc><lastmod>${LASTMOD_ISO}</lastmod></sitemap>`,
    );
  }
  // Live open jobs (rendered separately with JobPosting schema for Google for Jobs).
  chunkNodes.push(
    `<sitemap><loc>${escapeHtml(`${baseUrl}/sitemaps/jobs.xml`)}</loc><lastmod>${LASTMOD_ISO}</lastmod></sitemap>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${chunkNodes.join("\n")}
</sitemapindex>`;
}

function renderHireCitySitemapChunkXml(baseUrl: string, chunkNumber: number): string {
  const start = (chunkNumber - 1) * URLS_PER_SITEMAP;
  const end = Math.min(INDEXABLE_HIRE_CITY_PAGES.length, chunkNumber * URLS_PER_SITEMAP);
  let urlNodes = "";
  for (let i = start; i < end; i++) {
    const city = INDEXABLE_HIRE_CITY_PAGES[i];
    if (!city) continue;
    urlNodes += `<url>
  <loc>${escapeHtml(`${baseUrl}${city.path}`)}</loc>
  <lastmod>${LASTMOD_ISO}</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.8</priority>
</url>
`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlNodes}</urlset>`;
}

function renderWorkerCitySitemapChunkXml(baseUrl: string, chunkNumber: number): string {
  const start = (chunkNumber - 1) * URLS_PER_SITEMAP;
  const end = Math.min(INDEXABLE_WORKER_CITY_PAGES.length, chunkNumber * URLS_PER_SITEMAP);
  let urlNodes = "";
  for (let i = start; i < end; i++) {
    const city = INDEXABLE_WORKER_CITY_PAGES[i];
    if (!city) continue;
    urlNodes += `<url>
  <loc>${escapeHtml(`${baseUrl}${city.path}`)}</loc>
  <lastmod>${LASTMOD_ISO}</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.8</priority>
</url>
`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlNodes}</urlset>`;
}

function renderWorkerCityTradeSitemapChunkXml(baseUrl: string, chunkNumber: number): string {
  const start = (chunkNumber - 1) * URLS_PER_SITEMAP;
  const end = Math.min(WORKER_CITY_TRADE_INDEXABLE_LIMIT, chunkNumber * URLS_PER_SITEMAP);
  let urlNodes = "";
  for (let i = start; i < end; i++) {
    const page = getWorkerCityTradePageByIndex(i);
    if (!page) continue;
    urlNodes += `<url>
  <loc>${escapeHtml(`${baseUrl}${page.path}`)}</loc>
  <lastmod>${LASTMOD_ISO}</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.7</priority>
</url>
`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlNodes}</urlset>`;
}

function renderServicesSitemapChunkXml(baseUrl: string, chunkNumber: number): string {
  const startPosition = (chunkNumber - 1) * URLS_PER_SITEMAP;
  const endPosition = Math.min(EFFECTIVE_INDEXABLE_PAGE_COUNT, chunkNumber * URLS_PER_SITEMAP);
  let urlNodes = "";
  for (let position = startPosition; position < endPosition; position++) {
    const id = EFFECTIVE_ORDERED_INDEXABLE_IDS[position];
    const page = getPageFromId(id);
    if (!page) continue;
    urlNodes += `<url>
  <loc>${escapeHtml(`${baseUrl}${page.path}`)}</loc>
  <lastmod>${LASTMOD_ISO}</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.7</priority>
</url>
`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlNodes}</urlset>`;
}

function renderLlmsTxt(baseUrl: string): string {
  const sampleUrls: string[] = [];
  const maxSampleSize = Math.min(60, EFFECTIVE_INDEXABLE_PAGE_COUNT);
  for (let position = 0; position < maxSampleSize; position++) {
    const id = EFFECTIVE_ORDERED_INDEXABLE_IDS[position];
    const page = getPageFromId(id);
    if (!page) continue;
    sampleUrls.push(`${baseUrl}${page.path}`);
  }
  const sampleCityUrls = INDEXABLE_HIRE_CITY_PAGES.slice(0, 40).map((city) => `${baseUrl}${city.path}`);
  const sampleWorkerCityUrls = INDEXABLE_WORKER_CITY_PAGES.slice(0, 40).map((city) => `${baseUrl}${city.path}`);
  const sampleWorkerTradeUrls: string[] = [];
  const workerTradeSampleSize = Math.min(40, WORKER_CITY_TRADE_INDEXABLE_LIMIT);
  for (let i = 0; i < workerTradeSampleSize; i++) {
    const page = getWorkerCityTradePageByIndex(i);
    if (!page) continue;
    sampleWorkerTradeUrls.push(`${baseUrl}${page.path}`);
  }

  return `# ${SITE_NAME}

> ${SITE_NAME} is a B2B on-demand contract labor marketplace. Companies post hourly jobs and shifts. Independent service workers (and worker-led teams) get matched, scheduled, and dispatched, with location-verified clock-in/out, automated timesheets, and ACH or card billing. Pay flows directly to workers via verified bank payouts.

Site: ${baseUrl}

## What it is

- B2B staffing platform for hourly, location-based work.
- Three-sided marketplace:
  1. Companies (hire workers per shift)
  2. Service workers (individuals, optionally with worker teams)
  3. Affiliates (drive company sign-ups)
- Workers are independent contractors, not W-2 employees of ${SITE_NAME} or the hiring company.

## What companies use it for

- Post a job once and have qualified workers matched by skill, location, schedule, and rating.
- Schedule shifts, including auto-fulfillment when allowed (system pairs qualified workers automatically).
- Manage multiple business locations and assign payment methods per location.
- Verify shifts via worker location and timestamps at clock-in / clock-out.
- Auto-approve timesheets when workers complete shifts inside a verified geofence and within scheduled time, otherwise route timesheets for review.
- Get billed only for actual verified worked hours.
- Fund jobs via:
  - Stripe card (3.5% convenience fee)
  - ACH bank transfer (no convenience fee, recommended)
- Optionally invite teammates with role-based access (admin / manager / viewer).

## What service workers use it for

- Find local hourly jobs that match their skills, service radius, and availability.
- Apply directly or get auto-matched.
- Clock in/out from the mobile app with location verification.
- Get paid by ACH for hours worked, processed after timesheet approval.
- Build a verified profile: skills, prior work, certifications, optional ID verification, reviews.
- Optionally form or join worker teams; a team lead can dispatch jobs to teammates.

## What affiliates use it for

- Refer companies to the platform.
- Track redemptions, leads, conversions, and earnings inside an affiliate dashboard.

## Industries supported

- Construction
  - Laborer, Landscaping, Painting, Drywall, Concrete
  - Carpentry (Lite + Elite)
  - Electrical (Lite + Elite)
  - Plumbing (Lite + Elite)
  - HVAC (Lite + Elite)
- Manufacturing & Logistics
  - Assembly Line Worker, Forklift Operator, Warehouse Associate, Supply Chain Coordinator
- Retail
  - Sales Associate, Inventory Specialist, Store Supervisor
- Housekeeping
  - Housekeeper, Laundry Staff, Janitorial Staff
- Event Planning & Management
  - Event Coordinator, Banquet Server, Setup / Teardown Crew, AV Technician
- Management & Administration
  - Hotel/Site Manager, Supervisor, Office Admin, HR Coordinator

Lite vs Elite:
- Lite roles cover repairs, replacements, and smaller-scope work.
- Elite roles cover full installs, complex builds, and larger-scope work.
- Workers can hold either Lite or Elite for a given trade, not both.

## Pay & billing

${SITE_NAME} is hourly and per-shift, not per-application or per-lead.

- Worker pay
  - Workers set their own hourly rate when applying or being matched.
  - Workers are paid by ACH to a verified bank account after timesheet approval.
  - Optional Instant Payout available for a small fee per payout.
  - Minimum worker-side billable rate is $15/hr USD platform-wide.
- Company billing
  - Companies are charged per worker-hour worked, not flat fees per job post.
  - Each job has an hourly billable rate that includes:
    1. Worker wage
    2. Per-worker-hour platform/payroll allocation (currently $13/hr USD)
  - Companies see a single billable-per-hour number when posting; workers see only the wage portion.
  - Card payments add a 3.5% convenience fee. ACH is free.
  - No deposit at onboarding; payment method is saved securely (Stripe) and charged after timesheet approval.
- Timesheet integrity
  - Clock-in/out is location-verified.
  - Inside auto-fulfill geofence (~0.25 mi from job site): can auto-approve.
  - Inside manual geofence (~5 mi): manual approval flow.
  - Beyond ~50 mi validation radius: rejected and may trigger a worker strike.

## Trust, safety, and verification

- Required worker face photo to prevent profile spoofing.
- Optional government ID verification.
- W-9 collection for U.S. workers (required before certain payouts can release).
- Reviews and ratings on both sides of the marketplace.
- Strike system for repeated location/timesheet violations.

## Platform behavior at a glance

- All work is hourly and shift-based (not project-based fixed bids).
- All work is location-anchored (job site address with lat/lng).
- All payments flow through compliant providers:
  - Company funding: Stripe (cards + ACH)
  - Worker payouts: Mercury (ACH)
- Mobile app supports clock-in/out with foreground and (where enabled) background location for shift verification.

## Useful pages

${PUBLIC_PATHS.map((path) => `- ${baseUrl}${path}`).join("\n")}
- ${baseUrl}/worker-onboarding
- ${baseUrl}/company-onboarding
- ${baseUrl}/dashboard
- ${baseUrl}/sitemap.xml
- ${baseUrl}/llms.txt
- ${baseUrl}/llms-full.txt
- ${baseUrl}/llms.json
- ${baseUrl}/jobs.rss
- ${baseUrl}/jobs.json

## Programmatic SEO surface (machine-readable)

- Programmatic SEO pages generated: ${PAGE_COUNT.toLocaleString()}
- Programmatic SEO pages indexable: ${EFFECTIVE_INDEXABLE_PAGE_COUNT.toLocaleString()}
- Programmatic SEO pages hub-linked: ${EFFECTIVE_HUB_LINK_COUNT.toLocaleString()}
- City hiring pages generated: ${ALL_HIRE_CITY_PAGES.length.toLocaleString()}
- City hiring pages indexable: ${INDEXABLE_HIRE_CITY_PAGES.length.toLocaleString()}
- City hiring pages hub-linked: ${HIRE_CITY_HUB_PAGES.length.toLocaleString()}
- Worker city pages generated: ${ALL_WORKER_CITY_PAGES.length.toLocaleString()}
- Worker city pages indexable: ${INDEXABLE_WORKER_CITY_PAGES.length.toLocaleString()}
- Worker city pages hub-linked: ${WORKER_CITY_HUB_PAGES.length.toLocaleString()}
- Worker city trade pages generated: ${WORKER_CITY_TRADE_PAGE_COUNT.toLocaleString()}
- Worker city trade pages indexable: ${WORKER_CITY_TRADE_INDEXABLE_LIMIT.toLocaleString()}
- Programmatic relevance filter enforced: ${ENFORCE_RELEVANCE_FILTER ? "yes" : "no"}
- Programmatic service/buyer override source: ${ENV_SERVICE_BUYER_COMPATIBILITY_JSON ? "env" : "default"}
- Programmatic intent/buyer override source: ${ENV_INTENT_BUYER_COMPATIBILITY_JSON ? "env" : "default"}
- Programmatic index order mode: ${INDEX_ORDER_MODE}
- Programmatic index order stride: ${INDEX_ORDER_STRIDE}

### SEO service area pages
${sampleUrls.length > 0 ? sampleUrls.join("\n") : "No indexable service pages are currently enabled."}

### City hiring pages
${sampleCityUrls.length > 0 ? sampleCityUrls.join("\n") : "No city hiring pages are currently enabled."}

### Worker city pages
${sampleWorkerCityUrls.length > 0 ? sampleWorkerCityUrls.join("\n") : "No worker city pages are currently enabled."}

### Worker city trade pages
${sampleWorkerTradeUrls.length > 0 ? sampleWorkerTradeUrls.join("\n") : "No worker city trade pages are currently enabled."}

## Contact

- Privacy: privacy@tolstoystaffing.com
- General support: in-app Support page

## Notes for AI/LLM consumers

- This file describes platform behavior, supported industries, and economic model so an LLM can answer "what is ${SITE_NAME}", "who is it for", "what jobs/industries does it cover", and "how does pay/billing work" without scraping the entire site.
- Numbers (rate floors, per-hour platform allocation, card fee, geofence radii) reflect current product policy at the time of writing and may change. Defer to the live app and Terms of Service for binding values.

Sitemap: ${baseUrl}/sitemap.xml
`;
}

function renderRobotsTxt(baseUrl: string): string {
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "";
    }
  })();

  const disallow = ROBOTS_DISALLOW_PATHS.map((path) => `Disallow: ${path}`).join("\n");
  const aiBots = ["GPTBot", "ClaudeBot", "Claude-Web", "anthropic-ai", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot", "cohere-ai", "Bytespider"];
  const aiBotBlocks = aiBots
    .map(
      (ua) => `User-agent: ${ua}
Allow: /
${disallow}
`,
    )
    .join("\n");

  return `User-agent: *
Allow: /
${disallow}

${aiBotBlocks}
# AI/LLM machine-readable summaries
# ${baseUrl}/llms.txt
# ${baseUrl}/llms-full.txt
# ${baseUrl}/llms.json
# Job feeds: ${baseUrl}/jobs.rss  ${baseUrl}/jobs.json
# Plugin manifest: ${baseUrl}/.well-known/ai-plugin.json
# Security disclosure: ${baseUrl}/.well-known/security.txt

Sitemap: ${baseUrl}/sitemap.xml
Sitemap: ${baseUrl}/sitemaps/core.xml
Sitemap: ${baseUrl}/sitemaps/jobs.xml
${host ? `Host: ${host}` : ""}
`;
}

function renderLlmsFullTxt(baseUrl: string): string {
  return `# ${SITE_NAME} (extended)

> Extended machine-readable description of ${SITE_NAME}: how the marketplace operates day-to-day, supported industries, role taxonomy, pay & billing math, location verification, payments stack, and FAQs. Pair this with ${baseUrl}/llms.txt and ${baseUrl}/llms.json.

Site: ${baseUrl}
Canonical summary: ${baseUrl}/llms.txt
Structured data: ${baseUrl}/llms.json
Sitemap index: ${baseUrl}/sitemap.xml

## Operating model

- Marketplace type: B2B on-demand contract labor.
- Core unit of work: an hourly shift at a specific company location.
- Worker employment status: independent contractor (1099-style in U.S.).
- Liability model: companies retain operational control of the worksite; ${SITE_NAME} provides the marketplace, scheduling, verification, billing, and payouts.

## Industry & role taxonomy

### Construction
- Laborer — Furniture assembly, demolition, moving, general labor
- Landscaping — Lawn care, gardening, outdoor work
- Painting — Interior and exterior painting
- Drywall — Hanging, mudding, taping
- Concrete — Pouring, finishing, repairs
- Carpentry Lite — Trim, tools, framing walls, small stairs
- Carpentry Elite — Full structures, homes, complex builds
- Electrical Lite — Outlets, ceiling fans, replacing fixtures
- Electrical Elite — Full home wiring, new installations
- Plumbing Lite — Faucets, toilets, repairs
- Plumbing Elite — Full installs from scratch
- HVAC Lite — Repairs, existing systems
- HVAC Elite — Full installs, ducting, minisplits, AC units

### Manufacturing & Logistics
- Assembly Line Worker
- Forklift Operator
- Warehouse Associate
- Supply Chain Coordinator

### Retail
- Sales Associate
- Inventory Specialist
- Store Supervisor

### Housekeeping
- Housekeeper
- Laundry Staff
- Janitorial Staff

### Event Planning & Management
- Event Coordinator
- Banquet Server
- Setup / Teardown Crew
- AV Technician

### Management & Administration
- Hotel / Site Manager
- Supervisor
- Office Admin
- HR Coordinator

### Lite vs Elite
- Lite is repair/replacement scope.
- Elite is full installs and complex builds.
- A worker holds either Lite or Elite for a given trade, never both at once.

## Pay model (math)

- Worker minimum billable rate: $15/hr USD.
- Per-worker-hour platform/payroll allocation included in company billing: $13/hr USD.
- Job hourly billable rate (company-side) = worker wage + $13/hr platform allocation.
- Worker-facing display rate = company billable hourly − $13/hr platform allocation.
- Card payments add a 3.5% convenience fee on top of charges.
- ACH bank transfer charges have no convenience fee.
- No deposit at onboarding. Companies are charged when workers complete shifts and timesheets are approved.

### Worked example
- Worker rate: $25/hr.
- Company billable rate: $25 + $13 = $38/hr.
- 4-hour shift, 1 worker:
  - Worker payout (gross before any optional Instant Payout fee): 4 × $25 = $100
  - Company labor charge: 4 × $38 = $152
  - If paid by card: 4 × $38 × 1.035 = $157.32
  - If paid by ACH: $152

## Payments stack

- Company funding: Stripe (cards + US bank ACH via Stripe Financial Connections / micro-deposits).
- Worker payouts: Mercury (ACH credit to worker bank).
- W-9 collection required for U.S. workers before some payouts can be released.
- Instant Payout option for workers (faster ACH availability for a small fee per payout).

## Location verification & timesheets

- Workers clock in/out from the mobile app.
- Mobile location is captured at clock-in and at clock-out, and (where enabled) periodically during the shift.
- Geofence radii (current product policy):
  - Auto-approve geofence: ~0.25 mi (~402 m) from job site.
  - Manual approval geofence: ~5 mi (~8,047 m).
  - Validation cutoff: ~50 mi. Beyond this, timesheets are rejected and may incur a worker strike.
- Auto-approval requires:
  - Clock-in and clock-out inside auto geofence.
  - Times within scheduled window.
  - No outstanding integrity flags on the worker or job.

## Trust & safety

- Required worker face photo to prevent profile spoofing.
- Optional government ID verification for higher trust signaling.
- Worker reviews and ratings; companies receive ratings as well.
- Strike system for repeat geofence/timesheet violations and other policy issues.

## Companies: typical lifecycle

1. Sign up via Google or email + password.
2. Add at least one business location (Google-verified address with lat/lng).
3. Add a payment method (ACH preferred; card with 3.5% fee).
4. Sign service agreement.
5. Post a job: title, location, schedule, required skills, # workers, hourly billable rate.
6. Workers apply or are auto-matched.
7. Workers clock in/out at the site; timesheets auto-approve when in geofence and on schedule.
8. Company is charged per verified worker-hour. Worker is paid via ACH after approval.

## Workers: typical lifecycle

1. Sign up via Google or email + password.
2. Upload face photo (required).
3. Add address, service categories, hourly rate.
4. Optionally upload portfolio, certifications, ID for verification.
5. Connect a U.S. bank account for ACH payouts; submit W-9 if required.
6. Apply to or accept matched jobs.
7. Clock in/out from mobile app at the worksite.
8. Receive ACH payout after timesheet approval.

## Affiliates: typical lifecycle

1. Sign up to the affiliate program.
2. Get a referral link.
3. Refer companies; redemptions, leads, and conversions are tracked.
4. Earnings appear in the affiliate dashboard.

## Mobile permissions disclosure (Google Play / iOS)

- Foreground location: required for clock-in/out and active shift verification.
- Background location: requested only where needed to support reliable shift verification (e.g. periodic checks during long active shifts).
- Disabling location may prevent a worker from clocking in, completing certain shift tasks, or having timesheets approved.
- Location data is used only for operational integrity (attendance, billing accuracy, dispute handling, fraud/abuse prevention). It is not used for third-party advertising and is not sold.

## Data & privacy summary

- Account/identity data, job/staffing data, shift-linked location/timestamp data, billing/payout metadata, communications, and support records are collected.
- Data is shared between counterparties only to operate the marketplace (companies ↔ workers, with affiliates for attribution, and with payments/auth/hosting providers).
- Data retention reflects operational, contractual, and legal requirements. See ${baseUrl}/privacy for the full Privacy Policy.

## FAQ

- Q: Is this a job board?
  - A: No. ${SITE_NAME} is an end-to-end staffing marketplace: matching, scheduling, location-verified clock-in/out, automated timesheets, billing to companies, and ACH payouts to workers.
- Q: Does the company hire workers as employees?
  - A: No. Workers are independent contractors. Companies pay for verified worked hours; ${SITE_NAME} handles billing and payouts.
- Q: What does the company pay?
  - A: Worker wage plus a per-worker-hour platform allocation ($13/hr USD). Card payments add a 3.5% convenience fee; ACH is free.
- Q: When is the company charged?
  - A: After workers complete shifts and timesheets are approved. There is no deposit at onboarding.
- Q: How do workers get paid?
  - A: ACH transfer to a verified U.S. bank after timesheet approval. Optional Instant Payout for a small fee per payout.
- Q: What stops fake clock-ins?
  - A: Location-verified clock-in/out with geofencing, timestamping, and a strike system for repeat violations.
- Q: What if a worker is far from the site?
  - A: Inside ~5 mi → manual approval flow. Beyond ~50 mi → rejected and may trigger a strike.
- Q: What industries are covered?
  - A: Construction, Manufacturing & Logistics, Retail, Housekeeping, Event Planning & Management, Management & Administration. Each has multiple roles; some construction trades have Lite vs Elite scopes.
- Q: Can a worker manage a team?
  - A: Yes. Workers can run a team and dispatch jobs to teammates.
- Q: Where is ${SITE_NAME} available?
  - A: U.S.-focused. See city pages and worker city pages under the SEO surface for active markets.

## Related machine-readable resources

- ${baseUrl}/llms.txt — concise summary
- ${baseUrl}/llms.json — structured JSON
- ${baseUrl}/sitemap.xml — sitemap index
- ${baseUrl}/robots.txt — crawler directives
`;
}

function renderLlmsJson(baseUrl: string): unknown {
  return {
    name: SITE_NAME,
    site: baseUrl,
    type: "B2B on-demand contract labor marketplace",
    summary:
      "Companies post hourly jobs and shifts; independent service workers (and worker teams) get matched, scheduled, and dispatched with location-verified clock-in/out, automated timesheets, and ACH or card billing.",
    sides: ["companies", "service_workers", "worker_teams", "affiliates"],
    employment_model: {
      worker_status: "independent_contractor",
      company_status: "buyer_of_services",
      platform_role: "marketplace_billing_payouts_verification",
    },
    pay_model: {
      currency: "USD",
      worker_min_billable_hourly: 15,
      platform_per_worker_hour_allocation: 13,
      company_billable_hourly_formula: "worker_wage + platform_per_worker_hour_allocation",
      worker_facing_hourly_formula: "company_billable_hourly - platform_per_worker_hour_allocation",
      payment_methods: {
        card: { fee_percent: 3.5, fee_basis: "transaction_amount" },
        ach: { fee_percent: 0 },
      },
      deposit_required_at_onboarding: false,
      charge_trigger: "after_timesheet_approval",
      worker_payout_method: "ACH",
      instant_payout_available: true,
    },
    timesheet_verification: {
      mobile_clock_in_out: true,
      location_required: true,
      geofence_radius_miles: {
        auto_approve: 0.25,
        manual_approval: 5,
        rejection_cutoff: 50,
      },
      auto_approval_conditions: [
        "clock_in_and_out_inside_auto_geofence",
        "times_within_scheduled_window",
        "no_open_integrity_flags",
      ],
    },
    payments_stack: {
      company_funding: "Stripe",
      worker_payouts: "Mercury",
      tax_forms: ["W-9 (US workers)"],
    },
    industries: [
      {
        id: "construction",
        label: "Construction",
        roles: [
          { id: "Laborer", scope: null },
          { id: "Landscaping", scope: null },
          { id: "Painting", scope: null },
          { id: "Drywall", scope: null },
          { id: "Concrete", scope: null },
          { id: "Carpentry Lite", scope: "lite" },
          { id: "Carpentry Elite", scope: "elite" },
          { id: "Electrical Lite", scope: "lite" },
          { id: "Electrical Elite", scope: "elite" },
          { id: "Plumbing Lite", scope: "lite" },
          { id: "Plumbing Elite", scope: "elite" },
          { id: "HVAC Lite", scope: "lite" },
          { id: "HVAC Elite", scope: "elite" },
        ],
      },
      {
        id: "manufacturing_logistics",
        label: "Manufacturing & Logistics",
        roles: [
          { id: "Assembly Line Worker" },
          { id: "Forklift Operator" },
          { id: "Warehouse Associate" },
          { id: "Supply Chain Coordinator" },
        ],
      },
      {
        id: "retail",
        label: "Retail",
        roles: [
          { id: "Sales Associate" },
          { id: "Inventory Specialist" },
          { id: "Store Supervisor" },
        ],
      },
      {
        id: "housekeeping",
        label: "Housekeeping",
        roles: [
          { id: "Housekeeper" },
          { id: "Laundry Staff" },
          { id: "Janitorial Staff" },
        ],
      },
      {
        id: "event_planning",
        label: "Event Planning & Management",
        roles: [
          { id: "Event Coordinator" },
          { id: "Banquet Server" },
          { id: "Setup Crew" },
          { id: "AV Technician" },
        ],
      },
      {
        id: "management_admin",
        label: "Management & Administration",
        roles: [
          { id: "Site Manager" },
          { id: "Supervisor" },
          { id: "Office Admin" },
          { id: "HR Coordinator" },
        ],
      },
    ],
    primary_pages: PUBLIC_PATHS.map((path) => `${baseUrl}${path}`).concat([
      `${baseUrl}/worker-onboarding`,
      `${baseUrl}/company-onboarding`,
      `${baseUrl}/dashboard`,
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/llms.txt`,
      `${baseUrl}/llms-full.txt`,
      `${baseUrl}/llms.json`,
    ]),
    seo_surface: {
      programmatic_pages_generated: PAGE_COUNT,
      programmatic_pages_indexable: EFFECTIVE_INDEXABLE_PAGE_COUNT,
      programmatic_pages_hub_linked: EFFECTIVE_HUB_LINK_COUNT,
      city_hire_pages_generated: ALL_HIRE_CITY_PAGES.length,
      city_hire_pages_indexable: INDEXABLE_HIRE_CITY_PAGES.length,
      worker_city_pages_generated: ALL_WORKER_CITY_PAGES.length,
      worker_city_pages_indexable: INDEXABLE_WORKER_CITY_PAGES.length,
      worker_city_trade_pages_generated: WORKER_CITY_TRADE_PAGE_COUNT,
      worker_city_trade_pages_indexable: WORKER_CITY_TRADE_INDEXABLE_LIMIT,
    },
    contact: {
      privacy_email: "privacy@tolstoystaffing.com",
      support_path: `${baseUrl}/support`,
    },
    canonical_resources: {
      llms_txt: `${baseUrl}/llms.txt`,
      llms_full_txt: `${baseUrl}/llms-full.txt`,
      llms_json: `${baseUrl}/llms.json`,
      sitemap_xml: `${baseUrl}/sitemap.xml`,
      robots_txt: `${baseUrl}/robots.txt`,
      jobs_rss: `${baseUrl}/jobs.rss`,
      jobs_json_feed: `${baseUrl}/jobs.json`,
      opensearch: `${baseUrl}/opensearch.xml`,
      humans_txt: `${baseUrl}/humans.txt`,
      security_txt: `${baseUrl}/.well-known/security.txt`,
    },
    notes: [
      "Numbers reflect current product policy and may change.",
      "Defer to live app and Terms of Service for binding values.",
    ],
    last_modified: LASTMOD_ISO,
  };
}

export function registerSeoRoutes(app: Express): void {
  app.get("/seo/stats", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json({
      generatedPages: PAGE_COUNT,
      indexablePages: EFFECTIVE_INDEXABLE_PAGE_COUNT,
      hubLinkedPages: EFFECTIVE_HUB_LINK_COUNT,
      configuredIndexableLimit: INDEXABLE_PAGE_LIMIT,
      configuredHubLinkLimit: HUB_LINK_LIMIT,
      enforceRelevanceFilter: ENFORCE_RELEVANCE_FILTER,
      relevanceEligiblePages: RELEVANT_ORDERED_PAGE_IDS.length,
      cityMinPopulation: CITY_MIN_POPULATION,
      cityPagesGenerated: ALL_HIRE_CITY_PAGES.length,
      cityPagesIndexable: INDEXABLE_HIRE_CITY_PAGES.length,
      cityPagesHubLinked: HIRE_CITY_HUB_PAGES.length,
      citySitemapChunks: CITY_SITEMAP_CHUNK_COUNT,
      workerCityPagesGenerated: ALL_WORKER_CITY_PAGES.length,
      workerCityPagesIndexable: INDEXABLE_WORKER_CITY_PAGES.length,
      workerCityPagesHubLinked: WORKER_CITY_HUB_PAGES.length,
      workerCitySitemapChunks: WORKER_CITY_SITEMAP_CHUNK_COUNT,
      workerCityTradePagesGenerated: WORKER_CITY_TRADE_PAGE_COUNT,
      workerCityTradePagesIndexable: WORKER_CITY_TRADE_INDEXABLE_LIMIT,
      workerCityTradeSitemapChunks: WORKER_CITY_TRADE_SITEMAP_CHUNK_COUNT,
      serviceBuyerCompatibilitySource: ENV_SERVICE_BUYER_COMPATIBILITY_JSON ? "env" : "default",
      intentBuyerCompatibilitySource: ENV_INTENT_BUYER_COMPATIBILITY_JSON ? "env" : "default",
      urlsPerSitemap: URLS_PER_SITEMAP,
      sitemapChunks: SITEMAP_CHUNK_COUNT,
      seoLastmodIso: LASTMOD_ISO,
      seoLastmodUtc: LASTMOD_UTC,
      indexOrderMode: INDEX_ORDER_MODE,
      indexOrderStride: INDEX_ORDER_STRIDE,
      indexOrderPreviewIds: buildIndexOrderPreviewIds(10),
      effectiveIndexPreviewIds: buildEffectiveIndexPreviewIds(10),
      hubPreviewIds: buildHubPreviewIds(10),
      nonIndexablePreviewId: getNonIndexablePreviewId(),
    });
  });

  app.get("/services", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const pageParamRaw = req.query.page;
    const pageParam =
      typeof pageParamRaw === "string" ? parsePositiveInt(pageParamRaw) ?? 1 : 1;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`hub:${baseUrl}:${pageParam}`, () =>
      renderServicesHubHtml(baseUrl, pageParam),
    );
    res.send(body);
  });

  app.get("/company-onboarding/cities", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const pageParamRaw = req.query.page;
    const pageParam =
      typeof pageParamRaw === "string" ? parsePositiveInt(pageParamRaw) ?? 1 : 1;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`city-hub:${baseUrl}:${pageParam}`, () =>
      renderHireCityHubHtml(baseUrl, pageParam),
    );
    res.send(body);
  });

  app.get("/company-onboarding/:state/:city", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const stateSlug = slugify(req.params.state);
    const citySlug = slugify(req.params.city);
    const city = HIRE_CITY_BY_SLUG.get(`${stateSlug}:${citySlug}`);
    if (!city) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`city-page:${baseUrl}:${city.stateSlug}:${city.citySlug}`, () =>
      renderHireCityPageHtml(city, baseUrl),
    );
    res.send(body);
  });

  app.get("/worker-onboarding/cities", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const pageParamRaw = req.query.page;
    const pageParam =
      typeof pageParamRaw === "string" ? parsePositiveInt(pageParamRaw) ?? 1 : 1;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`worker-city-hub:${baseUrl}:${pageParam}`, () =>
      renderWorkerCityHubHtml(baseUrl, pageParam),
    );
    res.send(body);
  });

  app.get("/worker-onboarding/:state/:city", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const stateSlug = slugify(req.params.state);
    const citySlug = slugify(req.params.city);
    const city = WORKER_CITY_BY_SLUG.get(`${stateSlug}:${citySlug}`);
    if (!city) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`worker-city-page:${baseUrl}:${city.stateSlug}:${city.citySlug}`, () =>
      renderWorkerCityPageHtml(city, baseUrl),
    );
    res.send(body);
  });

  app.get("/worker-onboarding/:state/:city/:trade", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const stateSlug = slugify(req.params.state);
    const citySlug = slugify(req.params.city);
    const tradeSlug = slugify(req.params.trade);
    const city = WORKER_CITY_BY_SLUG.get(`${stateSlug}:${citySlug}`);
    const tradeName = WORKER_TRADE_BY_SLUG.get(tradeSlug);
    if (!city || !tradeName) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(
      `worker-city-trade:${baseUrl}:${city.stateSlug}:${city.citySlug}:${tradeSlug}`,
      () => renderWorkerCityTradePageHtml(city, tradeName, tradeSlug, baseUrl),
    );
    res.send(body);
  });

  app.get("/hire-staff", (_req: Request, res: Response) => {
    res.redirect(301, "/company-onboarding/cities");
  });

  app.get("/hire-staff/:state/:city", (req: Request, res: Response) => {
    const stateSlug = slugify(req.params.state);
    const citySlug = slugify(req.params.city);
    res.redirect(301, `/company-onboarding/${stateSlug}/${citySlug}`);
  });

  app.get("/services/p/:id/:slug?", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(404).send("Not found");
      return;
    }
    const page = getPageFromId(id);
    if (!page) {
      res.status(404).send("Not found");
      return;
    }

    if (req.params.slug && req.params.slug !== page.slug) {
      res.redirect(301, page.path);
      return;
    }

    const isIndexable = isIdIndexable(page.id);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800, stale-while-revalidate=86400");
    res.setHeader("X-Robots-Tag", isIndexable ? "index, follow" : "noindex, follow");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`landing:${baseUrl}:${page.id}:${isIndexable ? "i" : "n"}`, () =>
      renderLandingHtml(page, baseUrl, isIndexable),
    );
    res.send(body);
  });

  app.get("/sitemap.xml", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`sitemap-index:${baseUrl}`, () =>
      renderSitemapIndexXml(baseUrl),
    );
    res.send(body);
  });

  app.get("/sitemaps/core.xml", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`sitemap-core:${baseUrl}`, () => renderCoreSitemapXml(baseUrl));
    res.send(body);
  });

  app.get("/sitemaps/services-:chunk.xml", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const chunk = parsePositiveInt(req.params.chunk);
    if (!chunk || SITEMAP_CHUNK_COUNT === 0 || chunk > SITEMAP_CHUNK_COUNT) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`sitemap-chunk:${baseUrl}:${chunk}`, () =>
      renderServicesSitemapChunkXml(baseUrl, chunk),
    );
    res.send(body);
  });

  app.get("/sitemaps/hire-cities-:chunk.xml", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const chunk = parsePositiveInt(req.params.chunk);
    if (!chunk || CITY_SITEMAP_CHUNK_COUNT === 0 || chunk > CITY_SITEMAP_CHUNK_COUNT) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`sitemap-cities:${baseUrl}:${chunk}`, () =>
      renderHireCitySitemapChunkXml(baseUrl, chunk),
    );
    res.send(body);
  });

  app.get("/sitemaps/worker-cities-:chunk.xml", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const chunk = parsePositiveInt(req.params.chunk);
    if (!chunk || WORKER_CITY_SITEMAP_CHUNK_COUNT === 0 || chunk > WORKER_CITY_SITEMAP_CHUNK_COUNT) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`sitemap-worker-cities:${baseUrl}:${chunk}`, () =>
      renderWorkerCitySitemapChunkXml(baseUrl, chunk),
    );
    res.send(body);
  });

  app.get("/sitemaps/worker-city-trades-:chunk.xml", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const chunk = parsePositiveInt(req.params.chunk);
    if (
      !chunk ||
      WORKER_CITY_TRADE_SITEMAP_CHUNK_COUNT === 0 ||
      chunk > WORKER_CITY_TRADE_SITEMAP_CHUNK_COUNT
    ) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`sitemap-worker-city-trades:${baseUrl}:${chunk}`, () =>
      renderWorkerCityTradeSitemapChunkXml(baseUrl, chunk),
    );
    res.send(body);
  });

  app.get("/robots.txt", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`robots:${baseUrl}`, () => renderRobotsTxt(baseUrl));
    res.send(body);
  });

  app.get("/llms.txt", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`llms:${baseUrl}`, () => renderLlmsTxt(baseUrl));
    res.send(body);
  });

  app.get("/llms-full.txt", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = getCachedOrCompute(`llms-full:${baseUrl}`, () => renderLlmsFullTxt(baseUrl));
    res.send(body);
  });

  app.get("/llms.json", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Last-Modified", LASTMOD_UTC);
    if (respondNotModifiedIfFresh(req, res)) return;
    const body = renderLlmsJson(baseUrl);
    res.json(body);
  });

  // RFC 9116 security.txt — published at /.well-known/security.txt and root for legacy.
  const securityTxtHandler = (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    if (respondNotModifiedIfFresh(req, res)) return;
    res.send(
      `Contact: mailto:security@tolstoystaffing.com
Contact: mailto:privacy@tolstoystaffing.com
Expires: ${expires}
Preferred-Languages: en
Canonical: ${baseUrl}/.well-known/security.txt
Policy: ${baseUrl}/legal
`,
    );
  };
  app.get("/.well-known/security.txt", securityTxtHandler);
  app.get("/security.txt", securityTxtHandler);

  // Public job feeds for crawlers + integrations (open jobs only).
  // Caps + caching keep this cheap; mirrors what /jobs already shows publicly.
  const PUBLIC_JOB_FEED_LIMIT = 200;

  const fetchPublicJobs = async () => {
    try {
      const jobs = await storage.getJobs();
      return jobs.slice(0, PUBLIC_JOB_FEED_LIMIT);
    } catch (err) {
      console.error("[SEO] fetchPublicJobs error:", (err as Error)?.message);
      return [];
    }
  };

  app.get("/jobs.json", async (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const jobs = await fetchPublicJobs();
    const items = jobs.map((j: any) => {
      const wage = workerFacingJobHourlyCents(Number(j.hourlyRate ?? 0));
      const url = `${baseUrl}/jobs/${j.id}`;
      const summary = String(j.description ?? "").slice(0, 280);
      return {
        id: String(j.id),
        url,
        title: String(j.title ?? "Hourly job"),
        content_text: summary,
        date_published: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
        tags: [j.trade, j.companyName].filter(Boolean),
        _tolstoy: {
          worker_hourly_usd: wage > 0 ? wage / 100 : null,
          location: j.location ?? null,
          city: j.city ?? null,
          state: j.state ?? null,
          trade: j.trade ?? null,
          company_name: j.companyName ?? null,
        },
      };
    });
    res.setHeader("Content-Type", "application/feed+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json({
      version: "https://jsonfeed.org/version/1.1",
      title: `${SITE_NAME} - Open Jobs`,
      home_page_url: `${baseUrl}/jobs`,
      feed_url: `${baseUrl}/jobs.json`,
      description: "Currently open hourly jobs on Tolstoy Staffing.",
      language: "en-US",
      items,
    });
  });

  app.get("/jobs.rss", async (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const jobs = await fetchPublicJobs();
    const items = jobs
      .map((j: any) => {
        const wage = workerFacingJobHourlyCents(Number(j.hourlyRate ?? 0));
        const url = `${baseUrl}/jobs/${j.id}`;
        const summary = String(j.description ?? "").slice(0, 500);
        const wageLine = wage > 0 ? ` ($${(wage / 100).toFixed(2)}/hr)` : "";
        const where = [j.city, j.state].filter(Boolean).join(", ") || j.location || "";
        const title = `${j.title ?? "Hourly job"}${where ? ` - ${where}` : ""}${wageLine}`;
        const pubDate = j.createdAt ? new Date(j.createdAt).toUTCString() : new Date().toUTCString();
        return `    <item>
      <title>${escapeHtml(title)}</title>
      <link>${escapeHtml(url)}</link>
      <guid isPermaLink="true">${escapeHtml(url)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeHtml(summary)}</description>
    </item>`;
      })
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(`${SITE_NAME} - Open Jobs`)}</title>
    <link>${escapeHtml(`${baseUrl}/jobs`)}</link>
    <description>Currently open hourly jobs on Tolstoy Staffing.</description>
    <language>en-US</language>
${items}
  </channel>
</rss>`;
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.send(xml);
  });

  // Jobs sitemap chunk — open jobs only, capped, used by sitemap index above.
  app.get("/sitemaps/jobs.xml", async (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const jobs = await fetchPublicJobs();
    const urls = jobs
      .map((j: any) => {
        const updated = j.updatedAt ?? j.createdAt;
        const lastmod = updated ? new Date(updated).toISOString() : LASTMOD_ISO;
        return `<url>
  <loc>${escapeHtml(`${baseUrl}/jobs/${j.id}`)}</loc>
  <lastmod>${lastmod}</lastmod>
  <changefreq>daily</changefreq>
  <priority>0.9</priority>
</url>`;
      })
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.send(xml);
  });

  // OpenAI/MCP-style plugin manifest. Some agentic tools still discover via this.
  app.get("/.well-known/ai-plugin.json", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.json({
      schema_version: "v1",
      name_for_human: SITE_NAME,
      name_for_model: "tolstoy_staffing",
      description_for_human:
        "B2B on-demand contract labor marketplace. Companies post hourly jobs; verified service workers fill shifts.",
      description_for_model:
        "Tolstoy Staffing is a B2B on-demand staffing marketplace. Use this site for: hourly job postings (open jobs only) at /jobs/{id}, machine-readable job feeds at /jobs.json (JSON Feed) and /jobs.rss (RSS), structured marketplace summary at /llms.json, plain-text summaries at /llms.txt and /llms-full.txt. Workers are independent contractors paid by ACH after location-verified shifts.",
      logo_url: `${baseUrl}/favicon.svg`,
      contact_email: "support@tolstoystaffing.com",
      legal_info_url: `${baseUrl}/legal`,
      auth: { type: "none" },
      api: {
        type: "json_feed",
        url: `${baseUrl}/jobs.json`,
        is_user_authenticated: false,
      },
      additional_resources: {
        llms_txt: `${baseUrl}/llms.txt`,
        llms_full_txt: `${baseUrl}/llms-full.txt`,
        llms_json: `${baseUrl}/llms.json`,
        sitemap_xml: `${baseUrl}/sitemap.xml`,
        jobs_rss: `${baseUrl}/jobs.rss`,
        jobs_json_feed: `${baseUrl}/jobs.json`,
      },
    });
  });

  // Server-rendered SEO shell for individual jobs so crawlers/LLMs see JobPosting
  // schema + canonical metadata without executing the SPA. Browsers continue to
  // load the React app; bots get the structured data immediately.
  app.get("/jobs/:id", async (req: Request, res: Response, next) => {
    const ua = String(req.headers["user-agent"] ?? "").toLowerCase();
    const wantsHtml = (req.headers.accept ?? "").includes("text/html");
    const isBot =
      /bot|crawler|spider|crawling|gpt|claude|perplexity|facebookexternalhit|slurp|applebot|bingpreview|adsbot|lighthouse|chrome-lighthouse|google-inspectiontool|duckduckbot|yandex|baiduspider|sogou|cohere|bytespider|cccbot|amazonbot|petalbot|seznambot|whatsapp|telegrambot|linkedinbot|discordbot|skypeuripreview|embedly|nuzzel|outbrain|quora link preview/.test(
        ua,
      );
    if (!wantsHtml || !isBot) return next();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return next();

    try {
      const job = (await storage.getJob(id)) as any;
      if (!job || job.status !== "open") return next();
      const baseUrl = getBaseUrl(req);
      const wage = workerFacingJobHourlyCents(Number(job.hourlyRate ?? 0));
      const where = [job.city, job.state].filter(Boolean).join(", ") || job.location || "";
      const title = `${job.title ?? "Hourly Job"}${where ? ` in ${where}` : ""} | ${SITE_NAME}`;
      const description = String(job.description ?? "").slice(0, 280) || `Hourly ${job.trade ?? "service"} job on Tolstoy Staffing.`;
      const canonical = `${baseUrl}/jobs/${id}`;

      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: job.title ?? "Hourly Job",
        description,
        identifier: { "@type": "PropertyValue", name: "Tolstoy Staffing", value: String(id) },
        datePosted: job.createdAt ? new Date(job.createdAt).toISOString() : undefined,
        employmentType: "CONTRACTOR",
        hiringOrganization: {
          "@type": "Organization",
          name: job.companyName ?? "Confidential employer",
          sameAs: baseUrl,
        },
        jobLocation: where
          ? {
              "@type": "Place",
              address: {
                "@type": "PostalAddress",
                addressLocality: job.city ?? undefined,
                addressRegion: job.state ?? undefined,
                postalCode: job.zipCode ?? undefined,
                addressCountry: "US",
                streetAddress: job.address ?? undefined,
              },
            }
          : undefined,
        baseSalary: wage > 0 ? {
          "@type": "MonetaryAmount",
          currency: "USD",
          value: { "@type": "QuantitativeValue", value: wage / 100, unitText: "HOUR" },
        } : undefined,
        directApply: false,
        url: canonical,
      };

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
      const breadcrumbs = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: baseUrl },
          { "@type": "ListItem", position: 2, name: "Jobs", item: `${baseUrl}/jobs` },
          { "@type": "ListItem", position: 3, name: job.title ?? `Job ${id}`, item: canonical },
        ],
      };

      res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="en" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <script type="application/ld+json">${JSON.stringify(breadcrumbs)}</script>
  </head>
  <body>
    <h1>${escapeHtml(job.title ?? "Hourly Job")}</h1>
    <p>${escapeHtml(description)}</p>
    <p><a href="${escapeHtml(canonical)}">View this job on ${escapeHtml(SITE_NAME)}</a></p>
  </body>
</html>`);
    } catch (err) {
      console.error("[SEO] /jobs/:id render error:", (err as Error)?.message);
      return next();
    }
  });
}
