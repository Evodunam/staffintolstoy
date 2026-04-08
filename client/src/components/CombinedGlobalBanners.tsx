/**
 * When multiple global banners apply (worker onboarding, clocked-in, clock-in prompt, business operator reminder),
 * shows a single multi-step pop-up. Worker onboarding when required is always step 1.
 * When 0 or 1 apply, renders the single banner or nothing.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Clock,
  CalendarDays,
  Loader2,
  ChevronDown,
  CheckCircle,
  Square,
  AlertTriangle,
  Send,
  ChevronLeft,
  ChevronRight,
  User,
  Info,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isWorkerOnboardingComplete } from "@/lib/worker-onboarding";
import { displayJobTitle } from "@/lib/job-display";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

// --- Clock-in prompt types and helpers (from ClockInPromptBanner) ---
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

/** Live-updating elapsed time from startIso (updates every second). */
function useElapsed(startIso: string | undefined): string {
  const [elapsed, setElapsed] = useState(() => (startIso ? formatElapsed(startIso) : "00:00:00"));
  useEffect(() => {
    if (!startIso) return;
    setElapsed(formatElapsed(startIso));
    const t = setInterval(() => setElapsed(formatElapsed(startIso)), 1000);
    return () => clearInterval(t);
  }, [startIso]);
  return elapsed;
}

// --- Active timesheet (from ClockedInGlobalBanner) ---
interface ActiveTimesheet {
  id: number;
  workerId?: number;
  jobId: number;
  clockInTime: string;
  jobTitle?: string;
  jobTrade?: string;
  jobLocation?: string;
}

// --- Business operator status ---
interface BusinessOperatorStatus {
  incomplete: boolean;
  businessOperator: { profileId: number; name: string } | null;
}

export type GlobalBannerStepId = "worker-onboarding" | "clocked-in" | "clock-in-prompt" | "business-operator";

interface ProfileLike {
  role?: string;
  [key: string]: unknown;
}

interface CombinedGlobalBannersProps {
  profileId: number | undefined;
  profile: ProfileLike | null | undefined;
  show: boolean;
  /** When true, worker is an employee (has team) so business operator step can apply */
  isEmployee?: boolean;
}

export function CombinedGlobalBanners({
  profileId,
  profile,
  show,
  isEmployee = false,
}: CombinedGlobalBannersProps) {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [popupOpen, setPopupOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [isClockingIn, setIsClockingIn] = useState(false);
  const [isClockingOut, setIsClockingOut] = useState(false);
  const [resendReminderLoading, setResendReminderLoading] = useState(false);

  const enabled = !!profileId && show;

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
    enabled,
  });

  const { data: clockInJobs = [] } = useQuery<ClockInPromptJob[]>({
    queryKey: ["/api/worker/clock-in-prompt-jobs", profileId],
    queryFn: async () => {
      const res = await fetch("/api/worker/clock-in-prompt-jobs", {
        credentials: "include",
      });
      if (res.status === 401) return [];
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled,
    refetchInterval: 60000,
  });

  const { data: businessOperatorStatus } = useQuery<BusinessOperatorStatus>({
    queryKey: ["/api/workers/me/business-operator-onboarding-status"],
    enabled: enabled && isEmployee,
  });

  const elapsedClockIn = useElapsed(activeTimesheet?.clockInTime);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      setLocationGranted(true);
      return;
    }
    let cancelled = false;
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then((r) => {
      if (!cancelled) setLocationGranted(r.state === "granted");
      r.onchange = () => { if (!cancelled) setLocationGranted(r.state === "granted"); };
    }).catch(() => { if (!cancelled) setLocationGranted(false); });
    return () => { cancelled = true; };
  }, []);
  const clockInPromptActive = clockInJobs.length > 0 && locationGranted !== true;

  const workerOnboardingRequired =
    profile?.role === "worker" && profile != null && !isWorkerOnboardingComplete(profile as Parameters<typeof isWorkerOnboardingComplete>[0]);

  // Location-related steps (clocked-in, clock-in prompt) only after onboarding is complete.
  // Only show clocked-in for the worker who is actually clocked in (not when a business operator is viewing a teammate's status).
  const steps = useMemo((): { id: GlobalBannerStepId; label: string }[] => {
    const s: { id: GlobalBannerStepId; label: string }[] = [];
    if (workerOnboardingRequired) s.push({ id: "worker-onboarding", label: "Complete your account" });
    if (!workerOnboardingRequired) {
      const isMyClockedIn = activeTimesheet && (activeTimesheet.workerId == null || activeTimesheet.workerId === profileId);
      if (isMyClockedIn) s.push({ id: "clocked-in", label: t("banners.clockedIn") });
      if (clockInPromptActive) s.push({ id: "clock-in-prompt", label: t("worker.clockIn") });
    }
    if (businessOperatorStatus?.incomplete) s.push({ id: "business-operator", label: "Business operator setup" });
    return s;
  }, [workerOnboardingRequired, activeTimesheet, profileId, clockInPromptActive, businessOperatorStatus?.incomplete, t]);

  const singleBannerStep = steps.length === 1 ? steps[0] : null;
  const multiStep = steps.length >= 2;

  const clockIn = useCallback(
    async (jobId: number) => {
      if (!profileId) return;
      setIsClockingIn(true);
      try {
        let lat = 0, lng = 0;
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
          toast({
            title: err?.code === "OUTSIDE_GEOFENCE" ? "Too far from job site" : "Clock In Failed",
            description: err?.details || err?.message || "Unable to clock in.",
            variant: "destructive",
          });
        }
      } catch (e: any) {
        toast({
          title: "Clock In Failed",
          description: e?.message?.includes("denied") ? "Please enable location services." : "Could not get location.",
          variant: "destructive",
        });
      } finally {
        setIsClockingIn(false);
      }
    },
    [profileId, queryClient, toast, t]
  );

  const clockOut = useCallback(async () => {
    if (!activeTimesheet?.id) return;
    setIsClockingOut(true);
    try {
      let lat = 0, lng = 0;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, maximumAge: 60000 })
          );
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch { /* use 0,0 */ }
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
        toast({ title: t("worker.clockOut"), description: "You have been clocked out." });
      } else {
        const err = await response.json();
        toast({ title: "Clock Out Failed", description: err?.message || "Unable to clock out.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Clock Out Failed", description: "Network error.", variant: "destructive" });
    } finally {
      setIsClockingOut(false);
    }
  }, [activeTimesheet?.id, queryClient, toast, t]);

  const resendBusinessOperatorReminder = useCallback(async () => {
    if (resendReminderLoading) return;
    setResendReminderLoading(true);
    try {
      const res = await apiRequest("POST", "/api/workers/me/resend-business-operator-onboarding-reminder");
      const data = await res.json();
      if (data.sent) {
        toast({
          title: "Reminder sent",
          description: "Your business operator has been emailed to complete their account setup.",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/workers/me/business-operator-onboarding-status"] });
      } else if (res.status === 429) {
        toast({ title: "Please wait", description: data.message ?? "You can send one reminder per 24 hours.", variant: "default" });
      } else {
        toast({ title: "Could not send", description: data.message ?? data.error ?? "Try again later.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to send reminder", variant: "destructive" });
    } finally {
      setResendReminderLoading(false);
    }
  }, [resendReminderLoading, queryClient, toast]);

  // No early return: keep same return path every render so hook count is stable (avoids "Rendered fewer hooks than expected" when steps change after query invalidation).
  const visible = !!(show && profileId && steps.length > 0);
  const currentStep = visible ? (multiStep ? steps[stepIndex] : singleBannerStep!) : (steps[0] ?? { id: "worker-onboarding" as GlobalBannerStepId, label: "" });
  const openPopup = () => setPopupOpen(true);

  const openOnboarding = useCallback(() => {
    setPopupOpen(false);
    setLocation("/worker-onboarding");
  }, [setLocation]);

  const handleBannerClick = useCallback(() => {
    if (currentStep.id === "worker-onboarding") {
      toast({
        title: "Complete your account",
        description: "Taking you to account setup.",
      });
      openOnboarding();
    } else {
      openPopup();
    }
  }, [currentStep.id, openOnboarding, toast]);

  const renderStepContent = (step: { id: GlobalBannerStepId; label: string }) => {
    if (step.id === "worker-onboarding") {
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Please complete your account setup (name, email, phone, photo, skills, rate, bank account) to use the dashboard and get paid.
          </p>
          <Button className="w-full" onClick={openOnboarding} data-testid="combined-banner-complete-account">
            Complete account setup
          </Button>
        </div>
      );
    }
    if (step.id === "clocked-in" && activeTimesheet) {
      const clockInTime = new Date(activeTimesheet.clockInTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      const jobTitle = displayJobTitle(activeTimesheet.jobTitle, activeTimesheet.jobTrade);
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/80 px-2.5 py-1 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {t("banners.clockOutAtLocation")}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/80 px-2.5 py-1 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {t("banners.forBreaks")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {jobTitle}
            {activeTimesheet.jobLocation && <span className="block text-muted-foreground text-sm mt-1">{activeTimesheet.jobLocation}</span>}
          </p>
          <p className="text-sm text-muted-foreground">{t("banners.since", { time: clockInTime })}</p>
          <p className="text-sm font-medium tabular-nums">Time elapsed: {elapsedClockIn}</p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setPopupOpen(false);
              setLocation(`/dashboard/calendar?jobId=${activeTimesheet.jobId}`);
            }}
            data-testid="clocked-in-banner-open-calendar"
          >
            <CalendarDays className="w-4 h-4 mr-2" />
            Open in calendar
          </Button>
          <Button variant="destructive" className="w-full" onClick={clockOut} disabled={isClockingOut} data-testid="clocked-in-banner-clock-out">
            {isClockingOut ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Square className="w-4 h-4 mr-2" />}
            {t("worker.clockOut")}
          </Button>
        </div>
      );
    }
    if (step.id === "clock-in-prompt" && clockInJobs.length > 0) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Tap a job when you arrive. Your location will be checked to confirm you are within the geofenced area.
          </p>
          {clockInJobs.map((job) => (
            <div key={job.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border hover:bg-muted/50">
              <div>
                <p className="font-medium">{displayJobTitle(job.title)}</p>
                {job.location && <p className="text-xs text-muted-foreground truncate">{job.location}</p>}
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">Elapsed: {formatElapsed(job.jobStartTime)}</p>
              </div>
              <Button onClick={() => clockIn(job.id)} disabled={isClockingIn} data-testid={`clock-in-prompt-job-${job.id}`}>
                {isClockingIn ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Clock className="w-4 h-4 mr-2" />}
                {t("worker.clockIn")}
              </Button>
            </div>
          ))}
        </div>
      );
    }
    if (step.id === "business-operator") {
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Your business operator hasn’t finished their account setup. Incomplete onboarding will halt future payments. You can keep working—we’ll remind them to complete it.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={resendBusinessOperatorReminder}
            disabled={resendReminderLoading}
          >
            {resendReminderLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Send reminder to business operator
          </Button>
        </div>
      );
    }
    return null;
  };

  const bannerLabel = currentStep.id === "worker-onboarding"
    ? "Complete your account"
    : currentStep.id === "clocked-in" && activeTimesheet
    ? displayJobTitle(activeTimesheet.jobTitle, activeTimesheet.jobTrade)
    : currentStep.id === "clock-in-prompt" && clockInJobs.length > 0
    ? (clockInJobs.length === 1 ? displayJobTitle(clockInJobs[0].title) : `${clockInJobs.length} jobs — tap to clock in`)
    : currentStep.label;

  const bannerBg = currentStep.id === "worker-onboarding"
    ? "bg-primary hover:bg-primary/90"
    : currentStep.id === "clocked-in"
    ? "bg-green-600 hover:bg-green-700"
    : currentStep.id === "clock-in-prompt"
    ? "bg-amber-600 hover:bg-amber-700"
    : "bg-amber-500/90 hover:bg-amber-600";
  const BannerIcon = currentStep.id === "worker-onboarding"
    ? User
    : currentStep.id === "clocked-in"
    ? CheckCircle
    : currentStep.id === "clock-in-prompt"
    ? MapPin
    : AlertTriangle;

  return (
    <>
      {visible && (
        <>
      <div className="h-12 flex-shrink-0" aria-hidden />
      <div className="fixed left-0 right-0 top-0 z-[60] shadow-md">
        <button
          type="button"
          onClick={handleBannerClick}
          className={cn("w-full flex items-center justify-between gap-3 px-4 py-2.5 text-white transition-colors z-[60]", bannerBg)}
          data-testid="combined-global-banner"
          aria-label={multiStep ? `You have ${steps.length} items to address. Tap to open.` : undefined}
        >
          <div className="flex items-center gap-2 min-w-0">
            <BannerIcon className="w-5 h-5 flex-shrink-0" />
            <div className="text-left min-w-0">
              <p className="font-semibold text-sm truncate">
                {multiStep ? `${steps.length} items to address` : bannerLabel}
              </p>
              <p className="text-xs text-white/90 truncate">
                {multiStep ? `Step ${stepIndex + 1} of ${steps.length}: ${currentStep.label}` : (currentStep.id === "clocked-in" && activeTimesheet ? `${t("banners.since", { time: new Date(activeTimesheet.clockInTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) })} · ${elapsedClockIn}` : "Tap to open")}
              </p>
            </div>
          </div>
          <ChevronDown className="w-5 h-5 flex-shrink-0 rotate-[-90deg] md:rotate-0" aria-hidden />
        </button>
      </div>

      <Dialog open={popupOpen} onOpenChange={setPopupOpen}>
        <DialogContent className="max-w-lg w-[calc(100vw-2rem)]">
          <DialogDescription className="sr-only">
            Global banner details and actions.
          </DialogDescription>
          <CombinedBannersModalContent
            multiStep={multiStep}
            stepIndex={stepIndex}
            stepsLength={steps.length}
            currentStep={currentStep}
            activeTimesheet={activeTimesheet ?? null}
            BannerIcon={BannerIcon}
            renderStepContent={renderStepContent}
            onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
            onNext={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
          />
        </DialogContent>
      </Dialog>
        </>
      )}
    </>
  );
}

/** Center-screen modal content for global banners (replaces right-side drawer). */
function CombinedBannersModalContent({
  multiStep,
  stepIndex,
  stepsLength,
  currentStep,
  activeTimesheet,
  BannerIcon,
  renderStepContent,
  onBack,
  onNext,
}: {
  multiStep: boolean;
  stepIndex: number;
  stepsLength: number;
  currentStep: { id: GlobalBannerStepId; label: string };
  activeTimesheet: ActiveTimesheet | null;
  BannerIcon: typeof User;
  renderStepContent: (step: { id: GlobalBannerStepId; label: string }) => React.ReactNode;
  onBack: () => void;
  onNext: () => void;
}) {
  const clockedInDisplayTitle =
    currentStep.id === "clocked-in" && activeTimesheet
      ? displayJobTitle(activeTimesheet.jobTitle, activeTimesheet.jobTrade)
      : currentStep.label;

  return (
    <>
      <DialogHeader>
        <DialogTitle id="combined-banners-modal-title" className="flex items-center gap-2 text-left">
          <BannerIcon className="w-5 h-5 shrink-0" />
          {multiStep ? `Step ${stepIndex + 1} of ${stepsLength}` : currentStep.label}
        </DialogTitle>
        <p className="text-sm text-muted-foreground text-left">
          {multiStep ? clockedInDisplayTitle : clockedInDisplayTitle}
        </p>
      </DialogHeader>
      <div className="mt-2">
        {renderStepContent(currentStep)}
        {multiStep && (
          <div className="flex items-center justify-between gap-2 mt-6 pt-4 border-t">
            <Button variant="outline" size="sm" onClick={onBack} disabled={stepIndex === 0}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <span className="text-sm text-muted-foreground">
              {stepIndex + 1} / {stepsLength}
            </span>
            <Button variant="outline" size="sm" onClick={onNext} disabled={stepIndex === stepsLength - 1}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
