import { readFile } from "fs/promises";

type CompatibilityConfig = {
  serviceBuyerCompatibility: Record<string, string[]>;
  intentBuyerCompatibility: Record<string, string[]>;
};

const ALLOWED_SERVICES = [
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

const ALLOWED_INTENTS = [
  "same day",
  "next day",
  "weekend",
  "night shift",
  "seasonal",
  "project based",
  "emergency",
  "recurring",
  "temp to hire",
  "peak demand",
];

const ALLOWED_BUYERS = [
  "construction companies",
  "facility operators",
  "property management teams",
  "hospitality operators",
  "retail groups",
  "warehouse operators",
  "event teams",
  "franchise owners",
  "municipal teams",
  "manufacturing teams",
];

const SERVICE_COUNT = ALLOWED_SERVICES.length;
const MARKET_COUNT = 50;
const INTENT_COUNT = ALLOWED_INTENTS.length;
const BUYER_COUNT = ALLOWED_BUYERS.length;
const GENERATED_PAGE_COUNT = SERVICE_COUNT * MARKET_COUNT * INTENT_COUNT * BUYER_COUNT;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeMap(input: Record<string, string[]>, label: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isStringArray(value)) {
      throw new Error(`${label}.${key} must be a string[]`);
    }
    const cleaned = Array.from(new Set(value.map((v) => v.trim()).filter(Boolean)));
    out[key] = cleaned;
  }
  return out;
}

async function run() {
  const inputPath = process.argv[2] ?? "config/seo-compatibility.defaults.json";
  const raw = await readFile(inputPath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<CompatibilityConfig>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config must be an object");
  }
  if (!parsed.serviceBuyerCompatibility || typeof parsed.serviceBuyerCompatibility !== "object") {
    throw new Error("Missing serviceBuyerCompatibility");
  }
  if (!parsed.intentBuyerCompatibility || typeof parsed.intentBuyerCompatibility !== "object") {
    throw new Error("Missing intentBuyerCompatibility");
  }

  const serviceMap = normalizeMap(parsed.serviceBuyerCompatibility, "serviceBuyerCompatibility");
  const intentMap = normalizeMap(parsed.intentBuyerCompatibility, "intentBuyerCompatibility");

  const unknownServices = Object.keys(serviceMap).filter((service) => !ALLOWED_SERVICES.includes(service));
  const unknownIntents = Object.keys(intentMap).filter((intent) => !ALLOWED_INTENTS.includes(intent));
  if (unknownServices.length > 0) throw new Error(`Unknown services: ${unknownServices.join(", ")}`);
  if (unknownIntents.length > 0) throw new Error(`Unknown intents: ${unknownIntents.join(", ")}`);

  for (const [service, buyers] of Object.entries(serviceMap)) {
    const unknownBuyers = buyers.filter((buyer) => !ALLOWED_BUYERS.includes(buyer));
    if (unknownBuyers.length > 0) {
      throw new Error(`Unknown buyers for service "${service}": ${unknownBuyers.join(", ")}`);
    }
  }
  for (const [intent, buyers] of Object.entries(intentMap)) {
    const unknownBuyers = buyers.filter((buyer) => !ALLOWED_BUYERS.includes(buyer));
    if (unknownBuyers.length > 0) {
      throw new Error(`Unknown buyers for intent "${intent}": ${unknownBuyers.join(", ")}`);
    }
  }

  const serviceKeysWithValues = Object.entries(serviceMap).filter(([, buyers]) => buyers.length > 0).length;
  const intentKeysWithValues = Object.entries(intentMap).filter(([, buyers]) => buyers.length > 0).length;

  let eligibleCombos = 0;
  for (const service of ALLOWED_SERVICES) {
    const serviceBuyers = new Set(serviceMap[service] ?? []);
    for (const intent of ALLOWED_INTENTS) {
      const intentBuyers = new Set(intentMap[intent] ?? []);
      for (const buyer of ALLOWED_BUYERS) {
        if (serviceBuyers.has(buyer) && intentBuyers.has(buyer)) {
          eligibleCombos++;
        }
      }
    }
  }
  const eligiblePages = eligibleCombos * MARKET_COUNT;

  console.log(`Config file: ${inputPath}`);
  console.log(`Generated pages total: ${GENERATED_PAGE_COUNT.toLocaleString()}`);
  console.log(`Eligible pages after relevance filter: ${eligiblePages.toLocaleString()}`);
  console.log(`Service keys with buyers: ${serviceKeysWithValues}/${SERVICE_COUNT}`);
  console.log(`Intent keys with buyers: ${intentKeysWithValues}/${INTENT_COUNT}`);
}

run().catch((error) => {
  console.error("Compatibility config validation failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

