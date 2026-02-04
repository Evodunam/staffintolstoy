import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./use-auth";
import { useProfile } from "./use-profiles";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "./use-toast";
import { Capacitor } from "@capacitor/core";
import {
  startNativeLocationTracking,
  obtainLocationFromChain,
  fetchIpLocation,
  type LocationSource,
} from "@/lib/nativeLocationTracking";
import { isWorkerOnboardingComplete } from "@/lib/worker-onboarding";

interface LocationState {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

interface NearbyJob {
  id: number;
  title: string;
  location: string;
  latitude: string;
  longitude: string;
  distanceMeters: number;
  distanceMiles: number;
}

interface ActiveTimesheet {
  id: number;
  jobId: number;
  clockInTime: string;
  jobTitle?: string;
  jobLocation?: string;
}

const GEOFENCE_RADIUS_MILES = 2;
const METERS_PER_MILE = 1609.34;

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function useLocationTracking() {
  const { user, isAuthenticated } = useAuth();
  const { data: profile } = useProfile(isAuthenticated ? user?.id : undefined);
  const { toast } = useToast();

  const [location, setLocation] = useState<LocationState | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [nearbyJobs, setNearbyJobs] = useState<NearbyJob[]>([]);
  const [activeTimesheet, setActiveTimesheet] = useState<ActiveTimesheet | null>(null);
  const [showClockInBanner, setShowClockInBanner] = useState(false);
  const [showClockOutBanner, setShowClockOutBanner] = useState(false);
  const [pendingAutoClockIn, setPendingAutoClockIn] = useState<NearbyJob | null>(null);
  const [pendingAutoClockOut, setPendingAutoClockOut] = useState(false);
  const [isClockingIn, setIsClockingIn] = useState(false);
  const [isClockingOut, setIsClockingOut] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const ipPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoClockInTriggeredRef = useRef<Set<number>>(new Set());
  const startTrackingRef = useRef<() => Promise<void>>(async () => {});
  const stopTrackingRef = useRef<() => void>(() => {});
  const fetchActiveTimesheetRef = useRef<() => Promise<void>>(async () => {});

  const applyLocation = useCallback((result: { latitude: number; longitude: number; accuracy: number }) => {
    setLocation({
      latitude: result.latitude,
      longitude: result.longitude,
      accuracy: result.accuracy ?? 1000,
      timestamp: Date.now(),
    });
    setLocationError(null);
  }, []);

  const isDeviceSource = (s: LocationSource) =>
    s === "device_web" || s === "device_ios" || s === "device_android";

  const startTracking = useCallback(async () => {
    setLocationError(null);
    // Defer so we don't trigger "Maximum update depth" when effect runs (setState during commit).
    const tid = setTimeout(() => setIsTracking(true), 0);

    // Chain: device (web / iOS / Android) → Google → ipapi → ip-api → other
    const result = await obtainLocationFromChain();
    if (!result) {
      clearTimeout(tid);
      setLocationError("Could not obtain location. Please enable location or check your connection.");
      return;
    }
    applyLocation(result);

    if (isDeviceSource(result.source)) {
      // Use device for pinging: watchPosition (continuous updates)
      if (navigator.geolocation) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (position) => {
            applyLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy ?? 100,
            });
          },
          (error) => {
            switch (error.code) {
              case error.PERMISSION_DENIED:
                setLocationError("Location permission denied.");
                break;
              case error.POSITION_UNAVAILABLE:
                setLocationError("Location unavailable.");
                break;
              case error.TIMEOUT:
                setLocationError("Location request timed out.");
                break;
              default:
                setLocationError("Location error.");
            }
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
      }
    } else {
      // Use IP-based source for pinging: poll periodically (every 3 min)
      const pollMs = 3 * 60 * 1000;
      ipPollIntervalRef.current = setInterval(async () => {
        const ipResult = await fetchIpLocation();
        if (ipResult) applyLocation(ipResult);
      }, pollMs);
    }
  }, [applyLocation]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (ipPollIntervalRef.current) {
      clearInterval(ipPollIntervalRef.current);
      ipPollIntervalRef.current = null;
    }
    setIsTracking(false);
  }, []);

  const fetchActiveTimesheet = useCallback(async () => {
    if (!profile || profile.role !== "worker") return;
    
    try {
      const response = await fetch(`/api/timesheets/active/${profile.id}`);
      if (response.ok) {
        const data = await response.json();
        setActiveTimesheet(data);
      } else {
        setActiveTimesheet(null);
      }
    } catch {
      setActiveTimesheet(null);
    }
  }, [profile]);

  startTrackingRef.current = startTracking;
  stopTrackingRef.current = stopTracking;
  fetchActiveTimesheetRef.current = fetchActiveTimesheet;

  const checkNearbyJobs = useCallback(async () => {
    if (!location || !profile || profile.role !== "worker") return;
    const lat = Number(location.latitude);
    const lng = Number(location.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    try {
      const response = await fetch(
        `/api/jobs/nearby?lat=${lat}&lng=${lng}&radius=${GEOFENCE_RADIUS_MILES}`,
        { credentials: "include" }
      );
      if (response.ok) {
        const jobs = await response.json();
        const jobsWithDistance = jobs.map((job: any) => {
          const distanceMeters = calculateDistance(
            location.latitude,
            location.longitude,
            parseFloat(job.latitude),
            parseFloat(job.longitude)
          );
          return {
            ...job,
            distanceMeters,
            distanceMiles: distanceMeters / METERS_PER_MILE,
          };
        });
        setNearbyJobs(jobsWithDistance);

        if (!activeTimesheet && jobsWithDistance.length > 0) {
          const now = new Date();
          const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
          
          const eligibleJobs = jobsWithDistance.filter((job: any) => {
            if (job.distanceMiles > GEOFENCE_RADIUS_MILES) return false;
            if (autoClockInTriggeredRef.current.has(job.id)) return false;
            
            const jobStartTime = new Date(job.startDate);
            const isOnDemand = job.isOnDemand || false;
            const isWithinTimeWindow = isOnDemand || jobStartTime <= oneHourFromNow;
            
            return isWithinTimeWindow;
          });

          if (eligibleJobs.length > 0) {
            const closestJob = eligibleJobs.reduce((closest: NearbyJob, job: NearbyJob) =>
              job.distanceMeters < closest.distanceMeters ? job : closest
            );
            setPendingAutoClockIn(closestJob);
            setShowClockInBanner(true);
          }
        }
      }
    } catch (error) {
      console.error("Error checking nearby jobs:", error);
    }
  }, [location, profile, activeTimesheet]);

  const checkClockOutProximity = useCallback(() => {
    if (!location || !activeTimesheet || nearbyJobs.length === 0) return;

    const activeJob = nearbyJobs.find((j) => j.id === activeTimesheet.jobId);
    if (!activeJob) return;

    if (activeJob.distanceMiles > GEOFENCE_RADIUS_MILES && !pendingAutoClockOut) {
      setPendingAutoClockOut(true);
      setShowClockOutBanner(true);
    } else if (activeJob.distanceMiles <= GEOFENCE_RADIUS_MILES) {
      setPendingAutoClockOut(false);
      setShowClockOutBanner(false);
    }
  }, [location, activeTimesheet, nearbyJobs, pendingAutoClockOut]);

  const clockIn = useCallback(
    async (jobId: number, isAutomatic: boolean = false): Promise<{ success: boolean; error?: string; code?: string; distanceMiles?: string }> => {
      if (!location || !profile) {
        return { success: false, error: "Location not available" };
      }

      setIsClockingIn(true);
      try {
        const response = await apiRequest("POST", "/api/timesheets/clock-in", {
          jobId,
          workerId: profile.id,
          latitude: location.latitude,
          longitude: location.longitude,
          isAutomatic,
        });

        if (response.ok) {
          const timesheet = await response.json();
          setActiveTimesheet(timesheet);
          setShowClockInBanner(false);
          setPendingAutoClockIn(null);
          autoClockInTriggeredRef.current.add(jobId);
          
          toast({
            title: isAutomatic ? "Auto Clocked In" : "Clocked In",
            description: `You have been clocked in${isAutomatic ? " automatically based on your location" : ""}.`,
          });

          queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
          queryClient.invalidateQueries({ queryKey: ["/api/timesheets/active"] });
          queryClient.invalidateQueries({ queryKey: ["/api/worker/clock-in-prompt-jobs"] });
          return { success: true };
        } else {
          const errorData = await response.json();
          if (errorData.code === "OUTSIDE_GEOFENCE") {
            return { 
              success: false, 
              error: errorData.details || "Too far from job site",
              code: "OUTSIDE_GEOFENCE",
              distanceMiles: errorData.distanceMiles
            };
          } else if (errorData.code === "TOO_EARLY") {
            return {
              success: false,
              error: errorData.details || "Too early to clock in",
              code: "TOO_EARLY"
            };
          }
          return { success: false, error: errorData.message || "Clock in failed" };
        }
      } catch (error) {
        toast({
          title: "Clock In Failed",
          description: "Unable to clock in. Please try again.",
          variant: "destructive",
        });
        return { success: false, error: "Network error" };
      } finally {
        setIsClockingIn(false);
      }
    },
    [location, profile, toast]
  );

  const clockOut = useCallback(
    async (timesheetId?: number, isAutomatic: boolean = false): Promise<{ success: boolean; error?: string }> => {
      const targetTimesheetId = timesheetId || activeTimesheet?.id;
      if (!location || !targetTimesheetId) {
        return { success: false, error: "No active timesheet" };
      }

      setIsClockingOut(true);
      try {
        const response = await apiRequest("POST", "/api/timesheets/clock-out", {
          timesheetId: targetTimesheetId,
          latitude: location.latitude,
          longitude: location.longitude,
          isAutomatic,
        });

        if (response.ok) {
          setActiveTimesheet(null);
          setShowClockOutBanner(false);
          setPendingAutoClockOut(false);
          
          toast({
            title: isAutomatic ? "Auto Clocked Out" : "Clocked Out",
            description: `You have been clocked out${isAutomatic ? " automatically based on your location" : ""}.`,
          });

          queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
          queryClient.invalidateQueries({ queryKey: ["/api/timesheets/active"] });
          queryClient.invalidateQueries({ queryKey: ["/api/worker/clock-in-prompt-jobs"] });
          return { success: true };
        } else {
          const errorData = await response.json();
          return { success: false, error: errorData.message || "Clock out failed" };
        }
      } catch (error) {
        toast({
          title: "Clock Out Failed",
          description: "Unable to clock out. Please try again.",
          variant: "destructive",
        });
        return { success: false, error: "Network error" };
      } finally {
        setIsClockingOut(false);
      }
    },
    [location, activeTimesheet, toast]
  );

  const dismissClockInBanner = useCallback(() => {
    setShowClockInBanner(false);
    if (pendingAutoClockIn) {
      autoClockInTriggeredRef.current.add(pendingAutoClockIn.id);
    }
    setPendingAutoClockIn(null);
  }, [pendingAutoClockIn]);

  const dismissClockOutBanner = useCallback(() => {
    setShowClockOutBanner(false);
    setPendingAutoClockOut(false);
  }, []);

  const triggerAutoClockIn = useCallback(() => {
    if (pendingAutoClockIn) {
      clockIn(pendingAutoClockIn.id, true);
    }
  }, [pendingAutoClockIn, clockIn]);

  const triggerAutoClockOut = useCallback(() => {
    clockOut(undefined, true);
  }, [clockOut]);

  // Save worker's location to profile when it changes
  const saveWorkerLocation = useCallback(async () => {
    if (!location || !profile || profile.role !== "worker") return;
    
    try {
      await fetch(`/api/profiles/${profile.id}/location`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: location.latitude.toString(),
          longitude: location.longitude.toString(),
        }),
      });
    } catch {
      // Silently fail - location saving is background operation
    }
  }, [location, profile]);

  // Only start location tracking after worker onboarding is complete (no tracking or location modal until then).
  const workerOnboardingComplete =
    profile != null && profile.role === "worker" && isWorkerOnboardingComplete(profile);

  // Use refs so effect deps are stable (profile object identity changes cause loop if callbacks are deps).
  useEffect(() => {
    if (profile?.role === "worker" && isAuthenticated && workerOnboardingComplete) {
      startTrackingRef.current();
      fetchActiveTimesheetRef.current();
    }

    return () => {
      stopTrackingRef.current();
    };
  }, [profile?.id, profile?.role, isAuthenticated, workerOnboardingComplete]);

  // Save location when it changes (throttled - only on initial tracking and significant changes)
  useEffect(() => {
    if (location && profile?.role === "worker" && isTracking) {
      saveWorkerLocation();
    }
  }, [location?.latitude, location?.longitude, profile?.role, isTracking, saveWorkerLocation]);

  useEffect(() => {
    if (location && isTracking) {
      checkNearbyJobs();
    }
  }, [location, isTracking, checkNearbyJobs]);

  useEffect(() => {
    if (activeTimesheet && location) {
      checkClockOutProximity();
    }
  }, [activeTimesheet, location, checkClockOutProximity]);

  // Send location pings to the server while clocked in so we can compute "time away from site" at clock-out
  const sendLocationPingForActiveShift = useCallback(async () => {
    if (!location || !activeTimesheet?.jobId || !profile?.id) return;
    try {
      await fetch("/api/location-pings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          jobId: activeTimesheet.jobId,
          source: "browser",
        }),
      });
    } catch {
      // Silent fail - pings are best-effort for time-away calculation
    }
  }, [location, activeTimesheet?.jobId, profile?.id]);

  useEffect(() => {
    if (!activeTimesheet || !location) return;
    sendLocationPingForActiveShift();
    const interval = setInterval(sendLocationPingForActiveShift, 60 * 1000); // 60s for faster leave-site detection
    return () => clearInterval(interval);
  }, [activeTimesheet?.id, location?.latitude, location?.longitude, sendLocationPingForActiveShift]);

  // Native: start OS geofence + foreground service when clocked in (for concrete tracking when app closed)
  const nativeStopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !activeTimesheet || !profile?.id) return;
    const job = nearbyJobs.find((j) => j.id === activeTimesheet!.jobId);
    const jobCoords = job?.latitude && job?.longitude
      ? { latitude: parseFloat(job.latitude), longitude: parseFloat(job.longitude) }
      : undefined;
    const tracking = startNativeLocationTracking(
      activeTimesheet.jobId,
      profile.id,
      () => {},
      jobCoords
    );
    if (tracking) nativeStopRef.current = tracking.stop;
    return () => {
      nativeStopRef.current?.();
      nativeStopRef.current = null;
    };
  }, [activeTimesheet?.id, activeTimesheet?.jobId, profile?.id, nearbyJobs]);

  return {
    location,
    locationError,
    isTracking,
    nearbyJobs,
    activeTimesheet,
    showClockInBanner,
    showClockOutBanner,
    pendingAutoClockIn,
    pendingAutoClockOut,
    isClockingIn,
    isClockingOut,
    clockIn,
    clockOut,
    dismissClockInBanner,
    dismissClockOutBanner,
    triggerAutoClockIn,
    triggerAutoClockOut,
    startTracking,
    stopTracking,
    GEOFENCE_RADIUS_MILES,
  };
}
