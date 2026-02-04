import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import type { Job, Profile, Timesheet } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { useToast } from "@/hooks/use-toast";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { 
  MapPin, Clock, Star, Phone, Mail, User, Users, DollarSign, 
  Calendar, Briefcase, X, FileText, CheckCircle, AlertCircle, Navigation, Loader2, LogIn, LogOut, Apple, Video
} from "lucide-react";
import { SiGooglemaps, SiWaze } from "react-icons/si";
import { JobDetailsContent } from "@/components/JobDetailsContent";

interface JobDetailsPanelProps {
  job: Job | null;
  participants: Profile[];
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
  isCompany: boolean;
  /** When provided (company view), enables Mark as Complete flow; called with jobId and jobTitle */
  onMarkComplete?: (jobId: number, jobTitle: string) => void;
  /** When provided (company view), enables in-app call for a worker. Pass profile ID (for employees, this is the business operator). */
  onStartCallForParticipant?: (targetProfileId: number) => void;
}

interface TimesheetData {
  id: number;
  workerId: number;
  jobId: number;
  clockInTime: string;
  clockOutTime: string | null;
  status: string;
  adjustedHours: number;
  hourlyRate: number;
  workerNotes: string | null;
  workerName: string;
  workerAvatarUrl: string | null;
  workerInitials: string;
}

interface ApplicationData {
  id: number;
  status: string;
  proposedRate?: number;
  message: string | null;
  teamMemberId?: number; // When set, worker is an employee under a business operator — do not show worker phone
  manager?: { id: number; firstName: string | null; lastName: string | null }; // Business operator when employee
  worker: {
    id: number;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    rating: string | null;
    phone: string | null;
    hourlyRate?: number;
  };
}

export function JobDetailsPanel({ job, participants, isOpen, onClose, isMobile, isCompany, onMarkComplete, onStartCallForParticipant }: JobDetailsPanelProps) {
  const markupMultiplier = 1.52;
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const queryClient = useQueryClient();
  const [directionsDialogOpen, setDirectionsDialogOpen] = useState(false);
  const [clockingIn, setClockingIn] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const [locationError, setLocationError] = useState<{ title: string; description: string } | null>(null);
  
  // Location fallback: try browser geolocation first; if it fails (e.g. Chrome's network location provider returns 403),
  // try server-side IP geolocation so clock in/out still works.
  const tryIpGeolocation = async (onSuccess: (coords: { lat: number; lng: number }) => void, onError: () => void) => {
    try {
      const res = await fetch("/api/geolocation/ip", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.latitude != null && data.longitude != null) {
          onSuccess({ lat: data.latitude, lng: data.longitude });
          return;
        }
      }
    } catch {
      // ignore
    }
    setLocationError({
      title: "Location Required",
      description: "Location could not be determined. Enable device location for this site or try again."
    });
    onError();
  };

  const getLocationWithFallback = (
    onSuccess: (coords: { lat: number; lng: number }) => void,
    onError: () => void
  ) => {
    if (!navigator.geolocation) {
      setLocationError({
        title: "Location Not Available",
        description: "Your browser doesn't support location services. Please use a different browser."
      });
      onError();
      return;
    }

    const showBrowserErrorAndTryIp = () => {
      // Browser geolocation failed (can happen when Chrome's network location provider returns 403).
      // Fall back to server IP-based location so the user can still clock in/out.
      tryIpGeolocation(onSuccess, onError);
    };

    // Try high accuracy first, fall back to low accuracy, then IP geolocation
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onSuccess({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            onSuccess({ lat: position.coords.latitude, lng: position.coords.longitude });
          },
          showBrowserErrorAndTryIp,
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  };

  const { data: timesheetsData } = useQuery<TimesheetData[]>({
    queryKey: ["/api/timesheets/job", job?.id],
    queryFn: async () => {
      const res = await fetch(`/api/timesheets/job/${job!.id}`, { credentials: "include" });
      if (res.status === 403) return [];
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      return res.json();
    },
    enabled: !!job && isCompany,
  });

  const { data: applicationsData } = useQuery<ApplicationData[]>({
    queryKey: ["/api/jobs", job?.id, "applications"],
    enabled: !!job && isCompany,
  });
  
  // Worker's active timesheet for this job
  const { data: workerTimesheets } = useQuery<Timesheet[]>({
    queryKey: ["/api/worker/timesheets", job?.id],
    enabled: !!job && !isCompany && !!profile,
  });
  
  const activeTimesheet = workerTimesheets?.find(ts => ts.jobId === job?.id && !ts.clockOutTime);
  const isClockedIn = !!activeTimesheet;

  const timesheets = timesheetsData?.filter(t => t.jobId === job?.id) || [];
  const applications = applicationsData || [];
  const acceptedWorkers = applications.filter(a => a.status === "accepted");
  
  // Clock in mutation
  const clockInMutation = useMutation({
    mutationFn: async (data: { jobId: number; workerId: number; latitude?: number; longitude?: number }) => {
      return apiRequest("POST", "/api/timesheets/clock-in", data);
    },
    onSuccess: () => {
      toast({ title: "Clocked In", description: "You are now clocked in for this job." });
      queryClient.invalidateQueries({ queryKey: ["/api/worker/timesheets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chats/jobs"] });
    },
    onError: (error: any) => {
      toast({ title: "Clock In Failed", description: error.message || "Could not clock in", variant: "destructive" });
    },
    onSettled: () => {
      setClockingIn(false);
    }
  });
  
  // Clock out mutation
  const clockOutMutation = useMutation({
    mutationFn: async (data: { timesheetId: number; latitude?: number; longitude?: number }) => {
      return apiRequest("POST", "/api/timesheets/clock-out", data);
    },
    onSuccess: () => {
      toast({ title: "Clocked Out", description: "You have clocked out successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/worker/timesheets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chats/jobs"] });
    },
    onError: (error: any) => {
      toast({ title: "Clock Out Failed", description: error.message || "Could not clock out", variant: "destructive" });
    },
    onSettled: () => {
      setClockingOut(false);
    }
  });
  
  const handleClockIn = () => {
    if (!job || !profile) return;
    setClockingIn(true);
    
    getLocationWithFallback(
      (coords) => {
        clockInMutation.mutate({
          jobId: job.id,
          workerId: profile.id,
          latitude: coords.lat,
          longitude: coords.lng,
        });
      },
      () => {
        setClockingIn(false);
      }
    );
  };
  
  const handleClockOut = () => {
    if (!activeTimesheet) return;
    setClockingOut(true);
    
    // Use getLocationWithFallback - location is REQUIRED for clock out
    getLocationWithFallback(
      (coords) => {
        clockOutMutation.mutate({
          timesheetId: activeTimesheet.id,
          latitude: coords.lat,
          longitude: coords.lng,
        });
      },
      () => {
        // Location is required - block clock out if location fails
        setClockingOut(false);
        // LocationError dialog will be shown by getLocationWithFallback
      }
    );
  };
  
  // Navigation functions
  const openGoogleMaps = () => {
    if (!job) return;
    const destination = job.latitude && job.longitude
      ? `${job.latitude},${job.longitude}`
      : encodeURIComponent(`${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destination}`, "_blank");
    setDirectionsDialogOpen(false);
  };
  
  const openAppleMaps = () => {
    if (!job) return;
    const destination = job.latitude && job.longitude
      ? `${job.latitude},${job.longitude}`
      : encodeURIComponent(`${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`);
    window.open(`https://maps.apple.com/?daddr=${destination}`, "_blank");
    setDirectionsDialogOpen(false);
  };
  
  const openWaze = () => {
    if (!job) return;
    if (job.latitude && job.longitude) {
      window.open(`https://waze.com/ul?ll=${job.latitude},${job.longitude}&navigate=yes`, "_blank");
    } else {
      const address = encodeURIComponent(`${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`);
      window.open(`https://waze.com/ul?q=${address}&navigate=yes`, "_blank");
    }
    setDirectionsDialogOpen(false);
  };

  /** Convert 24h "HH:mm" to 12h display e.g. "9:00 AM", "5:00 PM" */
  const formatTime12h = (time24: string | null | undefined): string => {
    if (!time24 || typeof time24 !== "string") return "";
    const [hStr, mStr] = time24.split(":");
    const h = parseInt(hStr, 10);
    const m = mStr ? parseInt(mStr, 10) : 0;
    if (isNaN(h)) return time24;
    if (h === 0) return `12:${String(m).padStart(2, "0")} AM`;
    if (h === 12) return `12:${String(m).padStart(2, "0")} PM`;
    if (h < 12) return `${h}:${String(m).padStart(2, "0")} AM`;
    return `${h - 12}:${String(m).padStart(2, "0")} PM`;
  };

  const formatRateWithMarkup = (baseRateCents: number) => {
    const displayRate = Math.round(baseRateCents * markupMultiplier) / 100;
    return `$${displayRate.toFixed(0)}/hr`;
  };

  const hoursClocked = timesheets.reduce((sum, ts) => sum + ts.adjustedHours, 0);
  const estimatedHours = job?.estimatedHours || 8;
  const maxWorkers = job?.maxWorkersNeeded || 1;
  const hoursRemaining = Math.max(0, (estimatedHours * Math.max(1, acceptedWorkers.length)) - hoursClocked);
  
  const estimatedTotalCost = Math.round((job?.hourlyRate || 0) * markupMultiplier * estimatedHours * maxWorkers) / 100;
  const amountSpent = timesheets.filter(ts => ts.status === "approved").reduce((sum, ts) => sum + Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier), 0) / 100;
  const amountPending = timesheets.filter(ts => ts.status === "pending").reduce((sum, ts) => sum + Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier), 0) / 100;
  const pendingCount = timesheets.filter(ts => ts.status === "pending").length;
  const approvedCount = timesheets.filter(ts => ts.status === "approved").length;

  const PanelContent = () => (
    <div className="space-y-4">
      {/* Job details — cost summary + card (reference: Trip details) */}
      <section>
        <h4 className="font-semibold text-sm text-foreground mb-2">Job details</h4>
        <JobDetailsContent
        showCostSummary={isCompany}
        estimatedTotalCost={estimatedTotalCost}
        estTotalSubtext={`${estimatedHours}h × ${maxWorkers} workers`}
        amountSpent={amountSpent}
        approvedCount={approvedCount}
        amountPending={amountPending}
        pendingCount={pendingCount}
        hoursClocked={hoursClocked}
        hoursRemaining={hoursRemaining}
        addressLine={[job?.address, job?.city, job?.state].filter(Boolean).join(", ") || ""}
        trade={job?.trade ?? ""}
        rateDisplay={
          acceptedWorkers.length > 0
            ? (() => {
                const rates = acceptedWorkers.map((a: any) => (a.proposedRate ?? a.worker?.hourlyRate ?? job?.hourlyRate) ?? 0).filter((r: number) => r > 0);
                const avg = rates.length ? Math.round(rates.reduce((s: number, r: number) => s + r, 0) / rates.length) : (job?.hourlyRate || 0);
                return formatRateWithMarkup(avg);
              })()
            : formatRateWithMarkup(job?.hourlyRate || 0)
        }
        estimatedHoursDisplay={`${estimatedHours}h`}
        workersDisplay={`${acceptedWorkers.length}/${maxWorkers}`}
        jobTypeDisplay={job?.jobType ? job.jobType.replace(/_/g, " ") : undefined}
        timeDisplay={
          job?.scheduledTime && job?.endTime
            ? `${formatTime12h(job.scheduledTime)} – ${formatTime12h(job.endTime)}`
            : job?.scheduledTime
              ? formatTime12h(job.scheduledTime)
              : job?.endTime
                ? formatTime12h(job.endTime)
                : undefined
        }
        startDateDisplay={job?.startDate ? format(new Date(job.startDate), "MMM d, yyyy") : undefined}
        endDateDisplay={job?.endDate ? format(new Date(job.endDate), "MMM d, yyyy") : undefined}
        recurringDaysDisplay={
          job?.jobType === "recurring" && job?.scheduleDays && Array.isArray(job.scheduleDays) && job.scheduleDays.length > 0
            ? job.scheduleDays.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(", ")
            : undefined
        }
        description={job?.description ?? undefined}
      />
        {!isCompany && job && (
          <button
            type="button"
            onClick={() => setDirectionsDialogOpen(true)}
            className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
            data-testid="link-get-directions"
          >
            Get directions &rarr;
          </button>
        )}
      </section>

      {/* In this conversation — workers/participants list (reference: In this conversation) */}
      <section>
        <h4 className="font-semibold text-sm text-foreground mb-2">In this conversation</h4>
        {isCompany ? (
          acceptedWorkers.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No workers assigned yet</p>
          ) : (
            <div className="space-y-1">
              {acceptedWorkers.map(app => {
                const workerTimesheets = timesheets.filter(ts => ts.workerId === app.worker.id);
                const workerHours = workerTimesheets.reduce((sum, ts) => sum + ts.adjustedHours, 0);
                const workerEarnings = workerTimesheets.reduce((sum, ts) => sum + Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier), 0) / 100;
                const isEmployee = !!(app as ApplicationData).teamMemberId;
                const showPhone = app.worker.phone && !isEmployee && !onStartCallForParticipant;
                // For employees: call business operator (manager). For direct workers: call the worker.
                const targetProfileId = isEmployee && (app as ApplicationData).manager
                  ? (app as ApplicationData).manager!.id
                  : app.worker.id;
                return (
                  <div key={app.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <Avatar className="w-9 h-9 flex-shrink-0">
                      <AvatarImage src={app.worker.avatarUrl || undefined} />
                      <AvatarFallback className="text-xs">{app.worker.firstName[0]}{app.worker.lastName[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{app.worker.firstName} {app.worker.lastName}</p>
                      <p className="text-xs text-muted-foreground">
                        Worker {app.worker.rating ? ` · ${app.worker.rating} ★` : ""} · {formatRateWithMarkup(app.proposedRate)} · {workerHours.toFixed(1)}h · ${workerEarnings.toFixed(0)}
                      </p>
                    </div>
                    {onStartCallForParticipant ? (
                      <button
                        type="button"
                        onClick={() => onStartCallForParticipant(targetProfileId)}
                        className="p-2 rounded-full text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
                        data-testid={`link-call-worker-${app.worker.id}`}
                        title={isEmployee ? "Video call business operator" : "Video call worker"}
                        aria-label={isEmployee ? "Video call business operator" : "Video call worker"}
                      >
                        <Video className="w-4 h-4" />
                      </button>
                    ) : showPhone ? (
                      <a
                        href={`tel:${app.worker.phone}`}
                        className="p-2 rounded-full text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
                        data-testid={`link-call-worker-${app.worker.id}`}
                        title={app.worker.phone ?? undefined}
                      >
                        <Phone className="w-4 h-4" />
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : participants.length > 0 ? (
          <div className="space-y-1">
            {participants.map(p => {
              const isWorkerEmployee = p.role === "worker" && (p as Profile).teamId != null;
              const showPhone = !!p.phone && !isWorkerEmployee && !onStartCallForParticipant;
              return (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                  <Avatar className="w-9 h-9 flex-shrink-0">
                    <AvatarImage src={p.avatarUrl || undefined} />
                    <AvatarFallback className="text-xs">{p.firstName?.[0]}{p.lastName?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.companyName || `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()}</p>
                    <p className="text-xs text-muted-foreground capitalize">{p.role === "company" ? "Company" : "Worker"}</p>
                  </div>
                  {onStartCallForParticipant ? (
                    <button
                      type="button"
                      onClick={() => onStartCallForParticipant(p.id)}
                      className="p-2 rounded-full text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
                      data-testid={`link-call-participant-${p.id}`}
                      title="Video call"
                      aria-label="Video call"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  ) : showPhone ? (
                    <a
                      href={`tel:${p.phone}`}
                      className="p-2 rounded-full text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
                      data-testid={`link-call-participant-${p.id}`}
                      title={p.phone ?? undefined}
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">No participants</p>
        )}
      </section>

      {/* Job actions — Directions, Clock In/Out (reference: Conversation actions) */}
      {!isCompany && (
        <section>
          <h4 className="font-semibold text-sm text-foreground mb-2">Job actions</h4>
          <div className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setDirectionsDialogOpen(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors"
              data-testid="button-get-directions"
            >
              <Navigation className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              Get directions
            </button>
            {isClockedIn ? (
              <button
                type="button"
                onClick={handleClockOut}
                disabled={clockingOut}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                data-testid="button-clock-out"
              >
                {clockingOut ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /> : <LogOut className="w-4 h-4 flex-shrink-0" />}
                Clock out
              </button>
            ) : (
              <button
                type="button"
                onClick={handleClockIn}
                disabled={clockingIn}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors disabled:opacity-50"
                data-testid="button-clock-in"
              >
                {clockingIn ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /> : <LogIn className="w-4 h-4 flex-shrink-0" />}
                Clock in
              </button>
            )}
          </div>
        </section>
      )}

      {/* Timesheets (company only) */}
      {isCompany && timesheets.length > 0 && (
        <section>
          <h4 className="font-semibold text-sm text-foreground mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            Timesheets ({timesheets.length})
          </h4>
          <div className="space-y-1 rounded-lg border border-border overflow-hidden">
            {timesheets.map(ts => (
              <div key={ts.id} className="flex items-center justify-between px-3 py-2 bg-muted/30 text-xs hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="w-6 h-6 flex-shrink-0">
                    <AvatarImage src={ts.workerAvatarUrl || undefined} />
                    <AvatarFallback className="text-[8px]">{ts.workerInitials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{ts.workerName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(ts.clockInTime), "MMM d")} · {ts.adjustedHours.toFixed(1)}h
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-medium">${(Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier) / 100).toFixed(2)}</p>
                  <Badge
                    variant={ts.status === "approved" ? "default" : ts.status === "pending" ? "secondary" : "outline"}
                    className="text-[8px] px-1 py-0"
                  >
                    {ts.status === "approved" && <CheckCircle className="w-2 h-2 mr-0.5" />}
                    {ts.status === "pending" && <AlertCircle className="w-2 h-2 mr-0.5" />}
                    {ts.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  if (!job) return null;

  const isJobFilled = acceptedWorkers.length >= maxWorkers;
  const hasPendingTimesheets = pendingCount > 0;
  const canMarkComplete = isCompany && onMarkComplete && isJobFilled && !hasPendingTimesheets && (job.status === "open" || job.status === "in_progress");

  // Directions dialog component
  const DirectionsDialog = () => (
    <Dialog open={directionsDialogOpen} onOpenChange={setDirectionsDialogOpen}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Get Directions</DialogTitle>
          <DialogDescription>Choose your preferred navigation app</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-3"
            onClick={openGoogleMaps}
            data-testid="button-google-maps"
          >
            <SiGooglemaps className="w-5 h-5 text-blue-600" />
            Google Maps
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3"
            onClick={openAppleMaps}
            data-testid="button-apple-maps"
          >
            <Apple className="w-5 h-5 text-gray-800 dark:text-gray-200" />
            Apple Maps
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3"
            onClick={openWaze}
            data-testid="button-waze"
          >
            <SiWaze className="w-5 h-5 text-cyan-500" />
            Waze
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
  
  // Location error dialog
  const LocationErrorDialogComponent = () => (
    <Dialog open={!!locationError} onOpenChange={(open) => !open && setLocationError(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{locationError?.title}</DialogTitle>
          <DialogDescription>{locationError?.description}</DialogDescription>
        </DialogHeader>
        <Button onClick={() => setLocationError(null)} data-testid="button-close-location-error">
          OK
        </Button>
      </DialogContent>
    </Dialog>
  );

  if (isMobile) {
    // Allow click when job is in a completable state (open/in_progress) and filled; if pending timesheets, dashboard will show approval pop-up
    const mobileCanTapMarkComplete = isCompany && onMarkComplete && isJobFilled && (job.status === "open" || job.status === "in_progress");
    return (
      <>
        <ResponsiveDialog
          open={isOpen}
          onOpenChange={(open) => !open && onClose()}
          title={
            <div className="flex items-center gap-2 pr-2">
              <span className="truncate">{job.title}</span>
              <Badge variant={((job.status === "open" || job.status === "in_progress") && ((job as any).workersHired > 0 || (job as any).applications?.some((a: any) => a.status === "accepted"))) ? "secondary" : job.status === "open" ? "default" : job.status === "in_progress" ? "secondary" : "outline"} className="flex-shrink-0">
                {((job.status === "open" || job.status === "in_progress") && ((job as any).workersHired > 0 || (job as any).applications?.some((a: any) => a.status === "accepted"))) ? "In Progress" : job.status === "in_progress" ? "In Progress" : (job.status === "open" ? "Open" : job.status.charAt(0).toUpperCase() + job.status.slice(1))}
              </Badge>
            </div>
          }
          description={`${job.city}, ${job.state}`}
          primaryAction={isCompany && onMarkComplete ? {
            label: "Mark as Complete",
            onClick: () => job && onMarkComplete(job.id, job.title),
            disabled: !mobileCanTapMarkComplete,
            icon: <CheckCircle className="w-4 h-4 mr-2" />,
            testId: "button-mark-complete-job-details-mobile",
          } : undefined}
        >
          <PanelContent />
        </ResponsiveDialog>
        <DirectionsDialog />
        <LocationErrorDialogComponent />
      </>
    );
  }

  if (!isOpen) return null;

  return (
    <>
      <div className="w-80 border-l border-border flex flex-col bg-background">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{job.title}</h3>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5" />
              {job.city}, {job.state}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-job-details">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0 p-3">
          <PanelContent />
        </ScrollArea>
        {isCompany && onMarkComplete && (
          <div className="flex-shrink-0 border-t border-border p-3 bg-background">
            <Button
              className="w-full bg-gradient-to-r from-[#00A86B] to-[#008A57] hover:from-[#008A57] hover:to-[#006B44] text-white border-0"
              onClick={() => job && onMarkComplete(job.id, job.title)}
              disabled={!canMarkComplete}
              data-testid="button-mark-complete-job-details"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Mark as Complete
            </Button>
            {!canMarkComplete && isJobFilled && hasPendingTimesheets && (
              <p className="text-[10px] text-muted-foreground mt-2 text-center">Approve or reject pending timesheets first</p>
            )}
          </div>
        )}
      </div>
      <DirectionsDialog />
      <LocationErrorDialogComponent />
    </>
  );
}
