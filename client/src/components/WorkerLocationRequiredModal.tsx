import { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { Button } from "@/components/ui/button";
import { MapPin, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isWorkerLocationGranted,
  obtainLocationFromChain,
  openAppSettings,
} from "@/lib/nativeLocationTracking";
import { isWorkerOnboardingComplete } from "@/lib/worker-onboarding";

/**
 * Global, unexitable modal for workers when location is not being tracked.
 * Shown only after worker onboarding is complete; then when: authenticated worker on dashboard routes and location permission is not granted.
 * Applies to all workers including workers of the admin (employees with teamId)—they must grant location after completing onboarding.
 * No close button, no escape, no overlay click. User must turn on location to continue.
 *
 * Uses a custom modal (no Radix Dialog) to avoid Radix Presence setRef "Maximum update depth exceeded"
 * when React Query updates trigger re-renders while the modal is open.
 */
export function WorkerLocationRequiredModal() {
  const [path] = useLocation();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [allFailed, setAllFailed] = useState(false);

  const isWorkerDashboard =
    path.startsWith("/dashboard") && !path.startsWith("/dashboard/company");
  const isWorkerOnboardingPath =
    path === "/worker-onboarding" || path.startsWith("/worker-onboarding");

  const checkGranted = useCallback(async () => {
    const granted = await isWorkerLocationGranted();
    setLocationGranted(granted);
    return granted;
  }, []);

  const onboardingComplete = profile != null && profile.role === "worker" && isWorkerOnboardingComplete(profile);

  useEffect(() => {
    if (!isAuthenticated || profile?.role !== "worker" || !isWorkerDashboard || isWorkerOnboardingPath || !onboardingComplete) {
      setLocationGranted(true);
      return;
    }
    checkGranted();
  }, [isAuthenticated, profile?.role, isWorkerDashboard, isWorkerOnboardingPath, onboardingComplete, checkGranted]);

  useEffect(() => {
    if (!isWorkerDashboard || profile?.role !== "worker") return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkGranted();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isWorkerDashboard, profile?.role, checkGranted]);

  const show =
    isAuthenticated &&
    !authLoading &&
    !profileLoading &&
    profile?.role === "worker" &&
    onboardingComplete &&
    isWorkerDashboard &&
    !isWorkerOnboardingPath &&
    locationGranted === false;

  const runChain = useCallback(async () => {
    setIsRequesting(true);
    setAllFailed(false);
    try {
      const result = await obtainLocationFromChain();
      if (result != null) {
        setLocationGranted(true);
      } else {
        setAllFailed(true);
      }
    } finally {
      setIsRequesting(false);
    }
  }, []);

  useEffect(() => {
    if (!show) return;
    runChain();
  }, [show, runChain]);

  const handleTurnOnLocation = runChain;

  const handleOpenSettings = () => {
    openAppSettings();
  };

  if (!show) return null;

  return (
    <WorkerLocationModalPortal
      isRequesting={isRequesting}
      allFailed={allFailed}
      onTurnOnLocation={handleTurnOnLocation}
      onOpenSettings={handleOpenSettings}
    />
  );
}

/** Custom modal content in a portal to avoid Radix Dialog/Presence. */
function WorkerLocationModalPortal({
  isRequesting,
  allFailed,
  onTurnOnLocation,
  onOpenSettings,
}: {
  isRequesting: boolean;
  allFailed: boolean;
  onTurnOnLocation: () => void;
  onOpenSettings: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;
  const container = document.getElementById("dialog-container") ?? document.body;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worker-location-modal-title"
      aria-describedby="worker-location-modal-desc"
      data-testid="dialog-worker-location-required"
    >
      <div
        className="fixed inset-0 bg-black/80"
        aria-hidden
        onPointerDown={(e) => e.preventDefault()}
      />
      <div
        className={cn(
          "relative z-[201] grid w-full max-w-lg max-h-[90vh] overflow-y-auto gap-4 border border-border bg-background p-[21pt] shadow-lg rounded-2xl pointer-events-auto",
          "sm:max-w-md"
        )}
      >
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <MapPin className="h-5 w-5" />
            </div>
            <h2
              id="worker-location-modal-title"
              className="text-lg font-semibold leading-none tracking-tight text-left"
            >
              Turn on location tracking
            </h2>
          </div>
          <p
            id="worker-location-modal-desc"
            className="text-sm text-muted-foreground text-left pt-1"
          >
            You must enable location tracking to use the app. This is required
            for clock in/out and job verification. Location is only used for
            work time tracking.
          </p>
        </div>
        {allFailed && (
          <div
            className="rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-3 text-left dark:border-amber-600 dark:bg-amber-950/80"
            role="alert"
          >
            <p className="font-semibold text-amber-800 dark:text-amber-200">
              Could not get your location
            </p>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
              Turn on location services to use this app:
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-700 dark:text-amber-300">
              <li>On phone: Settings → Privacy → Location → turn ON</li>
              <li>In browser: Click the lock/location icon → Allow location</li>
              <li>Ensure Wi‑Fi or mobile data is connected</li>
            </ul>
            <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-200">
              Then tap &quot;Try again&quot; or &quot;Open settings&quot; below.
            </p>
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-4">
          {allFailed && (
            <Button
              variant="outline"
              onClick={onOpenSettings}
              className="w-full sm:w-auto"
              data-testid="button-open-settings"
            >
              Open settings
            </Button>
          )}
          <Button
            onClick={onTurnOnLocation}
            disabled={isRequesting}
            className="w-full sm:w-auto"
            data-testid="button-turn-on-location"
          >
            {isRequesting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Checking…
              </>
            ) : allFailed ? (
              "Try again"
            ) : (
              "Turn on location"
            )}
          </Button>
        </div>
      </div>
    </div>,
    container
  );
}
