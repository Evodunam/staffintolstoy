import { useState, useEffect } from "react";
import { ChevronLeft, MapPin, Navigation, Clock, Car, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobilePopup } from "@/components/ui/mobile-popup";
import { useIsMobile } from "@/hooks/use-mobile";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

interface JobInfo {
  id: number;
  title?: string;
  address?: string;
  city?: string;
  state?: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
}

interface DriveTimePopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // New object-based props (preferred)
  job?: JobInfo;
  userLocation?: { lat: number; lng: number } | null;
  isMobile?: boolean;
  isAccepted?: boolean; // If false, hide street numbers for privacy
  // Legacy individual props (still supported)
  jobAddress?: string;
  jobCity?: string;
  jobState?: string;
  jobLatitude?: string | number;
  jobLongitude?: string | number;
  userLatitude?: number;
  userLongitude?: number;
  userAddress?: string;
  onGetDirections?: () => void;
}

interface DriveTimeInfo {
  distance: string;
  duration: string;
  durationValue: number;
}

// Helper to remove street numbers from address for privacy
function removeStreetNumbers(address: string): string {
  // Remove leading numbers and common unit patterns (e.g., "123 Main St" -> "Main St")
  return address.replace(/^\d+\s*[-/]?\s*\d*\s*/, "").trim();
}

export function DriveTimePopup({
  open,
  onOpenChange,
  job,
  userLocation,
  isMobile: propIsMobile,
  isAccepted = true,
  jobAddress: legacyJobAddress,
  jobCity: legacyJobCity,
  jobState: legacyJobState,
  jobLatitude: legacyJobLatitude,
  jobLongitude: legacyJobLongitude,
  userLatitude: legacyUserLatitude,
  userLongitude: legacyUserLongitude,
  userAddress,
  onGetDirections,
}: DriveTimePopupProps) {
  const hookIsMobile = useIsMobile();
  const isMobile = propIsMobile ?? hookIsMobile;
  const { t } = useTranslation();
  const { t: tCommon } = useTranslation("common");
  const [driveTime, setDriveTime] = useState<DriveTimeInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  // Normalize props - support both object and individual prop styles
  const jobAddress = job?.address || legacyJobAddress || "";
  const jobCity = job?.city || legacyJobCity;
  const jobState = job?.state || legacyJobState;
  const jobLatitude = job?.latitude || legacyJobLatitude;
  const jobLongitude = job?.longitude || legacyJobLongitude;
  const userLat = userLocation?.lat || legacyUserLatitude || currentLocation?.lat;
  const userLng = userLocation?.lng || legacyUserLongitude || currentLocation?.lng;

  // Format address - hide street numbers if job is not accepted
  const displayAddress = isAccepted ? jobAddress : removeStreetNumbers(jobAddress);
  const fullJobAddress = [displayAddress, jobCity, jobState].filter(Boolean).join(", ");

  // Auto-fetch user location when popup opens if not provided
  useEffect(() => {
    if (open && !userLocation && !legacyUserLatitude && !currentLocation) {
      setIsGettingLocation(true);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setCurrentLocation({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            });
            setIsGettingLocation(false);
          },
          () => {
            setError(t("driveTime.couldNotGetLocation"));
            setIsGettingLocation(false);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      } else {
        setError(t("driveTime.locationServicesNotAvailable"));
        setIsGettingLocation(false);
      }
    }
  }, [open, userLocation, legacyUserLatitude, currentLocation]);

  useEffect(() => {
    if (open && userLat && userLng && jobLatitude && jobLongitude) {
      fetchDriveTime();
    }
  }, [open, userLat, userLng, jobLatitude, jobLongitude]);

  const fetchDriveTime = async () => {
    if (!userLat || !userLng || !jobLatitude || !jobLongitude) {
      setError(t("driveTime.locationNotAvailable"));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/maps/drive-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originLat: userLat,
          originLng: userLng,
          destLat: parseFloat(String(jobLatitude)),
          destLng: parseFloat(String(jobLongitude)),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setDriveTime(data);
      } else {
        const straightLineDistance = calculateStraightLineDistance(
          userLat,
          userLng,
          parseFloat(String(jobLatitude)),
          parseFloat(String(jobLongitude))
        );
        setDriveTime({
          distance: `~${straightLineDistance.toFixed(1)} miles`,
          duration: `~${Math.round(straightLineDistance * 2)} min`,
          durationValue: Math.round(straightLineDistance * 2) * 60,
        });
      }
    } catch {
      const straightLineDistance = calculateStraightLineDistance(
        userLat,
        userLng,
        parseFloat(String(jobLatitude)),
        parseFloat(String(jobLongitude))
      );
      setDriveTime({
        distance: `~${straightLineDistance.toFixed(1)} miles`,
        duration: `~${Math.round(straightLineDistance * 2)} min`,
        durationValue: Math.round(straightLineDistance * 2) * 60,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStraightLineDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const content = (
    <div className="space-y-4">
      <div className="p-4 bg-muted/50 rounded-xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t("driveTime.jobSite")}</p>
            <p className="font-medium text-sm leading-tight">{fullJobAddress || t("driveTime.addressNotAvailable")}</p>
          </div>
        </div>

        <div className="border-l-2 border-dashed border-muted-foreground/30 ml-5 h-4" />

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <Navigation className="w-5 h-5 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t("driveTime.yourLocation")}</p>
            <p className="font-medium text-sm leading-tight">
              {isGettingLocation ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t("driveTime.gettingLocation")}
                </span>
              ) : userAddress || (userLat && userLng 
                ? `${userLat.toFixed(4)}, ${userLng.toFixed(4)}` 
                : t("driveTime.locationNotAvailable"))}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 bg-gradient-to-r from-primary/5 to-primary/10 rounded-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
              <Car className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("driveTime.estimatedDrive")}</p>
              {isGettingLocation ? (
                <div className="space-y-2 mt-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ) : isLoading ? (
                <div className="space-y-2 mt-1">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ) : driveTime ? (
                <div className="flex items-center gap-3 mt-1">
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="font-bold text-lg">{driveTime.duration}</span>
                  </div>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-sm text-muted-foreground">{driveTime.distance}</span>
                </div>
              ) : error ? (
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">{t("driveTime.enableLocationToSeeDriveTime")}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {onGetDirections && (
        <Button
          className="w-full gap-2"
          onClick={onGetDirections}
          data-testid="button-get-directions"
        >
          <Navigation className="w-4 h-4" />
          {tCommon("viewMap")}
        </Button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <MobilePopup
        elevated
        open={open}
        onOpenChange={onOpenChange}
        title={t("driveTime.title")}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <button
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            data-testid="button-close-drive-time"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{tCommon("back")}</span>
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-sm">{t("driveTime.title")}</span>
        </div>
        <div className="p-4">
          {content}
        </div>
      </MobilePopup>
    );
  }

  return (
    <MobilePopup
      elevated
      open={open}
      onOpenChange={onOpenChange}
      title={t("driveTime.title")}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <button
          onClick={() => onOpenChange(false)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          data-testid="button-close-drive-time"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>{tCommon("back")}</span>
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium text-sm">{t("driveTime.title")}</span>
      </div>
      <div className="p-4">
        {content}
      </div>
    </MobilePopup>
  );
}
