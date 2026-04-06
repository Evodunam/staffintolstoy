import React, { useState, useMemo, useEffect, useCallback } from "react";
import { format, isToday, isTomorrow, differenceInDays, differenceInMonths, isPast, addHours, isSameDay, startOfDay, addMonths, addWeeks } from "date-fns";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { UserProfileCard } from "@/components/ui/user-profile-card";
import { 
  MapPin, Send, X, Calendar, Users, 
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Play, Image as ImageIcon, Info, Loader2,
  CalendarCheck, CalendarX, Clock, Navigation, XCircle, Car, Settings, ArrowLeft, Check, MessageSquare,
  DollarSign, CheckCircle2, Flag, Shield, Key, FileCheck, AlertTriangle, Wrench, AlertCircle, Settings2,
  Edit2, MapPinned, Receipt
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { RateSlider } from "@/components/RateSlider";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NumberFlowComponent } from "@/components/ui/number-flow";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MiniJobMap, JobLocationMap } from "./JobsMap";
import { DriveTimePopup } from "./DriveTimePopup";
import { LayeredAvatars } from "./LayeredAvatars";
import { GooglePlacesAutocomplete } from "./GooglePlacesAutocomplete";
import type { Job, Profile, Timesheet } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useScrollHeaderContainer } from "@/hooks/use-scroll-header-container";
import { cn, normalizeAvatarUrl, formatTime12h } from "@/lib/utils";
import { getDisplayJobTitle } from "@/lib/job-display";
import { INDUSTRY_CATEGORIES, getLiteElitePartner } from "@shared/industries";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { MaterialInvoiceDialog } from "@/components/MaterialInvoiceDialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { usePersistentFilter } from "@/hooks/use-persistent-filter";

/** Converts stored rate (cents or dollars) to dollars. Values > 100 are treated as cents. Matches WorkerDashboard so map pill and panel show same payout. */
function rateToDollars(v: number | null | undefined): number {
  if (v == null) return 30;
  return v > 100 ? v / 100 : v;
}

/** Worker hourly rate in dollars; profile/job may be in cents. Matches WorkerDashboard getWorkerHourlyRate. */
function getWorkerHourlyRate(profileRate: number | null | undefined, jobRate: number): number {
  if (profileRate != null && profileRate > 0) return rateToDollars(profileRate);
  return rateToDollars(jobRate);
}

/** Compute effective total hours + day span for payout math and breakdown copy. */
function getPayoutBreakdownFromJob(job: Job): { totalHours: number; hoursPerDay: number; days: number } {
  const totalHours = job.estimatedHours ?? 8;
  const start = job.startDate ? new Date(job.startDate) : null;
  const end = job.endDate ? new Date(job.endDate) : null;

  let days = 1;
  if (job.jobType === "recurring" && (job.recurringWeeks ?? 0) > 0 && job.scheduleDays?.length) {
    days = (job.recurringWeeks ?? 1) * job.scheduleDays.length;
  } else if (start && end && end > start) {
    const startDay = startOfDay(start);
    const endDay = startOfDay(end);
    const diff = differenceInDays(endDay, startDay);
    if (diff >= 0) days = diff + 1;
  }

  const hoursPerDay = days > 0 ? totalHours / days : totalHours;
  return { totalHours, hoursPerDay, days };
}

/** Format payout breakdown line: "8 hrs × $38/hr = $304" or "144 total hrs × 12 days × $20/hr = $2,880". */
function formatPayoutBreakdown(
  totalHours: number,
  hoursPerDay: number,
  days: number,
  rateDollars: number,
  subtotal: number
): string {
  const rate = Math.round(rateDollars);
  const sub = Math.round(subtotal).toLocaleString();
  const totalHoursDisplay =
    Number.isInteger(totalHours) ? String(totalHours) : totalHours.toFixed(1).replace(/\.0$/, "");
  if (days <= 1) {
    return `${totalHoursDisplay} hrs × $${rate}/hr = $${sub}`;
  }
  return `${totalHoursDisplay} total hrs × ${days} days × $${rate}/hr = $${sub}`;
}

function getPayoutBreakdownPieces(
  totalHours: number,
  days: number,
  rateDollars: number,
  subtotal: number
): { prefix: string; rateLabel: string; suffix: string } {
  const rate = Math.round(rateDollars);
  const sub = Math.round(subtotal).toLocaleString();
  const totalHoursDisplay =
    Number.isInteger(totalHours) ? String(totalHours) : totalHours.toFixed(1).replace(/\.0$/, "");
  if (days <= 1) {
    return {
      prefix: `${totalHoursDisplay} hrs × `,
      rateLabel: `$${rate}/hr`,
      suffix: ` = $${sub}`,
    };
  }
  return {
    prefix: `${totalHoursDisplay} total hrs × ${days} days × `,
    rateLabel: `$${rate}/hr`,
    suffix: ` = $${sub}`,
  };
}

function buildInlineApplyMessageTemplates(input: {
  firstName: string;
  roleLabel: string;
  companyLabel: string;
  tradeLabel: string;
  timeLabel: string;
  locationLabel: string;
  skillLabel: string;
}): string[] {
  const { firstName, roleLabel, companyLabel, tradeLabel, timeLabel, locationLabel, skillLabel } = input;
  const hello = [`Hi ${companyLabel},`, `Hello ${companyLabel},`, `Good day ${companyLabel},`, `Hey ${companyLabel},`];
  const openers = [
    `I'm ${firstName}, a ${roleLabel} with hands-on ${tradeLabel} experience.`,
    `My name is ${firstName}, and I've been focused on ${tradeLabel} work.`,
    `I'm ${firstName}. I can help on this ${tradeLabel} assignment right away.`,
    `I'm ${firstName}, and this ${tradeLabel} role matches my background well.`,
    `I'm ${firstName}, and I'm interested in supporting this ${tradeLabel} project.`,
  ];
  const proof = [
    `I'm comfortable with ${skillLabel} and fast onboarding on-site.`,
    `I work clean, communicate clearly, and keep pace with production targets.`,
    `I'm reliable with attendance and can follow site direction closely.`,
    `I prioritize safety, quality, and finishing scopes on schedule.`,
    `I've handled similar scopes and can jump in with minimal ramp-up.`,
  ];
  const availability = [
    `I'm available for ${timeLabel}.`,
    `My schedule is open for ${timeLabel}.`,
    `I can commit to ${timeLabel}.`,
    `I'm ready for this timeline: ${timeLabel}.`,
  ];
  const close = [
    `I can work at ${locationLabel} and would like to be considered.`,
    `Happy to support this job at ${locationLabel}.`,
    `I'm ready to start and can be on-site at ${locationLabel}.`,
    `Please consider my application for this role.`,
  ];

  const templates: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (templates.length < 40 && i < 2000) {
    const h = hello[(i + Math.floor(i / 2) + 1) % hello.length];
    const o = openers[(i + Math.floor(i / 3) + 2) % openers.length];
    const p = proof[(i * 2 + Math.floor(i / 5) + 3) % proof.length];
    const a = availability[(i + Math.floor(i / 7) + 1) % availability.length];
    const c = close[(i * 3 + Math.floor(i / 11) + 2) % close.length];
    const msg = `${h} ${o} ${p} ${a} ${c}`;
    if (!seen.has(msg)) {
      seen.add(msg);
      templates.push(msg);
    }
    i++;
  }
  return templates;
}

interface TeamMemberBasic {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  hourlyRate: number | null;
  email?: string | null;
  phone?: string | null;
  role?: "admin" | "employee";
  skillsets?: string[];
  status?: "active" | "pending" | "inactive";
  inviteToken?: string | null;
  latitude?: string | null;
  longitude?: string | null;
}

interface ApplicationData {
  id: number;
  status: "pending" | "accepted" | "rejected";
  hourlyRate?: number | null;
  teamMember?: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    hourlyRate: number | null;
  } | null;
  proposedRate?: number | null;
}

interface GroupedApplications {
  applications: ApplicationData[];
  minWorkerCount: number;
}

interface EnhancedJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job | null;
  profile: Profile | null | undefined;
  /** When worker has no face photo, show business operator avatar on applied jobs (used for employees). */
  operatorAvatarUrl?: string | null;
  activeTeamMembers?: TeamMemberBasic[];
  workerLocation?: { lat: number; lng: number } | null;
  onOpenApply?: (job: Job) => void;
  onDismiss?: (job: Job) => void;
  application?: ApplicationData | null;
  groupedApplications?: GroupedApplications | null;
  onWithdraw?: (applicationId: number) => void;
  onWithdrawAll?: (applicationIds: number[]) => void;
  onGetDirections?: (job: Job) => void;
  onAssignTeamMember?: (applicationId: number, teamMemberId: number | null) => void;
  isWithdrawing?: boolean;
  /** When set, open apply flow at this step (e.g. 3 = message step). Used when opening from calendar "Add to route". */
  initialApplyStage?: 1 | 2 | 3;
  /** Radius (miles) from job to consider a worker/teammate "within territory". When not set, uses default 50. Should match find-work maxDistanceMiles when opening from find-work. */
  territoryRadiusMiles?: number;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  
  return isMobile;
}

// Job time type: use jobType as source of truth so badge/timeline match (recurring > on_demand > one_time).
function getJobTypeInfo(job: Job, t: (key: string) => string): { label: string; color: string; tooltip: string } {
  if (job.jobType === "recurring") {
    return {
      label: t("recurring"),
      color: "bg-blue-500",
      tooltip: t("recurringTooltip")
    };
  }
  if (job.jobType === "on_demand" || job.isOnDemand) {
    return {
      label: t("onDemand"),
      color: "bg-purple-500",
      tooltip: t("onDemandTooltip")
    };
  }
  return {
    label: t("oneTime"),
    color: "bg-green-500",
    tooltip: t("oneTimeTooltip")
  };
}

function getRelativeDay(date: Date, t: (key: string, opts?: any) => string): string {
  if (isToday(date)) return t("today");
  if (isTomorrow(date)) return t("tomorrow");
  
  const daysFromNow = differenceInDays(date, new Date());
  if (daysFromNow < 0) return t("past");
  if (daysFromNow <= 6) return t("inDays", { days: daysFromNow });
  if (daysFromNow <= 13) return t("nextWeek");
  
  return format(date, "EEE, MMM d");
}

// Format time string to 12h with " AM" / " PM" (e.g. "08:00" -> "8:00 AM", "17:00" -> "5:00 PM")
// Handles legacy formats that already contain am/pm by returning as-is
function formatTimeString(time: string | null | undefined): string {
  if (!time) return "";
  const t = time.trim();
  if (!t) return "";

  if (t.toLowerCase().includes("am") || t.toLowerCase().includes("pm")) return t;
  if (t.includes(" - ")) {
    const [start, end] = t.split(" - ").map((s) => s.trim());
    const start12 = start ? formatTime12h(start) : "";
    const end12 = end ? formatTime12h(end) : "";
    if (start12 && end12) return `${start12} - ${end12}`;
    if (start12) return start12;
    if (end12) return end12;
    return t;
  }
  return formatTime12h(t);
}

// Format schedule days array to readable format (e.g., ["monday", "tuesday", "wednesday"] -> "Mon-Wed")
function formatScheduleDays(days: string[] | null | undefined): string {
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
}

function formatJobTime(job: Job, t: (key: string, opts?: any) => string): {
  relative: string;
  timeRange: string;
  fullDate: string;
  scheduleDaysDisplay?: string;
  /** Recurring: explicit start–end calendar range (e.g. Mar 17, 2025 – Jun 30, 2025) */
  schedulePeriodDisplay?: string;
} {
  const startDate = new Date(job.startDate);
  const relative = getRelativeDay(startDate, t);
  const fullDate = format(startDate, "EEEE, MMMM d, yyyy");
  
  // Helper to format time as 12h with " AM" / " PM"
  const formatTime = (date: Date) => {
    const h = date.getHours();
    const m = date.getMinutes();
    if (h === 0) return `12:${String(m).padStart(2, "0")} AM`;
    if (h === 12) return `12:${String(m).padStart(2, "0")} PM`;
    if (h < 12) return `${h}:${String(m).padStart(2, "0")} AM`;
    return `${h - 12}:${String(m).padStart(2, "0")} PM`;
  };
  
  let timeRange = "";
  let scheduleDaysDisplay: string | undefined;
  let schedulePeriodDisplay: string | undefined;
  
  // Use jobType as source of truth: recurring first, then on-demand, then one-time
  if (job.jobType === "recurring") {
    // Recurring jobs - use scheduleDays and endTime fields
    if (job.scheduleDays && job.scheduleDays.length > 0) {
      scheduleDaysDisplay = formatScheduleDays(job.scheduleDays);
    }
    
    if (job.scheduledTime && job.endTime) {
      const startTimeStr = formatTimeString(job.scheduledTime);
      const endTimeStr = formatTimeString(job.endTime);
      timeRange = `${startTimeStr} - ${endTimeStr}`;
    } else if (job.scheduledTime) {
      timeRange = formatTimeString(job.scheduledTime);
    }

    // Contract / posting period: startDate + endDate (or derived from recurringMonths / recurringWeeks)
    const startLabel = format(startDate, "MMM d, yyyy");
    let periodEnd: Date | null = null;
    if (job.endDate) {
      const e = new Date(job.endDate);
      if (!Number.isNaN(e.getTime())) periodEnd = e;
    }
    if (!periodEnd && job.recurringMonths != null && Number(job.recurringMonths) > 0) {
      periodEnd = addMonths(startDate, Number(job.recurringMonths));
    }
    if (!periodEnd && job.recurringWeeks != null && Number(job.recurringWeeks) > 0) {
      periodEnd = addWeeks(startDate, Number(job.recurringWeeks));
    }
    if (periodEnd) {
      const endLabel = format(periodEnd, "MMM d, yyyy");
      schedulePeriodDisplay =
        isSameDay(startOfDay(startDate), startOfDay(periodEnd)) ? startLabel : `${startLabel} – ${endLabel}`;
    } else {
      schedulePeriodDisplay = `${t("scheduleStartsOn") || "Starts"} ${startLabel}`;
    }
  } else if (job.jobType === "on_demand" || job.isOnDemand) {
    // On-Demand jobs have no fixed end time
    if (startDate.getHours() !== 0 || startDate.getMinutes() !== 0) {
      timeRange = t("starting", { time: formatTime(startDate) });
    } else {
      timeRange = t("flexibleHours");
    }
  } else if (job.scheduledTime && job.endTime) {
    // One-day job with separate start/end time fields
    const startTimeStr = formatTimeString(job.scheduledTime);
    const endTimeStr = formatTimeString(job.endTime);
    timeRange = `${startTimeStr} - ${endTimeStr}`;
  } else if (startDate.getHours() !== 0 || startDate.getMinutes() !== 0) {
    // Legacy one-day jobs with start/end timestamps
    const startTime = formatTime(startDate);
    if (job.endDate) {
      const endDate = new Date(job.endDate);
      const endTime = formatTime(endDate);
      timeRange = `${startTime} - ${endTime}`;
    } else if (job.estimatedHours) {
      const endEstimate = new Date(startDate.getTime() + job.estimatedHours * 60 * 60 * 1000);
      const endTime = formatTime(endEstimate);
      timeRange = `${startTime} - ${endTime}`;
    } else {
      timeRange = t("starting", { time: startTime });
    }
  }
  
  return { relative, timeRange, fullDate, scheduleDaysDisplay, schedulePeriodDisplay };
}

function formatTimeRange(job: Job, t: (key: string, opts?: any) => string): string {
  const { relative, timeRange, fullDate } = formatJobTime(job, t);
  return `${relative}${timeRange ? ` (${timeRange})` : ''} - ${fullDate}`;
}

/** Default radius (miles) to consider a worker/teammate "within territory" of a job location when territoryRadiusMiles is not provided. */
const DEFAULT_JOB_TERRITORY_RADIUS_MILES = 50;

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function checkSkillMatchForJob(skillsets: string[] | null | undefined, job: Job): boolean {
  if (!skillsets?.length) return false;
  const jobTrade = (job.trade || "").toLowerCase();
  const jobCat = (job.serviceCategory || "").toLowerCase();
  const jobSkills = (job.requiredSkills || []).map(s => s.toLowerCase());
  return skillsets.some(s => {
    const sL = s.toLowerCase();
    return jobTrade && jobTrade.includes(sL) || sL.includes(jobTrade) ||
      jobCat && (jobCat.includes(sL) || sL.includes(jobCat)) ||
      jobSkills.some(sk => sk.includes(sL) || sL.includes(sk));
  });
}

function getMatchingSkillsForJob(skillsets: string[] | null | undefined, job: Job): string[] {
  if (!skillsets?.length) return [];
  const jobTrade = (job.trade || "").toLowerCase();
  const jobCat = (job.serviceCategory || "").toLowerCase();
  const jobSkills = (job.requiredSkills || []).map(s => s.toLowerCase());
  const matches: string[] = [];
  for (const s of skillsets) {
    const sL = s.toLowerCase();
    if (jobTrade && (jobTrade.includes(sL) || sL.includes(jobTrade))) { matches.push(s); continue; }
    if (jobCat && (jobCat.includes(sL) || sL.includes(jobCat))) { matches.push(s); continue; }
    if (jobSkills.some(sk => sk.includes(sL) || sL.includes(sk))) { matches.push(s); continue; }
  }
  return matches;
}

function DescriptionBlock({ text, threshold, label, t }: { text: string; threshold: number; label: string; t: (k: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldTruncate = text.length > threshold;
  const display = shouldTruncate && !expanded ? text.slice(0, threshold) + "…" : text;
  return (
    <div>
      <p className="font-semibold mb-1">{label}</p>
      <p className="text-muted-foreground whitespace-pre-wrap break-words text-sm">{display}</p>
      {shouldTruncate && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="text-sm text-primary font-medium mt-1 underline">
          {expanded ? (t("showLess") || "Show less") : (t("showMore") || "Show more")}
        </button>
      )}
    </div>
  );
}

function CompanyInlineSimple({
  company,
  t,
}: {
  company: Profile | null;
  t: (k: string, o?: any) => string;
}) {
  const months = company?.createdAt ? differenceInMonths(new Date(), new Date(company.createdAt)) : 0;
  const tenureText = months <= 0
    ? (t("onTolstoyNew") || "New on Tolstoy Staffing")
    : (t("onTolstoyMonths", { count: months }) || `${months} month${months !== 1 ? "s" : ""} on Tolstoy Staffing`);
  return (
    <div className="flex items-center gap-3">
      {company?.companyLogo ? (
        <img src={company.companyLogo} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-semibold text-muted-foreground">{company?.companyName?.[0] || "C"}</span>
        </div>
      )}
      <div className="min-w-0">
        <p className="font-semibold text-base truncate">{company?.companyName || "Company"}</p>
        <p className="text-sm text-muted-foreground">{tenureText}</p>
      </div>
    </div>
  );
}

function MeetCompanyCard({
  company,
  job,
  companyJobsCount,
  companyLocationsCount,
  t,
  format,
  showMessageButton,
  onMessageCompany,
}: {
  company: Profile | null;
  job: Job;
  companyJobsCount?: number;
  companyLocationsCount?: number;
  t: (k: string, o?: any) => string;
  format: (d: Date, f: string) => string;
  showMessageButton: boolean;
  onMessageCompany?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-4 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center flex-shrink-0">
          {company?.companyLogo ? (
            <img src={company.companyLogo} alt="" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <span className="text-xl font-semibold text-muted-foreground">{company?.companyName?.[0] || "C"}</span>
            </div>
          )}
          <p className="font-semibold text-base mt-2">{company?.companyName || "Company"}</p>
          {company?.createdAt && (
            <p className="text-xs text-muted-foreground">
              {t("onTolstoySince", { date: format(new Date(company.createdAt), "MMM yyyy") }) || "On Tolstoy since " + format(new Date(company.createdAt), "MMM yyyy")}
            </p>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-3 border-l border-border/60 pl-4">
          {typeof companyLocationsCount === "number" && (
            <div>
              <p className="text-2xl font-bold">{companyLocationsCount}</p>
              <p className="text-xs text-muted-foreground">{t("locations") || "Locations"}</p>
            </div>
          )}
          {typeof companyJobsCount === "number" && (
            <div>
              <p className="text-2xl font-bold">{companyJobsCount}</p>
              <p className="text-xs text-muted-foreground">{t("jobsPostedLabel") || "Jobs posted"}</p>
            </div>
          )}
          <div>
            <p className="text-sm font-medium">{t("responseTime") || "Response time"}</p>
            <p className="text-xs text-muted-foreground">{t("typicallyWithin24h") || "Typically within 24 hours"}</p>
          </div>
        </div>
      </div>
      {showMessageButton && onMessageCompany && (
        <Button variant="outline" className="w-full mt-4 rounded-xl bg-muted/50 hover:bg-muted" onClick={onMessageCompany}>
          {t("messageCompany") || "Message company"}
        </Button>
      )}
    </div>
  );
}

function ThingsToKnowBlock({
  profile,
  t,
  onCancellation,
  onInsurance,
  onIdVerification,
  onW9,
}: {
  profile: Profile | null;
  t: (k: string, o?: any) => string;
  onCancellation: () => void;
  onInsurance: () => void;
  onIdVerification: () => void;
  onW9: () => void;
}) {
  const pr = profile as { identityVerified?: boolean; insuranceVerified?: boolean; w9DocumentUrl?: string } | null;
  const items: { icon: React.ReactNode; title: string; desc: string; verified?: boolean; onClick: () => void }[] = [
    { icon: <Calendar className="w-5 h-5" />, title: t("cancellationPolicy") || "Cancellation policy", desc: t("cancellationPolicySummary") || t("cancellationPolicyLine") || "Free cancellation", onClick: onCancellation },
    { icon: <Shield className="w-5 h-5" />, title: t("insuranceCheck") || "Insurance check", desc: pr?.insuranceVerified ? (t("insuranceValid") || "Your application will show valid insurance.") : (t("insuranceSetup") || "Set up in Account & Documents"), verified: !!pr?.insuranceVerified, onClick: onInsurance },
    { icon: <CheckCircle2 className="w-5 h-5" />, title: t("idVerificationCheck") || "ID verification check", desc: pr?.identityVerified ? (t("idVerifiedGood") || "Verified.") : (t("idSetup") || "Set up in Account & Documents"), verified: !!pr?.identityVerified, onClick: onIdVerification },
    { icon: <FileCheck className="w-5 h-5" />, title: t("w9VerificationCheck") || "W-9 verification check", desc: pr?.w9DocumentUrl ? (t("w9VerifiedGood") || "On file.") : (t("w9Setup") || "Set up in Account & Documents"), verified: !!pr?.w9DocumentUrl, onClick: onW9 },
  ];
  return (
    <div className="space-y-1">
      <h3 className="font-semibold text-lg mb-3">{t("thingsToKnow") || "Things to know"}</h3>
      {items.map((item, i) => (
        <button key={i} type="button" onClick={item.onClick} className="w-full flex flex-col items-stretch gap-1.5 py-3 text-left hover:bg-muted/50 rounded-xl -mx-2 px-2 transition-colors">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-muted-foreground flex-shrink-0 mt-0.5">{item.icon}</span>
            <p className="font-medium flex-1 min-w-0">{item.title}</p>
            {item.verified !== undefined && (
              item.verified ? (
                <span className="flex-shrink-0 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 text-xs font-medium">{t("verified") || "Verified"}</span>
              ) : (
                <span className="flex-shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-xs font-medium">{t("notVerified") || "Not verified"}</span>
              )
            )}
            <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          </div>
          <div className="pl-8 w-full min-w-0">
            <p className="text-sm text-muted-foreground text-left">{item.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function TeamMemberEditPopup({
  open,
  onOpenChange,
  member,
  profile,
  isSelf,
  onBack,
  isMobile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMemberBasic | null;
  profile: Profile | null;
  isSelf: boolean;
  onBack: () => void;
  isMobile: boolean;
}) {
  const { t } = useTranslation("enhancedJobDialog");
  const { t: tCommon } = useTranslation("common");
  const { toast } = useToast();
  const [editData, setEditData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    hourlyRate: 25,
  });
  
  useEffect(() => {
    if (open) {
      if (isSelf && profile) {
        setEditData({
          firstName: profile.firstName || "",
          lastName: profile.lastName || "",
          email: profile.email || "",
          phone: profile.phone || "",
          hourlyRate: profile.hourlyRate || 25,
        });
      } else if (member) {
        setEditData({
          firstName: member.firstName || "",
          lastName: member.lastName || "",
          email: member.email || "",
          phone: member.phone || "",
          hourlyRate: member.hourlyRate || 25,
        });
      }
    }
  }, [open, member, profile, isSelf]);
  
  const updateMutation = useMutation({
    mutationFn: async (data: typeof editData) => {
      if (isSelf) {
        return apiRequest("PATCH", "/api/profile", data);
      } else if (member) {
        return apiRequest("PATCH", `/api/team-members/${member.id}`, data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/members"] });
      toast({ title: t("saved"), description: t("changesSavedSuccessfully") });
      onBack();
    },
    onError: () => {
      toast({ title: tCommon("error"), description: t("failedToSaveChanges"), variant: "destructive" });
    }
  });
  
  const handleSave = () => {
    updateMutation.mutate(editData);
  };
  
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isScrolled = useScrollHeaderContainer(scrollContainerRef);
  
  const content = (
    <div className="flex flex-col h-full">
      <div className={cn(
        "flex-shrink-0 flex items-center gap-3 px-4 border-b bg-background sticky top-0 z-10 transition-all duration-200",
        isScrolled ? "py-2" : "py-3"
      )}>
        <button
          onClick={onBack}
          className={cn(
            "flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-all duration-200",
            isScrolled ? "w-8 h-8" : "w-9 h-9"
          )}
          data-testid="edit-member-back"
        >
          <ArrowLeft className={cn(
            "text-muted-foreground transition-all duration-200",
            isScrolled ? "w-4 h-4" : "w-5 h-5"
          )} />
        </button>
        <h2 className={cn(
          "font-semibold transition-all duration-200",
          isScrolled ? "text-base" : "text-lg"
        )}>
          {t("edit")} {isSelf ? t("myProfile") : `${member?.firstName || t("teamMember")}`}
        </h2>
      </div>
      
      <div 
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4"
      >
        <div className="flex items-center gap-4 pb-4 border-b">
          <Avatar className="w-16 h-16 border-2">
            <AvatarImage src={isSelf ? (profile?.avatarUrl || undefined) : (member?.avatarUrl || undefined)} />
            <AvatarFallback className="text-xl">
              {editData.firstName?.[0]}{editData.lastName?.[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold text-lg">{editData.firstName} {editData.lastName}</p>
            <Badge variant="secondary" className="text-xs">
              {isSelf ? t("you") : (member?.role === "admin" ? t("admin") : t("employee"))}
            </Badge>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">{t("firstName")}</Label>
            <Input
              value={editData.firstName}
              onChange={(e) => setEditData({ ...editData, firstName: e.target.value })}
              className="mt-1"
              data-testid="edit-first-name"
            />
          </div>
          <div>
            <Label className="text-sm">{t("lastName")}</Label>
            <Input
              value={editData.lastName}
              onChange={(e) => setEditData({ ...editData, lastName: e.target.value })}
              className="mt-1"
              data-testid="edit-last-name"
            />
          </div>
        </div>
        
        <div>
          <Label className="text-sm">{tCommon("email")}</Label>
          <Input
            type="email"
            value={editData.email}
            onChange={(e) => setEditData({ ...editData, email: e.target.value })}
            className="mt-1"
            data-testid="edit-email"
          />
        </div>
        
        <div>
          <Label className="text-sm">{tCommon("phone")}</Label>
          <Input
            type="tel"
            value={editData.phone}
            onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
            className="mt-1"
            data-testid="edit-phone"
          />
        </div>
        
        <div>
          <Label className="text-sm">{t("hourlyRate")}</Label>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm text-muted-foreground">$1</span>
            <RateSlider
              value={editData.hourlyRate}
              onValueChange={(v) => setEditData({ ...editData, hourlyRate: v })}
              className="flex-1"
            />
            <span className="text-sm text-muted-foreground">$200</span>
          </div>
          <p className="text-center font-semibold text-lg mt-2 text-green-600 dark:text-green-400">
            ${editData.hourlyRate}/hr
          </p>
        </div>
        
        {isMobile && <div className="h-24" />}
      </div>
      
      <div className={`flex-shrink-0 p-4 border-t bg-background ${isMobile ? 'fixed bottom-0 left-0 right-0 z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]' : ''}`}>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={onBack}
            className="flex-1 h-12 rounded-xl"
            data-testid="edit-cancel"
          >
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex-1 h-12 rounded-xl"
            data-testid="edit-save"
          >
            {updateMutation.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Check className="w-5 h-5 mr-2" />
                {tCommon("saveChanges")}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
  
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[100dvh] max-h-[100dvh] rounded-t-none">
          <DrawerTitle className="sr-only">{t("edit")} {isSelf ? t("profile") : t("teamMember")}</DrawerTitle>
          <DrawerDescription className="sr-only">{t("editInformation")}</DrawerDescription>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden">
        <DialogTitle className="sr-only">{t("edit")} {isSelf ? t("profile") : t("teamMember")}</DialogTitle>
        <DialogDescription className="sr-only">{t("editInformation")}</DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  );
}

function TeamMemberSelectorPopup({
  open,
  onOpenChange,
  profile,
  activeTeamMembers,
  selectedApplicants,
  onToggleApplicant,
  workersNeeded,
  isAdmin,
  isMobile,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile | null;
  activeTeamMembers: TeamMemberBasic[];
  selectedApplicants: Set<number | "self">;
  onToggleApplicant: (id: number | "self") => void;
  workersNeeded: number;
  isAdmin: boolean;
  isMobile: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation("enhancedJobDialog");
  const { t: tCommon } = useTranslation("common");
  const [editPopupOpen, setEditPopupOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMemberBasic | null>(null);
  const [editingSelf, setEditingSelf] = useState(false);
  
  const handleEditClick = (member: TeamMemberBasic | "self", e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (member === "self") {
      setEditingSelf(true);
      setEditingMember(null);
    } else {
      setEditingSelf(false);
      setEditingMember(member);
    }
    setEditPopupOpen(true);
  };
  
  const handleBackFromEdit = () => {
    setEditPopupOpen(false);
    setEditingMember(null);
    setEditingSelf(false);
  };
  
  const content = (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenChange(false)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors"
            data-testid="selector-back"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div>
            <h2 className="font-semibold text-lg">{t("selectWorkers")}</h2>
            <p className="text-xs text-muted-foreground">{t("selectedOfNeeded", { selected: selectedApplicants.size, needed: workersNeeded })}</p>
          </div>
        </div>
      </div>
      
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2">
        <div 
          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-colors cursor-pointer ${
            selectedApplicants.has("self") ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-muted/50'
          }`}
          onClick={() => onToggleApplicant("self")}
          data-testid="selector-self"
        >
          <Checkbox 
            checked={selectedApplicants.has("self")} 
            onCheckedChange={() => onToggleApplicant("self")}
          />
          <Avatar className="w-10 h-10 border">
            <AvatarImage src={profile?.avatarUrl || undefined} />
            <AvatarFallback>{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium">{t("myself")}</p>
            <p className="text-sm text-green-600 dark:text-green-400">${profile?.hourlyRate || 30}/hr</p>
          </div>
          {isAdmin && (
            <button
              onClick={(e) => handleEditClick("self", e)}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
              data-testid="edit-self-button"
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
        
        {activeTeamMembers.map(member => (
          <div 
            key={member.id}
            className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-colors cursor-pointer ${
              selectedApplicants.has(member.id) ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-muted/50'
            }`}
            onClick={() => onToggleApplicant(member.id)}
            data-testid={`selector-member-${member.id}`}
          >
            <Checkbox 
              checked={selectedApplicants.has(member.id)}
              onCheckedChange={() => onToggleApplicant(member.id)}
            />
            <Avatar className="w-10 h-10 border">
              <AvatarImage src={member.avatarUrl || undefined} />
              <AvatarFallback>{member.firstName?.[0]}{member.lastName?.[0]}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{member.firstName} {member.lastName}</p>
              <p className="text-sm text-green-600 dark:text-green-400">${member.hourlyRate || 30}/hr</p>
            </div>
            {isAdmin && (
              <button
                onClick={(e) => handleEditClick(member, e)}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
                data-testid={`edit-member-${member.id}`}
              >
                <Settings className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
        ))}
        
        {isMobile && <div className="h-24" />}
      </div>
      
      <div className={`flex-shrink-0 p-4 border-t bg-background ${isMobile ? 'fixed bottom-0 left-0 right-0 z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]' : ''}`}>
        <Button
          onClick={onDone}
          className="w-full h-12 rounded-xl font-semibold"
          disabled={selectedApplicants.size === 0}
          data-testid="selector-done"
        >
          <Check className="w-5 h-5 mr-2" />
          {t("done")} ({selectedApplicants.size} {t("selected")})
        </Button>
      </div>
      
      <TeamMemberEditPopup
        open={editPopupOpen}
        onOpenChange={setEditPopupOpen}
        member={editingMember}
        profile={profile}
        isSelf={editingSelf}
        onBack={handleBackFromEdit}
        isMobile={isMobile}
      />
    </div>
  );
  
  if (isMobile) {
    return (
      <Drawer open={open && !editPopupOpen} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[100dvh] max-h-[100dvh] rounded-t-none">
          <DrawerTitle className="sr-only">{t("selectWorkers")}</DrawerTitle>
          <DrawerDescription className="sr-only">{t("chooseTeamMembersForApplication")}</DrawerDescription>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }
  
  return (
    <Dialog open={open && !editPopupOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden">
        <DialogTitle className="sr-only">{t("selectWorkers")}</DialogTitle>
        <DialogDescription className="sr-only">{t("chooseTeamMembersForApplication")}</DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  );
}

function ApplySheet({
  open,
  onOpenChange,
  job,
  profile,
  activeTeamMembers,
  onSubmit,
  isSubmitting,
  isMobile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  profile: Profile | null;
  activeTeamMembers: TeamMemberBasic[];
  onSubmit: (message: string, selectedApplicants: { id: number | "self"; name: string }[]) => void;
  isSubmitting: boolean;
  isMobile: boolean;
}) {
  const { t } = useTranslation("enhancedJobDialog");
  const { t: tCommon } = useTranslation("common");
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [message, setMessage] = useState("");
  const [selectedApplicants, setSelectedApplicants] = useState<Set<number | "self">>(() => new Set<number | "self">(["self"]));
  const [showTeamSelector, setShowTeamSelector] = useState(false);
  
  // Fetch company profile information for step 2
  const { data: companyProfile } = useQuery<Profile | null>({
    queryKey: ["/api/profiles", job.companyId],
    queryFn: async () => {
      const res = await fetch(`/api/profiles/${job.companyId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open,
  });
  
  const workersNeeded = job.maxWorkersNeeded ?? 1;
  const acceptedTeamMembers = useMemo(() => activeTeamMembers.filter((m) => m.status === "active"), [activeTeamMembers]);
  const canApplyMultiple = workersNeeded > 1 && acceptedTeamMembers.length > 0;
  const isAdmin = (profile as any)?.isBusinessOperator === true;
  
  // Track if opened from calendar popup (for smart rate auto-apply)
  const [useSmartRate, setUseSmartRate] = useState(true);
  const [smartApplyRateEnabled] = usePersistentFilter<boolean>("smart_apply_rate_enabled", true);
  const [firstApplicantRandomRateSheet, setFirstApplicantRandomRateSheet] = useState<number | null>(null);

  const { data: applicationRateStatsSheet } = useQuery<{ applicationCount: number; minProposedRateCents: number | null; maxProposedRateCents: number | null }>({
    queryKey: ["/api/jobs", job.id, "application-rate-stats"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${job.id}/application-rate-stats`, { credentials: "include" });
      if (!res.ok) return { applicationCount: 0, minProposedRateCents: null, maxProposedRateCents: null };
      return res.json();
    },
    enabled: open && !!job.id,
  });

  useEffect(() => {
    if (job?.id) {
      setUseSmartRate(smartApplyRateEnabled);
      setFirstApplicantRandomRateSheet(null);
    }
  }, [job?.id, smartApplyRateEnabled]);
  useEffect(() => {
    if (applicationRateStatsSheet?.applicationCount === 0 && firstApplicantRandomRateSheet === null && job?.id) {
      const rate = Math.round((18 + Math.random() * 10) * 100) / 100;
      setFirstApplicantRandomRateSheet(Math.min(28, Math.max(18, rate)));
    }
  }, [applicationRateStatsSheet?.applicationCount, job?.id, firstApplicantRandomRateSheet]);

  // Suggested rate: first applicant = random $18–$28; otherwise competitive vs other applications
  // (Must be declared before combinedPayout / getSelectedRate — they close over it.)
  const smartRateSuggestion = useMemo(() => {
    const applicationCount = applicationRateStatsSheet?.applicationCount ?? 0;
    const minCents = applicationRateStatsSheet?.minProposedRateCents ?? null;
    if (applicationCount === 0) {
      if (firstApplicantRandomRateSheet != null) return firstApplicantRandomRateSheet;
      const seed = job.id;
      const fallback = 18 + (seed % 11) + (seed % 10) / 10;
      return Math.round(Math.min(28, Math.max(18, fallback)) * 100) / 100;
    }
    if (minCents != null && minCents > 0) {
      const minDollars = minCents / 100;
      return Math.round(Math.max(18, Math.min(28, minDollars - 1)) * 100) / 100;
    }
    const userRate = profile?.hourlyRate || 30;
    const jobRate = job.hourlyRate ? job.hourlyRate / 100 : null;
    const tradePremiums: Record<string, number> = {
      Electrical: 1.15, Plumbing: 1.12, HVAC: 1.10, Carpentry: 1.08, Concrete: 1.05,
      Drywall: 1.03, Painting: 1.02, "General Labor": 1.0, Demolition: 1.0, Cleaning: 0.95,
    };
    const skillLevelMultipliers: Record<string, number> = { elite: 1.12, lite: 1.05, any: 1.0 };
    let baseRate = jobRate ? jobRate * 0.88 : userRate * 0.85;
    baseRate *= tradePremiums[job.trade || "General Labor"] || 1.0;
    baseRate *= skillLevelMultipliers[job.skillLevel || "any"] || 1.0;
    if (job.serviceCategory?.includes("Elite")) baseRate *= 1.10;
    else if (job.serviceCategory?.includes("Lite")) baseRate *= 1.04;
    const requiredSkillsCount = job.requiredSkills?.length || 0;
    if (requiredSkillsCount > 0) baseRate *= 1 + Math.min(requiredSkillsCount, 5) * 0.01;
    let finalRate = Math.max(18, Math.min(28, Math.round(baseRate * 100) / 100));
    if (finalRate > userRate && jobRate != null && jobRate <= userRate) finalRate = Math.min(finalRate, userRate * 0.98);
    return finalRate;
  }, [job.id, job.hourlyRate, job.trade, job.skillLevel, job.serviceCategory, job.requiredSkills, profile?.hourlyRate, applicationRateStatsSheet, firstApplicantRandomRateSheet]);

  const combinedPayout = useMemo(() => {
    const hours = job.estimatedHours || 8;
    let totalPayout = 0;

    selectedApplicants.forEach((id) => {
      if (id === "self") {
        const rate = useSmartRate ? smartRateSuggestion : profile?.hourlyRate || 30;
        totalPayout += rate * hours;
      } else {
        const member = acceptedTeamMembers.find((m) => m.id === id);
        const rate = useSmartRate ? smartRateSuggestion : member?.hourlyRate || 30;
        totalPayout += rate * hours;
      }
    });

    return totalPayout;
  }, [selectedApplicants, profile?.hourlyRate, acceptedTeamMembers, job.estimatedHours, useSmartRate, smartRateSuggestion]);

  const toggleApplicant = useCallback((id: number | "self") => {
    setSelectedApplicants(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        if (newSet.size > 1) {
          newSet.delete(id);
        }
      } else {
        if (newSet.size < workersNeeded) {
          newSet.add(id);
        }
      }
      return newSet;
    });
  }, [workersNeeded]);
  
  const handleSubmit = useCallback(() => {
    const validApplicants = Array.from(selectedApplicants).filter(id => {
      if (id === "self") return true;
      return acceptedTeamMembers.some(m => m.id === id);
    });
    
    const applicants = validApplicants.map(id => {
      if (id === "self") {
        return { id: "self" as const, name: `${profile?.firstName} ${profile?.lastName}` };
      }
      const member = acceptedTeamMembers.find(m => m.id === id);
      return { id, name: member ? `${member.firstName} ${member.lastName}` : "Team Member" };
    });
    onSubmit(message, applicants);
    
    // Show toast notification
    toast({
      title: t("applicationSubmitted") || "Application Submitted",
      description: selectedApplicants.size > 1 
        ? t("applicationsSubmittedSuccessfully", { count: selectedApplicants.size }) || `${selectedApplicants.size} applications submitted successfully`
        : t("yourApplicationHasBeenSubmitted") || "Your application has been submitted",
    });
    
    // Close the pop-up after a short delay to show the toast
    setTimeout(() => {
      onOpenChange(false);
    }, 500);
  }, [message, selectedApplicants, profile, acceptedTeamMembers, onSubmit, toast, t, onOpenChange]);
  
  useEffect(() => {
    if (open) {
      setStep(1);
      setMessage("");
      setSelectedApplicants(new Set<number | "self">(["self"]));
      setShowTeamSelector(false);
      // Auto-apply smart rate when opened from calendar (if a specific teammate was pre-selected)
      // This will be set by the parent component when opening from calendar
      setUseSmartRate(false);
    }
  }, [open]);

  // Auto-apply smart rate when a teammate is pre-selected from calendar
  useEffect(() => {
    if (open && selectedApplicants.size === 1 && !selectedApplicants.has("self")) {
      // If a single teammate is selected (not self), auto-apply smart rate
      setUseSmartRate(true);
    }
  }, [open, selectedApplicants]);
  
  const getSelectedNames = () => {
    const names: string[] = [];
    if (selectedApplicants.has("self")) {
      names.push("Myself");
    }
    selectedApplicants.forEach(id => {
      if (id !== "self") {
        const member = acceptedTeamMembers.find(m => m.id === id);
        if (member) {
          names.push(`${member.firstName} ${member.lastName}`);
        }
      }
    });
    return names;
  };
  
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isScrolled = useScrollHeaderContainer(scrollContainerRef);
  
  // Calculate selected rate for display
  const getSelectedRate = useMemo(() => {
    if (selectedApplicants.size === 0) return null;
    
    if (useSmartRate) {
      return smartRateSuggestion;
    }
    
    let totalRate = 0;
    let count = 0;
    
    selectedApplicants.forEach(id => {
      if (id === "self") {
        totalRate += profile?.hourlyRate || 30;
        count++;
      } else {
        const member = acceptedTeamMembers.find(m => m.id === id);
        totalRate += member?.hourlyRate || 30;
        count++;
      }
    });
    
    return count > 0 ? totalRate / count : null;
  }, [selectedApplicants, useSmartRate, smartRateSuggestion, profile?.hourlyRate, acceptedTeamMembers]);

  // Step 1 Content: Payout in header, teammates list
  const step1Content = (
    <div className="flex flex-col h-full">
      {/* Header with Estimated Payout */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b bg-background">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t("estimatedPayout") || "Estimated Payout"}</p>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">
            $<NumberFlowComponent value={combinedPayout} trend={false} />
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × {job.estimatedHours || 8} hours
          </p>
        </div>
      </div>

      <div 
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4"
      >
        {/* Teammates List - Fully Expanded */}
        {(acceptedTeamMembers.length > 0 || activeTeamMembers.some(m => m.status === "pending")) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                {workersNeeded > 1 
                  ? `${t("selectWorkers") || "Select Workers"} (${selectedApplicants.size}/${workersNeeded})`
                  : t("whosWorkingThisJob") || "Who's working this job?"
                }
              </Label>
              {workersNeeded > 1 && (
                <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                  <Users className="w-3 h-3 mr-1" />
                  {t("needsWorkers", { count: workersNeeded }) || `Needs ${workersNeeded} workers`}
                </Badge>
              )}
            </div>
            
            <div className="space-y-2">
              {/* Self option */}
              <button
                type="button"
                onClick={() => {
                  setSelectedApplicants(prev => {
                    const next = new Set(prev);
                    if (next.has("self")) {
                      if (next.size > 1) next.delete("self");
                    } else if (next.size < workersNeeded) {
                      next.add("self");
                    } else if (workersNeeded === 1) {
                      next.clear();
                      next.add("self");
                    }
                    return next;
                  });
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                  selectedApplicants.has("self") 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:border-primary/50"
                }`}
                data-testid="apply-sheet-select-self"
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                  selectedApplicants.has("self") ? "border-primary bg-primary" : "border-muted-foreground"
                }`}>
                  {selectedApplicants.has("self") && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>
                <Avatar className="w-10 h-10 border-2 border-primary/20 flex-shrink-0">
                  <AvatarImage src={profile?.avatarUrl ? (profile.avatarUrl.startsWith('http') || profile.avatarUrl.startsWith('/') ? profile.avatarUrl : `/objects/avatar/${profile.avatarUrl}`) : undefined} />
                  <AvatarFallback className="text-xs">{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium">{t("myself") || "Myself"}</p>
                  <p className="text-xs text-muted-foreground">${profile?.hourlyRate || 30}/hr</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTeamSelector(true);
                  }}
                  data-testid="apply-sheet-adjust-rate-self"
                >
                  <Settings className="w-4 h-4 text-muted-foreground" />
                </Button>
              </button>
              
              {/* Accepted team members only - Selectable */}
              {acceptedTeamMembers.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => {
                    setSelectedApplicants(prev => {
                      const next = new Set(prev);
                      if (next.has(member.id)) {
                        if (next.size > 1) next.delete(member.id);
                      } else if (next.size < workersNeeded) {
                        next.add(member.id);
                      } else if (workersNeeded === 1) {
                        next.clear();
                        next.add(member.id);
                      }
                      return next;
                    });
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                    selectedApplicants.has(member.id) 
                      ? "border-primary bg-primary/5" 
                      : "border-border hover:border-primary/50"
                  }`}
                  data-testid={`apply-sheet-select-member-${member.id}`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                    selectedApplicants.has(member.id) ? "border-primary bg-primary" : "border-muted-foreground"
                  }`}>
                    {selectedApplicants.has(member.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                  <Avatar className="w-10 h-10 border-2 border-secondary flex-shrink-0">
                    <AvatarImage src={member.avatarUrl ? (member.avatarUrl.startsWith('http') || member.avatarUrl.startsWith('/') ? member.avatarUrl : `/objects/avatar/${member.avatarUrl}`) : undefined} />
                    <AvatarFallback className="text-xs">{member.firstName?.[0]}{member.lastName?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left min-w-0">
                    <p className="font-medium">{member.firstName} {member.lastName}</p>
                    <p className="text-xs text-muted-foreground">${member.hourlyRate || 30}/hr</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTeamSelector(true);
                    }}
                    data-testid={`apply-sheet-adjust-rate-member-${member.id}`}
                  >
                    <Settings className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </button>
              ))}

              {/* Pending Team members - Not selectable, but clickable to show onboarding URL */}
              {activeTeamMembers.filter(m => m.status === "pending").length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-xs text-muted-foreground font-medium">
                    {t("pendingInvitations") || "Pending Invitations"}
                  </Label>
                  {activeTeamMembers.filter(m => m.status === "pending").map((member) => {
                    const onboardingUrl = member.inviteToken && member.role && member.hourlyRate
                      ? `${window.location.origin}/team/join/${member.inviteToken}`
                      : null;
                    
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={async () => {
                          if (onboardingUrl) {
                            try {
                              if (navigator.share) {
                                await navigator.share({
                                  title: t("joinMembersTeam", { firstName: member.firstName }) || `Join ${member.firstName}'s team`,
                                  text: t("invitedToJoinAsTeamMember") || "You've been invited to join as a team member",
                                  url: onboardingUrl,
                                });
                              } else {
                                await navigator.clipboard.writeText(onboardingUrl);
                                toast({
                                  title: t("linkCopied") || "Link Copied",
                                  description: t("onboardingLinkCopiedToClipboard") || "Onboarding link copied to clipboard",
                                });
                              }
                            } catch (err: any) {
                              if (err.name !== 'AbortError') {
                                try {
                                  await navigator.clipboard.writeText(onboardingUrl);
                                  toast({
                                    title: t("linkCopied") || "Link Copied",
                                    description: t("onboardingLinkCopiedToClipboard") || "Onboarding link copied to clipboard",
                                  });
                                } catch (copyErr) {
                                  console.error("Failed to copy link:", copyErr);
                                }
                              }
                            }
                          }
                        }}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/50 dark:hover:bg-amber-950/30 transition-all cursor-pointer"
                        data-testid={`apply-sheet-pending-member-${member.id}`}
                      >
                        <div className="w-5 h-5 rounded-full border-2 border-amber-400 dark:border-amber-600 flex items-center justify-center flex-shrink-0">
                          <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        </div>
                        <Avatar className="w-10 h-10 border-2 border-amber-200 dark:border-amber-800 flex-shrink-0 opacity-75">
                          <AvatarImage src={member.avatarUrl ? (member.avatarUrl.startsWith('http') || member.avatarUrl.startsWith('/') ? member.avatarUrl : `/objects/avatar/${member.avatarUrl}`) : undefined} />
                          <AvatarFallback className="text-xs">{member.firstName?.[0]}{member.lastName?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 text-left min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-amber-900 dark:text-amber-100">{member.firstName} {member.lastName}</p>
                            <Badge variant="outline" className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700">
                              {t("pending") || "Pending"}
                            </Badge>
                          </div>
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                            {onboardingUrl 
                              ? t("clickToCopyOnboardingLink") || "Click to copy onboarding link"
                              : t("completeSetupToShareLink") || "Complete setup to share link"}
                          </p>
                        </div>
                        {onboardingUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Copy link
                              navigator.clipboard.writeText(onboardingUrl);
                              toast({
                                title: t("linkCopied") || "Link Copied",
                                description: t("onboardingLinkCopiedToClipboard") || "Onboarding link copied to clipboard",
                              });
                            }}
                            data-testid={`apply-sheet-copy-link-${member.id}`}
                          >
                            <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          </Button>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            
            <p className="text-xs text-muted-foreground px-1">
              {t("paymentsForTeamMembersGoToYourAccount") || "Payments for team members go to your account"}
            </p>
          </div>
        )}

        {isMobile && <div className="h-20" />}
      </div>
      
      {/* Pinned Footer with Smart Rate and Send Application buttons */}
      <div className={`flex-shrink-0 p-4 border-t bg-background ${isMobile ? 'fixed bottom-0 left-0 right-0 z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]' : ''}`}>
        <div className="flex flex-row gap-2">
          {/* Left Button: Send Application (light color) */}
          <Button
            variant="outline"
            className="h-12 text-base font-medium rounded-xl flex-1"
            onClick={() => setStep(2)}
            disabled={selectedApplicants.size === 0}
            data-testid="apply-sheet-send-application"
          >
            <div className="flex flex-col items-center justify-center flex-1">
              <span className="text-sm">{t("sendApplication") || "Send Application"}</span>
              {getSelectedRate && (
                <span className="text-xs text-muted-foreground font-normal mt-0.5">
                  ${getSelectedRate.toFixed(2)}/hr
                </span>
              )}
            </div>
          </Button>
          
          {/* Right Button: Smart Rate Apply */}
          <Button
            className={`h-12 text-base font-semibold rounded-xl shadow-lg ${
              useSmartRate 
                ? 'bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600' 
                : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white'
            }`}
            onClick={() => {
              setUseSmartRate(true);
              setStep(2);
            }}
            disabled={selectedApplicants.size === 0}
            data-testid="apply-sheet-smart-rate"
            style={{ minWidth: '160px' }}
          >
            <div className="flex flex-col items-center justify-center">
              <span className="text-sm">{t("smartRate") || "Smart Rate"}</span>
              <span className="text-xs font-normal opacity-90">
                {t("apply") || "Apply"} ${smartRateSuggestion.toFixed(2)}/hr
              </span>
            </div>
          </Button>
        </div>
      </div>
    </div>
  );

  // Step 2 Content: Company info centered, note, send
  const step2Content = (
    <div className="flex flex-col h-full">
      <div 
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-6 space-y-6"
      >
        {/* Company Logo/Name - Centered */}
        <div className="flex flex-col items-center justify-center gap-3 pb-6 border-b">
          {companyProfile?.companyLogo ? (
            <Avatar className="w-16 h-16">
              <AvatarImage src={companyProfile.companyLogo} />
              <AvatarFallback className="text-xl">
                {(job as { locationRepresentativeName?: string })?.locationRepresentativeName?.[0] || companyProfile.companyName?.[0] || "C"}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <span className="text-2xl font-semibold text-muted-foreground">
                {(job as { locationRepresentativeName?: string })?.locationRepresentativeName?.[0] || companyProfile?.companyName?.[0] || "C"}
              </span>
            </div>
          )}
          <div className="text-center">
            <p className="font-semibold text-xl">
              {(job as { locationRepresentativeName?: string })?.locationRepresentativeName || companyProfile?.companyName || t("company") || "Company"}
            </p>
            {(job as { locationRepresentativeName?: string })?.locationRepresentativeName && (
              <p className="text-sm text-muted-foreground mt-1">
                {companyProfile?.companyName || t("company") || "Company"}
              </p>
            )}
          </div>
        </div>

        {/* Optional Note */}
        <div className="pb-28 md:pb-4">
          <Label htmlFor="apply-message" className="text-sm font-medium">{t("messageToCompanyOptional") || "Message to Company (Optional)"}</Label>
          <Textarea
            id="apply-message"
            placeholder={t("introduceYourselfOrMentionExperience") || "Introduce yourself or mention relevant experience..."}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-2 resize-none"
            rows={4}
            data-testid="apply-message-input"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t("contactInfoWillBeRemoved") || "Contact information will be automatically removed"}
          </p>
        </div>

        {isMobile && <div className="h-24" />}
      </div>
      
      {/* Pinned Footer */}
      <div className={`flex-shrink-0 p-4 border-t bg-background ${isMobile ? 'fixed bottom-0 left-0 right-0 z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]' : ''}`}>
        <div className="flex flex-row gap-2">
          <Button
            variant="ghost"
            className="h-12 text-muted-foreground rounded-xl"
            style={{ width: '35%', flexShrink: 0 }}
            onClick={() => setStep(1)}
            data-testid="apply-sheet-back"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            {tCommon("back") || "Back"}
          </Button>
          <Button
            className="h-12 text-base font-semibold rounded-xl shadow-lg"
            style={{ width: '65%', flexShrink: 0 }}
            onClick={handleSubmit}
            disabled={isSubmitting || selectedApplicants.size === 0}
            data-testid="apply-sheet-submit"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
            ) : (
              <Send className="w-5 h-5 mr-2" />
            )}
            {t("send") || "Send"}
          </Button>
        </div>
      </div>
    </div>
  );

  const content = step === 1 ? step1Content : step2Content;
  
  if (isMobile) {
    return (
      <>
        <Drawer open={open && !showTeamSelector} onOpenChange={onOpenChange}>
          <DrawerContent className="max-h-[85vh] rounded-t-3xl">
            <DrawerTitle className="sr-only">{t("applyFor", { jobTitle: getDisplayJobTitle(job) })}</DrawerTitle>
            <DrawerDescription className="sr-only">{t("submitYourApplication")}</DrawerDescription>
            <div className="w-12 h-1.5 bg-muted rounded-full mx-auto mt-2 mb-1" />
            {content}
          </DrawerContent>
        </Drawer>
        
        <TeamMemberSelectorPopup
          open={showTeamSelector}
          onOpenChange={setShowTeamSelector}
          profile={profile}
          activeTeamMembers={activeTeamMembers}
          selectedApplicants={selectedApplicants}
          onToggleApplicant={toggleApplicant}
          workersNeeded={workersNeeded}
          isAdmin={isAdmin}
          isMobile={isMobile}
          onDone={() => setShowTeamSelector(false)}
        />
      </>
    );
  }
  
  return (
    <>
      <Dialog open={open && !showTeamSelector} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden">
          <DialogTitle className="sr-only">Apply for {getDisplayJobTitle(job)}</DialogTitle>
          <DialogDescription className="sr-only">Submit your application</DialogDescription>
          {content}
        </DialogContent>
      </Dialog>
      
      <TeamMemberSelectorPopup
        open={showTeamSelector}
        onOpenChange={setShowTeamSelector}
        profile={profile}
        activeTeamMembers={activeTeamMembers}
        selectedApplicants={selectedApplicants}
        onToggleApplicant={toggleApplicant}
        workersNeeded={workersNeeded}
        isAdmin={isAdmin}
        isMobile={isMobile}
        onDone={() => setShowTeamSelector(false)}
      />
    </>
  );
}

type MediaSlide = { type: "image" | "video" | "map" | "empty"; url?: string };

function FullPageGallerySlider({
  allMedia,
  job,
  workerLocation,
  initialIndex,
  onClose,
  t,
  tCommon,
  partialAddress,
  approximateNote,
}: {
  allMedia: MediaSlide[];
  job: Job;
  workerLocation?: { lat: number; lng: number };
  initialIndex: number;
  onClose: () => void;
  t: (key: string) => string;
  tCommon: (key: string) => string;
  partialAddress?: string | null;
  approximateNote?: string;
}) {
  const [idx, setIdx] = useState(initialIndex);
  const [imgLoaded, setImgLoaded] = useState(false);
  const slide = allMedia[idx];

  useEffect(() => {
    setIdx(initialIndex);
    setImgLoaded(false);
  }, [initialIndex]);

  useEffect(() => {
    if (slide?.type === "image") setImgLoaded(false);
  }, [idx, slide?.type]);

  return (
    <div className="relative flex flex-col w-full h-full bg-black">
      {/* Breadcrumb header: back to job + Gallery */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-black/60 border-b border-white/10 z-50">
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors flex-shrink-0"
          aria-label={tCommon("back") || "Back"}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2 text-white text-sm">
          <span className="truncate" title={getDisplayJobTitle(job)}>{getDisplayJobTitle(job)}</span>
          <ChevronRight className="w-4 h-4 flex-shrink-0 text-white/70" />
          <span className="text-white/90 flex-shrink-0">{(t("gallery") || "Gallery")}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors flex-shrink-0"
          aria-label={tCommon("close") || "Close"}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 relative flex items-center justify-center">
        {slide?.type === "image" && slide.url && (
          <>
            {!imgLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-white" />
              </div>
            )}
            <img
              src={slide.url}
              alt=""
              className={`max-w-full max-h-full w-auto h-auto object-contain transition-opacity ${imgLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setImgLoaded(true)}
            />
          </>
        )}
        {slide?.type === "video" && slide.url && (
          <video src={slide.url} className="max-w-full max-h-full object-contain" controls preload="auto" />
        )}
        {slide?.type === "map" && job.latitude && job.longitude && (
          <div className="w-full h-full min-h-0">
            <JobLocationMap
              job={{ id: job.id, lat: parseFloat(job.latitude), lng: parseFloat(job.longitude), title: getDisplayJobTitle(job) }}
              height="100%"
              className="h-full w-full rounded-none overflow-hidden"
              showApproximateRadius
              pinAndRadiusOnly
              approximateRadiusMeters={1200}
            />
          </div>
        )}
        {slide?.type === "empty" && (
          <div className="flex flex-col items-center justify-center gap-2 text-white/70">
            <MapPin className="w-12 h-12 opacity-50" />
            <p className="text-sm">{t("noGallery")}</p>
            <p className="text-xs">{t("addressNotProvided")}</p>
          </div>
        )}
      </div>
      {allMedia.length > 1 && (
        <>
          <button
            onClick={() => setIdx((i) => (i > 0 ? i - 1 : allMedia.length - 1))}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white z-40"
            aria-label="Previous"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={() => setIdx((i) => (i < allMedia.length - 1 ? i + 1 : 0))}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white z-40"
            aria-label="Next"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-40">
            {allMedia.map((_, i) => (
              <button
                key={i}
                onClick={() => { setImgLoaded(false); setIdx(i); }}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${i === idx ? "bg-white" : "bg-white/50"}`}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/50 px-2 py-1 rounded text-white text-sm z-40">
            {slide?.type === "video" ? <Play className="w-4 h-4" /> : slide?.type === "map" ? <MapPin className="w-4 h-4" /> : slide?.type === "empty" ? null : <ImageIcon className="w-4 h-4" />}
            {idx + 1} / {allMedia.length}
          </div>
        </>
      )}
    </div>
  );
}

export function JobContent({
  job,
  profile,
  activeTeamMembers,
  workerLocation,
  onOpenApply,
  onDismiss,
  onClose,
  isMobile,
  inlineApplyMode = false,
  onApplySuccess,
  showParticipantsSection = true,
  initialApplyStage,
  application,
  groupedApplications,
  onWithdraw,
  onWithdrawAll,
  isWithdrawing = false,
  onAssignTeamMember,
  onGetDirections,
  operatorAvatarUrl,
  territoryRadiusMiles,
}: {
  job: Job;
  profile: Profile | null;
  activeTeamMembers: TeamMemberBasic[];
  workerLocation?: { lat: number; lng: number } | null;
  onOpenApply: (job: Job) => void;
  onDismiss?: (job: Job) => void;
  onClose: () => void;
  isMobile: boolean;
  inlineApplyMode?: boolean;
  onApplySuccess?: () => void;
  /** When false, hides the "Participants / Company seeking" block (slots, legend, pill grid). */
  showParticipantsSection?: boolean;
  /** When 3, open apply at message step (step 3) with self selected. Used from calendar "Add to route". */
  initialApplyStage?: 1 | 2 | 3;
  /** When set, show application view: same content as job details with status badge, application payout, and Withdraw footer. */
  application?: ApplicationData | null;
  groupedApplications?: GroupedApplications | null;
  onWithdraw?: (applicationId: number) => void;
  onWithdrawAll?: (applicationIds: number[]) => void;
  isWithdrawing?: boolean;
  onAssignTeamMember?: (applicationId: number, teamMemberId: number | null) => void;
  onGetDirections?: (job: Job) => void;
  operatorAvatarUrl?: string | null;
  territoryRadiusMiles?: number;
}) {
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showJobTypeInfo, setShowJobTypeInfo] = useState(false);
  const [showSkillInfo, setShowSkillInfo] = useState<string | null>(null);
  const [showDriveTime, setShowDriveTime] = useState(false);
  const [showFullPageGallery, setShowFullPageGallery] = useState(false);
  const [fullPageGalleryStartIndex, setFullPageGalleryStartIndex] = useState(0);
  const [showInlineApply, setShowInlineApply] = useState(false);
  const [inlineApplyStage, setInlineApplyStage] = useState<1 | 2 | 3>(1); // 1 = details, 2 = participants, 3 = message
  const [applyMessage, setApplyMessage] = useState("");
  const [selectedApplicants, setSelectedApplicants] = useState<Set<number | "self">>(() => new Set<number | "self">(["self"]));

  // When opening from calendar "Add to route", jump to step 3 (message) with self selected
  useEffect(() => {
    if (initialApplyStage === 3) {
      setShowInlineApply(true);
      setInlineApplyStage(3);
      setSelectedApplicants(new Set<number | "self">(["self"]));
    }
  }, [initialApplyStage]);
  const [useSmartRateInline, setUseSmartRateInline] = useState(true);
  const [customInlineRate, setCustomInlineRate] = useState<number | null>(null);
  const [rateEditorOpen, setRateEditorOpen] = useState(false);
  const [rateEditorDraft, setRateEditorDraft] = useState("");
  const [smartApplyRateEnabledMain] = usePersistentFilter<boolean>("smart_apply_rate_enabled", true);
  useEffect(() => {
    if (job?.id) setUseSmartRateInline(true); // default to suggested rate when opening a job
  }, [job?.id]);

  useEffect(() => {
    setCustomInlineRate(null);
    setRateEditorOpen(false);
    setRateEditorDraft("");
  }, [job?.id]);

  const [showTeamSelector, setShowTeamSelector] = useState(false);
  const [showCompanyJobsPopup, setShowCompanyJobsPopup] = useState(false);
  const [companyJobsTab, setCompanyJobsTab] = useState<"open" | "closed">("open");
  const [teammateSettingsOpen, setTeammateSettingsOpen] = useState(false);
  const [selectedTeammateForSettings, setSelectedTeammateForSettings] = useState<TeamMemberBasic | null>(null);
  const [settingsSection, setSettingsSection] = useState<"list" | "edit">("list");
  const [showApplicationTeamPicker, setShowApplicationTeamPicker] = useState(false);
  const [selectedAppForReassign, setSelectedAppForReassign] = useState<ApplicationData | null>(null);
  const [showWithdrawStep, setShowWithdrawStep] = useState(false);
  const [withdrawStep, setWithdrawStep] = useState<"reason" | "confirm">("reason");
  const [withdrawReason, setWithdrawReason] = useState<string | null>(null);
  /** On mobile, footer payout/details block is collapsed by default; tap to expand. */
  const [mobileFooterDetailsExpanded, setMobileFooterDetailsExpanded] = useState(false);
  const [materialInvoiceOpen, setMaterialInvoiceOpen] = useState(false);
  const [firstApplicantRandomRate, setFirstApplicantRandomRate] = useState<number | null>(null);
  const { t } = useTranslation("enhancedJobDialog");
  const [, setLocation] = useLocation();

  const { data: applicationRateStats } = useQuery<{ applicationCount: number; minProposedRateCents: number | null; maxProposedRateCents: number | null }>({
    queryKey: ["/api/jobs", job.id, "application-rate-stats"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${job.id}/application-rate-stats`, { credentials: "include" });
      if (!res.ok) return { applicationCount: 0, minProposedRateCents: null, maxProposedRateCents: null };
      return res.json();
    },
    enabled: !!job.id,
  });

  // Reset settings state when dialog closes
  useEffect(() => {
    if (!teammateSettingsOpen) {
      setSelectedTeammateForSettings(null);
      setSettingsSection("list");
    }
  }, [teammateSettingsOpen]);

  useEffect(() => {
    if (job?.id) setFirstApplicantRandomRate(null);
  }, [job?.id]);
  useEffect(() => {
    if (applicationRateStats?.applicationCount === 0 && firstApplicantRandomRate === null && job?.id) {
      const rate = Math.round((18 + Math.random() * 10) * 100) / 100;
      setFirstApplicantRandomRate(Math.min(28, Math.max(18, rate)));
    }
  }, [applicationRateStats?.applicationCount, job?.id, firstApplicantRandomRate]);
  const { t: tCommon } = useTranslation("common");
  const { t: tCal } = useTranslation("calendar");
  const { toast } = useToast();
  
  const jobTypeInfo = getJobTypeInfo(job, t);
  const workersNeeded = job.maxWorkersNeeded ?? 1;
  /** Teammates who have accepted their role (minimum for apply / Today avatars). */
  const acceptedTeamMembers = useMemo(
    () => (activeTeamMembers || []).filter((m) => m.status === "active"),
    [activeTeamMembers]
  );

  /** Canonical order for participant slots: self first, then accepted teammates by id. */
  const slotOrder = useMemo(
    () => ["self" as const, ...acceptedTeamMembers.map((m) => m.id).sort((a, b) => a - b)],
    [acceptedTeamMembers]
  );

  const allMedia = useMemo(() => {
    const media: { type: "image" | "video" | "map" | "empty"; url?: string }[] = [];
    if (job.images && Array.isArray(job.images)) {
      job.images.forEach(url => media.push({ type: "image", url }));
    }
    if (job.videos && Array.isArray(job.videos)) {
      job.videos.forEach(url => media.push({ type: "video", url }));
    }
    const hasMap = (job.latitude && job.longitude) || (job as any).mapThumbnailUrl;
    if (media.length > 0 && hasMap) {
      media.push({ type: "map" });
    }
    // No media: add map as single gallery slide if coords or cached thumbnail exist, else empty slide
    if (media.length === 0) {
      if (hasMap) {
        media.push({ type: "map" });
      } else {
        media.push({ type: "empty" });
      }
    }
    return media;
  }, [job.images, job.videos, job.latitude, job.longitude, (job as any).mapThumbnailUrl]);
  
  const distance = useMemo(() => {
    if (!workerLocation?.lat || !workerLocation?.lng || !job.latitude || !job.longitude) return null;
    return calculateDistance(workerLocation.lat, workerLocation.lng, parseFloat(job.latitude), parseFloat(job.longitude));
  }, [workerLocation, job.latitude, job.longitude]);

  /** Partial address (no street numbers) for map until they win the gig. */
  const partialAddress = useMemo(() => {
    const streetWithoutNumber = (job.address || "").replace(/^\d+\s*[-/]?\s*\d*\s*/, "").trim();
    const parts = [streetWithoutNumber, job.city, job.state, job.zipCode].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }, [job.address, job.city, job.state, job.zipCode]);

  /** Full address for display when application is accepted; otherwise partial. */
  const displayAddress = useMemo(() => {
    if (application?.status === "accepted") {
      const full = [job.address, job.city, job.state, job.zipCode].filter(Boolean).join(", ");
      return full || partialAddress || null;
    }
    return partialAddress;
  }, [application?.status, job.address, job.city, job.state, job.zipCode, partialAddress]);

  /** Origins for drive time: worker + teammates with coords. id = "self" | member id for per-card lookup. */
  const driveTimeOrigins = useMemo(() => {
    const origins: { id: "self" | number; lat: number; lng: number; name: string }[] = [];
    if (workerLocation?.lat != null && workerLocation?.lng != null) {
      origins.push({ id: "self", ...workerLocation, name: t("you") || "You" });
    }
    (activeTeamMembers || []).forEach((m) => {
      const lat = m.latitude != null ? parseFloat(String(m.latitude)) : NaN;
      const lng = m.longitude != null ? parseFloat(String(m.longitude)) : NaN;
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
        origins.push({ id: m.id, lat, lng, name: `${m.firstName} ${m.lastName}`.trim() || `Team ${m.id}` });
      }
    });
    return origins;
  }, [workerLocation, activeTeamMembers, t]);

  /** Person locations for "Where you'll be" map: worker + teammates as avatar pins with distance. */
  const personLocationsForMap = useMemo(() => {
    const list: { id: number | string; lat: number; lng: number; name: string; avatarUrl?: string | null; type: "worker" | "teammate" }[] = [];
    if (workerLocation?.lat != null && workerLocation?.lng != null) {
      list.push({
        id: "self",
        lat: workerLocation.lat,
        lng: workerLocation.lng,
        name: t("you") || "You",
        avatarUrl: normalizeAvatarUrl((profile as any)?.avatarUrl) ?? undefined,
        type: "worker",
      });
    } else if (profile && (profile as any).latitude != null && (profile as any).longitude != null) {
      const lat = parseFloat(String((profile as any).latitude));
      const lng = parseFloat(String((profile as any).longitude));
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
        list.push({
          id: "self",
          lat,
          lng,
          name: t("you") || "You",
          avatarUrl: normalizeAvatarUrl((profile as any)?.avatarUrl) ?? undefined,
          type: "worker",
        });
      }
    }
    (activeTeamMembers || []).forEach((m) => {
      const lat = m.latitude != null ? parseFloat(String(m.latitude)) : NaN;
      const lng = m.longitude != null ? parseFloat(String(m.longitude)) : NaN;
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
        list.push({
          id: m.id,
          lat,
          lng,
          name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || `Team ${m.id}`,
          avatarUrl: normalizeAvatarUrl(m.avatarUrl) ?? undefined,
          type: "teammate",
        });
      }
    });
    return list;
  }, [workerLocation, profile, activeTeamMembers, t]);

  const [closestDriveTime, setClosestDriveTime] = useState<{ duration: string; name: string } | null>(null);
  const [closestDriveTimeLoading, setClosestDriveTimeLoading] = useState(false);
  const [driveTimeByKey, setDriveTimeByKey] = useState<Record<string, { duration: string }>>({});
  useEffect(() => {
    if (!job.latitude || !job.longitude || driveTimeOrigins.length === 0) {
      setClosestDriveTime(null);
      setClosestDriveTimeLoading(false);
      setDriveTimeByKey({});
      return;
    }
    const destLat = parseFloat(String(job.latitude));
    const destLng = parseFloat(String(job.longitude));
    let cancelled = false;
    setClosestDriveTimeLoading(true);
    setClosestDriveTime(null);
    setDriveTimeByKey({});
    Promise.all(
      driveTimeOrigins.map(async (o) => {
        try {
          const r = await fetch("/api/maps/drive-time", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              originLat: o.lat,
              originLng: o.lng,
              destLat,
              destLng,
            }),
          });
          if (!r.ok) return null;
          const d = await r.json();
          return { id: o.id, duration: d.duration || "", durationValue: d.durationValue ?? 0, name: o.name };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const valid = results.filter((r): r is NonNullable<typeof r> => r != null);
      const byKey: Record<string, { duration: string }> = {};
      valid.forEach((r) => { byKey[String(r.id)] = { duration: r.duration }; });
      setDriveTimeByKey(byKey);
      if (valid.length === 0) {
        setClosestDriveTime(null);
      } else {
        const best = valid.reduce((a, b) => (a.durationValue <= b.durationValue ? a : b));
        setClosestDriveTime({ duration: best.duration, name: best.name });
      }
      setClosestDriveTimeLoading(false);
    });
    return () => { cancelled = true; };
  }, [job.latitude, job.longitude, driveTimeOrigins]);
  
  const payoutBreakdown = useMemo(() => getPayoutBreakdownFromJob(job), [job.startDate, job.endDate, job.estimatedHours, job.jobType, job.recurringWeeks, job.scheduleDays]);

  // Use same rate logic as WorkerDashboard jobPins so map pill and panel show the same payout
  const estimatedPayout = useMemo(() => {
    const hours = payoutBreakdown.totalHours;
    const selfRateDollars = getWorkerHourlyRate(profile?.hourlyRate ?? undefined, job.hourlyRate ?? 0);
    const selfRate = selfRateDollars > 0 ? selfRateDollars : 30; // fallback so panel never shows $0
    if (selectedApplicants.size > 0) {
      let totalPayout = 0;
      selectedApplicants.forEach(id => {
        if (id === "self") {
          totalPayout += selfRate * hours;
        } else {
          const member = activeTeamMembers.find(m => m.id === id);
          const rate = member ? (rateToDollars(member.hourlyRate) || 30) : 30;
          totalPayout += rate * hours;
        }
      });
      return totalPayout;
    }
    return selfRate * hours;
  }, [profile?.hourlyRate, job.hourlyRate, selectedApplicants, activeTeamMembers, payoutBreakdown.totalHours]);

  // Application view: combined payout and status badge. Always use proposedRate (applied rate) so reassigning worker does not change displayed rate.
  const allApps = application && groupedApplications ? groupedApplications.applications : application ? [application] : [];
  const applicationCombinedPayout = useMemo(() => {
    if (!application || allApps.length === 0) return null;
    const hours = payoutBreakdown.totalHours;
    return allApps.reduce((total, app) => {
      // Use only submitted proposedRate so swapping teammates never changes displayed payout
      const rateDollars = rateToDollars(app.proposedRate ?? profile?.hourlyRate ?? (job.hourlyRate ? job.hourlyRate / 100 : 0));
      return total + (rateDollars * hours);
    }, 0);
  }, [application, allApps, job.hourlyRate, profile?.hourlyRate, payoutBreakdown.totalHours]);
  const displayPayout = applicationCombinedPayout != null ? applicationCombinedPayout : estimatedPayout;
  const getApplicationStatusBadge = useCallback(() => {
    if (!application) return null;
    switch (application.status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800">{t("pendingReview")}</Badge>;
      case "accepted":
        return <Badge variant="outline" className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800">{t("accepted")}</Badge>;
      case "rejected":
        return <Badge variant="outline" className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800">{t("notSelected")}</Badge>;
      default:
        return null;
    }
  }, [application, t]);

  // Timesheets for accepted application (used in JobContent when application.status === 'accepted')
  const { data: timesheets = [], isLoading: timesheetsLoading } = useQuery<Timesheet[]>({
    queryKey: ['/api/timesheets/job', job.id],
    queryFn: async () => {
      const res = await fetch(`/api/timesheets/job/${job.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!application && application.status === "accepted",
  });
  const timesheetSummary = useMemo(() => {
    if (!timesheets.length) return null;
    let totalHours = 0;
    let totalPayout = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let paidCount = 0;
    let processingCount = 0;
    timesheets.forEach(ts => {
      const hours = parseFloat(ts.adjustedHours || ts.totalHours || "0");
      const rateInDollars = (ts.hourlyRate || 0) / 100;
      totalHours += hours;
      totalPayout += hours * rateInDollars;
      if (ts.paymentStatus === "completed") paidCount++;
      else if (ts.paymentStatus === "processing") processingCount++;
      else if (ts.status === "approved") approvedCount++;
      else pendingCount++;
    });
    return { totalHours: totalHours.toFixed(2), totalPayout: totalPayout.toFixed(2), pendingCount, approvedCount, paidCount, processingCount, totalCount: timesheets.length };
  }, [timesheets]);
  const getPaymentStatusBadge = useCallback((ts: Timesheet) => {
    if (ts.paymentStatus === "completed") return <Badge variant="outline" className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"><CheckCircle2 className="w-3 h-3 mr-1" /> {t("paid")}</Badge>;
    if (ts.paymentStatus === "processing") return <Badge variant="outline" className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> {t("transferring")}</Badge>;
    if (ts.status === "approved") return <Badge variant="outline" className="bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800"><Check className="w-3 h-3 mr-1" /> {t("submitted")}</Badge>;
    if (ts.status === "pending" && ts.clockOutTime) return <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800"><Clock className="w-3 h-3 mr-1" /> {t("pendingApproval")}</Badge>;
    return <Badge variant="outline" className="bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800"><Clock className="w-3 h-3 mr-1" /> {t("inProgress")}</Badge>;
  }, [t]);

  useEffect(() => {
    setImageLoaded(false);
    setCurrentMediaIndex(0);
    setShowInlineApply(false);
    setInlineApplyStage(1); // Reset to step 1 (job details)
    setApplyMessage("");
    setSelectedApplicants(new Set<number | "self">(["self"]));
    setUseSmartRateInline(false);
    setCustomInlineRate(null);
    setRateEditorOpen(false);
    setRateEditorDraft("");
    setShowApplicationTeamPicker(false);
    setSelectedAppForReassign(null);
  }, [job.id]);

  const canApplyMultiple = workersNeeded > 1 && activeTeamMembers.length > 0;
  const isAdmin = (profile as any)?.isBusinessOperator === true;

  // Suggested rate: first applicant = random $18–$28; otherwise competitive vs other applications
  const smartRateSuggestionInline = useMemo(() => {
    const applicationCount = applicationRateStats?.applicationCount ?? 0;
    const minCents = applicationRateStats?.minProposedRateCents ?? null;

    if (applicationCount === 0) {
      if (firstApplicantRandomRate != null) return firstApplicantRandomRate;
      const seed = job.id;
      const fallback = 18 + (seed % 11) + (seed % 10) / 10;
      return Math.round(Math.min(28, Math.max(18, fallback)) * 100) / 100;
    }

    if (minCents != null && minCents > 0) {
      const minDollars = minCents / 100;
      const competitiveRate = Math.max(18, Math.min(28, minDollars - 1));
      return Math.round(competitiveRate * 100) / 100;
    }

    const userRate = profile?.hourlyRate || 30;
    const jobRate = job.hourlyRate ? job.hourlyRate / 100 : null;
    const tradePremiums: Record<string, number> = {
      Electrical: 1.15, Plumbing: 1.12, HVAC: 1.10, Carpentry: 1.08, Concrete: 1.05,
      Drywall: 1.03, Painting: 1.02, "General Labor": 1.0, Demolition: 1.0, Cleaning: 0.95,
    };
    const skillLevelMultipliers: Record<string, number> = { elite: 1.12, lite: 1.05, any: 1.0 };
    let baseRate = jobRate ? jobRate * 0.88 : userRate * 0.85;
    baseRate *= tradePremiums[job.trade || "General Labor"] || 1.0;
    baseRate *= skillLevelMultipliers[job.skillLevel || "any"] || 1.0;
    if (job.serviceCategory?.includes("Elite")) baseRate *= 1.10;
    else if (job.serviceCategory?.includes("Lite")) baseRate *= 1.04;
    const requiredSkillsCount = job.requiredSkills?.length || 0;
    if (requiredSkillsCount > 0) baseRate *= 1 + Math.min(requiredSkillsCount, 5) * 0.01;
    let finalRate = Math.max(18, Math.min(28, Math.round(baseRate * 100) / 100));
    if (finalRate > userRate && jobRate != null && jobRate <= userRate) finalRate = Math.min(finalRate, userRate * 0.98);
    return finalRate;
  }, [job.id, job.hourlyRate, job.trade, job.skillLevel, job.serviceCategory, job.requiredSkills, profile?.hourlyRate, applicationRateStats, firstApplicantRandomRate]);

  const combinedApplyPayout = useMemo(() => {
    const hours = payoutBreakdown.totalHours;
    if (customInlineRate != null && customInlineRate > 0) {
      const workerCount = selectedApplicants.size > 0 ? selectedApplicants.size : 1;
      return customInlineRate * hours * workerCount;
    }
    let totalPayout = 0;
    selectedApplicants.forEach(id => {
      if (id === "self") {
        const rate = useSmartRateInline ? smartRateSuggestionInline : (rateToDollars(profile?.hourlyRate) || 30);
        totalPayout += rate * hours;
      } else {
        const member = activeTeamMembers.find(m => m.id === id);
        const rate = useSmartRateInline ? smartRateSuggestionInline : (rateToDollars(member?.hourlyRate) || 30);
        totalPayout += rate * hours;
      }
    });
    return totalPayout;
  }, [selectedApplicants, profile?.hourlyRate, activeTeamMembers, payoutBreakdown.totalHours, useSmartRateInline, smartRateSuggestionInline, customInlineRate]);

  // Calculate selected rate for display in footer
  const getSelectedRateInline = useMemo(() => {
    if (selectedApplicants.size === 0) return null;
    if (customInlineRate != null && customInlineRate > 0) return customInlineRate;
    
    if (useSmartRateInline) {
      return smartRateSuggestionInline;
    }
    
    let totalRate = 0;
    let count = 0;
    
    selectedApplicants.forEach(id => {
      if (id === "self") {
        totalRate += rateToDollars(profile?.hourlyRate) || 30;
        count++;
      } else {
        const member = activeTeamMembers.find(m => m.id === id);
        totalRate += rateToDollars(member?.hourlyRate) || 30;
        count++;
      }
    });
    
    return count > 0 ? totalRate / count : null;
  }, [selectedApplicants, useSmartRateInline, smartRateSuggestionInline, profile?.hourlyRate, activeTeamMembers, customInlineRate]);

  const livePreSubmitPayout = !application
    ? (selectedApplicants.size > 0 ? combinedApplyPayout : displayPayout)
    : displayPayout;

  const randomizedInlineApplyTemplates = useMemo(() => {
    const firstName = profile?.firstName?.trim() || "I";
    const companyLabel = (job as { locationRepresentativeName?: string })?.locationRepresentativeName || "team";
    const tradeLabel = (job.trade || job.serviceCategory || "general labor").toLowerCase();
    const roleLabel = tradeLabel.includes("labor") ? "worker" : tradeLabel;
    const timeInfoForTemplate = formatJobTime(job, t);
    const timeLabel = timeInfoForTemplate.scheduleDaysDisplay
      ? `${timeInfoForTemplate.scheduleDaysDisplay}${timeInfoForTemplate.timeRange ? `, ${timeInfoForTemplate.timeRange}` : ""}`
      : `${timeInfoForTemplate.relative}${timeInfoForTemplate.timeRange ? `, ${timeInfoForTemplate.timeRange}` : ""}`;
    const locationLabel = [job.city, job.state].filter(Boolean).join(", ") || "the project location";
    const skillLabel = (job.requiredSkills?.slice(0, 2).join(" and ") || job.trade || "the listed scope").toLowerCase();
    return buildInlineApplyMessageTemplates({
      firstName,
      roleLabel,
      companyLabel,
      tradeLabel,
      timeLabel,
      locationLabel,
      skillLabel,
    });
  }, [profile?.firstName, job, t]);

  // Step 3 auto-template: pick one of 40 randomized messages when message box is empty.
  useEffect(() => {
    if (!showInlineApply || inlineApplyStage !== 3) return;
    if (applyMessage.trim().length > 0) return;
    if (randomizedInlineApplyTemplates.length === 0) return;
    const idx = Math.floor(Math.random() * randomizedInlineApplyTemplates.length);
    setApplyMessage(randomizedInlineApplyTemplates[idx]);
  }, [showInlineApply, inlineApplyStage, applyMessage, randomizedInlineApplyTemplates]);

  // Fetch company profile for stage 2 (inline apply) and for "Meet the company" section
  const { data: companyProfileInline } = useQuery<Profile | null>({
    queryKey: ["/api/profiles", job.companyId],
    queryFn: async () => {
      if (!job.companyId) return null;
      const res = await fetch(`/api/profiles/${job.companyId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: (inlineApplyStage === 3 && showInlineApply) || !!job.companyId,
  });
  const { data: companyJobsCount } = useQuery<{ count: number }>({
    queryKey: ["/api/profiles", job.companyId, "jobs-count"],
    queryFn: async () => {
      if (!job.companyId) return { count: 0 };
      const res = await fetch(`/api/profiles/${job.companyId}/jobs-count`);
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    enabled: !!job.companyId,
  });
  const { data: companyLocationsCount } = useQuery<{ count: number }>({
    queryKey: ["/api/profiles", job.companyId, "locations-count"],
    queryFn: async () => {
      if (!job.companyId) return { count: 0 };
      const res = await fetch(`/api/profiles/${job.companyId}/locations-count`);
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    enabled: !!job.companyId,
  });
  const { data: companyJobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs/company", job.companyId],
    queryFn: async () => {
      if (!job.companyId) return [];
      const res = await fetch(`/api/jobs?companyId=${job.companyId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showCompanyJobsPopup && !!job.companyId,
  });
  const { data: allApplicationsForAvailability = [] } = useQuery<any[]>({
    queryKey: ["/api/applications/worker", profile?.id, "all"],
    queryFn: async () => {
      if (!profile?.id) return [];
      const res = await fetch(`/api/applications/worker/${profile.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!profile?.id && (activeTeamMembers.length > 0 || !!profile),
  });
  const jobStart = useMemo(() => (job.startDate ? new Date(job.startDate) : null), [job.startDate]);
  const jobEnd = useMemo(() => {
    if (!jobStart) return null;
    if (job.endDate) return new Date(job.endDate);
    return addHours(jobStart, job.estimatedHours ?? 8);
  }, [jobStart, job.endDate, job.estimatedHours]);
  const scheduledJobsAndConflicts = useMemo(() => {
    if (!jobStart) return { scheduled: [], conflicts: [] };
    const accepted = allApplicationsForAvailability.filter((a: any) => a.status === "accepted");
    const scheduled = accepted
      .filter((a: any) => a.job?.startDate && isSameDay(new Date(a.job.startDate), jobStart))
      .map((a: any) => {
        const start = new Date(a.job.startDate);
        const end = a.job.endDate ? new Date(a.job.endDate) : addHours(start, a.job.estimatedHours || 8);
        return { id: a.job.id, title: a.job.title, trade: a.job.trade, start, end };
      });
    const conflicts = jobEnd ? scheduled.filter((ev) => ev.start < jobEnd && ev.end > jobStart) : [];
    return { scheduled, conflicts };
  }, [jobStart, jobEnd, allApplicationsForAvailability]);

  const jobLatLng = useMemo(() => {
    const lat = job.latitude != null ? parseFloat(String(job.latitude)) : NaN;
    const lng = job.longitude != null ? parseFloat(String(job.longitude)) : NaN;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [job.latitude, job.longitude]);

  // Fallback: when job has no lat/lng but has full address, geocode so territory checks can use it
  const [geocodedJobLatLng, setGeocodedJobLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const jobAddressKey = [job.id, (job as any).address, (job as any).city, (job as any).state, (job as any).zipCode].filter(Boolean).join("|");
  useEffect(() => {
    if (jobLatLng) {
      setGeocodedJobLatLng(null);
      return;
    }
    const parts = [(job as any).address, (job as any).city, (job as any).state, (job as any).zipCode].filter(Boolean);
    if (parts.length === 0) {
      setGeocodedJobLatLng(null);
      return;
    }
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (!apiKey) return;
    const addressQuery = parts.join(", ");
    let cancelled = false;
    fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressQuery)}&key=${apiKey}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const loc = data.results?.[0]?.geometry?.location;
        if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
          setGeocodedJobLatLng({ lat: loc.lat, lng: loc.lng });
        } else {
          setGeocodedJobLatLng(null);
        }
      })
      .catch(() => {
        if (!cancelled) setGeocodedJobLatLng(null);
      });
    return () => { cancelled = true; };
  }, [jobAddressKey, jobLatLng]);

  const jobLatLngOrGeocoded = jobLatLng ?? geocodedJobLatLng;

  const orderedTeammatesForScroll = useMemo(() => {
    const accepted = allApplicationsForAvailability.filter((a: any) => a.status === "accepted");
    const selfApps = accepted.filter((a: any) => !a.teamMember?.id);
    const byMember: Record<number, any[]> = {};
    acceptedTeamMembers.forEach(m => {
      byMember[m.id] = accepted.filter((a: any) => a.teamMember?.id === m.id);
    });
    const hasConflict = (apps: any[]) => {
      if (!jobStart || !jobEnd) return false;
      return apps.some((a: any) => {
        if (!a.job?.startDate) return false;
        const start = new Date(a.job.startDate);
        const end = a.job.endDate ? new Date(a.job.endDate) : addHours(start, a.job.estimatedHours || 8);
        return start < jobEnd && end > jobStart && isSameDay(start, jobStart);
      });
    };
    const selfConflict = hasConflict(selfApps);
    const list: { p: typeof profile | TeamMemberBasic; skillMatch: boolean; available: boolean; inTerritory: boolean }[] = [];
    const radiusMiles = territoryRadiusMiles ?? DEFAULT_JOB_TERRITORY_RADIUS_MILES;
    const inTerritoryFor = (lat: number | null, lng: number | null) => {
      if (!jobLatLngOrGeocoded) return true; // no job coordinates → don't mark as outside territory
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false; // unknown worker location → not within job location
      return calculateDistance(jobLatLngOrGeocoded.lat, jobLatLngOrGeocoded.lng, lat, lng) <= radiusMiles;
    };
    if (profile) {
      const sm = checkSkillMatchForJob((profile as any)?.skillsets, job);
      const selfLat = workerLocation?.lat ?? ((profile as any)?.latitude != null ? parseFloat(String((profile as any).latitude)) : null);
      const selfLng = workerLocation?.lng ?? ((profile as any)?.longitude != null ? parseFloat(String((profile as any).longitude)) : null);
      const inT = inTerritoryFor(selfLat, selfLng);
      list.push({ p: profile, skillMatch: sm, available: !selfConflict, inTerritory: inT });
    }
    acceptedTeamMembers.forEach(m => {
      const sm = checkSkillMatchForJob(m.skillsets, job);
      const av = !hasConflict(byMember[m.id] || []);
      const mlat = (m as any).latitude != null ? parseFloat(String((m as any).latitude)) : null;
      const mlng = (m as any).longitude != null ? parseFloat(String((m as any).longitude)) : null;
      const inT = inTerritoryFor(mlat, mlng);
      list.push({ p: m, skillMatch: sm, available: av, inTerritory: inT });
    });
    const score = (x: { skillMatch: boolean; available: boolean; inTerritory: boolean }) =>
      (x.inTerritory ? 4 : 0) + (x.skillMatch ? 2 : 0) + (x.available ? 1 : 0);
    list.sort((a, b) => score(b) - score(a));
    return list;
  }, [profile, acceptedTeamMembers, job, jobLatLngOrGeocoded, workerLocation, allApplicationsForAvailability, jobStart, jobEnd, territoryRadiusMiles]);

  // When worker has no approved teammates, auto-select self in participants
  useEffect(() => {
    if (acceptedTeamMembers.length === 0 && selectedApplicants.size === 0) {
      setSelectedApplicants(new Set(["self"]));
    }
  }, [acceptedTeamMembers.length, selectedApplicants.size]);

  // Auto-fill participants when job/panel opens: only in-territory people (and self if needed); do not auto-select teammates outside job location
  useEffect(() => {
    if (!job?.id || workersNeeded < 1) return;
    const withKey = orderedTeammatesForScroll.map(({ p, inTerritory }) => ({
      key: profile && p === profile ? "self" as const : (p as TeamMemberBasic).id,
      inTerritory,
    }));
    const keysToFill: (number | "self")[] = [];
    withKey.filter((x) => x.inTerritory).forEach((x) => { if (keysToFill.length < workersNeeded) keysToFill.push(x.key); });
    if (keysToFill.length < workersNeeded && !keysToFill.includes("self")) {
      keysToFill.push("self");
    }
    if (keysToFill.length > 0) {
      setSelectedApplicants(new Set(keysToFill));
    }
  }, [job?.id]);

  const scheduledByMember = useMemo(() => {
    if (!jobStart || !jobEnd)
      return {} as Record<
        number | "self",
        { scheduled: { id: number; title: string; trade: string; start: Date; end: Date }[]; conflicts: { id: number }[] }
      >;
    const accepted = allApplicationsForAvailability.filter((a: any) => a.status === "accepted");
    const selfApps = accepted.filter((a: any) => !a.teamMember?.id);
    const byMember: Record<number, any[]> = { };
    activeTeamMembers.forEach(m => { byMember[m.id] = accepted.filter((a: any) => a.teamMember?.id === m.id); });
    const toScheduled = (apps: any[]) =>
      apps
        .filter((a: any) => a.job?.startDate && isSameDay(new Date(a.job.startDate), jobStart))
        .map((a: any) => {
          const start = new Date(a.job.startDate);
          const end = a.job.endDate ? new Date(a.job.endDate) : addHours(start, a.job.estimatedHours || 8);
          return { id: a.job.id, title: a.job.title, trade: a.job.trade, start, end };
        });
    const out: Record<
      number | "self",
      { scheduled: { id: number; title: string; trade: string; start: Date; end: Date }[]; conflicts: { id: number }[] }
    > = {} as any;
    const selfSched = toScheduled(selfApps);
    out["self"] = { scheduled: selfSched, conflicts: jobEnd ? selfSched.filter((ev) => ev.start < jobEnd! && ev.end > jobStart!) : [] };
    acceptedTeamMembers.forEach(m => {
      const sched = toScheduled(byMember[m.id] || []);
      out[m.id] = { scheduled: sched, conflicts: jobEnd ? sched.filter((ev) => ev.start < jobEnd! && ev.end > jobStart!) : [] };
    });
    return out;
  }, [jobStart, jobEnd, allApplicationsForAvailability, acceptedTeamMembers]);

  const { availableWorkers, conflictWorkers } = useMemo(() => {
    type Row = { key: "self" | number; p: TeamMemberBasic | Profile; skillMatch: boolean; available: boolean; inTerritory: boolean; matchingSkills: string[] };
    const rows: Row[] = orderedTeammatesForScroll.map(({ p, skillMatch, available, inTerritory }) => {
      const skills = (p as any).skillsets ?? (p as any).serviceCategories ?? [];
      return {
        key: profile && p === profile ? "self" : (p as TeamMemberBasic).id,
        p,
        skillMatch,
        available,
        inTerritory,
        matchingSkills: getMatchingSkillsForJob(Array.isArray(skills) ? skills : [], job),
      };
    });
    const available = rows.filter((r) => r.available);
    const conflict = rows.filter((r) => !r.available);
    return { availableWorkers: available, conflictWorkers: conflict };
  }, [orderedTeammatesForScroll, job, profile]);

  const [stage, setStage] = useState<1 | 2>(1);
  const [popupView, setPopupView] = useState<"details" | "cancellation" | "insurance" | "id" | "w9" | "report" | "calendar" | "teammate" | "map">("details");
  const [selectedTeammateForPopup, setSelectedTeammateForPopup] = useState<{ p: TeamMemberBasic | Profile | null; skillMatch: boolean; available: boolean } | null>(null);
  useEffect(() => {
    setPopupView("details");
    setStage(1);
    setSelectedTeammateForPopup(null);
  }, [job.id]);

  const onApplyFromCalendar = useCallback((teamMemberId: number | "self") => {
    setPopupView("details");
    if (inlineApplyMode) {
      if (teamMemberId === "self") {
        setSelectedApplicants(new Set<number | "self">(["self"]));
      } else {
        setSelectedApplicants(new Set<number | "self">([teamMemberId]));
      }
      setStage(2);
      setShowInlineApply(true);
    } else {
      onClose();
      onOpenApply(job);
    }
  }, [inlineApplyMode, job, onClose, onOpenApply]);
  const toggleApplicant = useCallback((id: number | "self") => {
    setSelectedApplicants(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        if (newSet.size > 1) {
          newSet.delete(id);
        }
      } else {
        if (newSet.size < workersNeeded) {
          newSet.add(id);
        }
      }
      return newSet;
    });
  }, [workersNeeded]);

  const getSelectedNames = () => {
    const names: string[] = [];
    if (selectedApplicants.has("self")) {
      names.push("Myself");
    }
    selectedApplicants.forEach(id => {
      if (id !== "self") {
        const member = acceptedTeamMembers.find(m => m.id === id);
        if (member) {
          names.push(`${member.firstName} ${member.lastName}`);
        }
      }
    });
    return names;
  };

  const applyMutation = useMutation({
    mutationFn: async (data: { jobId: number; message: string; selectedApplicants: { id: number | "self"; name: string }[]; useSmartRate?: boolean; proposedRate?: number }) => {
      const response = await apiRequest("POST", "/api/applications", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      // Refetch worker applications so Find Work map updates in real time (job pill → yellow / applied)
      if (profile?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile.id] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
      toast({
        title: t("applicationSubmitted"),
        description: selectedApplicants.size > 1 
          ? t("applicationsSubmittedSuccessfully", { count: selectedApplicants.size })
          : t("yourApplicationHasBeenSubmitted"),
      });
      setShowInlineApply(false);
      setInlineApplyStage(1);
      setApplyMessage("");
      setSelectedApplicants(new Set<number | "self">(["self"]));
      setUseSmartRateInline(false);
      if (onApplySuccess) {
        onApplySuccess();
      }
    },
    onError: (error: Error) => {
      toast({
        title: t("applicationFailed"),
        description: error.message || t("failedToSubmitApplication"),
        variant: "destructive",
      });
    },
  });

  const handleInlineApplySubmit = () => {
    const applicants = Array.from(selectedApplicants).map(id => {
      if (id === "self") {
        return { id: "self" as const, name: `${profile?.firstName} ${profile?.lastName}` };
      }
      const member = acceptedTeamMembers.find(m => m.id === id);
      return { id, name: member ? `${member.firstName} ${member.lastName}` : "Team Member" };
    });
    applyMutation.mutate({ 
      jobId: job.id, 
      message: applyMessage, 
      selectedApplicants: applicants,
      useSmartRate: customInlineRate == null && useSmartRateInline,
      ...(customInlineRate != null ? { proposedRate: Math.round(customInlineRate * 100) } : {}),
    });
  };

  // Inline Apply View for desktop side panel - 2 Stage (styled like job details)
  if (stage === 2) {
    return (
      <>
        <div className="flex flex-col h-full">
          <div className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-background sticky top-0 z-10">
            <button
              onClick={() => {
                if (inlineApplyStage === 3) {
                  // From message stage, go back to participant selection (or details if participants already selected)
                  if (selectedApplicants.size >= workersNeeded) {
                    // Participants already selected, go back to details
                    setStage(1);
                    setPopupView("details");
                    setInlineApplyStage(1);
                    setShowInlineApply(false);
                  } else {
                    // Go back to participant selection
                    setInlineApplyStage(2);
                  }
                } else if (inlineApplyStage === 2) {
                  // From participant selection, go back to details
                  setStage(1);
                  setPopupView("details");
                  setInlineApplyStage(1);
                  setShowInlineApply(false);
                } else {
                  setStage(1);
                  setPopupView("details");
                  setShowInlineApply(false);
                }
              }}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              data-testid="back-to-details"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium">{tCommon("back")}</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors flex-shrink-0"
              data-testid="dialog-close-button"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          {inlineApplyStage === 2 ? (
            /* Step 2: Participant Selection (only shown if participants not already selected) */
            <>
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <div className="bg-background rounded-t-[28px] rounded-b-2xl shadow-[0_-2px_12px_rgba(0,0,0,0.06)] px-4 sm:px-6 pt-6 pb-6 min-h-full">
                  {/* Job title — smaller, wrapped on stage 2 */}
                  <h2 className={cn(
                    "font-bold text-center mb-1",
                    inlineApplyStage === 2 ? "text-base sm:text-lg text-pretty" : "text-xl sm:text-2xl truncate"
                  )}>{getDisplayJobTitle(job)}</h2>

                  {/* Participants: company seeking X + slots (empty/filled) + pill-shaped pool — collapsible; hidden on stage 2 (participants step) of inline apply */}
                  {showParticipantsSection && !(inlineApplyMode && inlineApplyStage === 2) && (
                  <Collapsible defaultOpen className="mb-4 group/participants">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="w-full flex items-center justify-between gap-2 py-1 text-left rounded-md hover:bg-muted/50 transition-colors"
                      >
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                          <Users className="w-4 h-4" />
                          {workersNeeded === 1
                            ? (t("participantsSeekingOne") || "1 participant")
                            : (t("participantsSeeking", { count: workersNeeded }) || `${workersNeeded} participants`)}
                        </p>
                        <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
                          {t("companySeeking") || "Company seeking"} · {selectedApplicants.size}/{workersNeeded} {t("selected") || "selected"}
                          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 group-data-[state=closed]/participants:rotate-[-90deg]" />
                        </span>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {Array.from({ length: workersNeeded }, (_, i) => slotOrder[i] ?? null).map((key, idx) => {
                        if (key === null) {
                          return (
                            <div
                              key={`empty-${idx}`}
                              className="w-9 h-9 rounded-full border-2 border-dashed border-muted-foreground/30 bg-muted/20 flex items-center justify-center flex-shrink-0"
                            >
                              <Users className="w-3.5 h-3.5 text-muted-foreground/40" />
                            </div>
                          );
                        }
                        const filled = selectedApplicants.has(key);
                        const isSelf = key === "self";
                        const person = isSelf ? profile : acceptedTeamMembers.find((m) => m.id === key);
                        const avatarUrl = normalizeAvatarUrl((person as { avatarUrl?: string | null })?.avatarUrl ?? undefined);
                        const initials = isSelf
                          ? `${(profile?.firstName ?? "")[0] || ""}${(profile?.lastName ?? "")[0] || ""}`.trim() || "?"
                          : (person as TeamMemberBasic)?.firstName?.[0] && (person as TeamMemberBasic)?.lastName?.[0]
                            ? `${(person as TeamMemberBasic).firstName![0]}${(person as TeamMemberBasic).lastName![0]}`
                            : "?";
                        const name = isSelf ? (t("myself") || "Myself") : `${(person as TeamMemberBasic)?.firstName ?? ""} ${(person as TeamMemberBasic)?.lastName ?? ""}`.trim();
                        return (
                          <button
                            key={`slot-${idx}-${key}`}
                            type="button"
                            onClick={() => {
                              if (filled) {
                                setSelectedApplicants((prev) => {
                                  const next = new Set(prev);
                                  next.delete(key);
                                  return next;
                                });
                              }
                            }}
                            className={cn(
                              "flex-shrink-0 rounded-full border-2 transition-all",
                              filled
                                ? "w-9 h-9 border-primary bg-primary/10 ring-2 ring-primary/20 hover:ring-primary/40 hover:bg-primary/15"
                                : "w-9 h-9 border-dashed border-muted-foreground/40 bg-muted/30 hover:border-muted-foreground/60"
                            )}
                            title={filled ? name : undefined}
                          >
                            {filled ? (
                              <Avatar className="w-full h-full border-0">
                                <AvatarImage src={avatarUrl} />
                                <AvatarFallback className="text-xs bg-primary/20 text-primary">{initials}</AvatarFallback>
                              </Avatar>
                            ) : (
                              <span className="w-full h-full flex items-center justify-center text-muted-foreground/50">
                                <Users className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {t("participantsAssignHint") || "Tap a person below to fill a slot, or tap a filled slot to clear."}
                    </p>
                    {acceptedTeamMembers.length === 0 && (
                      <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground flex flex-col gap-1.5 min-w-0 overflow-hidden">
                        <p className="flex items-start gap-2 min-w-0">
                          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
                          <span className="break-words text-pretty">{t("addTeammateToGetPaidHint") || "If you're contracting this job to someone else you must add them as a teammate, else you cannot get paid."}</span>
                        </p>
                        <a
                          href="/dashboard/business-operator"
                          onClick={(e) => { e.preventDefault(); setLocation("/dashboard/business-operator"); onClose(); }}
                          className="text-primary font-medium hover:underline inline-flex items-center gap-1 w-fit"
                        >
                          {t("addTeammatesLink") || "Add teammates"}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    )}
                    {/* Legend/Key for icons + Settings Gear */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground border border-border/50 bg-muted/30 rounded-lg px-2 py-1.5 flex-1">
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-green-600" />
                                <span>Within territory</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Within job location radius</TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-muted-foreground" />
                                <span>Not within</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Outside job location radius</TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1">
                                <Wrench className="w-3 h-3 text-green-600" />
                                <span>Skills match</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Worker has required skills for this job</TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-green-600" />
                                <span>Available</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Worker is available during job time</TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-amber-500" />
                                <span>Conflict</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Worker has schedule conflict</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0 flex-shrink-0"
                            onClick={() => setTeammateSettingsOpen(true)}
                          >
                            <Settings2 className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Manage teammate details</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 py-0.5">
                      {orderedTeammatesForScroll.map(({ p, skillMatch, available, inTerritory }) => {
                        const pr = p as TeamMemberBasic & { id?: number; firstName?: string; lastName?: string; avatarUrl?: string | null };
                        const poolKey: "self" | number = profile && p === profile ? "self" : (pr as TeamMemberBasic).id;
                        const selected = selectedApplicants.has(poolKey);
                        const atCapacity = selectedApplicants.size >= workersNeeded && !selected;
                        const initials = (pr.firstName?.[0] && pr.lastName?.[0]) ? `${pr.firstName[0]}${pr.lastName[0]}` : "?";
                        const name = poolKey === "self" ? (t("myself") || "Myself") : (pr.firstName && pr.lastName) ? `${pr.firstName} ${pr.lastName}`.trim() : "?";
                        const avatarSrc = normalizeAvatarUrl(pr.avatarUrl ?? undefined);
                        return (
                          <button
                            key={String(poolKey)}
                            type="button"
                            onClick={() => {
                              setSelectedApplicants((prev) => {
                                const next = new Set(prev);
                                if (next.has(poolKey)) {
                                  // Remove if already selected
                                  next.delete(poolKey);
                                } else {
                                  // Add if not at capacity
                                  if (next.size < workersNeeded) {
                                    next.add(poolKey);
                                  }
                                }
                                return next;
                              });
                            }}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 border-2 transition-all text-left min-w-0",
                              selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/50",
                              atCapacity && !selected && "opacity-50",
                              !inTerritory && "opacity-60"
                            )}
                            title={name}
                          >
                            <Avatar className={cn("w-6 h-6 border-2 border-background flex-shrink-0", !available && "opacity-70")}>
                              <AvatarImage src={avatarSrc ?? undefined} />
                              <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-medium truncate">{name}</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex-shrink-0">
                                  <MapPin className={cn("w-3 h-3", inTerritory ? "text-green-600" : "text-muted-foreground")} />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>{inTerritory ? "Within job territory" : "Not within job territory"}</TooltipContent>
                            </Tooltip>
                            {skillMatch && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex-shrink-0">
                                    <Wrench className="w-3 h-3 text-green-600" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>Has required skills</TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex-shrink-0">
                                  <Calendar className={cn("w-3 h-3", available ? "text-green-600" : "text-amber-500")} />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>{available ? "Available" : "Has schedule conflict"}</TooltipContent>
                            </Tooltip>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                    </CollapsibleContent>
                  </Collapsible>
                  )}
                  <div className="border-b border-border/60 my-4" />

                  {/* Estimated Payout — sticky top on mobile, full width */}
                  <div
                    className={cn(
                      "text-center py-2",
                      isMobile && "sticky top-0 z-10 bg-background -mx-4 px-4 pt-2 pb-3 border-b border-border/60 mb-4"
                    )}
                  >
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t("estimatedPayout") || "Estimated Payout"}</p>
                    <p className="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">
                      $<NumberFlowComponent value={combinedApplyPayout} trend={false} />
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × {job.estimatedHours || 8} hours
                    </p>
                  </div>
                  {!isMobile && <div className="border-b border-border/60 my-4" />}

                  {/* Who's working — available 2-col grid + conflict accordion */}
                  {(availableWorkers.length > 0 || conflictWorkers.length > 0) && (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <Label className="text-sm font-semibold text-muted-foreground">
                          {workersNeeded > 1 
                            ? t("selectYourTeam", { selected: selectedApplicants.size, needed: workersNeeded })
                            : t("whosWorkingThisJob")
                          }
                        </Label>
                        {workersNeeded > 1 && (
                          <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                            <Users className="w-3 h-3 mr-1" />
                            {t("needsWorkers", { count: workersNeeded })}
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-3">
                        {(() => {
                          const inTerritory = availableWorkers.filter((w) => w.inTerritory);
                          const outsideTerritory = availableWorkers.filter((w) => !w.inTerritory);
                          const renderWorkerCard = ({ key, p, skillMatch, matchingSkills, inTerritory: inT }: { key: "self" | number; p: TeamMemberBasic | Profile; skillMatch: boolean; matchingSkills: string[]; inTerritory: boolean }, index: number) => {
                            const isSelf = key === "self";
                            const name = isSelf ? (t("myself") || "Myself") : `${(p as TeamMemberBasic).firstName ?? ""} ${(p as TeamMemberBasic).lastName ?? ""}`.trim();
                            const rate = (p as { hourlyRate?: number | null }).hourlyRate != null
                              ? ((p as { hourlyRate: number }).hourlyRate > 100 ? (p as { hourlyRate: number }).hourlyRate / 100 : (p as { hourlyRate: number }).hourlyRate)
                              : 30;
                            const avatarUrl = normalizeAvatarUrl((p as { avatarUrl?: string | null }).avatarUrl ?? undefined);
                            const initials = (p as { firstName?: string; lastName?: string }).firstName?.[0] && (p as { lastName?: string }).lastName?.[0]
                              ? `${(p as { firstName: string }).firstName[0]}${(p as { lastName: string }).lastName[0]}`
                              : "?";
                            const selected = selectedApplicants.has(key);
                            const dt = driveTimeByKey[String(key)];
                            const driveLabel = closestDriveTimeLoading ? "…" : dt?.duration ?? "—";
                            return (
                              <button
                                key={`available-${isSelf ? "self" : key}-${index}`}
                                type="button"
                                onClick={() => {
                                  setSelectedApplicants(prev => {
                                    const next = new Set(prev);
                                    if (next.has(key)) {
                                      if (next.size > 1) next.delete(key);
                                    } else if (next.size < workersNeeded) {
                                      next.add(key);
                                    } else if (workersNeeded === 1) {
                                      next.clear();
                                      next.add(key);
                                    }
                                    return next;
                                  });
                                }}
                                className={cn(
                                  "w-full flex items-center gap-2 py-1.5 px-2 rounded-lg border-2 transition-all text-left min-w-0",
                                  selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                                  !inT && "opacity-60"
                                )}
                                data-testid={isSelf ? "inline-select-self" : `inline-select-member-${key}`}
                              >
                                <div className="relative flex-shrink-0">
                                  <Avatar className={cn("w-7 h-7 border-2 flex-shrink-0", isSelf ? "border-primary/20" : "border-secondary")}>
                                    <AvatarImage src={avatarUrl} className="object-cover" />
                                    <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
                                  </Avatar>
                                  <div className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 flex items-center justify-center", selected ? "border-primary bg-primary" : "border-muted-foreground bg-muted")}>
                                    {selected && <Check className="w-1.5 h-1.5 text-primary-foreground" />}
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <p className="font-medium text-xs truncate">{name}</p>
                                    <span className="text-[10px] text-muted-foreground shrink-0">${Math.round(rate)}/hr</span>
                                  </div>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="flex items-center shrink-0">
                                          <MapPin className={cn("w-3 h-3", inT ? "text-green-600" : "text-muted-foreground")} />
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>{inT ? "Within job territory" : "Outside job location"}</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="flex items-center shrink-0">
                                          <Wrench className={cn("w-3 h-3", skillMatch ? "text-green-600" : "text-muted-foreground")} />
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>{skillMatch ? "Skills match" : "No skill match"}</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="flex items-center shrink-0">
                                          <Calendar className="w-3 h-3 text-green-600" />
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>Available</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground shrink-0">
                                          <Car className="w-2.5 h-2.5" />
                                          {driveLabel}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>Drive time</TooltipContent>
                                    </Tooltip>
                                  </div>
                                </div>
                              </button>
                            );
                          };
                          return (
                            <>
                              <div className="space-y-1.5 min-w-0 overflow-hidden">
                                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                                  <MapPin className="w-3 h-3 text-green-600" />
                                  {t("withinJobLocation") || "Within job location"}
                                </p>
                                <div className="grid grid-cols-2 gap-1.5 min-w-0">
                                  {inTerritory.map((w, i) => renderWorkerCard(w, i))}
                                </div>
                              </div>
                              {outsideTerritory.length > 0 && (
                                <div className="space-y-1.5 pt-1 min-w-0 overflow-hidden">
                                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {t("teammateOutsideJobLocation") || "Outside job location"}
                                  </p>
                                  <div className="grid grid-cols-2 gap-1.5 min-w-0">
                                    {outsideTerritory.map((w, i) => renderWorkerCard(w, i))}
                                  </div>
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {conflictWorkers.length > 0 && (
                          <Accordion type="single" collapsible className="w-full">
                            <AccordionItem value="conflicts" className="border rounded-xl overflow-hidden">
                              <AccordionTrigger className="px-4 py-3 hover:no-underline text-left">
                                <span className="flex items-center gap-2">
                                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                  {t("teammatesWithSchedulingConflicts") || "Teammates with scheduling conflicts"} ({conflictWorkers.length})
                                </span>
                              </AccordionTrigger>
                              <AccordionContent className="px-2 pb-3 pt-0">
                                <div className="grid grid-cols-2 gap-1.5">
                                  {conflictWorkers.map(({ key, p, skillMatch, matchingSkills }, conflictIndex) => {
                                    const isSelf = key === "self";
                                    const name = isSelf ? (t("myself") || "Myself") : `${(p as TeamMemberBasic).firstName ?? ""} ${(p as TeamMemberBasic).lastName ?? ""}`.trim();
                                    const rate = (p as { hourlyRate?: number | null }).hourlyRate != null
                                      ? ((p as { hourlyRate: number }).hourlyRate > 100 ? (p as { hourlyRate: number }).hourlyRate / 100 : (p as { hourlyRate: number }).hourlyRate)
                                      : 30;
                                    const avatarUrl = normalizeAvatarUrl((p as { avatarUrl?: string | null }).avatarUrl ?? undefined);
                                    const initials = (p as { firstName?: string; lastName?: string }).firstName?.[0] && (p as { lastName?: string }).lastName?.[0]
                                      ? `${(p as { firstName: string }).firstName[0]}${(p as { lastName: string }).lastName[0]}`
                                      : "?";
                                    const selected = selectedApplicants.has(key);
                                    const dt = driveTimeByKey[String(key)];
                                    const driveLabel = closestDriveTimeLoading ? "…" : dt?.duration ?? "—";
                                    return (
                                      <button
                                        key={`conflict-${isSelf ? "self" : key}-${conflictIndex}`}
                                        type="button"
                                        onClick={() => {
                                          setSelectedApplicants(prev => {
                                            const next = new Set(prev);
                                            if (next.has(key)) {
                                              if (next.size > 1) next.delete(key);
                                            } else if (next.size < workersNeeded) {
                                              next.add(key);
                                            } else if (workersNeeded === 1) {
                                              next.clear();
                                              next.add(key);
                                            }
                                            return next;
                                          });
                                        }}
                                        className={`w-full flex flex-col items-stretch gap-1.5 p-2 rounded-lg border-2 transition-all text-left ${
                                          selected ? "border-primary bg-primary/5" : "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 hover:border-amber-400 dark:hover:border-amber-600"
                                        }`}
                                        data-testid={isSelf ? "inline-select-self-conflict" : `inline-select-member-conflict-${key}`}
                                      >
                                        <div className="flex items-center justify-between gap-1.5 w-full">
                                          <div className="relative flex-shrink-0">
                                            <Avatar className={cn("w-9 h-9 border-2 opacity-90 flex-shrink-0", isSelf ? "border-primary/20" : "border-secondary")}>
                                              <AvatarImage src={avatarUrl} className="object-cover" />
                                              <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                                            </Avatar>
                                            <span className="absolute -top-0.5 -right-0.5 rounded-full bg-amber-500 p-0.5" title={tCal("schedulingConflict") || "Conflict"}>
                                              <AlertTriangle className="w-2.5 h-2.5 text-white" />
                                            </span>
                                            <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                                              selected ? "border-primary bg-primary" : "border-muted-foreground bg-muted"
                                            }`}>
                                              {selected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                                            </div>
                                          </div>
                                          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                                            <Car className="w-3 h-3" />
                                            {driveLabel}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-1.5 w-full min-w-0">
                                          <p className="font-medium text-xs truncate">{name}</p>
                                          <p className="text-[10px] text-muted-foreground shrink-0">${Math.round(rate)}/hr</p>
                                        </div>
                                        <div className="flex flex-wrap gap-0.5 min-h-[1rem]">
                                          {skillMatch && matchingSkills.length > 0 ? (
                                            matchingSkills.slice(0, 3).map((s) => (
                                              <Badge key={s} variant="secondary" className="text-[9px] px-1 py-0 font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-0">
                                                {s}
                                              </Badge>
                                            ))
                                          ) : (
                                            <span className="text-[9px] text-muted-foreground">{t("noSkillMatch") || "No skill match"}</span>
                                          )}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 px-1">
                        {t("paymentsForTeamMembersGoToYourAccount")}
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Footer — same structure as details footer: progress bar at top, then row with details left / Next right */}
              <div className={`flex-shrink-0 border-t bg-background ${isMobile ? "fixed bottom-0 left-0 right-0 z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]" : ""}`}>
                <div className="flex h-1 w-full bg-muted overflow-hidden" aria-hidden>
                  <div className={cn("h-full flex-1 transition-all", inlineApplyStage >= 1 && "bg-primary")} />
                  <div className={cn("h-full flex-1 transition-all", inlineApplyStage >= 2 && "bg-primary")} />
                  <div className={cn("h-full flex-1 transition-all", inlineApplyStage >= 3 && "bg-primary")} />
                </div>
                <div className="flex flex-row items-center justify-between gap-4 p-4 sm:p-6">
                  <div className="flex flex-col min-w-0 text-left flex-1">
                    {isMobile ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setMobileFooterDetailsExpanded((v) => !v)}
                          className="flex items-center gap-2 text-left w-full rounded-lg -m-1 p-1 hover:bg-muted/50"
                        >
                          <p className="text-lg font-bold tracking-tight">${Math.round(livePreSubmitPayout).toLocaleString()}</p>
                          {mobileFooterDetailsExpanded ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                        </button>
                        {mobileFooterDetailsExpanded && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {selectedApplicants.size > 0 && selectedApplicants.size !== 1 && (
                              <>{selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × </>
                            )}
                            {job.estimatedHours ?? 8} hrs
                            {job.startDate && (
                              <> · {format(new Date(job.startDate), "MMM d")}
                                {job.endDate ? ` – ${format(new Date(job.endDate), "MMM d")}` : (job.estimatedHours ?? 8) > 0 ? ` – ${format(addHours(new Date(job.startDate), job.estimatedHours ?? 8), "MMM d")}` : ""}
                              </>
                            )}
                            {` · ${jobTypeInfo.label}`}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-lg font-bold tracking-tight">${Math.round(livePreSubmitPayout).toLocaleString()}</p>
                        <p className="text-sm text-muted-foreground">
                          {selectedApplicants.size > 0 && selectedApplicants.size !== 1 && (
                            <>{selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × </>
                          )}
                          {job.estimatedHours ?? 8} hrs
                          {job.startDate && (
                            <> · {format(new Date(job.startDate), "MMM d")}
                              {job.endDate ? ` – ${format(new Date(job.endDate), "MMM d")}` : (job.estimatedHours ?? 8) > 0 ? ` – ${format(addHours(new Date(job.startDate), job.estimatedHours ?? 8), "MMM d")}` : ""}
                            </>
                          )}
                          {` · ${jobTypeInfo.label}`}
                        </p>
                      </>
                    )}
                  </div>
                  <Button
                    className="h-12 min-w-[140px] text-base font-semibold rounded-xl shadow-lg bg-gradient-to-r from-[#00A86B] to-[#008A57] hover:from-[#008A57] hover:to-[#006B44] text-white border-0 flex-shrink-0"
                    onClick={() => {
                      setUseSmartRateInline(true);
                      setInlineApplyStage(3); // Go to message stage (step 3)
                    }}
                    disabled={selectedApplicants.size === 0}
                    data-testid="inline-apply-next"
                  >
                    {tCommon("next") || "Next"}
                  </Button>
                </div>
              </div>
            </>
          ) : inlineApplyStage === 3 ? (
            /* Step 3: Send Message to Company Representative */
            <>
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <div className="bg-background rounded-t-[28px] rounded-b-2xl shadow-[0_-2px_12px_rgba(0,0,0,0.06)] px-4 sm:px-6 pt-6 pb-6 min-h-full">
                  <h2 className="text-xl sm:text-2xl font-bold text-center truncate mb-1">{getDisplayJobTitle(job)}</h2>
                  <div className="border-b border-border/60 my-4" />
                  {/* Location representative (or company) — rep name is primary when set on profile/location */}
                  <div className="flex items-center gap-4 py-2">
                    {companyProfileInline?.companyLogo ? (
                      <img src={companyProfileInline.companyLogo} alt="" className="w-14 h-14 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <span className="text-lg font-semibold text-muted-foreground">
                          {(job as { locationRepresentativeName?: string })?.locationRepresentativeName?.[0] || companyProfileInline?.companyName?.[0] || "C"}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-lg truncate">
                        {(job as { locationRepresentativeName?: string })?.locationRepresentativeName || companyProfileInline?.companyName || t("company") || "Company"}
                      </p>
                      {(job as { locationRepresentativeName?: string })?.locationRepresentativeName && (
                        <p className="text-sm text-muted-foreground truncate">
                          {companyProfileInline?.companyName || t("company") || "Company"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="border-b border-border/60 my-4" />
                  {/* Step 3: Send Message to Company Representative */}
                  <div className="pb-28 md:pb-4">
                    <Label htmlFor="inline-apply-message" className="text-sm font-semibold text-muted-foreground">
                      {t("sendMessageToRepresentative") || "Send message to Representative of company"}
                    </Label>
                    <Textarea
                      id="inline-apply-message"
                      placeholder={t("introduceYourselfOrMentionExperience") || "Introduce yourself or mention relevant experience..."}
                      value={applyMessage}
                      onChange={(e) => setApplyMessage(e.target.value)}
                      className="mt-2 resize-none rounded-xl border-border"
                      rows={4}
                      data-testid="inline-apply-message-input"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("contactInfoWillBeRemoved") || "Contact information will be automatically removed"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Footer — same structure as details footer: progress bar at top, then row with Back left / Send right */}
              <div className={`flex-shrink-0 border-t bg-background ${isMobile ? "fixed bottom-0 left-0 right-0 z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]" : ""}`}>
                <div className="flex h-1 w-full bg-muted overflow-hidden" aria-hidden>
                  <div className={cn("h-full flex-1 transition-all", inlineApplyStage >= 1 && "bg-primary")} />
                  <div className={cn("h-full flex-1 transition-all", inlineApplyStage >= 2 && "bg-primary")} />
                  <div className={cn("h-full flex-1 transition-all", inlineApplyStage >= 3 && "bg-primary")} />
                </div>
                <div className="flex flex-row items-center justify-between gap-4 p-4 sm:p-6">
                  <Button
                    variant="ghost"
                    className="h-12 text-muted-foreground rounded-xl flex-shrink-0"
                    onClick={() => {
                      if (selectedApplicants.size >= workersNeeded) {
                        setStage(1);
                        setPopupView("details");
                        setInlineApplyStage(1);
                        setShowInlineApply(false);
                      } else {
                        setInlineApplyStage(2);
                      }
                    }}
                    data-testid="inline-apply-back"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    {tCommon("back") || "Back"}
                  </Button>
                  <Button
                    className="h-12 min-w-[140px] text-base font-semibold rounded-xl shadow-lg bg-gradient-to-r from-[#00A86B] to-[#008A57] hover:from-[#008A57] hover:to-[#006B44] text-white border-0 flex-shrink-0"
                    onClick={handleInlineApplySubmit}
                    disabled={applyMutation.isPending || selectedApplicants.size === 0}
                    data-testid="inline-apply-submit"
                  >
                    {applyMutation.isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    ) : (
                      <Send className="w-5 h-5 mr-2" />
                    )}
                    {t("send") || "Send"}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </>
    );
  }

  if (popupView !== "details") {
    const titles: Record<string, string> = {
      cancellation: t("strikePolicyTitle") || "Cancellation policy",
      insurance: t("insuranceCheck") || "Insurance check",
      id: t("idVerificationCheck") || "ID verification check",
      w9: t("w9VerificationCheck") || "W-9 verification check",
      report: t("reportListingTitle") || "Report this listing",
      calendar: t("checkCalendar") || "Check calendar",
      teammate: selectedTeammateForPopup?.p
        ? `${(selectedTeammateForPopup.p as { firstName?: string; lastName?: string }).firstName ?? ""} ${(selectedTeammateForPopup.p as { lastName?: string }).lastName ?? ""}`.trim() || "Worker"
        : "Schedule",
      map: t("whereYoullBe") || "Where you'll be",
    };
    const pr = profile as { identityVerified?: boolean; insuranceVerified?: boolean; w9DocumentUrl?: string } | null;
    const hasConflicts = scheduledJobsAndConflicts.conflicts.length > 0;
    let body: React.ReactNode = null;
    if (popupView === "cancellation") {
      body = <p className="text-muted-foreground text-sm">{t("strikePolicyBodyObligation") || "If you apply and the company accepts, you must show up and work. If not, you get a strike and may be removed from Tolstoy Staffing."}</p>;
    } else if (popupView === "insurance") {
      body = (
        <>
          <p className="text-muted-foreground text-sm">
            {pr?.insuranceVerified ? (t("insuranceValid") || "Your application will show valid insurance.") : (t("insuranceSetup") || "Set up in Account & Documents.")}
          </p>
          {!pr?.insuranceVerified && <a href="/dashboard/account-documents" className="text-sm text-primary font-medium underline mt-2 inline-block">Go to Account & Documents</a>}
        </>
      );
    } else if (popupView === "id") {
      body = (
        <>
          <p className="text-muted-foreground text-sm">
            {profile?.identityVerified ? (t("idVerifiedGood") || "Your application will show ID verified.") : (t("idSetup") || "Set up in Account & Documents.")}
          </p>
          {!profile?.identityVerified && <a href="/dashboard/account-documents" className="text-sm text-primary font-medium underline mt-2 inline-block">Go to Account & Documents</a>}
        </>
      );
    } else if (popupView === "w9") {
      body = (
        <>
          <p className="text-muted-foreground text-sm">
            {pr?.w9DocumentUrl ? (t("w9VerifiedGood") || "W-9 on file.") : (t("w9Setup") || "Set up in Account & Documents.")}
          </p>
          {!pr?.w9DocumentUrl && <a href="/dashboard/account-documents" className="text-sm text-primary font-medium underline mt-2 inline-block">Go to Account & Documents</a>}
        </>
      );
    } else if (popupView === "report") {
      body = (
        <>
          <p className="text-muted-foreground text-sm">{t("reportListingBodyMisleading") || "Flag as misleading, inaccurate, or otherwise problematic."}</p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setPopupView("details")}>Cancel</Button>
            <Button className="flex-1 rounded-xl bg-gradient-to-r from-[#00A86B] to-[#008A57] border-0" onClick={() => { setPopupView("details"); toast({ title: "Report submitted", description: "Thanks. We'll review this listing." }); }}>Flag & report</Button>
          </div>
        </>
      );
    } else if (popupView === "calendar" && jobStart) {
      body = (
        <div className="space-y-4 rounded-t-[28px] overflow-hidden">
          <div className="p-4 rounded-xl bg-muted/50">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{tCal("jobScheduledFor") || "Job scheduled for"}</p>
            <p className="font-semibold">{format(jobStart, "EEEE, MMMM d, yyyy")}</p>
            {jobEnd && (
              <p className="text-sm text-muted-foreground mt-1">
                {format(jobStart, "h:mm a")} – {format(jobEnd, "h:mm a")}
                {job.estimatedHours && ` (${tCal("hours", { count: job.estimatedHours })})`}
              </p>
            )}
          </div>
          <div className={cn(
            "p-4 rounded-xl border",
            hasConflicts ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
          )}>
            <div className="flex items-center gap-3">
              {hasConflicts ? (
                <>
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="font-medium text-amber-800 dark:text-amber-200">{tCal("schedulingConflict") || "Scheduling conflict"}</p>
                    <p className="text-sm text-amber-600 dark:text-amber-400">{tCal("jobsOverlap", { count: scheduledJobsAndConflicts.conflicts.length })}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-200">{tCal("noConflicts") || "No conflicts"}</p>
                    <p className="text-sm text-green-600 dark:text-green-400">{tCal("jobFitsSchedule") || "Job fits your schedule"}</p>
                  </div>
                </>
              )}
            </div>
          </div>
          {scheduledJobsAndConflicts.scheduled.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-muted-foreground">{tCal("yourDay") || "Your day"}</h4>
              <div className="relative border-l-2 border-primary/30 ml-3 pl-4 py-2">
                <div className="absolute -left-1.5 top-2 w-3 h-3 rounded-full bg-primary border-2 border-background" />
                <p className="text-xs text-muted-foreground mb-1">{tCal("thisJob") || "This job"}</p>
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                  <p className="font-medium text-sm">{getDisplayJobTitle(job)}</p>
                  <p className="text-xs text-muted-foreground">{jobStart && format(jobStart, "h:mm a")} – {jobEnd && format(jobEnd, "h:mm a")}</p>
                </div>
              </div>
              {scheduledJobsAndConflicts.scheduled.filter((ev) => ev.id !== job.id).map((ev) => {
                const isConflict = scheduledJobsAndConflicts.conflicts.some((c) => c.id === ev.id);
                return (
                  <div key={ev.id} className={cn("relative border-l-2 ml-3 pl-4 py-2", isConflict ? "border-amber-500" : "border-muted")}>
                    <div className={cn("absolute -left-1.5 top-2 w-3 h-3 rounded-full border-2 border-background", isConflict ? "bg-amber-500" : "bg-muted-foreground/30")} />
                    <div className={cn("rounded-lg p-3", isConflict ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800" : "bg-muted/50")}>
                      <p className="font-medium text-sm">{getDisplayJobTitle(ev)}</p>
                      <p className="text-xs text-muted-foreground">{format(ev.start, "h:mm a")} – {format(ev.end, "h:mm a")}</p>
                      {isConflict && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{tCal("overlapsWithThisJob")}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="space-y-2">
            <h4 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              {tCal("teamAvailability") || "Team availability"}
            </h4>
            {orderedTeammatesForScroll.filter(({ p }) => (profile && p === profile) || acceptedTeamMembers.some((tm) => tm.id === (p as any).id)).map(({ p, available }) => {
              const m = p as TeamMemberBasic & { firstName?: string; lastName?: string; avatarUrl?: string | null };
              const isSelf = !!(profile && p === profile);
              const initial = m.firstName?.[0] && m.lastName?.[0] ? `${m.firstName[0]}${m.lastName[0]}` : "?";
              const displayName = isSelf ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() + ` ${tCal("yourself") || "(You)"}` : `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim();
              return (
                <div
                  key={isSelf ? "self" : m.id}
                  className={cn(
                    "rounded-xl p-3 border flex items-center gap-3",
                    available ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                  )}
                >
                  <Avatar className="w-10 h-10 flex-shrink-0">
                    <AvatarImage src={normalizeAvatarUrl(m.avatarUrl ?? (isSelf ? profile?.avatarUrl : undefined) ?? undefined)} />
                    <AvatarFallback className="text-xs">{initial}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {available ? (tCal("available") || "Available") : (tCal("hasConflicts", { count: 1 }) || "Conflict(s)")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    } else if (popupView === "map" && job.latitude && job.longitude) {
      body = (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {displayAddress || [job.city, job.state].filter(Boolean).join(", ")}
          </p>
          <div className="rounded-xl overflow-hidden border border-border bg-muted/30" style={{ minHeight: "50vh" }}>
            <JobLocationMap
              job={{ id: job.id, lat: parseFloat(job.latitude), lng: parseFloat(job.longitude), title: getDisplayJobTitle(job) }}
              userLocation={workerLocation ?? undefined}
              personLocations={personLocationsForMap}
              height="50vh"
              className="w-full"
              partialAddress={(application?.status === "accepted" ? displayAddress : partialAddress) || undefined}
              showApproximateRadius
              approximateNote={application?.status === "accepted" ? undefined : t("fullAddressWhenYouWin")}
            />
          </div>
        </div>
      );
    } else if (popupView === "teammate" && selectedTeammateForPopup?.p && jobStart) {
      const tp = selectedTeammateForPopup.p as TeamMemberBasic & { firstName?: string; lastName?: string; avatarUrl?: string | null; skillsets?: string[]; hourlyRate?: number | null };
      const isSelf = !!profile && tp === profile;
      const memberKey: "self" | number = isSelf ? "self" : (tp as TeamMemberBasic).id;
      const data = scheduledByMember[memberKey];
      const sched = data?.scheduled ?? [];
      const confl = data?.conflicts ?? [];
      const name = `${tp.firstName ?? ""} ${tp.lastName ?? ""}`.trim() || "Worker";
      const dayLabel = isSelf ? (tCal("yourDay") || "Your day") : `${name}'s day`;
      const scheduleLabel = isSelf ? (tCal("jobFitsSchedule") || "Job fits your schedule") : `Job fits ${name}'s schedule`;
      const initials = tp.firstName?.[0] && tp.lastName?.[0] ? `${tp.firstName[0]}${tp.lastName[0]}` : "?";
      const avatarSrc = normalizeAvatarUrl(tp.avatarUrl ?? undefined);
      const rate = tp.hourlyRate != null ? (tp.hourlyRate > 100 ? tp.hourlyRate / 100 : tp.hourlyRate) : 30;
      body = (
        <div className="space-y-4 rounded-t-[28px] overflow-hidden">
          <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/50">
            <Avatar className="w-14 h-14 flex-shrink-0">
              <AvatarImage src={avatarSrc ?? undefined} />
              <AvatarFallback className="text-base">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-semibold text-lg truncate">{name}{isSelf ? ` ${tCal("yourself") || "(You)"}` : ""}</p>
              {(tp.skillsets?.length ?? 0) > 0 && (
                <p className="text-sm text-muted-foreground truncate">{(tp.skillsets ?? []).slice(0, 3).join(", ")}</p>
              )}
              <p className="text-sm font-medium text-primary">${Math.round(rate)}/hr</p>
            </div>
          </div>
          <div className={cn(
            "p-4 rounded-xl border flex items-center gap-3",
            confl.length > 0 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
          )}>
            {confl.length > 0 ? (
              <>
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-200">{tCal("schedulingConflict") || "Scheduling conflict"}</p>
                  <p className="text-sm text-amber-600 dark:text-amber-400">{tCal("jobsOverlap", { count: confl.length })}</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="font-medium text-green-800 dark:text-green-200">{tCal("noConflicts") || "No conflicts"}</p>
                  <p className="text-sm text-green-600 dark:text-green-400">{scheduleLabel}</p>
                </div>
              </>
            )}
          </div>
          <div className="p-4 rounded-xl bg-muted/50">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{tCal("jobScheduledFor") || "Job scheduled for"}</p>
            <p className="font-semibold">{format(jobStart, "EEEE, MMMM d, yyyy")}</p>
            {jobEnd && <p className="text-sm text-muted-foreground mt-1">{format(jobStart, "h:mm a")} – {format(jobEnd, "h:mm a")}</p>}
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-sm text-muted-foreground">{dayLabel}</h4>
            <div className="relative border-l-2 border-primary/30 ml-3 pl-4 py-2">
              <div className="absolute -left-1.5 top-2 w-3 h-3 rounded-full bg-primary border-2 border-background" />
              <p className="text-xs text-muted-foreground mb-1">{tCal("thisJob") || "This job"}</p>
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                <p className="font-medium text-sm">{getDisplayJobTitle(job)}</p>
                <p className="text-xs text-muted-foreground">{jobStart && format(jobStart, "h:mm a")} – {jobEnd && format(jobEnd, "h:mm a")}</p>
              </div>
            </div>
            {sched.filter((ev) => ev.id !== job.id).map((ev) => {
              const isConflict = confl.some((c: { id: number }) => c.id === ev.id);
              return (
                <div key={ev.id} className={cn("relative border-l-2 ml-3 pl-4 py-2", isConflict ? "border-amber-500" : "border-muted")}>
                  <div className={cn("absolute -left-1.5 top-2 w-3 h-3 rounded-full border-2 border-background", isConflict ? "bg-amber-500" : "bg-muted-foreground/30")} />
                  <div className={cn("rounded-lg p-3", isConflict ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800" : "bg-muted/50")}>
                    <p className="font-medium text-sm">{getDisplayJobTitle(ev)}</p>
                    <p className="text-xs text-muted-foreground">{format(ev.start, "h:mm a")} – {format(ev.end, "h:mm a")}</p>
                    {isConflict && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{tCal("overlapsWithThisJob")}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    } else {
      body = <p className="text-muted-foreground text-sm">{tCommon("gotIt")}</p>;
    }
    return (
      <div className={cn("flex flex-col", isMobile ? "h-full" : "max-h-[85vh]")}>
        <div className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-background">
          <button
            onClick={() => { setPopupView("details"); setSelectedTeammateForPopup(null); }}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors flex-shrink-0"
            data-testid="breadcrumb-back"
            aria-label={tCommon("back") || "Back"}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="font-medium truncate flex-1 text-center px-2">
            <span className="text-muted-foreground">{tCommon("back")} / </span>
            <span>{titles[popupView] || popupView}</span>
          </span>
          <div className="w-9 flex-shrink-0" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 min-w-0">
          {body}
          {popupView !== "report" && popupView !== "map" && (
            <Button className="w-full mt-4 rounded-xl" onClick={() => { setPopupView("details"); setSelectedTeammateForPopup(null); }}>{tCommon("gotIt")}</Button>
          )}
        </div>
        {popupView === "map" && (
          <div className="flex-shrink-0 border-t bg-background">
            <div className="flex h-1 w-full bg-muted overflow-hidden" aria-hidden>
              <div className={cn("h-full flex-1 transition-all", stage >= 1 && "bg-primary")} />
              <div className={cn("h-full flex-1 transition-all", stage >= 2 && "bg-primary")} />
            </div>
            <div className="flex flex-row items-center justify-between gap-4 p-4 sm:p-6">
              <div className="flex flex-col min-w-0 text-left flex-1">
                {isMobile ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setMobileFooterDetailsExpanded((v) => !v)}
                      className="flex items-center gap-2 text-left w-full rounded-lg -m-1 p-1 hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-lg font-bold tracking-tight">${Math.round(livePreSubmitPayout).toLocaleString()}</p>
                        {stage === 1 && onDismiss && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onDismiss(job); }} className="flex-shrink-0 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="enhanced-dismiss-button-map">
                            <X className="w-4 h-4" />
                            {t("skip")}
                          </button>
                        )}
                      </div>
                      {mobileFooterDetailsExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                    {mobileFooterDetailsExpanded && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {selectedApplicants.size > 0 && selectedApplicants.size !== 1 && (
                          <>{selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × </>
                        )}
                        {job.estimatedHours ?? 8} hrs
                        {job.startDate && (
                          <> · {format(new Date(job.startDate), "MMM d")}
                            {job.endDate ? ` – ${format(new Date(job.endDate), "MMM d")}` : (job.estimatedHours ?? 8) > 0 ? ` – ${format(addHours(new Date(job.startDate), job.estimatedHours ?? 8), "MMM d")}` : ""}
                          </>
                        )}
                        {` · ${jobTypeInfo.label}`}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-lg font-bold tracking-tight">${Math.round(livePreSubmitPayout).toLocaleString()}</p>
                      {stage === 1 && onDismiss && (
                        <button type="button" onClick={() => onDismiss(job)} className="flex-shrink-0 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="enhanced-dismiss-button-map">
                          <X className="w-4 h-4" />
                          {t("skip")}
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {selectedApplicants.size > 0 && selectedApplicants.size !== 1 && (
                        <>{selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × </>
                      )}
                      {job.estimatedHours ?? 8} hrs
                      {job.startDate && (
                        <> · {format(new Date(job.startDate), "MMM d")}
                          {job.endDate ? ` – ${format(new Date(job.endDate), "MMM d")}` : (job.estimatedHours ?? 8) > 0 ? ` – ${format(addHours(new Date(job.startDate), job.estimatedHours ?? 8), "MMM d")}` : ""}
                        </>
                      )}
                      {` · ${jobTypeInfo.label}`}
                    </p>
                  </>
                )}
              </div>
              <Button
                className="h-12 min-w-[140px] text-base font-semibold rounded-xl shadow-lg bg-gradient-to-r from-[#00A86B] to-[#008A57] hover:from-[#008A57] hover:to-[#006B44] text-white border-0 flex-shrink-0"
                onClick={() => {
                  if (selectedApplicants.size >= workersNeeded) {
                    setUseSmartRateInline(true);
                    setInlineApplyStage(3);
                    setStage(2);
                    setShowInlineApply(true);
                  } else {
                    setInlineApplyStage(2);
                    setStage(2);
                    setShowInlineApply(true);
                  }
                }}
                data-testid="enhanced-apply-button-map-popup"
              >
                {selectedApplicants.size >= workersNeeded ? (t("applyNow") || "Apply Now") : (tCommon("next") || "Next")}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Breadcrumbed step: withdraw application (reason + confirm) inside same dialog/drawer
  const WITHDRAW_REASON_KEYS = ["withdrawReasonFoundAnotherJob", "withdrawReasonScheduleChanged", "withdrawReasonNoLongerInterested", "withdrawReasonOther"] as const;
  if (application && (onWithdraw || onWithdrawAll) && showWithdrawStep) {
    const onBackWithdraw = () => {
      if (withdrawStep === "confirm") {
        setWithdrawStep("reason");
      } else {
        setShowWithdrawStep(false);
        setWithdrawReason(null);
        setWithdrawStep("reason");
      }
    };
    const handleConfirmWithdraw = () => {
      if (allApps.length > 1 && onWithdrawAll) onWithdrawAll(allApps.map(app => app.id));
      else if (onWithdraw) onWithdraw(application.id);
      setShowWithdrawStep(false);
      setWithdrawReason(null);
      setWithdrawStep("reason");
    };
    const reasonLabel = (key: string) => t(key as any);
    return (
      <div className={cn("flex flex-col min-h-0", isMobile ? "h-full" : "max-h-[85vh]")}>
        <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0 bg-background rounded-t-[28px] -mt-0">
          <button
            onClick={onBackWithdraw}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            data-testid="button-back-from-withdraw"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{tCommon("back")}</span>
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-sm">
            {withdrawStep === "reason" ? t("withdrawApplication") : t("confirmWithdrawTitle")}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 pl-4 pr-4">
          {withdrawStep === "reason" ? (
            <>
              <p className="text-sm font-medium mb-3">{t("withdrawReasonTitle")}</p>
              <div className="space-y-2" role="radiogroup" aria-label={t("withdrawReasonTitle")}>
                {WITHDRAW_REASON_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setWithdrawReason(key)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors",
                      withdrawReason === key
                        ? "bg-primary/10 border-primary"
                        : "bg-card border-border hover:bg-muted/50"
                    )}
                    data-testid={`withdraw-reason-${key}`}
                  >
                    <span className={cn("w-4 h-4 rounded-full border-2 flex-shrink-0", withdrawReason === key ? "border-primary bg-primary" : "border-muted-foreground")} />
                    <span className="text-sm">{reasonLabel(key)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t("confirmWithdrawMessage", { reason: withdrawReason ? reasonLabel(withdrawReason) : "" })}
              </p>
            </>
          )}
        </div>
        <div className="flex-shrink-0 p-4 border-t bg-background shadow-[0_-2px_12px_rgba(0,0,0,0.06)] flex flex-col gap-2">
          {withdrawStep === "reason" ? (
            <>
              <Button
                className="w-full"
                disabled={!withdrawReason}
                onClick={() => setWithdrawStep("confirm")}
                data-testid="button-withdraw-continue"
              >
                {t("withdrawContinue")}
              </Button>
              <Button variant="outline" className="w-full" onClick={onBackWithdraw} data-testid="button-withdraw-cancel">
                {tCommon("cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                className="w-full"
                disabled={isWithdrawing}
                onClick={handleConfirmWithdraw}
                data-testid="button-withdraw-confirm"
              >
                {isWithdrawing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                {t("confirmWithdrawButton")}
              </Button>
              <Button variant="outline" className="w-full" onClick={onBackWithdraw} data-testid="button-withdraw-back">
                {tCommon("back")}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Breadcrumbed step: team member picker (reassign) — same 1:1 as main team availability: grouped by within/outside location, skill + calendar icons
  if (application && onAssignTeamMember && showApplicationTeamPicker) {
    const appToReassign = selectedAppForReassign || application;
    const currentMember = appToReassign.teamMember;
    const assignedTeamMemberIds = allApps
      .filter(app => app.id !== appToReassign.id)
      .map(app => app.teamMember?.id ?? "self")
      .filter(id => id !== undefined);
    const isSelfAssignedElsewhere = assignedTeamMemberIds.includes("self");
    const assignedMemberIds = assignedTeamMemberIds.filter((id): id is number => typeof id === "number");
    const hasMultipleWorkers = allApps.length > 1;
    const onBack = () => {
      setShowApplicationTeamPicker(false);
      setSelectedAppForReassign(null);
    };
    const assignableKeys = new Set<number | "self">();
    if (!hasMultipleWorkers || !isSelfAssignedElsewhere || currentMember) assignableKeys.add("self");
    activeTeamMembers.forEach(m => {
      if (!hasMultipleWorkers || !assignedMemberIds.includes(m.id) || currentMember?.id === m.id) assignableKeys.add(m.id);
    });
    const assignableAvailable = availableWorkers.filter((w) => assignableKeys.has(w.key));
    const assignableConflict = conflictWorkers.filter((w) => assignableKeys.has(w.key));
    const inTerritory = assignableAvailable.filter((w) => w.inTerritory);
    const outsideTerritory = assignableAvailable.filter((w) => !w.inTerritory);
    type ReassignRow = { key: "self" | number; p: TeamMemberBasic | Profile; skillMatch: boolean; available: boolean; inTerritory: boolean; matchingSkills: string[] };
    const renderReassignCard = (w: ReassignRow) => {
      const isSelf = w.key === "self";
      const m = w.p as TeamMemberBasic & { firstName?: string; lastName?: string; avatarUrl?: string | null };
      const displayName = isSelf ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() + ` ${tCal("yourself") || "(You)"}` : `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim();
      const initial = m.firstName?.[0] && m.lastName?.[0] ? `${m.firstName[0]}${m.lastName[0]}` : "?";
      const isCurrent = (isSelf && !currentMember) || (!isSelf && currentMember?.id === w.key);
      const cardContent = (
        <>
          <Avatar className={cn("w-10 h-10 flex-shrink-0", !w.available && "opacity-90")}>
            <AvatarImage src={normalizeAvatarUrl(m.avatarUrl ?? (isSelf ? profile?.avatarUrl : operatorAvatarUrl) ?? undefined)} />
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm truncate">{displayName}</p>
              {isCurrent && <Badge variant="secondary" className="text-xs shrink-0">{t("current")}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {w.available ? (tCal("available") || "Available") : (tCal("hasConflicts", { count: 1 }) || "Conflict(s)")}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center shrink-0">
                    <MapPin className={cn("w-3 h-3", w.inTerritory ? "text-green-600" : "text-muted-foreground")} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{w.inTerritory ? (t("withinJobLocation") || "Within job location") : (t("teammateOutsideJobLocation") || "Outside job location")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center shrink-0">
                    <Wrench className={cn("w-3 h-3", w.skillMatch ? "text-green-600" : "text-muted-foreground")} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{w.skillMatch ? (t("skillsMatch") || "Skills match") : (t("noSkillMatch") || "No skill match")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center shrink-0">
                    <Calendar className={cn("w-3 h-3", w.available ? "text-green-600" : "text-amber-500")} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{w.available ? (tCal("available") || "Available") : (tCal("hasConflicts", { count: 1 }) || "Conflict(s)")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </>
      );
      const cardClass = cn(
        "rounded-xl p-3 border flex items-center gap-3 w-full text-left transition-colors",
        w.available ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
        "hover:ring-2 hover:ring-primary/30 cursor-pointer"
      );
      return (
        <button
          key={isSelf ? "self" : w.key}
          type="button"
          onClick={() => {
            onAssignTeamMember(appToReassign.id, isSelf ? null : (w.key as number));
            onBack();
          }}
          className={cardClass}
          data-testid={isSelf ? "select-team-member-self" : `select-team-member-${w.key}`}
        >
          {cardContent}
        </button>
      );
    };
    return (
      <div className={cn("flex flex-col min-h-0", isMobile ? "h-full" : "max-h-[85vh]")}>
        <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0 bg-background rounded-t-[28px] -mt-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            data-testid="button-back-to-job"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{tCommon("back")}</span>
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-sm">
            {hasMultipleWorkers ? t("reassignWorker") : t("selectTeamMember")}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 min-w-0">
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 rounded-lg p-3 mb-4">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-blue-700 dark:text-blue-300">
                {hasMultipleWorkers
                  ? t("reassigningWorkerRateUnchanged", { name: currentMember ? `${currentMember.firstName} ${currentMember.lastName}` : `${profile?.firstName} ${profile?.lastName}` })
                  : t("appliedRateWillRemainUnchanged", { rate: Math.round(rateToDollars(appToReassign.proposedRate ?? profile?.hourlyRate ?? 0)) })
                }
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {jobStart && (
              <>
                <div className="p-3 rounded-xl bg-muted/50">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{tCal("jobScheduledFor") || "Job scheduled for"}</p>
                  <p className="font-semibold text-sm">{format(jobStart, "EEEE, MMM d")}</p>
                  {jobEnd && (
                    <p className="text-xs text-muted-foreground">
                      {format(jobStart, "h:mm a")} – {format(jobEnd, "h:mm a")}
                      {job.estimatedHours && ` · ${tCal("hours", { count: job.estimatedHours })}`}
                    </p>
                  )}
                </div>
                <div className={cn(
                  "p-3 rounded-xl border flex items-center gap-2 flex-wrap",
                  scheduledJobsAndConflicts.conflicts.length > 0 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
                )}>
                  <div className="flex items-center gap-2 min-w-0">
                    {scheduledJobsAndConflicts.conflicts.length > 0 ? (
                      <>
                        <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-amber-800 dark:text-amber-200">{tCal("schedulingConflict") || "Scheduling conflict"}</p>
                          <p className="text-xs text-amber-600 dark:text-amber-400">{tCal("jobsOverlap", { count: scheduledJobsAndConflicts.conflicts.length }) || `${scheduledJobsAndConflicts.conflicts.length} overlap`}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-green-800 dark:text-green-200">{tCal("noConflicts") || "No conflicts"}</p>
                          <p className="text-xs text-green-600 dark:text-green-400">{tCal("jobFitsSchedule") || "Job fits your schedule"}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {scheduledJobsAndConflicts.scheduled.length > 0 && (
                  <div className="space-y-1">
                    <div className="relative border-l-2 border-primary/30 ml-2.5 pl-3 py-1.5">
                      <div className="absolute -left-1.5 top-1.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-background" />
                      <p className="text-[10px] text-muted-foreground mb-0.5">{tCal("thisJob") || "This job"}</p>
                      <div className="bg-primary/10 border border-primary/30 rounded-lg px-2.5 py-2">
                        <p className="font-medium text-xs truncate">{getDisplayJobTitle(job)}</p>
                        <p className="text-[10px] text-muted-foreground">{jobStart && format(jobStart, "h:mm a")} – {jobEnd && format(jobEnd, "h:mm a")}</p>
                      </div>
                    </div>
                    {scheduledJobsAndConflicts.scheduled.filter((ev) => ev.id !== job.id).map((ev) => {
                      const isConflict = scheduledJobsAndConflicts.conflicts.some((c) => c.id === ev.id);
                      return (
                        <div key={ev.id} className={cn("relative border-l-2 ml-2.5 pl-3 py-1.5", isConflict ? "border-amber-500" : "border-muted")}>
                          <div className={cn("absolute -left-1.5 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-background", isConflict ? "bg-amber-500" : "bg-muted-foreground/30")} />
                          <div className={cn("rounded-lg px-2.5 py-2", isConflict ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800" : "bg-muted/50")}>
                            <p className="font-medium text-xs truncate">{getDisplayJobTitle(ev)}</p>
                            <p className="text-[10px] text-muted-foreground">{format(ev.start, "h:mm a")} – {format(ev.end, "h:mm a")}</p>
                            {isConflict && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">{tCal("overlapsWithThisJob") || "Overlaps"}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    {tCal("teamAvailability") || "Team availability"}
                  </h4>
                  <div className="space-y-2">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-green-600" />
                      {t("withinJobLocation") || "Within job location"}
                    </p>
                    <div className="space-y-2">
                      {inTerritory.map((w) => renderReassignCard(w))}
                    </div>
                  </div>
                  {outsideTerritory.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {t("teammateOutsideJobLocation") || "Outside job location"}
                      </p>
                      <div className="space-y-2">
                        {outsideTerritory.map((w) => renderReassignCard(w))}
                      </div>
                    </div>
                  )}
                  {assignableConflict.length > 0 && (
                    <Accordion type="single" collapsible className="w-full pt-1">
                      <AccordionItem value="conflicts" className="border rounded-xl overflow-hidden">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline text-left">
                          <span className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            {t("teammatesWithSchedulingConflicts") || "Teammates with scheduling conflicts"} ({assignableConflict.length})
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="px-2 pb-3 pt-0">
                          <div className="space-y-2">
                            {assignableConflict.map((w) => renderReassignCard(w))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 p-4 border-t bg-background shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
          <Button variant="outline" className="w-full" onClick={onBack} data-testid="button-cancel-team-selection">
            {tCommon("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={cn(
        "flex flex-col w-full min-h-0",
        isMobile ? "h-full" : inlineApplyMode ? "flex-1" : "flex-1 max-h-[85vh]"
      )}>
        {/* Scrollable: gallery (not sticky) + details card with rounded top — Airbnb-style */}
        <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden">
          {/* Gallery: full-bleed, overlayed back + title + close. On mobile: 1/3 viewport at top. */}
          <div
            className={cn(
              "relative w-full min-w-0 bg-muted overflow-hidden flex-shrink-0",
              isMobile ? "h-[33.33vh] min-h-[180px]" : "aspect-video"
            )}
          >
            <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-4 py-3 bg-gradient-to-b from-black/35 via-black/15 to-transparent pointer-events-none [&>*]:pointer-events-auto">
              <button
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-white/95 hover:bg-white shadow-[0_1px_4px_rgba(0,0,0,0.2)] transition-colors flex-shrink-0 text-foreground"
                data-testid="dialog-back-button"
                aria-label={tCommon("back") || "Back"}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="font-semibold text-lg truncate flex-1 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)] px-2">
                {getDisplayJobTitle(job)}
              </h2>
              <button
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-white/95 hover:bg-white shadow-[0_1px_4px_rgba(0,0,0,0.2)] transition-colors flex-shrink-0 text-foreground"
                data-testid="dialog-close-button"
                aria-label={tCommon("close") || "Close"}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {!imageLoaded && allMedia[currentMediaIndex].type === "image" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            )}
            {allMedia[currentMediaIndex].type === "image" ? (
              <button
                type="button"
                onClick={() => {
                  setFullPageGalleryStartIndex(currentMediaIndex);
                  setShowFullPageGallery(true);
                }}
                className="absolute inset-0 w-full h-full cursor-pointer flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="job-media-open-gallery"
                aria-label={t("viewFullScreen") || "View full screen"}
              >
                <img
                  src={allMedia[currentMediaIndex].url!}
                  alt="Job media"
                  className={`w-full h-full object-cover transition-opacity ${imageLoaded ? "opacity-100" : "opacity-0"}`}
                  onLoad={() => setImageLoaded(true)}
                />
              </button>
            ) : allMedia[currentMediaIndex].type === "video" ? (
              <video
                src={allMedia[currentMediaIndex].url}
                className="w-full h-full object-cover"
                controls
                preload="metadata"
              />
            ) : allMedia[currentMediaIndex].type === "map" && (job.latitude && job.longitude || (job as any).mapThumbnailUrl) ? (
              <button
                onClick={() => {
                  const mapIdx = allMedia.findIndex((m) => m.type === "map");
                  setFullPageGalleryStartIndex(mapIdx >= 0 ? mapIdx : 0);
                  setShowFullPageGallery(true);
                }}
                className="absolute inset-0 w-full h-full cursor-pointer flex flex-col"
                data-testid="job-map-button-gallery"
              >
                <div className="flex-1 min-h-0 w-full">
                  {(job as any).mapThumbnailUrl ? (
                    <img src={(job as any).mapThumbnailUrl} alt="Job location" className="w-full h-full object-cover" />
                  ) : (allMedia.length === 1 && !job.images?.length && !job.videos?.length) ? (
                    <JobLocationMap
                      job={{ id: job.id, lat: parseFloat(job.latitude!), lng: parseFloat(job.longitude!), title: getDisplayJobTitle(job) }}
                      userLocation={workerLocation ?? undefined}
                      height="100%"
                      className="h-full w-full rounded-none overflow-hidden"
                      partialAddress={(application?.status === "accepted" ? displayAddress : partialAddress) || undefined}
                      showApproximateRadius
                      approximateNote={application?.status === "accepted" ? undefined : t("fullAddressWhenYouWin")}
                      onClick={() => {
                        const mapIdx = allMedia.findIndex((m) => m.type === "map");
                        setFullPageGalleryStartIndex(mapIdx >= 0 ? mapIdx : 0);
                        setShowFullPageGallery(true);
                      }}
                    />
                  ) : (
                    <MiniJobMap
                      job={{
                        id: job.id,
                        lat: parseFloat(job.latitude!),
                        lng: parseFloat(job.longitude!),
                        title: getDisplayJobTitle(job),
                      }}
                      partialAddress={(application?.status === "accepted" ? displayAddress : partialAddress) || undefined}
                      showApproximateRadius
                      approximateNote={application?.status === "accepted" ? undefined : t("fullAddressWhenYouWin")}
                    />
                  )}
                </div>
                {allMedia.length === 1 && !job.images?.length && !job.videos?.length && (
                  <div className="flex-shrink-0 flex flex-col gap-0.5 py-2 px-4 bg-background/80">
                    <p className="text-center text-xs text-muted-foreground">{displayAddress || t("generalArea")}</p>
                    {closestDriveTimeLoading ? (
                      <p className="text-center text-xs text-primary flex items-center justify-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t("estDriveTime")}…
                      </p>
                    ) : closestDriveTime ? (
                      <p className="text-center text-xs text-primary">
                        {t("estDriveTime")}: {closestDriveTime.duration}
                        {closestDriveTime.name && closestDriveTime.name !== (t("you") || "You") && ` (${t("closestTeammate", { name: closestDriveTime.name })})`}
                      </p>
                    ) : (
                      <p className="text-center text-xs text-primary">{t("tapForDriveTime")}</p>
                    )}
                  </div>
                )}
              </button>
            ) : allMedia[currentMediaIndex].type === "empty" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <MapPin className="w-10 h-10 opacity-50" />
                <p className="text-sm">{t("noGallery")}</p>
                <p className="text-xs">{t("addressNotProvided")}</p>
              </div>
            ) : null}
            {allMedia.length > 1 && (
              <>
                <button
                  onClick={() => { setImageLoaded(false); setCurrentMediaIndex(i => i > 0 ? i - 1 : allMedia.length - 1); }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white transition-colors z-30"
                  data-testid="media-prev"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => { setImageLoaded(false); setCurrentMediaIndex(i => i < allMedia.length - 1 ? i + 1 : 0); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white transition-colors z-30"
                  data-testid="media-next"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-30">
                  {allMedia.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => { setImageLoaded(false); setCurrentMediaIndex(idx); }}
                      className={`w-2 h-2 rounded-full transition-colors ${idx === currentMediaIndex ? 'bg-white' : 'bg-white/50'}`}
                    />
                  ))}
                </div>
                <div className="absolute top-14 right-2 flex items-center gap-1 bg-black/50 px-2 py-1 rounded text-white text-xs z-30">
                  {allMedia[currentMediaIndex].type === "video" ? <Play className="w-3 h-3" /> : allMedia[currentMediaIndex].type === "map" ? <MapPin className="w-3 h-3" /> : allMedia[currentMediaIndex].type === "empty" ? null : <ImageIcon className="w-3 h-3" />}
                  {currentMediaIndex + 1}/{allMedia.length}
                </div>
              </>
            )}
          </div>

          {/* Details card: flex + wrap so content stays inside popup; min-w-0 to allow shrink; no horizontal overflow */}
          <div className="relative bg-background rounded-t-[28px] -mt-16 flex-shrink-0 flex flex-col flex-wrap pl-4 sm:pl-6 pr-4 sm:pr-6 pt-6 pb-6 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] overflow-hidden min-w-0 w-full max-w-full box-border">
            {/* Application status: full-width sticky banner at top when in application view */}
            {application && (
              <div
                className={cn(
                  "sticky top-0 z-10 -mx-4 sm:-mx-6 mb-4 px-4 sm:px-6 py-3 flex items-center justify-center gap-2 flex-wrap",
                  application.status === "pending" && "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 border-y border-yellow-200 dark:border-yellow-800",
                  application.status === "accepted" && "bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 border-y border-green-200 dark:border-green-800",
                  application.status === "rejected" && "bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border-y border-red-200 dark:border-red-800"
                )}
              >
                <span className="text-sm font-semibold">
                  {application.status === "pending" && (t("pendingReview") || "Pending Review")}
                  {application.status === "accepted" && (t("accepted") || "Accepted")}
                  {application.status === "rejected" && (t("notSelected") || "Not selected")}
                </span>
                {allApps.length > 1 && (
                  <Badge variant="outline" className="bg-background/80 text-xs">
                    <Users className="w-3 h-3 mr-1" /> {t("workers", { count: allApps.length })}
                  </Badge>
                )}
              </div>
            )}

            {/* 1. Title row: title only (status in banner above when application) */}
            <div className="flex items-center justify-center w-full min-w-0">
              <h2 className="text-lg font-bold text-center min-w-0 max-w-full text-pretty break-words">{getDisplayJobTitle(job)}</h2>
            </div>

            {/* 2. Skill set related tags */}
            {(() => {
              const tags = [...(job.requiredSkills || []), ...(job.trade ? [job.trade] : []), ...(job.serviceCategory ? [job.serviceCategory] : [])];
              const seen = new Set<string>();
              const unique = tags.filter(tag => { const k = tag.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
              return unique.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-2 mt-3 min-w-0">
                  {unique.map((skill) => (
                    <Badge key={skill} variant="secondary" className="rounded-full cursor-pointer hover:bg-secondary/80" onClick={() => setShowSkillInfo(skill)} data-testid={`skill-badge-${skill}`}>
                      {skill}
                      <Info className="w-3 h-3 ml-1 opacity-60" />
                    </Badge>
                  ))}
                </div>
              ) : null;
            })()}

            {/* 3. Address — full when accepted, partial otherwise */}
            {displayAddress && (
              <p className="text-sm text-muted-foreground text-center mt-2">
                {displayAddress}
                {application?.status !== "accepted" && (
                  <span className="block mt-1 text-xs">{(t("fullAddressWhenSelected") || "You'll get the full address when you're selected for this project.")}</span>
                )}
              </p>
            )}

            {/* 4. Line separator */}
            <div className="border-b border-border/60 my-4" />

            {/* 5. First company block — simple, no card: logo, name, tenure */}
            {job.companyId && (
              <CompanyInlineSimple company={companyProfileInline} t={t} />
            )}

            {/* 6. Line separator */}
            <div className="border-b border-border/60 my-4" />

            {/* 7. 3-row icon list: A) Time/date/type; B) Participants; C) Est. profit */}
            <div className="space-y-4 min-w-0">
              <div className="flex items-start gap-3 min-w-0">
                <Calendar className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 overflow-hidden">
                  {(() => {
                    const ti = formatJobTime(job, t);
                    const dayLabel = ti.relative === t("past") ? ti.fullDate : ti.relative;
                    const headline = ti.scheduleDaysDisplay
                      ? `${ti.scheduleDaysDisplay}${ti.timeRange ? ` · ${ti.timeRange}` : ""}`
                      : `${dayLabel}${ti.timeRange ? ` · ${ti.timeRange}` : ""}`;
                    const subline =
                      job.jobType === "recurring"
                        ? (ti.schedulePeriodDisplay || ti.fullDate)
                        : jobTypeInfo.label;
                    return (
                      <>
                        <p className="font-semibold truncate">{headline}</p>
                        <p className="text-sm text-muted-foreground">{subline}</p>
                      </>
                    );
                  })()}
                </div>
              </div>
              {/* Participants: company seeking X + slots (empty/filled) + pill-shaped pool — collapsible; hidden on stage 2 (participants step) of inline apply; hidden in application view */}
              {showParticipantsSection && !application && !(inlineApplyMode && inlineApplyStage === 2) && (
              <Collapsible defaultOpen className="group/participants-details min-w-0 overflow-hidden">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-2 py-1 text-left rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Users className="w-4 h-4" />
                      {workersNeeded === 1
                        ? (t("participantsSeekingOne") || "1 participant")
                        : (t("participantsSeeking", { count: workersNeeded }) || `${workersNeeded} participants`)}
                    </p>
                    <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
                      {t("companySeeking") || "Company seeking"} · {selectedApplicants.size}/{workersNeeded} {t("selected") || "selected"}
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 group-data-[state=closed]/participants-details:rotate-[-90deg]" />
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
              <div className="space-y-1.5 pt-1 min-w-0 overflow-hidden">
                <div className="flex flex-wrap gap-1.5 items-center min-w-0">
                  {Array.from({ length: workersNeeded }, (_, i) => slotOrder[i] ?? null).map((key, idx) => {
                    if (key === null) {
                      return (
                        <div
                          key={`empty-details-${idx}`}
                          className="w-9 h-9 rounded-full border-2 border-dashed border-muted-foreground/30 bg-muted/20 flex items-center justify-center flex-shrink-0"
                        >
                          <Users className="w-3.5 h-3.5 text-muted-foreground/40" />
                        </div>
                      );
                    }
                    const filled = selectedApplicants.has(key);
                    const isSelf = key === "self";
                    const person = isSelf ? profile : acceptedTeamMembers.find((m) => m.id === key);
                    const avatarUrl = normalizeAvatarUrl((person as { avatarUrl?: string | null })?.avatarUrl ?? undefined);
                    const initials = isSelf
                      ? `${(profile?.firstName ?? "")[0] || ""}${(profile?.lastName ?? "")[0] || ""}`.trim() || "?"
                      : (person as TeamMemberBasic)?.firstName?.[0] && (person as TeamMemberBasic)?.lastName?.[0]
                        ? `${(person as TeamMemberBasic).firstName![0]}${(person as TeamMemberBasic).lastName![0]}`
                        : "?";
                    const name = isSelf ? (t("myself") || "Myself") : `${(person as TeamMemberBasic)?.firstName ?? ""} ${(person as TeamMemberBasic)?.lastName ?? ""}`.trim();
                    return (
                      <button
                        key={`slot-details-${idx}-${key}`}
                        type="button"
                        onClick={() => {
                          if (filled) {
                            setSelectedApplicants((prev) => {
                              const next = new Set(prev);
                              next.delete(key);
                              return next;
                            });
                          }
                        }}
                        className={cn(
                          "flex-shrink-0 rounded-full border-2 transition-all",
                          filled
                            ? "w-9 h-9 border-primary bg-primary/10 ring-2 ring-primary/20 hover:ring-primary/40"
                            : "w-9 h-9 border-dashed border-muted-foreground/40 bg-muted/30 hover:border-muted-foreground/60"
                        )}
                        title={filled ? name : undefined}
                      >
                        {filled ? (
                          <Avatar className="w-full h-full border-0">
                            <AvatarImage src={avatarUrl} />
                            <AvatarFallback className="text-[10px] bg-primary/20 text-primary">{initials}</AvatarFallback>
                          </Avatar>
                        ) : (
                          <span className="w-full h-full flex items-center justify-center text-muted-foreground/50">
                            <Users className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t("participantsAssignHint") || "Tap a person below to fill a slot, or tap a filled slot to clear."}
                </p>
                {acceptedTeamMembers.length === 0 && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground flex flex-col gap-1.5 min-w-0 overflow-hidden">
                    <p className="flex items-start gap-2 min-w-0">
                      <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
                      <span className="break-words text-pretty">{t("addTeammateToGetPaidHint") || "If you're contracting this job to someone else you must add them as a teammate, else you cannot get paid."}</span>
                    </p>
                    <a
                      href="/dashboard/business-operator"
                      onClick={(e) => { e.preventDefault(); setLocation("/dashboard/business-operator"); onClose(); }}
                      className="text-primary font-medium hover:underline inline-flex items-center gap-1 w-fit"
                    >
                      {t("addTeammatesLink") || "Add teammates"}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
                {/* Legend/Key for icons + Settings Gear */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground border border-border/50 bg-muted/30 rounded-lg px-2 py-1.5 flex-1">
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-green-600" />
                            <span>Within territory</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Within job location radius</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-muted-foreground" />
                            <span>Not within</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Outside job location radius</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1">
                            <Wrench className="w-3 h-3 text-green-600" />
                            <span>Skills match</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Worker has required skills for this job</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-green-600" />
                            <span>Available</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Worker is available during job time</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-amber-500" />
                            <span>Conflict</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Worker has schedule conflict</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0 flex-shrink-0"
                        onClick={() => setTeammateSettingsOpen(true)}
                      >
                        <Settings2 className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Manage teammate details</TooltipContent>
                  </Tooltip>
                </div>
                {(() => {
                  // Same 1:1 grouping as card layout: available workers by territory, then conflicts separate
                  const inTerritoryPills = availableWorkers.filter((w) => w.inTerritory);
                  const outsideTerritoryPills = availableWorkers.filter((w) => !w.inTerritory);
                  const renderPill = ({ p, skillMatch, available, inTerritory }: { p: TeamMemberBasic | Profile; skillMatch: boolean; available: boolean; inTerritory: boolean }) => {
                    const pr = p as TeamMemberBasic & { id?: number; firstName?: string; lastName?: string; avatarUrl?: string | null };
                    const poolKey: "self" | number = profile && p === profile ? "self" : (pr as TeamMemberBasic).id;
                    const selected = selectedApplicants.has(poolKey);
                    const atCapacity = selectedApplicants.size >= workersNeeded && !selected;
                    const initials = (pr.firstName?.[0] && pr.lastName?.[0]) ? `${pr.firstName[0]}${pr.lastName[0]}` : "?";
                    const name = (pr.firstName && pr.lastName) ? `${pr.firstName} ${pr.lastName}`.trim() : (t("myself") || "Myself");
                    const avatarSrc = normalizeAvatarUrl(pr.avatarUrl ?? undefined);
                    return (
                      <button
                        key={String(poolKey)}
                        type="button"
                        onClick={() => {
                          setSelectedApplicants((prev) => {
                            const next = new Set(prev);
                            if (next.has(poolKey)) {
                              next.delete(poolKey);
                            } else {
                              if (next.size < workersNeeded) next.add(poolKey);
                            }
                            return next;
                          });
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 border-2 transition-all text-left min-w-0",
                          selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/50",
                          atCapacity && !selected && "opacity-50",
                          !inTerritory && "opacity-60"
                        )}
                        title={name}
                      >
                        <Avatar className={cn("w-6 h-6 border-2 border-background flex-shrink-0", !available && "opacity-70")}>
                          <AvatarImage src={avatarSrc ?? undefined} />
                          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                        </Avatar>
                        <span className="text-xs font-medium truncate">{name}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex-shrink-0">
                              <MapPin className={cn("w-3 h-3", inTerritory ? "text-green-600" : "text-muted-foreground")} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{inTerritory ? "Within job territory" : "Not within job territory"}</TooltipContent>
                        </Tooltip>
                        {skillMatch && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex-shrink-0">
                                <Wrench className="w-3 h-3 text-green-600" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Has required skills</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex-shrink-0">
                              <Calendar className={cn("w-3 h-3", available ? "text-green-600" : "text-amber-500")} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{available ? "Available" : "Has schedule conflict"}</TooltipContent>
                        </Tooltip>
                      </button>
                    );
                  };
                  return (
                    <>
                      <div className="space-y-1.5 min-w-0 overflow-hidden">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-green-600" />
                          {t("withinJobLocation") || "Within job location"}
                        </p>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 py-0.5 min-w-0">
                          {inTerritoryPills.map((item) => renderPill(item))}
                        </div>
                      </div>
                      {outsideTerritoryPills.length > 0 && (
                        <div className="space-y-1.5 pt-1 min-w-0 overflow-hidden">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {t("teammateOutsideJobLocation") || "Outside job location"}
                          </p>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 py-0.5 min-w-0">
                            {outsideTerritoryPills.map((item) => renderPill(item))}
                          </div>
                        </div>
                      )}
                      {conflictWorkers.length > 0 && (
                        <div className="space-y-1.5 pt-1 min-w-0 overflow-hidden">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {t("teammatesWithSchedulingConflicts") || "Teammates with scheduling conflicts"}
                          </p>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 py-0.5 min-w-0">
                            {conflictWorkers.map((item) => renderPill(item))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
                </CollapsibleContent>
              </Collapsible>
              )}
              <div className="flex items-start gap-3 min-w-0">
                <DollarSign className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="font-semibold">
                    {application
                      ? (allApps.length > 1 ? t("combinedPayout") : (t("amountSubmitted") || "Amount submitted"))
                      : (t("estimatedPayout") || "Estimated payout")}
                  </p>
                  {!application && (
                    <div className="text-sm text-muted-foreground break-words">
                      ${Math.round(livePreSubmitPayout).toLocaleString()}
                      {" — "}
                      {(() => {
                        const rateForFormula =
                          getSelectedRateInline ?? getWorkerHourlyRate(profile?.hourlyRate ?? undefined, job.hourlyRate ?? 0);
                        const pieces = getPayoutBreakdownPieces(
                          payoutBreakdown.totalHours,
                          payoutBreakdown.days,
                          rateForFormula,
                          livePreSubmitPayout
                        );
                        return (
                          <>
                            {pieces.prefix}
                            <Popover open={rateEditorOpen} onOpenChange={setRateEditorOpen}>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary/15"
                                  onClick={() => {
                                    const seed = Math.round(rateForFormula || 0);
                                    setRateEditorDraft(seed > 0 ? String(seed) : "");
                                  }}
                                  data-testid="edit-inline-rate-tag"
                                >
                                  {pieces.rateLabel}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent align="start" sideOffset={6} className="w-44 p-2">
                                <Label className="text-[11px] text-muted-foreground">{t("hourlyRate") || "Hourly rate"}</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={rateEditorDraft}
                                  onChange={(e) => setRateEditorDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const n = Number(rateEditorDraft);
                                      if (Number.isFinite(n) && n > 0) {
                                        setCustomInlineRate(n);
                                        setUseSmartRateInline(false);
                                        setRateEditorOpen(false);
                                      }
                                    }
                                    if (e.key === "Escape") setRateEditorOpen(false);
                                  }}
                                  className="mt-1 h-8"
                                  data-testid="edit-inline-rate-input"
                                />
                                <div className="mt-2 flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                      setCustomInlineRate(null);
                                      setRateEditorOpen(false);
                                    }}
                                  >
                                    {tCommon("reset") || "Reset"}
                                  </button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                      const n = Number(rateEditorDraft);
                                      if (Number.isFinite(n) && n > 0) {
                                        setCustomInlineRate(n);
                                        setUseSmartRateInline(false);
                                        setRateEditorOpen(false);
                                      }
                                    }}
                                  >
                                    {tCommon("apply") || "Apply"}
                                  </Button>
                                </div>
                              </PopoverContent>
                            </Popover>
                            {pieces.suffix}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
                {!application && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomInlineRate(null);
                      setRateEditorOpen(false);
                      setUseSmartRateInline((prev) => !prev);
                    }}
                    className="flex-shrink-0 text-sm text-primary hover:underline font-medium"
                    data-testid="toggle-use-my-rate"
                  >
                    {useSmartRateInline ? (t("useMyRate") || "Use my rate") : (t("useSuggestedRate") || "Use suggested rate")}
                  </button>
                )}
                  {application && (
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p className="break-words">
                        ${Math.round(livePreSubmitPayout).toLocaleString()}
                        {allApps.length === 1 && (
                          <> {" — "}{formatPayoutBreakdown(
                            payoutBreakdown.totalHours,
                            payoutBreakdown.hoursPerDay,
                            payoutBreakdown.days,
                            rateToDollars(application.proposedRate ?? profile?.hourlyRate ?? (job.hourlyRate ? job.hourlyRate / 100 : 0)),
                            displayPayout
                          )}</>
                        )}
                      </p>
                      {(() => {
                        const jobCoordsApp = jobLatLngOrGeocoded;
                        const radiusMilesApp = territoryRadiusMiles ?? DEFAULT_JOB_TERRITORY_RADIUS_MILES;
                        const inTerritoryForApp = (app: typeof allApps[0]) => {
                          if (!jobCoordsApp || !Number.isFinite(jobCoordsApp.lat) || !Number.isFinite(jobCoordsApp.lng)) return true;
                          const member = app.teamMember;
                          const lat = member != null && (member as any).latitude != null ? parseFloat(String((member as any).latitude)) : (workerLocation?.lat ?? (profile && (profile as any).latitude != null ? parseFloat(String((profile as any).latitude)) : null));
                          const lng = member != null && (member as any).longitude != null ? parseFloat(String((member as any).longitude)) : (workerLocation?.lng ?? (profile && (profile as any).longitude != null ? parseFloat(String((profile as any).longitude)) : null));
                          if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
                          return calculateDistance(jobCoordsApp.lat, jobCoordsApp.lng, lat, lng) <= radiusMilesApp;
                        };
                        const inTerritoryApps = allApps.filter(inTerritoryForApp);
                        const outsideTerritoryApps = allApps.filter((app) => !inTerritoryForApp(app));
                        const renderAppPill = (app: typeof allApps[0]) => {
                          const member = app.teamMember;
                          const displayName = member ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() : (t("myself") || "Myself");
                          const appliedRate = rateToDollars(app.proposedRate ?? profile?.hourlyRate ?? (job.hourlyRate ? job.hourlyRate / 100 : 0));
                          const canReassign = (application.status === "pending" || application.status === "accepted") && onAssignTeamMember && (activeTeamMembers.length > 0 || allApps.length > 1);
                          const pillContent = (
                            <>
                              <Avatar className="w-6 h-6 rounded-full border border-border flex-shrink-0">
                                <AvatarImage src={normalizeAvatarUrl((member?.avatarUrl ?? operatorAvatarUrl) ?? profile?.avatarUrl) ?? undefined} />
                                <AvatarFallback className="text-[10px]">{member ? `${member.firstName?.[0] ?? ""}${member.lastName?.[0] ?? ""}` : `${profile?.firstName?.[0] ?? ""}${profile?.lastName?.[0] ?? ""}`}</AvatarFallback>
                              </Avatar>
                              <span className="font-medium text-foreground/90">{displayName}</span>
                              <span className="text-muted-foreground">${Math.round(appliedRate)}/hr</span>
                            </>
                          );
                          return canReassign ? (
                            <button
                              key={app.id}
                              type="button"
                              onClick={() => {
                                setSelectedAppForReassign(app);
                                setShowApplicationTeamPicker(true);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs hover:bg-muted transition-colors"
                              data-testid={`application-pill-${app.id}`}
                            >
                              {pillContent}
                              <ChevronRight className="w-3 h-3 text-muted-foreground" />
                            </button>
                          ) : (
                            <div key={app.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs" data-testid={`application-pill-${app.id}`}>
                              {pillContent}
                            </div>
                          );
                        };
                        return (
                          <div className="space-y-2">
                            <div className="space-y-1.5 min-w-0">
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-green-600" />
                                {t("withinJobLocation") || "Within job location"}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {inTerritoryApps.map(renderAppPill)}
                              </div>
                            </div>
                            {outsideTerritoryApps.length > 0 && (
                              <div className="space-y-1.5 min-w-0">
                                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  {t("teammateOutsideJobLocation") || "Outside job location"}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {outsideTerritoryApps.map(renderAppPill)}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Content below estimated payout — consistent padding (pt-6 pb-6 px-6) */}
            <div className="pt-6 pb-6 px-6">
            {/* 8. Line separator */}
            <div className="border-b border-border/60 my-4" />

            {/* 9. Job description with show more/less */}
            {job.description && <DescriptionBlock text={job.description} threshold={60} label={t("aboutThisJob")} t={t} />}

            {/* 10. Line separator */}
            <div className="border-b border-border/60 my-4" />

            {/* 11. Where you'll be — vertical map, no container */}
            {job.latitude && job.longitude && (
              <>
                <div className="flex items-start gap-3 mb-2">
                  <MapPin className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">{t("whereYoullBe") || "Where you'll be"}</p>
                    <p className="text-sm text-muted-foreground">{displayAddress || [job.city, job.state].filter(Boolean).join(", ")}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPopupView("map")}
                  className="w-full overflow-hidden h-72 bg-muted block"
                  data-testid="job-map-button-where-youll-be"
                >
                  <MiniJobMap
                    job={{ id: job.id, lat: parseFloat(job.latitude), lng: parseFloat(job.longitude), title: getDisplayJobTitle(job) }}
                    height="288px"
                    className="w-full"
                    partialAddress={(application?.status === "accepted" ? displayAddress : partialAddress) || undefined}
                    showApproximateRadius
                    approximateNote={application?.status === "accepted" ? undefined : t("fullAddressWhenYouWin")}
                    personLocations={personLocationsForMap}
                  />
                </button>
              </>
            )}

            {/* 12. Line separator */}
            <div className="border-b border-border/60 my-4" />

            {/* 13. Calendar — job date, conflict status, Your day (compact); teammates availability */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {tCal("yourDay") || "Your day"}
              </h3>
              {jobStart && (
                <>
                  <div className="p-3 rounded-xl bg-muted/50">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{tCal("jobScheduledFor") || "Job scheduled for"}</p>
                    <p className="font-semibold text-sm">{format(jobStart, "EEEE, MMM d")}</p>
                    {jobEnd && (
                      <p className="text-xs text-muted-foreground">
                        {format(jobStart, "h:mm a")} – {format(jobEnd, "h:mm a")}
                        {job.estimatedHours && ` · ${tCal("hours", { count: job.estimatedHours })}`}
                      </p>
                    )}
                  </div>
                  <div className={cn(
                    "p-3 rounded-xl border flex items-center justify-between gap-2 flex-wrap",
                    scheduledJobsAndConflicts.conflicts.length > 0 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
                  )}>
                    <div className="flex items-center gap-2 min-w-0">
                      {scheduledJobsAndConflicts.conflicts.length > 0 ? (
                        <>
                          <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-amber-800 dark:text-amber-200">{tCal("schedulingConflict") || "Scheduling conflict"}</p>
                            <p className="text-xs text-amber-600 dark:text-amber-400">{tCal("jobsOverlap", { count: scheduledJobsAndConflicts.conflicts.length }) || `${scheduledJobsAndConflicts.conflicts.length} overlap`}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-green-800 dark:text-green-200">{tCal("noConflicts") || "No conflicts"}</p>
                            <p className="text-xs text-green-600 dark:text-green-400">{tCal("jobFitsSchedule") || "Job fits your schedule"}</p>
                          </div>
                        </>
                      )}
                    </div>
                    {/* Selected user(s) on the right */}
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {application
                        ? allApps.map((app) => {
                            const member = app.teamMember;
                            const pr = member ?? profile;
                            if (!pr) return null;
                            const p = pr as { firstName?: string | null; lastName?: string | null; avatarUrl?: string | null };
                            const initials = p.firstName?.[0] && p.lastName?.[0] ? `${p.firstName[0]}${p.lastName[0]}` : "?";
                            const avatarSrc = normalizeAvatarUrl(member ? (p.avatarUrl ?? operatorAvatarUrl ?? undefined) : p.avatarUrl ?? undefined);
                            return (
                              <Avatar key={app.id} className="w-7 h-7 border-2 border-background">
                                <AvatarImage src={avatarSrc ?? undefined} />
                                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                              </Avatar>
                            );
                          })
                        : Array.from({ length: workersNeeded }, (_, i) => slotOrder[i] ?? null).map((key, idx) => {
                            if (key === null) return null;
                            const filled = selectedApplicants.has(key);
                            if (!filled) return null;
                            const isSelf = key === "self";
                            const person = isSelf ? profile : acceptedTeamMembers.find((m) => m.id === key);
                            const initials = isSelf
                              ? `${(profile?.firstName ?? "")[0] || ""}${(profile?.lastName ?? "")[0] || ""}`.trim() || "?"
                              : (person as TeamMemberBasic)?.firstName?.[0] && (person as TeamMemberBasic)?.lastName?.[0]
                                ? `${(person as TeamMemberBasic).firstName![0]}${(person as TeamMemberBasic).lastName![0]}`
                                : "?";
                            return (
                              <Avatar key={`slot-${idx}-${key}`} className="w-7 h-7 border-2 border-background">
                                <AvatarImage src={normalizeAvatarUrl((person as { avatarUrl?: string | null })?.avatarUrl ?? undefined)} />
                                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                              </Avatar>
                            );
                          })}
                    </div>
                  </div>
                  {scheduledJobsAndConflicts.scheduled.length > 0 && (
                    <div className="space-y-1">
                      <div className="relative border-l-2 border-primary/30 ml-2.5 pl-3 py-1.5">
                        <div className="absolute -left-1.5 top-1.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-background" />
                        <p className="text-[10px] text-muted-foreground mb-0.5">{tCal("thisJob") || "This job"}</p>
                        <div className="bg-primary/10 border border-primary/30 rounded-lg px-2.5 py-2">
                          <p className="font-medium text-xs truncate">{getDisplayJobTitle(job)}</p>
                          <p className="text-[10px] text-muted-foreground">{jobStart && format(jobStart, "h:mm a")} – {jobEnd && format(jobEnd, "h:mm a")}</p>
                        </div>
                      </div>
                      {scheduledJobsAndConflicts.scheduled.filter((ev) => ev.id !== job.id).map((ev) => {
                        const isConflict = scheduledJobsAndConflicts.conflicts.some((c) => c.id === ev.id);
                        return (
                          <div key={ev.id} className={cn("relative border-l-2 ml-2.5 pl-3 py-1.5", isConflict ? "border-amber-500" : "border-muted")}>
                            <div className={cn("absolute -left-1.5 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-background", isConflict ? "bg-amber-500" : "bg-muted-foreground/30")} />
                            <div className={cn("rounded-lg px-2.5 py-2", isConflict ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800" : "bg-muted/50")}>
                              <p className="font-medium text-xs truncate">{getDisplayJobTitle(ev)}</p>
                              <p className="text-[10px] text-muted-foreground">{format(ev.start, "h:mm a")} – {format(ev.end, "h:mm a")}</p>
                              {isConflict && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">{tCal("overlapsWithThisJob") || "Overlaps"}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <Button variant="outline" className="w-full rounded-xl text-sm h-9" onClick={() => setPopupView("calendar")}>
                    <CalendarCheck className="w-4 h-4 mr-2" />
                    {t("checkCalendar") || "Check calendar"} / {tCal("teamAvailability") || "Team availability"}
                  </Button>
                </>
              )}
            </div>

            {/* 14. Line separator */}
            <div className="border-b border-border/60 my-4" />

            {/* 15. Meet the company card (second) + Message company (hidden in application view) */}
            {job.companyId && (
              <MeetCompanyCard company={companyProfileInline} job={job} companyJobsCount={companyJobsCount?.count} companyLocationsCount={companyLocationsCount?.count} t={t} format={format} showMessageButton={!application} onMessageCompany={() => { setStage(2); setShowInlineApply(true); }} />
            )}

            {/* 16. Line separator */}
            <div className="border-b border-border/60 my-4" />

            {/* 17. Things to know (icon list) */}
            <ThingsToKnowBlock profile={profile} t={t} onCancellation={() => setPopupView("cancellation")} onInsurance={() => setPopupView("insurance")} onIdVerification={() => setPopupView("id")} onW9={() => setPopupView("w9")} />

            <div className="border-b border-border/60 my-4" />
            {/* 18. Report this listing */}
            <div className="pt-4">
              <button type="button" onClick={() => setPopupView("report")} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground underline">
                <Flag className="w-4 h-4" />
                {t("reportThisListing") || "Report this listing"}
              </button>
            </div>

            {/* 19. Timesheet accordion — accepted application only */}
            {application?.status === "accepted" && (
              <div className="bg-card rounded-xl shadow-sm border overflow-hidden mt-4" data-testid="timesheet-section">
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="timesheets" className="border-0">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline" data-testid="accordion-timesheets">
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
                        <span className="font-semibold">{t("timeAndEarnings")}</span>
                        {timesheets.length > 0 && (
                          <Badge variant="secondary" className="ml-2">{t("entries", { count: timesheets.length })}</Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      {timesheetsLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : timesheets.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground">
                          <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">{t("noTimeEntriesYet")}</p>
                          <p className="text-xs">{t("clockInToStartTracking")}</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="space-y-3">
                            {timesheets.map((ts) => {
                              const hours = parseFloat(ts.adjustedHours || ts.totalHours || "0");
                              const rateInDollars = (ts.hourlyRate || 0) / 100;
                              const payout = hours * rateInDollars;
                              const clockIn = ts.clockInTime ? new Date(ts.clockInTime) : null;
                              const clockOut = ts.clockOutTime ? new Date(ts.clockOutTime) : null;
                              return (
                                <div key={ts.id} className="bg-secondary/30 rounded-lg p-3 space-y-2" data-testid={`timesheet-entry-${ts.id}`}>
                                  <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium">{clockIn ? format(clockIn, "EEE, MMM d, yyyy") : t("unknownDate")}</div>
                                    {getPaymentStatusBadge(ts)}
                                  </div>
                                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                    <div className="flex items-center gap-1">
                                      <Play className="w-3 h-3" />
                                      <span>{clockIn ? format(clockIn, "h:mm a") : "--:--"}</span>
                                    </div>
                                    <span>-</span>
                                    <div className="flex items-center gap-1">
                                      <X className="w-3 h-3" />
                                      <span>{clockOut ? format(clockOut, "h:mm a") : t("active")}</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between pt-1 border-t border-border/50">
                                    <div className="text-sm">
                                      <span className="text-muted-foreground">{t("hours", { hours: hours.toFixed(2) })}</span>
                                      <span className="text-muted-foreground/70"> @ ${rateInDollars.toFixed(0)}/hr</span>
                                    </div>
                                    <div className="font-semibold text-green-600 dark:text-green-400">${payout.toFixed(2)}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {timesheetSummary && (
                            <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-lg p-4 border border-green-100 dark:border-green-900/50" data-testid="timesheet-summary">
                              <h4 className="text-sm font-semibold text-muted-foreground mb-3">{t("summary")}</h4>
                              <div className="flex items-center justify-between mb-3">
                                <div>
                                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">${timesheetSummary.totalPayout}</p>
                                  <p className="text-xs text-muted-foreground">{t("hoursWorked", { hours: timesheetSummary.totalHours })}</p>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2 pt-2 border-t border-green-200 dark:border-green-800/50">
                                {timesheetSummary.paidCount > 0 && (
                                  <div className="flex items-center gap-1 text-xs">
                                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                                    <span className="text-muted-foreground">{t("paidCount", { count: timesheetSummary.paidCount })}</span>
                                  </div>
                                )}
                                {timesheetSummary.processingCount > 0 && (
                                  <div className="flex items-center gap-1 text-xs">
                                    <Loader2 className="w-3 h-3 text-blue-600 animate-spin" />
                                    <span className="text-muted-foreground">{t("transferringCount", { count: timesheetSummary.processingCount })}</span>
                                  </div>
                                )}
                                {timesheetSummary.approvedCount > 0 && (
                                  <div className="flex items-center gap-1 text-xs">
                                    <Check className="w-3 h-3 text-purple-600" />
                                    <span className="text-muted-foreground">{t("submittedCount", { count: timesheetSummary.approvedCount })}</span>
                                  </div>
                                )}
                                {timesheetSummary.pendingCount > 0 && (
                                  <div className="flex items-center gap-1 text-xs">
                                    <Clock className="w-3 h-3 text-yellow-600" />
                                    <span className="text-muted-foreground">{t("pendingCount", { count: timesheetSummary.pendingCount })}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            )}
            </div>
          </div>
          
          {isMobile && <div className="h-24" />}
        </div>
        
        {/* Sticky footer: application view = Withdraw / Get Directions / Assign; else Apply */}
        <div className={`flex-shrink-0 border-t bg-background ${isMobile ? 'fixed bottom-0 left-0 right-0 z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]' : ''}`}>
          {!application && (
            <div className="flex h-1 w-full bg-muted overflow-hidden" aria-hidden>
              <div className={cn("h-full flex-1 transition-all", stage >= 1 && "bg-primary")} />
              <div className={cn("h-full flex-1 transition-all", stage >= 2 && "bg-primary")} />
            </div>
          )}
          <div className="flex flex-row items-center justify-between gap-4 p-4 sm:p-6">
            {application?.status !== "accepted" && (
              <div className="flex flex-col min-w-0 text-left flex-1">
                {isMobile ? (
                  <button
                    type="button"
                    onClick={() => setMobileFooterDetailsExpanded((v) => !v)}
                    className="flex items-center gap-2 flex-wrap text-left w-full rounded-lg -m-1 p-1 hover:bg-muted/50"
                    data-testid="mobile-footer-details-toggle"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-lg font-bold tracking-tight">${Math.round(livePreSubmitPayout).toLocaleString()}</p>
                      {!application && stage === 1 && onDismiss && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onDismiss(job); }} className="flex-shrink-0 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="enhanced-dismiss-button">
                          <X className="w-4 h-4" />
                          {t("skip")}
                        </button>
                      )}
                    </div>
                    {mobileFooterDetailsExpanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                  </button>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-lg font-bold tracking-tight">${Math.round(livePreSubmitPayout).toLocaleString()}</p>
                      {!application && stage === 1 && onDismiss && (
                        <button type="button" onClick={() => onDismiss(job)} className="flex-shrink-0 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="enhanced-dismiss-button">
                          <X className="w-4 h-4" />
                          {t("skip")}
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {application ? (
                        <>{job.estimatedHours ?? 8} hrs{allApps.length > 1 ? ` · ${allApps.length} ${t("workers", { count: allApps.length })}` : ""} · {jobTypeInfo.label}</>
                      ) : (
                        <>
                          {selectedApplicants.size > 0 && selectedApplicants.size !== 1 && (
                            <>{selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × </>
                          )}
                          {job.estimatedHours ?? 8} hrs
                          {job.startDate && (
                            <> · {format(new Date(job.startDate), "MMM d")}
                              {job.endDate ? ` – ${format(new Date(job.endDate), "MMM d")}` : (job.estimatedHours ?? 8) > 0 ? ` – ${format(addHours(new Date(job.startDate), job.estimatedHours ?? 8), "MMM d")}` : ""}
                            </>
                          )}
                          {` · ${jobTypeInfo.label}`}
                        </>
                      )}
                    </p>
                  </>
                )}
                {isMobile && mobileFooterDetailsExpanded && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {application ? (
                      <>{job.estimatedHours ?? 8} hrs{allApps.length > 1 ? ` · ${allApps.length} ${t("workers", { count: allApps.length })}` : ""} · {jobTypeInfo.label}</>
                    ) : (
                      <>
                        {selectedApplicants.size > 0 && selectedApplicants.size !== 1 && (
                          <>{selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × </>
                        )}
                        {job.estimatedHours ?? 8} hrs
                        {job.startDate && (
                          <> · {format(new Date(job.startDate), "MMM d")}
                            {job.endDate ? ` – ${format(new Date(job.endDate), "MMM d")}` : (job.estimatedHours ?? 8) > 0 ? ` – ${format(addHours(new Date(job.startDate), job.estimatedHours ?? 8), "MMM d")}` : ""}
                          </>
                        )}
                        {` · ${jobTypeInfo.label}`}
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
            {application ? (
              <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto sm:min-w-[140px]">
                {application.status === "accepted" && (
                  <div className="flex flex-wrap gap-2">
                    {onGetDirections && (
                      <Button className="flex-1 min-w-0" onClick={() => onGetDirections(job)} data-testid="button-get-directions">
                        <Navigation className="w-4 h-4 mr-2" />
                        {t("getDirections")}
                      </Button>
                    )}
                    <Button variant="outline" className="flex-1 min-w-0" asChild data-testid="button-message-job">
                      <a href={`/accepted-job/${job.id}`}>
                        <MessageSquare className="w-4 h-4 mr-2" />
                        {t("message")}
                      </a>
                    </Button>
                    <Button variant="outline" className="flex-1 min-w-0" onClick={() => setMaterialInvoiceOpen(true)} data-testid="button-material-invoice">
                      <Receipt className="w-4 h-4 mr-2" />
                      Material Invoice
                    </Button>
                  </div>
                )}
                {application.status === "pending" && (allApps.length > 1 ? onWithdrawAll : onWithdraw) && (
                  <Button
                    variant="destructive"
                    className="w-full mt-[11px] mb-[11px]"
                    onClick={() => {
                      setWithdrawReason(null);
                      setWithdrawStep("reason");
                      setShowWithdrawStep(true);
                    }}
                    disabled={isWithdrawing}
                    data-testid="button-withdraw-application"
                  >
                    {allApps.length > 1 ? t("withdrawAllWorkers", { count: allApps.length }) : t("withdrawApplication")}
                  </Button>
                )}
              </div>
            ) : (
              <Button
                className="h-12 min-w-[140px] text-base font-semibold rounded-xl shadow-lg bg-gradient-to-r from-[#00A86B] to-[#008A57] hover:from-[#008A57] hover:to-[#006B44] text-white border-0 flex-shrink-0"
                onClick={() => {
                  if (selectedApplicants.size >= workersNeeded) {
                    setUseSmartRateInline(true);
                    setInlineApplyStage(3);
                    setStage(2);
                    setShowInlineApply(true);
                  } else {
                    setInlineApplyStage(2);
                    setStage(2);
                    setShowInlineApply(true);
                  }
                }}
                data-testid="enhanced-apply-button"
              >
                {selectedApplicants.size >= workersNeeded ? (t("applyNow") || "Apply Now") : (tCommon("next") || "Next")}
              </Button>
            )}
          </div>
        </div>
      
      {/* Drive Time Popup */}
      {job.latitude && job.longitude && (
        <DriveTimePopup
          open={showDriveTime}
          onOpenChange={setShowDriveTime}
          job={{
            id: job.id,
            title: getDisplayJobTitle(job),
            address: job.address || "",
            city: job.city || "",
            state: job.state || "",
            latitude: job.latitude,
            longitude: job.longitude,
          }}
          userLocation={workerLocation || null}
          isMobile={isMobile}
          isAccepted={false}
        />
      )}

      {/* Material Invoice (accepted job only) */}
      {application?.status === "accepted" && (
        <MaterialInvoiceDialog
          open={materialInvoiceOpen}
          onOpenChange={setMaterialInvoiceOpen}
          jobId={job.id}
          jobTitle={getDisplayJobTitle(job) || "Job"}
        />
      )}

      {/* Full-page gallery slider (map click opens this instead of drive-time popup) */}
      <Dialog open={showFullPageGallery} onOpenChange={setShowFullPageGallery}>
        <DialogContent className="max-w-none w-[100vw] h-[100dvh] h-screen p-0 gap-0 rounded-none border-0 bg-black overflow-hidden [&>button]:hidden">
          <DialogTitle className="sr-only">{t("gallery")} – {getDisplayJobTitle(job)}</DialogTitle>
          <DialogDescription className="sr-only">{allMedia.length} {t("gallery")} slides</DialogDescription>
          <FullPageGallerySlider
            allMedia={allMedia}
            job={job}
            workerLocation={workerLocation ?? undefined}
            initialIndex={fullPageGalleryStartIndex}
            onClose={() => setShowFullPageGallery(false)}
            t={t}
            tCommon={tCommon}
            partialAddress={(application?.status === "accepted" ? displayAddress : partialAddress) ?? undefined}
            approximateNote={application?.status === "accepted" ? undefined : t("fullAddressWhenYouWin")}
          />
        </DialogContent>
      </Dialog>
      
      {/* Job Type Info Popup */}
      <Dialog open={showJobTypeInfo} onOpenChange={setShowJobTypeInfo}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogTitle className="flex items-center gap-2">
            <Badge className={`${jobTypeInfo.color} text-white`}>{jobTypeInfo.label}</Badge>
            {t("jobType")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("informationAboutJobType")}</DialogDescription>
          <div className="space-y-4 pt-2">
            <p className="text-muted-foreground">{jobTypeInfo.tooltip}</p>
            <div className="bg-secondary/50 rounded-xl p-4 space-y-2">
              {job.jobType === "recurring" ? (
                <>
                  <p className="font-medium">{t("whatThisMeansForYou")}</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• {t("regularScheduledShifts")}</li>
                    <li>• {t("consistentIncomeOpportunity")}</li>
                    <li>• {t("setScheduleEachWeek")}</li>
                  </ul>
                </>
              ) : job.jobType === "on_demand" || job.isOnDemand ? (
                <>
                  <p className="font-medium">{t("whatThisMeansForYou")}</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• {t("workWhenAvailable")}</li>
                    <li>• {t("clockInAnytimeDuringJobPeriod")}</li>
                    <li>• {t("flexibleScheduling")}</li>
                  </ul>
                </>
              ) : (
                <>
                  <p className="font-medium">{t("whatThisMeansForYou")}</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• {t("fixedStartAndEndTime")}</li>
                    <li>• {t("completeInOneSession")}</li>
                    <li>• {t("knowExactlyWhenDone")}</li>
                  </ul>
                </>
              )}
            </div>
            <Button className="w-full" onClick={() => setShowJobTypeInfo(false)}>
              {tCommon("gotIt")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Skill Info Popup */}
      <Dialog open={!!showSkillInfo} onOpenChange={(open) => !open && setShowSkillInfo(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogTitle className="flex items-center gap-2">
            <Badge variant="secondary">{showSkillInfo}</Badge>
            {t("requiredSkill")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("informationAboutSkillRequirement")}</DialogDescription>
          <div className="space-y-4 pt-2">
            <p className="text-muted-foreground">
              {t("thisJobRequiresExperienceWith", { skill: showSkillInfo })}
            </p>
            <div className="bg-secondary/50 rounded-xl p-4 space-y-2">
              <p className="font-medium">{t("whatYouShouldKnow")}</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• {t("haveRelevantExperience")}</li>
                <li>• {t("bePreparedToDemonstrateSkills")}</li>
                <li>• {t("askQuestionsIfNeeded")}</li>
              </ul>
            </div>
            <Button className="w-full" onClick={() => setShowSkillInfo(null)}>
              {tCommon("gotIt")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Company Jobs Popup */}
      <Dialog open={showCompanyJobsPopup} onOpenChange={setShowCompanyJobsPopup}>
        <DialogContent className="max-w-2xl rounded-2xl p-0 gap-0 overflow-hidden" hideCloseButton>
          <DialogTitle className="sr-only">{companyProfileInline?.companyName || "Company"} Jobs</DialogTitle>
          <DialogDescription className="sr-only">View all jobs from this company</DialogDescription>
          
          {/* Header with back and close buttons */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-background sticky top-0 z-10">
            <button
              onClick={() => setShowCompanyJobsPopup(false)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors flex-shrink-0"
              data-testid="company-jobs-back-button"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold truncate flex-1 text-center px-2">
              {companyProfileInline?.companyName || "Company"} Jobs
            </h2>
            <button
              onClick={() => setShowCompanyJobsPopup(false)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors flex-shrink-0"
              data-testid="company-jobs-close-button"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          {/* Content with tabs */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6">
            <Tabs value={companyJobsTab} onValueChange={(v) => setCompanyJobsTab(v as "open" | "closed")} className="w-full">
              <TabsList className="w-full grid grid-cols-2 mb-6">
                <TabsTrigger value="open" className="data-[state=active]:bg-background">
                  Open ({companyJobs.filter((j) => j.status === "open").length})
                </TabsTrigger>
                <TabsTrigger value="closed" className="data-[state=active]:bg-background">
                  Closed ({companyJobs.filter((j) => j.status === "closed" || j.status === "filled").length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="open" className="space-y-3 mt-0">
                {companyJobs.filter((j) => j.status === "open").length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>{t("noOpenJobs") || "No open jobs"}</p>
                  </div>
                ) : (
                  companyJobs
                    .filter((j) => j.status === "open")
                    .map((companyJob) => (
                      <button
                        key={companyJob.id}
                        type="button"
                        onClick={() => {
                          setShowCompanyJobsPopup(false);
                          // You could add logic here to open this job in a new dialog or navigate to it
                        }}
                        className="w-full p-4 rounded-xl border-2 border-border hover:border-primary/50 bg-background hover:bg-muted/50 transition-all text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-base truncate">{getDisplayJobTitle(companyJob)}</h3>
                            {companyJob.address && (
                              <p className="text-sm text-muted-foreground truncate mt-1">
                                {[companyJob.city, companyJob.state].filter(Boolean).join(", ")}
                              </p>
                            )}
                            {companyJob.startDate && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {format(new Date(companyJob.startDate), "MMM d, yyyy")}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800 flex-shrink-0">
                            {t("open") || "Open"}
                          </Badge>
                        </div>
                      </button>
                    ))
                )}
              </TabsContent>

              <TabsContent value="closed" className="space-y-3 mt-0">
                {companyJobs.filter((j) => j.status === "closed" || j.status === "filled").length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>{t("noClosedJobs") || "No closed jobs"}</p>
                  </div>
                ) : (
                  companyJobs
                    .filter((j) => j.status === "closed" || j.status === "filled")
                    .map((companyJob) => (
                      <div
                        key={companyJob.id}
                        className="w-full p-4 rounded-xl border-2 border-border bg-muted/30 text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-base truncate">{getDisplayJobTitle(companyJob)}</h3>
                            {companyJob.address && (
                              <p className="text-sm text-muted-foreground truncate mt-1">
                                {[companyJob.city, companyJob.state].filter(Boolean).join(", ")}
                              </p>
                            )}
                            {companyJob.startDate && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {format(new Date(companyJob.startDate), "MMM d, yyyy")}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className="bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800 flex-shrink-0">
                            {t("closed") || "Closed"}
                          </Badge>
                        </div>
                      </div>
                    ))
                )}
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      {/* Teammate Settings Popup - Multi-Step Management */}
      <TeammateSettingsPopup
        open={teammateSettingsOpen}
        onOpenChange={setTeammateSettingsOpen}
        job={job}
        profile={profile}
        activeTeamMembers={activeTeamMembers}
        selectedTeammate={selectedTeammateForSettings}
        onSelectTeammate={setSelectedTeammateForSettings}
        settingsSection={settingsSection}
        onSectionChange={setSettingsSection}
        workerLocation={workerLocation ?? null}
      />

    </>
  );
}

function ApplicationViewDialog({
  open,
  onOpenChange,
  job,
  profile,
  operatorAvatarUrl,
  activeTeamMembers,
  application,
  groupedApplications,
  onWithdraw,
  onWithdrawAll,
  onGetDirections,
  onAssignTeamMember,
  isWithdrawing,
  isMobile,
  workerLocation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  profile: Profile | null | undefined;
  operatorAvatarUrl?: string | null;
  activeTeamMembers: TeamMemberBasic[];
  application: ApplicationData;
  groupedApplications?: GroupedApplications | null;
  onWithdraw?: (applicationId: number) => void;
  onWithdrawAll?: (applicationIds: number[]) => void;
  onGetDirections?: (job: Job) => void;
  onAssignTeamMember?: (applicationId: number, teamMemberId: number | null) => void;
  isWithdrawing: boolean;
  isMobile: boolean;
  workerLocation?: { lat: number; lng: number } | null;
}) {
  const { t } = useTranslation("enhancedJobDialog");
  const { t: tCommon } = useTranslation("common");
  const [showTeamMemberPicker, setShowTeamMemberPicker] = useState(false);
  const [selectedAppForReassign, setSelectedAppForReassign] = useState<ApplicationData | null>(null);
  const [showWithdrawStep, setShowWithdrawStep] = useState(false);
  const [withdrawStep, setWithdrawStep] = useState<"reason" | "confirm">("reason");
  const [withdrawReason, setWithdrawReason] = useState<string | null>(null);
  const [showDriveTime, setShowDriveTime] = useState(false);
  const jobTypeInfo = getJobTypeInfo(job, t);
  const timeInfo = formatJobTime(job, t);
  const teamMember = application.teamMember;

  const jobLatLngApp = useMemo(() => {
    const lat = job.latitude != null ? parseFloat(String(job.latitude)) : NaN;
    const lng = job.longitude != null ? parseFloat(String(job.longitude)) : NaN;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [job.latitude, job.longitude]);
  const [geocodedJobLatLngApp, setGeocodedJobLatLngApp] = useState<{ lat: number; lng: number } | null>(null);
  const jobAddressKeyApp = [job.id, (job as any).address, (job as any).city, (job as any).state, (job as any).zipCode].filter(Boolean).join("|");
  useEffect(() => {
    if (jobLatLngApp) {
      setGeocodedJobLatLngApp(null);
      return;
    }
    const parts = [(job as any).address, (job as any).city, (job as any).state, (job as any).zipCode].filter(Boolean);
    if (parts.length === 0) {
      setGeocodedJobLatLngApp(null);
      return;
    }
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (!apiKey) return;
    const addressQuery = parts.join(", ");
    let cancelled = false;
    fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressQuery)}&key=${apiKey}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const loc = data.results?.[0]?.geometry?.location;
        if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
          setGeocodedJobLatLngApp({ lat: loc.lat, lng: loc.lng });
        } else {
          setGeocodedJobLatLngApp(null);
        }
      })
      .catch(() => {
        if (!cancelled) setGeocodedJobLatLngApp(null);
      });
    return () => { cancelled = true; };
  }, [jobAddressKeyApp, jobLatLngApp]);
  const jobLatLngOrGeocodedApp = jobLatLngApp ?? geocodedJobLatLngApp;
  
  const allApps = groupedApplications?.applications || [application];
  const minWorkerCount = groupedApplications?.minWorkerCount || 1;
  const hasMultipleWorkers = allApps.length > 1;
  
  // Fetch timesheets for this job when the dialog is open and application is accepted
  const { data: timesheets = [], isLoading: timesheetsLoading } = useQuery<Timesheet[]>({
    queryKey: ['/api/timesheets/job', job.id],
    queryFn: async () => {
      const res = await fetch(`/api/timesheets/job/${job.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && application.status === "accepted",
  });
  
  // Calculate timesheet summary
  const timesheetSummary = useMemo(() => {
    if (!timesheets.length) return null;
    
    let totalHours = 0;
    let totalPayout = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let paidCount = 0;
    let processingCount = 0;
    
    timesheets.forEach(ts => {
      const hours = parseFloat(ts.adjustedHours || ts.totalHours || "0");
      const rateInDollars = (ts.hourlyRate || 0) / 100;
      const payout = hours * rateInDollars;
      
      totalHours += hours;
      totalPayout += payout;
      
      // Track payment status
      if (ts.paymentStatus === "completed") {
        paidCount++;
      } else if (ts.paymentStatus === "processing") {
        processingCount++;
      } else if (ts.status === "approved") {
        approvedCount++;
      } else {
        pendingCount++;
      }
    });
    
    return {
      totalHours: totalHours.toFixed(2),
      totalPayout: totalPayout.toFixed(2),
      pendingCount,
      approvedCount,
      paidCount,
      processingCount,
      totalCount: timesheets.length,
    };
  }, [timesheets]);
  
  // Helper to format payment status badge
  const getPaymentStatusBadge = (ts: Timesheet) => {
    if (ts.paymentStatus === "completed") {
      return (
        <Badge variant="outline" className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800">
          <CheckCircle2 className="w-3 h-3 mr-1" /> {t("paid")}
        </Badge>
      );
    }
    if (ts.paymentStatus === "processing") {
      return (
        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" /> {t("transferring")}
        </Badge>
      );
    }
    if (ts.status === "approved") {
      return (
        <Badge variant="outline" className="bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
          <Check className="w-3 h-3 mr-1" /> {t("submitted")}
        </Badge>
      );
    }
    if (ts.status === "pending" && ts.clockOutTime) {
      return (
        <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800">
          <Clock className="w-3 h-3 mr-1" /> {t("pendingApproval")}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800">
        <Clock className="w-3 h-3 mr-1" /> {t("inProgress")}
      </Badge>
    );
  };
  
  const getDisplayAddress = () => {
    const fullAddress = `${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`.replace(/^, |, $/g, "");
    if (application.status === "accepted") {
      return fullAddress || job.location || t("addressNotProvided");
    }
    const streetWithoutNumber = (job.address || "").replace(/^\d+\s*/, "");
    const partialAddress = [streetWithoutNumber, job.city, job.state, job.zipCode]
      .filter(Boolean)
      .join(", ");
    return partialAddress || job.location || t("generalArea");
  };
  
  const getStatusBadge = () => {
    switch (application.status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800">{t("pendingReview")}</Badge>;
      case "accepted":
        return <Badge variant="outline" className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800">{t("accepted")}</Badge>;
      case "rejected":
        return <Badge variant="outline" className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800">{t("notSelected")}</Badge>;
      default:
        return null;
    }
  };
  
  const estimatedHours = job.estimatedHours || 8;
  
  // Pending/accepted application: payout and rate must never change when swapping teammates — use only submitted proposedRate
  const combinedPayout = allApps.reduce((total, app) => {
    const rateDollars = rateToDollars(app.proposedRate ?? profile?.hourlyRate ?? (job.hourlyRate ? job.hourlyRate / 100 : 0));
    return total + (rateDollars * estimatedHours);
  }, 0);
  
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isScrolled = useScrollHeaderContainer(scrollContainerRef);
  
  const content = (
    <div className={cn("flex flex-col", isMobile ? "h-full" : "max-h-[85vh]")}>
      <div className={cn(
        "flex-shrink-0 flex items-center justify-between px-4 border-b bg-background sticky top-0 z-10 transition-all duration-200",
        isScrolled ? "py-2" : "py-3"
      )}>
        <h2 className={cn(
          "font-semibold truncate pr-4 transition-all duration-200",
          isScrolled ? "text-base" : "text-lg"
        )}>{getDisplayJobTitle(job)}</h2>
        <button
          onClick={() => onOpenChange(false)}
          className={cn(
            "flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-all duration-200 flex-shrink-0",
            isScrolled ? "w-8 h-8" : "w-9 h-9"
          )}
          data-testid="dialog-close-button"
        >
          <X className={cn(
            "text-muted-foreground transition-all duration-200",
            isScrolled ? "w-4 h-4" : "w-5 h-5"
          )} />
        </button>
      </div>
      
      <div 
        ref={scrollContainerRef}
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-4 space-y-5"
      >
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">{getDisplayJobTitle(job)}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge className={`${jobTypeInfo.color} text-white`}>
              {jobTypeInfo.label}
            </Badge>
            {getStatusBadge()}
            {hasMultipleWorkers && (
              <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                <Users className="w-3 h-3 mr-1" /> {t("workers", { count: allApps.length })}
              </Badge>
            )}
          </div>
        </div>
        
        {/* Worker avatars - overlapping for multiple workers */}
        <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
          {hasMultipleWorkers ? (
            <>
              <div className="flex -space-x-3">
                {allApps.slice(0, 4).map((app, i) => {
                  const member = app.teamMember;
                  return (
                    <Avatar 
                      key={app.id} 
                      className="w-12 h-12 border-2 border-card ring-2 ring-primary/20"
                      style={{ zIndex: allApps.length - i }}
                    >
                      <AvatarImage src={normalizeAvatarUrl(member?.avatarUrl || (member ? (operatorAvatarUrl ?? profile?.avatarUrl) : profile?.avatarUrl)) ?? undefined} />
                      <AvatarFallback className="text-sm">
                        {member ? `${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}` : `${profile?.firstName?.[0] || ''}${profile?.lastName?.[0] || ''}`}
                      </AvatarFallback>
                    </Avatar>
                  );
                })}
                {allApps.length > 4 && (
                  <div className="w-12 h-12 rounded-full bg-muted border-2 border-card flex items-center justify-center text-sm font-medium">
                    +{allApps.length - 4}
                  </div>
                )}
              </div>
              <div>
                <p className="font-medium">{t("workersAssigned", { count: allApps.length })}</p>
                <p className="text-sm text-muted-foreground">
                  {allApps.map(app => app.teamMember ? `${app.teamMember.firstName}` : `${profile?.firstName}`).join(", ")}
                </p>
              </div>
            </>
          ) : (
            <>
              <Avatar className="w-12 h-12 border-2 border-primary/20">
                <AvatarImage src={normalizeAvatarUrl((teamMember?.avatarUrl || operatorAvatarUrl) ?? profile?.avatarUrl) ?? undefined} />
                <AvatarFallback>
                  {teamMember ? `${teamMember.firstName?.[0] || ''}${teamMember.lastName?.[0] || ''}` : `${profile?.firstName?.[0] || ''}${profile?.lastName?.[0] || ''}`}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">
                  {teamMember ? `${teamMember.firstName} ${teamMember.lastName}` : `${profile?.firstName} ${profile?.lastName}`}
                </p>
                {teamMember && (
                  <p className="text-sm text-muted-foreground">{t("teamMember")}</p>
                )}
              </div>
            </>
          )}
        </div>
        
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-2xl p-4 shadow-sm border border-green-100 dark:border-green-900/50">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            {hasMultipleWorkers ? t("combinedPayout") : t("estimatedPayout")}
          </p>
          <p className="text-3xl sm:text-4xl font-bold text-green-600 dark:text-green-400 mt-1">
            ${combinedPayout.toFixed(0)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {hasMultipleWorkers ? (() => {
              const rates = allApps.map(app => rateToDollars(app.proposedRate ?? profile?.hourlyRate ?? (job.hourlyRate ? job.hourlyRate / 100 : 0)));
              const uniqueRates = Array.from(new Set(rates.map(r => Math.round(r))));
              if (uniqueRates.length === 1) {
                return t("workersHoursRate", { workers: allApps.length, hours: estimatedHours, rate: uniqueRates[0] });
              } else {
                return t("workersHoursRatesVary", { workers: allApps.length, hours: estimatedHours });
              }
            })() : t("hoursAtRate", { hours: estimatedHours, rate: Math.round(rateToDollars(application.proposedRate ?? profile?.hourlyRate ?? (job.hourlyRate ? job.hourlyRate / 100 : 0))) })}
          </p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-card rounded-xl p-4 shadow-sm border">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Calendar className="w-4 h-4" />
              <span className="text-sm font-medium">{t("when")}</span>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-lg">
                {timeInfo.scheduleDaysDisplay ? (
                  <>
                    <span>{timeInfo.scheduleDaysDisplay}</span>
                    {timeInfo.timeRange && (
                      <span className="text-base font-medium text-muted-foreground ml-2">
                        ({timeInfo.timeRange})
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {timeInfo.relative}
                    {timeInfo.timeRange && (
                      <span className="text-base font-medium text-muted-foreground ml-2">
                        ({timeInfo.timeRange})
                      </span>
                    )}
                  </>
                )}
              </p>
              <p className="text-xs text-muted-foreground/70">{timeInfo.fullDate}</p>
            </div>
          </div>
          
          <button
            onClick={() => setShowDriveTime(true)}
            className="bg-card rounded-xl p-4 shadow-sm border hover-elevate transition-colors text-left w-full"
            data-testid="button-location-drive-time"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {application.status === "accepted" ? t("fullAddress") : t("location")}
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs text-primary">
                <Car className="w-3 h-3" />
                <span>{t("driveTime")}</span>
                <ChevronRight className="w-3 h-3" />
              </div>
            </div>
            <p className="font-medium">{getDisplayAddress()}</p>
          </button>
        </div>
        
        {((job as any).mapThumbnailUrl || (job.latitude && job.longitude)) && (
          <div className="rounded-xl overflow-hidden border shadow-sm h-40">
            {(job as any).mapThumbnailUrl ? (
              <img src={(job as any).mapThumbnailUrl} alt="Job location" className="w-full h-full object-cover" />
            ) : (
              <MiniJobMap
                job={{
                  id: job.id,
                  lat: parseFloat(job.latitude!),
                  lng: parseFloat(job.longitude!),
                  title: getDisplayJobTitle(job),
                }}
              />
            )}
          </div>
        )}
        
        {job.description && (
          <div className="bg-card rounded-xl p-4 shadow-sm border overflow-hidden">
            <h3 className="font-semibold mb-2">{t("aboutThisJob")}</h3>
            <p className="text-muted-foreground whitespace-pre-wrap break-all">{job.description}</p>
          </div>
        )}
        
        {job.serviceCategory && (
          <div>
            <h3 className="font-semibold mb-2">{t("skillsRequired")}</h3>
            <Badge variant="secondary">{job.serviceCategory} {job.skillLevel && `(${job.skillLevel})`}</Badge>
          </div>
        )}
        
        {/* Timesheet Accordion - only for accepted jobs with timesheets */}
        {application.status === "accepted" && (
          <div className="bg-card rounded-xl shadow-sm border overflow-hidden" data-testid="timesheet-section">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="timesheets" className="border-0">
                <AccordionTrigger className="px-4 py-3 hover:no-underline" data-testid="accordion-timesheets">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span className="font-semibold">{t("timeAndEarnings")}</span>
                    {timesheets.length > 0 && (
                      <Badge variant="secondary" className="ml-2">{t("entries", { count: timesheets.length })}</Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  {timesheetsLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : timesheets.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">{t("noTimeEntriesYet")}</p>
                      <p className="text-xs">{t("clockInToStartTracking")}</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Individual timesheet entries */}
                      <div className="space-y-3">
                        {timesheets.map((ts) => {
                          const hours = parseFloat(ts.adjustedHours || ts.totalHours || "0");
                          const rateInDollars = (ts.hourlyRate || 0) / 100;
                          const payout = hours * rateInDollars;
                          const clockIn = ts.clockInTime ? new Date(ts.clockInTime) : null;
                          const clockOut = ts.clockOutTime ? new Date(ts.clockOutTime) : null;
                          
                          return (
                            <div 
                              key={ts.id} 
                              className="bg-secondary/30 rounded-lg p-3 space-y-2"
                              data-testid={`timesheet-entry-${ts.id}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-medium">
                                  {clockIn ? format(clockIn, "EEE, MMM d, yyyy") : t("unknownDate")}
                                </div>
                                {getPaymentStatusBadge(ts)}
                              </div>
                              
                              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Play className="w-3 h-3" />
                                  <span>{clockIn ? format(clockIn, "h:mm a") : "--:--"}</span>
                                </div>
                                <span>-</span>
                                <div className="flex items-center gap-1">
                                  <X className="w-3 h-3" />
                                  <span>{clockOut ? format(clockOut, "h:mm a") : t("active")}</span>
                                </div>
                              </div>
                              
                              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                                <div className="text-sm">
                                  <span className="text-muted-foreground">{t("hours", { hours: hours.toFixed(2) })}</span>
                                  <span className="text-muted-foreground/70"> @ ${rateInDollars.toFixed(0)}/hr</span>
                                </div>
                                <div className="font-semibold text-green-600 dark:text-green-400">
                                  ${payout.toFixed(2)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Summary section */}
                      {timesheetSummary && (
                        <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-lg p-4 border border-green-100 dark:border-green-900/50" data-testid="timesheet-summary">
                          <h4 className="text-sm font-semibold text-muted-foreground mb-3">{t("summary")}</h4>
                          
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                                ${timesheetSummary.totalPayout}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("hoursWorked", { hours: timesheetSummary.totalHours })}
                              </p>
                            </div>
                          </div>
                          
                          {/* Payment status breakdown */}
                          <div className="flex flex-wrap gap-2 pt-2 border-t border-green-200 dark:border-green-800/50">
                            {timesheetSummary.paidCount > 0 && (
                              <div className="flex items-center gap-1 text-xs">
                                <CheckCircle2 className="w-3 h-3 text-green-600" />
                                <span className="text-muted-foreground">{t("paidCount", { count: timesheetSummary.paidCount })}</span>
                              </div>
                            )}
                            {timesheetSummary.processingCount > 0 && (
                              <div className="flex items-center gap-1 text-xs">
                                <Loader2 className="w-3 h-3 text-blue-600 animate-spin" />
                                <span className="text-muted-foreground">{t("transferringCount", { count: timesheetSummary.processingCount })}</span>
                              </div>
                            )}
                            {timesheetSummary.approvedCount > 0 && (
                              <div className="flex items-center gap-1 text-xs">
                                <Check className="w-3 h-3 text-purple-600" />
                                <span className="text-muted-foreground">{t("submittedCount", { count: timesheetSummary.approvedCount })}</span>
                              </div>
                            )}
                            {timesheetSummary.pendingCount > 0 && (
                              <div className="flex items-center gap-1 text-xs">
                                <Clock className="w-3 h-3 text-yellow-600" />
                                <span className="text-muted-foreground">{t("pendingCount", { count: timesheetSummary.pendingCount })}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
        
        {(application.status === "pending" || application.status === "accepted") && activeTeamMembers.length > 0 && onAssignTeamMember && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground">
                {hasMultipleWorkers ? t("assignedWorkers") : t("assignTeamMember")}
              </h4>
              {hasMultipleWorkers && (
                <Badge variant="outline" className="text-[10px]">
                  {t("minimumWorkers", { count: minWorkerCount })}
                </Badge>
              )}
            </div>
            
            {hasMultipleWorkers ? (
              (() => {
                const jobCoordsList = jobLatLngOrGeocodedApp;
                const radiusMilesApp = DEFAULT_JOB_TERRITORY_RADIUS_MILES;
                const inTerritoryForApp = (app: typeof allApps[0]) => {
                  if (!jobCoordsList || !Number.isFinite(jobCoordsList.lat) || !Number.isFinite(jobCoordsList.lng)) return true;
                  const member = app.teamMember;
                  const lat = member != null && (member as any).latitude != null ? parseFloat(String((member as any).latitude)) : (workerLocation?.lat ?? (profile && (profile as any).latitude != null ? parseFloat(String((profile as any).latitude)) : null));
                  const lng = member != null && (member as any).longitude != null ? parseFloat(String((member as any).longitude)) : (workerLocation?.lng ?? (profile && (profile as any).longitude != null ? parseFloat(String((profile as any).longitude)) : null));
                  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
                  return calculateDistance(jobCoordsList.lat, jobCoordsList.lng, lat, lng) <= radiusMilesApp;
                };
                const inTerritoryApps = allApps.filter(inTerritoryForApp);
                const outsideTerritoryApps = allApps.filter((app) => !inTerritoryForApp(app));
                const renderAppRow = (app: typeof allApps[0]) => {
                  const member = app.teamMember;
                  const displayName = member ? `${member.firstName} ${member.lastName}` : `${profile?.firstName} ${profile?.lastName} (${t("myself")})`;
                  const appliedRateDollars = rateToDollars(app.proposedRate ?? profile?.hourlyRate ?? (job.hourlyRate ? job.hourlyRate / 100 : 0));
                  return (
                    <button
                      key={app.id}
                      onClick={() => {
                        setSelectedAppForReassign(app);
                        setShowTeamMemberPicker(true);
                      }}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-card border hover-elevate transition-colors"
                      data-testid={`reassign-worker-${app.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="w-10 h-10 border-2 border-primary/20">
                          <AvatarImage src={normalizeAvatarUrl((member?.avatarUrl || operatorAvatarUrl) ?? profile?.avatarUrl) ?? undefined} />
                          <AvatarFallback>
                            {member ? `${member.firstName?.[0]}${member.lastName?.[0]}` : `${profile?.firstName?.[0]}${profile?.lastName?.[0]}`}
                          </AvatarFallback>
                        </Avatar>
                        <div className="text-left">
                          <p className="font-medium">{displayName}</p>
                          <p className="text-xs text-muted-foreground">
                            ${Math.round(appliedRateDollars)}/hr
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-primary">
                        <span className="text-xs">{t("reassign")}</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </button>
                  );
                };
                return (
                  <div className="space-y-3">
                    <div className="space-y-1.5 min-w-0">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-green-600" />
                        {t("withinJobLocation") || "Within job location"}
                      </p>
                      <div className="space-y-2">
                        {inTerritoryApps.map(renderAppRow)}
                      </div>
                    </div>
                    {outsideTerritoryApps.length > 0 && (
                      <div className="space-y-1.5 min-w-0">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {t("teammateOutsideJobLocation") || "Outside job location"}
                        </p>
                        <div className="space-y-2">
                          {outsideTerritoryApps.map(renderAppRow)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : isMobile ? (
              <button
                onClick={() => {
                  setSelectedAppForReassign(application);
                  setShowTeamMemberPicker(true);
                }}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-card border hover-elevate transition-colors"
                data-testid="select-team-member-trigger"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="w-10 h-10 border-2 border-primary/20">
                    <AvatarImage src={normalizeAvatarUrl((teamMember?.avatarUrl || operatorAvatarUrl) ?? profile?.avatarUrl) ?? undefined} />
                    <AvatarFallback>
                      {teamMember ? `${teamMember.firstName?.[0]}${teamMember.lastName?.[0]}` : `${profile?.firstName?.[0]}${profile?.lastName?.[0]}`}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-left">
                    <p className="font-medium">
                      {teamMember ? `${teamMember.firstName} ${teamMember.lastName}` : `${profile?.firstName} ${profile?.lastName} (${t("myself")})`}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </button>
            ) : (
              <Select
                modal={false}
                value={teamMember?.id?.toString() || "self"}
                onValueChange={(value) => {
                  const newTeamMemberId = value === "self" ? null : parseInt(value);
                  onAssignTeamMember(application.id, newTeamMemberId);
                }}
              >
                <SelectTrigger data-testid="select-team-member">
                  <SelectValue placeholder={t("selectTeamMember")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">
                    <div className="flex items-center gap-2">
                      <Avatar className="w-6 h-6">
                        <AvatarImage src={profile?.avatarUrl || undefined} />
                        <AvatarFallback>{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                      </Avatar>
                      <span>{t("myself")}</span>
                    </div>
                  </SelectItem>
                  {activeTeamMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id.toString()}>
                      <div className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={normalizeAvatarUrl(member.avatarUrl || operatorAvatarUrl) ?? undefined} />
                          <AvatarFallback>{member.firstName?.[0]}{member.lastName?.[0]}</AvatarFallback>
                        </Avatar>
                        <span>{member.firstName} {member.lastName}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>
      
      <div className="flex-shrink-0 p-4 border-t bg-background">
        <div className="space-y-3">
          {application.status === "accepted" && (
            <div className="flex gap-2">
              {onGetDirections && (
                <Button 
                  className="flex-1" 
                  onClick={() => onGetDirections(job)}
                  data-testid="button-get-directions"
                >
                  <Navigation className="w-4 h-4 mr-2" />
                  {t("getDirections")}
                </Button>
              )}
              <Button 
                variant="outline"
                className="flex-1"
                asChild
                data-testid="button-message-job"
              >
                <a href={`/accepted-job/${job.id}`}>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  {t("message")}
                </a>
              </Button>
            </div>
          )}
          
          {application.status === "pending" && (hasMultipleWorkers ? onWithdrawAll : onWithdraw) && (
            <Button 
              variant="destructive" 
              className="w-full mt-[11px] mb-[11px]"
              onClick={() => {
                setWithdrawReason(null);
                setWithdrawStep("reason");
                setShowWithdrawStep(true);
              }}
              disabled={isWithdrawing}
              data-testid="button-withdraw-application"
            >
              {hasMultipleWorkers ? t("withdrawAllWorkers", { count: allApps.length }) : t("withdrawApplication")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
  
  const appToReassign = selectedAppForReassign || application;
  const currentMember = appToReassign.teamMember;
  
  // Track assigned workers - including self (null teamMember) to prevent duplicates
  const assignedTeamMemberIds = allApps
    .filter(app => app.id !== appToReassign.id) // Exclude current app being reassigned
    .map(app => app.teamMember?.id ?? "self") // Use "self" for null teamMember
    .filter(id => id !== undefined);
  
  const isSelfAssignedElsewhere = assignedTeamMemberIds.includes("self");
  const assignedMemberIds = assignedTeamMemberIds.filter((id): id is number => typeof id === "number");
  
  const teamMemberPickerDrawer = (
    <Drawer open={showTeamMemberPicker} onOpenChange={(open) => {
      setShowTeamMemberPicker(open);
      if (!open) setSelectedAppForReassign(null);
    }}>
      <DrawerContent className="max-h-[80vh]">
        <DrawerTitle className="sr-only">{t("selectTeamMember")}</DrawerTitle>
        <DrawerDescription className="sr-only">{t("chooseTeamMemberForJob")}</DrawerDescription>
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <button
              onClick={() => {
                setShowTeamMemberPicker(false);
                setSelectedAppForReassign(null);
              }}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              data-testid="button-back-to-job"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{tCommon("back")}</span>
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-sm">
              {hasMultipleWorkers ? t("reassignWorker") : t("selectTeamMember")}
            </span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {hasMultipleWorkers 
                    ? t("reassigningWorkerRateUnchanged", { name: currentMember ? `${currentMember.firstName} ${currentMember.lastName}` : `${profile?.firstName} ${profile?.lastName}` })
                    : t("appliedRateWillRemainUnchanged", { rate: Math.round(rateToDollars(appToReassign.proposedRate ?? profile?.hourlyRate ?? 0)) })
                  }
                </p>
              </div>
            </div>
            
            <div className="space-y-2">
              {/* Only show "Myself" option if not already assigned to myself in another slot */}
              {(!hasMultipleWorkers || !isSelfAssignedElsewhere || !currentMember) && (
                <button
                  onClick={() => {
                    if (onAssignTeamMember) {
                      onAssignTeamMember(appToReassign.id, null);
                    }
                    setShowTeamMemberPicker(false);
                    setSelectedAppForReassign(null);
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl bg-card border hover-elevate transition-colors ${
                    hasMultipleWorkers && isSelfAssignedElsewhere && currentMember ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  disabled={hasMultipleWorkers && isSelfAssignedElsewhere && !!currentMember}
                  data-testid="select-team-member-self"
                >
                  <Avatar className="w-12 h-12 border-2 border-primary/20">
                    <AvatarImage src={profile?.avatarUrl || undefined} />
                    <AvatarFallback>{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <p className="font-medium">{profile?.firstName} {profile?.lastName}</p>
                    <p className="text-sm text-muted-foreground">{t("myself")}</p>
                  </div>
                  {!currentMember && (
                    <Badge variant="secondary" className="text-xs">{t("current")}</Badge>
                  )}
                </button>
              )}
              
              {activeTeamMembers
                .filter(member => {
                  // For multi-worker, only show members not already assigned elsewhere
                  if (hasMultipleWorkers) {
                    // Allow if not assigned elsewhere, or if this is the current member
                    return !assignedMemberIds.includes(member.id) || currentMember?.id === member.id;
                  }
                  return true;
                })
                .map((member) => (
                  <button
                    key={member.id}
                    onClick={() => {
                      if (onAssignTeamMember) {
                        onAssignTeamMember(appToReassign.id, member.id);
                      }
                      setShowTeamMemberPicker(false);
                      setSelectedAppForReassign(null);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border hover-elevate transition-colors"
                    data-testid={`select-team-member-${member.id}`}
                  >
                    <Avatar className="w-12 h-12 border-2 border-primary/20">
                      <AvatarImage src={normalizeAvatarUrl(member.avatarUrl || operatorAvatarUrl) ?? undefined} />
                      <AvatarFallback>{member.firstName?.[0]}{member.lastName?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 text-left">
                      <p className="font-medium">{member.firstName} {member.lastName}</p>
                    </div>
                    {currentMember?.id === member.id && (
                      <Badge variant="secondary" className="text-xs">{t("current")}</Badge>
                    )}
                  </button>
                ))}
            </div>
          </div>
          
          <div className="flex-shrink-0 p-4 border-t bg-background">
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => {
                setShowTeamMemberPicker(false);
                setSelectedAppForReassign(null);
              }}
              data-testid="button-cancel-team-selection"
            >
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
  
  const driveTimePopup = (
    <DriveTimePopup
      open={showDriveTime}
      onOpenChange={setShowDriveTime}
      jobAddress={job.address || ""}
      jobCity={job.city || undefined}
      jobState={job.state || undefined}
      jobLatitude={job.latitude || undefined}
      jobLongitude={job.longitude || undefined}
      userLatitude={workerLocation?.lat}
      userLongitude={workerLocation?.lng}
      userAddress={profile?.address ? `${profile.address}, ${profile.city || ""} ${profile.state || ""}` : undefined}
      onGetDirections={onGetDirections ? () => onGetDirections(job) : undefined}
      isAccepted={true}
    />
  );

  const WITHDRAW_REASON_KEYS_AV = ["withdrawReasonFoundAnotherJob", "withdrawReasonScheduleChanged", "withdrawReasonNoLongerInterested", "withdrawReasonOther"] as const;
  const withdrawContent = (application.status === "pending" && (onWithdraw || onWithdrawAll) && showWithdrawStep) ? (() => {
    const onBackWithdraw = () => {
      if (withdrawStep === "confirm") setWithdrawStep("reason");
      else {
        setShowWithdrawStep(false);
        setWithdrawReason(null);
        setWithdrawStep("reason");
      }
    };
    const handleConfirmWithdraw = () => {
      if (allApps.length > 1 && onWithdrawAll) onWithdrawAll(allApps.map(app => app.id));
      else if (onWithdraw) onWithdraw(application.id);
      setShowWithdrawStep(false);
      setWithdrawReason(null);
      setWithdrawStep("reason");
    };
    const reasonLabel = (key: string) => t(key as any);
    return (
      <div className={cn("flex flex-col min-h-0", isMobile ? "h-full" : "max-h-[85vh]")}>
        <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0 bg-background">
          <button type="button" onClick={onBackWithdraw} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="button-back-from-withdraw">
            <ChevronLeft className="w-4 h-4" /><span>{tCommon("back")}</span>
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-sm">{withdrawStep === "reason" ? t("withdrawApplication") : t("confirmWithdrawTitle")}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {withdrawStep === "reason" ? (
            <>
              <p className="text-sm font-medium mb-3">{t("withdrawReasonTitle")}</p>
              <div className="space-y-2" role="radiogroup" aria-label={t("withdrawReasonTitle")}>
                {WITHDRAW_REASON_KEYS_AV.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setWithdrawReason(key)}
                    className={cn("w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors", withdrawReason === key ? "bg-primary/10 border-primary" : "bg-card border-border hover:bg-muted/50")}
                    data-testid={`withdraw-reason-${key}`}
                  >
                    <span className={cn("w-4 h-4 rounded-full border-2 flex-shrink-0", withdrawReason === key ? "border-primary bg-primary" : "border-muted-foreground")} />
                    <span className="text-sm">{reasonLabel(key)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("confirmWithdrawMessage", { reason: withdrawReason ? reasonLabel(withdrawReason) : "" })}</p>
          )}
        </div>
        <div className="flex-shrink-0 p-4 border-t bg-background shadow-[0_-2px_12px_rgba(0,0,0,0.06)] flex flex-col gap-2">
          {withdrawStep === "reason" ? (
            <>
              <Button className="w-full" disabled={!withdrawReason} onClick={() => setWithdrawStep("confirm")} data-testid="button-withdraw-continue">{t("withdrawContinue")}</Button>
              <Button variant="outline" className="w-full" onClick={onBackWithdraw} data-testid="button-withdraw-cancel">{tCommon("cancel")}</Button>
            </>
          ) : (
            <>
              <Button variant="destructive" className="w-full" disabled={isWithdrawing} onClick={handleConfirmWithdraw} data-testid="button-withdraw-confirm">
                {isWithdrawing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                {t("confirmWithdrawButton")}
              </Button>
              <Button variant="outline" className="w-full" onClick={onBackWithdraw} data-testid="button-withdraw-back">{tCommon("back")}</Button>
            </>
          )}
        </div>
      </div>
    );
  })() : null;

  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent className="h-[100dvh] max-h-[100dvh] rounded-t-none">
            <DrawerTitle className="sr-only">{getDisplayJobTitle(job)}</DrawerTitle>
            <DrawerDescription className="sr-only">View job application details</DrawerDescription>
            {withdrawContent ?? content}
          </DrawerContent>
        </Drawer>
        {teamMemberPickerDrawer}
        {driveTimePopup}

        {/* Teammate Settings Popup - Available for application view too */}
        <TeammateSettingsPopup
          open={teammateSettingsOpen}
          onOpenChange={setTeammateSettingsOpen}
          job={job}
          profile={profile}
          activeTeamMembers={activeTeamMembers}
          selectedTeammate={selectedTeammateForSettings}
          onSelectTeammate={setSelectedTeammateForSettings}
          settingsSection={settingsSection}
          onSectionChange={setSettingsSection}
          workerLocation={workerLocation ?? null}
        />
      </>
    );
  }
  
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl p-0 rounded-2xl overflow-hidden shadow-2xl border-0">
          <DialogTitle className="sr-only">{getDisplayJobTitle(job)}</DialogTitle>
          <DialogDescription className="sr-only">View job application details</DialogDescription>
          {withdrawContent ?? content}
        </DialogContent>
      </Dialog>
      {teamMemberPickerDrawer}
      {driveTimePopup}
    </>
  );
}

// Teammate Settings Popup Component
function TeammateSettingsPopup({
  open,
  onOpenChange,
  job,
  profile,
  activeTeamMembers,
  selectedTeammate,
  onSelectTeammate,
  settingsSection,
  onSectionChange,
  workerLocation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  profile: Profile | null;
  activeTeamMembers: TeamMemberBasic[];
  selectedTeammate: TeamMemberBasic | null;
  onSelectTeammate: (teammate: TeamMemberBasic | null) => void;
  settingsSection: "list" | "edit";
  onSectionChange: (section: "list" | "edit") => void;
  workerLocation?: { lat: number; lng: number } | null;
}) {
  const { t } = useTranslation("enhancedJobDialog");
  const { toast } = useToast();
  const [editSkillsets, setEditSkillsets] = useState<string[]>([]);
  const [editAddress, setEditAddress] = useState("");
  const [editLatitude, setEditLatitude] = useState("");
  const [editLongitude, setEditLongitude] = useState("");
  const [editHourlyRate, setEditHourlyRate] = useState<number>(30);
  const [isSaving, setIsSaving] = useState(false);

  const toggleSkillset = (roleId: string) => {
    setEditSkillsets((prev) => {
      if (prev.includes(roleId)) return prev.filter((s) => s !== roleId);
      const partner = getLiteElitePartner(roleId);
      const withoutPartner = partner ? prev.filter((s) => s !== partner) : prev;
      return [...withoutPartner, roleId];
    });
  };

  // Initialize edit data when teammate is selected (hourlyRate: DB is whole dollars; legacy may be cents - normalize with rateToDollars)
  useEffect(() => {
    if (selectedTeammate) {
      setEditSkillsets(selectedTeammate.skillsets || []);
      const addr = [
        (selectedTeammate as any).address,
        (selectedTeammate as any).city,
        (selectedTeammate as any).state,
        (selectedTeammate as any).zipCode,
      ].filter(Boolean).join(", ");
      setEditAddress(addr || "");
      setEditLatitude(selectedTeammate.latitude || "");
      setEditLongitude(selectedTeammate.longitude || "");
      setEditHourlyRate(rateToDollars(selectedTeammate.hourlyRate) || 30);
    }
  }, [selectedTeammate]);

  // Combined save function that updates all fields at once (hourlyRate sent as whole dollars; server stores whole dollars)
  const handleSaveAll = async () => {
    if (!selectedTeammate) return;
    setIsSaving(true);
    try {
      await apiRequest("PATCH", `/api/team-members/${selectedTeammate.id}`, {
        skillsets: editSkillsets,
        address: editAddress || undefined,
        latitude: editLatitude || undefined,
        longitude: editLongitude || undefined,
        hourlyRate: Math.round(editHourlyRate),
      });
      toast({ title: "Teammate updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/team-members/worker", profile?.id] });
      onSectionChange("list");
      onSelectTeammate(null);
    } catch (error: any) {
      toast({ title: "Failed to update teammate", description: error.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    if (settingsSection === "list") {
      onOpenChange(false);
    } else {
      onSectionChange("list");
      onSelectTeammate(null);
    }
  };


  // Calculate skill match and availability for each teammate
  const jobSkills = useMemo(() => {
    const skills = new Set<string>();
    if (job.trade) skills.add(job.trade);
    if (job.requiredSkills) job.requiredSkills.forEach(s => skills.add(s));
    return skills;
  }, [job.trade, job.requiredSkills]);

  const teammatesWithStatus = useMemo(() => {
    const allPeople = [
      ...(profile ? [{ ...profile, id: profile.id, type: 'self' as const }] : []),
      ...activeTeamMembers.map(m => ({ ...m, type: 'teammate' as const }))
    ];

    return allPeople.map(p => {
      const skillsets = (p.skillsets as string[]) || [];
      const hasSkills = skillsets.some(s => jobSkills.has(s));
      const hasLocation = !!(p.latitude && p.longitude);
      
      return {
        person: p,
        skillMatch: hasSkills,
        hasLocation,
        type: (p as any).type || 'teammate',
      };
    });
  }, [profile, activeTeamMembers, jobSkills]);

  const handleSelectTeammate = (person: any) => {
    if (person.type === 'self') {
      toast({ title: "Edit your own settings in the Settings menu" });
      return;
    }
    // Open the unified popup with this teammate selected
    onSelectTeammate(person);
    onSectionChange("edit"); // New unified edit view
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        settingsSection === "list" 
          ? "Manage Teammates"
          : `${selectedTeammate?.firstName} ${selectedTeammate?.lastName}`
      }
      description={
        settingsSection === "list"
          ? "View and edit teammate details for this job"
          : "Edit teammate information"
      }
      showBack={true}
      onBack={handleBack}
      primaryAction={
        settingsSection === "edit" ? {
          label: isSaving ? "Saving..." : "Save All Changes",
          onClick: handleSaveAll,
          disabled: isSaving,
        } : undefined
      }
      secondaryAction={
        settingsSection === "edit" ? {
          label: "Cancel",
          onClick: () => {
            onSectionChange("list");
            onSelectTeammate(null);
          },
        } : undefined
      }
    >
      {settingsSection === "list" ? (
        /* List View - Compact table-like; scroll is handled by ResponsiveDialog content area (scrollbar-pill-on-scroll) */
        <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
            {teammatesWithStatus.map(({ person, skillMatch, hasLocation, type }) => {
              const isSelf = type === 'self';
              const name = isSelf 
                ? `${person.firstName} ${person.lastName} (You)` 
                : `${person.firstName} ${person.lastName}`;
              const initials = `${person.firstName?.[0] || ''}${person.lastName?.[0] || ''}`;
              const avatarUrl = normalizeAvatarUrl(person.avatarUrl ?? undefined);

              return (
                <div
                  key={type === 'self' ? 'self' : person.id}
                  className={cn(
                    "flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 min-h-[52px] bg-background transition-colors",
                    !isSelf ? "hover:bg-muted/30 cursor-pointer" : ""
                  )}
                  onClick={!isSelf ? () => handleSelectTeammate(person) : undefined}
                >
                  <Avatar className="w-8 h-8 sm:w-9 sm:h-9 border border-border flex-shrink-0">
                    <AvatarImage src={avatarUrl} />
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="font-medium truncate text-sm">{name}</p>
                    {!isSelf && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Wrench className={cn("w-3.5 h-3.5", skillMatch ? "text-green-600" : "text-red-500")} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">{skillMatch ? "Skills OK" : "Missing skills"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <MapPinned className={cn("w-3.5 h-3.5", hasLocation ? "text-green-600" : "text-amber-500")} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">{hasLocation ? "Location set" : "No location"}</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                  {!isSelf && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => handleSelectTeammate(person)}
                    >
                      <Settings2 className="w-3 h-3" />
                      Edit
                    </Button>
                  )}
                  {isSelf && (
                    <p className="text-xs text-muted-foreground flex-shrink-0">
                      Edit in Settings
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      ) : settingsSection === "edit" && selectedTeammate ? (
        /* Unified Edit View with Tabs */
        <div className="space-y-4">
          {/* User Header with Avatar and Name */}
          <div className="flex items-center gap-3 pb-4 border-b border-border">
            <Avatar className="w-12 h-12 border-2 border-border">
              <AvatarImage src={normalizeAvatarUrl(selectedTeammate.avatarUrl ?? undefined)} />
              <AvatarFallback className="text-base">
                {selectedTeammate.firstName?.[0] || ''}{selectedTeammate.lastName?.[0] || ''}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="font-semibold text-lg">
                {selectedTeammate.firstName} {selectedTeammate.lastName}
              </h3>
              <p className="text-sm text-muted-foreground">Edit teammate settings</p>
            </div>
          </div>

          {/* Tabs for Skills, Location, Rate */}
          <Tabs defaultValue="skills" className="w-full">
            <TabsList withScrollControls className="w-full mb-4">
              <TabsTrigger value="skills" className="flex items-center gap-2">
                <Wrench className="w-4 h-4" />
                Skills
              </TabsTrigger>
              <TabsTrigger value="location" className="flex items-center gap-2">
                <MapPinned className="w-4 h-4" />
                Location
              </TabsTrigger>
              <TabsTrigger value="rate" className="flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Rate
              </TabsTrigger>
            </TabsList>

            {/* Skills Tab – 1:1 with WorkerDashboard/BusinessOperator (INDUSTRY_CATEGORIES) */}
            <TabsContent value="skills" className="space-y-4 mt-0">
              <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                <p className="text-xs text-muted-foreground mb-2">
                  Job requires: <strong>{job.trade}</strong>
                  {job.requiredSkills && job.requiredSkills.length > 0 ? `, ${job.requiredSkills.join(", ")}` : ""}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Select Skills</Label>
                <div className="space-y-3 max-h-[400px] overflow-y-auto overflow-x-hidden scrollbar-pill-on-scroll pr-2">
                  {INDUSTRY_CATEGORIES.map((industry) => {
                    const Icon = industry.icon;
                    const selectedCount = industry.roles.filter((r) => editSkillsets.includes(r.id)).length;
                    return (
                      <Collapsible key={industry.id} defaultOpen={selectedCount > 0} className="group">
                        <div className="border rounded-lg overflow-hidden">
                          <CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <Icon className="w-4 h-4 text-primary" />
                              </div>
                              <span className="font-medium">{industry.label}</span>
                              {selectedCount > 0 && (
                                <Badge variant="default" className="text-xs">{selectedCount} selected</Badge>
                              )}
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="border-t bg-muted/20 p-2 space-y-1">
                              {industry.roles.map((role) => {
                                const checked = editSkillsets.includes(role.id);
                                return (
                                  <div
                                    key={role.id}
                                    className={cn(
                                      "flex items-start space-x-3 p-2 rounded-md transition-colors cursor-pointer",
                                      checked ? "bg-primary/10" : "hover:bg-muted/50"
                                    )}
                                    onClick={() => toggleSkillset(role.id)}
                                  >
                                    <Checkbox
                                      id={`skill-${role.id}`}
                                      checked={checked}
                                      onCheckedChange={() => toggleSkillset(role.id)}
                                      className="mt-0.5"
                                    />
                                    <label htmlFor={`skill-${role.id}`} className="flex-1 cursor-pointer text-sm font-medium">
                                      {role.label}
                                      {role.isElite && (
                                        <Badge variant="secondary" className="text-xs ml-2">Certified</Badge>
                                      )}
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <strong>{editSkillsets.length}</strong> skill{editSkillsets.length !== 1 ? 's' : ''} selected
                </p>
              </div>
            </TabsContent>

            {/* Location Tab — worker's home/address (editable) + map with address pin and current geolocation pin when available */}
            <TabsContent value="location" className="space-y-4 mt-0">
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-semibold">{selectedTeammate ? `${selectedTeammate.firstName}'s address` : "Address"}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Used for distance to jobs and the map pin. Save to update.
                  </p>
                  <GooglePlacesAutocomplete
                    value={editAddress}
                    onChange={(address) => setEditAddress(address)}
                    onPlaceSelect={(place) => {
                      setEditAddress(place.formattedAddress || place.displayName?.text || editAddress);
                      if (place.location?.latitude && place.location?.longitude) {
                        setEditLatitude(place.location.latitude.toString());
                        setEditLongitude(place.location.longitude.toString());
                      }
                    }}
                    placeholder="Enter home or work address..."
                    className="mt-1.5"
                  />
                </div>

                {(() => {
                  const cityState = selectedTeammate
                    ? `${(selectedTeammate as any).city || ""}, ${(selectedTeammate as any).state || ""}`.replace(new RegExp("^, |, $", "g"), "")
                    : "";
                  const mapPartialAddress = editAddress || (cityState || undefined);
                  return (editLatitude && editLongitude) || (workerLocation?.lat != null && workerLocation?.lng != null) ? (
                  <div className="rounded-lg overflow-hidden border border-border">
                    <MiniJobMap
                      job={{
                        id: 0,
                        lat: editLatitude && editLongitude ? parseFloat(editLatitude) : workerLocation!.lat,
                        lng: editLatitude && editLongitude ? parseFloat(editLongitude) : workerLocation!.lng,
                        title: selectedTeammate ? `${selectedTeammate.firstName}'s address` : "Address",
                      }}
                      height="200px"
                      partialAddress={mapPartialAddress}
                      personLocations={
                        editLatitude && editLongitude && workerLocation?.lat != null && workerLocation?.lng != null
                          ? [{ id: "current", lat: workerLocation.lat, lng: workerLocation.lng, name: t("currentLocation") || "Current location", type: "worker" as const }]
                          : []
                      }
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 flex items-center justify-center text-muted-foreground text-sm" style={{ height: "200px" }}>
                    <span>Enter an address above or enable location to see the map</span>
                  </div>
                );
                })()}

                {job.latitude && job.longitude && editLatitude && editLongitude && (
                  <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                    <p className="text-xs text-muted-foreground">
                      Distance to this job: <strong className="text-primary">{calculateDistance(parseFloat(editLatitude), parseFloat(editLongitude), parseFloat(job.latitude), parseFloat(job.longitude)).toFixed(1)} mi</strong>
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Rate Tab */}
            <TabsContent value="rate" className="space-y-4 mt-0">
              <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                <p className="text-xs text-muted-foreground">
                  Job rate: <strong>${(job.hourlyRate / 100).toFixed(2)}/hr</strong>
                  {job.estimatedHours && (
                    <span className="ml-2">
                      × {job.estimatedHours} hrs = ${((job.hourlyRate / 100) * job.estimatedHours).toFixed(2)}
                    </span>
                  )}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-semibold">Hourly Rate</Label>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-3xl font-bold text-primary">${editHourlyRate.toFixed(2)}</span>
                    <span className="text-sm text-muted-foreground">/hour</span>
                  </div>
                </div>

                <RateSlider
                  value={Math.round(editHourlyRate)}
                  onValueChange={(value) => setEditHourlyRate(value)}
                  className="mt-2"
                />

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>$1/hr</span>
                  <span>$200/hr</span>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  For {job.estimatedHours || 8} hours: <strong>${((editHourlyRate * (job.estimatedHours || 8))).toFixed(2)}</strong>
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </ResponsiveDialog>
  );
}

export function EnhancedJobDialog({
  open,
  onOpenChange,
  job,
  profile,
  operatorAvatarUrl,
  activeTeamMembers = [],
  workerLocation,
  onOpenApply,
  onDismiss,
  application,
  groupedApplications,
  onWithdraw,
  onWithdrawAll,
  onGetDirections,
  onAssignTeamMember,
  isWithdrawing = false,
  initialApplyStage,
  territoryRadiusMiles,
}: EnhancedJobDialogProps) {
  const isMobile = useIsMobile();
  
  if (!job) return null;
  
  const handleOpenApply = (j: Job) => {
    if (onOpenApply) onOpenApply(j);
  };
  
  // Same Dialog/Drawer + JobContent for both opportunity and application view (application view = 1:1 content with Withdraw footer)
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[100dvh] max-h-[100dvh] rounded-t-none">
          <DrawerTitle className="sr-only">{getDisplayJobTitle(job)}</DrawerTitle>
          <DrawerDescription className="sr-only">View job details and apply</DrawerDescription>
          <JobContent
            job={job}
            profile={profile ?? null}
            activeTeamMembers={activeTeamMembers ?? []}
            workerLocation={workerLocation}
            onOpenApply={handleOpenApply}
            onDismiss={onDismiss}
            onClose={() => onOpenChange(false)}
            isMobile={true}
            initialApplyStage={initialApplyStage}
            application={application ?? null}
            groupedApplications={groupedApplications ?? null}
            onWithdraw={onWithdraw}
            onWithdrawAll={onWithdrawAll}
            isWithdrawing={isWithdrawing}
            onAssignTeamMember={onAssignTeamMember}
            onGetDirections={onGetDirections}
            operatorAvatarUrl={operatorAvatarUrl}
            territoryRadiusMiles={territoryRadiusMiles}
          />
        </DrawerContent>
      </Drawer>
    );
  }
  
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl p-0 rounded-2xl overflow-hidden shadow-2xl border-0 flex flex-col max-h-[90vh] w-full">
          <DialogTitle className="sr-only">{getDisplayJobTitle(job)}</DialogTitle>
          <DialogDescription className="sr-only">View job details and apply</DialogDescription>
          <JobContent
            job={job}
            profile={profile ?? null}
            activeTeamMembers={activeTeamMembers ?? []}
            workerLocation={workerLocation}
            onOpenApply={handleOpenApply}
            onDismiss={onDismiss}
            onClose={() => onOpenChange(false)}
            isMobile={false}
            initialApplyStage={initialApplyStage}
            application={application ?? null}
            groupedApplications={groupedApplications ?? null}
            onWithdraw={onWithdraw}
            onWithdrawAll={onWithdrawAll}
            isWithdrawing={isWithdrawing}
            onAssignTeamMember={onAssignTeamMember}
            onGetDirections={onGetDirections}
            operatorAvatarUrl={operatorAvatarUrl}
            territoryRadiusMiles={territoryRadiusMiles}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
