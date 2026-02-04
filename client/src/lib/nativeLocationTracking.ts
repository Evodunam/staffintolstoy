export type LocationPermissionStatus = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

interface LocationTrackingServicePlugin {
  startTracking(options: { jobId: number; workerId: number; jobLatitude?: number; jobLongitude?: number }): Promise<{ started: boolean }>;
  stopTracking(): Promise<{ stopped: boolean }>;
  getTrackingState(): Promise<{ enabled: boolean; jobId: number | null; workerId: number | null }>;
  checkPermissions(): Promise<{ foreground: boolean; background: boolean }>;
  requestForegroundPermission(): Promise<{ granted: boolean }>;
  requestBackgroundPermission(): Promise<{ granted: boolean; needsSettings: boolean }>;
  openAppSettings(): Promise<void>;
  openBackgroundLocationSettings(): Promise<void>;
}

export interface LocationTrackingState {
  isTracking: boolean;
  hasPermission: boolean;
  hasBackgroundPermission: boolean;
  currentPosition: { coords: { latitude: number; longitude: number; accuracy: number } } | null;
  error: string | null;
}

export interface GeofenceConfig {
  jobId: number;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

// Lazy load Capacitor modules - only import if available
let Capacitor: any = null;
let Geolocation: any = null;
let LocationTrackingService: LocationTrackingServicePlugin | null = null;
let isNative = false;
let isAndroid = false;
let capacitorLoaded = false;

async function loadCapacitor() {
  if (capacitorLoaded) return;
  
  try {
    // Import will resolve to stub modules if Capacitor is not installed
    // or real modules if it is installed
    const capacitorModule = await import('@capacitor/core');
    Capacitor = capacitorModule.Capacitor;
    const geolocationModule = await import('@capacitor/geolocation');
    Geolocation = geolocationModule.Geolocation;
    
    // Check if we got the real Capacitor (not the stub)
    // The stub has __isStub property, real Capacitor doesn't
    if (Capacitor && !(capacitorModule as any).__isStub && typeof Capacitor.isNativePlatform === 'function') {
      isNative = Capacitor.isNativePlatform();
      isAndroid = Capacitor.getPlatform() === 'android';
      
      // Only register plugin if we're actually native
      if (isNative && capacitorModule.registerPlugin) {
        LocationTrackingService = capacitorModule.registerPlugin<LocationTrackingServicePlugin>('LocationTrackingService');
      }
    } else {
      // We got the stub, so we're in web
      isNative = false;
      isAndroid = false;
    }
    capacitorLoaded = true;
  } catch (error) {
    // Fallback - running in web environment
    capacitorLoaded = true;
    isNative = false;
    isAndroid = false;
  }
}

/** Location result from the chain */
export type LocationSource = 'device_web' | 'device_ios' | 'device_android' | 'google_ip' | 'ipapi' | 'ip-api';

export interface LocationChainResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  source: LocationSource;
}

/** Fetch IP-based location from server (Google → ipapi → ip-api.com chain) */
export async function fetchIpLocation(): Promise<LocationChainResult | null> {
  try {
    const res = await fetch('/api/geolocation/ip', { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.latitude == null || data?.longitude == null) return null;
    return {
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy ?? 10000,
      source: (data.source || 'google_ip') as LocationSource,
    };
  } catch {
    return null;
  }
}

/** Try IP-based geolocation - returns true if we get coords (for isWorkerLocationGranted) */
async function tryIpGeolocation(): Promise<boolean> {
  const result = await fetchIpLocation();
  return result != null;
}

const DEVICE_TIMEOUT_MS = 5000;

/**
 * Obtain location using the full chain: device (web / iOS / Android) → Google → ipapi → other.
 * The first method that returns a location wins. That source is used for ongoing pinging.
 * Uses a hard timeout on device so we fall through to IP when browser's geolocation hangs (e.g. 403).
 */
export async function obtainLocationFromChain(): Promise<LocationChainResult | null> {
  if (typeof window === 'undefined') return null;

  // 1. Try device: web (navigator.geolocation), iOS, or Android (Capacitor)
  const tryDevice = (): Promise<LocationChainResult | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (v: LocationChainResult | null) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const platform = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor?.getPlatform?.();
          let source: LocationSource = 'device_web';
          if (platform === 'ios') source = 'device_ios';
          else if (platform === 'android') source = 'device_android';
          finish({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 100,
            source,
          });
        },
        () => finish(null),
        { timeout: Math.min(4000, DEVICE_TIMEOUT_MS - 1000), maximumAge: 60000 }
      );
      // Hard timeout: if browser geolocation hangs (e.g. 403 from provider), fall through to IP
      setTimeout(() => finish(null), DEVICE_TIMEOUT_MS);
    });
  };

  // Try device first
  const deviceResult = await tryDevice();
  if (deviceResult) return deviceResult;

  // 2. Try IP chain (Google → ipapi → ip-api.com on server)
  return await fetchIpLocation();
}

/**
 * Returns true if we can obtain location from any source in the chain.
 * Used for worker gate: show unexitable modal when false.
 */
export async function isWorkerLocationGranted(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const checkDevice = async (): Promise<boolean> => {
    if (!navigator.geolocation) return false;
    const hasCapacitor = typeof (window as any).Capacitor !== 'undefined';
    if (!hasCapacitor) {
      try {
        const perm = (navigator as any).permissions?.query;
        if (typeof perm === 'function') {
          const result = await perm({ name: 'geolocation' });
          return result.state === 'granted';
        }
        return await new Promise<boolean>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            (err) => resolve(err.code !== 1),
            { timeout: 3000, maximumAge: 60000 }
          );
        });
      } catch {
        return false;
      }
    }
    await loadCapacitor();
    if (!isNative || !Geolocation) {
      return await new Promise<boolean>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(false),
          { timeout: 3000, maximumAge: 60000 }
        );
      });
    }
    try {
      const status = await Geolocation.checkPermissions();
      return status.location === 'granted';
    } catch {
      return false;
    }
  };

  if (await checkDevice()) return true;
  return await tryIpGeolocation();
}

export async function checkLocationPermission(): Promise<LocationPermissionStatus> {
  // For web, return immediately without loading Capacitor
  if (typeof window !== 'undefined' && !(window as any).Capacitor) {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return 'granted';
    }
    return 'denied';
  }
  
  await loadCapacitor();
  
  if (!isNative || !Geolocation) {
    // Web fallback - check if geolocation is available
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return 'granted';
    }
    return 'denied';
  }
  
  try {
    const status = await Geolocation.checkPermissions();
    return status.location as LocationPermissionStatus;
  } catch (error) {
    console.error('Error checking location permission:', error);
    return 'denied';
  }
}

export async function requestForegroundLocationPermission(): Promise<boolean> {
  await loadCapacitor();
  
  if (!isNative || !Geolocation) {
    // Web fallback - try to request permission
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(false),
          { timeout: 5000 }
        );
      });
    }
    return false;
  }
  
  try {
    if (isAndroid && LocationTrackingService) {
      const result = await LocationTrackingService.requestForegroundPermission();
      return result.granted;
    } else if (Geolocation) {
      const result = await Geolocation.requestPermissions({ permissions: ['location'] });
      return result.location === 'granted';
    }
    return false;
  } catch (error) {
    console.error('Error requesting foreground location:', error);
    return false;
  }
}

export async function requestBackgroundLocationPermission(): Promise<{ granted: boolean; needsSettings: boolean }> {
  await loadCapacitor();
  
  if (!isNative || !Geolocation) {
    // Web fallback - background location not really applicable
    return { granted: true, needsSettings: false };
  }
  
  try {
    if (isAndroid && LocationTrackingService) {
      const result = await LocationTrackingService.requestBackgroundPermission();
      return { granted: result.granted, needsSettings: result.needsSettings };
    } else if (Geolocation) {
      const result = await Geolocation.requestPermissions({ permissions: ['location'] });
      return { granted: result.location === 'granted', needsSettings: false };
    }
    return { granted: false, needsSettings: false };
  } catch (error) {
    console.error('Error requesting background location:', error);
    return { granted: false, needsSettings: false };
  }
}

export async function openBackgroundLocationSettings(): Promise<void> {
  await loadCapacitor();
  
  if (isAndroid && isNative && LocationTrackingService) {
    try {
      await LocationTrackingService.openBackgroundLocationSettings();
    } catch (error) {
      console.error('Error opening background location settings:', error);
    }
  }
}

export async function requestLocationPermissions(): Promise<{
  foreground: boolean;
  background: boolean;
  needsSettings: boolean;
}> {
  const foreground = await requestForegroundLocationPermission();
  
  if (!foreground) {
    return { foreground: false, background: false, needsSettings: false };
  }
  
  const backgroundResult = await requestBackgroundLocationPermission();
  
  return { 
    foreground, 
    background: backgroundResult.granted, 
    needsSettings: backgroundResult.needsSettings 
  };
}

export async function getCurrentPosition(): Promise<{ coords: { latitude: number; longitude: number; accuracy: number } } | null> {
  await loadCapacitor();
  
  if (!isNative || !Geolocation) {
    // Web fallback
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve({
            coords: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy || 0
            }
          }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    }
    return null;
  }
  
  try {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000
    });
    return position as any;
  } catch (error) {
    console.error('Error getting current position:', error);
    return null;
  }
}

export function startNativeLocationTracking(
  jobId: number,
  workerId: number,
  onLocationUpdate?: (position: any) => void,
  jobCoords?: { latitude: number; longitude: number }
): { stop: () => void } | null {
  if (!isNative || !Geolocation) {
    console.log('Native location tracking not available in web');
    return null;
  }

  if (isAndroid && LocationTrackingService) {
    startAndroidForegroundService(jobId, workerId, jobCoords);
  }
  
  let watchId: string | null = null;
  
  if (Geolocation.watchPosition) {
    Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 30000
      },
      (position: any, err: any) => {
        if (err) {
          console.error('Watch position error:', err);
          return;
        }
        if (position && onLocationUpdate) {
          onLocationUpdate(position);
        }
      }
    ).then((id: string) => {
      watchId = id;
    });
  }
  
  return {
    stop: () => {
      if (watchId && Geolocation.clearWatch) {
        Geolocation.clearWatch({ id: watchId });
      }
      if (isAndroid && LocationTrackingService) {
        stopAndroidForegroundService();
      }
    }
  };
}

async function startAndroidForegroundService(jobId: number, workerId: number, jobCoords?: { latitude: number; longitude: number }): Promise<void> {
  if (!isAndroid || !LocationTrackingService) return;

  try {
    const opts: { jobId: number; workerId: number; jobLatitude?: number; jobLongitude?: number } = { jobId, workerId };
    if (jobCoords && jobCoords.latitude && jobCoords.longitude) {
      opts.jobLatitude = jobCoords.latitude;
      opts.jobLongitude = jobCoords.longitude;
    }
    await LocationTrackingService.startTracking(opts);
    console.log('Android foreground service started');
  } catch (error) {
    console.log('Could not start Android foreground service:', error);
  }
}

async function stopAndroidForegroundService(): Promise<void> {
  if (!isAndroid || !LocationTrackingService) return;
  
  try {
    await LocationTrackingService.stopTracking();
    console.log('Android foreground service stopped');
  } catch (error) {
    console.log('Could not stop Android foreground service:', error);
  }
}

export async function checkNativePermissions(): Promise<{ foreground: boolean; background: boolean }> {
  // For web, return immediately without loading Capacitor
  if (typeof window !== 'undefined' && !(window as any).Capacitor) {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return { foreground: true, background: true };
    }
    return { foreground: false, background: false };
  }
  
  await loadCapacitor();
  
  if (!isNative || !Geolocation) {
    // Web fallback - check browser geolocation
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return { foreground: true, background: true };
    }
    return { foreground: false, background: false };
  }
  
  if (isAndroid && LocationTrackingService) {
    try {
      return await LocationTrackingService.checkPermissions();
    } catch {
      return { foreground: false, background: false };
    }
  }
  
  if (Geolocation) {
    try {
      const status = await Geolocation.checkPermissions();
      return {
        foreground: status.location === 'granted',
        background: status.location === 'granted'
      };
    } catch {
      return { foreground: false, background: false };
    }
  }
  
  return { foreground: false, background: false };
}

export async function openAppSettings(): Promise<void> {
  await loadCapacitor();
  
  if (isAndroid && isNative && LocationTrackingService) {
    try {
      await LocationTrackingService.openAppSettings();
    } catch (error) {
      console.error('Error opening app settings:', error);
    }
  }
}

export function calculateDistance(
  lat1: number, 
  lon1: number, 
  lat2: number, 
  lon2: number
): number {
  const R = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function isWithinGeofence(
  currentLat: number,
  currentLon: number,
  targetLat: number,
  targetLon: number,
  radiusMeters: number
): boolean {
  const distance = calculateDistance(currentLat, currentLon, targetLat, targetLon);
  return distance <= radiusMeters;
}

export const GEOFENCE_RADII = {
  AUTO_CLOCK: 402,
  MANUAL_CLOCK: 8047
};

export async function saveTrackingState(
  enabled: boolean, 
  jobId?: number, 
  workerId?: number
): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('tolstoy_tracking_enabled', String(enabled));
      if (jobId) localStorage.setItem('tolstoy_active_job_id', String(jobId));
      if (workerId) localStorage.setItem('tolstoy_active_worker_id', String(workerId));
    }
  } catch (error) {
    console.error('Error saving tracking state:', error);
  }
}

export async function getTrackingState(): Promise<{ 
  enabled: boolean; 
  jobId: number | null; 
  workerId: number | null; 
}> {
  await loadCapacitor();
  
  if (isAndroid && isNative && LocationTrackingService) {
    try {
      const state = await LocationTrackingService.getTrackingState();
      return {
        enabled: state.enabled,
        jobId: state.jobId,
        workerId: state.workerId
      };
    } catch {
      // Fall back to localStorage
    }
  }
  
  try {
    if (typeof localStorage !== 'undefined') {
      const enabled = localStorage.getItem('tolstoy_tracking_enabled') === 'true';
      const jobId = localStorage.getItem('tolstoy_active_job_id');
      const workerId = localStorage.getItem('tolstoy_active_worker_id');
      
      return {
        enabled,
        jobId: jobId ? parseInt(jobId) : null,
        workerId: workerId ? parseInt(workerId) : null
      };
    }
  } catch {
    // Ignore
  }
  
  return { enabled: false, jobId: null, workerId: null };
}
