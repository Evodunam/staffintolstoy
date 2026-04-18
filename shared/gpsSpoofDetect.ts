/**
 * GPS spoof detection — purely heuristic checks on a sequence of location pings.
 * Does NOT need a vendor; any GPS-spoofing app emits velocity/altitude profiles
 * that are physically implausible.
 *
 * Used by the location-pings ingester (server-side) to flag suspect timesheets
 * for company review BEFORE auto-approval. Returned signals are recorded but
 * do not auto-reject — false positives in legitimate scenarios (helicopter,
 * boat ride, NYC subway) are common, so company review is the right gate.
 */

export interface PingPoint {
  latitude: number;
  longitude: number;
  /** Unix ms */
  timestamp: number;
  /** Optional GPS-reported accuracy in meters; can be used to weight checks. */
  accuracyMeters?: number;
  /** Optional speed reported by device (m/s). */
  reportedSpeedMps?: number;
}

export interface SpoofSignal {
  kind: "impossible_velocity" | "stationary_then_teleport" | "perfectly_round_coords" | "accuracy_too_perfect";
  pingIndex: number;
  description: string;
}

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance between two lat/lng points, in meters. */
export function haversineMeters(a: PingPoint, b: PingPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

const MAX_CONSTRUCTION_VELOCITY_MPS = 45; // ≈100 mph — generous; covers driving between sites

/**
 * Returns a list of suspicious signals. Empty list = looks normal.
 */
export function detectSpoofSignals(pings: PingPoint[]): SpoofSignal[] {
  const signals: SpoofSignal[] = [];
  if (pings.length < 2) return signals;

  for (let i = 1; i < pings.length; i++) {
    const prev = pings[i - 1];
    const cur = pings[i];
    const dtSec = Math.max(0.001, (cur.timestamp - prev.timestamp) / 1000);
    const distM = haversineMeters(prev, cur);
    const velocityMps = distM / dtSec;

    // 1) Impossible velocity (>100mph between consecutive pings on a worksite)
    if (velocityMps > MAX_CONSTRUCTION_VELOCITY_MPS && distM > 100) {
      signals.push({
        kind: "impossible_velocity",
        pingIndex: i,
        description: `${(velocityMps * 2.237).toFixed(1)} mph between pings (${distM.toFixed(0)} m in ${dtSec.toFixed(1)} s)`,
      });
    }

    // 2) Stationary for a long time, then a sudden large jump (classic spoof:
    //    a timer-based fake feeder app)
    if (i >= 3) {
      const prev3 = pings[i - 3];
      const stationaryDist = haversineMeters(prev3, prev);
      if (stationaryDist < 10 && distM > 500) {
        signals.push({
          kind: "stationary_then_teleport",
          pingIndex: i,
          description: `Stationary for ${(((prev.timestamp - prev3.timestamp) / 1000) | 0)}s then jumped ${distM.toFixed(0)} m`,
        });
      }
    }

    // 3) Perfectly round lat/lng — many spoof apps use the device's "Set Location" UI
    //    which produces 6-decimal-zero coordinates. Real GPS NEVER does this.
    if (
      cur.latitude === Math.trunc(cur.latitude * 1000) / 1000 &&
      cur.longitude === Math.trunc(cur.longitude * 1000) / 1000 &&
      cur.latitude !== 0 && cur.longitude !== 0
    ) {
      signals.push({
        kind: "perfectly_round_coords",
        pingIndex: i,
        description: `Coordinates ${cur.latitude}, ${cur.longitude} are exactly 3-decimal-precise — real GPS noise should give 5–7 decimals.`,
      });
    }

    // 4) Accuracy reported as exactly 1m or 0m for a long stretch (fake-GPS apps
    //    often report a constant accuracy)
    if (cur.accuracyMeters != null && (cur.accuracyMeters === 0 || cur.accuracyMeters === 1)) {
      signals.push({
        kind: "accuracy_too_perfect",
        pingIndex: i,
        description: `Accuracy reported as ${cur.accuracyMeters}m — real GPS rarely below 3m.`,
      });
    }
  }

  return signals;
}
