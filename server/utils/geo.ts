const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_MILE = 1609.344;

export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

export const GEOFENCE_RADIUS_MILES = 2;
export const GEOFENCE_RADIUS_METERS = milesToMeters(GEOFENCE_RADIUS_MILES);

export function isWithinGeofence(
  workerLat: number,
  workerLon: number,
  jobLat: number,
  jobLon: number,
  radiusMeters: number = GEOFENCE_RADIUS_METERS
): boolean {
  const distance = calculateHaversineDistance(workerLat, workerLon, jobLat, jobLon);
  return distance <= radiusMeters;
}

export function getDistanceDescription(distanceMeters: number): string {
  const miles = metersToMiles(distanceMeters);
  if (miles < 0.1) {
    return `${Math.round(distanceMeters)} meters`;
  } else if (miles < 1) {
    return `${miles.toFixed(1)} miles`;
  } else {
    return `${miles.toFixed(1)} miles`;
  }
}
