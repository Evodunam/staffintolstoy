import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { CheckCircle, ChevronDown, Clock, Loader2, Square } from "lucide-react";
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

interface ActiveTimesheet {
  id: number;
  jobId: number;
  clockInTime: string;
  jobTitle?: string;
  jobLocation?: string;
}

interface ClockedInGlobalBannerProps {
  profileId: number | undefined;
  /** Only show when on worker dashboard routes */
  show: boolean;
}

export function ClockedInGlobalBanner({ profileId, show }: ClockedInGlobalBannerProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [popupOpen, setPopupOpen] = useState(false);
  const [isClockingOut, setIsClockingOut] = useState(false);

  const { data: activeTimesheet } = useQuery<ActiveTimesheet | null>({
    queryKey: ["/api/timesheets/active", profileId],
    queryFn: async () => {
      if (!profileId) return null;
      const res = await fetch(`/api/timesheets/active/${profileId}`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.clockOutTime ? null : data;
    },
    enabled: !!profileId && show,
  });

  const clockOut = useCallback(async () => {
    if (!activeTimesheet?.id) return;
    setIsClockingOut(true);
    try {
      let lat = 0;
      let lng = 0;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 10000,
              maximumAge: 60000,
            })
          );
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch {
          // Use 0,0 if geolocation fails
        }
      }
      const response = await apiRequest("POST", "/api/timesheets/clock-out", {
        timesheetId: activeTimesheet.id,
        latitude: lat,
        longitude: lng,
        isAutomatic: false,
      });
      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
        queryClient.invalidateQueries({ queryKey: ["/api/timesheets/active"] });
        setPopupOpen(false);
        toast({
          title: t("worker.clockOut"),
          description: "You have been clocked out.",
        });
      } else {
        const err = await response.json();
        toast({
          title: "Clock Out Failed",
          description: err?.message || "Unable to clock out.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Clock Out Failed",
        description: "Network error. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsClockingOut(false);
    }
  }, [activeTimesheet?.id, queryClient, toast, t]);

  if (!show || !profileId || !activeTimesheet) return null;

  const clockInTime = new Date(activeTimesheet.clockInTime).toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit" }
  );
  const jobTitle = activeTimesheet.jobTitle || "Job";

  const banner = (
    <button
      type="button"
      onClick={() => setPopupOpen(true)}
      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white transition-colors z-[60]"
      data-testid="clocked-in-global-banner"
      aria-label="You are clocked in. Tap to open clock out options."
    >
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle className="w-5 h-5 flex-shrink-0" />
        <div className="text-left min-w-0">
          <p className="font-semibold text-sm truncate">{jobTitle}</p>
          <p className="text-xs text-green-100 truncate">
            {t("banners.clockedIn")} · {t("banners.since", { time: clockInTime })}
          </p>
        </div>
      </div>
      <ChevronDown className="w-5 h-5 flex-shrink-0 rotate-[-90deg] md:rotate-0" aria-hidden />
    </button>
  );

  return (
    <>
      {/* Spacer so fixed banner doesn't overlap header */}
      <div className="h-12 flex-shrink-0" aria-hidden />
      {/* Fixed at top - above header on mobile, above footer area on desktop */}
      <div className="fixed left-0 right-0 top-0 z-[60] shadow-md">
        {banner}
      </div>

      <Sheet open={popupOpen} onOpenChange={setPopupOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className="rounded-t-2xl"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              {t("banners.clockedIn")}
            </SheetTitle>
            <SheetDescription>
              {jobTitle}
              {activeTimesheet.jobLocation && (
                <span className="block text-muted-foreground text-sm mt-1">
                  {activeTimesheet.jobLocation}
                </span>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("banners.since", { time: clockInTime })}
            </p>
            <Button
              variant="destructive"
              className="w-full"
              onClick={clockOut}
              disabled={isClockingOut}
              data-testid="clocked-in-banner-clock-out"
            >
              {isClockingOut ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Square className="w-4 h-4 mr-2" />
              )}
              {t("worker.clockOut")}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Tap when you leave the site for accurate hours
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
