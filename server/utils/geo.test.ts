/**
 * Backend location/geo utilities tests.
 * Used for worker location tracking: geofence, distance, etc.
 * Run with: npm run test:server
 */

import { describe, it, expect } from "vitest";
import {
  calculateHaversineDistance,
  metersToMiles,
  milesToMeters,
  isWithinGeofence,
  getDistanceDescription,
  GEOFENCE_RADIUS_MILES,
  GEOFENCE_RADIUS_METERS,
} from "./geo";

describe("server/utils/geo", () => {
  describe("calculateHaversineDistance", () => {
    it("returns 0 for same point", () => {
      const lat = 40.7128;
      const lon = -74.006;
      expect(calculateHaversineDistance(lat, lon, lat, lon)).toBe(0);
    });

    it("returns positive distance for different points", () => {
      const d = calculateHaversineDistance(40.7128, -74.006, 40.7589, -73.9851);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(10000); // NYC ~5km
    });

    it("is symmetric", () => {
      const d1 = calculateHaversineDistance(40, -74, 41, -73);
      const d2 = calculateHaversineDistance(41, -73, 40, -74);
      expect(d1).toBe(d2);
    });

    it("returns ~111km per degree latitude at equator (approx)", () => {
      const d = calculateHaversineDistance(0, 0, 1, 0);
      expect(d).toBeGreaterThan(110000);
      expect(d).toBeLessThan(112000);
    });
  });

  describe("metersToMiles / milesToMeters", () => {
    it("converts meters to miles correctly", () => {
      expect(metersToMiles(1609.344)).toBeCloseTo(1, 5);
      expect(metersToMiles(0)).toBe(0);
    });

    it("converts miles to meters correctly", () => {
      expect(milesToMeters(1)).toBeCloseTo(1609.344, 2);
    });

    it("round-trips", () => {
      const miles = 2.5;
      expect(metersToMiles(milesToMeters(miles))).toBeCloseTo(miles, 10);
    });
  });

  describe("isWithinGeofence", () => {
    const jobLat = 40.7128;
    const jobLon = -74.006;

    it("returns true when worker at same point as job", () => {
      expect(isWithinGeofence(jobLat, jobLon, jobLat, jobLon)).toBe(true);
    });

    it("returns true when worker within default radius", () => {
      // ~0.5 mile offset
      const workerLat = 40.717;
      const workerLon = -74.006;
      expect(isWithinGeofence(workerLat, workerLon, jobLat, jobLon)).toBe(true);
    });

    it("returns false when worker beyond default radius", () => {
      // ~5 miles away
      const workerLat = 40.8;
      const workerLon = -74.006;
      expect(isWithinGeofence(workerLat, workerLon, jobLat, jobLon)).toBe(false);
    });

    it("respects custom radius in meters", () => {
      const d = calculateHaversineDistance(40.7128, -74.006, 40.72, -74.006);
      expect(isWithinGeofence(40.72, -74.006, jobLat, jobLon, d + 100)).toBe(true);
      expect(isWithinGeofence(40.72, -74.006, jobLat, jobLon, d - 100)).toBe(false);
    });
  });

  describe("getDistanceDescription", () => {
    it("formats small distances in meters", () => {
      expect(getDistanceDescription(50)).toMatch(/meters/);
      expect(getDistanceDescription(50)).toContain("50");
    });

    it("formats medium distances in miles with one decimal", () => {
      const s = getDistanceDescription(milesToMeters(0.5));
      expect(s).toMatch(/0\.5 miles/);
    });

    it("formats larger distances in miles", () => {
      const s = getDistanceDescription(milesToMeters(2));
      expect(s).toMatch(/2\.0 miles/);
    });
  });

  describe("constants", () => {
    it("GEOFENCE_RADIUS_MILES is 2", () => {
      expect(GEOFENCE_RADIUS_MILES).toBe(2);
    });

    it("GEOFENCE_RADIUS_METERS equals milesToMeters(2)", () => {
      expect(GEOFENCE_RADIUS_METERS).toBe(milesToMeters(GEOFENCE_RADIUS_MILES));
    });
  });
});
