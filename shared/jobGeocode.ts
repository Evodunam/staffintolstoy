/**
 * Strip leading house number for approximate / privacy geocode (e.g. "123 Main St" → "Main St").
 */
export function stripLeadingStreetNumber(line: string): string {
  return line.trim().replace(/^\d+[-A-Za-z]*\s+/, "").trim();
}

export type JobGeocodeFields = {
  address?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  location?: string | null;
};

/**
 * One string for Google Geocoding: relative street (no leading #), city, state, zip when possible;
 * else city/state/zip only, full address, or `location` fallback.
 */
export function buildJobGeocodeQuery(job: JobGeocodeFields): string | null {
  const city = (job.city ?? "").trim();
  const state = (job.state ?? "").trim();
  const zip = (job.zipCode ?? "").trim();
  const rawStreetField = (job.streetAddress ?? "").trim();
  const rawAddr = (job.address ?? "").trim();
  const streetSource = rawStreetField || rawAddr;
  const streetRel = streetSource ? stripLeadingStreetNumber(streetSource) : "";
  const loc = (job.location ?? "").trim();

  const tail = [city, state, zip].filter(Boolean).join(", ");

  if (streetRel && tail) return `${streetRel}, ${tail}`;
  if (tail) return tail;
  if (rawAddr) return rawAddr;
  if (streetRel) return streetRel;
  if (loc) return loc;
  return null;
}
