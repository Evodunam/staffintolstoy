/** Matches server find-work: reject null island / placeholder zeros. */
export function isPlausibleLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < 1e-5 && Math.abs(lng) < 1e-5) return false;
  return true;
}

export function parseJobLatLng(job: {
  latitude?: string | number | null;
  longitude?: string | number | null;
}): { lat: number; lng: number } | null {
  if (job.latitude == null || job.longitude == null) return null;
  const lat = parseFloat(String(job.latitude));
  const lng = parseFloat(String(job.longitude));
  if (!isPlausibleLatLng(lat, lng)) return null;
  return { lat, lng };
}
