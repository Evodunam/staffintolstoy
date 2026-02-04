import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, parseISO, isToday, isTomorrow, isThisWeek, isThisMonth, startOfDay, addHours, differenceInMinutes, differenceInDays, isBefore, isAfter, startOfToday, startOfWeek, endOfWeek, endOfMonth, addDays } from "date-fns";
import { ArrowLeft, Clock, MapPin, Navigation as NavigationIcon, MessageSquare, Play, Square, Loader2, Calendar, ChevronRight, ChevronLeft, User, Users, UserPlus, AlertCircle, CheckCircle2, Car, Search, Briefcase, Menu, Bell, Repeat, Zap, CalendarDays, Building2, Image as ImageIcon, DollarSign, Star, RefreshCw, LogOut } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { TeammateSettingsDialog } from "@/components/TeammateSettingsDialog";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MiniJobMap } from "@/components/JobsMap";
import type { Profile, Job, Application, Timesheet } from "@shared/schema";
import { useTranslation } from "react-i18next";

type TimeFrame = "today" | "week" | "month";

interface JobAssignment {
  application: Application & { 
    job: Job;
    teamMember?: { id: number; firstName: string; lastName: string; avatarUrl?: string | null } | null;
  };
  activeTimesheet?: Timesheet | null;
  distanceFromJob?: number | null;
  isWithinGeofence?: boolean;
}

export default function TodayPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { user, logout, isLoggingOut } = useAuth();
  const { t } = useTranslation("today");
  const { t: tNav } = useTranslation("translation");
  const { t: tNotifications } = useTranslation("notifications");
  const { t: tEmpty } = useTranslation("empty");
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("today");
  const [selectedJob, setSelectedJob] = useState<JobAssignment | null>(null);
  const [clockingJobId, setClockingJobId] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [geofenceError, setGeofenceError] = useState<{
    job: Job;
    distanceMiles: string;
    requiredRadiusMiles: number;
    userLat?: number;
    userLng?: number;
  } | null>(null);
  const [estimatedDriveTime, setEstimatedDriveTime] = useState<string | null>(null);
  const [autoClockEnabled, setAutoClockEnabled] = useState(true);
  const [watcherId, setWatcherId] = useState<number | null>(null);
  const [autoClockingJobId, setAutoClockingJobId] = useState<number | null>(null);
  const [lastAutoClockAction, setLastAutoClockAction] = useState<{ jobId: number; action: "in" | "out"; time: number } | null>(null);
  const [directionsJob, setDirectionsJob] = useState<Job | null>(null);
  const [jobDriveTimes, setJobDriveTimes] = useState<Record<number, string>>({});
  const [scheduleInfoJob, setScheduleInfoJob] = useState<Job | null>(null);
  const [scheduleInfoReturnTo, setScheduleInfoReturnTo] = useState<JobAssignment | null>(null);
  const [geofenceErrorReturnTo, setGeofenceErrorReturnTo] = useState<JobAssignment | null>(null);
  const [directionsReturnTo, setDirectionsReturnTo] = useState<JobAssignment | null>(null);
  const [reassignDialogJob, setReassignDialogJob] = useState<JobAssignment | null>(null);
  const [reassignDialogReturnTo, setReassignDialogReturnTo] = useState<JobAssignment | null>(null);
  const [futureJobDialog, setFutureJobDialog] = useState<Job | null>(null);
  const [locationError, setLocationError] = useState<{
    type: "permission" | "unavailable" | "timeout" | "unsupported";
    message: string;
  } | null>(null);
  const [showClockOutSheet, setShowClockOutSheet] = useState(false);
  const [clockedInDuration, setClockedInDuration] = useState<string>("");

  // Detect user device type for location troubleshooting
  const detectDevice = (): "ios" | "android" | "browser" => {
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (/android/.test(ua)) return "android";
    return "browser";
  };

  // Get location with fallbacks: high accuracy -> low accuracy -> error
  const getLocationWithFallback = (
    onSuccess: (coords: { lat: number; lng: number }) => void,
    onError: () => void
  ) => {
      if (!navigator.geolocation) {
      setLocationError({
        type: "unsupported",
        message: t("locationServicesNotAvailable")
      });
      onError();
      return;
    }

    // First try: High accuracy with shorter timeout
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onSuccess({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      (error1) => {
        console.log("High accuracy location failed, trying fallback...", error1.message);
        
        // Second try: Lower accuracy with longer timeout
        navigator.geolocation.getCurrentPosition(
          (position) => {
            onSuccess({ lat: position.coords.latitude, lng: position.coords.longitude });
          },
          (error2) => {
            console.log("Fallback location also failed", error2.message);
            
            // Determine the error type for device-specific guidance
            if (error2.code === error2.PERMISSION_DENIED) {
              setLocationError({
                type: "permission",
                message: t("locationAccessDenied")
              });
            } else if (error2.code === error2.POSITION_UNAVAILABLE) {
              setLocationError({
                type: "unavailable",
                message: t("unableToDetermineLocation")
              });
            } else if (error2.code === error2.TIMEOUT) {
              setLocationError({
                type: "timeout",
                message: t("locationRequestTimedOut")
              });
            } else {
              setLocationError({
                type: "unavailable",
                message: t("unableToGetLocation")
              });
            }
            onError();
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  // Reset media state when selected job changes
  useEffect(() => {
    setCurrentMediaIndex(0);
    setMediaLoaded(false);
  }, [selectedJob?.application.job.id]);

  const { data: profile } = useProfile(user?.id);

  // Check if user is an employee (part of another business operator's team)
  const isEmployee = Boolean(profile?.teamId) || Boolean(user?.impersonation?.isEmployee);

  const { data: assignments = [], isLoading } = useQuery<JobAssignment[]>({
    queryKey: ["/api/today/assignments"],
    queryFn: async () => {
      const res = await fetch("/api/today/assignments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch assignments");
      return res.json();
    },
    enabled: !!profile,
  });

  const { data: activeTimesheet } = useQuery<Timesheet | null>({
    queryKey: ["/api/timesheets/active", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      try {
        // Use the logged-in user's profile ID for checking active timesheets
        const res = await fetch(`/api/timesheets/active/${profile.id}`, { credentials: "include" });
        if (res.status === 404) return null;
        if (!res.ok) {
          // Silently handle 403 errors - they're expected when checking other workers' timesheets
          if (res.status === 403) return null;
          throw new Error("Failed to fetch active timesheet");
        }
        return res.json();
      } catch {
        return null;
      }
    },
    enabled: !!profile?.id,
    refetchInterval: 60000, // Reduced from 30s to 60s - less frequent polling
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  // Fetch notifications for header
  const { data: allNotifications } = useQuery<any[]>({
    queryKey: ['/api/notifications', profile?.id],
    enabled: !!profile?.id,
  });

  // Filter notifications for team members - only show notifications for this specific team member
  // The API already filters by profileId, so this should be correct, but we ensure it's filtered
  const notifications = useMemo(() => {
    if (!allNotifications) return [];
    // For employees, the API should already filter by their profileId
    // But we ensure we're only showing notifications for the current profile
    return allNotifications.filter((notif: any) => {
      // If user is an employee, ensure notification belongs to them
      if (isEmployee) {
        return notif.profileId === profile?.id;
      }
      return true;
    });
  }, [allNotifications, isEmployee, profile?.id]);

  // Fetch company profile for selected job
  const { data: companyProfile } = useQuery<Profile>({
    queryKey: ['/api/profiles', selectedJob?.application.job.companyId],
    queryFn: async () => {
      if (!selectedJob?.application.job.companyId) return null;
      const res = await fetch(`/api/profiles/${selectedJob.application.job.companyId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedJob?.application.job.companyId,
  });
  
  // Extended timesheet type with worker info
  type TimesheetWithWorker = Timesheet & {
    workerFirstName?: string | null;
    workerLastName?: string | null;
    workerAvatarUrl?: string | null;
    workerPhone?: string | null;
  };
  
  // Fetch all timesheets for the selected job
  const { data: jobTimesheets = [] } = useQuery<TimesheetWithWorker[]>({
    queryKey: ['/api/timesheets/job', selectedJob?.application.job.id],
    queryFn: async () => {
      if (!selectedJob?.application.job.id) return [];
      const res = await fetch(`/api/timesheets/job/${selectedJob.application.job.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedJob?.application.job.id,
  });
  
  // Fetch company profiles for all jobs in the assignments list (for cards display)
  const companyIds = useMemo(() => {
    const ids = new Set<number>();
    assignments.forEach(a => {
      if (a.application.job.companyId) {
        ids.add(a.application.job.companyId);
      }
    });
    return Array.from(ids);
  }, [assignments]);
  
  const { data: companyProfiles = {} } = useQuery<Record<number, Profile>>({
    queryKey: ['/api/profiles/batch', companyIds],
    queryFn: async () => {
      if (companyIds.length === 0) return {};
      const results: Record<number, Profile> = {};
      await Promise.all(
        companyIds.map(async (id) => {
          try {
            const res = await fetch(`/api/profiles/${id}`, { credentials: "include" });
            if (res.ok) {
              results[id] = await res.json();
            }
          } catch {
            // Ignore failed fetches
          }
        })
      );
      return results;
    },
    enabled: companyIds.length > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch worker team info (for business operators to reassign workers)
  interface WorkerTeamMember {
    id: number;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    status: string;
    hourlyRate: number;
  }
  
  const { data: workerTeam } = useQuery<{ id: number; name: string } | null>({
    queryKey: ["/api/worker-team"],
    enabled: !!profile && !isEmployee,
  });

  const { data: teamMembers = [] } = useQuery<WorkerTeamMember[]>({
    queryKey: ["/api/worker-team", workerTeam?.id, "members"],
    enabled: !!workerTeam?.id,
    queryFn: async () => {
      if (!workerTeam?.id) return [];
      const res = await fetch(`/api/worker-team/${workerTeam.id}/members`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const activeTeamMembers = teamMembers.filter(m => m.status === "active");

  // Check if the current user is assigned to this job (can clock in themselves)
  // Server-side: employees only receive jobs they're assigned to, admins see all jobs
  // Client-side: we enforce that admins can only clock in to jobs they're personally assigned to
  const canUserClockIn = (assignment: JobAssignment): boolean => {
    const appTeamMemberId = assignment.application.teamMemberId;
    
    // If user is impersonating an employee, check exact match
    if (impersonatedTeamMemberId) {
      return appTeamMemberId === impersonatedTeamMemberId;
    }
    
    // If user is a direct employee (profile.teamId is set), server already filters their assignments
    // They can clock in to any job they see (server guarantees it's theirs)
    if (profile?.teamId) {
      return true;
    }
    
    // For business operators (admins) and independent workers (no teamId):
    // If job has no team member assigned (teamMemberId is null), the user is assigned
    // If job has a team member assigned, the admin cannot clock in for them
    return !appTeamMemberId;
  };

  // Mutation to reassign team member
  const reassignTeamMemberMutation = useMutation({
    mutationFn: async ({ applicationId, teamMemberId }: { applicationId: number; teamMemberId: number | null }) => {
      const res = await fetch(`/api/applications/${applicationId}/team-member`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ teamMemberId }),
      });
      if (!res.ok) throw new Error("Failed to reassign worker");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/today/assignments"] });
      toast({ title: t("workerReassigned"), description: t("jobReassignedSuccessfully") });
      // Restore parent dialog if we came from one (breadcrumb behavior)
      if (reassignDialogReturnTo) {
        setSelectedJob(reassignDialogReturnTo);
        setReassignDialogReturnTo(null);
      }
      setReassignDialogJob(null);
    },
    onError: (err: any) => {
      toast({ title: t("error"), description: err.message || t("couldNotReassignWorker"), variant: "destructive" });
    },
  });

  // Display name and avatar (for impersonation support)
  const displayAvatarUrl = user?.impersonation?.teamMember?.avatarUrl || profile?.avatarUrl;
  const displayName = {
    firstName: user?.impersonation?.teamMember?.firstName || profile?.firstName,
    lastName: user?.impersonation?.teamMember?.lastName || profile?.lastName,
  };

  // Helper to filter assignments by time frame
  // "today" includes: jobs with startDate <= today (in-progress), jobs starting today, or no start date
  // "week" includes: jobs with startDate <= end of this week
  // "month" includes: jobs with startDate <= end of this month
  const filterByTimeFrame = (a: JobAssignment, frame: TimeFrame) => {
    const job = a.application.job;
    // Jobs without start date always show in "today" view (on-demand ready to work)
    if (!job.startDate) return frame === "today";
    
    const startDate = new Date(job.startDate);
    const today = startOfToday();
    
    switch (frame) {
      case "today":
        // Show jobs that are in-progress (started before today) OR starting today
        return isBefore(startDate, today) || isToday(startDate);
      case "week":
        // Show jobs starting within this week or already in progress
        return isBefore(startDate, endOfWeek(today, { weekStartsOn: 0 })) || isThisWeek(startDate, { weekStartsOn: 0 });
      case "month":
        // Show jobs starting within this month or already in progress
        return isBefore(startDate, endOfMonth(today)) || isThisMonth(startDate);
      default:
        return true;
    }
  };

  // Smart filtering: Employees only see jobs assigned to them, admin sees all
  // For employees, check if the job's teamMemberId matches their team member ID
  const impersonatedTeamMemberId = user?.impersonation?.teamMemberId;
  
  const filterByRole = (a: JobAssignment): boolean => {
    // Admins (business operators) see all jobs
    if (!isEmployee) return true;
    
    // Employees only see jobs assigned specifically to them
    // If impersonating, check if the application's teamMemberId matches the impersonated team member
    if (impersonatedTeamMemberId) {
      return a.application.teamMemberId === impersonatedTeamMemberId;
    }
    
    // If the employee has a teamId (direct employee), check if application has no teamMemberId
    // (meaning they applied directly) OR matches their employee record
    if (profile?.teamId) {
      // Find matching team member assignment - employees see jobs where they're the team member
      return a.application.teamMemberId !== null && a.application.teamMemberId !== undefined;
    }
    
    return true;
  };

  // Counts for each tab (computed from filtered assignments by role)
  const roleFilteredAssignments = useMemo(() => 
    assignments.filter(filterByRole), 
    [assignments, isEmployee, impersonatedTeamMemberId, profile?.teamId]
  );
  
  const todayCount = useMemo(() => roleFilteredAssignments.filter(a => filterByTimeFrame(a, "today")).length, [roleFilteredAssignments]);
  const weekCount = useMemo(() => roleFilteredAssignments.filter(a => filterByTimeFrame(a, "week")).length, [roleFilteredAssignments]);
  const monthCount = useMemo(() => roleFilteredAssignments.filter(a => filterByTimeFrame(a, "month")).length, [roleFilteredAssignments]);

  // Find the currently clocked-in assignment
  const clockedInAssignment = useMemo(() => {
    return roleFilteredAssignments.find(a => 
      a.activeTimesheet && !a.activeTimesheet.clockOutTime
    ) || null;
  }, [roleFilteredAssignments]);

  // Live duration timer for clocked-in jobs
  useEffect(() => {
    if (!clockedInAssignment?.activeTimesheet?.clockInTime) {
      setClockedInDuration("");
      return;
    }

    const updateDuration = () => {
      const clockInTime = new Date(clockedInAssignment.activeTimesheet!.clockInTime);
      const now = new Date();
      const diffMs = now.getTime() - clockInTime.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
      
      if (hours > 0) {
        setClockedInDuration(`${hours}h ${minutes}m ${seconds}s`);
      } else if (minutes > 0) {
        setClockedInDuration(`${minutes}m ${seconds}s`);
      } else {
        setClockedInDuration(`${seconds}s`);
      }
    };

    updateDuration();
    const interval = setInterval(updateDuration, 1000);
    return () => clearInterval(interval);
  }, [clockedInAssignment?.activeTimesheet?.clockInTime]);

  const filteredAssignments = useMemo(() => {
    if (!roleFilteredAssignments.length) return [];
    
    return roleFilteredAssignments.filter(a => filterByTimeFrame(a, timeFrame)).sort((a, b) => {
      const dateA = a.application.job.startDate ? new Date(a.application.job.startDate) : new Date();
      const dateB = b.application.job.startDate ? new Date(b.application.job.startDate) : new Date();
      return dateA.getTime() - dateB.getTime();
    });
  }, [roleFilteredAssignments, timeFrame]);

  const clockInMutation = useMutation({
    mutationFn: async ({ jobId, workerId, latitude, longitude, isAutomatic }: { jobId: number; workerId: number; latitude?: number; longitude?: number; isAutomatic?: boolean }) => {
      const res = await fetch("/api/timesheets/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jobId, workerId, latitude, longitude, isAutomatic }),
      });
      if (!res.ok) {
        const data = await res.json();
        // Attach extra data for geofence errors
        const error: any = new Error(data.message || "Failed to clock in");
        error.code = data.code;
        error.distanceMiles = data.distanceMiles;
        error.requiredRadiusMiles = data.requiredRadiusMiles;
        error.jobId = jobId;
        error.userLat = latitude;
        error.userLng = longitude;
        throw error;
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/today/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/worker/clock-in-prompt-jobs"] });
      if (!variables.isAutomatic) {
        toast({ title: t("clockedIn"), description: t("clockedInSuccessfully") });
      } else {
        toast({ title: t("autoClockedIn"), description: t("autoClockedInDescription") });
      }
      setClockingJobId(null);
      setSelectedJob(null);
    },
    onError: (err: any, variables) => {
      setClockingJobId(null);
      
      // Handle location required error
      if (err.code === "LOCATION_REQUIRED") {
        toast({ 
          title: t("locationRequired"), 
          description: t("locationRequiredDescription"),
          variant: "destructive" 
        });
        return;
      }
      
      // Handle job location missing error
      if (err.code === "JOB_LOCATION_MISSING") {
        toast({ 
          title: t("jobLocationError"), 
          description: t("jobLocationErrorDescription"),
          variant: "destructive" 
        });
        return;
      }
      
      // Handle geofence error with dialog
      if (err.code === "OUTSIDE_GEOFENCE") {
        const assignment = assignments.find(a => a.application.job.id === err.jobId);
        const job = assignment?.application.job;
        if (job) {
          // Close parent dialog and store return target (breadcrumb flow)
          if (selectedJob) {
            setGeofenceErrorReturnTo(selectedJob);
            setSelectedJob(null);
          }
          setGeofenceError({
            job,
            distanceMiles: err.distanceMiles,
            requiredRadiusMiles: err.requiredRadiusMiles,
            userLat: err.userLat,
            userLng: err.userLng,
          });
          // Estimate drive time (rough calculation: 30 mph average)
          const distMiles = parseFloat(err.distanceMiles);
          if (!isNaN(distMiles)) {
            const minutes = Math.ceil(distMiles * 2); // ~30 mph = 2 min per mile
            setEstimatedDriveTime(`~${minutes} min`);
          }
          return;
        }
      }
      
      // Default toast for other errors
      toast({ 
        title: t("clockInFailed"), 
        description: err.message || t("couldNotClockIn"),
        variant: "destructive" 
      });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async ({ timesheetId, latitude, longitude, isAutomatic }: { timesheetId: number; latitude?: number; longitude?: number; isAutomatic?: boolean }) => {
      const res = await fetch("/api/timesheets/clock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ timesheetId, latitude, longitude, isAutomatic }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to clock out");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/today/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/worker/clock-in-prompt-jobs"] });
      if (!variables.isAutomatic) {
        toast({ title: t("clockedOut"), description: t("clockedOutSuccessfully") });
      } else {
        toast({ title: t("autoClockedOut"), description: t("autoClockedOutDescription") });
      }
      setClockingJobId(null);
      setSelectedJob(null);
    },
    onError: (err: any) => {
      toast({ 
        title: t("clockOutFailed"), 
        description: err.message || t("couldNotClockOut"),
        variant: "destructive" 
      });
      setClockingJobId(null);
    },
  });

  // Calculate distance between two coordinates in meters
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const GEOFENCE_RADIUS_METERS = 402; // 0.25 miles

  // Auto clock-in/out based on geolocation with debouncing
  useEffect(() => {
    if (!autoClockEnabled || !profile?.id || !navigator.geolocation) return;
    
    // Get today's assignments that could be auto-clocked (only jobs with coordinates)
    const todayJobs = roleFilteredAssignments.filter(a => {
      const job = a.application.job;
      return filterByTimeFrame(a, "today") && job.latitude && job.longitude;
    });
    if (todayJobs.length === 0) return;

    const DEBOUNCE_MS = 30000; // 30 second cooldown between auto clock actions

    const handlePositionUpdate = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      setUserLocation({ lat: latitude, lng: longitude });

      // Don't process if we're currently auto-clocking
      if (autoClockingJobId !== null) return;
      
      // Check if we're in cooldown period
      if (lastAutoClockAction && Date.now() - lastAutoClockAction.time < DEBOUNCE_MS) return;

      // Check each today job for geofence entry/exit
      for (const assignment of todayJobs) {
        const job = assignment.application.job;
        
        const distance = calculateDistance(
          latitude, longitude,
          parseFloat(job.latitude!), parseFloat(job.longitude!)
        );
        const isWithinGeofence = distance <= GEOFENCE_RADIUS_METERS;

        // Auto clock-in: within geofence, not already clocked in anywhere, user is assigned, and not recently auto-clocked this job
        if (isWithinGeofence && !assignment.activeTimesheet && !activeTimesheet && canUserClockIn(assignment)) {
          // Check if we recently clocked out of this job (prevent immediate re-clock-in)
          if (lastAutoClockAction?.jobId === job.id && lastAutoClockAction?.action === "out" && 
              Date.now() - lastAutoClockAction.time < 60000) {
            continue;
          }
          
          setAutoClockingJobId(job.id);
          clockInMutation.mutate({
            jobId: job.id,
            workerId: profile.id,
            latitude,
            longitude,
            isAutomatic: true,
          }, {
            onSuccess: () => {
              setLastAutoClockAction({ jobId: job.id, action: "in", time: Date.now() });
            },
            onSettled: () => {
              setAutoClockingJobId(null);
            }
          });
          break; // Only clock into one job at a time
        }

        // Auto clock-out: outside geofence and clocked into this job
        if (!isWithinGeofence && assignment.activeTimesheet && !assignment.activeTimesheet.clockOutTime) {
          setAutoClockingJobId(job.id);
          clockOutMutation.mutate({
            timesheetId: assignment.activeTimesheet.id,
            latitude,
            longitude,
            isAutomatic: true,
          }, {
            onSuccess: () => {
              setLastAutoClockAction({ jobId: job.id, action: "out", time: Date.now() });
            },
            onSettled: () => {
              setAutoClockingJobId(null);
            }
          });
          break;
        }
      }
    };

    const id = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      (error) => console.log("Geolocation error:", error.message),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }
    );
    setWatcherId(id);

    return () => {
      if (id !== null) {
        navigator.geolocation.clearWatch(id);
      }
    };
  }, [autoClockEnabled, profile?.id, roleFilteredAssignments, activeTimesheet, autoClockingJobId, lastAutoClockAction]);

  const handleClockIn = async (assignment: JobAssignment) => {
    const job = assignment.application.job;
    // For employees, use their own profile ID for clocking in
    // The server will verify they have access to this job via the application
    const workerId = profile?.id;
    if (!workerId) return;

    setClockingJobId(job.id);

    // Use location fallback system with device-specific error handling
    getLocationWithFallback(
      (coords) => {
        setUserLocation(coords);
        clockInMutation.mutate({
          jobId: job.id,
          workerId,
          latitude: coords.lat,
          longitude: coords.lng,
        });
      },
      () => {
        setClockingJobId(null);
        // LocationError dialog will be shown by getLocationWithFallback
      }
    );
  };

  const handleClockOut = async (timesheetId: number) => {
    setClockingJobId(timesheetId);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          clockOutMutation.mutate({
            timesheetId,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        () => {
          clockOutMutation.mutate({ timesheetId });
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      clockOutMutation.mutate({ timesheetId });
    }
  };

  // Calculate estimated drive time based on distance (assumes ~30mph average)
  const calculateDriveTime = (distanceMeters: number): string => {
    const distanceMiles = distanceMeters / 1609.34;
    const hours = distanceMiles / 30; // Assume 30mph average
    const minutes = Math.ceil(hours * 60);
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  };

  // Get drive time for a job based on current user location
  const getJobDriveTime = (job: Job): string | null => {
    if (!userLocation || !job.latitude || !job.longitude) return null;
    const distance = calculateDistance(
      userLocation.lat, userLocation.lng,
      parseFloat(job.latitude), parseFloat(job.longitude)
    );
    return calculateDriveTime(distance);
  };

  // Update drive times when user location or jobs change
  useEffect(() => {
    if (!userLocation) return;
    
    const newDriveTimes: Record<number, string> = {};
    roleFilteredAssignments.forEach(assignment => {
      const job = assignment.application.job;
      if (job.latitude && job.longitude) {
        const distance = calculateDistance(
          userLocation.lat, userLocation.lng,
          parseFloat(job.latitude), parseFloat(job.longitude)
        );
        newDriveTimes[job.id] = calculateDriveTime(distance);
      }
    });
    setJobDriveTimes(newDriveTimes);
  }, [userLocation, roleFilteredAssignments]);

  const openDirections = (job: Job, returnTo?: JobAssignment | null) => {
    // Store the return-to job if provided (for breadcrumb flow)
    if (returnTo) {
      setDirectionsReturnTo(returnTo);
      setSelectedJob(null); // Close the job details popup
    }
    setDirectionsJob(job);
  };

  const closeDirections = () => {
    setDirectionsJob(null);
    // Breadcrumb: reopen the job details popup if we came from there
    if (directionsReturnTo) {
      setSelectedJob(directionsReturnTo);
      setDirectionsReturnTo(null);
    }
  };

  const openGoogleMaps = (job: Job) => {
    const destination = job.latitude && job.longitude
      ? `${job.latitude},${job.longitude}`
      : encodeURIComponent(`${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destination}`, "_blank");
    closeDirections();
  };

  const openAppleMaps = (job: Job) => {
    const destination = job.latitude && job.longitude
      ? `${job.latitude},${job.longitude}`
      : encodeURIComponent(`${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`);
    window.open(`https://maps.apple.com/?daddr=${destination}`, "_blank");
    closeDirections();
  };

  const openWaze = (job: Job) => {
    if (job.latitude && job.longitude) {
      window.open(`https://waze.com/ul?ll=${job.latitude},${job.longitude}&navigate=yes`, "_blank");
    } else {
      const address = encodeURIComponent(`${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`);
      window.open(`https://waze.com/ul?q=${address}&navigate=yes`, "_blank");
    }
    closeDirections();
  };

  const goToChat = (jobId: number) => {
    setLocation(`/chats?job=${jobId}`);
  };

  // Get relative date label (Today, Tomorrow, or date)
  const getRelativeDateLabel = (date: Date): string => {
    const today = startOfToday();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) {
      return t("today");
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return t("tomorrow");
    } else {
      return format(date, "MMM d");
    }
  };

  // Format time from 24h string to 12h format (e.g., "17:00" -> "5pm", "08:30" -> "8:30am")
  // Also handles legacy formats that already contain am/pm
  const formatTimeString = (time: string | null | undefined): string => {
    if (!time) return "";
    
    // If already contains am/pm, it's a legacy format - return as-is
    if (time.toLowerCase().includes('am') || time.toLowerCase().includes('pm')) {
      return time;
    }
    
    // If it contains " - ", it's a legacy time range - return as-is
    if (time.includes(' - ')) {
      return time;
    }
    
    // Standard 24h format (HH:MM)
    const parts = time.split(":").map(Number);
    if (parts.length < 2 || isNaN(parts[0])) return time;
    
    const hours = parts[0];
    const minutes = parts[1];
    const ampm = hours >= 12 ? 'pm' : 'am';
    const hour12 = hours % 12 || 12;
    
    // Skip minutes if they're :00
    if (minutes === 0) {
      return `${hour12}${ampm}`;
    }
    return `${hour12}:${minutes.toString().padStart(2, '0')}${ampm}`;
  };
  
  // Get time range string - always show actual times, never "Flexible"
  const getTimeRange = (job: Job): { startTime: string | null; endTime: string | null } => {
    const startTime = job.scheduledTime ? formatTimeString(job.scheduledTime) : null;
    const endTime = job.endTime ? formatTimeString(job.endTime) : null;
    return { startTime, endTime };
  };

  // Get recurring day abbreviations
  const getDayAbbreviation = (day: string): string => {
    const abbrevs: Record<string, string> = {
      monday: "Mon", tuesday: "Tue", wednesday: "Wed", 
      thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun"
    };
    return abbrevs[day.toLowerCase()] || day.slice(0, 3);
  };

  // Format schedule days for recurring jobs (similar to EnhancedJobDialog)
  const formatScheduleDays = (days: string[]): string => {
    if (!days || days.length === 0) return "";
    
    const dayOrder = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const dayAbbrev: Record<string, string> = {
      sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
      thursday: "Thu", friday: "Fri", saturday: "Sat"
    };
    
    const sorted = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
    
    if (sorted.length === 1) {
      return dayAbbrev[sorted[0]] || sorted[0];
    }
    
    // Check if days are consecutive
    let isConsecutive = true;
    for (let i = 1; i < sorted.length; i++) {
      const prevIdx = dayOrder.indexOf(sorted[i - 1]);
      const currIdx = dayOrder.indexOf(sorted[i]);
      if (currIdx !== prevIdx + 1) {
        isConsecutive = false;
        break;
      }
    }
    
    if (isConsecutive && sorted.length > 2) {
      return `${dayAbbrev[sorted[0]]}-${dayAbbrev[sorted[sorted.length - 1]]}`;
    }
    
    return sorted.map(d => dayAbbrev[d] || d).join(", ");
  };

  // Get relative day label - exactly matches EnhancedJobDialog's getRelativeDay function
  const getRelativeDay = (date: Date): string => {
    if (isToday(date)) return t("today");
    if (isTomorrow(date)) return t("tomorrow");
    
    const daysFromNow = differenceInDays(date, new Date());
    if (daysFromNow < 0) return t("past");
    if (daysFromNow <= 6) return t("inDays", { days: daysFromNow });
    if (daysFromNow <= 13) return t("nextWeek");
    
    return format(date, "EEE, MMM d");
  };

  // Format job time info matching EnhancedJobDialog style exactly
  const formatJobTime = (job: Job): { relative: string; timeRange: string; fullDate: string; scheduleDaysDisplay?: string } => {
    if (!job.startDate) {
      return { relative: t("onDemand"), timeRange: t("flexibleHours"), fullDate: t("flexibleSchedule") };
    }
    
    const startDate = parseISO(job.startDate.toString());
    const relative = getRelativeDay(startDate);
    const fullDate = format(startDate, "EEEE, MMMM d, yyyy");
    
    let timeRange = "";
    let scheduleDaysDisplay: string | undefined;
    
    const isOnDemand = job.isOnDemand || job.jobType === "on_demand";
    const isRecurring = job.jobType === "recurring";
    
    // Helper to format time from date
    const formatTimeFromDate = (d: Date) => {
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const ampm = hours >= 12 ? 'pm' : 'am';
      const hour12 = hours % 12 || 12;
      if (minutes === 0) {
        return `${hour12}${ampm}`;
      }
      return `${hour12}:${minutes.toString().padStart(2, '0')}${ampm}`;
    };
    
    if (isOnDemand) {
      const startTime = job.scheduledTime ? formatTimeString(job.scheduledTime) : null;
      if (startTime) {
        timeRange = `Starting ${startTime}`;
      } else if (startDate.getHours() !== 0 || startDate.getMinutes() !== 0) {
        timeRange = `Starting ${formatTimeFromDate(startDate)}`;
      } else {
        timeRange = t("flexibleHours");
      }
    } else if (isRecurring) {
      // For recurring jobs, always show relative date first
      // But also set scheduleDaysDisplay for additional context
      if (job.scheduleDays && job.scheduleDays.length > 0) {
        scheduleDaysDisplay = formatScheduleDays(job.scheduleDays);
      }
      const startTime = job.scheduledTime ? formatTimeString(job.scheduledTime) : null;
      const endTime = job.endTime ? formatTimeString(job.endTime) : null;
      if (startTime && endTime) {
        timeRange = `${startTime} - ${endTime}`;
      } else if (startTime) {
        timeRange = startTime;
      }
    } else {
      // One-day job
      const startTime = job.scheduledTime ? formatTimeString(job.scheduledTime) : null;
      const endTime = job.endTime ? formatTimeString(job.endTime) : null;
      if (startTime && endTime) {
        timeRange = `${startTime} - ${endTime}`;
      } else if (startTime) {
        timeRange = startTime;
      } else if (startDate.getHours() !== 0 || startDate.getMinutes() !== 0) {
        // Legacy one-day jobs with start/end timestamps
        const time = formatTimeFromDate(startDate);
        if (job.endDate) {
          const endDate = new Date(job.endDate);
          timeRange = `${time} - ${formatTimeFromDate(endDate)}`;
        } else if (job.estimatedHours) {
          const endEstimate = new Date(startDate.getTime() + job.estimatedHours * 60 * 60 * 1000);
          timeRange = `${time} - ${formatTimeFromDate(endEstimate)}`;
        } else {
          timeRange = `Starting ${time}`;
        }
      }
    }
    
    return { relative, timeRange, fullDate, scheduleDaysDisplay };
  };

  const getTimeDisplay = (job: Job): string => {
    if (!job.startDate) return "On Demand";
    const startDate = parseISO(job.startDate.toString());
    const startTime = job.scheduledTime 
      ? formatTimeString(job.scheduledTime)
      : format(startDate, "h:mma").toLowerCase();
    const endTime = job.endTime ? formatTimeString(job.endTime) : null;
    const dateStr = format(startDate, "EEE, MMM d");
    
    if (endTime) {
      return `${dateStr} • ${startTime} - ${endTime}`;
    }
    return `${dateStr} • ${startTime}`;
  };

  // Enhanced time display component for job cards - matches EnhancedJobDialog style exactly
  const JobTimeDisplay = ({ job, showFullDate = false }: { job: Job; showFullDate?: boolean }) => {
    const timeInfo = formatJobTime(job);
    const isRecurring = job.jobType === "recurring";
    
    // Calculate duration based on job type:
    // - One-day jobs: Calculate from start/end time on that single day
    // - Recurring jobs: Calculate DAILY hours from scheduledTime/endTime (not total across all days)
    // - On-demand jobs: Use estimatedHours if available, otherwise no duration shown
    const getDurationInfo = (): { hours: number; label: string } | null => {
      // If estimatedHours is explicitly set, use it
      if (job.estimatedHours) {
        return { hours: job.estimatedHours, label: `~${job.estimatedHours} hours` };
      }
      
      // Calculate daily hours from scheduledTime and endTime (works for all job types)
      if (job.scheduledTime && job.endTime) {
        const parseTime = (t: string): number => {
          const parts = t.split(":").map(Number);
          return parts[0] + (parts[1] || 0) / 60;
        };
        const startHr = parseTime(job.scheduledTime);
        const endHr = parseTime(job.endTime);
        if (endHr > startHr) {
          const dailyHours = Math.round(endHr - startHr);
          // For recurring jobs, show "X hours/day" to clarify it's per-day
          if (job.jobType === "recurring") {
            return { hours: dailyHours, label: `~${dailyHours} hours/day` };
          }
          // For one-day jobs, just show total hours
          return { hours: dailyHours, label: `~${dailyHours} hours` };
        }
      }
      
      // For one-day jobs only: try to calculate from startDate/endDate timestamps if same day
      if (job.jobType !== "recurring" && job.jobType !== "on_demand" && !job.isOnDemand) {
        if (job.startDate && job.endDate) {
          const start = new Date(job.startDate);
          const end = new Date(job.endDate);
          // Only calculate if same calendar day (one-day job with timestamps)
          if (format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd")) {
            const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
            if (hours > 0 && hours < 24) {
              return { hours: Math.round(hours), label: `~${Math.round(hours)} hours` };
            }
          }
        }
      }
      
      // On-demand jobs without estimatedHours - don't show duration
      if (job.isOnDemand || job.jobType === "on_demand") {
        return null;
      }
      
      return null;
    };
    
    const durationInfo = getDurationInfo();
    
    return (
      <div className="space-y-0.5">
        {/* Line 1: Relative date + time range in parentheses */}
        <p className="font-semibold text-sm">
          {timeInfo.relative}
          {timeInfo.timeRange && (
            <span className="text-sm font-medium text-muted-foreground ml-1">
              ({timeInfo.timeRange})
            </span>
          )}
        </p>
        {/* Line 2: Full date (only in detail views) */}
        {showFullDate && (
          <p className="text-xs text-muted-foreground">{timeInfo.fullDate}</p>
        )}
        {/* Line 3: Recurring days as a badge row */}
        {isRecurring && timeInfo.scheduleDaysDisplay && (
          <div className="flex items-center gap-1 flex-wrap mt-0.5">
            <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded">
              {timeInfo.scheduleDaysDisplay}
            </span>
          </div>
        )}
        {/* Line 4: Duration */}
        {durationInfo && showFullDate && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            <Clock className="w-3 h-3" />
            <span>{durationInfo.label}</span>
          </div>
        )}
      </div>
    );
  };

  // US state to timezone mapping (fallback if job.timezone is not set)
  const stateTimezones: Record<string, string> = {
    CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", 
    GA: "America/New_York", ME: "America/New_York", MD: "America/New_York", 
    MA: "America/New_York", NH: "America/New_York", NJ: "America/New_York", 
    NY: "America/New_York", NC: "America/New_York", OH: "America/New_York", 
    PA: "America/New_York", RI: "America/New_York", SC: "America/New_York",
    VT: "America/New_York", VA: "America/New_York", WV: "America/New_York",
    FL: "America/New_York", MI: "America/Detroit", IN: "America/Indiana/Indianapolis",
    KY: "America/Kentucky/Louisville",
    AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", 
    IA: "America/Chicago", KS: "America/Chicago", LA: "America/Chicago", 
    MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago", 
    NE: "America/Chicago", ND: "America/Chicago", OK: "America/Chicago",
    SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
    AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Boise", 
    MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
    CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", 
    WA: "America/Los_Angeles",
    AK: "America/Anchorage", HI: "Pacific/Honolulu",
  };

  // Get timezone for a job (uses job.timezone field, falls back to state mapping)
  const getJobTimezone = (job: Job): string => {
    if (job.timezone) return job.timezone;
    if (job.state && stateTimezones[job.state]) return stateTimezones[job.state];
    return "America/New_York"; // Default to Eastern
  };

  // Get the timezone offset in minutes for a given timezone at a specific moment
  const getTimezoneOffsetMinutes = (date: Date, timezone: string): number => {
    // Format the date in the target timezone and UTC to find the offset
    const utcFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const tzFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    
    const utcParts = utcFormatter.formatToParts(date);
    const tzParts = tzFormatter.formatToParts(date);
    
    const getVal = (parts: Intl.DateTimeFormatPart[], type: string) => 
      parseInt(parts.find(p => p.type === type)?.value || '0');
    
    // Calculate minutes since epoch for both
    const utcMins = getVal(utcParts, 'year') * 525600 + 
                    getVal(utcParts, 'month') * 43200 + 
                    getVal(utcParts, 'day') * 1440 + 
                    getVal(utcParts, 'hour') * 60 + 
                    getVal(utcParts, 'minute');
    const tzMins = getVal(tzParts, 'year') * 525600 + 
                   getVal(tzParts, 'month') * 43200 + 
                   getVal(tzParts, 'day') * 1440 + 
                   getVal(tzParts, 'hour') * 60 + 
                   getVal(tzParts, 'minute');
    
    return tzMins - utcMins; // Positive = ahead of UTC (e.g., +540 for JST), negative = behind (e.g., -300 for EST)
  };

  // Get job start time as a UTC Date (accounting for job's timezone)
  const getJobStartDateTime = (job: Job): Date | null => {
    if (!job.startDate) return null;
    
    const timezone = getJobTimezone(job);
    
    // The job's startDate is a timestamp. We need to interpret the date portion 
    // and scheduled time in the job's timezone.
    const startDate = new Date(job.startDate);
    
    // Parse scheduled time or default to start of day
    let hours = 0, minutes = 0;
    if (job.scheduledTime) {
      const timeParts = job.scheduledTime.split(":");
      if (timeParts.length >= 2) {
        hours = parseInt(timeParts[0]) || 0;
        minutes = parseInt(timeParts[1]) || 0;
      }
    }
    
    // Set the time portion on the date
    startDate.setHours(hours, minutes, 0, 0);
    
    // Get the offset difference between user's timezone and job's timezone
    const userOffset = startDate.getTimezoneOffset(); // Minutes behind UTC (positive for US)
    const jobOffset = getTimezoneOffsetMinutes(startDate, timezone);
    
    // Adjust the time to account for timezone difference
    // If job is in Pacific (-8) and user is in Eastern (-5), we need to shift by 3 hours
    const offsetDiffMinutes = -userOffset - jobOffset; // User local - job local
    
    // Create the corrected UTC timestamp
    return new Date(startDate.getTime() - offsetDiffMinutes * 60 * 1000);
  };

  // Check if a job is too far in the future to clock in (more than 24 hours before start)
  const isJobTooEarlyToClockIn = (job: Job): boolean => {
    const jobStartTime = getJobStartDateTime(job);
    if (!jobStartTime) return false;
    
    const now = new Date();
    const hoursUntilStart = (jobStartTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    // Can clock in if within 24 hours of job start
    return hoursUntilStart > 24;
  };

  const getJobStatus = (assignment: JobAssignment): { label: string; color: string; canClockIn: boolean; isFuture?: boolean } => {
    const job = assignment.application.job;
    
    if (assignment.activeTimesheet && !assignment.activeTimesheet.clockOutTime) {
      return { label: t("clockedIn"), color: "bg-green-500", canClockIn: false };
    }
    
    // Check if job start is more than 24 hours away
    if (isJobTooEarlyToClockIn(job)) {
      return { label: t("notStarted"), color: "bg-gray-400", canClockIn: false, isFuture: true };
    }
    
    const jobStartTime = getJobStartDateTime(job);
    if (!jobStartTime) {
      return { label: t("ready"), color: "bg-blue-500", canClockIn: true };
    }
    
    const now = new Date();
    const minutesUntilStart = Math.floor((jobStartTime.getTime() - now.getTime()) / (1000 * 60));
    
    // Can clock in within 24 hours - show appropriate status
    if (minutesUntilStart > 60) {
      return { label: t("upcoming"), color: "bg-gray-500", canClockIn: true };
    } else if (minutesUntilStart > 0) {
      return { label: t("startingSoon"), color: "bg-orange-500", canClockIn: true };
    } else {
      return { label: t("inProgress"), color: "bg-green-500", canClockIn: true };
    }
  };

  // Helper to get job type info for tags
  const getJobTypeInfo = (job: Job): { label: string; icon: typeof Repeat; description: string; color: string } => {
    if (job.jobType === "recurring") {
      return {
        label: t("recurring"),
        icon: Repeat,
        description: t("recurringDescription"),
        color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
      };
    } else if (job.isOnDemand || job.jobType === "on_demand") {
      const address = getFullAddress(job) || "the job site";
      const { startTime } = getTimeRange(job);
      const arriveTime = startTime || "the scheduled time";
      return {
        label: t("onDemand"),
        icon: Zap,
        description: t("onDemandDescription", { address, arriveTime }),
        color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      };
    } else {
      return {
        label: t("oneDay"),
        icon: CalendarDays,
        description: t("oneDayDescription"),
        color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
      };
    }
  };

  // Get full address string
  const getFullAddress = (job: Job): string => {
    const parts = [job.address, job.city, job.state, job.zipCode].filter(Boolean);
    return parts.join(", ");
  };

  const isAdmin = profile?.teamId === null && profile?.role === "worker";

  // Helper to parse scheduled time to hour number (0-23)
  const parseTimeToHour = (timeStr: string | null | undefined): number | null => {
    if (!timeStr) return null;
    // Handle 24h format "HH:MM"
    if (!timeStr.toLowerCase().includes('am') && !timeStr.toLowerCase().includes('pm')) {
      const parts = timeStr.split(":").map(Number);
      if (parts.length >= 1 && !isNaN(parts[0])) {
        return parts[0];
      }
    }
    // Handle legacy am/pm format
    const match = timeStr.match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
    if (match) {
      let hour = parseInt(match[1], 10);
      const isPM = match[3].toLowerCase() === 'pm';
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      return hour;
    }
    return null;
  };

  // Get day name from index (0=Sunday, 6=Saturday)
  const dayIndexToName = (idx: number): string => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[idx] || "Sunday";
  };

  // Check if a job should appear on a specific day (handles recurring and on-demand)
  const jobAppearsOnDay = (job: Job, dayName: string): boolean => {
    const isRecurring = job.jobType === "recurring";
    const isOnDemand = job.isOnDemand || job.jobType === "on_demand";
    
    if (isRecurring && job.scheduleDays && job.scheduleDays.length > 0) {
      return job.scheduleDays.some(d => d.toLowerCase() === dayName.toLowerCase());
    }
    
    if (isOnDemand) {
      return false; // On-demand jobs go to special section
    }
    
    if (job.startDate) {
      const date = new Date(job.startDate);
      const jobDayName = format(date, "EEEE");
      return jobDayName === dayName;
    }
    
    return false;
  };

  // Group assignments by day of week (expands recurring jobs across scheduled days)
  // Respects job.startDate - recurring jobs only appear on/after their start date
  // For "This Week" view: shows jobs that will occur this week, including future starts
  const groupByDayOfWeek = (assignments: JobAssignment[]): { days: Record<string, JobAssignment[]>; onDemand: JobAssignment[] } => {
    const groups: Record<string, JobAssignment[]> = {};
    const onDemand: JobAssignment[] = [];
    const dayOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    dayOrder.forEach(day => { groups[day] = []; });
    
    const today = startOfToday();
    const weekStart = startOfWeek(today, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 0 });
    
    // Map day names to indices for date calculations
    const dayNameToIndex: Record<string, number> = {
      'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
      'thursday': 4, 'friday': 5, 'saturday': 6
    };
    
    assignments.forEach(assignment => {
      const job = assignment.application.job;
      const isOnDemandJob = job.isOnDemand || job.jobType === "on_demand";
      const isRecurring = job.jobType === "recurring";
      const jobStartDate = job.startDate ? new Date(job.startDate) : null;
      
      if (isOnDemandJob && !job.startDate) {
        onDemand.push(assignment);
      } else if (isRecurring && job.scheduleDays && job.scheduleDays.length > 0) {
        // For recurring jobs, add to each day that:
        // 1. Matches the schedule
        // 2. Falls on or after the job's startDate (if specified)
        // 3. Falls within this week
        job.scheduleDays.forEach(scheduleDay => {
          const normalizedDay = scheduleDay.charAt(0).toUpperCase() + scheduleDay.slice(1).toLowerCase();
          const dayIndex = dayNameToIndex[scheduleDay.toLowerCase()];
          
          if (dayIndex !== undefined && groups[normalizedDay]) {
            // Calculate the actual date for this day of the week
            const dayDate = addDays(weekStart, dayIndex);
            
            // Only add if this day is >= startDate (or no startDate)
            if (!jobStartDate || dayDate >= jobStartDate) {
              groups[normalizedDay].push(assignment);
            }
          }
        });
      } else if (job.startDate) {
        const date = new Date(job.startDate);
        // Only include if job starts within this week
        if (date >= weekStart && date <= weekEnd) {
          const dayName = format(date, "EEEE");
          if (groups[dayName]) {
            groups[dayName].push(assignment);
          }
        }
      } else {
        onDemand.push(assignment);
      }
    });
    return { days: groups, onDemand };
  };

  // Group assignments by full date (expands recurring jobs)
  const groupByDate = (assignments: JobAssignment[]): { dates: Record<string, JobAssignment[]>; onDemand: JobAssignment[] } => {
    const groups: Record<string, JobAssignment[]> = {};
    const onDemand: JobAssignment[] = [];
    
    const today = startOfToday();
    const monthEnd = endOfMonth(today);
    
    assignments.forEach(assignment => {
      const job = assignment.application.job;
      const isOnDemandJob = job.isOnDemand || job.jobType === "on_demand";
      const isRecurring = job.jobType === "recurring";
      const jobStartDate = job.startDate ? new Date(job.startDate) : null;
      
      if (isOnDemandJob && !job.startDate) {
        onDemand.push(assignment);
      } else if (isRecurring && job.scheduleDays && job.scheduleDays.length > 0) {
        // Expand recurring jobs across matching days in the month
        // Respects job.startDate - only show from that date onwards
        let startFrom = today;
        if (jobStartDate && isAfter(jobStartDate, today)) {
          startFrom = jobStartDate;
        }
        
        let currentDate = startFrom;
        while (currentDate <= monthEnd) {
          const dayName = format(currentDate, "EEEE").toLowerCase();
          if (job.scheduleDays.some(d => d.toLowerCase() === dayName)) {
            const dateKey = format(currentDate, "yyyy-MM-dd");
            if (!groups[dateKey]) {
              groups[dateKey] = [];
            }
            groups[dateKey].push(assignment);
          }
          currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
        }
      } else if (job.startDate) {
        const date = new Date(job.startDate);
        if (date >= today && date <= monthEnd) {
          const dateKey = format(date, "yyyy-MM-dd");
          if (!groups[dateKey]) {
            groups[dateKey] = [];
          }
          groups[dateKey].push(assignment);
        }
      } else {
        onDemand.push(assignment);
      }
    });
    return { dates: groups, onDemand };
  };

  // Timeline mini job card - compact version for timeline views (accessible button)
  const TimelineJobChip = ({ assignment, onClick }: { assignment: JobAssignment; onClick: () => void }) => {
    const job = assignment.application.job;
    const status = getJobStatus(assignment);
    const isClockedIn = assignment.activeTimesheet && !assignment.activeTimesheet.clockOutTime;
    const jobCompanyProfile = job.companyId ? companyProfiles[job.companyId] : null;
    const { startTime, endTime } = getTimeRange(job);
    
    // Get assigned worker info - could be a team member or the current user
    const assignedWorker = assignment.application.teamMember;
    const workerAvatarUrl = assignedWorker?.avatarUrl || profile?.avatarUrl;
    const workerInitials = assignedWorker 
      ? `${assignedWorker.firstName?.[0] || ''}${assignedWorker.lastName?.[0] || ''}`
      : `${profile?.firstName?.[0] || ''}${profile?.lastName?.[0] || ''}`;
    const workerName = assignedWorker 
      ? `${assignedWorker.firstName || ''} ${assignedWorker.lastName || ''}`.trim()
      : `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim();
    
    // Get contact rep name from company profile
    const contactRepName = jobCompanyProfile 
      ? `${jobCompanyProfile.firstName || ''} ${jobCompanyProfile.lastName || ''}`.trim()
      : null;
    
    // Get location display - prefer locationName, fall back to city/state
    const locationDisplay = job.locationName || (job.city && job.state ? `${job.city}, ${job.state}` : null);
    
    return (
      <button
        type="button"
        className={`relative w-full text-left p-2.5 rounded-lg border cursor-pointer transition-all hover-elevate ${
          isClockedIn 
            ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-700" 
            : status.isFuture 
              ? "bg-muted/50 border-muted-foreground/20 opacity-60" 
              : "bg-card border-border"
        }`}
        onClick={onClick}
        data-testid={`timeline-job-${job.id}`}
        aria-label={`${t("viewDetails")} ${job.title}`}
      >
        <div className="flex items-start gap-2.5">
          {/* Company Avatar with Worker Avatar Overlay */}
          <div className="flex-shrink-0 relative">
            <Avatar className="w-9 h-9 border border-border">
              <AvatarImage src={jobCompanyProfile?.companyLogo || jobCompanyProfile?.avatarUrl || undefined} />
              <AvatarFallback className="text-xs bg-secondary">
                {jobCompanyProfile?.companyName?.[0] || <Building2 className="w-4 h-4" />}
              </AvatarFallback>
            </Avatar>
            {/* Worker Avatar - small overlay on bottom right */}
            <Avatar className="w-5 h-5 border-2 border-background absolute -bottom-0.5 -right-0.5">
              <AvatarImage src={workerAvatarUrl || undefined} />
              <AvatarFallback className="text-[8px] bg-primary text-primary-foreground font-medium">
                {workerInitials || <User className="w-2.5 h-2.5" />}
              </AvatarFallback>
            </Avatar>
            {isClockedIn && (
              <span className="absolute -top-0.5 -left-0.5 w-3 h-3 bg-green-500 rounded-full animate-pulse border-2 border-background" />
            )}
          </div>
          
          {/* Job Info */}
          <div className="flex-1 min-w-0 space-y-0.5">
            {/* Title and Status */}
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-xs truncate flex-1">{job.title}</span>
              <Badge className={`${status.color} text-white text-[10px] px-1.5 py-0 flex-shrink-0`}>
                {status.label}
              </Badge>
            </div>
            
            {/* Company Name */}
            {jobCompanyProfile?.companyName && (
              <div className="flex items-center gap-1 text-[11px] text-foreground/80">
                <Building2 className="w-3 h-3 flex-shrink-0" />
                <span className="truncate font-medium">{jobCompanyProfile.companyName}</span>
              </div>
            )}
            
            {/* Contact Rep and Location */}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {contactRepName && (
                <span className="flex items-center gap-1 truncate">
                  <User className="w-2.5 h-2.5 flex-shrink-0" />
                  {contactRepName}
                </span>
              )}
              {locationDisplay && (
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                  {locationDisplay}
                </span>
              )}
            </div>
            
            {/* Date and Time - Compact format like WorkerDashboard */}
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Calendar className="w-2.5 h-2.5 flex-shrink-0" />
              <span>
                {(() => {
                  if (!job.startDate) return t("onDemand");
                  const startDate = new Date(job.startDate);
                  const now = new Date();
                  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const jobDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
                  const diffDays = Math.floor((jobDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  
                  // Days away text
                  let daysText = "";
                  if (diffDays === 0) {
                    daysText = "(Today)";
                  } else if (diffDays === 1) {
                    daysText = "(Tomorrow)";
                  } else if (diffDays > 1) {
                    daysText = `(${diffDays} days away)`;
                  } else if (diffDays < 0) {
                    daysText = "(Past)";
                  }
                  
                  const dateStr = format(startDate, "MMM d");
                  const timeStr = startTime ? `${startTime}${endTime ? `-${endTime}` : ""}` : "";
                  
                  if (timeStr) {
                    return `${timeStr} • ${dateStr} ${daysText}`;
                  }
                  return `${dateStr} ${daysText}`;
                })()}
              </span>
            </div>
          </div>
        </div>
      </button>
    );
  };

  // Day Timeline Component - Shows jobs plotted on hourly time slots
  const DayTimeline = ({ assignments }: { assignments: JobAssignment[] }) => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const now = new Date();
    const currentHour = now.getHours();
    const todayDayName = format(now, "EEEE").toLowerCase();

    // Separate active (clocked in), scheduled, and flexible/on-demand jobs
    const activeJobs: JobAssignment[] = [];
    const scheduledJobs: JobAssignment[] = [];
    const flexibleJobs: JobAssignment[] = [];
    
    assignments.forEach(assignment => {
      const job = assignment.application.job;
      const isOnDemand = job.isOnDemand || job.jobType === "on_demand";
      const isRecurring = job.jobType === "recurring";
      const jobStartDate = job.startDate ? new Date(job.startDate) : null;
      const isClockedIn = assignment.activeTimesheet && !assignment.activeTimesheet.clockOutTime;
      
      // Active jobs (currently clocked in) go to top section
      if (isClockedIn) {
        activeJobs.push(assignment);
        return;
      }
      
      // For recurring jobs, check if they've started (startDate <= today or no startDate)
      const hasStarted = !jobStartDate || isBefore(jobStartDate, now) || isToday(jobStartDate);
      
      // Check if recurring job applies to today
      if (isRecurring && job.scheduleDays && job.scheduleDays.length > 0) {
        const appliesToday = job.scheduleDays.some(d => d.toLowerCase() === todayDayName);
        if (appliesToday && hasStarted && job.scheduledTime) {
          scheduledJobs.push(assignment);
        } else if (appliesToday && hasStarted && !job.scheduledTime) {
          flexibleJobs.push(assignment);
        }
        // If job hasn't started yet or doesn't apply to today, don't show it
      } else if (job.scheduledTime) {
        scheduledJobs.push(assignment);
      } else if (isOnDemand || !job.startDate) {
        flexibleJobs.push(assignment);
      } else {
        flexibleJobs.push(assignment);
      }
    });

    // Get jobs for each hour slot
    const getJobsForHour = (hour: number): JobAssignment[] => {
      return scheduledJobs.filter(assignment => {
        const job = assignment.application.job;
        const startHour = parseTimeToHour(job.scheduledTime);
        const endHour = job.endTime ? parseTimeToHour(job.endTime) : null;
        
        if (startHour === null) return false;
        
        // If job spans multiple hours, show in all hours
        if (endHour !== null && endHour > startHour) {
          return hour >= startHour && hour < endHour;
        }
        return startHour === hour;
      });
    };

    // Only show hours that have jobs OR are work hours (6am-10pm) OR current hour
    const relevantHours = hours.filter(hour => {
      const hasJobs = getJobsForHour(hour).length > 0;
      const isWorkHour = hour >= 6 && hour <= 22;
      const isCurrent = hour === currentHour;
      return hasJobs || isWorkHour || isCurrent;
    });

    const formatHourLabel = (hour: number): string => {
      if (hour === 0) return "12am";
      if (hour === 12) return "12pm";
      if (hour < 12) return `${hour}am`;
      return `${hour - 12}pm`;
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            {format(now, "EEEE, MMMM d")}
          </span>
        </div>
        
        {/* Active/In Progress Jobs Section - Always at top */}
        {activeJobs.length > 0 && (
          <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-950/30">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-green-300 dark:border-green-700">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wide text-green-700 dark:text-green-300">
                {t("activeInProgress")}
              </span>
              <span className="text-xs text-green-600 dark:text-green-400 ml-auto">
                {t("jobCount", { count: activeJobs.length })}
              </span>
            </div>
            <div className="p-2 space-y-1">
              {activeJobs.map(assignment => (
                <TimelineJobChip
                  key={`active-${assignment.application.id}-${assignment.application.teamMemberId || 'self'}`}
                  assignment={assignment}
                  onClick={() => setSelectedJob(assignment)}
                />
              ))}
            </div>
          </div>
        )}
        
        {/* Flexible/On-Demand Jobs Section */}
        {flexibleJobs.length > 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200 dark:border-amber-800">
              <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {t("flexibleOnDemand")}
              </span>
              <span className="text-xs text-amber-600 dark:text-amber-400 ml-auto">
                {t("jobCount", { count: flexibleJobs.length })}
              </span>
            </div>
            <div className="p-2 space-y-1">
              {flexibleJobs.map(assignment => (
                <TimelineJobChip
                  key={`flex-${assignment.application.id}-${assignment.application.teamMemberId || 'self'}`}
                  assignment={assignment}
                  onClick={() => setSelectedJob(assignment)}
                />
              ))}
            </div>
          </div>
        )}
        
        {/* Hourly Timeline */}
        {scheduledJobs.length > 0 && (
          <div className="relative">
            {relevantHours.map(hour => {
              const jobsThisHour = getJobsForHour(hour);
              const isCurrent = hour === currentHour;
              
              return (
                <div 
                  key={hour} 
                  className={`flex items-stretch border-l-2 ${
                    isCurrent 
                      ? "border-primary bg-primary/5" 
                      : "border-muted-foreground/20"
                  }`}
                >
                  <div className={`w-14 flex-shrink-0 py-2 px-2 text-xs font-medium ${
                    isCurrent ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {formatHourLabel(hour)}
                    {isCurrent && (
                      <div className="w-2 h-2 bg-primary rounded-full mt-1" />
                    )}
                  </div>
                  <div className="flex-1 py-1 pl-2 pr-1 min-h-[40px]">
                    {jobsThisHour.length > 0 ? (
                      <div className="space-y-1">
                        {jobsThisHour.map(assignment => (
                          <TimelineJobChip
                            key={`hour-${hour}-${assignment.application.id}-${assignment.application.teamMemberId || 'self'}`}
                            assignment={assignment}
                            onClick={() => setSelectedJob(assignment)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="h-full flex items-center">
                        <div className="h-px w-full bg-muted-foreground/10" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        
        {scheduledJobs.length === 0 && flexibleJobs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t("noJobsScheduledForToday")}</p>
          </div>
        )}
      </div>
    );
  };

  // Week Timeline Component - Shows jobs grouped by days of the week
  const WeekTimeline = ({ assignments }: { assignments: JobAssignment[] }) => {
    const { days: groupedByDay, onDemand } = groupByDayOfWeek(assignments);
    const dayOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const today = format(new Date(), "EEEE");

    // Get short day names
    const getShortDay = (day: string): string => {
      return day.slice(0, 3);
    };

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            {t("weekOf", { date: format(new Date(), "MMMM d") })}
          </span>
        </div>
        
        {/* On-Demand/Flexible Jobs Section */}
        {onDemand.length > 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200 dark:border-amber-800">
              <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {t("onDemandAnytime")}
              </span>
              <span className="text-xs text-amber-600 dark:text-amber-400 ml-auto">
                  {t("jobCount", { count: onDemand.length })}
              </span>
            </div>
            <div className="p-2 space-y-1">
              {onDemand.map(assignment => (
                <TimelineJobChip
                  key={`ondemand-${assignment.application.id}-${assignment.application.teamMemberId || 'self'}`}
                  assignment={assignment}
                  onClick={() => setSelectedJob(assignment)}
                />
              ))}
            </div>
          </div>
        )}
        
        {dayOrder.map(day => {
          const jobsThisDay = groupedByDay[day];
          const isTodayDay = day === today;
          const hasJobs = jobsThisDay.length > 0;
          
          if (!hasJobs && !isTodayDay) return null;
          
          return (
            <div 
              key={day}
              className={`rounded-lg border ${
                isTodayDay 
                  ? "border-primary/50 bg-primary/5" 
                  : "border-border"
              }`}
            >
              <div className={`flex items-center gap-2 px-3 py-2 border-b ${
                isTodayDay ? "border-primary/20" : "border-border"
              }`}>
                <span className={`text-xs font-bold uppercase tracking-wide ${
                  isTodayDay ? "text-primary" : "text-muted-foreground"
                }`}>
                  {getShortDay(day)}
                </span>
                {isTodayDay && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {t("today")}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {hasJobs ? t("jobCount", { count: jobsThisDay.length }) : t("noJobs")}
                </span>
              </div>
              
              <div className="p-2 space-y-1">
                {hasJobs ? (
                  jobsThisDay.map((assignment, idx) => (
                    <TimelineJobChip
                      key={`${day}-${idx}-${assignment.application.id}-${assignment.application.teamMemberId || 'self'}`}
                      assignment={assignment}
                      onClick={() => setSelectedJob(assignment)}
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground py-2 text-center">
                    {t("noJobsScheduled")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Month Timeline Component - Shows jobs grouped by full dates
  const MonthTimeline = ({ assignments }: { assignments: JobAssignment[] }) => {
    const { dates: groupedByDate, onDemand } = groupByDate(assignments);
    const sortedDates = Object.keys(groupedByDate).sort();
    const today = format(new Date(), "yyyy-MM-dd");

    const formatDateHeader = (dateKey: string): { main: string; sub: string } => {
      const date = new Date(dateKey + "T00:00:00");
      return {
        main: format(date, "EEEE"),
        sub: format(date, "MMMM d, yyyy")
      };
    };

    const getRelativeLabel = (dateKey: string): string | null => {
      const date = new Date(dateKey + "T00:00:00");
      if (isToday(date)) return t("today");
      if (isTomorrow(date)) return t("tomorrow");
      const daysFromNow = differenceInDays(date, new Date());
      if (daysFromNow < 0) return t("past");
      if (daysFromNow <= 6) return t("inDays", { days: daysFromNow });
      return null;
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            {format(new Date(), "MMMM yyyy")}
          </span>
        </div>
        
        {/* On-Demand/Flexible Jobs Section */}
        {onDemand.length > 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200 dark:border-amber-800">
              <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {t("onDemandAnytime")}
              </span>
              <span className="text-xs text-amber-600 dark:text-amber-400 ml-auto">
                  {t("jobCount", { count: onDemand.length })}
              </span>
            </div>
            <div className="p-2 space-y-1">
              {onDemand.map(assignment => (
                <TimelineJobChip
                  key={`ondemand-${assignment.application.id}-${assignment.application.teamMemberId || 'self'}`}
                  assignment={assignment}
                  onClick={() => setSelectedJob(assignment)}
                />
              ))}
            </div>
          </div>
        )}
        
        {sortedDates.map(dateKey => {
          const jobsThisDate = groupedByDate[dateKey];
          const { main, sub } = formatDateHeader(dateKey);
          const relativeLabel = getRelativeLabel(dateKey);
          const isCurrentDate = dateKey === today;
          
          return (
            <div 
              key={dateKey}
              className={`rounded-lg border ${
                isCurrentDate 
                  ? "border-primary/50 bg-primary/5" 
                  : "border-border"
              }`}
            >
              <div className={`flex items-center gap-2 px-3 py-2 border-b ${
                isCurrentDate ? "border-primary/20" : "border-border"
              }`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${
                      isCurrentDate ? "text-primary" : ""
                    }`}>
                      {main}
                    </span>
                    {relativeLabel && (
                      <Badge variant={isCurrentDate ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                        {relativeLabel}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{sub}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("jobCount", { count: jobsThisDate.length })}
                </span>
              </div>
              
              <div className="p-2 space-y-1">
                {jobsThisDate.map((assignment, idx) => (
                  <TimelineJobChip
                    key={`${dateKey}-${idx}-${assignment.application.id}-${assignment.application.teamMemberId || 'self'}`}
                    assignment={assignment}
                    onClick={() => setSelectedJob(assignment)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const JobCard = ({ assignment }: { assignment: JobAssignment }) => {
    const job = assignment.application.job;
    const status = getJobStatus(assignment);
    const isClockedIn = assignment.activeTimesheet && !assignment.activeTimesheet.clockOutTime;
    const isClocking = clockingJobId === job.id || clockingJobId === assignment.activeTimesheet?.id;
    const jobTypeInfo = getJobTypeInfo(job);
    const JobTypeIcon = jobTypeInfo.icon;
    const jobCompanyProfile = job.companyId ? companyProfiles[job.companyId] : null;

    // Get worker avatar info
    const workerAvatar = assignment.application.teamMember 
      ? { 
          url: assignment.application.teamMember.avatarUrl,
          initials: `${assignment.application.teamMember.firstName?.[0] || ''}${assignment.application.teamMember.lastName?.[0] || ''}`
        }
      : profile 
        ? { url: profile.avatarUrl, initials: `${profile.firstName?.[0] || ''}${profile.lastName?.[0] || ''}` }
        : null;

    const isFutureJob = status.isFuture;

    return (
      <Card 
        className={`p-4 hover-elevate cursor-pointer ${isFutureJob ? 'opacity-60' : ''}`}
        onClick={() => setSelectedJob(assignment)}
        data-testid={`today-job-${job.id}`}
      >
        <div className="space-y-3">
          {/* Header row with title, status, and avatars */}
          <div className="flex items-start gap-3">
            {/* Overlapping avatars - Worker + Company */}
            <div className={`relative flex-shrink-0 ${isFutureJob ? 'grayscale' : ''}`}>
              {/* Worker Avatar (front, larger) */}
              {workerAvatar ? (
                <Avatar className="w-10 h-10 border-2 border-background">
                  <AvatarImage src={workerAvatar.url || undefined} />
                  <AvatarFallback>{workerAvatar.initials || <User className="w-5 h-5" />}</AvatarFallback>
                </Avatar>
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center border-2 border-background">
                  <User className="w-5 h-5 text-primary" />
                </div>
              )}
              {/* Company Avatar (back, smaller, offset) */}
              {jobCompanyProfile && (
                <Avatar className="w-7 h-7 absolute -bottom-1 -right-1 border-2 border-background">
                  <AvatarImage src={jobCompanyProfile.companyLogo || jobCompanyProfile.avatarUrl || undefined} />
                  <AvatarFallback className="text-xs bg-secondary">
                    {jobCompanyProfile.companyName?.[0] || jobCompanyProfile.firstName?.[0] || <Building2 className="w-3 h-3" />}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className={`font-semibold text-sm ${isFutureJob ? 'text-muted-foreground' : ''}`}>{job.title}</h3>
                <Badge className={`${status.color} text-white text-xs`}>{status.label}</Badge>
              </div>
              
              {assignment.application.teamMember ? (
                <p className="text-xs text-muted-foreground">
                  {t("assignedTo", { firstName: assignment.application.teamMember.firstName, lastName: assignment.application.teamMember.lastName })}
                </p>
              ) : jobCompanyProfile && (
                <p className="text-xs text-muted-foreground">
                  {jobCompanyProfile.companyName || `${jobCompanyProfile.firstName || ''} ${jobCompanyProfile.lastName || ''}`.trim()}
                </p>
              )}
            </div>
          </div>

          {/* Job type tag + Time display - on same row */}
          <div className="flex items-start gap-2">
            <button 
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${jobTypeInfo.color}`}
              onClick={(e) => { e.stopPropagation(); setScheduleInfoJob(job); }}
              data-testid={`job-type-tag-${job.id}`}
            >
              <JobTypeIcon className="w-3 h-3" />
              {jobTypeInfo.label}
            </button>
            <JobTimeDisplay job={job} />
          </div>

          {/* Full address */}
          <div className="flex items-start gap-1 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>{getFullAddress(job)}</span>
          </div>

          {/* Action buttons row */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant={isFutureJob ? "secondary" : "outline"}
              onClick={(e) => { e.stopPropagation(); if (!isFutureJob) openDirections(job); }}
              className={`flex-1 ${isFutureJob ? 'opacity-60' : ''}`}
              disabled={isFutureJob}
              data-testid={`button-directions-${job.id}`}
            >
              <Car className="w-4 h-4 mr-1" />
              {jobDriveTimes[job.id] ? `${jobDriveTimes[job.id]} ${t("drive")}` : t("directions")}
            </Button>
            
            {isFutureJob ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => { e.stopPropagation(); setFutureJobDialog(job); }}
                className="flex-1 opacity-60"
                data-testid={`button-job-not-started-${job.id}`}
              >
                <Clock className="w-4 h-4 mr-1" />
                {t("notStarted")}
              </Button>
            ) : isClockedIn ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={(e) => { e.stopPropagation(); handleClockOut(assignment.activeTimesheet!.id); }}
                disabled={isClocking}
                className="flex-1"
                data-testid={`button-clock-out-${job.id}`}
              >
                {isClocking ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Square className="w-4 h-4 mr-1" />}
                {t("clockOut")}
              </Button>
            ) : canUserClockIn(assignment) ? (
              <Button
                size="sm"
                onClick={(e) => { e.stopPropagation(); handleClockIn(assignment); }}
                disabled={isClocking || !!activeTimesheet}
                className="flex-1"
                data-testid={`button-clock-in-${job.id}`}
              >
                {isClocking ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1" />}
                {t("clockIn")}
              </Button>
            ) : isAdmin ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => { e.stopPropagation(); setReassignDialogJob(assignment); }}
                className="flex-1 opacity-60"
                data-testid={`button-clock-in-disabled-${job.id}`}
              >
                <Play className="w-4 h-4 mr-1" />
                {t("clockIn")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled
                className="flex-1 opacity-40"
                data-testid={`button-clock-in-disabled-${job.id}`}
              >
                <Play className="w-4 h-4 mr-1" />
                {t("clockIn")}
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  };

  const JobDetailsDialog = () => {
    if (!selectedJob) return null;
    
    const job = selectedJob.application.job;
    const status = getJobStatus(selectedJob);
    const isClockedIn = selectedJob.activeTimesheet && !selectedJob.activeTimesheet.clockOutTime;
    const isClocking = clockingJobId === job.id || clockingJobId === selectedJob.activeTimesheet?.id;
    const jobTypeInfo = getJobTypeInfo(job);
    const JobTypeIcon = jobTypeInfo.icon;
    const isFutureJob = status.isFuture;

    // Build media array from images and videos
    const allMedia: { type: "image" | "video"; url: string }[] = [];
    if (job.images && Array.isArray(job.images)) {
      job.images.forEach((url: string) => allMedia.push({ type: "image", url }));
    }
    if (job.videos && Array.isArray(job.videos)) {
      job.videos.forEach((url: string) => allMedia.push({ type: "video", url }));
    }

    // Check if job has map coordinates
    const hasMapLocation = (job as any).mapThumbnailUrl || (job.latitude && job.longitude);
    
    // Calculate total hours worked from timesheets
    const totalHoursWorked = jobTimesheets.reduce((acc, ts) => {
      if (ts.clockInTime && ts.clockOutTime) {
        const clockIn = new Date(ts.clockInTime);
        const clockOut = new Date(ts.clockOutTime);
        const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
        return acc + hours;
      }
      return acc;
    }, 0);
    
    const content = (
      <>
        {/* Media Carousel */}
        {allMedia.length > 0 && (
          <div className="relative w-full aspect-video bg-muted overflow-hidden">
            {!mediaLoaded && allMedia[currentMediaIndex]?.type === "image" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            )}
            {allMedia[currentMediaIndex]?.type === "image" ? (
              <img 
                src={allMedia[currentMediaIndex].url} 
                alt="Job media"
                className={`w-full h-full object-cover transition-opacity ${mediaLoaded ? 'opacity-100' : 'opacity-0'}`}
                onLoad={() => setMediaLoaded(true)}
              />
            ) : (
              <video 
                src={allMedia[currentMediaIndex]?.url}
                className="w-full h-full object-cover"
                controls
                preload="metadata"
              />
            )}
            
            {allMedia.length > 1 && (
              <>
                <button
                  onClick={() => { setMediaLoaded(false); setCurrentMediaIndex(i => i > 0 ? i - 1 : allMedia.length - 1); }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white transition-opacity active:opacity-80"
                  data-testid="media-prev"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => { setMediaLoaded(false); setCurrentMediaIndex(i => i < allMedia.length - 1 ? i + 1 : 0); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white transition-opacity active:opacity-80"
                  data-testid="media-next"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                  {allMedia.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => { setMediaLoaded(false); setCurrentMediaIndex(idx); }}
                      className={`w-2 h-2 rounded-full transition-opacity ${idx === currentMediaIndex ? 'bg-white' : 'bg-white/50'}`}
                      data-testid={`media-dot-${idx}`}
                    />
                  ))}
                </div>
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/50 px-2 py-1 rounded text-white text-xs">
                  {allMedia[currentMediaIndex]?.type === "video" ? <Play className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                  {currentMediaIndex + 1}/{allMedia.length}
                </div>
              </>
            )}
          </div>
        )}
        
        <div className="p-4 space-y-4">
          {/* Title and Status */}
          <div>
            <h2 className="text-xl font-bold">{job.title}</h2>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <Badge className={`${status.color} text-white`}>{status.label}</Badge>
              <button 
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer ${jobTypeInfo.color}`}
                onClick={() => {
                  // Close parent dialog and open schedule info, storing return target
                  setScheduleInfoReturnTo(selectedJob);
                  setSelectedJob(null);
                  setScheduleInfoJob(job);
                }}
                data-testid="job-type-tag-dialog"
              >
                <JobTypeIcon className="w-3 h-3" />
                {jobTypeInfo.label}
              </button>
              {isAdmin && (
                <Badge 
                  variant="outline" 
                  className="cursor-pointer"
                  onClick={() => {
                    // Store return target, close current dialog, open reassign dialog
                    setReassignDialogReturnTo(selectedJob);
                    setSelectedJob(null);
                    setReassignDialogJob(selectedJob);
                  }}
                  data-testid="button-assigned-worker-badge"
                >
                  <Avatar className="w-4 h-4 mr-1">
                    <AvatarImage src={selectedJob.application.teamMember?.avatarUrl || undefined} />
                    <AvatarFallback className="text-[8px]">
                      {selectedJob.application.teamMember 
                        ? selectedJob.application.teamMember.firstName[0]
                        : "Y"}
                    </AvatarFallback>
                  </Avatar>
                  {selectedJob.application.teamMember 
                    ? `${selectedJob.application.teamMember.firstName} ${selectedJob.application.teamMember.lastName}`
                    : "Yourself"}
                </Badge>
              )}
              {!isAdmin && selectedJob.application.teamMember && (
                <Badge variant="outline">
                  <User className="w-3 h-3 mr-1" />
                  {selectedJob.application.teamMember.firstName} {selectedJob.application.teamMember.lastName}
                </Badge>
              )}
            </div>
          </div>

          {/* Job Details */}
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3 p-3 bg-secondary/50 rounded-lg">
              <Calendar className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <JobTimeDisplay job={job} showFullDate={true} />
            </div>
            <button
              type="button"
              onClick={() => openDirections(job, selectedJob)}
              className="w-full flex items-start gap-3 p-3 bg-secondary/50 rounded-lg hover:bg-secondary/80 transition-colors cursor-pointer text-left"
              data-testid="button-location-directions"
            >
              <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <span>{getFullAddress(job)}</span>
                {jobDriveTimes[job.id] && (
                  <p className="text-xs text-primary mt-0.5 flex items-center gap-1">
                    <Car className="w-3 h-3" />
                    {t("driveTime", { time: jobDriveTimes[job.id] })}
                  </p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground mt-0.5" />
            </button>
          </div>

          {/* Map View */}
          {hasMapLocation && (
            <div className="rounded-xl overflow-hidden border">
              <MiniJobMap
                job={{
                  id: job.id,
                  lat: parseFloat(job.latitude!),
                  lng: parseFloat(job.longitude!),
                  title: job.title,
                  trade: job.trade || undefined,
                  hourlyRate: job.hourlyRate || undefined,
                  city: job.city || undefined,
                  state: job.state || undefined,
                }}
                className="w-full h-40"
              />
            </div>
          )}

          {/* Company Info Card */}
          {companyProfile && (
            <div className="bg-card rounded-xl border p-4" data-testid="company-info-card">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                {t("postedBy")}
              </h3>
              <div className="flex items-center gap-3">
                <Avatar className="w-12 h-12 border">
                  <AvatarImage src={companyProfile.companyLogo || companyProfile.avatarUrl || undefined} />
                  <AvatarFallback>
                    {companyProfile.companyName?.[0] || companyProfile.firstName?.[0] || "C"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">
                    {companyProfile.companyName || `${companyProfile.firstName || ''} ${companyProfile.lastName || ''}`.trim() || "Company"}
                  </p>
                  {companyProfile.city && companyProfile.state && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {companyProfile.city}, {companyProfile.state}
                    </p>
                  )}
                  {companyProfile.averageRating && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                      {t("rating", { rating: Number(companyProfile.averageRating).toFixed(1) })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Description */}
          {job.description && (
            <div className="p-4 bg-secondary/30 rounded-xl">
              <h3 className="font-semibold text-sm mb-2">{t("jobDescription")}</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{job.description}</p>
            </div>
          )}

          {/* Timesheet History - Grouped by Day */}
          {jobTimesheets.length > 0 && (() => {
            // Group timesheets by day
            const groupedByDay = jobTimesheets.reduce((acc, ts) => {
              const clockIn = ts.clockInTime ? new Date(ts.clockInTime) : null;
              if (!clockIn) return acc;
              const dateKey = format(clockIn, "yyyy-MM-dd");
              if (!acc[dateKey]) {
                acc[dateKey] = { date: clockIn, entries: [] as TimesheetWithWorker[], totalHours: 0 };
              }
              acc[dateKey].entries.push(ts);
              // Add hours to daily total
              if (ts.clockInTime && ts.clockOutTime) {
                const clockOut = new Date(ts.clockOutTime);
                acc[dateKey].totalHours += (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
              }
              return acc;
            }, {} as Record<string, { date: Date; entries: TimesheetWithWorker[]; totalHours: number }>);
            
            const sortedDays = Object.keys(groupedByDay).sort((a, b) => b.localeCompare(a));
            
            return (
              <div className="bg-card rounded-xl border p-4" data-testid="timesheet-history">
                <h3 className="font-semibold text-sm mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    {t("clockInOutHistory")}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("totalHours", { hours: totalHoursWorked.toFixed(1) })}
                  </span>
                </h3>
                <ScrollArea className="max-h-64 pr-2">
                  <Accordion type="multiple" className="space-y-1" defaultValue={sortedDays.slice(0, 1)}>
                    {sortedDays.map((dateKey) => {
                      const day = groupedByDay[dateKey];
                      const hasActiveEntry = day.entries.some(ts => !ts.clockOutTime);
                      
                      return (
                        <AccordionItem key={dateKey} value={dateKey} className="border rounded-lg px-3 bg-secondary/30">
                          <AccordionTrigger className="py-2 hover:no-underline" data-testid={`accordion-day-${dateKey}`}>
                            <div className="flex items-center justify-between w-full pr-2">
                              <div className="flex items-center gap-2">
                                {hasActiveEntry ? (
                                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                ) : (
                                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                                )}
                                <span className="font-medium text-sm">
                                  {format(day.date, "EEE, MMM d")}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">
                                  {t("entryCount", { count: day.entries.length })}
                                </Badge>
                                <span className="text-xs font-semibold text-primary">
                                  {day.totalHours.toFixed(1)}h
                                </span>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-2">
                            <div className="space-y-2 pt-1">
                              {day.entries.map((ts) => {
                                const clockIn = ts.clockInTime ? new Date(ts.clockInTime) : null;
                                const clockOut = ts.clockOutTime ? new Date(ts.clockOutTime) : null;
                                const duration = clockIn && clockOut 
                                  ? ((clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60)).toFixed(1)
                                  : null;
                                const workerName = ts.workerFirstName && ts.workerLastName 
                                  ? `${ts.workerFirstName} ${ts.workerLastName}`
                                  : ts.workerFirstName || t("worker");
                                
                                return (
                                  <div 
                                    key={ts.id}
                                    className="flex items-center gap-3 py-2 px-3 bg-background rounded-lg text-sm"
                                    data-testid={`timesheet-${ts.id}`}
                                  >
                                    <Avatar className="w-8 h-8 flex-shrink-0">
                                      <AvatarImage src={ts.workerAvatarUrl || undefined} />
                                      <AvatarFallback className="text-xs">
                                        {ts.workerFirstName?.[0] || "W"}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium text-sm truncate">{workerName}</p>
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>
                                          {clockIn ? format(clockIn, "h:mm a") : ""}
                                          {" - "}
                                          {clockOut ? format(clockOut, "h:mm a") : t("active")}
                                        </span>
                                        {ts.workerPhone && (
                                          <>
                                            <span>·</span>
                                            <a 
                                              href={`tel:${ts.workerPhone}`}
                                              className="underline"
                                              onClick={(e) => e.stopPropagation()}
                                              data-testid={`link-phone-${ts.id}`}
                                            >
                                              {ts.workerPhone}
                                            </a>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      {duration ? (
                                        <span className="text-xs font-medium">{duration}h</span>
                                      ) : (
                                        <span className="text-xs text-green-500 font-medium">{t("inProgress")}</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </ScrollArea>
              </div>
            );
          })()}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 pt-2">
            {status.isFuture ? (
              <Button
                variant="secondary"
                onClick={() => setFutureJobDialog(job)}
                className="w-full h-12 opacity-60"
                data-testid="button-dialog-job-not-started"
              >
                <Clock className="w-4 h-4 mr-2" />
                {t("jobHasNotBegun")}
              </Button>
            ) : isClockedIn ? (
              <Button
                variant="destructive"
                onClick={() => handleClockOut(selectedJob.activeTimesheet!.id)}
                disabled={isClocking}
                className="w-full h-12"
                data-testid="button-dialog-clock-out"
              >
                {isClocking ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Square className="w-4 h-4 mr-2" />}
                {t("clockOut")}
              </Button>
            ) : canUserClockIn(selectedJob) ? (
              <Button
                onClick={() => handleClockIn(selectedJob)}
                disabled={isClocking || !!activeTimesheet}
                className="w-full h-12"
                data-testid="button-dialog-clock-in"
              >
                {isClocking ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                {t("clockIn")}
              </Button>
            ) : isAdmin ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    // Close the job dialog first, then open reassign
                    const jobToReassign = selectedJob;
                    setSelectedJob(null);
                    setTimeout(() => setReassignDialogJob(jobToReassign), 100);
                  }}
                  className="w-full h-12"
                  data-testid="button-dialog-reassign-worker"
                >
                  <Users className="w-4 h-4 mr-2" />
                  {t("reassignToClockIn")}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  {selectedJob.application.teamMember 
                    ? t("workerAssignedReassign", { firstName: selectedJob.application.teamMember.firstName, lastName: selectedJob.application.teamMember.lastName })
                    : t("selectWorkerToClockIn")}
                </p>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled
                className="w-full h-12 opacity-40"
                data-testid="button-dialog-clock-in-disabled"
              >
                <Play className="w-4 h-4 mr-2" />
                {t("clockIn")}
              </Button>
            )}

            <div className="flex gap-2">
              <Button
                variant={isFutureJob ? "secondary" : "outline"}
                onClick={() => { if (!isFutureJob) openDirections(job); }}
                disabled={isFutureJob}
                className={`flex-1 h-11 ${isFutureJob ? 'opacity-60' : ''}`}
                data-testid="button-directions"
              >
                <Car className="w-4 h-4 mr-2" />
                {jobDriveTimes[job.id] ? `${t("directions")} (${jobDriveTimes[job.id]} ${t("drive")})` : t("directions")}
              </Button>
              <Button
                variant="outline"
                onClick={() => goToChat(job.id)}
                className="flex-1 h-11"
                data-testid="button-job-chat"
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                {t("chat")}
              </Button>
            </div>
          </div>
        </div>
      </>
    );
    
    // Mobile: Bottom sheet, Desktop: Dialog
    if (isMobile) {
      return (
        <Sheet open={!!selectedJob} onOpenChange={() => { setSelectedJob(null); setCurrentMediaIndex(0); setMediaLoaded(false); }}>
          <SheetContent side="bottom" className="rounded-t-xl p-0 h-[90vh] overflow-hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>{job.title}</SheetTitle>
              <SheetDescription>{job.trade} - {getFullAddress(job)}</SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-full">
              {content}
            </ScrollArea>
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <ResponsiveDialog
        open={!!selectedJob}
        onOpenChange={() => { setSelectedJob(null); setCurrentMediaIndex(0); setMediaLoaded(false); }}
        title={job.title}
        description={`${job.trade} - ${getFullAddress(job)}`}
        contentClassName="max-w-lg p-0"
        headerClassName="sr-only"
      >
        {content}
      </ResponsiveDialog>
    );
  };

  const GeofenceErrorDialog = () => {
    if (!geofenceError) return null;
    
    const job = geofenceError.job;
    const hasMapLocation = (job as any).mapThumbnailUrl || (job.latitude && job.longitude);
    
    const handleCloseGeofenceError = () => {
      setGeofenceError(null);
      setEstimatedDriveTime(null);
      // Clear return target - don't reopen parent dialog
      setGeofenceErrorReturnTo(null);
    };
    
    const openDirectionsFromError = () => {
      setGeofenceError(null);
      setEstimatedDriveTime(null);
      setGeofenceErrorReturnTo(null); // Clear return target when navigating to directions
      setDirectionsJob(job);
    };
    
    return (
      <ResponsiveDialog
        open={!!geofenceError}
        onOpenChange={(open) => { if (!open) handleCloseGeofenceError(); }}
        title={
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="w-5 h-5" />
            {t("tooFarFromJobSite")}
          </div>
        }
        description={t("geofenceErrorDescription", { miles: geofenceError.requiredRadiusMiles })}
        contentClassName="max-w-md"
      >
        <div className="space-y-4">
            {/* Distance Info */}
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-destructive">{t("currentDistance")}</p>
                  <p className="text-2xl font-bold text-destructive">{t("milesAway", { distance: geofenceError.distanceMiles })}</p>
                </div>
                {estimatedDriveTime && (
                  <div className="text-right">
                    <p className="text-sm font-medium text-muted-foreground">{t("estDriveTime")}</p>
                    <p className="text-xl font-semibold">{estimatedDriveTime}</p>
                  </div>
                )}
              </div>
            </div>
            
            {/* Job Info */}
            <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
              <h4 className="font-medium">{job.title}</h4>
              <div className="flex items-start gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <JobTimeDisplay job={job} showFullDate={true} />
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <MapPin className="w-4 h-4 flex-shrink-0" />
                {job.address || `${job.city}, ${job.state}`}
              </p>
            </div>
            
            {/* Map */}
            {hasMapLocation && (
              <div className="rounded-lg overflow-hidden border">
                {(job as any).mapThumbnailUrl ? (
                  <img src={(job as any).mapThumbnailUrl} alt="Job location" className="w-full h-32 object-cover" />
                ) : (
                  <MiniJobMap
                    job={{
                      id: job.id,
                      lat: parseFloat(job.latitude!),
                      lng: parseFloat(job.longitude!),
                      title: job.title,
                      trade: job.trade || undefined,
                      hourlyRate: job.hourlyRate || undefined,
                      city: job.city || undefined,
                      state: job.state || undefined,
                    }}
                    className="w-full h-32"
                  />
                )}
              </div>
            )}
            
            {/* Instructions */}
            <p className="text-sm text-muted-foreground text-center">
              {t("geofenceInstructions")}
            </p>
            
            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleCloseGeofenceError}
                className="flex-1"
                data-testid="button-close-geofence-dialog"
              >
                {t("close")}
              </Button>
              <Button
                onClick={openDirectionsFromError}
                className="flex-1"
                data-testid="button-get-directions"
              >
                <Car className="w-4 h-4 mr-2" />
                {t("getDirections")}
              </Button>
            </div>
          </div>
      </ResponsiveDialog>
    );
  };

  const FutureJobDialog = () => {
    if (!futureJobDialog) return null;
    
    const job = futureJobDialog;
    const startDate = job.startDate ? new Date(job.startDate) : null;
    const { startTime } = getTimeRange(job);
    
    return (
      <Dialog open={!!futureJobDialog} onOpenChange={() => setFutureJobDialog(null)}>
        <DialogContent className="max-w-sm" data-testid="future-job-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              {t("jobHasNotBegun")}
            </DialogTitle>
            <DialogDescription>
              {t("futureJobDescription")}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Job Info */}
            <div className="bg-secondary/50 rounded-lg p-4">
              <h4 className="font-semibold mb-2">{job.title}</h4>
              {startDate && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span>
                    {startTime ? t("startsAtWithTime", { date: format(startDate, "EEEE, MMMM d, yyyy"), time: startTime }) : t("startsAt", { date: format(startDate, "EEEE, MMMM d, yyyy") })}
                  </span>
                </div>
              )}
              {job.address && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                  <MapPin className="w-4 h-4" />
                  <span>{getFullAddress(job)}</span>
                </div>
              )}
            </div>
            
            {/* Instructions */}
            <p className="text-sm text-muted-foreground text-center">
              {t("comeBackOnStartDate")}
            </p>
            
            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setFutureJobDialog(null)}
                className="flex-1"
                data-testid="button-close-future-job-dialog"
              >
                {t("close")}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setFutureJobDialog(null); openDirections(job); }}
                className="flex-1"
                data-testid="button-preview-directions"
              >
                <Car className="w-4 h-4 mr-2" />
                {t("directions")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const LocationErrorDialog = () => {
    if (!locationError) return null;
    
    const device = detectDevice();
    
    const getDeviceInstructions = () => {
      switch (device) {
        case "ios":
          return {
            title: t("deviceIos"),
            steps: locationError.type === "permission" ? [
              t("locationErrorIosPermissionStep1"),
              t("locationErrorIosPermissionStep2"),
              t("locationErrorIosPermissionStep3"),
              t("locationErrorIosPermissionStep4")
            ] : locationError.type === "timeout" ? [
              t("locationErrorIosTimeoutStep1"),
              t("locationErrorIosTimeoutStep2"),
              t("locationErrorIosTimeoutStep3"),
              t("locationErrorIosTimeoutStep4")
            ] : [
              t("locationErrorIosUnsupportedStep1"),
              t("locationErrorIosUnsupportedStep2"),
              t("locationErrorIosUnsupportedStep3"),
              t("locationErrorIosUnsupportedStep4")
            ]
          };
        case "android":
          return {
            title: t("deviceAndroid"),
            steps: locationError.type === "permission" ? [
              t("locationErrorAndroidPermissionStep1"),
              t("locationErrorAndroidPermissionStep2"),
              t("locationErrorAndroidPermissionStep3"),
              t("locationErrorAndroidPermissionStep4"),
              t("locationErrorAndroidPermissionStep5")
            ] : locationError.type === "timeout" ? [
              t("locationErrorAndroidTimeoutStep1"),
              t("locationErrorAndroidTimeoutStep2"),
              t("locationErrorAndroidTimeoutStep3"),
              t("locationErrorAndroidTimeoutStep4")
            ] : [
              t("locationErrorAndroidUnsupportedStep1"),
              t("locationErrorAndroidUnsupportedStep2"),
              t("locationErrorAndroidUnsupportedStep3"),
              t("locationErrorAndroidUnsupportedStep4")
            ]
          };
        default:
          return {
            title: t("deviceBrowser"),
            steps: locationError.type === "permission" ? [
              t("locationErrorBrowserPermissionStep1"),
              t("locationErrorBrowserPermissionStep2"),
              t("locationErrorBrowserPermissionStep3"),
              t("locationErrorBrowserPermissionStep4")
            ] : locationError.type === "timeout" ? [
              t("locationErrorBrowserTimeoutStep1"),
              t("locationErrorBrowserTimeoutStep2"),
              t("locationErrorBrowserTimeoutStep3"),
              t("locationErrorBrowserTimeoutStep4")
            ] : [
              t("locationErrorBrowserUnsupportedStep1"),
              t("locationErrorBrowserUnsupportedStep2"),
              t("locationErrorBrowserUnsupportedStep3"),
              t("locationErrorBrowserUnsupportedStep4")
            ]
          };
      }
    };
    
    const instructions = getDeviceInstructions();
    
    const getErrorIcon = () => {
      switch (locationError.type) {
        case "permission":
          return <AlertCircle className="w-6 h-6 text-destructive" />;
        case "timeout":
          return <Clock className="w-6 h-6 text-amber-500" />;
        default:
          return <MapPin className="w-6 h-6 text-destructive" />;
      }
    };
    
    const getErrorTitle = () => {
      switch (locationError.type) {
        case "permission":
          return t("locationPermissionRequired");
        case "timeout":
          return t("locationRequestTimedOut");
        case "unsupported":
          return t("locationNotSupported");
        default:
          return t("locationUnavailable");
      }
    };
    
    return (
      <Dialog open={!!locationError} onOpenChange={() => setLocationError(null)}>
        <DialogContent className="max-w-md" data-testid="location-error-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {getErrorIcon()}
              {getErrorTitle()}
            </DialogTitle>
            <DialogDescription>
              {locationError.message} {t("followStepsToFix")}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-secondary/50 rounded-lg p-4">
              <h4 className="font-medium flex items-center gap-2 mb-3">
                {device === "ios" && t("deviceIos")}
                {device === "android" && t("deviceAndroid")}
                {device === "browser" && t("deviceBrowser")}
                <Badge variant="outline" className="text-xs">
                  {device === "ios" ? "iOS" : device === "android" ? "Android" : "Web"}
                </Badge>
              </h4>
              <ol className="space-y-2 text-sm">
                {instructions.steps.map((step, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">
                      {index + 1}
                    </span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            
            {locationError.type === "timeout" && (
              <p className="text-sm text-muted-foreground text-center">
                {t("gpsSignalWeak")}
              </p>
            )}
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setLocationError(null)}
                className="flex-1"
                data-testid="button-close-location-error"
              >
                {t("close")}
              </Button>
              <Button
                onClick={() => {
                  setLocationError(null);
                  // Try again by triggering a re-clock
                  if (selectedJob) {
                    handleClockIn(selectedJob);
                  }
                }}
                className="flex-1"
                data-testid="button-retry-location"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {t("tryAgain")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const DirectionsSheet = () => {
    if (!directionsJob) return null;
    
    const driveTime = jobDriveTimes[directionsJob.id];
    
    const content = (
      <div className="space-y-4">
        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full h-14 justify-start gap-4"
            onClick={() => openWaze(directionsJob)}
            data-testid="button-open-waze"
          >
            <div className="w-10 h-10 rounded-full bg-[#33CCFF] flex items-center justify-center">
              <span className="text-white font-bold text-lg">W</span>
            </div>
            <div className="text-left">
              <p className="font-medium">{t("waze")}</p>
              <p className="text-xs text-muted-foreground">{t("realTimeTrafficNavigation")}</p>
            </div>
          </Button>
          
          <Button
            variant="outline"
            className="w-full h-14 justify-start gap-4"
            onClick={() => openGoogleMaps(directionsJob)}
            data-testid="button-open-google-maps"
          >
            <div className="w-10 h-10 rounded-full bg-[#4285F4] flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div className="text-left">
              <p className="font-medium">{t("googleMaps")}</p>
              <p className="text-xs text-muted-foreground">{t("navigateWithGoogle")}</p>
            </div>
          </Button>
          
          <Button
            variant="outline"
            className="w-full h-14 justify-start gap-4"
            onClick={() => openAppleMaps(directionsJob)}
            data-testid="button-open-apple-maps"
          >
            <div className="w-10 h-10 rounded-full bg-gray-800 dark:bg-gray-200 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white dark:text-gray-800" />
            </div>
            <div className="text-left">
              <p className="font-medium">{t("appleMaps")}</p>
              <p className="text-xs text-muted-foreground">{t("navigateWithApple")}</p>
            </div>
          </Button>
        </div>
        
        <Button
          variant="ghost"
          className="w-full"
          onClick={closeDirections}
          data-testid="button-cancel-directions"
        >
          {t("cancel")}
        </Button>
      </div>
    );

    // Mobile: Bottom sheet, Desktop: Centered dialog (z-[60] so it appears above the job-details popup)
    if (isMobile) {
      return (
        <Sheet open={!!directionsJob} onOpenChange={closeDirections}>
          <SheetContent side="bottom" className="z-[60] rounded-t-xl px-4 pb-8" overlayClassName="z-[60]">
            <SheetHeader className="text-left mb-4">
              <SheetTitle>{t("chooseNavigationApp")}</SheetTitle>
              <SheetDescription>
                {driveTime ? t("driveTimeToJob", { time: driveTime, title: directionsJob.title }) : t("getDirectionsToJob", { title: directionsJob.title })}
              </SheetDescription>
            </SheetHeader>
            {content}
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <Dialog open={!!directionsJob} onOpenChange={closeDirections}>
        <DialogContent className="z-[60] max-w-sm" overlayClassName="z-[60]">
          <DialogHeader>
            <DialogTitle>{t("chooseNavigationApp")}</DialogTitle>
            <DialogDescription>
              {driveTime ? t("driveTimeToJob", { time: driveTime, title: directionsJob.title }) : t("getDirectionsToJob", { title: directionsJob.title })}
            </DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  };

  const ScheduleInfoSheet = () => {
    if (!scheduleInfoJob) return null;
    
    const job = scheduleInfoJob;
    const jobTypeInfo = getJobTypeInfo(job);
    const JobTypeIcon = jobTypeInfo.icon;
    const isOnDemand = job.isOnDemand || job.jobType === "on_demand";
    const isRecurring = job.jobType === "recurring";
    
    // Get date and time info
    const startDate = job.startDate ? parseISO(job.startDate.toString()) : null;
    const dateLabel = startDate ? getRelativeDateLabel(startDate) : t("notSpecified");
    const { startTime, endTime } = getTimeRange(job);
    const scheduleDays = job.scheduleDays as string[] | undefined;
    
    // Build full schedule display
    const getScheduleTitle = () => {
      if (isOnDemand) return t("onDemandSchedule");
      if (isRecurring) return t("recurringSchedule");
      return t("oneDayAssignment");
    };
    
    const getScheduleDescription = () => {
      if (isOnDemand) {
        const address = getFullAddress(job) || "the job site";
        const arriveTime = startTime || "the scheduled time";
        return t("onDemandScheduleDescription", { address, arriveTime });
      }
      if (isRecurring) return t("recurringScheduleDescription");
      return t("oneDayAssignmentDescription");
    };

    const content = (
      <div className="space-y-4">
        {/* Schedule Card */}
        <div className="bg-secondary/50 rounded-xl p-4 space-y-3">
          {/* Date */}
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("date")}</p>
              <p className="font-semibold">{dateLabel}</p>
            </div>
          </div>
          
          {/* Time - different label for on-demand vs scheduled */}
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {isOnDemand ? t("arriveBy") : t("hours")}
              </p>
              <p className="font-semibold">
                {isOnDemand 
                  ? (startTime || t("notSpecified"))
                  : (startTime && endTime ? t("timeRange", { start: startTime, end: endTime }) : startTime || t("notSpecified"))
                }
              </p>
            </div>
          </div>
          
          {/* Recurring Days */}
          {isRecurring && scheduleDays && scheduleDays.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("repeatsOn")}</p>
              <div className="flex flex-wrap gap-2">
                {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => {
                  const isActive = scheduleDays.map(d => d.toLowerCase()).includes(day);
                  return (
                    <span
                      key={day}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                        isActive 
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" 
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {getDayAbbreviation(day)}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Estimated Hours */}
          {job.estimatedHours && (
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <Briefcase className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("estimatedDuration")}</p>
                <p className="font-semibold">{job.estimatedHours} hours</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Summary */}
        <div className="text-center text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          {isOnDemand && t("onDemandSummary")}
          {isRecurring && t("recurringSummary", { days: scheduleDays?.length || 0 })}
          {!isOnDemand && !isRecurring && t("oneDaySummary", { date: dateLabel })}
        </div>
        
        <Button
          variant="ghost"
          className="w-full"
          onClick={handleCloseScheduleInfo}
          data-testid="button-close-schedule-info"
        >
          {t("close")}
        </Button>
      </div>
    );
    
    // Handler to close schedule info and return to parent dialog
    function handleCloseScheduleInfo() {
      setScheduleInfoJob(null);
      if (scheduleInfoReturnTo) {
        setSelectedJob(scheduleInfoReturnTo);
        setScheduleInfoReturnTo(null);
      }
    }

    // Mobile: Bottom sheet, Desktop: Centered dialog
    if (isMobile) {
      return (
        <Sheet open={!!scheduleInfoJob} onOpenChange={(open) => { if (!open) handleCloseScheduleInfo(); }}>
          <SheetContent side="bottom" className="rounded-t-xl px-4 pb-8">
            <SheetHeader className="text-left mb-4">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-full ${jobTypeInfo.color}`}>
                  <JobTypeIcon className="w-5 h-5" />
                </div>
                <SheetTitle>{getScheduleTitle()}</SheetTitle>
              </div>
              <SheetDescription>{getScheduleDescription()}</SheetDescription>
            </SheetHeader>
            {content}
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <Dialog open={!!scheduleInfoJob} onOpenChange={(open) => { if (!open) handleCloseScheduleInfo(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className={`p-2 rounded-full ${jobTypeInfo.color}`}>
                <JobTypeIcon className="w-5 h-5" />
              </div>
              <DialogTitle>{getScheduleTitle()}</DialogTitle>
            </div>
            <DialogDescription>{getScheduleDescription()}</DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  };

  const ReassignWorkerDialog = () => {
    if (!reassignDialogJob) return null;
    
    const job = reassignDialogJob.application.job;
    const currentAssignee = reassignDialogJob.application.teamMember;
    
    const handleReassignToSelf = () => {
      reassignTeamMemberMutation.mutate({
        applicationId: reassignDialogJob.application.id,
        teamMemberId: null,
      });
    };
    
    const handleReassignToMember = (memberId: number) => {
      reassignTeamMemberMutation.mutate({
        applicationId: reassignDialogJob.application.id,
        teamMemberId: memberId,
      });
    };
    
    const content = (
      <div className="py-4 space-y-4">
        {/* Rate notice */}
        <p className="text-xs text-muted-foreground">
          {t("reassigningWorkerRateNotice")}
        </p>
        
        {/* Current assignment info */}
        <div className="bg-secondary/50 rounded-lg p-3">
          <p className="text-sm text-muted-foreground mb-1">{t("currentlyAssignedTo")}</p>
          <div className="flex items-center gap-2">
            <Avatar className="w-8 h-8">
              <AvatarImage src={currentAssignee?.avatarUrl || undefined} />
              <AvatarFallback>
                {currentAssignee ? currentAssignee.firstName[0] : "Y"}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium">
              {currentAssignee 
                ? `${currentAssignee.firstName} ${currentAssignee.lastName}`
                : "Yourself"}
            </span>
          </div>
        </div>
        
        {/* Reassign to self option (if currently assigned to someone else) */}
        {currentAssignee && (
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-12"
            onClick={handleReassignToSelf}
            disabled={reassignTeamMemberMutation.isPending}
            data-testid="button-reassign-self"
          >
            <RefreshCw className="w-5 h-5" />
            <span className="flex-1 text-left">{t("assignToMyself")}</span>
          </Button>
        )}
        
        {/* Team members list */}
        {activeTeamMembers.length > 0 && (
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{t("reassignToTeamMember")}</p>
            <div className="min-w-0 space-y-2 max-h-48 overflow-y-auto overflow-x-hidden">
              {activeTeamMembers
                .filter(m => m.id !== currentAssignee?.id)
                .map(member => (
                  <Button
                    key={member.id}
                    variant="outline"
                    className="min-w-0 w-full justify-start gap-3 h-12"
                    onClick={() => handleReassignToMember(member.id)}
                    disabled={reassignTeamMemberMutation.isPending}
                    data-testid={`button-reassign-${member.id}`}
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={member.avatarUrl || undefined} />
                      <AvatarFallback>{member.firstName[0]}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-left">{member.firstName} {member.lastName}</span>
                  </Button>
                ))}
            </div>
          </div>
        )}
        
        {/* Invite new team member option */}
        <div className="pt-2 border-t">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-12 text-primary"
            onClick={() => {
              setReassignDialogJob(null);
              setLocation("/dashboard/team");
            }}
            data-testid="button-invite-team-member"
          >
            <UserPlus className="w-5 h-5" />
            <span className="flex-1 text-left">{t("addNewTeamMember")}</span>
          </Button>
        </div>
      </div>
    );
    
    const handleReassignDialogClose = () => {
      setReassignDialogJob(null);
      // Reopen parent dialog if we came from one
      if (reassignDialogReturnTo) {
        setSelectedJob(reassignDialogReturnTo);
        setReassignDialogReturnTo(null);
      }
    };
    
    // Use bottom sheet on mobile, dialog on desktop
    if (isMobile) {
      return (
        <Sheet open={!!reassignDialogJob} onOpenChange={(open) => { if (!open) handleReassignDialogClose(); }}>
          <SheetContent side="bottom" className="rounded-t-xl">
            <SheetHeader>
              <SheetTitle>{t("reassignWorker")}</SheetTitle>
              <SheetDescription>
                {t("reassignWorkerDescription", { title: job.title })}
              </SheetDescription>
            </SheetHeader>
            {content}
          </SheetContent>
        </Sheet>
      );
    }
    
    return (
      <Dialog open={!!reassignDialogJob} onOpenChange={(open) => { if (!open) handleReassignDialogClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("reassignWorker")}</DialogTitle>
            <DialogDescription>
              {t("reassignWorkerDescription", { title: job.title })}
            </DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Geofence Error Dialog */}
      <GeofenceErrorDialog />
      
      {/* Future Job Dialog */}
      <FutureJobDialog />
      
      {/* Location Error Dialog */}
      <LocationErrorDialog />
      
      {/* Reassign Worker Dialog */}
      <ReassignWorkerDialog />
      
      {/* Directions Navigation Sheet */}
      <DirectionsSheet />
      
      {/* Schedule Info Sheet */}
      <ScheduleInfoSheet />
      
      {/* Global Worker Header - Full navigation with tabs */}
      <header className="flex flex-col sticky top-0 z-50 bg-background border-b border-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 md:gap-6">
            <span 
              className="text-lg md:text-xl font-bold cursor-pointer hover:text-primary transition-colors"
              onClick={() => setLocation("/dashboard/today")}
              data-testid="logo-link"
            >
              {tNav("nav.brandName")}
            </span>
            {/* Desktop navigation - hidden on mobile (nav is in footer) */}
            {!isMobile && (
              <nav className="flex items-center gap-1">
                {/* Find and Jobs tabs - hidden for employees */}
                {!isEmployee && (
                  <>
                    <Button 
                      variant="ghost" 
                      onClick={() => setLocation("/dashboard")}
                      className="gap-2 px-3"
                      data-testid="nav-find"
                    >
                      <Search className="w-4 h-4" /> 
                      <span>{tNav("nav.find")}</span>
                    </Button>
                    <Button 
                      variant="ghost" 
                      onClick={() => setLocation("/dashboard/jobs")}
                      className="gap-2 px-3"
                      data-testid="nav-jobs"
                    >
                      <Briefcase className="w-4 h-4" /> 
                      <span>{tNav("nav.jobs")}</span>
                    </Button>
                  </>
                )}
                <Button 
                  variant="secondary"
                  className="gap-2 px-3"
                  data-testid="nav-today"
                >
                  <Clock className="w-4 h-4" /> 
                  <span>{tNav("nav.today")}</span>
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => setLocation("/dashboard/calendar")}
                  className="gap-2 px-3"
                  data-testid="nav-calendar"
                >
                  <Calendar className="w-4 h-4" /> 
                  <span>{tNav("nav.calendar")}</span>
                </Button>
                <Button 
                  variant="ghost"
                  onClick={() => setLocation("/dashboard/chats")}
                  className="gap-2 px-3"
                  data-testid="nav-chats"
                >
                  <MessageSquare className="w-4 h-4" /> 
                  <span>{tNav("nav.messages")}</span>
                </Button>
              </nav>
            )}
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {/* Notifications */}
            <Popover>
              <PopoverTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="relative"
                  data-testid="notifications-button"
                >
                  <Bell className="w-5 h-5" />
                  {notifications && notifications.filter((n: any) => !n.isRead).length > 0 && (
                    <span 
                      className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center"
                      data-testid="notifications-unread-count"
                    >
                      {notifications.filter((n: any) => !n.isRead).length > 9 ? "9+" : notifications.filter((n: any) => !n.isRead).length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <h3 className="font-semibold">{tNotifications("title")}</h3>
                </div>
                <ScrollArea className="max-h-[400px]" data-testid="notifications-list">
                  {!notifications || notifications.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground" data-testid="notifications-empty">
                      <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">{tEmpty("noNotifications")}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {notifications.slice(0, 20).map((notif: any) => (
                        <div 
                          key={notif.id}
                          className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${!notif.isRead ? "bg-primary/5" : ""}`}
                          onClick={() => {
                            // Use deep linking based on notification type and data
                            const data = notif.data || {};
                            if (notif.url) {
                              setLocation(notif.url);
                              return;
                            }
                            
                            if (notif.type === "new_message") {
                              setLocation(data.jobId ? `/accepted-job/${data.jobId}` : "/dashboard/chats");
                            } else if (notif.type === "new_job_in_territory" || notif.type === "new_job_posted") {
                              setLocation(data.jobId ? `/jobs/${data.jobId}` : "/dashboard/find");
                            } else if (notif.type === "application_approved" || notif.type === "job_application_accepted") {
                              setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=active` : "/dashboard/jobs");
                            } else if (notif.type === "timesheet_approved" || notif.type === "payment_received") {
                              setLocation(data.timesheetId ? `/dashboard/settings/payouts?timesheetId=${data.timesheetId}` : "/dashboard/settings/payouts");
                            } else if (notif.type === "job_reminder" || notif.type === "job_start_reminder") {
                              setLocation(data.jobId ? `/dashboard/calendar?jobId=${data.jobId}` : "/dashboard/calendar");
                            } else {
                              setLocation("/dashboard/today");
                            }
                          }}
                          data-testid={`notification-item-${notif.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-muted">
                              <Bell className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm ${!notif.isRead ? "font-medium" : ""}`}>{notif.title}</p>
                              {notif.message && (
                                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{notif.message}</p>
                              )}
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                              </p>
                            </div>
                            {!notif.isRead && (
                              <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
            {isEmployee ? (
              <>
              <Popover>
                <PopoverTrigger asChild>
                  <Avatar 
                    className="w-8 h-8 md:w-9 md:h-9 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                    data-testid="header-avatar"
                  >
                    <AvatarImage src={displayAvatarUrl || undefined} />
                    <AvatarFallback>{displayName.firstName?.[0]}{displayName.lastName?.[0]}</AvatarFallback>
                  </Avatar>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="p-4 space-y-4">
                    <div className="flex items-center gap-4">
                      <Avatar className="w-16 h-16">
                        <AvatarImage src={displayAvatarUrl || undefined} />
                        <AvatarFallback className="text-lg">
                          {displayName.firstName?.[0]}{displayName.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate">
                          {displayName.firstName} {displayName.lastName}
                        </h3>
                        <p className="text-sm text-muted-foreground truncate">
                          {profile?.email}
                        </p>
                      </div>
                    </div>
                    <Separator />
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={() => setShowTeammateSettings(true)}
                      data-testid="button-settings"
                    >
                      <Settings className="w-4 h-4" />
                      Settings
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={() => logout()}
                      disabled={isLoggingOut}
                      data-testid="button-logout"
                    >
                      <LogOut className="w-4 h-4" />
                      {isLoggingOut ? "Logging out..." : "Log Out"}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <TeammateSettingsDialog
                open={showTeammateSettings}
                onOpenChange={setShowTeammateSettings}
                profileId={profile?.id}
              />
              </>
            ) : (
              <Avatar 
                className="w-8 h-8 md:w-9 md:h-9 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                onClick={() => setLocation("/dashboard/menu")}
                data-testid="header-avatar"
              >
                <AvatarImage src={displayAvatarUrl || undefined} />
                <AvatarFallback>{displayName.firstName?.[0]}{displayName.lastName?.[0]}</AvatarFallback>
              </Avatar>
            )}
          </div>
        </div>
      </header>

      {/* Active Job Banner - Sticky when clocked in */}
      {clockedInAssignment && (
        <button
          type="button"
          onClick={() => setShowClockOutSheet(true)}
          className="sticky top-[60px] z-40 w-full bg-green-600 dark:bg-green-700 text-white py-2.5 px-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-green-700 dark:hover:bg-green-800 transition-colors"
          data-testid="clocked-in-banner"
          aria-label={t("viewActiveJobDetailsAndClockOut")}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {clockedInAssignment.application.job.title}
              </p>
              <p className="text-xs text-green-100 truncate">
                {t("clockedInAt")} {clockedInAssignment.activeTimesheet?.clockInTime 
                  ? format(new Date(clockedInAssignment.activeTimesheet.clockInTime), "h:mm a")
                  : "—"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right">
              <p className="text-lg font-bold font-mono">{clockedInDuration || "0s"}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-green-200" />
          </div>
        </button>
      )}

      {/* Clock Out Sheet */}
      <Sheet open={showClockOutSheet} onOpenChange={setShowClockOutSheet}>
        <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-xl">
          {clockedInAssignment && (() => {
            const job = clockedInAssignment.application.job;
            const jobCompanyProfile = job.companyId ? companyProfiles[job.companyId] : null;
            const clockInTime = clockedInAssignment.activeTimesheet?.clockInTime 
              ? new Date(clockedInAssignment.activeTimesheet.clockInTime) 
              : null;
            const isClockingOut = clockingJobId === clockedInAssignment.activeTimesheet?.id;
            
            return (
              <>
                <SheetHeader className="pb-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                    <SheetTitle className="text-lg">{t("activeJob")}</SheetTitle>
                  </div>
                  <SheetDescription className="sr-only">
                    {t("viewDetailsOfCurrentlyClockedInJob")}
                  </SheetDescription>
                </SheetHeader>
                
                <div className="py-4 space-y-4">
                  {/* Job Info Card */}
                  <div className="flex items-start gap-3">
                    <Avatar className="w-12 h-12 border border-border">
                      <AvatarImage src={jobCompanyProfile?.companyLogo || jobCompanyProfile?.avatarUrl || undefined} />
                      <AvatarFallback className="bg-secondary">
                        {jobCompanyProfile?.companyName?.[0] || <Building2 className="w-5 h-5" />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base">{job.title}</h3>
                      {jobCompanyProfile?.companyName && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" />
                          {jobCompanyProfile.companyName}
                        </p>
                      )}
                      {job.locationName && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {job.locationName}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {/* Clock In Stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t("clockInTime")}</p>
                      <p className="text-lg font-semibold">
                        {clockInTime ? format(clockInTime, "h:mm a") : "—"}
                      </p>
                    </div>
                    <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-center border border-green-200 dark:border-green-800">
                      <p className="text-xs text-green-700 dark:text-green-300 uppercase tracking-wide mb-1">{t("duration")}</p>
                      <p className="text-lg font-bold font-mono text-green-700 dark:text-green-300">
                        {clockedInDuration || "0s"}
                      </p>
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex flex-col gap-2 pt-2">
                    <Button
                      variant="destructive"
                      size="lg"
                      className="w-full gap-2"
                      onClick={() => {
                        if (clockedInAssignment.activeTimesheet?.id) {
                          handleClockOut(clockedInAssignment.activeTimesheet.id);
                          setShowClockOutSheet(false);
                        }
                      }}
                      disabled={isClockingOut}
                      data-testid="clock-out-button"
                    >
                      {isClockingOut ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                      {isClockingOut ? t("clockingOut") : t("worker.clockOut")}
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full gap-2"
                      onClick={() => {
                        setShowClockOutSheet(false);
                        setSelectedJob(clockedInAssignment);
                      }}
                      data-testid="view-job-details-button"
                    >
                      {t("viewFullJobDetails")}
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Time Frame Filter - Sticky pill-shaped slider with counts */}
      <div className={`sticky z-40 bg-background border-b border-border py-3 ${clockedInAssignment ? "top-[116px]" : "top-[60px]"}`}>
        <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4">
          <button
            onClick={() => setTimeFrame("today")}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              timeFrame === "today" 
                ? "bg-primary text-primary-foreground" 
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
            data-testid="tab-today"
          >
            {t("today")}
            {todayCount > 0 && (
              <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-xs flex items-center justify-center ${
                timeFrame === "today" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"
              }`}>
                {todayCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTimeFrame("week")}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              timeFrame === "week" 
                ? "bg-primary text-primary-foreground" 
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
            data-testid="tab-week"
          >
            {t("thisWeek")}
            {weekCount > 0 && (
              <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-xs flex items-center justify-center ${
                timeFrame === "week" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"
              }`}>
                {weekCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTimeFrame("month")}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              timeFrame === "month" 
                ? "bg-primary text-primary-foreground" 
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
            data-testid="tab-month"
          >
            {t("thisMonth")}
            {monthCount > 0 && (
              <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-xs flex items-center justify-center ${
                timeFrame === "month" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"
              }`}>
                {monthCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <ScrollArea className={isMobile ? `h-[calc(100vh-140px-56px${clockedInAssignment ? "-56px" : ""})]` : "h-auto"}>
        <div className="px-4 py-6 pb-20 md:pb-6">
          {isLoading ? (
            <div className="space-y-4 py-4">
              {[1, 2, 3].map((i) => (
                <SkeletonCard key={i} showImage={false} />
              ))}
            </div>
          ) : filteredAssignments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
                <Calendar className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">{t("noJobsScheduled")}</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                {timeFrame === "today" 
                  ? t("noJobsScheduledToday")
                  : timeFrame === "week"
                  ? t("noJobsScheduledWeek")
                  : t("noJobsScheduledMonth")}
              </p>
            </div>
          ) : (
            <>
              {timeFrame === "today" && <DayTimeline assignments={filteredAssignments} />}
              {timeFrame === "week" && <WeekTimeline assignments={filteredAssignments} />}
              {timeFrame === "month" && <MonthTimeline assignments={filteredAssignments} />}
            </>
          )}
        </div>
      </ScrollArea>

      <JobDetailsDialog />

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 h-14">
        <div className="flex items-center justify-around h-full">
          {/* Order: Today, Find, Jobs, Calendar, Chats */}
          <button
            onClick={() => setLocation("/dashboard/today")}
            className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-primary"
            data-testid="mobile-nav-today"
          >
            <Clock className="w-5 h-5" />
            <span className="text-[11px] font-medium">{tNav("nav.today")}</span>
          </button>
          {/* Find and Jobs tabs - hidden for employees */}
          {!isEmployee && (
            <>
              <button
                onClick={() => setLocation("/dashboard")}
                className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
                data-testid="mobile-nav-find"
              >
                <Search className="w-5 h-5" />
                <span className="text-[11px] font-medium">{tNav("nav.find")}</span>
              </button>
              <button
                onClick={() => setLocation("/dashboard/jobs")}
                className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
                data-testid="mobile-nav-jobs"
              >
                <Briefcase className="w-5 h-5" />
                <span className="text-[11px] font-medium">{tNav("nav.jobs")}</span>
              </button>
            </>
          )}
          <button
            onClick={() => setLocation("/dashboard/calendar")}
            className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
            data-testid="mobile-nav-calendar"
          >
            <Calendar className="w-5 h-5" />
            <span className="text-[11px] font-medium">{tNav("nav.calendar")}</span>
          </button>
          <button
            onClick={() => setLocation("/dashboard/chats")}
            className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
            data-testid="mobile-nav-chats"
          >
            <MessageSquare className="w-5 h-5" />
            <span className="text-[11px] font-medium">{tNav("nav.messages")}</span>
          </button>
          {isEmployee && (
            <>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
                  data-testid="mobile-nav-profile"
                >
                  <Avatar className="w-5 h-5">
                    <AvatarImage src={displayAvatarUrl || undefined} />
                    <AvatarFallback className="text-[10px]">
                      {displayName.firstName?.[0]}{displayName.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[11px] font-medium">{tNav("nav.profile") || "Profile"}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end" side="top">
                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="w-16 h-16">
                      <AvatarImage src={displayAvatarUrl || undefined} />
                      <AvatarFallback className="text-lg">
                        {displayName.firstName?.[0]}{displayName.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg truncate">
                        {displayName.firstName} {displayName.lastName}
                      </h3>
                      <p className="text-sm text-muted-foreground truncate">
                        {profile?.email}
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={() => setShowTeammateSettings(true)}
                    data-testid="button-settings-mobile"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={() => logout()}
                    disabled={isLoggingOut}
                    data-testid="button-logout-mobile"
                  >
                    <LogOut className="w-4 h-4" />
                    {isLoggingOut ? "Logging out..." : "Log Out"}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <TeammateSettingsDialog
              open={showTeammateSettings}
              onOpenChange={setShowTeammateSettings}
              profileId={profile?.id}
            />
            </>
          )}
        </div>
      </nav>
    </div>
  );
}
