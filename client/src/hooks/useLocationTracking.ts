import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Position } from '@capacitor/geolocation';
import { 
  checkLocationPermission,
  requestLocationPermissions,
  getCurrentPosition,
  startNativeLocationTracking,
  saveTrackingState,
  getTrackingState,
  isWithinGeofence,
  GEOFENCE_RADII,
  LocationPermissionStatus,
  checkNativePermissions,
  openAppSettings
} from '@/lib/nativeLocationTracking';

export interface LocationTrackingHook {
  isTracking: boolean;
  permissionStatus: LocationPermissionStatus;
  hasBackgroundPermission: boolean;
  currentPosition: Position | null;
  error: string | null;
  isNative: boolean;
  startTracking: (jobId: number, workerId: number) => Promise<boolean>;
  stopTracking: () => void;
  requestPermissions: () => Promise<boolean>;
  checkAutoClockEligibility: (jobLat: number, jobLon: number) => boolean;
  checkManualClockEligibility: (jobLat: number, jobLon: number) => boolean;
  openAppSettings: () => Promise<void>;
}

export function useLocationTracking(): LocationTrackingHook {
  const [isTracking, setIsTracking] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<LocationPermissionStatus>('prompt');
  const [hasBackgroundPermission, setHasBackgroundPermission] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopFn, setStopFn] = useState<(() => void) | null>(null);

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    const init = async () => {
      const status = await checkLocationPermission();
      setPermissionStatus(status);
      
      if (isNative) {
        const perms = await checkNativePermissions();
        setHasBackgroundPermission(perms.background);
      } else if (status === 'granted') {
        setHasBackgroundPermission(true);
      }

      const state = await getTrackingState();
      if (state.enabled && state.jobId && state.workerId) {
        setIsTracking(true);
      }
    };
    
    init();

    return () => {
      if (stopFn) {
        stopFn();
      }
    };
  }, [isNative]);

  useEffect(() => {
    if (permissionStatus === 'granted') {
      getCurrentPosition().then(pos => {
        if (pos) setCurrentPosition(pos);
      });
    }
  }, [permissionStatus]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);
      const result = await requestLocationPermissions();
      
      if (result.foreground) {
        setPermissionStatus('granted');
        setHasBackgroundPermission(result.background);
        
        const pos = await getCurrentPosition();
        if (pos) setCurrentPosition(pos);
        
        return true;
      }
      
      setPermissionStatus('denied');
      setError('Location permission denied');
      return false;
    } catch (err) {
      setError('Failed to request permissions');
      return false;
    }
  }, []);

  const startTracking = useCallback(async (jobId: number, workerId: number): Promise<boolean> => {
    try {
      setError(null);
      
      if (permissionStatus !== 'granted') {
        const granted = await requestPermissions();
        if (!granted) return false;
      }
      
      const tracking = startNativeLocationTracking(jobId, workerId, (position) => {
        setCurrentPosition(position);
      });
      
      if (tracking) {
        setStopFn(() => tracking.stop);
      }
      
      setIsTracking(true);
      await saveTrackingState(true, jobId, workerId);
      
      return true;
    } catch (err) {
      setError('Failed to start tracking');
      return false;
    }
  }, [permissionStatus, requestPermissions]);

  const stopTracking = useCallback(() => {
    if (stopFn) {
      stopFn();
      setStopFn(null);
    }
    setIsTracking(false);
    saveTrackingState(false);
  }, [stopFn]);

  const checkAutoClockEligibility = useCallback((jobLat: number, jobLon: number): boolean => {
    if (!currentPosition) return false;
    return isWithinGeofence(
      currentPosition.coords.latitude,
      currentPosition.coords.longitude,
      jobLat,
      jobLon,
      GEOFENCE_RADII.AUTO_CLOCK
    );
  }, [currentPosition]);

  const checkManualClockEligibility = useCallback((jobLat: number, jobLon: number): boolean => {
    if (!currentPosition) return false;
    return isWithinGeofence(
      currentPosition.coords.latitude,
      currentPosition.coords.longitude,
      jobLat,
      jobLon,
      GEOFENCE_RADII.MANUAL_CLOCK
    );
  }, [currentPosition]);

  return {
    isTracking,
    permissionStatus,
    hasBackgroundPermission,
    currentPosition,
    error,
    isNative,
    startTracking,
    stopTracking,
    requestPermissions,
    checkAutoClockEligibility,
    checkManualClockEligibility,
    openAppSettings
  };
}
