import { useState, useMemo, useEffect, useImperativeHandle, forwardRef, useCallback } from "react";
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, isTomorrow, isSameMonth, getDay, differenceInDays, isBefore, isAfter, startOfDay } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { usePersistentFilter, usePersistentSetFilter } from "@/hooks/use-persistent-filter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MobilePopup } from "@/components/ui/mobile-popup";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ChevronLeft, ChevronRight, Settings, Download, Copy, Link, Check, Loader2, Calendar as CalendarIcon, MapPin, Clock, Play, Square, Car, MessageSquare, Building2, Star, CheckCircle2, Image as ImageIcon, User, Calendar, Repeat, Briefcase, AlertCircle, Zap, CalendarDays, Navigation, Map as MapIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import type { Job, Application, WorkerTeamMember, Profile, Timesheet } from "@shared/schema";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { JobDetailsSheet } from "./JobDetailsSheet";
import { EnhancedJobDialog } from "./EnhancedJobDialog";
import { MiniJobMap } from "./JobsMap";
import { CalendarMapView } from "./CalendarMapView";

type CalendarView = "day" | "week" | "month" | "map";

interface ApplicationWithJob extends Application {
  job?: Job;
  teamMember?: WorkerTeamMember | null;
  company?: { id: number; companyName: string | null; phone: string | null; avatarUrl?: string | null; companyLogo?: string | null; firstName?: string | null; lastName?: string | null } | null;
}

interface ClockInStatus {
  isClockedIn: boolean;
  activeTimesheet: Timesheet | null;
  activeJobId: number | null;
}

interface GeofenceStatus {
  isChecking: boolean;
  canClockIn: boolean;
  distanceMiles: string | null;
  errorMessage: string | null;
}

export interface WorkerCalendarRef {
  openSettingsMenu: () => void;
}

interface WorkerCalendarProps {
  applications: ApplicationWithJob[];
  availableJobs: Job[];
  workerHourlyRate: number;
  profile: Profile | null;
  activeTeamMembers: WorkerTeamMember[];
  onApplyToJob: (job: Job) => void;
  onViewJob: (job: Job) => void;
  onWithdrawApplication: (applicationId: number) => void;
  onUpdateTeamMember: (applicationId: number, teamMemberId: number | null) => void;
  onGetDirections: (job: Job) => void;
  isWithdrawing?: boolean;
  clockInStatus?: ClockInStatus;
  clockInError?: string | null;
  onClockIn?: (jobId: number, workerId: number) => Promise<{ success: boolean; error?: string; code?: string; distanceMiles?: string }>;
  onClockOut?: (timesheetId: number) => Promise<{ success: boolean; error?: string }>;
  isClockingIn?: boolean;
  isClockingOut?: boolean;
  isEmployee?: boolean;
  impersonatedTeamMemberId?: number | null;
}

interface CalendarEvent {
  id: number;
  applicationId?: number;
  proposedRate?: number;
  title: string;
  startDate: Date;
  endDate?: Date;
  scheduledTime?: string;
  estimatedHours?: number;
  location?: string;
  hourlyRate?: number;
  type: "accepted" | "pending" | "opportunity";
  job: Job;
  teamMember?: WorkerTeamMember | null;
  company?: { id: number; companyName: string | null; phone: string | null; avatarUrl?: string | null; companyLogo?: string | null; firstName?: string | null; lastName?: string | null } | null;
}

const HOUR_HEIGHT = 48;
const START_HOUR = 4;
const END_HOUR = 23;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

const DAY_MAP: Record<string, number> = {
  "sun": 0, "sunday": 0,
  "mon": 1, "monday": 1,
  "tue": 2, "tuesday": 2,
  "wed": 3, "wednesday": 3,
  "thu": 4, "thursday": 4,
  "fri": 5, "friday": 5,
  "sat": 6, "saturday": 6,
};

function getRecurringDates(job: Job): Date[] {
  const days = job.scheduleDays || (job as any).recurringDays || [];
  if (days.length === 0 || job.jobType !== "recurring") {
    return [];
  }
  
  const weeks = (job as any).recurringWeeks || 1;
  const startDate = new Date(job.startDate);
  startDate.setHours(0, 0, 0, 0);
  
  const scheduleDayNumbers = days
    .map((d: string) => DAY_MAP[d.toLowerCase()])
    .filter((n: number | undefined): n is number => n !== undefined);
  
  if (scheduleDayNumbers.length === 0) return [];
  
  const dates: Date[] = [];
  const endDate = addDays(startDate, weeks * 7);
  
  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dayOfWeek = getDay(currentDate);
    if (scheduleDayNumbers.includes(dayOfWeek)) {
      dates.push(new Date(currentDate));
    }
    currentDate = addDays(currentDate, 1);
  }
  
  return dates;
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return { hours: 9, minutes: 0 };
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return { hours, minutes };
}

function getEventPosition(event: CalendarEvent): { top: number; height: number; isAllDay: boolean } {
  let startHour = 9;
  let startMinute = 0;
  let isAllDay = false;
  
  if (event.scheduledTime) {
    const { hours, minutes } = parseTime(event.scheduledTime);
    startHour = hours;
    startMinute = minutes;
  } else if (event.startDate) {
    const hours = event.startDate.getHours();
    const minutes = event.startDate.getMinutes();
    if (hours === 0 && minutes === 0) {
      isAllDay = true;
      startHour = 8;
    } else {
      startHour = hours;
      startMinute = minutes;
    }
  } else {
    isAllDay = true;
    startHour = 8;
  }
  
  // Calculate duration from estimatedHours (job shift duration)
  // This is more reliable than using endDate which may be the job's end date span
  const durationMinutes = (event.estimatedHours || 4) * 60;
  
  const startOffset = (startHour - START_HOUR) * HOUR_HEIGHT + (startMinute / 60) * HOUR_HEIGHT;
  const height = (durationMinutes / 60) * HOUR_HEIGHT;
  
  return { top: Math.max(0, startOffset), height: Math.max(HOUR_HEIGHT / 2, height), isAllDay };
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export const WorkerCalendar = forwardRef<WorkerCalendarRef, WorkerCalendarProps>(({ 
  applications, 
  availableJobs, 
  workerHourlyRate, 
  profile,
  activeTeamMembers,
  onApplyToJob, 
  onViewJob,
  onWithdrawApplication,
  onUpdateTeamMember,
  onGetDirections,
  isWithdrawing,
  clockInStatus,
  clockInError,
  onClockIn,
  onClockOut,
  isClockingIn,
  isClockingOut,
  isEmployee = false,
  impersonatedTeamMemberId,
}, ref) => {
  // Persistent filters - these will be remembered across sessions
  const [view, setView] = usePersistentFilter<CalendarView>("calendar_view", "week");
  const [currentDateStr, setCurrentDateStr] = usePersistentFilter<string>("calendar_date", new Date().toISOString());
  const [showOpportunities, setShowOpportunities] = usePersistentFilter<boolean>("calendar_show_opportunities", true);
  const [selectedPersonFilter, setSelectedPersonFilter] = usePersistentFilter<"all" | number>("calendar_person_filter", "all");
  const [enabledTeammates, setEnabledTeammates] = usePersistentSetFilter("calendar_enabled_teammates", new Set<number>());
  
  // Job type visibility toggles for map view - all on by default
  const [showAcceptedJobs, setShowAcceptedJobs] = usePersistentFilter<boolean>("calendar_show_accepted_jobs", true);
  const [showPendingJobs, setShowPendingJobs] = usePersistentFilter<boolean>("calendar_show_pending_jobs", true);
  const [showAvailableJobs, setShowAvailableJobs] = usePersistentFilter<boolean>("calendar_show_available_jobs", true);
  
  // Non-persistent state (temporary UI state)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedAcceptedEvent, setSelectedAcceptedEvent] = useState<CalendarEvent | null>(null);
  const [selectedOpportunityJob, setSelectedOpportunityJob] = useState<Job | null>(null);
  const [selectedDayEvents, setSelectedDayEvents] = useState<{ date: Date; events: CalendarEvent[] } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [importCalendarUrl, setImportCalendarUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [copiedExportUrl, setCopiedExportUrl] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [clockingJobId, setClockingJobId] = useState<number | null>(null);
  const [scheduleInfoJob, setScheduleInfoJob] = useState<Job | null>(null);
  const [locationInfoJob, setLocationInfoJob] = useState<Job | null>(null);
  const [drivingTime, setDrivingTime] = useState<string | null>(null);
  const [isCalculatingDrive, setIsCalculatingDrive] = useState(false);
  const [, navigate] = useLocation();
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [settingsSubMenu, setSettingsSubMenu] = useState<"main" | "import" | "export" | "opportunities">("main");
  const [showViewSelector, setShowViewSelector] = useState(false);
  
  // Expose method to open settings menu from parent via ref
  useImperativeHandle(ref, () => ({
    openSettingsMenu: () => {
      setShowSettingsMenu(true);
      setSettingsSubMenu("main");
    },
  }));

  // Convert currentDateStr from string to Date object for use in components
  const currentDate = useMemo(() => {
    try {
      return new Date(currentDateStr);
    } catch {
      return new Date();
    }
  }, [currentDateStr]);

  // Update currentDateStr string when date changes (for persistence)
  const handleDateChange = useCallback((date: Date) => {
    setCurrentDateStr(date.toISOString());
  }, [setCurrentDateStr]);

  // Enable all teammates by default when they load (for map view to show all routes)
  // Only if no saved filter exists
  useEffect(() => {
    if (!isEmployee && activeTeamMembers.length > 0 && enabledTeammates.size === 0) {
      const allTeammateIds = new Set(activeTeamMembers.map(m => m.id));
      setEnabledTeammates(allTeammateIds);
    }
  }, [activeTeamMembers, isEmployee, enabledTeammates.size, setEnabledTeammates]);

  // Filter applications based on role - EXACTLY matching Today tab's filterByRole logic
  const filteredApplications = useMemo(() => {
    let filtered = applications;
    
    // Admins (business operators) see all jobs by default
    if (!isEmployee) {
      // Apply person filter if set
      if (selectedPersonFilter !== "all") {
        if (selectedPersonFilter === 0) {
          // "Me" filter - admin's own jobs (no teamMemberId assigned)
          filtered = filtered.filter(a => !a.teamMemberId);
        } else {
          // Specific team member filter
          filtered = filtered.filter(a => a.teamMemberId === selectedPersonFilter);
        }
      }
    } else {
      // Employees only see jobs assigned specifically to them
      // If impersonating, check if the application's teamMemberId matches the impersonated team member
      if (impersonatedTeamMemberId) {
        filtered = filtered.filter(a => a.teamMemberId === impersonatedTeamMemberId);
      } else if (profile?.teamId) {
        // If the employee has a teamId (direct employee), filter to applications with teamMemberId set
        // This matches Today tab's exact logic for employees
        filtered = filtered.filter(a => a.teamMemberId !== null && a.teamMemberId !== undefined);
      }
    }
    
    // Apply legend filters for accepted and pending jobs
    if (!showAcceptedJobs || !showPendingJobs) {
      filtered = filtered.filter(app => {
        if (app.status === "accepted" && !showAcceptedJobs) return false;
        if (app.status === "pending" && !showPendingJobs) return false;
        return true;
      });
    }
    
    return filtered;
  }, [applications, isEmployee, impersonatedTeamMemberId, selectedPersonFilter, profile?.teamId, showAcceptedJobs, showPendingJobs]);
  
  const isMobile = useIsMobile();
  const { toast } = useToast();
  
  // Fetch timesheets for selected accepted job
  const { data: jobTimesheets = [] } = useQuery<Timesheet[]>({
    queryKey: ['/api/timesheets/job', selectedAcceptedEvent?.job?.id],
    queryFn: async () => {
      if (!selectedAcceptedEvent?.job?.id) return [];
      const res = await fetch(`/api/timesheets/job/${selectedAcceptedEvent.job.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedAcceptedEvent?.job?.id,
  });
  
  // Fetch company profile for selected accepted job
  const { data: companyProfile } = useQuery<Profile>({
    queryKey: ['/api/profiles', selectedAcceptedEvent?.job?.companyId],
    enabled: !!selectedAcceptedEvent?.job?.companyId,
  });
  
  const exportCalendarUrl = typeof window !== "undefined" 
    ? `${window.location.origin}/api/calendar/feed/${profile?.id || "worker"}.ics`
    : "";
  
  const handleCopyExportUrl = async () => {
    try {
      await navigator.clipboard.writeText(exportCalendarUrl);
      setCopiedExportUrl(true);
      toast({ title: "Link copied!", description: "Paste this URL in your calendar app to subscribe." });
      setTimeout(() => setCopiedExportUrl(false), 2000);
    } catch {
      toast({ title: "Failed to copy", description: "Please copy the URL manually.", variant: "destructive" });
    }
  };
  
  const handleImportCalendar = async () => {
    if (!importCalendarUrl.trim()) {
      toast({ title: "Enter a URL", description: "Please paste a calendar URL to import.", variant: "destructive" });
      return;
    }
    setIsImporting(true);
    try {
      const response = await fetch("/api/calendar/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importCalendarUrl }),
      });
      if (response.ok) {
        toast({ title: "Calendar imported!", description: "Your external events have been added." });
        setImportCalendarUrl("");
        setShowSettings(false);
      } else {
        toast({ title: "Import failed", description: "Could not import from this URL.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Import failed", description: "Please check the URL and try again.", variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  // Helper functions for accepted job dialog
  const getFullAddress = (job: Job) => {
    return `${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`.replace(/^, |, $/g, "") || job.location || "Address not provided";
  };
  
  const getJobTypeInfo = (job: Job) => {
    if (job.jobType === "recurring") {
      return { label: "Recurring", icon: Repeat, color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" };
    } else if (job.isOnDemand || job.jobType === "on_demand") {
      return { label: "On Demand", icon: Briefcase, color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" };
    }
    return { label: "One Time", icon: Calendar, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" };
  };
  
  const openDirections = (job: Job) => {
    if (job.latitude && job.longitude) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${job.latitude},${job.longitude}`, "_blank");
    } else if (job.address) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(getFullAddress(job))}`, "_blank");
    }
  };
  
  const goToChat = (jobId: number) => {
    navigate(`/dashboard/messages?job=${jobId}`);
  };
  
  const handleDialogClockIn = async (jobId: number) => {
    if (!onClockIn || !profile) return;
    setClockingJobId(jobId);
    try {
      await onClockIn(jobId, profile.id);
    } finally {
      setClockingJobId(null);
    }
  };
  
  const handleDialogClockOut = async (timesheetId: number) => {
    if (!onClockOut) return;
    setClockingJobId(timesheetId);
    try {
      await onClockOut(timesheetId);
    } finally {
      setClockingJobId(null);
    }
  };
  
  // Get relative day label - matches TodayPage/EnhancedJobDialog
  const getRelativeDay = (date: Date): string => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    
    const daysFromNow = differenceInDays(date, new Date());
    if (daysFromNow < 0) return "Past";
    if (daysFromNow <= 6) return `In ${daysFromNow} days`;
    if (daysFromNow <= 13) return "Next week";
    
    return format(date, "EEE, MMM d");
  };

  // Format schedule days for display
  const formatScheduleDays = (days: string[] | null | undefined): string => {
    if (!days || days.length === 0) return "";
    const dayAbbrev: Record<string, string> = {
      "monday": "Mon", "tuesday": "Tue", "wednesday": "Wed", "thursday": "Thu",
      "friday": "Fri", "saturday": "Sat", "sunday": "Sun",
      "mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu",
      "fri": "Fri", "sat": "Sat", "sun": "Sun"
    };
    const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const sorted = [...days].sort((a, b) => dayOrder.indexOf(a.toLowerCase()) - dayOrder.indexOf(b.toLowerCase()));
    return sorted.map(d => dayAbbrev[d.toLowerCase()] || d).join(", ");
  };

  // Get time range for job - handles both "HH:MM" (24h) and "h:mm AM/PM" (12h) formats
  const getTimeRange = (job: Job): { startTime: string | null; endTime: string | null } => {
    let startTime: string | null = null;
    let endTime: string | null = null;
    
    const parseAndFormatTime = (t: string): string => {
      // Check if already in AM/PM format
      const ampmMatch = t.match(/(\d+):?(\d*)?\s*(AM|PM)/i);
      if (ampmMatch) {
        const hr = parseInt(ampmMatch[1]);
        const min = ampmMatch[2] || "00";
        const period = ampmMatch[3].toLowerCase();
        return min === "00" || !ampmMatch[2] ? `${hr}${period}` : `${hr}:${min}${period}`;
      }
      
      // Parse 24-hour format "HH:MM"
      const parts = t.split(":");
      const hr = parseInt(parts[0]);
      const minStr = parts[1]?.replace(/\D/g, '') || "00";
      const ampm = hr >= 12 ? "pm" : "am";
      const h12 = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr;
      return minStr === "00" ? `${h12}${ampm}` : `${h12}:${minStr}${ampm}`;
    };
    
    if (job.scheduledTime) {
      startTime = parseAndFormatTime(job.scheduledTime);
      if (job.endTime) {
        endTime = parseAndFormatTime(job.endTime);
      }
    }
    
    return { startTime, endTime };
  };

  // Format job time info matching TodayPage/EnhancedJobDialog style
  const formatJobTime = (job: Job): { relative: string; timeRange: string; fullDate: string; scheduleDaysDisplay?: string } => {
    if (!job.startDate) {
      return { relative: "On Demand", timeRange: "Flexible hours", fullDate: "Flexible schedule" };
    }
    
    const startDate = new Date(job.startDate);
    const relativeDay = getRelativeDay(startDate);
    const fullDate = format(startDate, "EEEE, MMMM d, yyyy");
    
    const { startTime, endTime } = getTimeRange(job);
    let timeRange = startTime && endTime ? `${startTime} - ${endTime}` : (startTime || "Flexible");
    
    if (job.jobType === "recurring") {
      const scheduleDaysDisplay = formatScheduleDays(job.scheduleDays);
      return { relative: relativeDay, timeRange, fullDate, scheduleDaysDisplay };
    }
    
    return { relative: relativeDay, timeRange, fullDate };
  };

  // Format job time for display - matches TodayPage style exactly
  const JobTimeDisplay = ({ job, showFullDate = false }: { job: Job; showFullDate?: boolean }) => {
    const timeInfo = formatJobTime(job);
    const isRecurring = job.jobType === "recurring";
    
    // Calculate duration based on job type - handles both 24h and AM/PM formats
    const getDurationInfo = (): { hours: number; label: string } | null => {
      if (job.estimatedHours) {
        return { hours: job.estimatedHours, label: `~${job.estimatedHours} hours` };
      }
      
      if (job.scheduledTime && job.endTime) {
        // Parse time to decimal hours - handles both "HH:MM" and "h:mm AM/PM"
        const parseTimeToHours = (t: string): number => {
          const ampmMatch = t.match(/(\d+):?(\d*)?\s*(AM|PM)/i);
          if (ampmMatch) {
            let hr = parseInt(ampmMatch[1]);
            const min = parseInt(ampmMatch[2] || "0");
            const isPM = ampmMatch[3].toUpperCase() === "PM";
            if (isPM && hr !== 12) hr += 12;
            if (!isPM && hr === 12) hr = 0;
            return hr + min / 60;
          }
          const parts = t.split(":").map(p => parseInt(p.replace(/\D/g, '')) || 0);
          return parts[0] + (parts[1] || 0) / 60;
        };
        
        const startHr = parseTimeToHours(job.scheduledTime);
        const endHr = parseTimeToHours(job.endTime);
        if (endHr > startHr) {
          const dailyHours = Math.round(endHr - startHr);
          if (job.jobType === "recurring") {
            return { hours: dailyHours, label: `~${dailyHours} hours/day` };
          }
          return { hours: dailyHours, label: `~${dailyHours} hours` };
        }
      }
      
      if (job.jobType !== "recurring" && job.jobType !== "on_demand" && !job.isOnDemand) {
        if (job.startDate && job.endDate) {
          const start = new Date(job.startDate);
          const end = new Date(job.endDate);
          if (format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd")) {
            const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
            if (hours > 0 && hours < 24) {
              return { hours: Math.round(hours), label: `~${Math.round(hours)} hours` };
            }
          }
        }
      }
      
      if (job.isOnDemand || job.jobType === "on_demand") {
        return null;
      }
      
      return null;
    };
    
    const durationInfo = getDurationInfo();
    
    return (
      <div className="space-y-0.5">
        <p className="font-semibold text-sm">
          {timeInfo.relative}
          {timeInfo.timeRange && (
            <span className="text-sm font-medium text-muted-foreground ml-1">
              ({timeInfo.timeRange})
            </span>
          )}
        </p>
        {showFullDate && (
          <p className="text-xs text-muted-foreground">{timeInfo.fullDate}</p>
        )}
        {isRecurring && timeInfo.scheduleDaysDisplay && (
          <div className="flex items-center gap-1 flex-wrap mt-0.5">
            <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded">
              {timeInfo.scheduleDaysDisplay}
            </span>
          </div>
        )}
        {durationInfo && showFullDate && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            <Clock className="w-3 h-3" />
            <span>{durationInfo.label}</span>
          </div>
        )}
      </div>
    );
  };

  // Calculate drive time from user's location
  const calculateDriveTime = async (job: Job) => {
    if (!job.latitude || !job.longitude) {
      setDrivingTime(null);
      return;
    }
    
    setIsCalculatingDrive(true);
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude: userLat, longitude: userLng } = position.coords;
            try {
              const response = await fetch(`/api/directions?origin=${userLat},${userLng}&destination=${job.latitude},${job.longitude}`);
              if (response.ok) {
                const data = await response.json();
                setDrivingTime(data.duration || null);
              } else {
                setDrivingTime(null);
              }
            } catch {
              setDrivingTime(null);
            }
            setIsCalculatingDrive(false);
          },
          () => {
            setDrivingTime(null);
            setIsCalculatingDrive(false);
          }
        );
      } else {
        setDrivingTime(null);
        setIsCalculatingDrive(false);
      }
    } catch {
      setDrivingTime(null);
      setIsCalculatingDrive(false);
    }
  };

  // Open location popup and calculate drive time
  const openLocationPopup = (job: Job) => {
    setLocationInfoJob(job);
    setDrivingTime(null);
    calculateDriveTime(job);
  };

  const events = useMemo(() => {
    const result: CalendarEvent[] = [];
    
    filteredApplications.forEach(app => {
      if (app.job) {
        const job = app.job;
        const isAccepted = app.status === "accepted";
        const isRecurring = job.jobType === "recurring" && job.scheduleDays && job.scheduleDays.length > 0;
        
        if (isAccepted && isRecurring) {
          const recurringDates = getRecurringDates(job);
          recurringDates.forEach((date, index) => {
            result.push({
              id: job.id * 1000 + index,
              applicationId: app.id,
              proposedRate: app.proposedRate || undefined,
              title: job.title,
              startDate: date,
              endDate: job.endDate ? new Date(job.endDate) : undefined,
              scheduledTime: job.scheduledTime || undefined,
              estimatedHours: job.estimatedHours || undefined,
              location: job.city || job.location || undefined,
              hourlyRate: job.hourlyRate,
              type: "accepted",
              job: job,
              teamMember: app.teamMember,
              company: app.company,
            });
          });
        } else {
          result.push({
            id: job.id,
            applicationId: app.id,
            proposedRate: app.proposedRate || undefined,
            title: job.title,
            startDate: new Date(job.startDate),
            endDate: job.endDate ? new Date(job.endDate) : undefined,
            scheduledTime: job.scheduledTime || undefined,
            estimatedHours: job.estimatedHours || undefined,
            location: job.city || job.location || undefined,
            hourlyRate: job.hourlyRate,
            type: isAccepted ? "accepted" : "pending",
            job: job,
            teamMember: app.teamMember,
            company: app.company,
          });
        }
      }
    });
    
    // Employees never see opportunities - only their assigned accepted jobs
    // Apply legend filter for available jobs
    if (showAvailableJobs && showOpportunities && !isEmployee) {
      const appliedJobIds = new Set(applications.map(a => a.jobId));
      availableJobs.forEach(job => {
        if (!appliedJobIds.has(job.id)) {
          result.push({
            id: job.id,
            title: job.title,
            startDate: new Date(job.startDate),
            endDate: job.endDate ? new Date(job.endDate) : undefined,
            scheduledTime: job.scheduledTime || undefined,
            estimatedHours: job.estimatedHours || undefined,
            location: job.city || job.location || undefined,
            hourlyRate: job.hourlyRate,
            type: "opportunity",
            job,
          });
        }
      });
    }
    
    return result;
  }, [filteredApplications, availableJobs, showOpportunities, isEmployee, showAvailableJobs, applications]);

  // Transform data for CalendarMapView (only when admin and view is map)
  const mapTeammates = useMemo(() => {
    if (isEmployee) return [];
    return activeTeamMembers.map(member => {
      // Work location = home/start address coordinates (home base)
      // Use latitude/longitude from workerTeamMembers table as work location
      let workLocationLat: number | null = null;
      let workLocationLng: number | null = null;
      
      if (member.latitude && member.longitude) {
        workLocationLat = parseFloat(member.latitude);
        workLocationLng = parseFloat(member.longitude);
      } else if (member.address) {
        // Fallback: If no coordinates but has address, use default San Jose area
        // In production, this would be geocoded from the address
        console.warn(`⚠️ Teammate ${member.firstName} ${member.lastName} (ID: ${member.id}) has address but no coordinates. Using default location.`);
        // Default to San Jose area with slight offset based on member ID
        workLocationLat = 37.3382 + (member.id % 10) * 0.01;
        workLocationLng = -121.8863 - (member.id % 10) * 0.01;
      } else {
        console.warn(`⚠️ Teammate ${member.firstName} ${member.lastName} (ID: ${member.id}) has no address or coordinates.`);
      }
      
      const workLocationAddress = member.address 
        ? `${member.address}${member.city ? `, ${member.city}` : ""}${member.state ? `, ${member.state}` : ""}`
        : null;
      
      // Live location = current GPS position (from location pings - where worker is RIGHT NOW)
      const memberAny = member as any;
      const liveLocationLat = memberAny.liveLocationLat !== undefined 
        ? memberAny.liveLocationLat 
        : workLocationLat; // Fallback to work location if no live location
      const liveLocationLng = memberAny.liveLocationLng !== undefined
        ? memberAny.liveLocationLng
        : workLocationLng; // Fallback to work location if no live location
      const liveLocationTimestamp = memberAny.liveLocationTimestamp || new Date();
      
      return {
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        avatarUrl: member.avatarUrl || null,
        workLocationAddress,
        workLocationLat,
        workLocationLng,
        liveLocationLat, // From location pings API, falls back to work location
        liveLocationLng, // From location pings API, falls back to work location
        liveLocationTimestamp, // From location pings API
      };
    });
  }, [activeTeamMembers, isEmployee]);

  const mapJobAssignments = useMemo(() => {
    if (isEmployee) return [];
    
    console.log(`🔍 Debugging map job assignments:`);
    console.log(`  📅 Selected date: ${format(currentDate, "yyyy-MM-dd")}`);
    console.log(`  📦 Total applications: ${applications.length}`);
    console.log(`  📦 Filtered applications (by person): ${filteredApplications.length}`);
    
    // Filter by date only - include all applications with jobs, regardless of status or teamMemberId
    const jobsWithTeamMember = filteredApplications.filter(app => {
      // Only require that the application has a job
      if (!app.job) {
        return false;
      }
      
      // Filter by date - check if job startDate matches currentDate (allow ±1 day for flexibility)
      const jobDate = app.job.startDate ? new Date(app.job.startDate) : null;
      if (!jobDate) {
        console.log(`  ⚠️ Job ${app.job.id} has no startDate`);
        return false;
      }
      
      // Normalize dates to start of day for comparison
      const jobDateNormalized = startOfDay(jobDate);
      const currentDateNormalized = startOfDay(currentDate);
      const dayBefore = startOfDay(subDays(currentDate, 1));
      const dayAfter = startOfDay(addDays(currentDate, 1));
      
      // Allow jobs within ±1 day for better visibility
      const isWithinRange = 
        jobDateNormalized.getTime() === currentDateNormalized.getTime() ||
        jobDateNormalized.getTime() === dayBefore.getTime() ||
        jobDateNormalized.getTime() === dayAfter.getTime();
      
      if (!isWithinRange) {
        console.log(`  📅 Job ${app.job.id} date mismatch: ${format(jobDate, "yyyy-MM-dd")} vs ${format(currentDate, "yyyy-MM-dd")} (showing ±1 day)`);
        return false;
      }
      
      return true;
    });
    
    console.log(`🗺️ Map job assignments: ${jobsWithTeamMember.length} jobs for ${format(currentDate, "yyyy-MM-dd")}`);
    jobsWithTeamMember.forEach(app => {
      const job = app.job!;
      console.log(`  ✅ Job ${job.id}: ${job.title} - Status: ${app.status} - Team Member ${app.teamMemberId} - Date: ${format(new Date(job.startDate), "yyyy-MM-dd")} - Coords: ${job.latitude || "NO LAT"}, ${job.longitude || "NO LNG"}`);
    });
    
    return jobsWithTeamMember.map(app => {
      const job = app.job!;
      const fullAddress = `${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`.replace(/^, |, $/g, "") || job.location || "Address not provided";
      return {
        jobId: job.id,
        jobTitle: job.title,
        address: fullAddress,
        latitude: job.latitude,
        longitude: job.longitude,
        scheduledStart: job.startDate,
        scheduledEnd: job.endDate || job.startDate,
        status: "scheduled",
        teamMemberId: app.teamMemberId || null, // Allow null teamMemberId
      };
    });
  }, [filteredApplications, isEmployee, currentDate]);

  const [focusedTeammateId, setFocusedTeammateId] = useState<number | null>(null);
  
  const handleToggleTeammate = (teammateId: number) => {
    const wasEnabled = enabledTeammates.has(teammateId);
    setEnabledTeammates(prev => {
      const next = new Set(prev);
      if (next.has(teammateId)) {
        next.delete(teammateId);
      } else {
        next.add(teammateId);
        // Auto-focus map to this teammate's route when enabling
        if (view === "map") {
          setFocusedTeammateId(teammateId);
          // Clear focus after a short delay
          setTimeout(() => setFocusedTeammateId(null), 500);
        }
      }
      return next;
    });
  };

  const navigateDate = (direction: "prev" | "next") => {
    if (view === "day") {
      handleDateChange(direction === "next" ? addDays(currentDate, 1) : subDays(currentDate, 1));
    } else if (view === "week") {
      handleDateChange(direction === "next" ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
    } else {
      handleDateChange(direction === "next" ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
    }
  };

  const goToToday = () => handleDateChange(new Date());

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end: endOfWeek(currentDate, { weekStartsOn: 0 }) });
  }, [currentDate]);

  const monthDays = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const monthStart = startOfWeek(start, { weekStartsOn: 0 });
    const monthEnd = endOfWeek(end, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: monthStart, end: monthEnd });
  }, [currentDate]);

  const miniCalendarDays = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const monthStart = startOfWeek(start, { weekStartsOn: 0 });
    const monthEnd = endOfWeek(end, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: monthStart, end: monthEnd });
  }, [currentDate]);

  const getEventsForDate = (date: Date) => {
    return events.filter(event => isSameDay(event.startDate, date));
  };

  // Helper function to add ordinal suffix (1st, 2nd, 3rd, etc.)
  const getOrdinalSuffix = (day: number): string => {
    if (day === 1 || day === 21 || day === 31) return `${day}st`;
    if (day === 2 || day === 22) return `${day}nd`;
    if (day === 3 || day === 23) return `${day}rd`;
    return `${day}th`;
  };

  const getHeaderTitle = () => {
    if (view === "day") {
      // Day view: "Monday, 25th"
      const day = currentDate.getDate();
      const dayName = format(currentDate, "EEEE"); // Full day name (Monday, Tuesday, etc.)
      return `${dayName}, ${getOrdinalSuffix(day)}`;
    } else if (view === "week") {
      // Week view: "Jan 25-31"
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
      const startDay = weekStart.getDate();
      const endDay = weekEnd.getDate();
      const startMonth = format(weekStart, "MMM");
      const endMonth = format(weekEnd, "MMM");
      
      if (startMonth === endMonth) {
        return `${startMonth} ${startDay}-${endDay}`;
      } else {
        return `${startMonth} ${startDay}-${endMonth} ${endDay}`;
      }
    } else if (view === "map") {
      // Map view: "Jan 15"
      return format(currentDate, "MMM d");
    } else if (view === "month") {
      // Month view: "January, 26"
      const monthName = format(currentDate, "MMMM");
      const day = currentDate.getDate();
      return `${monthName}, ${day}`;
    }
    return format(currentDate, "MMMM yyyy");
  };

  // Get mobile header title (same format as desktop)
  const getMobileHeaderTitle = () => {
    if (view === "day") {
      // Day view: "Monday, 25th"
      const day = currentDate.getDate();
      const dayName = format(currentDate, "EEEE"); // Full day name (Monday, Tuesday, etc.)
      return `${dayName}, ${getOrdinalSuffix(day)}`;
    } else if (view === "week") {
      // Week view: "Jan 25-31"
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
      const startDay = weekStart.getDate();
      const endDay = weekEnd.getDate();
      const startMonth = format(weekStart, "MMM");
      const endMonth = format(weekEnd, "MMM");
      
      if (startMonth === endMonth) {
        return `${startMonth} ${startDay}-${endDay}`;
      } else {
        return `${startMonth} ${startDay}-${endMonth} ${endDay}`;
      }
    } else if (view === "map") {
      // Map view: "Jan 15"
      return format(currentDate, "MMM d");
    } else if (view === "month") {
      // Month view: "January, 26"
      const monthName = format(currentDate, "MMMM");
      const day = currentDate.getDate();
      return `${monthName}, ${day}`;
    }
    return format(currentDate, "MMM, yyyy");
  };

  // Check if we're past today's date/month/week
  const isPastToday = useMemo(() => {
    const today = startOfDay(new Date());
    const current = startOfDay(currentDate);
    
    if (view === "day") {
      return isAfter(current, today);
    } else if (view === "week") {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
      const todayWeekStart = startOfWeek(today, { weekStartsOn: 0 });
      return isAfter(weekStart, todayWeekStart);
    } else if (view === "month") {
      const monthStart = startOfMonth(currentDate);
      const todayMonthStart = startOfMonth(today);
      return isAfter(monthStart, todayMonthStart);
    }
    return false;
  }, [currentDate, view]);

  // Get today's day number for the button
  const getTodayDayNumber = () => {
    const today = new Date();
    const day = today.getDate();
    // Add ordinal suffix
    if (day === 1 || day === 21 || day === 31) return `${day}st`;
    if (day === 2 || day === 22) return `${day}nd`;
    if (day === 3 || day === 23) return `${day}rd`;
    return `${day}th`;
  };

  const calculatePayout = (event: CalendarEvent) => {
    const hours = event.estimatedHours || 8;
    return `$${(workerHourlyRate * hours).toFixed(0)}`;
  };

  const renderEventBlock = (event: CalendarEvent, compact = false) => {
    const isOpportunity = event.type === "opportunity";
    const isAccepted = event.type === "accepted";
    const hasNoTime = !event.scheduledTime;
    
    // Determine which avatar to show:
    // - For accepted jobs: show the company (job owner) avatar
    // - For pending jobs with team member: show team member's avatar  
    // - For pending jobs without team member: show admin's avatar (profile)
    const showAvatar = !isOpportunity && !compact;
    
    let avatarUrl: string | null | undefined;
    let avatarInitials: string;
    let personName: string;
    
    if (isAccepted) {
      // For accepted jobs, show the company (job owner) avatar
      avatarUrl = event.company?.companyLogo || event.company?.avatarUrl;
      avatarInitials = event.company?.companyName?.[0] || event.company?.firstName?.[0] || 'C';
      personName = event.company?.companyName || `${event.company?.firstName || ''} ${event.company?.lastName || ''}`.trim() || 'Company';
    } else if (event.teamMember) {
      avatarUrl = event.teamMember.avatarUrl;
      avatarInitials = `${event.teamMember.firstName?.[0] || ''}${event.teamMember.lastName?.[0] || ''}`;
      personName = `${event.teamMember.firstName} ${event.teamMember.lastName?.[0]}.`;
    } else {
      avatarUrl = profile?.avatarUrl;
      avatarInitials = `${profile?.firstName?.[0] || ''}${profile?.lastName?.[0] || ''}`;
      personName = `${profile?.firstName || ''} (Me)`;
    }
    
    const baseClasses = "relative z-10 rounded px-1.5 py-0.5 text-xs cursor-pointer transition-all overflow-hidden";
    const typeClasses = isOpportunity 
      ? "border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40" 
      : isAccepted 
        ? "bg-green-500 text-white hover:bg-green-600" 
        : "bg-amber-500 text-white hover:bg-amber-600";
    
    return (
      <div
        key={event.id}
        className={`${baseClasses} ${typeClasses}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpportunity) {
            setSelectedOpportunityJob(event.job);
          } else if (isAccepted) {
            setCurrentMediaIndex(0);
            setMediaLoaded(false);
            setSelectedAcceptedEvent(event);
          } else {
            setSelectedEvent(event);
          }
        }}
        data-testid={`calendar-event-${event.id}`}
      >
        <div className="flex items-center gap-1">
          {showAvatar && (
            <Avatar className="w-4 h-4 flex-shrink-0 border border-white/50">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="text-[6px]">
                {avatarInitials}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="font-medium truncate text-[11px]">{event.title}</div>
        </div>
        {!compact && (isAccepted || event.type === "pending") && (
          <div className="text-[10px] opacity-90 truncate">
            {isAccepted ? personName : (event.teamMember ? `For: ${personName}` : personName)}
          </div>
        )}
        {!compact && event.scheduledTime && (
          <div className="text-[10px] opacity-80">{event.scheduledTime}</div>
        )}
        {!compact && hasNoTime && isOpportunity && (
          <div className="text-[10px] opacity-70 italic">Flexible</div>
        )}
      </div>
    );
  };

  const renderMiniCalendar = () => (
    <div className="hidden lg:block w-56 flex-shrink-0 border-r p-3 bg-background">
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">{format(currentDate, "MMMM yyyy")}</span>
          <div className="flex">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDateChange(subMonths(currentDate, 1))}>
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDateChange(addMonths(currentDate, 1))}>
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
        
        <div className="grid grid-cols-7 gap-0 text-center mb-1">
          {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
            <div key={i} className="text-[10px] text-muted-foreground font-medium py-1">{day}</div>
          ))}
        </div>
        
        <div className="grid grid-cols-7 gap-0">
          {miniCalendarDays.map(day => {
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isSelected = isSameDay(day, currentDate);
            const isTodayDate = isToday(day);
            const hasEvents = getEventsForDate(day).length > 0;
            
            return (
              <button
                key={day.toISOString()}
                onClick={() => handleDateChange(day)}
                className={`
                  h-7 w-7 text-[11px] rounded-full flex items-center justify-center mx-auto
                  hover:bg-muted transition-colors relative
                  ${!isCurrentMonth ? "text-muted-foreground/50" : ""}
                  ${isTodayDate && !isSelected ? "bg-muted text-foreground hover:bg-muted" : ""}
                  ${isSelected ? "bg-green-500 text-white hover:bg-green-500" : ""}
                `}
                data-testid={`mini-calendar-${format(day, "yyyy-MM-dd")}`}
              >
                {format(day, "d")}
                {hasEvents && !isTodayDate && !isSelected && (
                  <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 mt-4 pt-4 border-t">
        {/* Person Filter for Admins - Only show if not employee and has team members */}
        {!isEmployee && activeTeamMembers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Filter by Person</p>
            <div className="space-y-1.5">
              {/* All people option */}
              <button
                onClick={() => setSelectedPersonFilter("all")}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  selectedPersonFilter === "all" 
                    ? "bg-primary/10 text-primary" 
                    : "hover:bg-muted"
                }`}
                data-testid="filter-all-persons"
              >
                <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                  <span className="text-[8px] font-medium">All</span>
                </div>
                <span>All People</span>
              </button>
              
              {/* Admin's own jobs (Me) */}
              <button
                onClick={() => setSelectedPersonFilter(0)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  selectedPersonFilter === 0 
                    ? "bg-primary/10 text-primary" 
                    : "hover:bg-muted"
                }`}
                data-testid="filter-me"
              >
                <Avatar className="w-5 h-5">
                  <AvatarImage src={profile?.avatarUrl || undefined} />
                  <AvatarFallback className="text-[8px]">
                    {profile?.firstName?.[0]}{profile?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <span>{profile?.firstName || 'Me'} (Me)</span>
              </button>
              
              {/* Team members */}
              {activeTeamMembers.map(member => (
                <button
                  key={member.id}
                  onClick={() => setSelectedPersonFilter(member.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                    selectedPersonFilter === member.id 
                      ? "bg-primary/10 text-primary" 
                      : "hover:bg-muted"
                  }`}
                  data-testid={`filter-member-${member.id}`}
                >
                  <Avatar className="w-5 h-5">
                    <AvatarImage src={member.avatarUrl || undefined} />
                    <AvatarFallback className="text-[8px]">
                      {member.firstName?.[0]}{member.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{member.firstName} {member.lastName}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        
        {/* Toggleable Filters for all views - all on by default */}
        {!isEmployee && (
          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs text-muted-foreground font-medium">Filter by type</p>
            <div className="space-y-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="legend-accepted-mini"
                      checked={showAcceptedJobs}
                      onCheckedChange={setShowAcceptedJobs}
                    />
                    <Label htmlFor="legend-accepted-mini" className="flex items-center gap-1.5 cursor-pointer text-xs flex-1">
                      <div className="w-3 h-3 rounded bg-green-500" />
                      <span>Accepted</span>
                    </Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Show/hide accepted jobs that have been confirmed and assigned to you or your team</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="legend-pending-mini"
                      checked={showPendingJobs}
                      onCheckedChange={setShowPendingJobs}
                    />
                    <Label htmlFor="legend-pending-mini" className="flex items-center gap-1.5 cursor-pointer text-xs flex-1">
                      <div className="w-3 h-3 rounded bg-amber-500" />
                      <span>Pending</span>
                    </Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Show/hide pending job applications that are awaiting company approval</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="legend-available-mini"
                      checked={showAvailableJobs}
                      onCheckedChange={setShowAvailableJobs}
                    />
                    <Label htmlFor="legend-available-mini" className="flex items-center gap-1.5 cursor-pointer text-xs flex-1">
                      <div className="w-3 h-3 rounded bg-blue-500" />
                      <span>Available</span>
                    </Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Show/hide available job opportunities that you haven't applied to yet</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
      
      <div className="mt-4 pt-4 border-t">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => setShowSettings(true)}
          data-testid="calendar-settings-btn"
        >
          <Settings className="w-4 h-4" />
          Calendar Settings
        </Button>
      </div>
    </div>
  );

  const renderDayView = () => (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b sticky top-0 bg-background z-10">
        <div className="w-16 flex-shrink-0 border-r py-2 text-center text-[10px] text-muted-foreground">
          GMT-05
        </div>
        <div className="flex-1 py-2 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{format(currentDate, "EEE")}</div>
          <div className={`text-2xl font-medium mt-0.5 ${isToday(currentDate) ? "bg-primary text-primary-foreground rounded-full w-10 h-10 flex items-center justify-center mx-auto" : ""}`}>
            {format(currentDate, "d")}
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <div className="flex">
          <div className="w-16 flex-shrink-0 border-r">
            {HOURS.map(hour => (
              <div 
                key={hour} 
                className="border-b text-[10px] text-muted-foreground text-right pr-2 flex items-start pt-0.5"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                {formatHour(hour)}
              </div>
            ))}
          </div>
          <div className="flex-1 relative">
            {HOURS.map(hour => (
              <div key={hour} className="border-b border-l border-border/50" style={{ height: `${HOUR_HEIGHT}px` }} />
            ))}
            {getEventsForDate(currentDate).map(event => {
              const { top, height } = getEventPosition(event);
              return (
                <div
                  key={event.id}
                  className="absolute left-1 right-1 z-10"
                  style={{ top: `${top}px`, height: `${Math.max(24, height)}px` }}
                >
                  {renderEventBlock(event)}
                </div>
              );
            })}
            <div 
              className="absolute left-0 right-0 border-t-2 border-red-500 pointer-events-none z-10"
              style={{ top: `${(new Date().getHours() - START_HOUR) * HOUR_HEIGHT + (new Date().getMinutes() / 60) * HOUR_HEIGHT}px` }}
            >
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 -mt-1.5 -ml-1" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderWeekView = () => (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b sticky top-0 bg-background z-10">
        <div className="w-16 flex-shrink-0 border-r py-2 text-center text-[10px] text-muted-foreground">
          GMT-05
        </div>
        {weekDays.map(day => (
          <div key={day.toISOString()} className="flex-1 py-2 text-center border-l">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{format(day, "EEE")}</div>
            <div 
              className={`text-lg font-medium mt-0.5 cursor-pointer hover:bg-muted/50 rounded-full w-8 h-8 flex items-center justify-center mx-auto transition-colors
                ${isToday(day) ? "bg-primary text-primary-foreground hover:bg-primary" : ""}`}
                onClick={() => {
                handleDateChange(day);
                setView("day");
              }}
            >
              {format(day, "d")}
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <div className="flex">
          <div className="w-16 flex-shrink-0 border-r">
            {HOURS.map(hour => (
              <div 
                key={hour} 
                className="border-b text-[10px] text-muted-foreground text-right pr-2 flex items-start pt-0.5"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                {formatHour(hour)}
              </div>
            ))}
          </div>
          {weekDays.map(day => (
            <div key={day.toISOString()} className="flex-1 relative border-l">
              {HOURS.map(hour => (
                <div key={hour} className="border-b border-border/50" style={{ height: `${HOUR_HEIGHT}px` }} />
              ))}
              {getEventsForDate(day).map(event => {
                const { top, height } = getEventPosition(event);
                return (
                  <div
                    key={event.id}
                    className="absolute left-0.5 right-0.5 z-10"
                    style={{ top: `${top}px`, height: `${Math.max(20, height)}px` }}
                  >
                    {renderEventBlock(event, true)}
                  </div>
                );
              })}
              {isToday(day) && (
                <div 
                  className="absolute left-0 right-0 border-t-2 border-red-500 pointer-events-none z-10"
                  style={{ top: `${(new Date().getHours() - START_HOUR) * HOUR_HEIGHT + (new Date().getMinutes() / 60) * HOUR_HEIGHT}px` }}
                >
                  <div className="w-2 h-2 rounded-full bg-red-500 -mt-1 -ml-0.5" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderMonthView = () => (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map(day => (
          <div key={day} className="py-2 text-center text-[10px] text-muted-foreground font-medium tracking-wider border-l first:border-l-0">
            {day}
          </div>
        ))}
      </div>
      
      <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-auto">
        {monthDays.map(day => {
          const dayEvents = getEventsForDate(day);
          const isCurrentMonth = format(day, "M") === format(currentDate, "M");
          
          return (
            <div
              key={day.toISOString()}
              className={`border-b border-l first:border-l-0 p-1 min-h-[100px] cursor-pointer hover:bg-muted/30 transition-colors ${!isCurrentMonth ? "bg-muted/20" : "bg-background"}`}
              onClick={() => {
                if (dayEvents.length > 0) {
                  setSelectedDayEvents({ date: day, events: dayEvents });
                } else {
                  handleDateChange(day);
                  setView("day");
                }
              }}
              data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
            >
              <div className={`text-sm mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                isToday(day) 
                  ? "bg-primary text-primary-foreground" 
                  : isCurrentMonth 
                    ? "hover:bg-muted" 
                    : "text-muted-foreground"
              }`}>
                {format(day, "d")}
              </div>
              <div className="space-y-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map(event => renderEventBlock(event, true))}
                {dayEvents.length > 3 && (
                  <button 
                    className="text-[10px] text-primary hover:underline w-full text-left px-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDayEvents({ date: day, events: dayEvents });
                    }}
                    data-testid={`calendar-more-${format(day, "yyyy-MM-dd")}`}
                  >
                    +{dayEvents.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex h-full w-full bg-background">
      {renderMiniCalendar()}
      
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between gap-2 px-2 py-2 border-b flex-wrap">
          {/* Mobile Header — Settings + view type (tap = bottom sheet) in header; Today between chevrons */}
          {isMobile ? (
            <div className="flex items-center justify-between gap-2 w-full">
              {/* Left: Settings (calendar header) + View type (tap = bottom-up popup) */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => {
                    setShowSettingsMenu(true);
                    setSettingsSubMenu("main");
                  }}
                  data-testid="calendar-settings-button-mobile"
                  aria-label="Calendar settings"
                >
                  <Settings className="w-4 h-4" />
                </Button>
                <button
                  onClick={() => setShowViewSelector(true)}
                  className="flex items-center gap-2 text-base font-medium whitespace-nowrap min-w-0"
                >
                  {view === "day" && <CalendarIcon className="w-4 h-4 flex-shrink-0" />}
                  {view === "week" && <CalendarDays className="w-4 h-4 flex-shrink-0" />}
                  {view === "month" && <Calendar className="w-4 h-4 flex-shrink-0" />}
                  {view === "map" && <MapIcon className="w-4 h-4 flex-shrink-0" />}
                  <span className="truncate">
                    {view === "day" ? "Today" : view === "week" ? "Week" : view === "month" ? "Month" : "Map"}
                  </span>
                </button>
              </div>
              {/* Center–right: Chevrons with "Today" between */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => navigateDate("prev")}
                  data-testid="calendar-prev-btn"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 font-medium min-w-[4rem]"
                  onClick={goToToday}
                  data-testid="calendar-today-btn"
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => navigateDate("next")}
                  data-testid="calendar-next-btn"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Desktop Header */}
              <div className="flex items-center gap-1">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={goToToday}
                  className="font-medium"
                  data-testid="calendar-today-btn"
                >
                  Today
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => navigateDate("prev")}
                  data-testid="calendar-prev-btn"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => navigateDate("next")}
                  data-testid="calendar-next-btn"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <h2 className="text-xl font-normal ml-2 whitespace-nowrap">{getHeaderTitle()}</h2>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Desktop: Tags */}
                <div className="flex items-center gap-1 border rounded-md p-0.5" data-testid="calendar-view-select">
                  <Button
                    variant={view === "day" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={() => setView("day")}
                  >
                    Day
                  </Button>
                  <Button
                    variant={view === "week" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={() => setView("week")}
                  >
                    Week
                  </Button>
                  <Button
                    variant={view === "month" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={() => setView("month")}
                  >
                    Month
                  </Button>
                  {!isEmployee && (
                    <Button
                      variant={view === "map" ? "default" : "ghost"}
                      size="sm"
                      className="h-7 px-3 text-xs"
                      onClick={() => setView("map")}
                    >
                      <MapIcon className="w-3.5 h-3.5 mr-1" />
                      Map
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Mobile Worker Filter - Sticky top container (admin only, shown on all views including map on mobile) */}
        {!isEmployee && isMobile && (
          <div className="lg:hidden sticky top-0 z-20 bg-background border-b overflow-x-auto">
            <div className="flex items-center gap-2 px-3 py-2 min-w-max">
                <Button
                  variant={activeTeamMembers.length > 0 && activeTeamMembers.every(member => enabledTeammates.has(member.id)) ? "default" : "outline"}
                  size="sm"
                  className={`h-8 px-3 text-xs whitespace-nowrap flex-shrink-0 ${
                    activeTeamMembers.length > 0 && activeTeamMembers.every(member => enabledTeammates.has(member.id))
                      ? "bg-green-500 hover:bg-green-600 text-white border-green-500"
                      : ""
                  }`}
                  onClick={() => {
                    // Toggle all workers on/off
                    // Check if ALL teammates are enabled (not just if sizes match)
                    const allEnabled = activeTeamMembers.length > 0 && 
                      activeTeamMembers.every(member => enabledTeammates.has(member.id));
                    
                    if (allEnabled) {
                      // Turn all off
                      setEnabledTeammates(new Set());
                    } else {
                      // Turn all on
                      const allIds = new Set(activeTeamMembers.map(m => m.id));
                      setEnabledTeammates(allIds);
                    }
                  }}
                >
                  All Workers
                </Button>
                {activeTeamMembers.map((member) => {
                  const isEnabled = enabledTeammates.has(member.id);
                  const jobCount = filteredApplications.filter(
                    (app) => app.teamMemberId === member.id && app.status === "accepted"
                  ).length;

                  return (
                    <Button
                      key={member.id}
                      variant="outline"
                      size="sm"
                      className={`h-8 px-3 text-xs whitespace-nowrap flex-shrink-0 flex items-center gap-1.5 ${
                        isEnabled 
                          ? "bg-green-500 hover:bg-green-600 text-white border-green-500" 
                          : "bg-background hover:bg-muted"
                      }`}
                      onClick={() => handleToggleTeammate(member.id)}
                    >
                      <Avatar className="w-4 h-4">
                        <AvatarImage src={member.avatarUrl || undefined} />
                        <AvatarFallback className="text-[8px]">
                          {member.firstName[0]}{member.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <span>{member.firstName}</span>
                      {jobCount > 0 && (
                        <Badge 
                          variant="secondary" 
                          className={`text-[10px] px-1 py-0 h-4 ${
                            isEnabled 
                              ? "bg-green-600 text-white" 
                              : ""
                          }`}
                        >
                          {jobCount}
                        </Badge>
                      )}
                    </Button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Hide mobile legend for employees - they only see accepted jobs */}
        {/* Also hide legend on map view */}
        {!isEmployee && view !== "map" && (
          <div className="lg:hidden flex items-center gap-4 px-2 py-2 border-b text-xs bg-muted/30">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-green-500" />
              <span>Accepted</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-amber-500" />
              <span>Pending</span>
            </div>
            {showOpportunities && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-950" />
                <span>Available</span>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {view === "day" && renderDayView()}
          {view === "week" && renderWeekView()}
          {view === "month" && renderMonthView()}
          {view === "map" && !isEmployee && (
            <CalendarMapView
              selectedDate={currentDate}
              onDateChange={handleDateChange}
              teammates={mapTeammates}
              jobAssignments={mapJobAssignments}
              availableJobs={availableJobs}
              enabledTeammates={enabledTeammates}
              onToggleTeammate={handleToggleTeammate}
              focusTeammateId={focusedTeammateId}
              showAcceptedJobs={showAcceptedJobs}
              showPendingJobs={showPendingJobs}
              showAvailableJobs={showAvailableJobs}
              onToggleAcceptedJobs={setShowAcceptedJobs}
              onTogglePendingJobs={setShowPendingJobs}
              onToggleAvailableJobs={setShowAvailableJobs}
              workerProfile={profile ? {
                address: profile.address,
                city: profile.city,
                state: profile.state,
                zipCode: profile.zipCode,
                latitude: profile.latitude,
                longitude: profile.longitude,
              } : null}
              onJobAction={(jobId, action) => {
                const job = availableJobs.find(j => j.id === jobId);
                if (!job) return;
                
                switch (action) {
                  case "view":
                    onViewJob(job);
                    break;
                  case "add-to-route":
                    // Handle adding job to route - could open a dialog to select teammate
                    onViewJob(job);
                    break;
                  case "call":
                    // TODO: Implement call functionality
                    toast({ title: "Call feature coming soon" });
                    break;
                  case "message":
                    // TODO: Implement message functionality
                    toast({ title: "Message feature coming soon" });
                    break;
                  case "directions":
                    onGetDirections(job);
                    break;
                }
              }}
              height="100%"
            />
          )}
        </div>
      </div>

      <JobDetailsSheet
        open={!!selectedEvent}
        onOpenChange={(open) => !open && setSelectedEvent(null)}
        job={selectedEvent?.job || null}
        status={selectedEvent?.type || "opportunity"}
        applicationId={selectedEvent?.applicationId}
        proposedRate={selectedEvent?.proposedRate}
        profile={profile}
        teamMember={selectedEvent?.teamMember}
        company={selectedEvent?.company}
        activeTeamMembers={activeTeamMembers}
        workerHourlyRate={workerHourlyRate}
        clockInStatus={clockInStatus}
        clockInError={clockInError}
        isClockingIn={isClockingIn}
        isClockingOut={isClockingOut}
        isWithdrawing={isWithdrawing}
        onClockIn={onClockIn}
        onClockOut={onClockOut}
        onGetDirections={onGetDirections}
        onWithdraw={(appId) => {
          onWithdrawApplication(appId);
          setSelectedEvent(null);
        }}
        onUpdateTeamMember={onUpdateTeamMember}
        onApply={(job) => {
          onApplyToJob(job);
          setSelectedEvent(null);
        }}
      />

      <EnhancedJobDialog
        open={!!selectedOpportunityJob}
        onOpenChange={(open) => !open && setSelectedOpportunityJob(null)}
        job={selectedOpportunityJob}
        profile={profile}
        activeTeamMembers={activeTeamMembers.map(m => ({
          id: m.id,
          firstName: m.firstName,
          lastName: m.lastName,
          avatarUrl: m.avatarUrl,
          hourlyRate: m.hourlyRate,
        }))}
        workerLocation={null}
        onOpenApply={(job) => {
          setSelectedOpportunityJob(null);
          onApplyToJob(job);
        }}
        onDismiss={(job) => {
          setSelectedOpportunityJob(null);
        }}
      />

      {/* Accepted Job Dialog - mirrors TodayPage's JobDetailsDialog */}
      {selectedAcceptedEvent && (() => {
        const job = selectedAcceptedEvent.job;
        const jobStartDate = new Date(job.startDate);
        const isJobToday = new Date().toDateString() === jobStartDate.toDateString();
        const isFutureJob = new Date() < jobStartDate;
        const isClockedInToThisJob = clockInStatus?.activeJobId === job.id;
        const isAssignedWorker = !selectedAcceptedEvent.teamMember;
        const canClockIn = isJobToday && !clockInStatus?.isClockedIn && isAssignedWorker;
        const isClocking = clockingJobId === job.id || clockingJobId === clockInStatus?.activeTimesheet?.id;
        const jobTypeInfo = getJobTypeInfo(job);
        const JobTypeIcon = jobTypeInfo.icon;
        const hasMapLocation = job.latitude && job.longitude;
        
        const allMedia: { type: "image" | "video"; url: string }[] = [];
        if (job.images && Array.isArray(job.images)) {
          job.images.forEach((url: string) => allMedia.push({ type: "image", url }));
        }
        if (job.videos && Array.isArray(job.videos)) {
          job.videos.forEach((url: string) => allMedia.push({ type: "video", url }));
        }
        
        const totalHoursWorked = jobTimesheets.reduce((acc, ts) => {
          if (ts.clockInTime && ts.clockOutTime) {
            const clockIn = new Date(ts.clockInTime);
            const clockOut = new Date(ts.clockOutTime);
            const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
            return acc + hours;
          }
          return acc;
        }, 0);
        
        const groupedByDay = jobTimesheets.reduce((acc, ts) => {
          const clockIn = ts.clockInTime ? new Date(ts.clockInTime) : null;
          if (!clockIn) return acc;
          const dateKey = format(clockIn, "yyyy-MM-dd");
          if (!acc[dateKey]) {
            acc[dateKey] = { date: clockIn, entries: [] as Timesheet[], totalHours: 0 };
          }
          acc[dateKey].entries.push(ts);
          if (ts.clockInTime && ts.clockOutTime) {
            const clockOut = new Date(ts.clockOutTime);
            acc[dateKey].totalHours += (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
          }
          return acc;
        }, {} as Record<string, { date: Date; entries: Timesheet[]; totalHours: number }>);
        
        const sortedDays = Object.keys(groupedByDay).sort((a, b) => b.localeCompare(a));
        
        const content = (
          <>
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
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white"
                      data-testid="calendar-media-prev"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => { setMediaLoaded(false); setCurrentMediaIndex(i => i < allMedia.length - 1 ? i + 1 : 0); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white"
                      data-testid="calendar-media-next"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                      {allMedia.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => { setMediaLoaded(false); setCurrentMediaIndex(idx); }}
                          className={`w-2 h-2 rounded-full ${idx === currentMediaIndex ? 'bg-white' : 'bg-white/50'}`}
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
              <div>
                <h2 className="text-xl font-bold">{job.title}</h2>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <Badge className="bg-green-500 text-white">Accepted</Badge>
                  <button 
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover-elevate ${jobTypeInfo.color}`}
                    onClick={() => setScheduleInfoJob(job)}
                    data-testid="calendar-job-type-badge"
                  >
                    <JobTypeIcon className="w-3 h-3" />
                    {jobTypeInfo.label}
                  </button>
                  {selectedAcceptedEvent.teamMember && (
                    <Badge variant="outline">
                      <User className="w-3 h-3 mr-1" />
                      {selectedAcceptedEvent.teamMember.firstName} {selectedAcceptedEvent.teamMember.lastName}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <button 
                  className="flex items-start gap-3 p-3 bg-secondary/50 rounded-lg w-full text-left hover-elevate cursor-pointer"
                  onClick={() => setScheduleInfoJob(job)}
                  data-testid="calendar-time-button"
                >
                  <Calendar className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <JobTimeDisplay job={job} showFullDate={true} />
                </button>
                <button 
                  className="flex items-start gap-3 p-3 bg-secondary/50 rounded-lg w-full text-left hover-elevate cursor-pointer"
                  onClick={() => openLocationPopup(job)}
                  data-testid="calendar-location-button"
                >
                  <MapPin className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span>{getFullAddress(job)}</span>
                </button>
              </div>

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

              {companyProfile && (
                <div className="bg-card rounded-xl border p-4" data-testid="calendar-company-info">
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Posted By
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
                          {Number(companyProfile.averageRating).toFixed(1)} rating
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {job.description && (
                <div className="p-4 bg-secondary/30 rounded-xl">
                  <h3 className="font-semibold text-sm mb-2">Job Description</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{job.description}</p>
                </div>
              )}

              {jobTimesheets.length > 0 && (
                <div className="bg-card rounded-xl border p-4" data-testid="calendar-timesheet-history">
                  <h3 className="font-semibold text-sm mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Clock In/Out History
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {totalHoursWorked.toFixed(1)}h total
                    </span>
                  </h3>
                  <ScrollArea className="max-h-48">
                    <Accordion type="multiple" className="space-y-1" defaultValue={sortedDays.slice(0, 1)}>
                      {sortedDays.map((dateKey) => {
                        const day = groupedByDay[dateKey];
                        const hasActiveEntry = day.entries.some(ts => !ts.clockOutTime);
                        
                        return (
                          <AccordionItem key={dateKey} value={dateKey} className="border rounded-lg px-3 bg-secondary/30">
                            <AccordionTrigger className="py-2 hover:no-underline">
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
                                    {day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'}
                                  </Badge>
                                  <span className="text-xs font-semibold text-primary">
                                    {day.totalHours.toFixed(1)}h
                                  </span>
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="pb-2">
                              <div className="space-y-1.5 pt-1">
                                {day.entries.map((ts) => {
                                  const clockIn = ts.clockInTime ? new Date(ts.clockInTime) : null;
                                  const clockOut = ts.clockOutTime ? new Date(ts.clockOutTime) : null;
                                  const duration = clockIn && clockOut 
                                    ? ((clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60)).toFixed(1)
                                    : null;
                                  
                                  return (
                                    <div 
                                      key={ts.id}
                                      className="flex items-center justify-between py-1.5 px-2 bg-background rounded text-sm"
                                    >
                                      <span className="text-muted-foreground text-xs">
                                        {clockIn ? format(clockIn, "h:mm a") : ""}
                                        {" - "}
                                        {clockOut ? format(clockOut, "h:mm a") : "Active"}
                                      </span>
                                      {duration ? (
                                        <span className="text-xs font-medium">{duration}h</span>
                                      ) : (
                                        <span className="text-xs text-green-500 font-medium">In Progress</span>
                                      )}
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
              )}

              <div className="flex flex-col gap-2 pt-2">
                {isFutureJob ? (
                  <Button
                    variant="secondary"
                    className="w-full h-12 opacity-60"
                    data-testid="calendar-button-job-not-started"
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Job Has Not Begun
                  </Button>
                ) : isClockedInToThisJob ? (
                  <Button
                    variant="destructive"
                    onClick={() => handleDialogClockOut(clockInStatus!.activeTimesheet!.id)}
                    disabled={isClocking}
                    className="w-full h-12"
                    data-testid="calendar-button-clock-out"
                  >
                    {isClocking ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Square className="w-4 h-4 mr-2" />}
                    Clock Out
                  </Button>
                ) : canClockIn ? (
                  <Button
                    onClick={() => handleDialogClockIn(job.id)}
                    disabled={isClocking || !!clockInStatus?.isClockedIn}
                    className="w-full h-12"
                    data-testid="calendar-button-clock-in"
                  >
                    {isClocking ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                    Clock In
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    disabled
                    className="w-full h-12 opacity-40"
                    data-testid="calendar-button-clock-in-disabled"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Clock In
                  </Button>
                )}

                <div className="flex gap-2">
                  <Button
                    variant={isFutureJob ? "secondary" : "outline"}
                    onClick={() => { if (!isFutureJob) openDirections(job); }}
                    disabled={isFutureJob}
                    className={`flex-1 h-11 ${isFutureJob ? 'opacity-60' : ''}`}
                    data-testid="calendar-button-directions"
                  >
                    <Car className="w-4 h-4 mr-2" />
                    Directions
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setSelectedAcceptedEvent(null); goToChat(job.id); }}
                    className="flex-1 h-11"
                    data-testid="calendar-button-chat"
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Chat
                  </Button>
                </div>
              </div>
            </div>
          </>
        );
        
        if (isMobile) {
          return (
            <Sheet open={!!selectedAcceptedEvent} onOpenChange={(open) => { if (!open) { setSelectedAcceptedEvent(null); setCurrentMediaIndex(0); setMediaLoaded(false); } }}>
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
          <Dialog open={!!selectedAcceptedEvent} onOpenChange={(open) => { if (!open) { setSelectedAcceptedEvent(null); setCurrentMediaIndex(0); setMediaLoaded(false); } }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
              <DialogHeader className="sr-only">
                <DialogTitle>{job.title}</DialogTitle>
                <DialogDescription>{job.trade} - {getFullAddress(job)}</DialogDescription>
              </DialogHeader>
              {content}
            </DialogContent>
          </Dialog>
        );
      })()}

      <MobilePopup
        open={!!selectedDayEvents}
        onOpenChange={(open) => !open && setSelectedDayEvents(null)}
        title={selectedDayEvents ? format(selectedDayEvents.date, "EEEE, MMMM d, yyyy") : "Day Events"}
        description={selectedDayEvents ? `${selectedDayEvents.events.length} job${selectedDayEvents.events.length !== 1 ? "s" : ""} scheduled` : ""}
      >
        {selectedDayEvents && (
          <div className="space-y-2">
            {selectedDayEvents.events.map(event => (
              <div
                key={event.id}
                className="p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => {
                  setSelectedDayEvents(null);
                  if (event.type === "opportunity") {
                    setSelectedOpportunityJob(event.job);
                  } else if (event.type === "accepted") {
                    setCurrentMediaIndex(0);
                    setMediaLoaded(false);
                    setSelectedAcceptedEvent(event);
                  } else {
                    setSelectedEvent(event);
                  }
                }}
                data-testid={`day-event-${event.id}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-3 h-3 rounded ${
                    event.type === "accepted" ? "bg-green-500" :
                    event.type === "pending" ? "bg-amber-500" :
                    "border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-950"
                  }`} />
                  <span className="font-medium">{event.title}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {event.scheduledTime ? (
                    <span>{event.scheduledTime}</span>
                  ) : (
                    <span className="italic">Flexible Time</span>
                  )}
                  {event.estimatedHours && (
                    <span>{event.estimatedHours} hours</span>
                  )}
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    {calculatePayout(event)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </MobilePopup>
      
      {/* Mobile View Selector - Bottom Sheet */}
      {isMobile && (
        <Drawer open={showViewSelector} onOpenChange={setShowViewSelector}>
          <DrawerContent className="max-h-[50vh]">
            <DrawerTitle className="sr-only">Select Calendar View</DrawerTitle>
            <DrawerDescription className="sr-only">Choose how to view your calendar</DrawerDescription>
            <div className="p-4">
              <h3 className="font-semibold text-sm mb-4 text-center">Select View</h3>
              <div className="space-y-2">
                <Button
                  variant={view === "day" ? "default" : "outline"}
                  className="w-full justify-start"
                  onClick={() => {
                    setView("day");
                    setShowViewSelector(false);
                  }}
                >
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  Today
                </Button>
                <Button
                  variant={view === "week" ? "default" : "outline"}
                  className="w-full justify-start"
                  onClick={() => {
                    setView("week");
                    setShowViewSelector(false);
                  }}
                >
                  <CalendarDays className="w-4 h-4 mr-2" />
                  Week
                </Button>
                <Button
                  variant={view === "month" ? "default" : "outline"}
                  className="w-full justify-start"
                  onClick={() => {
                    setView("month");
                    setShowViewSelector(false);
                  }}
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Month
                </Button>
                {!isEmployee && (
                  <Button
                    variant={view === "map" ? "default" : "outline"}
                    className="w-full justify-start"
                    onClick={() => {
                      setView("map");
                      setShowViewSelector(false);
                    }}
                  >
                    <MapIcon className="w-4 h-4 mr-2" />
                    Map
                  </Button>
                )}
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}

      {/* Consolidated Mobile Settings Menu */}
      {isMobile && (
        <Drawer open={showSettingsMenu} onOpenChange={setShowSettingsMenu}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerTitle className="sr-only">Calendar Settings</DrawerTitle>
            <DrawerDescription className="sr-only">Calendar settings and options</DrawerDescription>
            <div className="flex flex-col h-full">
              {/* Breadcrumb Header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                {settingsSubMenu !== "main" ? (
                  <>
                    <button
                      onClick={() => setSettingsSubMenu("main")}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    <span className="text-muted-foreground">/</span>
                    <span className="font-medium text-sm">
                      {settingsSubMenu === "import" && "Import Calendar"}
                      {settingsSubMenu === "export" && "Export Calendar"}
                      {settingsSubMenu === "opportunities" && "Opportunities"}
                    </span>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setShowSettingsMenu(false)}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    <span className="text-muted-foreground">/</span>
                    <span className="font-medium text-sm">Calendar Settings</span>
                  </>
                )}
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {settingsSubMenu === "main" ? (
                  <div className="p-4 space-y-1">
                    {/* Opportunities Toggle */}
                    {!isEmployee && (
                      <button
                        onClick={() => setSettingsSubMenu("opportunities")}
                        className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Zap className="w-5 h-5 text-muted-foreground" />
                          <div className="text-left">
                            <div className="font-medium text-sm">Opportunities</div>
                            <div className="text-xs text-muted-foreground">
                              {showOpportunities ? "Showing available jobs" : "Hidden"}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </button>
                    )}
                    
                    {/* Export Calendar */}
                    <button
                      onClick={() => setSettingsSubMenu("export")}
                      className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Download className="w-5 h-5 text-muted-foreground" />
                        <div className="text-left">
                          <div className="font-medium text-sm">Export Calendar</div>
                          <div className="text-xs text-muted-foreground">Share your calendar</div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    
                    {/* Import Calendar */}
                    <button
                      onClick={() => setSettingsSubMenu("import")}
                      className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Link className="w-5 h-5 text-muted-foreground" />
                        <div className="text-left">
                          <div className="font-medium text-sm">Import Calendar</div>
                          <div className="text-xs text-muted-foreground">Add external calendars</div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                ) : settingsSubMenu === "export" ? (
                  <div className="p-4 space-y-4">
                    <div>
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        Export Your Calendar
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Copy this link to add your Tolstoy jobs to Google Calendar, Outlook, or any calendar app.
                      </p>
                      <div className="flex gap-2">
                        <Input
                          value={exportCalendarUrl}
                          readOnly
                          className="text-xs"
                          data-testid="input-export-url"
                        />
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={handleCopyExportUrl}
                          data-testid="button-copy-export-url"
                        >
                          {copiedExportUrl ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : settingsSubMenu === "import" ? (
                  <div className="p-4 space-y-4">
                    <div>
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Link className="w-4 h-4" />
                        Import External Calendar
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Paste a calendar URL from Google Calendar or Outlook to see your events here.
                      </p>
                      <div className="space-y-3">
                        <Input
                          placeholder="Paste calendar URL here..."
                          value={importCalendarUrl}
                          onChange={(e) => setImportCalendarUrl(e.target.value)}
                          data-testid="input-import-url"
                        />
                        <Button
                          className="w-full gap-2"
                          disabled={isImporting || !importCalendarUrl.trim()}
                          onClick={handleImportCalendar}
                          data-testid="button-import-calendar"
                        >
                          {isImporting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CalendarIcon className="w-4 h-4" />
                          )}
                          Import Calendar
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : settingsSubMenu === "opportunities" ? (
                  <div className="p-4 space-y-4">
                    <div>
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Zap className="w-4 h-4" />
                        Show Opportunities
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Toggle whether to show available job opportunities on your calendar.
                      </p>
                      <div className="flex items-center justify-between p-4 rounded-lg border">
                        <Label htmlFor="opportunities-toggle" className="text-sm font-medium">
                          Show Opportunities
                        </Label>
                        <Switch
                          id="opportunities-toggle"
                          checked={showOpportunities}
                          onCheckedChange={setShowOpportunities}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}
      
      {/* Desktop Settings Dialog */}
      {!isMobile && (
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Calendar Settings</DialogTitle>
              <DialogDescription>
                Import external calendars or share your Tolstoy calendar
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6 py-2">
              <div>
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Export Your Calendar
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Copy this link to add your Tolstoy jobs to Google Calendar, Outlook, or any calendar app.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={exportCalendarUrl}
                    readOnly
                    className="text-xs"
                    data-testid="input-export-url-desktop"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={handleCopyExportUrl}
                    data-testid="button-copy-export-url-desktop"
                  >
                    {copiedExportUrl ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              
              <div className="border-t pt-6">
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Link className="w-4 h-4" />
                  Import External Calendar
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Paste a calendar URL from Google Calendar or Outlook to see your events here.
                </p>
                <div className="space-y-3">
                  <Input
                    placeholder="Paste calendar URL here..."
                    value={importCalendarUrl}
                    onChange={(e) => setImportCalendarUrl(e.target.value)}
                    data-testid="input-import-url-desktop"
                  />
                  <Button
                    className="w-full gap-2"
                    disabled={isImporting || !importCalendarUrl.trim()}
                    onClick={handleImportCalendar}
                    data-testid="button-import-calendar-desktop"
                  >
                    {isImporting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CalendarIcon className="w-4 h-4" />
                    )}
                    Import Calendar
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Schedule Info Popup */}
      <MobilePopup
        open={!!scheduleInfoJob}
        onOpenChange={(open) => !open && setScheduleInfoJob(null)}
        title="Schedule Information"
        description={scheduleInfoJob?.title || "Job schedule details"}
      >
        {scheduleInfoJob && (() => {
          const jobTypeInfo = getJobTypeInfo(scheduleInfoJob);
          const JobTypeIcon = jobTypeInfo.icon;
          const timeInfo = formatJobTime(scheduleInfoJob);
          
          return (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <Badge className={jobTypeInfo.color}>
                  <JobTypeIcon className="w-3 h-3 mr-1" />
                  {jobTypeInfo.label}
                </Badge>
              </div>
              
              <div className="space-y-3">
                <div className="p-3 bg-secondary/50 rounded-lg">
                  <p className="font-semibold text-sm">{timeInfo.relative}</p>
                  <p className="text-sm text-muted-foreground">{timeInfo.fullDate}</p>
                  {timeInfo.timeRange && (
                    <p className="text-sm mt-1">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {timeInfo.timeRange}
                    </p>
                  )}
                </div>
                
                {scheduleInfoJob.jobType === "recurring" && timeInfo.scheduleDaysDisplay && (
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <p className="text-sm font-medium mb-1">Recurring Days</p>
                    <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded">
                      {timeInfo.scheduleDaysDisplay}
                    </span>
                  </div>
                )}
                
                {scheduleInfoJob.jobType === "recurring" && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      <Repeat className="w-3 h-3 inline mr-1" />
                      This job repeats on a regular schedule. You'll work the same hours weekly.
                    </p>
                  </div>
                )}
                
                {(scheduleInfoJob.isOnDemand || scheduleInfoJob.jobType === "on_demand") && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      <Zap className="w-3 h-3 inline mr-1" />
                      Flexible schedule - work according to your communications with the company.
                    </p>
                  </div>
                )}
              </div>
              
              <Button 
                variant="outline" 
                className="w-full" 
                onClick={() => setScheduleInfoJob(null)}
              >
                Close
              </Button>
            </div>
          );
        })()}
      </MobilePopup>

      {/* Location Info Popup */}
      <MobilePopup
        open={!!locationInfoJob}
        onOpenChange={(open) => !open && setLocationInfoJob(null)}
        title="Location Details"
        description={locationInfoJob?.title || "Job location"}
      >
        {locationInfoJob && (
          <div className="space-y-4 py-2">
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">{getFullAddress(locationInfoJob)}</p>
                </div>
              </div>
            </div>
            
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Car className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Estimated Drive Time</p>
                  {isCalculatingDrive ? (
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Calculating from your location...
                    </p>
                  ) : drivingTime ? (
                    <p className="text-sm text-primary font-semibold">{drivingTime}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Location access needed</p>
                  )}
                </div>
              </div>
            </div>
            
            {locationInfoJob.latitude && locationInfoJob.longitude && (
              <div className="rounded-xl overflow-hidden border">
                <MiniJobMap
                  job={{
                    id: locationInfoJob.id,
                    lat: parseFloat(locationInfoJob.latitude),
                    lng: parseFloat(locationInfoJob.longitude),
                    title: locationInfoJob.title,
                    trade: locationInfoJob.trade || undefined,
                    hourlyRate: locationInfoJob.hourlyRate || undefined,
                    city: locationInfoJob.city || undefined,
                    state: locationInfoJob.state || undefined,
                  }}
                  className="w-full h-32"
                />
              </div>
            )}
            
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={() => setLocationInfoJob(null)}
              >
                Close
              </Button>
              <Button 
                className="flex-1"
                onClick={() => {
                  openDirections(locationInfoJob);
                  setLocationInfoJob(null);
                }}
              >
                <Navigation className="w-4 h-4 mr-1" />
                Get Directions
              </Button>
            </div>
          </div>
        )}
      </MobilePopup>
    </div>
  );
});

WorkerCalendar.displayName = "WorkerCalendar";
