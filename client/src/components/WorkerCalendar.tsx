import { useState, useMemo, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, isTomorrow, isSameMonth, getDay, differenceInDays, isBefore, isAfter, startOfDay } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePersistentFilter, usePersistentSetFilter } from "@/hooks/use-persistent-filter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MobilePopup } from "@/components/ui/mobile-popup";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerHeader } from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ChevronLeft, ChevronRight, Settings, Download, Copy, Link, Check, Loader2, Calendar as CalendarIcon, MapPin, Clock, Play, Square, Car, MessageSquare, Building2, Star, CheckCircle2, Image as ImageIcon, User, Users, Calendar, Repeat, Briefcase, AlertCircle, Zap, CalendarDays, Navigation, Map as MapIcon, X, Trash2, Pencil } from "lucide-react";
import { useIsMobile, useIsDesktop } from "@/hooks/use-mobile";
import { getDisplayJobTitle } from "@/lib/job-display";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import type { Job, Application, WorkerTeamMember, Profile, Timesheet } from "@shared/schema";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { JobDetailsSheet } from "./JobDetailsSheet";
import { EnhancedJobDialog } from "./EnhancedJobDialog";
import { JobLocationMap, MiniJobMap, type PersonLocation } from "./JobsMap";
import { CalendarMapView } from "./CalendarMapView";
import { cn, formatTime12h, normalizeAvatarUrl } from "@/lib/utils";

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
  /** When opening a pending application from calendar, pass application so dialog shows Pending Review, withdraw, masked address, no chat/clock in. */
  onViewJob: (job: Job, application?: { id: number; status: "pending" | "accepted" | "rejected"; proposedRate?: number | null; teamMember?: { id: number; firstName: string | null; lastName: string | null; avatarUrl: string | null; hourlyRate: number | null } | null } | null) => void;
  onWithdrawApplication: (applicationId: number) => void;
  onUpdateTeamMember: (applicationId: number, teamMemberId: number | null) => void;
  onGetDirections: (job: Job) => void;
  /** When user clicks "Add to route" for an available job, open apply dialog at step 3 (message). */
  onApplyToJobAtStep3?: (job: Job) => void;
  isWithdrawing?: boolean;
  clockInStatus?: ClockInStatus;
  clockInError?: string | null;
  onClockIn?: (jobId: number, workerId: number) => Promise<{ success: boolean; error?: string; code?: string; distanceMiles?: string }>;
  onClockOut?: (timesheetId: number) => Promise<{ success: boolean; error?: string }>;
  isClockingIn?: boolean;
  isClockingOut?: boolean;
  isEmployee?: boolean;
  impersonatedTeamMemberId?: number | null;
  /** When set (mobile), calendar toolbar is rendered into this slot instead of local banner. */
  calendarHeaderSlotRef?: React.RefObject<HTMLDivElement | null>;
  /** True when the slot DOM node is mounted (so we can portal). */
  calendarHeaderSlotReady?: boolean;
  /** Same as Find Work map: draw radius circles (worker + teammates). */
  referencePoints?: Array<{ lat: number; lng: number }>;
  referenceRadiusMiles?: number;
  referenceRadiusMilesArray?: number[];
  workerTeamId?: number | null;
  /** One-shot deep link from URL: open accepted-event details for this job id. */
  calendarDeepLinkJobId?: number | null;
  onCalendarDeepLinkHandled?: () => void;
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
  type: "accepted" | "pending" | "opportunity" | "imported";
  job: Job;
  teamMember?: WorkerTeamMember | null;
  company?: { id: number; companyName: string | null; phone: string | null; avatarUrl?: string | null; companyLogo?: string | null; firstName?: string | null; lastName?: string | null } | null;
  /** For type "imported": external calendar event source (e.g. "John" or "You") */
  sourceName?: string;
  sourceProfileId?: number;
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

/**
 * Get all occurrence dates for a recurring job. If rangeStart/rangeEnd are provided,
 * returns dates within that range (for calendar display). Otherwise returns dates
 * from job start for recurringWeeks (legacy).
 */
function getRecurringDates(job: Job, rangeStart?: Date, rangeEnd?: Date): Date[] {
  const days = job.scheduleDays || (job as any).recurringDays || [];
  if (days.length === 0 || job.jobType !== "recurring") {
    return [];
  }

  const scheduleDayNumbers = days
    .map((d: string) => DAY_MAP[(d || "").toString().toLowerCase()])
    .filter((n: number | undefined): n is number => n !== undefined);

  if (scheduleDayNumbers.length === 0) return [];

  const jobStart = new Date(job.startDate);
  jobStart.setHours(0, 0, 0, 0);

  let start: Date;
  let end: Date;
  if (rangeStart && rangeEnd) {
    start = startOfDay(rangeStart);
    end = startOfDay(rangeEnd);
    // Don't include dates before the job's start
    if (end <= jobStart) return [];
    if (start < jobStart) start = new Date(jobStart);
  } else {
    const weeks = (job as any).recurringWeeks || 52;
    start = new Date(jobStart);
    end = addDays(jobStart, weeks * 7);
  }

  const dates: Date[] = [];
  let current = new Date(start);
  while (current < end) {
    const dayOfWeek = getDay(current);
    if (scheduleDayNumbers.includes(dayOfWeek)) {
      dates.push(new Date(current));
    }
    current = addDays(current, 1);
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

/** Apply job scheduledTime to a given day so start/end have correct times for timeline height. */
function applyScheduledTimeToDay(day: Date, scheduledTime: string | undefined, estimatedHours?: number): { start: Date; end: Date } {
  const start = new Date(day);
  if (Number.isNaN(start.getTime())) {
    start.setTime(0);
  }
  start.setHours(0, 0, 0, 0);
  if (scheduledTime?.trim()) {
    const rangeParts = scheduledTime.split(/\s+[\-–—]\s+/).map((s) => s.trim()).filter(Boolean);
    const startPart = parseTime(rangeParts[0] ?? "");
    start.setHours(startPart.hours, startPart.minutes, 0, 0);
    if (rangeParts.length >= 2) {
      const endPart = parseTime(rangeParts[1] ?? "");
      const end = new Date(day);
      end.setHours(endPart.hours, endPart.minutes, 0, 0);
      return { start, end };
    }
  }
  const end = new Date(start);
  end.setHours(end.getHours() + (estimatedHours ?? 4), end.getMinutes(), 0, 0);
  return { start, end };
}

function getEventPosition(event: CalendarEvent): { top: number; height: number; isAllDay: boolean } {
  let startHour = 9;
  let startMinute = 0;
  let isAllDay = false;

  const startDateValid = event.startDate && !Number.isNaN(event.startDate.getTime());
  const endDateValid = event.endDate && !Number.isNaN(event.endDate.getTime());

  // Prefer startDate when we have it so the block aligns with actual job times (e.g. 6am–5pm on timeline)
  if (startDateValid && event.startDate) {
    const hours = event.startDate.getHours();
    const minutes = event.startDate.getMinutes();
    if (hours === 0 && minutes === 0 && !endDateValid) {
      isAllDay = true;
      startHour = 8;
    } else {
      startHour = hours;
      startMinute = minutes;
    }
  } else if (event.scheduledTime) {
    const { hours, minutes } = parseTime(event.scheduledTime);
    startHour = hours;
    startMinute = minutes;
  } else {
    isAllDay = true;
    startHour = 8;
  }
  
  // Duration: use actual start/end when available so blocks match the timeline (e.g. 6am–5pm = full height)
  let durationMinutes: number;
  if (endDateValid && startDateValid && event.endDate && event.startDate) {
    const mins = (event.endDate.getTime() - event.startDate.getTime()) / (60 * 1000);
    durationMinutes = Math.max(0, mins);
  } else if (event.scheduledTime) {
    const rangeParts = event.scheduledTime.split(/\s+[\-–—]\s+/).map((s) => s.trim()).filter(Boolean);
    if (rangeParts.length >= 2) {
      const startPart = parseTime(rangeParts[0] ?? "");
      const endPart = parseTime(rangeParts[1] ?? "");
      const startMins = startPart.hours * 60 + startPart.minutes;
      const endMins = endPart.hours * 60 + endPart.minutes;
      durationMinutes = endMins > startMins ? endMins - startMins : (event.estimatedHours || 4) * 60;
    } else {
      durationMinutes = (event.estimatedHours || 4) * 60;
    }
  } else {
    durationMinutes = (event.estimatedHours || 4) * 60;
  }
  
  const startOffset = (startHour - START_HOUR) * HOUR_HEIGHT + (startMinute / 60) * HOUR_HEIGHT;
  const height = (durationMinutes / 60) * HOUR_HEIGHT;
  
  return { top: Math.max(0, startOffset), height: Math.max(HOUR_HEIGHT / 2, height), isAllDay };
}

/** Day view: assign column index to each event so overlapping events sit side-by-side. Returns layout with columnIndex and totalColumns. */
function getDayViewEventLayout(events: CalendarEvent[]): { event: CalendarEvent; top: number; height: number; columnIndex: number; totalColumns: number }[] {
  const withPos = events.map((event) => {
    const { top, height } = getEventPosition(event);
    return { event, top, height, endOffset: top + height };
  });
  withPos.sort((a, b) => a.top - b.top || b.height - a.height);
  const columnEnds: number[] = [];
  const result: { event: CalendarEvent; top: number; height: number; columnIndex: number; totalColumns: number }[] = [];
  for (const { event, top, height, endOffset } of withPos) {
    let col = 0;
    while (col < columnEnds.length && columnEnds[col] > top) col++;
    if (col === columnEnds.length) columnEnds.push(0);
    columnEnds[col] = endOffset;
    result.push({ event, top, height, columnIndex: col, totalColumns: columnEnds.length });
  }
  const maxCols = columnEnds.length;
  result.forEach((r) => { r.totalColumns = maxCols; });
  return result;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** Format event time range to 12-hour (e.g. "08:00 - 17:00" -> "8:00 AM - 5:00 PM"). Already-12h strings pass through. */
function formatEventTimeTo12h(scheduledTime: string | undefined): string {
  if (!scheduledTime?.trim()) return "";
  const s = scheduledTime.trim();
  if (/AM|PM/i.test(s)) return s;
  if (s.includes(" - ")) {
    const parts = s.split(" - ").map((p) => formatTime12h(p.trim()));
    return parts.join(" – ");
  }
  return formatTime12h(s);
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
  onApplyToJobAtStep3,
  isWithdrawing,
  clockInStatus,
  clockInError,
  onClockIn,
  onClockOut,
  isClockingIn,
  isClockingOut,
  isEmployee = false,
  impersonatedTeamMemberId,
  calendarHeaderSlotRef,
  calendarHeaderSlotReady,
  referencePoints,
  referenceRadiusMiles,
  referenceRadiusMilesArray,
  workerTeamId = null,
  calendarDeepLinkJobId,
  onCalendarDeepLinkHandled,
}, ref) => {
  // Persistent filters - these will be remembered across sessions
  const [view, setView] = usePersistentFilter<CalendarView>("calendar_view", "week");
  const [currentDateStr, setCurrentDateStr] = usePersistentFilter<string>("calendar_date", new Date().toISOString());
  const [showOpportunities, setShowOpportunities] = usePersistentFilter<boolean>("calendar_show_opportunities", true);
  const [selectedPersonFilter, setSelectedPersonFilter] = usePersistentFilter<"all" | number>("calendar_person_filter", "all");
  const [enabledTeammates, setEnabledTeammates] = usePersistentSetFilter("calendar_enabled_teammates", new Set<number>());
  const [showBusinessOperator, setShowBusinessOperator] = usePersistentFilter<boolean>("calendar_show_business_operator", true);
  
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
  const [editingCalendarUrl, setEditingCalendarUrl] = useState<string | null>(null);
  const [editingCalendarValue, setEditingCalendarValue] = useState("");
  const [isSavingImportSettings, setIsSavingImportSettings] = useState(false);
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
  const [showWorkerFilterSheet, setShowWorkerFilterSheet] = useState(false);
  const importUrlInputRef = useRef<HTMLInputElement>(null);

  // Focus Import URL input when settings dialog opens so user can paste immediately
  useEffect(() => {
    if (!showSettings) return;
    const t = setTimeout(() => importUrlInputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [showSettings]);

  // Expose method to open settings menu from parent via ref
  useImperativeHandle(ref, () => ({
    openSettingsMenu: () => {
      setShowSettingsMenu(true);
      setSettingsSubMenu("main");
    },
  }));

  // Employees cannot access Export; reset to main if they had export submenu open
  useEffect(() => {
    if (showSettingsMenu && isEmployee && settingsSubMenu === "export") {
      setSettingsSubMenu("main");
    }
  }, [showSettingsMenu, isEmployee, settingsSubMenu]);

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

  // When not on map: enable all teammates by default when they load (only if no saved filter).
  // When user has deselected all (showBusinessOperator false + size 0), don't override.
  // When on map: routes are per-person; show one route (auto-select first if none or multiple selected); selection is persisted
  useEffect(() => {
    if (isEmployee || activeTeamMembers.length === 0) return;
    if (view === "map") {
      if (enabledTeammates.size !== 1 && activeTeamMembers.length > 0) {
        const firstId = activeTeamMembers[0].id;
        setEnabledTeammates(new Set([firstId]));
      }
    } else {
      if (enabledTeammates.size === 0 && showBusinessOperator) {
        setEnabledTeammates(new Set(activeTeamMembers.map(m => m.id)));
      }
    }
  }, [view, activeTeamMembers, isEmployee, enabledTeammates.size, showBusinessOperator, setEnabledTeammates]);

  // Filter applications based on role - EXACTLY matching Today tab's filterByRole logic
  const filteredApplications = useMemo(() => {
    let filtered = applications;
    
    // Admins (business operators): apply worker filter (Me + enabled teammates)
    if (!isEmployee) {
      if (selectedPersonFilter !== "all") {
        if (selectedPersonFilter === 0) {
          filtered = filtered.filter(a => !a.teamMemberId);
        } else {
          filtered = filtered.filter(a => a.teamMemberId === selectedPersonFilter);
        }
      } else {
        // selectedPersonFilter === "all" → show Me (if enabled) + enabled teammates
        filtered = filtered.filter(
          (a) =>
            (showBusinessOperator && !a.teamMemberId) ||
            (a.teamMemberId != null && enabledTeammates.has(a.teamMemberId))
        );
      }
    } else {
      // Employees only see accepted jobs assigned to them (no pending, no other workers' jobs)
      if (impersonatedTeamMemberId) {
        filtered = filtered.filter(a => a.teamMemberId === impersonatedTeamMemberId);
      } else if (profile?.teamId) {
        filtered = filtered.filter(a => a.teamMemberId !== null && a.teamMemberId !== undefined);
      }
      // Restrict to accepted only: employee workers cannot see pending on calendar
      filtered = filtered.filter(a => a.status === "accepted");
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
  }, [applications, isEmployee, impersonatedTeamMemberId, selectedPersonFilter, profile?.teamId, showAcceptedJobs, showPendingJobs, showBusinessOperator, enabledTeammates]);
  
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  /** View + date nav + settings are portaled into WorkerDashboard header — don't repeat them in the sticky worker row */
  const mobileCalendarToolbarPortaled =
    isMobile && !!calendarHeaderSlotRef && !!calendarHeaderSlotReady && !!calendarHeaderSlotRef.current;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
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

  // Date range for calendar view (day/week/month) — used for recurring job occurrences and imported events
  const calendarViewRange = useMemo((): { start: Date; end: Date } | null => {
    if (view === "day") {
      const start = startOfDay(currentDate);
      return { start, end: addDays(start, 1) };
    }
    if (view === "week") {
      const start = startOfWeek(currentDate, { weekStartsOn: 0 });
      const end = endOfWeek(currentDate, { weekStartsOn: 0 });
      return { start, end: addDays(end, 1) };
    }
    if (view === "month") {
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      return { start, end: addDays(end, 1) };
    }
    return null;
  }, [view, currentDate]);

  // Date range for imported iCal events (day/week/month only; not used on map)
  const importedEventsRange = useMemo(() => {
    if (!calendarViewRange) return null;
    return { start: calendarViewRange.start.toISOString(), end: calendarViewRange.end.toISOString() };
  }, [calendarViewRange]);

  const { data: importedEventsData } = useQuery<{ events: { title: string; start: string; end: string; sourceProfileId?: number; sourceName?: string }[] }>({
    queryKey: ["/api/calendar/imported-events", importedEventsRange?.start, importedEventsRange?.end],
    queryFn: async () => {
      if (!importedEventsRange) return { events: [] };
      const res = await fetch(
        `/api/calendar/imported-events?start=${encodeURIComponent(importedEventsRange.start)}&end=${encodeURIComponent(importedEventsRange.end)}`,
        { credentials: "include" }
      );
      if (!res.ok) return { events: [] };
      const data = await res.json();
      const events = Array.isArray(data?.events) ? data.events : Array.isArray(data) ? data : [];
      return { events };
    },
    enabled: !!profile && view !== "map" && !!importedEventsRange,
    refetchOnWindowFocus: true,
  });

  const importedEvents = importedEventsData?.events ?? [];

  const { data: importSettingsData } = useQuery<{ importedCalendars: string[] }>({
    queryKey: ["/api/calendar/import-settings"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/import-settings", { credentials: "include" });
      if (!res.ok) return { importedCalendars: [] };
      const data = await res.json();
      return Array.isArray(data?.importedCalendars) ? data : { importedCalendars: [] };
    },
    enabled: !!profile,
  });
  const importedCalendarList = Array.isArray(importSettingsData?.importedCalendars) ? importSettingsData.importedCalendars : [];
  
  const saveImportSettings = useCallback(async (urls: string[]) => {
    setIsSavingImportSettings(true);
    try {
      const res = await fetch("/api/calendar/import-settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importedCalendars: urls }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/import-settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/imported-events"] });
        setEditingCalendarUrl(null);
        setEditingCalendarValue("");
      } else {
        toast({ title: "Failed to update", description: "Could not save calendar list.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to update", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsSavingImportSettings(false);
    }
  }, [queryClient, toast]);

  const handleRemoveImportedCalendar = useCallback((url: string) => {
    const next = importedCalendarList.filter((u) => u !== url);
    saveImportSettings(next);
  }, [importedCalendarList, saveImportSettings]);

  const handleSaveEditCalendar = useCallback((oldUrl: string, newUrl: string) => {
    if (!newUrl.trim()) return;
    const next = importedCalendarList.map((u) => (u === oldUrl ? newUrl.trim() : u));
    saveImportSettings(next);
  }, [importedCalendarList, saveImportSettings]);
  
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
  
  const normalizeCalendarUrl = (input: string): string => {
    const s = input.trim();
    if (!s) return s;
    const re = /https?:\/\//gi;
    const first = re.exec(s);
    if (!first) return s;
    const start = first.index;
    const next = re.exec(s);
    const end = next ? next.index : s.length;
    return s.slice(start, end).trim();
  };

  const handleImportCalendar = async () => {
    if (!importCalendarUrl.trim()) {
      toast({ title: "Enter a URL", description: "Please paste a calendar URL to import.", variant: "destructive" });
      return;
    }
    const urlToAdd = normalizeCalendarUrl(importCalendarUrl);
    if (!urlToAdd) {
      toast({ title: "Invalid URL", description: "Please paste a valid calendar URL.", variant: "destructive" });
      return;
    }
    setIsImporting(true);
    try {
      const response = await fetch("/api/calendar/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToAdd }),
      });
      if (response.ok) {
        toast({ title: "Calendar imported!", description: "Your external events have been added." });
        setImportCalendarUrl("");
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/import-settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/imported-events"] });
        await queryClient.refetchQueries({ queryKey: ["/api/calendar/import-settings"] });
        // Refetch imported events after a short delay so server session is saved and next request sees new URLs
        setTimeout(() => {
          queryClient.refetchQueries({ queryKey: ["/api/calendar/imported-events"] });
        }, 300);
      } else {
        const data = await response.json().catch(() => ({}));
        toast({ title: "Import failed", description: (data as { message?: string })?.message || "Could not import from this URL.", variant: "destructive" });
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
  
  // Get relative day label - matches WorkerDashboard accepted card (lowercase: today, tomorrow, in N days)
  const getRelativeDay = (date: Date): string => {
    if (isToday(date)) return "today";
    if (isTomorrow(date)) return "tomorrow";
    
    const daysFromNow = differenceInDays(date, new Date());
    if (daysFromNow < 0) return "Past";
    if (daysFromNow <= 6) return `in ${daysFromNow} days`;
    if (daysFromNow <= 13) return "next week";
    
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

  // Get time range for job - 12h format with " AM" / " PM" (e.g. "8:00 AM - 5:00 PM"). If scheduledTime contains " - ", use only the start part to avoid duplicating end time.
  const getTimeRange = (job: Job): { startTime: string | null; endTime: string | null } => {
    let startTime: string | null = null;
    let endTime: string | null = null;

    const parseAndFormatTime = (t: string): string => {
      const trimmed = t.trim();
      if (trimmed.toLowerCase().includes("am") || trimmed.toLowerCase().includes("pm")) return trimmed;
      return formatTime12h(trimmed);
    };

    if (job.scheduledTime) {
      const raw = parseAndFormatTime(job.scheduledTime);
      startTime = raw.includes(" - ") ? raw.split(" - ").map((s) => s.trim())[0] || raw : raw;
      if (job.endTime) endTime = parseAndFormatTime(job.endTime);
    }
    return { startTime, endTime };
  };

  // Format job time info - matches WorkerDashboard accepted card: "Feb 12 (in 6 days) Start 8am - 5pm"
  const formatJobTime = (job: Job): { relative: string; timeRange: string; fullDate: string; scheduleDaysDisplay?: string; dateTimeLine?: string } => {
    if (!job.startDate) {
      return { relative: "On Demand", timeRange: "Flexible hours", fullDate: "Flexible schedule", dateTimeLine: "On Demand" };
    }
    
    const startDate = new Date(job.startDate);
    const relativeDay = getRelativeDay(startDate);
    const fullDate = format(startDate, "EEEE, MMMM d, yyyy");
    const dateStr = format(startDate, "MMM d");
    const datePart = relativeDay ? `${dateStr} (${relativeDay})` : dateStr;
    
    const { startTime, endTime } = getTimeRange(job);
    let timeRange = startTime && endTime ? `${startTime} - ${endTime}` : (startTime || "Flexible");
    let dateTimeLine = startTime
      ? (endTime ? `${datePart} Start ${startTime} - ${endTime}` : `${datePart} Start ${startTime}`)
      : datePart;
    
    if (job.jobType === "recurring") {
      const scheduleDaysDisplay = formatScheduleDays(job.scheduleDays || (job as { recurringDays?: string[] }).recurringDays);
      if (scheduleDaysDisplay) {
        const relPart = relativeDay ? ` (${relativeDay})` : "";
        dateTimeLine = `${scheduleDaysDisplay}${relPart} Start ${timeRange}`;
      }
      return { relative: relativeDay, timeRange, fullDate, scheduleDaysDisplay, dateTimeLine };
    }
    
    return { relative: relativeDay, timeRange, fullDate, dateTimeLine };
  };

  // Format job time for display - matches WorkerDashboard accepted job card: "Feb 12 (in 6 days) Start 8am - 5pm"
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
          {timeInfo.dateTimeLine ?? timeInfo.relative}
          {!timeInfo.dateTimeLine && timeInfo.timeRange && (
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
          const rangeStart = calendarViewRange?.start;
          const rangeEnd = calendarViewRange?.end;
          const recurringDates = getRecurringDates(job, rangeStart, rangeEnd);
          recurringDates.forEach((date, index) => {
            const { start, end } = applyScheduledTimeToDay(date, job.scheduledTime ?? undefined, job.estimatedHours ?? undefined);
            result.push({
              id: job.id * 1000 + index,
              applicationId: app.id,
              proposedRate: app.proposedRate || undefined,
              title: job.title,
              startDate: start,
              endDate: end,
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
          const jobStart = new Date(job.startDate);
          const hasTimeRange = job.scheduledTime?.trim();
          const { start, end } = hasTimeRange
            ? applyScheduledTimeToDay(jobStart, job.scheduledTime ?? undefined, job.estimatedHours ?? undefined)
            : { start: jobStart, end: job.endDate ? new Date(job.endDate) : new Date(jobStart.getTime() + (job.estimatedHours ?? 4) * 60 * 60 * 1000) };
          result.push({
            id: job.id,
            applicationId: app.id,
            proposedRate: app.proposedRate || undefined,
            title: job.title,
            startDate: start,
            endDate: end,
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
          const jobStart = new Date(job.startDate);
          const hasTimeRange = job.scheduledTime?.trim();
          const { start, end } = hasTimeRange
            ? applyScheduledTimeToDay(jobStart, job.scheduledTime ?? undefined, job.estimatedHours ?? undefined)
            : { start: jobStart, end: job.endDate ? new Date(job.endDate) : new Date(jobStart.getTime() + (job.estimatedHours ?? 4) * 60 * 60 * 1000) };
          result.push({
            id: job.id,
            title: job.title,
            startDate: start,
            endDate: end,
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
  }, [filteredApplications, availableJobs, showOpportunities, isEmployee, showAvailableJobs, applications, calendarViewRange]);

  // One-shot deep link: open the same accepted-event details popup used by calendar clicks.
  useEffect(() => {
    if (!calendarDeepLinkJobId) return;
    const targetEvent = events.find((event) => event.type === "accepted" && event.job.id === calendarDeepLinkJobId);
    if (!targetEvent) return;
    setCurrentMediaIndex(0);
    setMediaLoaded(false);
    setSelectedAcceptedEvent(targetEvent);
    onCalendarDeepLinkHandled?.();
  }, [calendarDeepLinkJobId, events, onCalendarDeepLinkHandled]);

  const mapDateKey = format(currentDate, "yyyy-MM-dd");
  const { data: historicalTeamMembers = [] } = useQuery<WorkerTeamMember[]>({
    queryKey: ["/api/worker-team", workerTeamId, "members", "historical", mapDateKey],
    enabled: !isEmployee && view === "map" && !!workerTeamId,
    queryFn: async () => {
      if (!workerTeamId) return [];
      const res = await fetch(`/api/worker-team/${workerTeamId}/members?date=${encodeURIComponent(mapDateKey)}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  // Transform data for CalendarMapView. For employees: single "self" teammate; for admin: all active team members.
  const mapTeammates = useMemo(() => {
    if (isEmployee) {
        // Employee: one teammate = self (profile). Use first application's teamMemberId so assignments group correctly.
        const firstApp = applications.find(a => a.status === "accepted" && a.teamMemberId != null);
        const selfId = firstApp?.teamMemberId ?? profile?.id ?? 0;
        const lat = profile?.latitude ? parseFloat(profile.latitude) : null;
        const lng = profile?.longitude ? parseFloat(profile.longitude) : null;
        return [{
          id: selfId,
          firstName: profile?.firstName ?? "",
          lastName: profile?.lastName ?? "",
          avatarUrl: profile?.avatarUrl ?? null,
          workLocationAddress: profile?.address ?? null,
          workLocationLat: lat,
          workLocationLng: lng,
          liveLocationLat: lat,
          liveLocationLng: lng,
          liveLocationTimestamp: new Date(),
        }];
    }
    const mapLocationMembers = historicalTeamMembers.length > 0 ? historicalTeamMembers : activeTeamMembers;
    return mapLocationMembers.map(member => {
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
      const liveLocationPath = Array.isArray(memberAny.liveLocationPath)
        ? memberAny.liveLocationPath
            .map((pt: any) => ({
              lat: Number(pt?.lat),
              lng: Number(pt?.lng),
              createdAt: pt?.createdAt ?? null,
            }))
            .filter((pt: any) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng))
        : [];
      
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
        liveLocationPath,
      };
    });
  }, [activeTeamMembers, historicalTeamMembers, isEmployee, applications, profile]);

  const mapJobAssignments = useMemo(() => {
    // Filter by date - jobs on selected date (±1 day)
    const filterByDate = (app: (typeof filteredApplications)[0]) => {
      // Only require that the application has a job
      if (!app.job) {
        return false;
      }
      
      // Filter by date - check if job startDate matches currentDate (allow ±1 day for flexibility)
      const jobDate = app.job.startDate ? new Date(app.job.startDate) : null;
      if (!jobDate) {
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
        return false;
      }
      
      return true;
    };
    
    const jobsWithTeamMember = filteredApplications.filter(filterByDate);
    
    return jobsWithTeamMember.map(app => {
      const job = app.job!;
      const fullAddress = `${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`.replace(/^, |, $/g, "") || job.location || "Address not provided";
      const selfId = isEmployee
        ? applications.find((a) => a.status === "accepted" && a.teamMemberId != null)?.teamMemberId
        : undefined;
      return {
        jobId: job.id,
        jobTitle: job.title,
        address: fullAddress,
        latitude: job.latitude,
        longitude: job.longitude,
        scheduledStart: job.startDate,
        scheduledEnd: job.endDate || job.startDate,
        status: app.status ?? "pending",
        teamMemberId: app.teamMemberId ?? selfId ?? (profile?.id ?? 0),
      };
    });
  }, [filteredApplications, isEmployee, currentDate, applications, profile?.id]);
  const mapEnabledTeammates = useMemo(
    () => (isEmployee ? new Set(mapTeammates.map((t) => t.id)) : enabledTeammates),
    [isEmployee, mapTeammates, enabledTeammates]
  );

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

  // Convert API imported events to CalendarEvent[] (only for day/week/month; not shown on map)
  const importedCalendarEvents = useMemo((): CalendarEvent[] => {
    return importedEvents.reduce<CalendarEvent[]>((acc, ev, idx) => {
      if (!ev?.start || !ev?.end) return acc;
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return acc;
      const eventId = -10000 - idx;
      const scheduledTime =
        format(start, "h:mm a") + (end.getTime() !== start.getTime() ? ` - ${format(end, "h:mm a")}` : "");
      const syntheticJob = { id: eventId, title: ev.title || "Event", startDate: start, companyId: null } as unknown as Job;
      acc.push({
        id: eventId,
        title: ev.title || "Event",
        startDate: start,
        endDate: end,
        scheduledTime,
        type: "imported",
        job: syntheticJob,
        sourceName: ev.sourceName,
        sourceProfileId: ev.sourceProfileId,
      });
      return acc;
    }, []);
  }, [importedEvents]);

  // Day/week/month: merge job events with imported calendar events for the given date. Map view shows only jobs.
  const getEventsForDate = useCallback((date: Date) => {
    const jobEvents = events.filter(event => isSameDay(event.startDate, date));
    if (view === "map") return jobEvents;
    const dayStart = startOfDay(date);
    const dayEnd = addDays(dayStart, 1);
    const importedForDay = importedCalendarEvents.filter(ev => {
      const evEnd = ev.endDate ? ev.endDate.getTime() : ev.startDate.getTime();
      return ev.startDate.getTime() < dayEnd.getTime() && evEnd > dayStart.getTime();
    });
    return [...jobEvents, ...importedForDay];
  }, [events, view, importedCalendarEvents]);

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

  const renderEventBlock = (event: CalendarEvent, compact = false, fillHeight = false) => {
    const isImported = event.type === "imported";
    const isOpportunity = event.type === "opportunity";
    const isAccepted = event.type === "accepted";
    const hasNoTime = !event.scheduledTime;
    
    // Imported (iCal) events: light gray, read-only, no job dialog
    if (isImported) {
      return (
        <div
          key={event.id}
          className="relative z-10 rounded px-1.5 py-0.5 text-xs cursor-default overflow-hidden bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400 border border-gray-300 dark:border-gray-600"
          title={event.sourceName ? `${event.title} (${event.sourceName})` : event.title}
          onClick={(e) => e.stopPropagation()}
          data-testid={`calendar-event-${event.id}`}
        >
          <div className="font-medium truncate text-[11px]">{event.title}</div>
          {!compact && event.sourceName && (
            <div className="text-[10px] opacity-80 truncate">{event.sourceName}</div>
          )}
          {!compact && event.scheduledTime && (
            <div className="text-[10px] opacity-70">{formatEventTimeTo12h(event.scheduledTime)}</div>
          )}
        </div>
      );
    }
    
    // Determine which avatar to show (workers on the job, like job details popup):
    // - Team member avatar when assigned, else profile (admin/self)
    const showAvatar = !isOpportunity && !compact;
    
    let avatarUrl: string | null | undefined;
    let avatarInitials: string;
    let personName: string;
    
    if (event.teamMember) {
      avatarUrl = event.teamMember.avatarUrl;
      avatarInitials = `${event.teamMember.firstName?.[0] || ''}${event.teamMember.lastName?.[0] || ''}`.trim() || "?";
      personName = `${event.teamMember.firstName || ''} ${event.teamMember.lastName || ''}`.trim() || 'Worker';
    } else {
      avatarUrl = profile?.avatarUrl;
      avatarInitials = `${profile?.firstName?.[0] || ''}${profile?.lastName?.[0] || ''}`.trim() || "?";
      personName = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || '(Me)';
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
        className={`${baseClasses} ${typeClasses}${fillHeight ? " h-full flex flex-col min-h-0" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpportunity) {
            setSelectedOpportunityJob(event.job);
          } else if (isAccepted) {
            setCurrentMediaIndex(0);
            setMediaLoaded(false);
            setSelectedAcceptedEvent(event);
          } else if (event.type === "pending") {
            const app = event.applicationId != null ? {
              id: event.applicationId,
              status: "pending" as const,
              proposedRate: event.proposedRate ?? null,
              teamMember: event.teamMember ? {
                id: event.teamMember.id,
                firstName: event.teamMember.firstName ?? null,
                lastName: event.teamMember.lastName ?? null,
                avatarUrl: event.teamMember.avatarUrl ?? null,
                hourlyRate: (event.teamMember as { hourlyRate?: number | null }).hourlyRate ?? null,
              } : null,
            } : undefined;
            onViewJob(event.job, app ?? undefined);
          } else {
            setSelectedEvent(event);
          }
        }}
        data-testid={`calendar-event-${event.id}`}
      >
        <div className="flex items-center gap-1">
          {showAvatar && (
            <Avatar className="h-4 w-4 min-w-4 flex-shrink-0 overflow-hidden rounded-full border border-white/50 ring-0">
              <AvatarImage
                src={(() => {
                  const raw = avatarUrl ?? undefined;
                  if (!raw) return undefined;
                  const normalized = normalizeAvatarUrl(raw);
                  if (!normalized) return undefined;
                  if (normalized.startsWith("http") || normalized.startsWith("data:")) return normalized;
                  return typeof window !== "undefined" ? `${window.location.origin}${normalized.startsWith("/") ? normalized : `/${normalized}`}` : normalized;
                })()}
                className="aspect-square h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
              <AvatarFallback className="flex h-full w-full items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                {avatarInitials || "?"}
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
          <div className="text-[10px] opacity-80">{formatEventTimeTo12h(event.scheduledTime)}</div>
        )}
        {!compact && hasNoTime && isOpportunity && (
          <div className="text-[10px] opacity-70 italic">Flexible</div>
        )}
      </div>
    );
  };

  const renderMiniCalendar = () => (
    <div
      className={cn(
        "hidden lg:block w-56 flex-shrink-0 border-r bg-background p-3",
        /* Sticky in the dashboard scroll area; self-start avoids stretching to main column height */
        "sticky top-0 z-20 self-start min-h-0 max-h-[100dvh] overflow-y-auto overflow-x-hidden overscroll-y-contain"
      )}
    >
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
        {/* Person Filter for Admins - hide on Routes view (routes are per-person, use "Show route for" below) */}
        {!isEmployee && activeTeamMembers.length > 0 && view !== "map" && (
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

        {/* Routes view only: show one person's route at a time (per-person); selection remembered */}
        {!isEmployee && view === "map" && activeTeamMembers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Show route for</p>
            <div className="space-y-1.5">
              {activeTeamMembers.map((member) => {
                const isSelected = enabledTeammates.size === 1 && enabledTeammates.has(member.id);
                return (
                  <button
                    key={member.id}
                    onClick={() => setEnabledTeammates(new Set([member.id]))}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                      isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                  >
                    <Avatar className="w-5 h-5">
                      <AvatarImage src={member.avatarUrl || undefined} />
                      <AvatarFallback className="text-[8px]">
                        {member.firstName?.[0]}{member.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{member.firstName} {member.lastName}</span>
                  </button>
                );
              })}
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
      {/* Single scroll container so header and body share width and columns align */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col min-h-min">
          <div className="flex border-b sticky top-0 bg-background z-10 shrink-0">
            <div className="w-16 flex-shrink-0 border-r py-2 text-center text-[10px] text-muted-foreground">
              Time
            </div>
            <div className="flex-1 min-w-0 py-2 text-center">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{format(currentDate, "EEE")}</div>
              <div className={`text-2xl font-medium mt-0.5 ${isToday(currentDate) ? "bg-primary text-primary-foreground rounded-full w-10 h-10 flex items-center justify-center mx-auto" : ""}`}>
                {format(currentDate, "d")}
              </div>
            </div>
          </div>
          <div className="flex shrink-0">
            <div className="w-16 flex-shrink-0 border-r">
              {HOURS.map(hour => (
                <div 
                  key={hour} 
                  className="border-b border-border/50 text-[10px] text-muted-foreground flex items-center justify-center"
                  style={{ height: `${HOUR_HEIGHT}px` }}
                >
                  {formatHour(hour)}
                </div>
              ))}
            </div>
            <div className="flex-1 min-w-0 overflow-x-auto border-l">
              {(() => {
                const dayEvents = getEventsForDate(currentDate);
                const layout = getDayViewEventLayout(dayEvents);
                const totalColumns = layout.length > 0 ? layout[0].totalColumns : 1;
                const minColWidth = 260;
                const contentMinWidth = totalColumns > 1 ? totalColumns * minColWidth : undefined;
                return (
                  <div
                    className="relative min-h-full w-full"
                    style={contentMinWidth != null ? { minWidth: contentMinWidth } : undefined}
                  >
                    {HOURS.map(hour => (
                      <div key={hour} className="border-b border-border/50" style={{ height: `${HOUR_HEIGHT}px` }} />
                    ))}
                    {layout.map(({ event, top, height, columnIndex, totalColumns: cols }) => {
                      const h = Math.max(24, height);
                      if (!Number.isFinite(top) || !Number.isFinite(h) || cols < 1) return null;
                      return (
                        <div
                          key={event.id}
                          className="absolute z-10 mx-0.5 box-border overflow-hidden flex flex-col min-h-0"
                          style={{
                            top: `${top}px`,
                            height: `${h}px`,
                            left: `${(columnIndex / cols) * 100}%`,
                            width: `calc(${100 / cols}% - 4px)`,
                            ...(cols > 1 ? { minWidth: `${minColWidth - 4}px` } : {}),
                          }}
                        >
                          <div className="h-full min-h-0 flex flex-col">
                            {renderEventBlock(event, false, true)}
                          </div>
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
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderWeekView = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Single scroll container; overflow-x when day columns expand for overlapping events */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
        <div className="flex flex-col min-h-min min-w-0">
          <div className="flex border-b sticky top-0 bg-background z-10 shrink-0">
            <div className="w-16 flex-shrink-0 border-r py-2 text-center text-[10px] text-muted-foreground">
              Time
            </div>
            {weekDays.map(day => {
              const dayLayout = getDayViewEventLayout(getEventsForDate(day));
              const dayCols = dayLayout.length > 0 ? dayLayout[0].totalColumns : 1;
              const WEEK_COL_BASE_MIN = 140;
              const WEEK_COL_LANE = 120;
              const headerMinWidth = Math.max(WEEK_COL_BASE_MIN, dayCols * WEEK_COL_LANE);
              return (
                <div
                  key={day.toISOString()}
                  className="flex-none py-2 text-center border border-border first:border-l-0 shrink-0"
                  style={{ minWidth: headerMinWidth }}
                >
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
              );
            })}
          </div>
          <div className="flex shrink-0">
            <div className="w-16 flex-shrink-0 border-r">
              {HOURS.map(hour => (
                <div 
                  key={hour} 
                  className="border-b border-border/50 text-[10px] text-muted-foreground flex items-center justify-center"
                  style={{ height: `${HOUR_HEIGHT}px` }}
                >
                  {formatHour(hour)}
                </div>
              ))}
            </div>
            {weekDays.map(day => {
              const dayEvents = getEventsForDate(day);
              const layout = getDayViewEventLayout(dayEvents);
              const totalColumns = layout.length > 0 ? layout[0].totalColumns : 1;
              const WEEK_COL_BASE_MIN = 140;
              const WEEK_COL_LANE = 120;
              const dayMinWidth = Math.max(WEEK_COL_BASE_MIN, totalColumns * WEEK_COL_LANE);
              return (
                <div
                  key={day.toISOString()}
                  className="flex-none relative border border-border first:border-l-0 shrink-0"
                  style={{ minWidth: dayMinWidth }}
                >
                  {HOURS.map(hour => (
                    <div key={hour} className="border-b border-border/50" style={{ height: `${HOUR_HEIGHT}px` }} />
                  ))}
                  {layout.map(({ event, top, height, columnIndex, totalColumns: cols }) => {
                    const h = Math.max(20, height);
                    if (!Number.isFinite(top) || !Number.isFinite(h) || cols < 1) return null;
                    return (
                      <div
                        key={event.id}
                        className="absolute z-10 flex flex-col min-h-0 mx-0.5"
                        style={{
                          top: `${top}px`,
                          height: `${h}px`,
                          left: `${(columnIndex / cols) * 100}%`,
                          width: `calc(${100 / cols}% - 4px)`,
                        }}
                      >
                        <div className="h-full min-h-0 flex flex-col">
                          {renderEventBlock(event, false, true)}
                        </div>
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
              );
            })}
          </div>
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
    <div className="flex h-full min-h-0 w-full bg-background">
      {renderMiniCalendar()}
      
      <div className="flex-1 flex flex-col min-w-0">
        {!(isMobile && calendarHeaderSlotRef && calendarHeaderSlotReady && calendarHeaderSlotRef.current) && (
        <div className="flex items-center justify-between gap-2 px-2 py-2 border-b flex-wrap">
          {/* Mobile Header — View label left, nav (chevrons + Today) center, Settings right; or portal into dashboard header */}
          {isMobile ? (
            <div className="flex items-center justify-between gap-2 w-full">
              {/* Left: View type (employee = button; !isEmployee = label only, actions are in filter row below) */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {isEmployee ? (
                  <button
                    onClick={() => setShowViewSelector(true)}
                    className="flex items-center gap-2 text-base font-medium whitespace-nowrap min-w-0"
                  >
                    {view === "day" && <CalendarIcon className="w-4 h-4 flex-shrink-0" />}
                    {view === "week" && <CalendarDays className="w-4 h-4 flex-shrink-0" />}
                    {view === "month" && <Calendar className="w-4 h-4 flex-shrink-0" />}
                    {view === "map" && <MapIcon className="w-4 h-4 flex-shrink-0" />}
                    <span className="truncate">
                      {view === "day" ? "Today" : view === "week" ? "Week" : view === "month" ? "Month" : "Routes"}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowViewSelector(true)}
                    className="flex items-center gap-2 text-base font-medium whitespace-nowrap min-w-0 text-foreground hover:opacity-80 active:opacity-70 transition-opacity"
                    data-testid="calendar-view-type-button-mobile"
                    aria-label="Calendar view"
                  >
                    {view === "day" && <CalendarIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                    {view === "week" && <CalendarDays className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                    {view === "month" && <Calendar className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                    {view === "map" && <MapIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                    <span className="truncate">
                      {view === "day" ? "Today" : view === "week" ? "Week" : view === "month" ? "Month" : "Routes"}
                    </span>
                  </button>
                )}
              </div>
              {/* Center: Chevrons with "Today" between */}
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
              {/* Right: Settings (only when employee; when !isEmployee it's in the filter row below) */}
              {isEmployee && (
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
              )}
            </div>
          ) : (
            <>
              {/* Desktop Header */}
              <div className="flex items-center gap-1">
                {/* Tablet: workers filter at left of toolbar (not on map; map has it in bottom bar) */}
                {!isEmployee && !isDesktop && view !== "map" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 pl-1.5 pr-3 text-xs whitespace-nowrap flex-shrink-0 rounded-lg border bg-muted/50 border-border hover:bg-muted inline-flex items-center gap-2"
                    onClick={() => setShowWorkerFilterSheet(true)}
                    data-testid="calendar-workers-filter-button"
                  >
                    {(() => {
                      const selectedCount = (showBusinessOperator ? 1 : 0) + activeTeamMembers.filter(m => enabledTeammates.has(m.id)).length;
                      const allSelected = showBusinessOperator && activeTeamMembers.length > 0 && activeTeamMembers.every(m => enabledTeammates.has(m.id));
                      const avatarPeople: { id: number; avatarUrl: string | null; firstName: string | null; lastName: string | null }[] = [];
                      if (showBusinessOperator && profile) {
                        avatarPeople.push({
                          id: profile.id,
                          avatarUrl: profile.avatarUrl ?? null,
                          firstName: profile.firstName ?? null,
                          lastName: profile.lastName ?? null,
                        });
                      }
                      activeTeamMembers.filter(m => enabledTeammates.has(m.id)).forEach(m => {
                        avatarPeople.push({
                          id: m.id,
                          avatarUrl: m.avatarUrl ?? null,
                          firstName: m.firstName ?? null,
                          lastName: m.lastName ?? null,
                        });
                      });
                      const maxStack = 4;
                      const showCount = avatarPeople.length;
                      if (showCount === 0) {
                        return (
                          <>
                            <Users className="w-4 h-4 flex-shrink-0" />
                            <span>Workers</span>
                          </>
                        );
                      }
                      return (
                        <>
                          <span className="flex -space-x-2 flex-shrink-0">
                            {avatarPeople.slice(0, maxStack).map((p) => (
                              <Avatar key={p.id} className="h-6 w-6 border-2 border-background rounded-full ring-0">
                                <AvatarImage src={p.avatarUrl || undefined} className="object-cover" />
                                <AvatarFallback className="text-[10px] bg-muted">
                                  {p.firstName?.[0]}{p.lastName?.[0]}
                                </AvatarFallback>
                              </Avatar>
                            ))}
                          </span>
                          <span>
                            {allSelected ? "All Workers" : showCount > maxStack ? `${maxStack}+ selected` : selectedCount === 1 ? "1 selected" : `${selectedCount} selected`}
                          </span>
                        </>
                      );
                    })()}
                  </Button>
                )}
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
                  <Button
                    variant={view === "map" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={() => setView("map")}
                  >
                    <MapIcon className="w-3.5 h-3.5 mr-1" />
                    Map
                  </Button>
                </div>
                {/* Tablet/mobile (no sidebar): show gear-only settings button like desktop sidebar */}
                {!isDesktop && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={() => setShowSettings(true)}
                    data-testid="calendar-settings-btn"
                    aria-label="Calendar settings"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
        )}

        {/* Portal mobile toolbar into dashboard header (view + date nav + settings). Sticky worker row below omits duplicate controls when this is active. */}
        {isMobile && calendarHeaderSlotRef?.current && calendarHeaderSlotReady && createPortal(
          <div className="flex items-center justify-between gap-2 w-full min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isEmployee ? (
                <button
                  onClick={() => setShowViewSelector(true)}
                  className="flex items-center gap-2 text-base font-medium whitespace-nowrap min-w-0"
                >
                  {view === "day" && <CalendarIcon className="w-4 h-4 flex-shrink-0" />}
                  {view === "week" && <CalendarDays className="w-4 h-4 flex-shrink-0" />}
                  {view === "month" && <Calendar className="w-4 h-4 flex-shrink-0" />}
                  {view === "map" && <MapIcon className="w-4 h-4 flex-shrink-0" />}
                  <span className="truncate">
                    {view === "day" ? "Today" : view === "week" ? "Week" : view === "month" ? "Month" : "Routes"}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowViewSelector(true)}
                  className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg text-sm font-medium bg-muted/50 border border-border hover:bg-muted transition-colors min-w-0"
                  data-testid="calendar-view-type-button-mobile"
                  aria-label="Calendar view"
                >
                  {view === "day" && <CalendarIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                  {view === "week" && <CalendarDays className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                  {view === "month" && <Calendar className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                  {view === "map" && <MapIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                  <span className="truncate max-w-[4rem]">
                    {view === "day" ? "Today" : view === "week" ? "Week" : view === "month" ? "Month" : "Routes"}
                  </span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateDate("prev")} data-testid="calendar-prev-btn">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 font-medium min-w-[4rem]" onClick={goToToday} data-testid="calendar-today-btn">
                Today
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateDate("next")} data-testid="calendar-next-btn">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              onClick={() => { setShowSettingsMenu(true); setSettingsSubMenu("main"); }}
              data-testid="calendar-settings-button-mobile"
              aria-label="Calendar settings"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>,
          calendarHeaderSlotRef.current
        )}

        {/* Mobile & Tablet: Worker filter row. View + nav + settings live in dashboard header when portaled (mobileCalendarToolbarPortaled). */}
        {!isEmployee && !isDesktop && view !== "map" && (
          <div className="lg:hidden sticky top-0 z-20 bg-background border-b">
            <div className="flex items-center gap-2 px-3 py-2">
                <Button
                    variant="outline"
                    size="sm"
                    className={`h-8 pl-1.5 pr-3 text-xs whitespace-nowrap rounded-lg border bg-muted/50 border-border hover:bg-muted inline-flex items-center gap-2 ${mobileCalendarToolbarPortaled ? "flex-1 min-w-0 justify-start" : "flex-shrink-0"}`}
                    onClick={() => setShowWorkerFilterSheet(true)}
                    data-testid="calendar-workers-filter-button"
                  >
                    {(() => {
                      const selectedCount = (showBusinessOperator ? 1 : 0) + activeTeamMembers.filter(m => enabledTeammates.has(m.id)).length;
                      const allSelected = showBusinessOperator && activeTeamMembers.length > 0 && activeTeamMembers.every(m => enabledTeammates.has(m.id));
                      const avatarPeople: { id: number; avatarUrl: string | null; firstName: string | null; lastName: string | null }[] = [];
                      if (showBusinessOperator && profile) {
                        avatarPeople.push({
                          id: profile.id,
                          avatarUrl: profile.avatarUrl ?? null,
                          firstName: profile.firstName ?? null,
                          lastName: profile.lastName ?? null,
                        });
                      }
                      activeTeamMembers.filter(m => enabledTeammates.has(m.id)).forEach(m => {
                        avatarPeople.push({
                          id: m.id,
                          avatarUrl: m.avatarUrl ?? null,
                          firstName: m.firstName ?? null,
                          lastName: m.lastName ?? null,
                        });
                      });
                      const maxStack = 4;
                      const showCount = avatarPeople.length;
                      if (showCount === 0) {
                        return (
                          <>
                            <Users className="w-4 h-4 flex-shrink-0" />
                            <span>Workers</span>
                          </>
                        );
                      }
                      return (
                        <>
                          <span className="flex -space-x-2 flex-shrink-0">
                            {avatarPeople.slice(0, maxStack).map((p) => (
                              <Avatar key={p.id} className="h-6 w-6 border-2 border-background rounded-full ring-0">
                                <AvatarImage src={p.avatarUrl || undefined} className="object-cover" />
                                <AvatarFallback className="text-[10px] bg-muted">
                                  {p.firstName?.[0]}{p.lastName?.[0]}
                                </AvatarFallback>
                              </Avatar>
                            ))}
                          </span>
                          <span>
                            {allSelected ? "All Workers" : showCount > maxStack ? `${maxStack}+ selected` : selectedCount === 1 ? "1 selected" : `${selectedCount} selected`}
                          </span>
                        </>
                      );
                    })()}
                  </Button>
                {!mobileCalendarToolbarPortaled && (
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
                  <button
                    type="button"
                    onClick={() => setShowViewSelector(true)}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg text-sm font-medium bg-muted/50 border border-border hover:bg-muted transition-colors min-w-0"
                    data-testid="calendar-view-type-button-mobile"
                    aria-label="Calendar view"
                  >
                    {view === "day" && <CalendarIcon className="w-4 h-4 flex-shrink-0" />}
                    {view === "week" && <CalendarDays className="w-4 h-4 flex-shrink-0" />}
                    {view === "month" && <Calendar className="w-4 h-4 flex-shrink-0" />}
                    <span className="truncate max-w-[4rem]">
                      {view === "day" ? "Today" : view === "week" ? "Week" : "Month"}
                    </span>
                  </button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0 rounded-lg bg-muted/50 border border-border hover:bg-muted"
                    onClick={() => { setShowSettingsMenu(true); setSettingsSubMenu("main"); }}
                    data-testid="calendar-settings-button-mobile"
                    aria-label="Calendar settings"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                </div>
                )}
            </div>
          </div>
        )}

        {/* Mobile & Tablet Worker Filter - Bottom sheet (business operator + teammates) */}
        {!isEmployee && !isDesktop && (
          <Drawer open={showWorkerFilterSheet} onOpenChange={setShowWorkerFilterSheet}>
            <DrawerContent className="rounded-t-2xl">
              <DrawerHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2 pt-0 text-left">
                <DrawerTitle className="text-base font-semibold">Filter by worker</DrawerTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-full"
                  onClick={() => setShowWorkerFilterSheet(false)}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DrawerHeader>
              <DrawerDescription className="sr-only">Select which workers to show on the calendar</DrawerDescription>
              <div className="px-4 pb-6">
                <div className="space-y-1">
                  <label className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <span className="text-sm font-medium">All Workers</span>
                    <Switch
                      checked={
                        showBusinessOperator &&
                        activeTeamMembers.length > 0 &&
                        activeTeamMembers.every((m) => enabledTeammates.has(m.id))
                      }
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setShowBusinessOperator(true);
                          setEnabledTeammates(new Set(activeTeamMembers.map((m) => m.id)));
                        } else {
                          setShowBusinessOperator(false);
                          setEnabledTeammates(new Set());
                        }
                      }}
                      data-testid="worker-filter-all"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <span className="flex items-center gap-2 text-sm min-w-0">
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarImage src={profile?.avatarUrl || undefined} />
                        <AvatarFallback className="text-xs">
                          {profile?.firstName?.[0]}
                          {profile?.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium truncate">
                        {profile?.firstName || profile?.lastName
                          ? `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim()
                          : "Me"}
                      </span>
                      {(() => {
                        const myJobCount = applications.filter((app) => !app.teamMemberId && app.status === "accepted").length;
                        return myJobCount > 0 ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                            {myJobCount}
                          </Badge>
                        ) : null;
                      })()}
                    </span>
                    <Switch
                      checked={showBusinessOperator}
                      onCheckedChange={setShowBusinessOperator}
                      data-testid="worker-filter-me"
                    />
                  </label>
                  {activeTeamMembers.map((member) => {
                    const isEnabled = enabledTeammates.has(member.id);
                    const jobCount = applications.filter(
                      (app) => app.teamMemberId === member.id && app.status === "accepted"
                    ).length;
                    return (
                      <label
                        key={member.id}
                        className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2 text-sm min-w-0">
                          <Avatar className="w-8 h-8 flex-shrink-0">
                            <AvatarImage src={member.avatarUrl || undefined} />
                            <AvatarFallback className="text-xs">
                              {member.firstName?.[0]}
                              {member.lastName?.[0]}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium truncate">{member.firstName} {member.lastName}</span>
                          {jobCount > 0 && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                              {jobCount}
                            </Badge>
                          )}
                        </span>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={() => handleToggleTeammate(member.id)}
                          data-testid={`worker-filter-teammate-${member.id}`}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </DrawerContent>
          </Drawer>
        )}

        {/* Mobile job-type toggles - evenly split width, hide on map view */}
        {!isEmployee && view !== "map" && (
          <div className="lg:hidden flex items-stretch gap-1 px-2 py-2 border-b bg-muted/30">
            <button
              type="button"
              onClick={() => setShowAcceptedJobs((v) => !v)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors min-w-0 ${
                showAcceptedJobs
                  ? "bg-green-500 text-white"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted border border-border"
              }`}
              data-testid="mobile-toggle-accepted"
            >
              <div className={`w-2 h-2 rounded shrink-0 ${showAcceptedJobs ? "bg-white/90" : "bg-green-500"}`} />
              <span className="truncate">Accepted</span>
            </button>
            <button
              type="button"
              onClick={() => setShowPendingJobs((v) => !v)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors min-w-0 ${
                showPendingJobs
                  ? "bg-amber-500 text-white"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted border border-border"
              }`}
              data-testid="mobile-toggle-pending"
            >
              <div className={`w-2 h-2 rounded shrink-0 ${showPendingJobs ? "bg-white/90" : "bg-amber-500"}`} />
              <span className="truncate">Pending</span>
            </button>
            <button
              type="button"
              onClick={() => setShowAvailableJobs((v) => !v)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors min-w-0 ${
                showAvailableJobs
                  ? "bg-blue-500 text-white"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted border border-border"
              }`}
              data-testid="mobile-toggle-available"
            >
              <div className={`w-2 h-2 rounded shrink-0 border-2 ${showAvailableJobs ? "bg-white/90 border-white/90" : "border-blue-400 bg-blue-50 dark:bg-blue-950 dark:border-blue-400"}`} />
              <span className="truncate">Available</span>
            </button>
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {view === "day" && renderDayView()}
          {view === "week" && renderWeekView()}
          {view === "month" && renderMonthView()}
          {view === "map" && (
            <CalendarMapView
              isEmployee={isEmployee}
              selectedDate={currentDate}
              onDateChange={handleDateChange}
              teammates={mapTeammates}
              jobAssignments={mapJobAssignments}
              availableJobs={isEmployee ? [] : availableJobs}
              enabledTeammates={mapEnabledTeammates}
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
                avatarUrl: profile.avatarUrl,
              } : null}
              toolbarRightContent={!isEmployee && !isDesktop ? (() => {
                const allPeople: { id: number; avatarUrl: string | null; firstName: string | null; lastName: string | null; isOwner: boolean }[] = [];
                if (profile) {
                  allPeople.push({
                    id: profile.id,
                    avatarUrl: profile.avatarUrl ?? null,
                    firstName: profile.firstName ?? null,
                    lastName: profile.lastName ?? null,
                    isOwner: true,
                  });
                }
                activeTeamMembers.forEach(m => {
                  allPeople.push({
                    id: m.id,
                    avatarUrl: m.avatarUrl ?? null,
                    firstName: m.firstName ?? null,
                    lastName: m.lastName ?? null,
                    isOwner: false,
                  });
                });
                const currentIndex = allPeople.findIndex(p =>
                  (p.isOwner && showBusinessOperator) || (!p.isOwner && enabledTeammates.has(p.id))
                );
                const currentPerson = currentIndex >= 0 ? allPeople[currentIndex] : allPeople[0];
                const canGoPrev = allPeople.length > 1 && currentIndex > 0;
                const canGoNext = allPeople.length > 1 && currentIndex < allPeople.length - 1;
                const handlePrev = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (currentIndex > 0) {
                    const prev = allPeople[currentIndex - 1];
                    if (prev.isOwner) {
                      setShowBusinessOperator(true);
                      setEnabledTeammates(new Set());
                    } else {
                      setShowBusinessOperator(false);
                      setEnabledTeammates(new Set([prev.id]));
                    }
                    setFocusedTeammateId(prev.id);
                    setTimeout(() => setFocusedTeammateId(null), 500);
                  }
                };
                const handleNext = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (currentIndex < allPeople.length - 1) {
                    const next = allPeople[currentIndex + 1];
                    if (next.isOwner) {
                      setShowBusinessOperator(true);
                      setEnabledTeammates(new Set());
                    } else {
                      setShowBusinessOperator(false);
                      setEnabledTeammates(new Set([next.id]));
                    }
                    setFocusedTeammateId(next.id);
                    setTimeout(() => setFocusedTeammateId(null), 500);
                  }
                };
                if (!currentPerson) {
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 pl-1.5 pr-3 text-xs whitespace-nowrap flex-shrink-0 rounded-lg border bg-muted/50 border-border hover:bg-muted inline-flex items-center gap-2"
                      onClick={() => setShowWorkerFilterSheet(true)}
                      data-testid="calendar-workers-filter-button"
                    >
                      <Users className="w-4 h-4 flex-shrink-0" />
                      <span>Workers</span>
                    </Button>
                  );
                }
                return (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      disabled={!canGoPrev}
                      onClick={handlePrev}
                      aria-label="Previous worker"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 pl-1.5 pr-3 text-xs whitespace-nowrap flex-shrink-0 rounded-lg border bg-muted/50 border-border hover:bg-muted inline-flex items-center gap-2"
                      onClick={() => setShowWorkerFilterSheet(true)}
                      data-testid="calendar-workers-filter-button"
                    >
                      <Avatar className="h-6 w-6 border-2 border-background rounded-full ring-0 flex-shrink-0">
                        <AvatarImage src={currentPerson.avatarUrl || undefined} className="object-cover" />
                        <AvatarFallback className="text-[10px] bg-muted">
                          {currentPerson.firstName?.[0]}{currentPerson.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate max-w-[6rem]">
                        {currentPerson.firstName} {currentPerson.lastName?.[0]}.
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      disabled={!canGoNext}
                      onClick={handleNext}
                      aria-label="Next worker"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })() : undefined}
              onJobAction={(jobId, action) => {
                const job = availableJobs.find(j => j.id === jobId);
                if (!job) return;
                
                switch (action) {
                  case "view":
                    onViewJob(job);
                    break;
                  case "add-to-route":
                    if (onApplyToJobAtStep3) onApplyToJobAtStep3(job);
                    else onViewJob(job);
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
              referencePoints={referencePoints}
              referenceRadiusMiles={referenceRadiusMiles}
              referenceRadiusMilesArray={referenceRadiusMilesArray}
              height={isDesktop ? "100%" : "min(70vh, 640px)"}
            />
          )}
        </div>
      </div>

      <JobDetailsSheet
        open={!!selectedEvent}
        onOpenChange={(open) => !open && setSelectedEvent(null)}
        job={selectedEvent?.job || null}
        status={
          selectedEvent?.type === "accepted" || selectedEvent?.type === "pending"
            ? selectedEvent.type
            : "opportunity"
        }
        applicationId={selectedEvent?.applicationId}
        proposedRate={selectedEvent?.proposedRate}
        profile={profile}
        teamMember={
          selectedEvent?.teamMember
            ? {
                id: selectedEvent.teamMember.id,
                firstName: selectedEvent.teamMember.firstName ?? "Worker",
                lastName: selectedEvent.teamMember.lastName ?? "",
                avatarUrl: selectedEvent.teamMember.avatarUrl ?? null,
                hourlyRate: selectedEvent.teamMember.hourlyRate ?? workerHourlyRate,
                phone: selectedEvent.teamMember.phone ?? null,
              }
            : null
        }
        company={
          selectedEvent?.company
            ? {
                id: selectedEvent.company.id,
                companyName: selectedEvent.company.companyName ?? null,
                phone: selectedEvent.company.phone ?? null,
              }
            : null
        }
        activeTeamMembers={activeTeamMembers.map((m) => ({
          id: m.id,
          firstName: m.firstName ?? "Worker",
          lastName: m.lastName ?? "",
          avatarUrl: m.avatarUrl ?? null,
          hourlyRate: m.hourlyRate ?? workerHourlyRate,
          phone: m.phone ?? null,
        }))}
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
          firstName: m.firstName ?? "Worker",
          lastName: m.lastName ?? "",
          avatarUrl: m.avatarUrl ?? null,
          hourlyRate: m.hourlyRate ?? null,
          status: m.status as "active" | "pending" | "inactive",
          latitude: (m as { latitude?: string | null }).latitude ?? null,
          longitude: (m as { longitude?: string | null }).longitude ?? null,
          skillsets: Array.isArray((m as { skillsets?: unknown }).skillsets)
            ? (m as { skillsets?: unknown[] }).skillsets
                ?.map((s) => String(s))
                .filter(Boolean)
            : [],
        }))}
        workerLocation={profile?.latitude != null && profile?.longitude != null ? (() => { const lat = parseFloat(String(profile.latitude)); const lng = parseFloat(String(profile.longitude)); return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined; })() : undefined}
        onOpenApply={(job) => {
          setSelectedOpportunityJob(null);
          onApplyToJob(job);
        }}
        onDismiss={(job) => {
          setSelectedOpportunityJob(null);
        }}
      />

      {/* Accepted Job Dialog - in-progress/accepted status (clock in/out, directions, chat, etc.) */}
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
        const mapUserLocation =
          profile?.latitude != null && profile?.longitude != null
            ? (() => {
                const lat = parseFloat(String(profile.latitude));
                const lng = parseFloat(String(profile.longitude));
                return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
              })()
            : null;

        const assignedPersonIds = new Set<number>(
          mapJobAssignments
            .filter((assignment) => assignment.jobId === job.id && typeof assignment.teamMemberId === "number")
            .map((assignment) => assignment.teamMemberId as number)
        );

        const fleetPersonLocations: PersonLocation[] = mapTeammates
          .filter((person) => assignedPersonIds.has(person.id))
          .map((person) => {
            const lat = person.liveLocationLat ?? person.workLocationLat;
            const lng = person.liveLocationLng ?? person.workLocationLng;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const fullName = `${person.firstName || ""} ${person.lastName || ""}`.trim() || "Worker";
            return {
              id: person.id,
              lat,
              lng,
              name: fullName,
              avatarUrl: person.avatarUrl || null,
              type: mapUserLocation && person.id === profile?.id ? "worker" : "teammate",
            } as PersonLocation;
          })
          .filter((person): person is PersonLocation => person !== null);

        if (fleetPersonLocations.length === 0 && mapUserLocation) {
          fleetPersonLocations.push({
            id: profile?.id || "self",
            lat: mapUserLocation.lat,
            lng: mapUserLocation.lng,
            name: `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() || "You",
            avatarUrl: profile?.avatarUrl || null,
            type: "worker",
          });
        }
        
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
                <h2 className="text-xl font-bold">{getDisplayJobTitle(job)}</h2>
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
                <div className="rounded-xl border p-[5px]">
                  <JobLocationMap
                    job={{
                      id: job.id,
                      lat: parseFloat(job.latitude!),
                      lng: parseFloat(job.longitude!),
                      title: getDisplayJobTitle(job),
                    }}
                    userLocation={mapUserLocation}
                    personLocations={fleetPersonLocations}
                    className="w-full h-40 rounded-lg overflow-hidden"
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
                  <SheetTitle>{getDisplayJobTitle(job)}</SheetTitle>
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
                <DialogTitle>{getDisplayJobTitle(job)}</DialogTitle>
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
                className={`p-3 rounded-lg border transition-colors ${event.type === "imported" ? "cursor-default bg-gray-50 dark:bg-gray-900/50" : "cursor-pointer hover:bg-muted/50"}`}
                onClick={() => {
                  setSelectedDayEvents(null);
                  if (event.type === "imported") return;
                  if (event.type === "opportunity") {
                    setSelectedOpportunityJob(event.job);
                  } else if (event.type === "accepted") {
                    setCurrentMediaIndex(0);
                    setMediaLoaded(false);
                    setSelectedAcceptedEvent(event);
                  } else if (event.type === "pending") {
                    const app = event.applicationId != null ? {
                      id: event.applicationId,
                      status: "pending" as const,
                      proposedRate: event.proposedRate ?? null,
                      teamMember: event.teamMember ? {
                        id: event.teamMember.id,
                        firstName: event.teamMember.firstName ?? null,
                        lastName: event.teamMember.lastName ?? null,
                        avatarUrl: event.teamMember.avatarUrl ?? null,
                        hourlyRate: (event.teamMember as { hourlyRate?: number | null }).hourlyRate ?? null,
                      } : null,
                    } : undefined;
                    onViewJob(event.job, app ?? undefined);
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
                    event.type === "imported" ? "bg-gray-400 dark:bg-gray-500" :
                    "border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-950"
                  }`} />
                  <span className="font-medium">{event.title}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {event.scheduledTime ? (
                    <span>{formatEventTimeTo12h(event.scheduledTime)}</span>
                  ) : (
                    <span className="italic">{event.type === "imported" ? "" : "Flexible Time"}</span>
                  )}
                  {event.type !== "imported" && event.estimatedHours && (
                    <span>{event.estimatedHours} hours</span>
                  )}
                  {event.type === "imported" && event.sourceName && (
                    <span>{event.sourceName}</span>
                  )}
                  {event.type !== "imported" && (
                    <span className="text-green-600 dark:text-green-400 font-medium">
                      {calculatePayout(event)}
                    </span>
                  )}
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
                    
                    {/* Export Calendar — admins / business operators only; employees cannot export */}
                    {!isEmployee && (
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
                    )}
                    
                    {/* Import Calendar — per worker; all workers can import their own */}
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
                ) : settingsSubMenu === "export" && !isEmployee ? (
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
                      <div className="mb-4">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Imported calendars</p>
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Calendar URL</TableHead>
                                <TableHead className="text-xs w-[90px] text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {importedCalendarList.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={2} className="text-xs text-muted-foreground py-4 text-center">
                                    No calendars imported yet. Add one below.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                importedCalendarList.map((url) => (
                                  <TableRow key={url}>
                                    <TableCell className="py-2">
                                      {editingCalendarUrl === url ? (
                                        <div className="flex items-center gap-1">
                                          <Input
                                            className="h-8 text-xs flex-1 min-w-0"
                                            value={editingCalendarValue}
                                            onChange={(e) => setEditingCalendarValue(e.target.value)}
                                            placeholder="Calendar URL"
                                          />
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 shrink-0"
                                            disabled={isSavingImportSettings || !editingCalendarValue.trim()}
                                            onClick={() => handleSaveEditCalendar(url, editingCalendarValue)}
                                          >
                                            <Check className="w-4 h-4" />
                                          </Button>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 shrink-0"
                                            disabled={isSavingImportSettings}
                                            onClick={() => { setEditingCalendarUrl(null); setEditingCalendarValue(""); }}
                                          >
                                            <X className="w-4 h-4" />
                                          </Button>
                                        </div>
                                      ) : (
                                        <span className="text-xs truncate block max-w-[200px]" title={url}>{url}</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="py-2 text-right">
                                      {editingCalendarUrl !== url && (
                                        <>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 shrink-0"
                                            onClick={() => { setEditingCalendarUrl(url); setEditingCalendarValue(url); }}
                                            aria-label="Edit calendar"
                                          >
                                            <Pencil className="w-3.5 h-3.5" />
                                          </Button>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                                            disabled={isSavingImportSettings}
                                            onClick={() => handleRemoveImportedCalendar(url)}
                                            aria-label="Remove calendar"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </Button>
                                        </>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <Input
                          placeholder="Paste calendar URL here..."
                          value={importCalendarUrl}
                          onChange={(e) => setImportCalendarUrl(e.target.value)}
                          onPaste={(e) => {
                            const text = e.clipboardData?.getData("text/plain")?.trim();
                            if (text) setImportCalendarUrl(normalizeCalendarUrl(text));
                          }}
                          autoFocus
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
              {!isEmployee && (
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
              )}
              
              <div className={!isEmployee ? "border-t pt-6" : ""}>
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Link className="w-4 h-4" />
                  Import External Calendar
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Paste a calendar URL from Google Calendar or Outlook to see your events here.
                </p>
                <div className="mb-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Imported calendars</p>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Calendar URL</TableHead>
                          <TableHead className="text-xs w-[90px] text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importedCalendarList.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2} className="text-xs text-muted-foreground py-4 text-center">
                              No calendars imported yet. Add one below.
                            </TableCell>
                          </TableRow>
                        ) : (
                          importedCalendarList.map((url) => (
                            <TableRow key={url}>
                              <TableCell className="py-2">
                                {editingCalendarUrl === url ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      className="h-8 text-xs flex-1 min-w-0"
                                      value={editingCalendarValue}
                                      onChange={(e) => setEditingCalendarValue(e.target.value)}
                                      placeholder="Calendar URL"
                                    />
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 shrink-0"
                                      disabled={isSavingImportSettings || !editingCalendarValue.trim()}
                                      onClick={() => handleSaveEditCalendar(url, editingCalendarValue)}
                                    >
                                      <Check className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 shrink-0"
                                      disabled={isSavingImportSettings}
                                      onClick={() => { setEditingCalendarUrl(null); setEditingCalendarValue(""); }}
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-xs truncate block max-w-[240px]" title={url}>{url}</span>
                                )}
                              </TableCell>
                              <TableCell className="py-2 text-right">
                                {editingCalendarUrl !== url && (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 shrink-0"
                                      onClick={() => { setEditingCalendarUrl(url); setEditingCalendarValue(url); }}
                                      aria-label="Edit calendar"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                                      disabled={isSavingImportSettings}
                                      onClick={() => handleRemoveImportedCalendar(url)}
                                      aria-label="Remove calendar"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                <div className="space-y-3">
                  <Input
                    ref={importUrlInputRef}
                    placeholder="Paste calendar URL here..."
                    value={importCalendarUrl}
                    onChange={(e) => setImportCalendarUrl(e.target.value)}
                    onPaste={(e) => {
                      const text = e.clipboardData?.getData("text/plain")?.trim();
                      if (text) setImportCalendarUrl(text);
                    }}
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
                  <p className="font-semibold text-sm">{timeInfo.dateTimeLine ?? timeInfo.relative}</p>
                  <p className="text-sm text-muted-foreground">{timeInfo.fullDate}</p>
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
