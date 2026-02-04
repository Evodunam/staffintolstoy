import { useState, useEffect, useCallback } from "react";

function useHasLocation(): boolean {
  const [hasLocation, setHasLocation] = useState(false);
  useEffect(() => {
    if (!navigator.permissions?.query) {
      setHasLocation(false);
      return;
    }
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then((r) => {
      setHasLocation(r.state === "granted");
      r.onchange = () => setHasLocation(r.state === "granted");
    }).catch(() => setHasLocation(false));
  }, []);
  return hasLocation;
}
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, Loader2, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

interface ClockInPromptJob {
  id: number;
  title: string;
  location?: string;
  jobStartTime: string;
}

function formatElapsed(startIso: string): string {
  const start = new Date(startIso).getTime();
  const now = Date.now();
  let ms = Math.max(0, now - start);
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

interface ClockInPromptBannerProps {
  profileId: number | undefined;
  show: boolean;
}

export function ClockInPromptBanner({ profileId, show }: ClockInPromptBannerProps) {
  const hasLocation = useHasLocation();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [popupOpen, setPopupOpen] = useState(false);
  const [isClockingIn, setIsClockingIn] = useState(false);
  const [, setElapsedTick] = useState(0);

  const { data: jobs = [] } = useQuery<ClockInPromptJob[]>({
    queryKey: ["/api/worker/clock-in-prompt-jobs", profileId],
    queryFn: async () => {
      const res = await fetch("/api/worker/clock-in-prompt-jobs", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!profileId && show,
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (jobs.length === 0) return;
    const interval = setInterval(() => setElapsedTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [jobs.length]);

  const clockIn = useCallback(
    async (jobId: number) => {
      setIsClockingIn(true);
      try {
        let lat = 0;
        let lng = 0;
        if (navigator.geolocation) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 15000,
              maximumAge: 0,
              enableHighAccuracy: true,
            })
          );
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        }
        const response = await apiRequest("POST", "/api/timesheets/clock-in", {
          jobId,
          workerId: profileId,
          latitude: lat,
          longitude: lng,
          isAutomatic: false,
        });
        if (response.ok) {
          queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
          queryClient.invalidateQueries({ queryKey: ["/api/timesheets/active"] });
          queryClient.invalidateQueries({ queryKey: ["/api/worker/clock-in-prompt-jobs"] });
          setPopupOpen(false);
          toast({ title: t("worker.clockIn"), description: "You have been clocked in." });
        } else {
          const err = await response.json();
          if (err?.code === "OUTSIDE_GEOFENCE") {
            toast({
              title: "Too far from job site",
              description: err?.details || "You must be at the job site to clock in. Please enable location and try again when you arrive.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Clock In Failed",
              description: err?.message || "Unable to clock in.",
              variant: "destructive",
            });
          }
        }
      } catch (e: any) {
        if (e?.code === 1 || e?.message?.includes("denied")) {
          toast({
            title: "Location required",
            description: "Please enable location services to clock in at the job site.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Clock In Failed",
            description: "Could not get your location. Please enable location and try again.",
            variant: "destructive",
          });
        }
      } finally {
        setIsClockingIn(false);
      }
    },
    [profileId, queryClient, toast, t]
  );

  if (!show || !profileId || jobs.length === 0) return null;
  if (hasLocation) return null;

  const firstJob = jobs[0];
  const elapsed = formatElapsed(firstJob.jobStartTime);

  const banner = (
    <button
      type="button"
      onClick={() => setPopupOpen(true)}
      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white transition-colors z-[60]"
      data-testid="clock-in-prompt-banner"
      aria-label="Clock in for your job. Tap to select job and clock in."
    >
      <div className="flex items-center gap-2 min-w-0">
        <MapPin className="w-5 h-5 flex-shrink-0" />
        <div className="text-left min-w-0">
          <p className="font-semibold text-sm truncate">
            {jobs.length === 1 ? firstJob.title : `${jobs.length} jobs — tap to clock in`}
          </p>
          <p className="text-xs text-amber-100 truncate">
            Enable location or tap when at job site · Elapsed: {elapsed}
          </p>
        </div>
      </div>
      <ChevronDown className="w-5 h-5 flex-shrink-0 rotate-[-90deg] md:rotate-0" aria-hidden />
    </button>
  );

  return (
    <>
      <div className="fixed left-0 right-0 top-0 z-[60] shadow-md">
        {banner}
      </div>
      <div className="h-12 flex-shrink-0" aria-hidden />

      <Sheet open={popupOpen} onOpenChange={setPopupOpen}>
        <SheetContent side={isMobile ? "bottom" : "right"} className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-amber-600" />
              {t("worker.clockIn")} — at job site
            </SheetTitle>
            <SheetDescription>
              Tap a job when you arrive. Your location will be checked to confirm you are within the geofenced area.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
              Keep the app open at all times — we will auto clock you in and out of the job site for you.
            </p>
            <p className="text-xs text-muted-foreground">
              Time elapsed since shift start (H:M:S)
            </p>
            {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium">{job.title}</p>
                    {job.location && (
                      <p className="text-xs text-muted-foreground truncate">{job.location}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                      Elapsed: {formatElapsed(job.jobStartTime)}
                    </p>
                  </div>
                  <Button
                    onClick={() => clockIn(job.id)}
                    disabled={isClockingIn}
                    data-testid={`clock-in-prompt-job-${job.id}`}
                  >
                    {isClockingIn ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Clock className="w-4 h-4 mr-2" />
                    )}
                    {t("worker.clockIn")}
                  </Button>
                </div>
              ))}
            <p className="text-xs text-muted-foreground text-center mt-4">
              Must be within the job site to clock in
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
