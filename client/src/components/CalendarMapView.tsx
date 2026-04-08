import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, InfoWindow, Polyline, Circle as MapCircle, OverlayView } from "@react-google-maps/api";
import { format, parseISO, isSameDay, addDays, subDays, isToday, startOfDay, endOfDay, isBefore } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MapPin, Clock, User, Navigation, AlertCircle, ChevronLeft, ChevronRight, Calendar, MoreVertical, Phone, MessageSquare, Map as MapIcon, AlertTriangle, CheckCircle2, Circle, ChevronUp, ChevronDown, Table as TableIcon, Zap, DollarSign, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsDesktop, useIsMobile } from "@/hooks/use-mobile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Table as TableComponent, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GOOGLE_MAPS_LOADER_ID, GOOGLE_MAPS_LIBRARIES } from "@/lib/google-maps";
import { REPLAY_QUERY_KEYS, parseReplayUrlState, writeReplayUrlState } from "@/lib/replay-url";
import { workerFacingJobHourlyCents } from "@shared/platformPayPolicy";

const MILES_TO_METERS = 1609.344;

/** Avatar pin for map (same style as Find Work JobsMap): avatar or initials + colored ring + pointer. */
function CalendarAvatarPin({
  name,
  avatarUrl,
  ringColorHex,
  title,
}: {
  name: string;
  avatarUrl?: string | null;
  ringColorHex: string;
  title?: string;
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      className="flex flex-col items-center cursor-pointer transform -translate-x-1/2 -translate-y-full"
      title={title}
    >
      <div
        className="relative rounded-full p-0.5 shadow-lg border-2"
        style={{ backgroundColor: ringColorHex, borderColor: ringColorHex }}
      >
        <Avatar className="w-8 h-8 border-2 border-white bg-muted">
          {avatarUrl ? (
            <AvatarImage src={avatarUrl} alt={name} />
          ) : null}
          <AvatarFallback className="text-xs font-semibold bg-white text-gray-800">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>
      <div
        className="w-2 h-2 -mt-1 rotate-45"
        style={{ backgroundColor: ringColorHex }}
      />
    </div>
  );
}

const mapStyles = [
  {
    featureType: "poi",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
];

// Data model interfaces
export type RouteType = "accepted" | "pending" | "available";

export interface TeammateRoute {
  teammateId: number;
  teammateName: string;
  teammateAvatar?: string | null;
  workLocation?: {
    address: string;
    lat: number;
    lng: number;
  } | null;
  liveLocation?: {
    lat: number;
    lng: number;
    timestamp: Date;
  } | null;
  jobs: JobStop[];
  route?: google.maps.DirectionsResult | null;
  routeColor: string;
  routeType: RouteType;
  /** Path for clickable overlay and dashed available route. */
  overviewPath?: { lat: number; lng: number }[];
  totalDistance?: string;
  totalDuration?: string;
  routeSource?: "fleet" | "directions" | "polyline";
  replayTrail?: Array<{ lat: number; lng: number; createdAt?: Date | null }>;
  fullTrail?: Array<{ lat: number; lng: number; createdAt?: Date | null }>;
}

export interface JobStop {
  jobId: number;
  jobTitle: string;
  address: string;
  lat: number;
  lng: number;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: "scheduled" | "in-progress" | "completed";
  sequence: number;
  isCurrent?: boolean;
  isNext?: boolean;
  isBehind?: boolean;
  /** From job assignment: "accepted" | "pending" etc. Used for route line color. */
  assignmentStatus?: string;
}

interface CalendarMapViewProps {
  /** When true, hide legend and worker filter; show only this worker's accepted jobs and radius/avatar. */
  isEmployee?: boolean;
  selectedDate: Date;
  onDateChange?: (date: Date) => void;
  teammates: Array<{
    id: number;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
    workLocationAddress?: string | null;
    workLocationLat?: number | null;
    workLocationLng?: number | null;
    liveLocationLat?: number | null;
    liveLocationLng?: number | null;
    liveLocationTimestamp?: Date | null;
    liveLocationPath?: Array<{ lat: number; lng: number; createdAt?: Date | string | null }>;
  }>;
  workerProfile?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    latitude?: string | null;
    longitude?: string | null;
    avatarUrl?: string | null;
  } | null; // Worker's profile for fallback location + owner avatar on map
  jobAssignments: Array<{
    jobId: number;
    jobTitle: string;
    address: string;
    latitude: string | null;
    longitude: string | null;
    scheduledStart: string | Date;
    scheduledEnd: string | Date;
    status: string;
    teamMemberId: number;
  }>;
  availableJobs?: Array<{
    id: number;
    title: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    location?: string | null;
    latitude?: string | null;
    longitude?: string | null;
    startDate: string | Date;
    endDate?: string | Date | null;
    scheduledTime?: string | null;
    hourlyRate?: number | null;
    estimatedHours?: number | null;
  }>;
  enabledTeammates: Set<number>;
  onToggleTeammate: (teammateId: number) => void;
  onJobAction?: (jobId: number, action: "view" | "call" | "message" | "directions" | "add-to-route") => void;
  onAddJobToRoute?: (jobId: number, teamMemberId: number) => void;
  height?: string;
  focusTeammateId?: number | null; // When set, focuses map on this teammate's route
  showAcceptedJobs?: boolean; // Toggle for accepted jobs visibility
  showPendingJobs?: boolean; // Toggle for pending jobs visibility
  showAvailableJobs?: boolean; // Toggle for available jobs visibility
  onToggleAcceptedJobs?: (show: boolean) => void;
  onTogglePendingJobs?: (show: boolean) => void;
  onToggleAvailableJobs?: (show: boolean) => void;
  /** Same as Find Work map: draw radius circles around these points (worker + teammates). */
  referencePoints?: Array<{ lat: number; lng: number }>;
  /** Radius in miles for each reference point (or single radius for all when array not provided). */
  referenceRadiusMiles?: number;
  referenceRadiusMilesArray?: number[];
  /** Optional content to render at the right end of the bottom panel header (e.g. worker filter button on tablet). */
  toolbarRightContent?: React.ReactNode;
}

// Route line colors by filter type (match legend: Accepted / Pending / Available)
const ROUTE_COLOR_ACCEPTED = "#22c55e";  // green
const ROUTE_COLOR_PENDING = "#eab308";   // yellow
const ROUTE_COLOR_AVAILABLE = "#38bdf8"; // light blue, dashed – route they can add
const MAX_AUTOFIT_ZOOM = 12;
const hasValidCoord = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

interface ReassignmentSuggestion {
  jobId: number;
  jobTitle: string;
  currentTeammateName: string;
  suggestedTeammateName: string;
  gainMiles: number;
  gainMinutes: number;
}

interface ReplayEventChip {
  minute: number;
  label: string;
  kind: "job-start" | "job-end" | "ping";
  teammateId?: number | null;
}

const toLatLngLiteral = (
  point: google.maps.LatLng | google.maps.LatLngLiteral
): { lat: number; lng: number } => ({
  lat: typeof point.lat === "function" ? point.lat() : point.lat,
  lng: typeof point.lng === "function" ? point.lng() : point.lng,
});

export function CalendarMapView({
  isEmployee = false,
  selectedDate,
  onDateChange,
  teammates,
  jobAssignments,
  availableJobs = [],
  enabledTeammates,
  onToggleTeammate,
  onJobAction,
  onAddJobToRoute,
  height = "600px",
  focusTeammateId,
  showAcceptedJobs: propShowAcceptedJobs,
  showPendingJobs: propShowPendingJobs,
  showAvailableJobs: propShowAvailableJobs,
  onToggleAcceptedJobs: propOnToggleAcceptedJobs,
  onTogglePendingJobs: propOnTogglePendingJobs,
  onToggleAvailableJobs: propOnToggleAvailableJobs,
  workerProfile,
  referencePoints,
  referenceRadiusMiles,
  referenceRadiusMilesArray,
  toolbarRightContent,
}: CalendarMapViewProps) {
  const [focusedTeammateId, setFocusedTeammateId] = useState<number | null>(null);
  
  // Cache for geocoded teammate addresses (address -> { lat, lng })
  const geocodedAddressesRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  
  // Job type visibility toggles - use props if provided, otherwise use local state
  const [localShowAcceptedJobs, setLocalShowAcceptedJobs] = useState(true);
  const [localShowPendingJobs, setLocalShowPendingJobs] = useState(true);
  const [localShowAvailableJobs, setLocalShowAvailableJobs] = useState(true);
  
  const showAcceptedJobs = propShowAcceptedJobs !== undefined ? propShowAcceptedJobs : localShowAcceptedJobs;
  const showPendingJobs = propShowPendingJobs !== undefined ? propShowPendingJobs : localShowPendingJobs;
  const showAvailableJobs = propShowAvailableJobs !== undefined ? propShowAvailableJobs : localShowAvailableJobs;
  
  const setShowAcceptedJobs = propOnToggleAcceptedJobs || setLocalShowAcceptedJobs;
  const setShowPendingJobs = propOnTogglePendingJobs || setLocalShowPendingJobs;
  const setShowAvailableJobs = propOnToggleAvailableJobs || setLocalShowAvailableJobs;
  
  // Update focused teammate when prop changes
  useEffect(() => {
    if (focusTeammateId !== undefined) {
      setFocusedTeammateId(focusTeammateId);
    }
  }, [focusTeammateId]);
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || "";
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  const isMobileOrTablet = !isDesktop;
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [bottomSheetPosition, setBottomSheetPosition] = useState<"hidden" | "collapsed" | "peek" | "full">(
    isMobileOrTablet ? "collapsed" : "peek"
  );
  const [desktopPanelExpanded, setDesktopPanelExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragCurrentY, setDragCurrentY] = useState(0);
  
  const { isLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Show error if API key is missing or failed to load
  useEffect(() => {
    if (!apiKey) {
      console.error("❌ VITE_GOOGLE_API_KEY is not set in your .env.development file.");
      console.error("📝 To fix this:");
      console.error("   1. Get your API key from: https://console.cloud.google.com/apis/credentials");
      console.error("   2. Add to .env.development: VITE_GOOGLE_API_KEY=your-api-key-here");
      console.error("   3. Enable these APIs in Google Cloud Console:");
      console.error("      - Maps JavaScript API (required for map display)");
      console.error("      - Routes API or Fleet Routing API (for route optimization)");
    }
    if (loadError) {
      console.error("❌ Failed to load Google Maps script:", loadError);
      console.error("💡 This usually means:");
      console.error("   - API key is invalid or missing");
      console.error("   - Maps JavaScript API is not enabled");
      console.error("   - API key has restrictions that block this domain");
      console.error("");
      console.error("🔧 To fix:");
      console.error("   1. Go to: https://console.cloud.google.com/apis/library");
      console.error("   2. Search for 'Maps JavaScript API' and enable it");
      console.error("   3. Also enable 'Routes API' for fleet routing");
      console.error("   4. Check API key restrictions at: https://console.cloud.google.com/apis/credentials");
      console.error("   5. Ensure your API key allows 'Maps JavaScript API'");
      console.error("   6. If using domain restrictions, add 'localhost:5173' to allowed referrers");
    }
  }, [apiKey, loadError]);

  const [routes, setRoutes] = useState<TeammateRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<TeammateRoute | null>(null);
  const [directionsServices, setDirectionsServices] = useState<google.maps.DirectionsService[]>([]);
  const [directionsRenderers, setDirectionsRenderers] = useState<google.maps.DirectionsRenderer[]>([]);
  const mapRef = useRef<google.maps.Map | null>(null);
  const routeBuildInFlightRef = useRef(false);
  const lastRouteBuildKeyRef = useRef("");
  const replayUrlSyncTimeoutRef = useRef<number | null>(null);
  const replayCopyResetTimeoutRef = useRef<number | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [userGeoLocation, setUserGeoLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [optimizationSuggestions, setOptimizationSuggestions] = useState<ReassignmentSuggestion[]>([]);
  const todayStart = startOfDay(new Date());
  const selectedDayStart = startOfDay(selectedDate);
  const selectedDayEnd = endOfDay(selectedDate);
  const dateMode: "past" | "today" | "future" = isToday(selectedDate)
    ? "today"
    : isBefore(selectedDayEnd, todayStart)
      ? "past"
      : "future";
  const replayEnabled = false;
  const now = new Date();
  const [replayMinute, setReplayMinute] = useState(() => now.getHours() * 60 + now.getMinutes());
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayRailOpen, setReplayRailOpen] = useState(false);
  const [showReplayJobStarts, setShowReplayJobStarts] = useState(true);
  const [showReplayJobEnds, setShowReplayJobEnds] = useState(true);
  const [showReplayPings, setShowReplayPings] = useState(true);
  const [replayTeammateFilterIds, setReplayTeammateFilterIds] = useState<number[]>([]);
  const [replayLinkCopied, setReplayLinkCopied] = useState(false);
  const enabledTeammatesKey = useMemo(
    () => Array.from(enabledTeammates).sort((a, b) => a - b).join(","),
    [enabledTeammates]
  );
  const replayCutoff = useMemo(
    () => new Date(selectedDayStart.getTime() + replayMinute * 60 * 1000),
    [selectedDayStart, replayMinute]
  );
  const replayLabel = useMemo(
    () => `${String(Math.floor(replayMinute / 60)).padStart(2, "0")}:${String(replayMinute % 60).padStart(2, "0")}`,
    [replayMinute]
  );
  const replayEventTimeline = useMemo<ReplayEventChip[]>(() => {
    if (!replayEnabled || dateMode !== "past") return [];
    const minuteToChip = new Map<number, ReplayEventChip>();
    const toMinute = (d: Date) => {
      const minutes = Math.floor((d.getTime() - selectedDayStart.getTime()) / 60000);
      return Math.max(0, Math.min(1439, minutes));
    };
    const upsert = (chip: ReplayEventChip) => {
      const existing = minuteToChip.get(chip.minute);
      if (!existing) {
        minuteToChip.set(chip.minute, chip);
        return;
      }
      const rank = (k: ReplayEventChip["kind"]) => (k === "job-start" ? 3 : k === "job-end" ? 2 : 1);
      if (rank(chip.kind) > rank(existing.kind)) minuteToChip.set(chip.minute, chip);
    };
    jobAssignments.slice(0, 120).forEach((a) => {
      const start = typeof a.scheduledStart === "string" ? parseISO(a.scheduledStart) : a.scheduledStart;
      const end = typeof a.scheduledEnd === "string" ? parseISO(a.scheduledEnd) : a.scheduledEnd;
      if (start) {
        const m = toMinute(start);
        upsert({
          minute: m,
          label: `${format(start, "HH:mm")} ${a.jobTitle} start`,
          kind: "job-start",
          teammateId: a.teamMemberId ?? null,
        });
      }
      if (end) {
        const m = toMinute(end);
        upsert({
          minute: m,
          label: `${format(end, "HH:mm")} ${a.jobTitle} end`,
          kind: "job-end",
          teammateId: a.teamMemberId ?? null,
        });
      }
    });
    teammates.forEach((t) => {
      if (!Array.isArray(t.liveLocationPath) || t.liveLocationPath.length === 0) return;
      const step = Math.max(1, Math.floor(t.liveLocationPath.length / 12));
      t.liveLocationPath.forEach((pt, idx) => {
        if (idx % step !== 0 || !pt?.createdAt) return;
        const ts = new Date(pt.createdAt);
        if (Number.isNaN(ts.getTime())) return;
        const m = toMinute(ts);
        upsert({ minute: m, label: `${format(ts, "HH:mm")} ${t.firstName} ping`, kind: "ping", teammateId: t.id });
      });
    });
    return Array.from(minuteToChip.values()).sort((a, b) => a.minute - b.minute);
  }, [replayEnabled, dateMode, selectedDayStart, jobAssignments, teammates]);
  const replayTeammateFilterSet = useMemo(
    () => new Set(replayTeammateFilterIds),
    [replayTeammateFilterIds]
  );
  const replayEventTeammates = useMemo(() => {
    if (dateMode !== "past" || replayEventTimeline.length === 0) return [];
    const eventTeammateIds = new Set<number>();
    replayEventTimeline.forEach((chip) => {
      if (typeof chip.teammateId === "number") eventTeammateIds.add(chip.teammateId);
    });
    return teammates
      .filter((teammate) => eventTeammateIds.has(teammate.id))
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  }, [dateMode, replayEventTimeline, teammates]);
  useEffect(() => {
    if (replayTeammateFilterIds.length === 0) return;
    const validIds = new Set(teammates.map((t) => t.id));
    const next = replayTeammateFilterIds.filter((id) => validIds.has(id));
    if (next.length === replayTeammateFilterIds.length) return;
    setReplayTeammateFilterIds(next);
  }, [replayTeammateFilterIds, teammates]);
  const replayFilteredTimeline = useMemo(() => {
    return replayEventTimeline.filter((chip) => {
      const kindVisible =
        chip.kind === "job-start" ? showReplayJobStarts : chip.kind === "job-end" ? showReplayJobEnds : showReplayPings;
      if (!kindVisible) return false;
      if (replayTeammateFilterSet.size === 0) return true;
      if (typeof chip.teammateId !== "number") return false;
      return replayTeammateFilterSet.has(chip.teammateId);
    });
  }, [replayEventTimeline, showReplayJobStarts, showReplayJobEnds, showReplayPings, replayTeammateFilterSet]);
  const replayEventMinutes = useMemo(() => replayFilteredTimeline.map((e) => e.minute), [replayFilteredTimeline]);
  const replayEventChips = useMemo<ReplayEventChip[]>(() => {
    if (replayFilteredTimeline.length === 0) return [];
    const past = replayFilteredTimeline.filter((e) => e.minute <= replayMinute).slice(-3);
    const future = replayFilteredTimeline.filter((e) => e.minute > replayMinute).slice(0, 3);
    const anchors = [replayFilteredTimeline[0], ...past, ...future, replayFilteredTimeline[replayFilteredTimeline.length - 1]].filter(Boolean) as ReplayEventChip[];
    const seen = new Set<number>();
    return anchors.filter((e) => {
      if (seen.has(e.minute)) return false;
      seen.add(e.minute);
      return true;
    });
  }, [replayFilteredTimeline, replayMinute]);
  const replayEventRail = useMemo<ReplayEventChip[]>(() => {
    if (replayFilteredTimeline.length === 0) return [];
    const around = replayFilteredTimeline.filter((e) => Math.abs(e.minute - replayMinute) <= 180);
    return (around.length > 0 ? around : replayFilteredTimeline).slice(0, 24);
  }, [replayFilteredTimeline, replayMinute]);

  useEffect(() => {
    if (dateMode === "past") setReplayMinute(23 * 60 + 59);
    else if (dateMode === "future") setReplayMinute(9 * 60);
    else setReplayMinute(now.getHours() * 60 + now.getMinutes());
    setReplayPlaying(false);
    setReplayRailOpen(false);
    setReplayTeammateFilterIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateMode, selectedDayStart.getTime()]);
  useEffect(() => {
    if (!replayEnabled || dateMode !== "past") return;
    const params = new URLSearchParams(window.location.search);
    const parsed = parseReplayUrlState(params);
    if (typeof parsed.replayMinute === "number") {
      setReplayMinute((prev) => (prev === parsed.replayMinute ? prev : parsed.replayMinute));
    }
    if (typeof parsed.showReplayJobStarts === "boolean") {
      setShowReplayJobStarts((prev) => (prev === parsed.showReplayJobStarts ? prev : parsed.showReplayJobStarts));
    }
    if (typeof parsed.showReplayJobEnds === "boolean") {
      setShowReplayJobEnds((prev) => (prev === parsed.showReplayJobEnds ? prev : parsed.showReplayJobEnds));
    }
    if (typeof parsed.showReplayPings === "boolean") {
      setShowReplayPings((prev) => (prev === parsed.showReplayPings ? prev : parsed.showReplayPings));
    }
    if (Array.isArray(parsed.replayTeammateFilterIds)) {
      setReplayTeammateFilterIds((prev) => {
        if (prev.length === parsed.replayTeammateFilterIds!.length && prev.every((v, i) => v === parsed.replayTeammateFilterIds![i])) {
          return prev;
        }
        return parsed.replayTeammateFilterIds!;
      });
    }
    if (typeof parsed.replayRailOpen === "boolean") {
      setReplayRailOpen((prev) => (prev === parsed.replayRailOpen ? prev : parsed.replayRailOpen));
    }
  }, [replayEnabled, dateMode, selectedDayStart.getTime()]);
  useEffect(() => {
    if (replayUrlSyncTimeoutRef.current !== null) {
      window.clearTimeout(replayUrlSyncTimeoutRef.current);
      replayUrlSyncTimeoutRef.current = null;
    }
    const url = new URL(window.location.href);
    const params = url.searchParams;
    let changed = false;
    if (!replayEnabled || dateMode !== "past") {
      REPLAY_QUERY_KEYS.forEach((key) => {
        if (params.has(key)) {
          params.delete(key);
          changed = true;
        }
      });
      if (changed) {
        const next = `${url.pathname}${params.toString() ? `?${params.toString()}` : ""}${url.hash}`;
        window.history.replaceState(window.history.state, "", next);
      }
      return;
    }

    changed = writeReplayUrlState(params, {
      replayMinute,
      showReplayJobStarts,
      showReplayJobEnds,
      showReplayPings,
      replayTeammateFilterIds,
      replayRailOpen,
    });

    if (!changed) return;
    replayUrlSyncTimeoutRef.current = window.setTimeout(() => {
      const next = `${url.pathname}${params.toString() ? `?${params.toString()}` : ""}${url.hash}`;
      window.history.replaceState(window.history.state, "", next);
      replayUrlSyncTimeoutRef.current = null;
    }, 150);
    return () => {
      if (replayUrlSyncTimeoutRef.current !== null) {
        window.clearTimeout(replayUrlSyncTimeoutRef.current);
        replayUrlSyncTimeoutRef.current = null;
      }
    };
  }, [
    replayEnabled,
    dateMode,
    replayMinute,
    replayRailOpen,
    replayTeammateFilterIds,
    showReplayJobEnds,
    showReplayJobStarts,
    showReplayPings,
  ]);

  useEffect(() => {
    if (!replayEnabled || dateMode !== "past" || !replayPlaying) return;
    const timer = window.setInterval(() => {
      setReplayMinute((m) => {
        const next = m + 5;
        if (next >= 23 * 60 + 59) {
          setReplayPlaying(false);
          return 23 * 60 + 59;
        }
        return next;
      });
    }, 800);
    return () => window.clearInterval(timer);
  }, [replayEnabled, dateMode, replayPlaying]);
  const jumpReplayEvent = useCallback((direction: "prev" | "next") => {
    if (replayEventMinutes.length === 0) return;
    if (direction === "prev") {
      const prev = [...replayEventMinutes].reverse().find((m) => m < replayMinute);
      setReplayMinute(prev ?? replayEventMinutes[0]);
      return;
    }
    const next = replayEventMinutes.find((m) => m > replayMinute);
    setReplayMinute(next ?? replayEventMinutes[replayEventMinutes.length - 1]);
  }, [replayEventMinutes, replayMinute]);
  const replayChipTone = useCallback((kind: ReplayEventChip["kind"], active: boolean) => {
    if (active) return "bg-primary text-primary-foreground border-primary";
    if (kind === "job-start") return "border-green-300 text-green-700 dark:border-green-800 dark:text-green-300";
    if (kind === "job-end") return "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300";
    return "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300";
  }, []);
  const toggleReplayTeammateFilter = useCallback((teammateId: number) => {
    setReplayTeammateFilterIds((prev) =>
      prev.includes(teammateId) ? prev.filter((id) => id !== teammateId) : [...prev, teammateId]
    );
  }, []);
  const handleCopyReplayLink = useCallback(async () => {
    const text = window.location.href;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      copied = document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    setReplayLinkCopied(copied);
    if (replayCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(replayCopyResetTimeoutRef.current);
      replayCopyResetTimeoutRef.current = null;
    }
    replayCopyResetTimeoutRef.current = window.setTimeout(() => {
      setReplayLinkCopied(false);
      replayCopyResetTimeoutRef.current = null;
    }, 1400);
  }, []);
  useEffect(() => {
    return () => {
      if (replayCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(replayCopyResetTimeoutRef.current);
      }
    };
  }, []);
  const fitBoundsWithZoomCap = useCallback(
    (bounds: google.maps.LatLngBounds) => {
      const map = mapRef.current;
      if (!map || bounds.isEmpty() || !window.google?.maps?.event) return;
      map.fitBounds(bounds);
      google.maps.event.addListenerOnce(map, "idle", () => {
        const zoom = map.getZoom();
        if (typeof zoom === "number" && zoom > MAX_AUTOFIT_ZOOM) {
          map.setZoom(MAX_AUTOFIT_ZOOM);
        }
      });
    },
    []
  );

  // Initial map center: admin's pinned address (profile) or geolocation, so map auto-focuses on admin
  const initialMapCenter = useMemo(() => {
    const fromProfile =
      workerProfile?.latitude != null &&
      workerProfile?.longitude != null &&
      workerProfile.latitude !== "" &&
      workerProfile.longitude !== "";
    if (fromProfile) {
      const lat = parseFloat(String(workerProfile.latitude));
      const lng = parseFloat(String(workerProfile.longitude));
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    if (userGeoLocation) return userGeoLocation;
    return { lat: 37.7749, lng: -122.4194 };
  }, [workerProfile?.latitude, workerProfile?.longitude, userGeoLocation]);

  // Request geolocation when profile has no lat/lng (so map can still focus on admin)
  useEffect(() => {
    const hasProfileCoords = !!(workerProfile?.latitude && workerProfile?.longitude);
    const hasAnyJobCoords =
      jobAssignments.some((a) => {
        const lat = a.latitude != null ? parseFloat(String(a.latitude)) : NaN;
        const lng = a.longitude != null ? parseFloat(String(a.longitude)) : NaN;
        return Number.isFinite(lat) && Number.isFinite(lng);
      }) ||
      availableJobs.some((j) => {
        const lat = j.latitude != null ? parseFloat(String(j.latitude)) : NaN;
        const lng = j.longitude != null ? parseFloat(String(j.longitude)) : NaN;
        return Number.isFinite(lat) && Number.isFinite(lng);
      });

    if (
      typeof navigator !== "undefined" &&
      navigator.geolocation &&
      !hasProfileCoords &&
      !hasAnyJobCoords
    ) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserGeoLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    }
  }, [workerProfile?.latitude, workerProfile?.longitude, jobAssignments, availableJobs]);

  // Filter job assignments for selected date and job type visibility
  const filteredJobAssignments = useMemo(() => {
    const filtered = jobAssignments.filter((assignment) => {
      const assignmentDate = typeof assignment.scheduledStart === "string" 
        ? parseISO(assignment.scheduledStart)
        : assignment.scheduledStart;
      
      // Normalize dates to start of day for comparison
      const assignmentDateNormalized = startOfDay(assignmentDate);
      const selectedDateNormalized = startOfDay(selectedDate);
      
      // Allow jobs within ±1 day for better visibility (matching available jobs filter)
      const dayBefore = startOfDay(subDays(selectedDate, 1));
      const dayAfter = startOfDay(addDays(selectedDate, 1));
      
      const isWithinRange = 
        assignmentDateNormalized.getTime() === selectedDateNormalized.getTime() ||
        assignmentDateNormalized.getTime() === dayBefore.getTime() ||
        assignmentDateNormalized.getTime() === dayAfter.getTime();
      
      if (!isWithinRange) {
        return false;
      }
      
      // Filter by job type visibility
      const status = assignment.status?.toLowerCase() || "";
      // Map statuses: "accepted" -> accepted, "pending"/"scheduled" -> pending, others -> pending
      if ((status === "accepted" || status === "assigned") && !showAcceptedJobs) return false;
      if ((status === "pending" || status === "scheduled" || status === "") && !showPendingJobs) return false;
      // Note: available jobs (no teamMemberId) are handled separately in filteredAvailableJobs
      
      return true;
    });
    
    return filtered;
  }, [jobAssignments, selectedDate, showAcceptedJobs, showPendingJobs]);

  // Filter available jobs for the selected date and visibility toggle
  const filteredAvailableJobs = useMemo(() => {
    if (!availableJobs || availableJobs.length === 0 || !showAvailableJobs) return [];
    
    return availableJobs.filter(job => {
      const jobDate = typeof job.startDate === "string" 
        ? parseISO(job.startDate)
        : job.startDate;
      
      if (!jobDate) return false;
      
      // Allow jobs within ±1 day for better visibility
      const jobDateNormalized = startOfDay(jobDate);
      const selectedDateNormalized = startOfDay(selectedDate);
      const dayBefore = startOfDay(subDays(selectedDate, 1));
      const dayAfter = startOfDay(addDays(selectedDate, 1));
      
      const isWithinRange = 
        jobDateNormalized.getTime() === selectedDateNormalized.getTime() ||
        jobDateNormalized.getTime() === dayBefore.getTime() ||
        jobDateNormalized.getTime() === dayAfter.getTime();
      
      if (!isWithinRange) return false;
      return isSameDay(jobDate, selectedDate);
    });
  }, [availableJobs, selectedDate, showAvailableJobs]);

  // Extract unassigned jobs (jobs without teamMemberId) to show as markers
  const unassignedJobs = useMemo(() => {
    return filteredJobAssignments.filter(assignment => {
      // Only include jobs without teamMemberId that have coordinates
      if (assignment.teamMemberId) return false;
      
      const lat = assignment.latitude ? parseFloat(assignment.latitude) : null;
      const lng = assignment.longitude ? parseFloat(assignment.longitude) : null;
      
      return lat !== null && lng !== null;
    });
  }, [filteredJobAssignments]);

  // Helper function to calculate distance in miles (Haversine formula)
  const calculateDistanceMiles = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }, []);

  // Helper function to geocode an address using Google Maps Geocoding API
  // Caches results to avoid re-geocoding the same address
  const geocodeAddress = useCallback(async (address: string): Promise<{ lat: number; lng: number } | null> => {
    if (!isLoaded || !window.google?.maps?.Geocoder) {
      console.warn("⚠️ Google Maps not loaded, cannot geocode address");
      return null;
    }

    // Check cache first
    if (geocodedAddressesRef.current.has(address)) {
      return geocodedAddressesRef.current.get(address) || null;
    }

    try {
      const geocoder = new google.maps.Geocoder();
      return new Promise((resolve) => {
        geocoder.geocode({ address }, (results, status) => {
          if (status === google.maps.GeocoderStatus.OK && results && results[0]) {
            const location = results[0].geometry.location;
            const coords = {
              lat: location.lat(),
              lng: location.lng(),
            };
            // Cache the result
            geocodedAddressesRef.current.set(address, coords);
            resolve(coords);
          } else {
            console.warn(`⚠️ Geocoding failed for address "${address}": ${status}`);
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.error("Error geocoding address:", error);
      return null;
    }
  }, [isLoaded]);

  // Build routes for each enabled teammate
  const buildRoutes = useCallback(async () => {
    if (!isLoaded || !mapRef.current) return;

    setLoadingRoutes(true);
    const newRoutes: TeammateRoute[] = [];
    const newServices: google.maps.DirectionsService[] = [];
    const newRenderers: google.maps.DirectionsRenderer[] = [];
    const reassignmentCandidates: ReassignmentSuggestion[] = [];
    const routeOrigins = new Map<number, { lat: number; lng: number; teammateName: string }>();

    // Group job assignments by teammate
    const jobsByTeammate = new Map<number, JobStop[]>();
    
    // Get teammate start locations for geofence filtering
    // Use real-time location if available, otherwise use work location coordinates, or geocode address
    const teammateStartLocations = new Map<number, { lat: number; lng: number }>();
    
    for (const teammate of teammates) {
      if (!enabledTeammates.has(teammate.id)) continue;
      
      let startLat: number | null = null;
      let startLng: number | null = null;
      
      // Priority 1: Use live location (real-time GPS) if available
      if (hasValidCoord(teammate.liveLocationLat) && hasValidCoord(teammate.liveLocationLng)) {
        startLat = teammate.liveLocationLat;
        startLng = teammate.liveLocationLng;
      } 
      // Priority 2: Use work location coordinates (from address geocoding) if available
      else if (hasValidCoord(teammate.workLocationLat) && hasValidCoord(teammate.workLocationLng)) {
        startLat = teammate.workLocationLat;
        startLng = teammate.workLocationLng;
      } 
      // Priority 3: Geocode the work location address to get coordinates
      else if (teammate.workLocationAddress) {
        console.log(`📍 Geocoding address for geofence: ${teammate.workLocationAddress}`);
        const geocoded = await geocodeAddress(teammate.workLocationAddress);
        if (geocoded) {
          startLat = geocoded.lat;
          startLng = geocoded.lng;
          console.log(`✅ Geocoded ${teammate.firstName} ${teammate.lastName} address to ${startLat}, ${startLng}`);
        } else {
          console.warn(`⚠️ Failed to geocode address for ${teammate.firstName} ${teammate.lastName} - trying worker profile fallback`);
        }
      }
      
      // Priority 4: Fallback to worker profile address/coordinates if teammate has no location
      if (startLat === null || startLng === null) {
        if (workerProfile?.latitude && workerProfile?.longitude) {
          startLat = parseFloat(workerProfile.latitude);
          startLng = parseFloat(workerProfile.longitude);
          console.log(`📍 Using worker profile coordinates as fallback for ${teammate.firstName} ${teammate.lastName}: ${startLat}, ${startLng}`);
        } else if (workerProfile?.address) {
          const workerAddress = `${workerProfile.address}${workerProfile.city ? `, ${workerProfile.city}` : ""}${workerProfile.state ? `, ${workerProfile.state}` : ""}`;
          console.log(`📍 Geocoding worker profile address as fallback for ${teammate.firstName} ${teammate.lastName}: ${workerAddress}`);
          const geocoded = await geocodeAddress(workerAddress);
          if (geocoded) {
            startLat = geocoded.lat;
            startLng = geocoded.lng;
            console.log(`✅ Geocoded worker profile address to ${startLat}, ${startLng} for ${teammate.firstName} ${teammate.lastName}`);
          }
        }
      }
      
      if (startLat !== null && startLng !== null) {
        teammateStartLocations.set(teammate.id, { lat: startLat, lng: startLng });
      } else {
        console.warn(`⚠️ No location found for ${teammate.firstName} ${teammate.lastName} (ID: ${teammate.id}) - teammate will not appear on map`);
      }
    }
    
    // Include all job assignments (accepted, pending, available) that are assigned to enabled teammates
    filteredJobAssignments.forEach((assignment) => {
      // If job has teamMemberId, only include if that teammate is enabled
      if (assignment.teamMemberId && !enabledTeammates.has(assignment.teamMemberId)) return;
      
      const lat = assignment.latitude ? parseFloat(assignment.latitude) : null;
      const lng = assignment.longitude ? parseFloat(assignment.longitude) : null;
      
      if (!lat || !lng) {
        console.warn(`⚠️ Job ${assignment.jobId} (${assignment.jobTitle}) missing coordinates - skipping`);
        return;
      }

      // For pending/available jobs (no teamMemberId), apply 15mi geofence
      const isPendingOrAvailable = !assignment.teamMemberId || 
        (assignment.status?.toLowerCase() === "pending" || assignment.status?.toLowerCase() === "scheduled");
      const applyGeofence = dateMode === "today";
      
      if (isPendingOrAvailable) {
        // Find closest enabled teammate. Today: enforce 15mi geofence. Past/future: include all for planning/history.
        let closestTeammateId: number | null = null;
        let closestDistance = Infinity;
        
        teammateStartLocations.forEach((startLoc, teammateId) => {
          const distance = calculateDistanceMiles(startLoc.lat, startLoc.lng, lat, lng);
          const isAllowed = !applyGeofence || distance <= 15;
          if (isAllowed && distance < closestDistance) {
            closestDistance = distance;
            closestTeammateId = teammateId;
          }
        });
        
        if (!closestTeammateId) {
          // Historical/low-signal fallback: keep job visible by attaching to first enabled teammate.
          const firstEnabled = teammates.find((t) => enabledTeammates.has(t.id));
          if (!firstEnabled) return;
          closestTeammateId = firstEnabled.id;
        }
        
        // Assign to closest teammate
        const targetTeammateId = closestTeammateId;
        
        if (!jobsByTeammate.has(targetTeammateId)) {
          jobsByTeammate.set(targetTeammateId, []);
        }

        const scheduledStart = typeof assignment.scheduledStart === "string"
          ? parseISO(assignment.scheduledStart)
          : assignment.scheduledStart;
        const scheduledEnd = typeof assignment.scheduledEnd === "string"
          ? parseISO(assignment.scheduledEnd)
          : assignment.scheduledEnd;

        jobsByTeammate.get(targetTeammateId)!.push({
          jobId: assignment.jobId,
          jobTitle: assignment.jobTitle,
          address: assignment.address,
          lat,
          lng,
          scheduledStart,
          scheduledEnd,
          status: assignment.status as "scheduled" | "in-progress" | "completed",
          sequence: 0,
          assignmentStatus: assignment.status,
        });
        
        return;
      }
      
      // For accepted jobs with teamMemberId, include directly
      const targetTeammateId = assignment.teamMemberId;
      if (!targetTeammateId) return;

      const scheduledStart = typeof assignment.scheduledStart === "string"
        ? parseISO(assignment.scheduledStart)
        : assignment.scheduledStart;
      const scheduledEnd = typeof assignment.scheduledEnd === "string"
        ? parseISO(assignment.scheduledEnd)
        : assignment.scheduledEnd;

      if (!jobsByTeammate.has(targetTeammateId)) {
        jobsByTeammate.set(targetTeammateId, []);
      }

      jobsByTeammate.get(targetTeammateId)!.push({
        jobId: assignment.jobId,
        jobTitle: assignment.jobTitle,
        address: assignment.address,
        lat,
        lng,
        scheduledStart,
        scheduledEnd,
        status: assignment.status as "scheduled" | "in-progress" | "completed",
        sequence: 0,
        assignmentStatus: assignment.status,
      });
    });
    
    // Note: Available jobs are shown as separate markers, not automatically added to routes
    // They will be displayed with route optimization suggestions in the marker info windows

    // Sort jobs by scheduled start time and assign sequence, determine current/next/behind status
    const now = dateMode === "past" ? endOfDay(selectedDate) : new Date();
    jobsByTeammate.forEach((jobs, teammateId) => {
      jobs.sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());
      jobs.forEach((job, index) => {
        job.sequence = index + 1;
        
        // Determine if this is the current job (started but not ended)
        const hasStarted = now >= job.scheduledStart;
        const hasEnded = now >= job.scheduledEnd;
        job.isCurrent = hasStarted && !hasEnded;
        
        // Determine if this is the next job (not started, but is the next one)
        const previousJob = index > 0 ? jobs[index - 1] : null;
        const previousEnded = !previousJob || now >= previousJob.scheduledEnd;
        const nextJobIndex = jobs.findIndex(j => !j.isCurrent && now < j.scheduledStart);
        job.isNext = !hasStarted && previousEnded && index === nextJobIndex;
        
        // Determine if behind schedule (current job and past scheduled start by more than 15 minutes)
        if (job.isCurrent) {
          const minutesLate = (now.getTime() - job.scheduledStart.getTime()) / (1000 * 60);
          job.isBehind = minutesLate > 15;
        } else if (!hasStarted) {
          // Check if previous job is running late and might affect this one
          if (previousJob && previousJob.isCurrent && previousJob.isBehind) {
            const timeUntilThisJob = (job.scheduledStart.getTime() - now.getTime()) / (1000 * 60);
            job.isBehind = timeUntilThisJob < 30; // Less than 30 min buffer
          }
        }
      });
    });

    // Build routes for each teammate
    for (const teammate of teammates) {
      if (!enabledTeammates.has(teammate.id)) continue;

      const jobs = jobsByTeammate.get(teammate.id) || [];
      if (jobs.length === 0) continue;

      const hasPending = jobs.some(
        (j) =>
          j.assignmentStatus?.toLowerCase() === "pending" ||
          j.assignmentStatus?.toLowerCase() === "scheduled" ||
          (j.assignmentStatus && j.assignmentStatus.toLowerCase() !== "accepted" && j.assignmentStatus.toLowerCase() !== "assigned")
      );
      const routeType: RouteType = hasPending ? "pending" : "accepted";
      const routeColor = routeType === "accepted" ? ROUTE_COLOR_ACCEPTED : ROUTE_COLOR_PENDING;

      // Determine starting point with fallback logic:
      // 1. Use live location (GPS) if available - real-time location from location services
      // 2. Fall back to work location coordinates (home/start address coordinates) if no live location
      // 3. Geocode work location address if coordinates not available
      // 4. Fallback to worker profile address/coordinates if teammate has no location
      // 5. Skip if no address or location available at all
      let startLat: number;
      let startLng: number;
      let startAddress: string;

      if (hasValidCoord(teammate.liveLocationLat) && hasValidCoord(teammate.liveLocationLng)) {
        // Use live location (GPS) if available - this is where the worker is RIGHT NOW
        startLat = teammate.liveLocationLat;
        startLng = teammate.liveLocationLng;
        startAddress = "Current Location (GPS)";
      } else if (hasValidCoord(teammate.workLocationLat) && hasValidCoord(teammate.workLocationLng)) {
        // Fall back to work location (home/start address coordinates) if GPS not available
        startLat = teammate.workLocationLat;
        startLng = teammate.workLocationLng;
        startAddress = teammate.workLocationAddress || "Work Location";
      } else if (teammate.workLocationAddress) {
        // Geocode the work location address to get coordinates
        console.log(`📍 Geocoding address for ${teammate.firstName} ${teammate.lastName}: ${teammate.workLocationAddress}`);
        const geocoded = await geocodeAddress(teammate.workLocationAddress);
        if (geocoded) {
          startLat = geocoded.lat;
          startLng = geocoded.lng;
          startAddress = teammate.workLocationAddress;
          console.log(`✅ Geocoded ${teammate.firstName} ${teammate.lastName} address to ${startLat}, ${startLng}`);
        } else {
          // If geocoding fails, try worker profile as fallback
          if (workerProfile?.latitude && workerProfile?.longitude) {
            startLat = parseFloat(workerProfile.latitude);
            startLng = parseFloat(workerProfile.longitude);
            startAddress = workerProfile.address || "Worker Address";
            console.log(`📍 Using worker profile coordinates as fallback for ${teammate.firstName} ${teammate.lastName}: ${startLat}, ${startLng}`);
          } else if (workerProfile?.address) {
            const workerAddress = `${workerProfile.address}${workerProfile.city ? `, ${workerProfile.city}` : ""}${workerProfile.state ? `, ${workerProfile.state}` : ""}`;
            console.log(`📍 Geocoding worker profile address as fallback for ${teammate.firstName} ${teammate.lastName}: ${workerAddress}`);
            const workerGeocoded = await geocodeAddress(workerAddress);
            if (workerGeocoded) {
              startLat = workerGeocoded.lat;
              startLng = workerGeocoded.lng;
              startAddress = workerAddress;
              console.log(`✅ Geocoded worker profile address to ${startLat}, ${startLng} for ${teammate.firstName} ${teammate.lastName}`);
            } else {
              console.warn(`⚠️ Failed to geocode addresses for ${teammate.firstName} ${teammate.lastName} - skipping route`);
              continue;
            }
          } else {
            console.warn(`⚠️ Failed to geocode address for ${teammate.firstName} ${teammate.lastName} and no worker profile fallback - skipping route`);
            continue;
          }
        }
      } else {
        // No teammate address - use worker profile as fallback
        if (workerProfile?.latitude && workerProfile?.longitude) {
          startLat = parseFloat(workerProfile.latitude);
          startLng = parseFloat(workerProfile.longitude);
          startAddress = workerProfile.address || "Worker Address";
          console.log(`📍 Using worker profile coordinates for ${teammate.firstName} ${teammate.lastName} (no teammate address): ${startLat}, ${startLng}`);
        } else if (workerProfile?.address) {
          const workerAddress = `${workerProfile.address}${workerProfile.city ? `, ${workerProfile.city}` : ""}${workerProfile.state ? `, ${workerProfile.state}` : ""}`;
          console.log(`📍 Geocoding worker profile address for ${teammate.firstName} ${teammate.lastName} (no teammate address): ${workerAddress}`);
          const workerGeocoded = await geocodeAddress(workerAddress);
          if (workerGeocoded) {
            startLat = workerGeocoded.lat;
            startLng = workerGeocoded.lng;
            startAddress = workerAddress;
            console.log(`✅ Geocoded worker profile address to ${startLat}, ${startLng} for ${teammate.firstName} ${teammate.lastName}`);
          } else {
            console.warn(`⚠️ No location or address for ${teammate.firstName} ${teammate.lastName} and failed to geocode worker profile - skipping route`);
            continue;
          }
        } else {
          // Skip if no starting point available at all
          console.warn(`⚠️ No location or address for ${teammate.firstName} ${teammate.lastName} and no worker profile fallback - skipping route`);
          continue;
        }
      }

      const route: TeammateRoute = {
        teammateId: teammate.id,
        teammateName: `${teammate.firstName} ${teammate.lastName}`,
        teammateAvatar: teammate.avatarUrl,
        workLocation: teammate.workLocationAddress && hasValidCoord(teammate.workLocationLat) && hasValidCoord(teammate.workLocationLng)
          ? {
              address: teammate.workLocationAddress,
              lat: teammate.workLocationLat,
              lng: teammate.workLocationLng,
            }
          : {
              address: startAddress,
              lat: startLat,
              lng: startLng,
            },
        liveLocation: hasValidCoord(teammate.liveLocationLat) && hasValidCoord(teammate.liveLocationLng)
          ? {
              lat: teammate.liveLocationLat,
              lng: teammate.liveLocationLng,
              timestamp: teammate.liveLocationTimestamp || new Date(),
            }
          : null,
        jobs,
        route: null,
        routeColor,
        routeType,
        routeSource: "polyline",
      };
      if (dateMode === "past" && Array.isArray(teammate.liveLocationPath) && teammate.liveLocationPath.length > 0) {
        const allHistory = teammate.liveLocationPath
          .map((pt) => ({
            lat: Number(pt.lat),
            lng: Number(pt.lng),
            createdAt: pt.createdAt ? new Date(pt.createdAt) : null,
          }))
          .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
        if (allHistory.length > 1) {
          route.fullTrail = allHistory;
        }
        const visibleHistory = replayEnabled
          ? allHistory.filter((pt) => !pt.createdAt || pt.createdAt.getTime() <= replayCutoff.getTime())
          : allHistory;
        if (visibleHistory.length > 0) {
          const last = visibleHistory[visibleHistory.length - 1];
          route.liveLocation = {
            lat: last.lat,
            lng: last.lng,
            timestamp: last.createdAt || endOfDay(selectedDate),
          };
        }
        if (visibleHistory.length > 1) {
          route.replayTrail = visibleHistory;
          route.overviewPath = [...visibleHistory.map((p) => ({ lat: p.lat, lng: p.lng })), ...jobs.map((j) => ({ lat: j.lat, lng: j.lng }))];
          route.routeSource = "polyline";
        }
      }
      routeOrigins.set(teammate.id, {
        lat: startLat,
        lng: startLng,
        teammateName: `${teammate.firstName} ${teammate.lastName}`,
      });

      // Calculate route using Google Fleet Routing API (Routes API)
      if (jobs.length > 0) {
        try {
          // Prepare waypoints for fleet routing
          const waypoints = jobs.map((job) => ({
            lat: job.lat,
            lng: job.lng,
            address: job.address,
          }));

          // Call backend Fleet Routing API endpoint
          const response = await fetch("/api/fleet-routing", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include", // Include cookies for authentication
            body: JSON.stringify({
              vehicles: [
                {
                  id: teammate.id,
                  origin: { lat: startLat, lng: startLng },
                },
              ],
              waypoints: waypoints,
            }),
          });

          if (!response.ok) {
            throw new Error(`Fleet routing API failed: ${response.statusText}`);
          }

          const data = await response.json();
          
          if (data.success && data.route) {
            // Convert backend response to DirectionsResult format
            const directionsResult = data.route as google.maps.DirectionsResult;
            route.route = directionsResult;
            const ov = directionsResult.routes?.[0]?.overview_path;
            route.overviewPath = ov ? ov.map((p) => toLatLngLiteral(p)) : undefined;

            // Use total distance and duration from API response
            const totalDistanceMeters = data.totalDistance || 0;
            const totalDurationSeconds = parseInt(data.totalDuration?.replace("s", "") || "0");
            
            route.totalDistance = `${(totalDistanceMeters / 1609.34).toFixed(1)} mi`;
            route.totalDuration = `${Math.round(totalDurationSeconds / 60)} min`;
            route.routeSource = "fleet";
            console.log(`✅ Fleet route calculated for ${route.teammateName}: ${route.totalDistance}, ${route.totalDuration}`);
          } else {
            throw new Error("No route returned from Fleet Routing API");
          }
        } catch (error) {
          console.error(`❌ Failed to calculate fleet route for ${route.teammateName}:`, error);
          // Fallback to simple Directions API if Fleet Routing fails
          try {
            const service = new google.maps.DirectionsService();
            const waypoints = jobs.slice(0, -1).map((job) => ({
              location: { lat: job.lat, lng: job.lng },
              stopover: true,
            }));

            const destination = jobs[jobs.length - 1];

            const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
              service.route(
                {
                  origin: { lat: startLat, lng: startLng },
                  destination: { lat: destination.lat, lng: destination.lng },
                  waypoints: waypoints.length > 0 ? waypoints : undefined,
                  optimizeWaypoints: true,
                  travelMode: google.maps.TravelMode.DRIVING,
                },
                (result, status) => {
                  if (status === google.maps.DirectionsStatus.OK && result) {
                    resolve(result);
                  } else {
                    reject(new Error(`Directions request failed: ${status}`));
                  }
                }
              );
            });

            route.route = result;
            const ov = result.routes?.[0]?.overview_path;
            route.overviewPath = ov ? ov.map((p) => toLatLngLiteral(p)) : undefined;

            let totalDistance = 0;
            let totalDuration = 0;
            
            result.routes[0]?.legs.forEach((leg) => {
              if (leg.distance) totalDistance += leg.distance.value;
              if (leg.duration) totalDuration += leg.duration.value;
            });

            route.totalDistance = `${(totalDistance / 1609.34).toFixed(1)} mi`;
            route.totalDuration = `${Math.round(totalDuration / 60)} min`;
            route.routeSource = "directions";
            console.log(`✅ Fallback route calculated for ${route.teammateName}: ${route.totalDistance}, ${route.totalDuration}`);
          } catch (fallbackError) {
            console.error(`❌ Fallback route calculation also failed for ${route.teammateName}:`, fallbackError);
            console.warn(`⚠️ Adding route for ${route.teammateName} without directions - jobs will still be visible`);
          }
        }
      } else {
        console.warn(`⚠️ No jobs found for ${route.teammateName} - skipping route calculation`);
      }

      newRoutes.push(route);
    }

    // When "Available jobs" toggle is on, add a route from worker's location to available jobs
    if (showAvailableJobs && filteredAvailableJobs.length > 0) {
      const availableJobStops: JobStop[] = filteredAvailableJobs
        .map((job) => {
          const lat = job.latitude != null && job.latitude !== "" ? parseFloat(String(job.latitude)) : null;
          const lng = job.longitude != null && job.longitude !== "" ? parseFloat(String(job.longitude)) : null;
          if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const startDate = typeof job.startDate === "string" ? parseISO(job.startDate) : job.startDate;
          let startH = 9, startM = 0;
          if (job.scheduledTime) {
            const t = String(job.scheduledTime);
            const match = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
            if (match) {
              startH = parseInt(match[1], 10);
              startM = parseInt(match[2], 10);
              if (match[3]?.toUpperCase() === "PM" && startH !== 12) startH += 12;
              if (match[3]?.toUpperCase() === "AM" && startH === 12) startH = 0;
            }
          }
          const scheduledStart = new Date(startDate);
          scheduledStart.setHours(startH, startM, 0, 0);
          const estimatedHours = typeof job.estimatedHours === "number" ? job.estimatedHours : 4;
          const scheduledEnd = new Date(scheduledStart.getTime() + estimatedHours * 60 * 60 * 1000);
          const stop: JobStop = {
            jobId: job.id,
            jobTitle: job.title || "Job",
            address: job.address || job.location || "",
            lat,
            lng,
            scheduledStart,
            scheduledEnd,
            status: "scheduled",
            sequence: 0,
          };
          return stop;
        })
        .filter((j): j is JobStop => j !== null);
      if (availableJobStops.length > 0) {
        availableJobStops.sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());
        availableJobStops.forEach((j, i) => { j.sequence = i + 1; });
        const workerRoute: TeammateRoute = {
          teammateId: 0,
          teammateName: "You (available jobs)",
          teammateAvatar: workerProfile?.avatarUrl ?? null,
          workLocation: { address: "Your location", lat: initialMapCenter.lat, lng: initialMapCenter.lng },
          liveLocation: null,
          jobs: availableJobStops,
          route: null,
          routeColor: ROUTE_COLOR_AVAILABLE,
          routeType: "available",
          routeSource: "polyline",
        };
        try {
          const service = new google.maps.DirectionsService();
          const waypoints = availableJobStops.slice(0, -1).map((job) => ({
            location: { lat: job.lat, lng: job.lng },
            stopover: true,
          }));
          const destination = availableJobStops[availableJobStops.length - 1];
          const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
            service.route(
              {
                origin: { lat: initialMapCenter.lat, lng: initialMapCenter.lng },
                destination: { lat: destination.lat, lng: destination.lng },
                waypoints: waypoints.length > 0 ? waypoints : undefined,
                optimizeWaypoints: true,
                travelMode: google.maps.TravelMode.DRIVING,
              },
              (res, status) => {
                if (status === google.maps.DirectionsStatus.OK && res) resolve(res);
                else reject(new Error(`Directions failed: ${status}`));
              }
            );
          });
          workerRoute.route = result;
          const wOv = result.routes?.[0]?.overview_path;
          workerRoute.overviewPath = wOv ? wOv.map((p) => toLatLngLiteral(p)) : undefined;
          let totalDistance = 0;
          let totalDuration = 0;
          result.routes[0]?.legs.forEach((leg) => {
            if (leg.distance) totalDistance += leg.distance.value;
            if (leg.duration) totalDuration += leg.duration.value;
          });
          workerRoute.totalDistance = `${(totalDistance / 1609.34).toFixed(1)} mi`;
          workerRoute.totalDuration = `${Math.round(totalDuration / 60)} min`;
          workerRoute.routeSource = "directions";
          // Rendered as blue dashed Polyline (clickable) in JSX
        } catch (err) {
          console.warn("Available jobs route directions failed:", err);
        }
        newRoutes.push(workerRoute);
      }
    }

    // Future-day reassignment guidance: suggest teammate swaps where start-to-job distance gains are meaningful.
    if (dateMode === "future" && routeOrigins.size > 1) {
      const jobsToEvaluate = filteredJobAssignments
        .filter((a) => {
          const lat = a.latitude ? parseFloat(a.latitude) : NaN;
          const lng = a.longitude ? parseFloat(a.longitude) : NaN;
          return Number.isFinite(lat) && Number.isFinite(lng) && !!a.teamMemberId;
        })
        .slice(0, 80);
      for (const assignment of jobsToEvaluate) {
        const lat = parseFloat(String(assignment.latitude));
        const lng = parseFloat(String(assignment.longitude));
        const distances = Array.from(routeOrigins.entries()).map(([teammateId, origin]) => ({
          teammateId,
          teammateName: origin.teammateName,
          miles: calculateDistanceMiles(origin.lat, origin.lng, lat, lng),
        }));
        distances.sort((a, b) => a.miles - b.miles);
        if (distances.length < 2) continue;
        const current = distances.find((d) => d.teammateId === assignment.teamMemberId) ?? distances[0];
        const best = distances[0];
        const gainMiles = current.miles - best.miles;
        if (best.teammateId !== current.teammateId && gainMiles >= 2) {
          reassignmentCandidates.push({
            jobId: assignment.jobId,
            jobTitle: assignment.jobTitle,
            currentTeammateName: current.teammateName,
            suggestedTeammateName: best.teammateName,
            gainMiles: Number(gainMiles.toFixed(1)),
            gainMinutes: Math.max(3, Math.round((gainMiles / 30) * 60)),
          });
        }
      }
    }

    setRoutes(newRoutes);
    setDirectionsServices(newServices);
    setDirectionsRenderers(newRenderers);
    setOptimizationSuggestions(reassignmentCandidates.slice(0, 8));
    setLoadingRoutes(false);

    // Auto-focus map on all routes, teammates, and available jobs
    if (mapRef.current) {
      const bounds = new google.maps.LatLngBounds();
      let hasBounds = false;
      
      if (focusedTeammateId) {
        // Focus on specific teammate's route
        const focusedRoute = newRoutes.find(r => r.teammateId === focusedTeammateId);
        if (focusedRoute) {
          if (focusedRoute.workLocation) {
            bounds.extend(new google.maps.LatLng(focusedRoute.workLocation.lat, focusedRoute.workLocation.lng));
          }
          if (focusedRoute.liveLocation) {
            bounds.extend(new google.maps.LatLng(focusedRoute.liveLocation.lat, focusedRoute.liveLocation.lng));
          }
          focusedRoute.jobs.forEach((job) => {
            bounds.extend(new google.maps.LatLng(job.lat, job.lng));
          });
        }
        // Also include available jobs in the view
        filteredAvailableJobs.forEach((job) => {
          const lat = job.latitude ? parseFloat(job.latitude) : null;
          const lng = job.longitude ? parseFloat(job.longitude) : null;
          if (lat && lng) {
            bounds.extend(new google.maps.LatLng(lat, lng));
          }
        });
        // Include admin location so map stays centered on them
        bounds.extend(new google.maps.LatLng(initialMapCenter.lat, initialMapCenter.lng));
      } else {
        // Show all routes
        newRoutes.forEach((route) => {
          if (route.workLocation) {
            bounds.extend(new google.maps.LatLng(route.workLocation.lat, route.workLocation.lng));
          }
          if (route.liveLocation) {
            bounds.extend(new google.maps.LatLng(route.liveLocation.lat, route.liveLocation.lng));
          }
          route.jobs.forEach((job) => {
            bounds.extend(new google.maps.LatLng(job.lat, job.lng));
          });
        });
        
        // Include ALL enabled teammates (even without routes)
        teammates
          .filter(teammate => enabledTeammates.has(teammate.id))
          .forEach((teammate) => {
            if (teammate.liveLocationLat && teammate.liveLocationLng) {
              bounds.extend(new google.maps.LatLng(teammate.liveLocationLat, teammate.liveLocationLng));
            } else if (teammate.workLocationLat && teammate.workLocationLng) {
              bounds.extend(new google.maps.LatLng(teammate.workLocationLat, teammate.workLocationLng));
            } else if (teammate.workLocationAddress) {
              // Try geocoded cache for bounds
              const geocoded = geocodedAddressesRef.current.get(teammate.workLocationAddress);
              if (geocoded) {
                bounds.extend(new google.maps.LatLng(geocoded.lat, geocoded.lng));
              }
            }
          });
        
        // Include available jobs
        filteredAvailableJobs.forEach((job) => {
          const lat = job.latitude ? parseFloat(job.latitude) : null;
          const lng = job.longitude ? parseFloat(job.longitude) : null;
          if (lat && lng) {
            bounds.extend(new google.maps.LatLng(lat, lng));
          }
        });

        // Always include admin's location (pinned address or geolocation) so map is centered on them
        bounds.extend(new google.maps.LatLng(initialMapCenter.lat, initialMapCenter.lng));
      }

      const noRouteContent = newRoutes.length === 0 && filteredAvailableJobs.length === 0;
      if (noRouteContent) {
        // No routes: zoom out to provide broader geographic context.
        mapRef.current.setCenter(initialMapCenter);
        mapRef.current.setZoom(5);
      } else {
        if (bounds.isEmpty()) {
          bounds.extend(new google.maps.LatLng(initialMapCenter.lat, initialMapCenter.lng));
        }
        fitBoundsWithZoomCap(bounds);
      }
      // Clear focus after fitting bounds
      if (focusedTeammateId) {
        setTimeout(() => setFocusedTeammateId(null), 100);
      }
    }
  }, [isLoaded, filteredJobAssignments, teammates, enabledTeammatesKey, focusedTeammateId, filteredAvailableJobs, calculateDistanceMiles, showAcceptedJobs, showPendingJobs, showAvailableJobs, initialMapCenter, fitBoundsWithZoomCap, dateMode, replayCutoff, replayEnabled, selectedDate]);

  // Note: Teammate enabling is handled in parent component (WorkerCalendar)
  // This component just receives enabledTeammates as a prop

  // Real-time location updates (poll every 30 seconds for live locations)
  useEffect(() => {
    if (!isLoaded) return;
    
    const interval = setInterval(() => {
      // In a real implementation, this would fetch live locations from the server
      // For now, we'll rely on the teammates data which may already have live locations
      // This is a placeholder for real-time updates
      // TODO: Fetch live locations from /api/teammates/live-locations endpoint
    }, 30000);

    return () => clearInterval(interval);
  }, [isLoaded]);

  const hasRouteContent = routes.length > 0 || filteredAvailableJobs.length > 0;
  const routeBuildKey = useMemo(() => {
    const jobsKey = filteredJobAssignments
      .map((a) => {
        const start = typeof a.scheduledStart === "string" ? a.scheduledStart : a.scheduledStart.toISOString();
        const end = typeof a.scheduledEnd === "string" ? a.scheduledEnd : a.scheduledEnd.toISOString();
        return `${a.jobId}:${a.teamMemberId}:${a.status}:${start}:${end}:${a.latitude ?? ""}:${a.longitude ?? ""}`;
      })
      .join("|");
    const teammatesKey = teammates
      .map(
        (t) =>
          `${t.id}:${t.liveLocationLat ?? ""}:${t.liveLocationLng ?? ""}:${t.workLocationLat ?? ""}:${t.workLocationLng ?? ""}:${
            Array.isArray(t.liveLocationPath) ? t.liveLocationPath.length : 0
          }`
      )
      .join("|");
    const availableKey = filteredAvailableJobs
      .map((j) => `${j.id}:${typeof j.startDate === "string" ? j.startDate : j.startDate.toISOString()}:${j.latitude ?? ""}:${j.longitude ?? ""}`)
      .join("|");
    return [
      selectedDate.toISOString(),
      dateMode,
      enabledTeammatesKey,
      showAcceptedJobs ? "1" : "0",
      showPendingJobs ? "1" : "0",
      showAvailableJobs ? "1" : "0",
      focusedTeammateId ?? "none",
      jobsKey,
      teammatesKey,
      availableKey,
    ].join("~");
  }, [
    filteredJobAssignments,
    teammates,
    filteredAvailableJobs,
    selectedDate,
    dateMode,
    enabledTeammatesKey,
    showAcceptedJobs,
    showPendingJobs,
    showAvailableJobs,
    focusedTeammateId,
  ]);

  // Rebuild routes when dependencies change (date, jobs, teammates, etc.)
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    if (lastRouteBuildKeyRef.current === routeBuildKey) return;
    if (routeBuildInFlightRef.current) return;
    lastRouteBuildKeyRef.current = routeBuildKey;
    routeBuildInFlightRef.current = true;

    // Clear existing renderers before building new routes
    directionsRenderers.forEach((renderer) => {
      renderer.setMap(null);
    });

    void buildRoutes().finally(() => {
      routeBuildInFlightRef.current = false;
    });
  }, [isLoaded, routeBuildKey, buildRoutes, directionsRenderers]);

  // Cleanup renderers on unmount
  useEffect(() => {
    return () => {
      directionsRenderers.forEach((renderer) => {
        renderer.setMap(null);
      });
    };
  }, [directionsRenderers]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // Group jobs by teammate for the list (MUST be before any early returns)
  const jobsByTeammate = useMemo(() => {
    const grouped = new Map<number, typeof filteredJobAssignments>();
    filteredJobAssignments.forEach((job) => {
      if (!grouped.has(job.teamMemberId)) {
        grouped.set(job.teamMemberId, []);
      }
      grouped.get(job.teamMemberId)!.push(job);
    });
    return grouped;
  }, [filteredJobAssignments]);

  // Get all jobs for the list (sorted by time) (MUST be before any early returns)
  const allJobsList = useMemo(() => {
    return filteredJobAssignments
      .map((job) => {
        const teammate = teammates.find((t) => t.id === job.teamMemberId);
        const scheduledStart = typeof job.scheduledStart === "string" 
          ? parseISO(job.scheduledStart)
          : job.scheduledStart;
        return {
          ...job,
          teammate,
          scheduledStart,
        };
      })
      .sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());
  }, [filteredJobAssignments, teammates]);

  // Early returns AFTER all hooks
  if (!isLoaded) {
    if (loadError) {
      return (
        <div className="w-full flex flex-col items-center justify-center p-8 text-center" style={{ height }}>
          <AlertCircle className="w-12 h-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold mb-2">Google Maps API Error</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            Failed to load Google Maps. This usually means the Maps JavaScript API is not enabled for your API key.
          </p>
          <div className="text-left bg-background border border-border rounded-lg p-4 max-w-md">
            <p className="text-sm font-medium mb-2">To Fix:</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Go to <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google Cloud Console APIs</a></li>
              <li>Search for and enable <strong>"Maps JavaScript API"</strong></li>
              <li>Also enable <strong>"Routes API"</strong> for fleet routing</li>
              <li>Check your API key at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary underline">Credentials</a></li>
              <li>Ensure the API key allows "Maps JavaScript API" in restrictions</li>
              <li>If using domain restrictions, add <code className="bg-muted px-1 rounded">localhost:5173</code> to allowed referrers</li>
            </ol>
          </div>
        </div>
      );
    }
    if (!apiKey) {
      return (
        <div className="w-full flex flex-col items-center justify-center p-8 text-center" style={{ height }}>
          <MapPin className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Google Maps API Key Required</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            To use the calendar map view, you need to configure your Google Maps API key.
          </p>
          <div className="text-left bg-background border border-border rounded-lg p-4 max-w-md">
            <p className="text-sm font-medium mb-2">Setup Instructions:</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Get your API key from <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google Cloud Console</a></li>
              <li>Add to <code className="bg-muted px-1 rounded">.env.development</code>: <code className="bg-muted px-1 rounded">VITE_GOOGLE_API_KEY=your-key-here</code></li>
              <li>Enable these APIs:
                <ul className="list-disc list-inside ml-4 mt-1">
                  <li>Maps JavaScript API (for map display)</li>
                  <li>Routes API or Fleet Routing API (for route optimization)</li>
                </ul>
              </li>
            </ol>
          </div>
        </div>
      );
    }
    
    return (
      <div className="w-full" style={{ height }}>
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  const handlePreviousDay = () => {
    const newDate = subDays(selectedDate, 1);
    onDateChange?.(newDate);
  };

  const handleNextDay = () => {
    const newDate = addDays(selectedDate, 1);
    onDateChange?.(newDate);
  };

  const handleToday = () => {
    onDateChange?.(new Date());
  };

  if (isMobileOrTablet) {
    // Mobile/tablet layout: Map fills space, routes panel in-flow below (no overlay) so footer stays visible
    const mobileRoutesExpanded = bottomSheetPosition !== "collapsed" && bottomSheetPosition !== "hidden";
    return (
      <div className="w-full flex flex-col" style={{ height }}>
        {/* Map Section - Takes remaining space */}
        <div className="flex-1 relative min-h-0 flex-shrink-0 box-border pt-[5px] pb-[5px]">
          {!isLoaded ? (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <Skeleton className="w-full h-full" />
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "100%", boxSizing: "border-box", paddingTop: "5px", paddingBottom: "5px" }}
              center={initialMapCenter}
              zoom={10}
              onLoad={onMapLoad}
              options={{
                styles: mapStyles,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
              }}
            >
              {/* Coverage radius circles (same as Find Work map): worker + teammates territory */}
              {referenceRadiusMiles != null && referenceRadiusMiles > 0 && referencePoints && referencePoints.length > 0 && referencePoints.map((pt, i) => {
                const miles = referenceRadiusMilesArray?.[i] != null ? referenceRadiusMilesArray[i] : referenceRadiusMiles;
                if (!Number.isFinite(miles) || miles <= 0) return null;
                return Number.isFinite(pt.lat) && Number.isFinite(pt.lng) ? (
                  <MapCircle
                    key={`radius-${i}`}
                    center={{ lat: pt.lat, lng: pt.lng }}
                    radius={miles * MILES_TO_METERS}
                    options={{
                      fillColor: i === 0 ? "#22c55e" : "#3b82f6",
                      fillOpacity: 0.08,
                      strokeColor: i === 0 ? "#16a34a" : "#2563eb",
                      strokeOpacity: 0.35,
                      strokeWeight: 2,
                      zIndex: 0,
                    }}
                  />
                ) : null;
              })}

              {/* Render routes with directions (accepted = green, pending = yellow; available drawn below as dashed) */}
              {routes
                .filter((route) => route.route !== null && route.routeType !== "available")
                .map((route) => (
                  <DirectionsRenderer
                    key={`dir-${route.teammateId}`}
                    directions={route.route!}
                    options={{
                      suppressMarkers: true,
                      polylineOptions: {
                        strokeColor: route.routeColor,
                        strokeWeight: 4,
                        strokeOpacity: 0.8,
                      },
                    }}
                  />
                ))}

              {/* Available jobs route: light blue dashed line only (clickable to add to route / open popup) */}
              {routes
                .filter((route) => route.routeType === "available" && (route.overviewPath?.length ?? 0) > 0)
                .map((route) => {
                  const path = route.overviewPath ?? (() => {
                    const start = route.liveLocation || route.workLocation;
                    if (!start) return [];
                    return [{ lat: start.lat, lng: start.lng }, ...route.jobs.map((j) => ({ lat: j.lat, lng: j.lng }))];
                  })();
                  if (path.length < 2) return null;
                  return (
                    <Polyline
                      key={`available-route-${route.teammateId}`}
                      path={path}
                      options={{
                        strokeColor: ROUTE_COLOR_AVAILABLE,
                        strokeWeight: 0,
                        strokeOpacity: 0,
                        geodesic: true,
                        clickable: true,
                        icons: [
                          { icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: ROUTE_COLOR_AVAILABLE, scale: 4 }, repeat: "20px" },
                        ],
                      }}
                      onClick={() => setSelectedRoute(route)}
                    />
                  );
                })}

              {/* Clickable overlay on route lines to open associated pop-up */}
              {routes
                .filter((route) => route.jobs.length > 0 && ((route.overviewPath?.length ?? 0) > 0 || !!(route.liveLocation || route.workLocation)))
                .map((route) => {
                  const path = route.overviewPath ?? (() => {
                    const start = route.liveLocation || route.workLocation;
                    if (!start) return [];
                    return [{ lat: start.lat, lng: start.lng }, ...route.jobs.map((j) => ({ lat: j.lat, lng: j.lng }))];
                  })();
                  if (path.length < 2) return null;
                  return (
                    <Polyline
                      key={`click-${route.teammateId}`}
                      path={path}
                      options={{
                        strokeColor: "transparent",
                        strokeWeight: 24,
                        strokeOpacity: 0,
                        clickable: true,
                        zIndex: 10,
                      }}
                      onClick={() => setSelectedRoute(route)}
                    />
                  );
                })}

              {/* Render simple polylines for routes without directions (fallback; available has its own dashed line above) */}
              {routes
                .filter((route) => route.route === null && route.jobs.length > 0 && route.routeType !== "available")
                .map((route) => {
                  const startPoint = route.liveLocation || route.workLocation;
                  const path = route.overviewPath && route.overviewPath.length > 1
                    ? route.overviewPath
                    : startPoint
                      ? [
                          { lat: startPoint.lat, lng: startPoint.lng },
                          ...route.jobs.map((job) => ({ lat: job.lat, lng: job.lng })),
                        ]
                      : [];
                  if (path.length < 2) return null;
                  return (
                    <Polyline
                      key={`polyline-${route.teammateId}`}
                      path={path}
                      options={{
                        strokeColor: route.routeColor,
                        strokeWeight: 3,
                        strokeOpacity: 0.6,
                        geodesic: true,
                      }}
                    />
                  );
                })}
              {/* Past-day ghost full trail (faint) */}
              {dateMode === "past" && routes
                .filter((route) => Array.isArray(route.fullTrail) && (route.fullTrail?.length ?? 0) > 1)
                .map((route) => (
                  <Polyline
                    key={`ghost-${route.teammateId}`}
                    path={(route.fullTrail || []).map((p) => ({ lat: p.lat, lng: p.lng }))}
                    options={{
                      strokeColor: route.routeColor,
                      strokeWeight: 2,
                      strokeOpacity: 0.2,
                      geodesic: true,
                      clickable: false,
                    }}
                  />
                ))}

              {/* Historical replay markers along trail */}
              {dateMode === "past" && routes
                .filter((route) => Array.isArray(route.replayTrail) && (route.replayTrail?.length ?? 0) > 1)
                .flatMap((route) => {
                  const trail = route.replayTrail!;
                  const maxMarkers = 6;
                  const step = Math.max(1, Math.floor(trail.length / maxMarkers));
                  const points = trail.filter((_, idx) => idx % step === 0).slice(0, maxMarkers);
                  return points.map((pt, idx) => (
                    <Marker
                      key={`replay-${route.teammateId}-${idx}`}
                      position={{ lat: pt.lat, lng: pt.lng }}
                      icon={{
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 3,
                        fillColor: route.routeColor,
                        fillOpacity: 0.9,
                        strokeColor: "#ffffff",
                        strokeWeight: 1,
                      }}
                      title={pt.createdAt ? `${route.teammateName} @ ${format(pt.createdAt, "HH:mm")}` : route.teammateName}
                    />
                  ));
                })}

              {/* Render markers for start points (avatars, same as Find Work map) */}
              {routes.map((route) => {
                const startPoint = route.liveLocation || route.workLocation;
                if (!startPoint) return null;
                const avatarUrl = route.teammateAvatar
                  ? (route.teammateAvatar.startsWith("http") || route.teammateAvatar.startsWith("data:")
                      ? route.teammateAvatar
                      : `${window.location.origin}${route.teammateAvatar.startsWith("/") ? "" : "/"}${route.teammateAvatar}`)
                  : null;
                return (
                  <OverlayView
                    key={`start-${route.teammateId}`}
                    position={{ lat: startPoint.lat, lng: startPoint.lng }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  >
                    <CalendarAvatarPin
                      name={route.teammateName}
                      avatarUrl={avatarUrl}
                      ringColorHex={route.routeColor}
                      title={`${route.teammateName} - ${route.liveLocation ? "Live Location" : "Start"}`}
                    />
                  </OverlayView>
                );
              })}

              {/* Render markers for job stops */}
              {routes.map((route) =>
                route.jobs.map((job) => {
                  // Determine marker color based on status
                  let markerColor = route.routeColor;
                  let markerScale = 6;
                  let markerPath = google.maps.SymbolPath.BACKWARD_CLOSED_ARROW;
                  
                  if (job.isCurrent) {
                    markerColor = job.isBehind ? "#ef4444" : "#10b981"; // Red if behind, green if on time
                    markerScale = 8;
                    markerPath = google.maps.SymbolPath.CIRCLE;
                  } else if (job.isNext) {
                    markerColor = "#f59e0b"; // Amber for next
                    markerScale = 7;
                    markerPath = google.maps.SymbolPath.CIRCLE;
                  } else if (job.isBehind) {
                    markerColor = "#ef4444"; // Red for behind
                    markerScale = 7;
                  }
                  
                  return (
                    <Marker
                      key={`job-${route.teammateId}-${job.jobId}`}
                      position={{ lat: job.lat, lng: job.lng }}
                      icon={{
                        path: markerPath,
                        scale: markerScale,
                        fillColor: markerColor,
                        fillOpacity: 1,
                        strokeColor: "#fff",
                        strokeWeight: job.isCurrent || job.isNext ? 3 : 2,
                      }}
                      label={{
                        text: job.isCurrent ? "●" : job.isNext ? "○" : `${job.sequence}`,
                        color: "#fff",
                        fontSize: job.isCurrent || job.isNext ? "16px" : "12px",
                        fontWeight: "bold",
                      }}
                      onClick={() => setSelectedJobId(job.jobId)}
                      title={`${job.jobTitle} - ${job.isCurrent ? "CURRENT" : job.isNext ? "NEXT" : `Stop ${job.sequence}`}${job.isBehind ? " (BEHIND)" : ""}`}
                    />
                  );
                })
              )}

              {/* Render markers for unassigned jobs (jobs without teamMemberId) */}
              {unassignedJobs.map((assignment) => {
                const lat = assignment.latitude ? parseFloat(assignment.latitude) : null;
                const lng = assignment.longitude ? parseFloat(assignment.longitude) : null;
                
                if (!lat || !lng) return null;
                
                return (
                  <Marker
                    key={`unassigned-job-${assignment.jobId}`}
                    position={{ lat, lng }}
                    icon={{
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 8,
                      fillColor: "#8B5CF6", // Purple for unassigned jobs
                      fillOpacity: 0.8,
                      strokeColor: "#fff",
                      strokeWeight: 2,
                    }}
                    onClick={() => setSelectedJobId(assignment.jobId)}
                    title={`${assignment.jobTitle} - Unassigned`}
                  />
                );
              })}

              {/* Render markers for available jobs (opportunities) */}
              {filteredAvailableJobs.map((job) => {
                const lat = job.latitude ? parseFloat(job.latitude) : null;
                const lng = job.longitude ? parseFloat(job.longitude) : null;
                
                if (!lat || !lng) return null;
                
                return (
                  <Marker
                    key={`available-job-${job.id}`}
                    position={{ lat, lng }}
                    icon={{
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 7,
                      fillColor: "#f59e0b", // Amber for available jobs
                      fillOpacity: 0.8,
                      strokeColor: "#fff",
                      strokeWeight: 2,
                    }}
                    label={{
                      text: "○",
                      color: "#fff",
                      fontSize: "14px",
                      fontWeight: "bold",
                    }}
                    onClick={() => {
                      if (onJobAction) onJobAction(job.id, "add-to-route");
                    }}
                    title={`${job.title} - Available (click to add to route)`}
                  />
                );
              })}

              {/* Pop-up when user clicks a route line */}
              {selectedRoute && (() => {
                const pos = selectedRoute.workLocation || selectedRoute.jobs[0];
                if (!pos) return null;
                return (
                  <InfoWindow
                    position={{ lat: pos.lat, lng: pos.lng }}
                    onCloseClick={() => setSelectedRoute(null)}
                  >
                    <div className="p-2 min-w-[160px] max-w-[240px]">
                      <p className="font-medium text-sm mb-2">{selectedRoute.teammateName}</p>
                      {selectedRoute.routeType === "available" && selectedRoute.jobs.length > 0 && (
                        <button
                          type="button"
                          className="w-full text-left text-xs text-primary hover:underline mb-2"
                          onClick={() => {
                            if (onJobAction) onJobAction(selectedRoute.jobs[0].jobId, "add-to-route");
                            setSelectedRoute(null);
                          }}
                        >
                          Add to route / Apply (step 3)
                        </button>
                      )}
                      <div className="space-y-1">
                        {selectedRoute.jobs.map((job) => (
                          <button
                            key={job.jobId}
                            type="button"
                            className="w-full text-left text-xs text-muted-foreground hover:underline"
                            onClick={() => {
                              setSelectedJobId(job.jobId);
                              setSelectedRoute(null);
                            }}
                          >
                            {job.sequence}. {job.jobTitle}
                          </button>
                        ))}
                      </div>
                    </div>
                  </InfoWindow>
                );
              })()}
            </GoogleMap>
          )}

          {/* Date Navigation - Top Overlay */}
          <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousDay}
              className="bg-background/90 backdrop-blur-sm"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              className="bg-background/90 backdrop-blur-sm"
              disabled={isToday(selectedDate)}
            >
              <Calendar className="w-4 h-4 mr-1" />
              {isToday(selectedDate) ? "Today" : format(selectedDate, "MMM d")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextDay}
              className="bg-background/90 backdrop-blur-sm"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          {replayEnabled && dateMode === "past" && (
            <div className="absolute top-14 left-3 right-3 z-10 rounded-lg border border-border bg-background/90 p-2 backdrop-blur-sm shadow-sm">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium">Replay time</span>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">{replayLabel}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={handleCopyReplayLink}
                    data-testid="button-replay-copy-link-mobile"
                  >
                    {replayLinkCopied ? "Copied" : "Copy link"}
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1439}
                  step={5}
                  value={replayMinute}
                  onChange={(e) => setReplayMinute(parseInt(e.target.value, 10))}
                  className="w-full"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setReplayPlaying((v) => !v)}
                >
                  {replayPlaying ? "Pause" : "Play"}
                </Button>
              </div>
              <div className="mt-1 flex items-center justify-between gap-1">
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setReplayMinute(0)}>
                  Start
                </Button>
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => jumpReplayEvent("prev")}>
                  Prev event
                </Button>
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => jumpReplayEvent("next")}>
                  Next event
                </Button>
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setReplayMinute(1439)}>
                  End
                </Button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <Button
                  variant={showReplayJobStarts ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setShowReplayJobStarts((v) => !v)}
                >
                  Starts
                </Button>
                <Button
                  variant={showReplayJobEnds ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setShowReplayJobEnds((v) => !v)}
                >
                  Ends
                </Button>
                <Button
                  variant={showReplayPings ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setShowReplayPings((v) => !v)}
                >
                  Pings
                </Button>
              </div>
              {replayEventTeammates.length > 0 && (
                <div className="mt-1 flex items-center gap-1 overflow-x-auto pb-1">
                  <Button
                    variant={replayTeammateFilterIds.length === 0 ? "default" : "outline"}
                    size="sm"
                    className="h-6 px-2 text-[10px] whitespace-nowrap"
                    onClick={() => setReplayTeammateFilterIds([])}
                  >
                    All workers
                  </Button>
                  {replayEventTeammates.slice(0, 8).map((teammate) => (
                    <Button
                      key={`replay-mobile-worker-${teammate.id}`}
                      variant={replayTeammateFilterSet.has(teammate.id) ? "default" : "outline"}
                      size="sm"
                      className="h-6 px-2 text-[10px] whitespace-nowrap"
                      onClick={() => toggleReplayTeammateFilter(teammate.id)}
                    >
                      {teammate.firstName}
                    </Button>
                  ))}
                </div>
              )}
              {replayEventTimeline.length > 0 && replayEventChips.length === 0 && (
                <div className="mt-2 rounded border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
                  No replay events under current filters.
                </div>
              )}
              {replayEventChips.length > 0 && (
                <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
                  {replayEventChips.map((chip) => (
                    <Button
                      key={`chip-mobile-${chip.minute}-${chip.kind}`}
                      variant="outline"
                      size="sm"
                      className={`h-6 px-2 text-[10px] whitespace-nowrap ${replayChipTone(chip.kind, chip.minute === replayMinute)}`}
                      onClick={() => {
                        setReplayPlaying(false);
                        setReplayMinute(chip.minute);
                      }}
                      title={chip.label}
                    >
                      {String(Math.floor(chip.minute / 60)).padStart(2, "0")}:{String(chip.minute % 60).padStart(2, "0")}
                    </Button>
                  ))}
                </div>
              )}
              {replayEventTimeline.length > 0 && (
                <div className="mt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setReplayRailOpen((v) => !v)}
                  >
                    {replayRailOpen ? "Hide events" : "Show events"}
                  </Button>
                  {replayRailOpen && (
                    <div className="mt-1 max-h-28 overflow-y-auto rounded border border-border bg-background/80 p-1">
                      {replayEventRail.length > 0 ? (
                        replayEventRail.map((chip) => (
                          <button
                            key={`rail-mobile-${chip.minute}-${chip.kind}`}
                            type="button"
                            className={`mb-1 block w-full rounded border px-2 py-1 text-left text-[10px] ${
                              replayChipTone(chip.kind, chip.minute === replayMinute)
                            }`}
                            onClick={() => {
                              setReplayPlaying(false);
                              setReplayMinute(chip.minute);
                            }}
                            title={chip.label}
                          >
                            <span className="mr-2 tabular-nums">
                              {String(Math.floor(chip.minute / 60)).padStart(2, "0")}:{String(chip.minute % 60).padStart(2, "0")}
                            </span>
                            {chip.label}
                          </button>
                        ))
                      ) : (
                        <div className="px-2 py-1 text-[10px] text-muted-foreground">
                          No replay events under current filters.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Legend - Top Right (Desktop only); mobile/tablet use in-flow panel legend */}
          {!isEmployee && isDesktop ? (
            <div className="absolute top-3 right-3 z-10 bg-background/90 backdrop-blur-sm border border-border rounded-lg shadow-lg p-3 max-w-[220px]">
              <div className="text-xs font-semibold mb-2">Legend</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="legend-accepted"
                    checked={showAcceptedJobs}
                    onCheckedChange={setShowAcceptedJobs}
                  />
                  <Label htmlFor="legend-accepted" className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span>Accepted</span>
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="legend-pending"
                    checked={showPendingJobs}
                    onCheckedChange={setShowPendingJobs}
                  />
                  <Label htmlFor="legend-pending" className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <Circle className="w-3 h-3 text-yellow-500" />
                    <span>Pending</span>
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="legend-available"
                    checked={showAvailableJobs}
                    onCheckedChange={setShowAvailableJobs}
                  />
                  <Label htmlFor="legend-available" className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <Zap className="w-3 h-3 text-amber-500" />
                    <span>Available</span>
                  </Label>
                </div>
              </div>
            </div>
          ) : null}

          {/* Teammate Filter - Below Legend (Desktop only); hidden for employees */}
          {!isEmployee && isDesktop && (
            <div className="absolute top-44 right-3 z-10 bg-background/90 backdrop-blur-sm border border-border rounded-lg shadow-lg p-2 max-w-[200px]">
              <div className="text-xs font-semibold mb-2">Workers</div>
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-1.5">
                  {teammates.map((teammate) => {
                    const isEnabled = enabledTeammates.has(teammate.id);
                    const jobCount = filteredJobAssignments.filter(
                      (a) => a.teamMemberId === teammate.id
                    ).length;

                    return (
                      <div key={teammate.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`teammate-desktop-${teammate.id}`}
                          checked={isEnabled}
                          onCheckedChange={() => {
                            onToggleTeammate(teammate.id);
                            // Auto-focus map to this teammate's route when toggled on
                            if (!isEnabled) {
                              setFocusedTeammateId(teammate.id);
                            }
                          }}
                        />
                        <Label
                          htmlFor={`teammate-desktop-${teammate.id}`}
                          className="flex items-center gap-1.5 flex-1 cursor-pointer text-xs"
                        >
                          <Avatar className="w-5 h-5">
                            <AvatarImage src={teammate.avatarUrl || undefined} />
                            <AvatarFallback className="text-[10px]">
                              {teammate.firstName[0]}{teammate.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">
                            {teammate.firstName} {teammate.lastName}
                          </span>
                          {jobCount > 0 && (
                            <Badge variant="secondary" className="text-[10px] px-1">
                              {jobCount}
                            </Badge>
                          )}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
          {!loadingRoutes && !hasRouteContent && (
            <div className="absolute inset-x-4 bottom-4 z-10 rounded-lg border border-border bg-background/95 p-3 text-center shadow-sm backdrop-blur-sm">
              <p className="text-sm font-medium">No routes for this date</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Zoomed out view shown. Try another date or enable more workers.
              </p>
            </div>
          )}
        </div>

        {/* Routes panel - in-flow below map (no overlay); does not cover footer */}
        <div className="flex-shrink-0 border-t border-border bg-background rounded-t-2xl overflow-hidden">
          {/* Collapsible header - always visible */}
          <button
            type="button"
            onClick={() => setBottomSheetPosition(mobileRoutesExpanded ? "collapsed" : "peek")}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-muted/50 active:bg-muted transition-colors"
          >
            <h2 className="font-semibold text-sm truncate">
              Routes for {format(selectedDate, "MMM d, yyyy")}
            </h2>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {routes.length} route{routes.length !== 1 ? "s" : ""}
              {filteredAvailableJobs.length > 0 && ` · ${filteredAvailableJobs.length} available`}
            </span>
            <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${mobileRoutesExpanded ? "rotate-180" : ""}`} />
          </button>

          {/* Expanded content - scrollable, capped height so footer stays in view */}
          {mobileRoutesExpanded && (
            <>
              {/* Legend - compact row; hidden for employees */}
              {!isEmployee && (
                <div className="px-4 py-2 border-b border-border/50 bg-muted/30">
                  <div className="text-xs font-semibold mb-1.5">Legend</div>
                  <div className="flex gap-3 flex-wrap">
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <Checkbox
                        id="legend-accepted-mobile"
                        checked={showAcceptedJobs}
                        onCheckedChange={setShowAcceptedJobs}
                      />
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                      <span>Accepted</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <Checkbox
                        id="legend-pending-mobile"
                        checked={showPendingJobs}
                        onCheckedChange={setShowPendingJobs}
                      />
                      <Circle className="w-3 h-3 text-yellow-500" />
                      <span>Pending</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <Checkbox
                        id="legend-available-mobile"
                        checked={showAvailableJobs}
                        onCheckedChange={setShowAvailableJobs}
                      />
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span>Available</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Routes list - max height so nav stays visible */}
              <div className="overflow-y-auto max-h-[min(38vh,320px)] px-4 pt-2 pb-3"
          >
            {routes.length === 0 && filteredAvailableJobs.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  No routes available for this date
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 pb-4">
                {routes.map((route) => {
                  const behindJobs = route.jobs.filter((j) => j.isBehind);

                  return (
                    <div
                      key={route.teammateId}
                      className="p-2.5 rounded-lg border border-border bg-card cursor-pointer transition-all hover:bg-muted/50 active:bg-muted"
                      onClick={() => {
                        // Focus on this route on the map
                        if (mapRef.current && route.jobs.length > 0) {
                          const bounds = new google.maps.LatLngBounds();
                          if (route.workLocation) {
                            bounds.extend(new google.maps.LatLng(route.workLocation.lat, route.workLocation.lng));
                          }
                          if (route.liveLocation) {
                            bounds.extend(new google.maps.LatLng(route.liveLocation.lat, route.liveLocation.lng));
                          }
                          route.jobs.forEach((job) => {
                            bounds.extend(new google.maps.LatLng(job.lat, job.lng));
                          });
                          fitBoundsWithZoomCap(bounds);
                        }
                      }}
                    >
                      {/* Compact header with avatar and name */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <Avatar className="w-5 h-5 flex-shrink-0">
                          <AvatarImage src={route.teammateAvatar || undefined} />
                          <AvatarFallback className="text-[9px]">
                            {route.teammateName
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs font-medium truncate flex-1">{route.teammateName}</span>
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: route.routeColor }}
                        />
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 flex-shrink-0">
                          {route.jobs.length}
                        </Badge>
                      </div>
                      
                      {/* Compact route list - each job row opens popup on click */}
                      <div className="space-y-0.5 mb-1.5 ml-7">
                        {route.jobs.slice(0, 2).map((job) => (
                          <div
                            key={job.jobId}
                            role="button"
                            tabIndex={0}
                            className="flex items-center gap-1.5 text-[10px] cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onJobAction) onJobAction(job.jobId, "view");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                if (onJobAction) onJobAction(job.jobId, "view");
                              }
                            }}
                          >
                            <div
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: route.routeColor }}
                            />
                            <span className="truncate flex-1 text-muted-foreground">
                              {job.sequence}. {job.jobTitle}
                            </span>
                            {job.isCurrent && (
                              <Badge variant={job.isBehind ? "destructive" : "default"} className="text-[9px] px-1 py-0 h-3.5 flex-shrink-0">
                                {job.isBehind ? "Behind" : "Now"}
                              </Badge>
                            )}
                            {job.isNext && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 flex-shrink-0">
                                Next
                              </Badge>
                            )}
                          </div>
                        ))}
                        {route.jobs.length > 2 && (
                          <div
                            role="button"
                            tabIndex={0}
                            className="text-[10px] text-muted-foreground ml-2.5 cursor-pointer hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              const firstJob = route.jobs[2];
                              if (firstJob && onJobAction) onJobAction(firstJob.jobId, "view");
                            }}
                            onKeyDown={(e) => {
                              if ((e.key === "Enter" || e.key === " ") && route.jobs[2] && onJobAction) {
                                e.preventDefault();
                                e.stopPropagation();
                                onJobAction(route.jobs[2].jobId, "view");
                              }
                            }}
                          >
                            +{route.jobs.length - 2} more
                          </div>
                        )}
                      </div>
                      
                      {/* Compact footer with distance/duration */}
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground ml-7">
                        {route.totalDistance && (
                          <span className="flex items-center gap-0.5">
                            <Navigation className="w-2.5 h-2.5" />
                            {route.totalDistance}
                          </span>
                        )}
                        {route.totalDuration && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" />
                            {route.totalDuration}
                          </span>
                        )}
                        {behindJobs.length > 0 && (
                          <Badge variant="destructive" className="text-[9px] px-1 py-0 h-3.5">
                            <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                            Behind
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
                
                {/* Available Jobs Section - Compact */}
                {filteredAvailableJobs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-amber-500" />
                      Available ({filteredAvailableJobs.length})
                    </h3>
                    <div className="space-y-1.5">
                      {filteredAvailableJobs.map((job) => {
                        const fullAddress = `${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`.replace(/^, |, $/g, "") || job.location || "Address not provided";
                        
                        return (
                          <div
                            key={job.id}
                            role="button"
                            tabIndex={0}
                            className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 cursor-pointer transition-all hover:bg-amber-100/50 dark:hover:bg-amber-900/30 active:bg-amber-200/50"
                            onClick={() => {
                              if (onJobAction) onJobAction(job.id, "view");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                if (onJobAction) onJobAction(job.id, "view");
                              }
                            }}
                          >
                            <div className="flex items-start gap-2">
                              <Badge variant="outline" className="text-[9px] border-amber-500 text-amber-700 dark:text-amber-400 px-1.5 py-0 h-4 flex-shrink-0">
                                Available
                              </Badge>
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium mb-1 truncate">{job.title}</div>
                                <div className="text-[10px] text-muted-foreground space-y-0.5">
                                  <div className="flex items-center gap-1 truncate">
                                    <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                                    <span className="truncate">{fullAddress}</span>
                                  </div>
                                  {job.scheduledTime && (
                                    <div className="flex items-center gap-1">
                                      <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                                      <span>{job.scheduledTime}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                  {teammates.slice(0, 3).map((teammate) => (
                                    <Button
                                      key={teammate.id}
                                      variant="outline"
                                      size="sm"
                                      className="text-[10px] h-6 px-2 py-0 flex items-center gap-1"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (onAddJobToRoute) {
                                          onAddJobToRoute(job.id, teammate.id);
                                        } else if (onJobAction) {
                                          onJobAction(job.id, "add-to-route");
                                        }
                                      }}
                                    >
                                      <Avatar className="w-3 h-3">
                                        <AvatarImage src={teammate.avatarUrl || undefined} />
                                        <AvatarFallback className="text-[7px]">
                                          {teammate.firstName[0]}{teammate.lastName[0]}
                                        </AvatarFallback>
                                      </Avatar>
                                      <UserPlus className="w-2.5 h-2.5" />
                                    </Button>
                                  ))}
                                  {teammates.length > 3 && (
                                    <span className="text-[10px] text-muted-foreground">+{teammates.length - 3}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Desktop layout: Full map with overlay controls
  return (
    <div className="w-full relative" style={{ height }}>
      {/* Map Section - Full Width */}
      <div className="w-full h-full relative box-border pt-[5px] pb-[5px]">
        {!isLoaded ? (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Skeleton className="w-full h-full" />
          </div>
        ) : (
          <GoogleMap
            mapContainerStyle={{ width: "100%", height: "100%", boxSizing: "border-box", paddingTop: "5px", paddingBottom: "5px" }}
            center={initialMapCenter}
            zoom={10}
            onLoad={onMapLoad}
            options={{
              styles: mapStyles,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
            }}
          >
            {/* Coverage radius circles (same as Find Work map): worker + teammates territory */}
            {referenceRadiusMiles != null && referenceRadiusMiles > 0 && referencePoints && referencePoints.length > 0 && referencePoints.map((pt, i) => {
              const miles = referenceRadiusMilesArray?.[i] != null ? referenceRadiusMilesArray[i] : referenceRadiusMiles;
              if (!Number.isFinite(miles) || miles <= 0) return null;
              return Number.isFinite(pt.lat) && Number.isFinite(pt.lng) ? (
                <MapCircle
                  key={`radius-${i}`}
                  center={{ lat: pt.lat, lng: pt.lng }}
                  radius={miles * MILES_TO_METERS}
                  options={{
                    fillColor: i === 0 ? "#22c55e" : "#3b82f6",
                    fillOpacity: 0.08,
                    strokeColor: i === 0 ? "#16a34a" : "#2563eb",
                    strokeOpacity: 0.35,
                    strokeWeight: 2,
                    zIndex: 0,
                  }}
                />
              ) : null;
            })}

            {/* Render routes with directions (accepted = green, pending = yellow; available = dashed below) */}
            {routes
              .filter((route) => route.route !== null && route.routeType !== "available")
              .map((route) => (
                <DirectionsRenderer
                  key={`dir-${route.teammateId}`}
                  directions={route.route!}
                  options={{
                    suppressMarkers: true,
                    polylineOptions: {
                      strokeColor: route.routeColor,
                      strokeWeight: 4,
                      strokeOpacity: 0.8,
                    },
                  }}
                />
              ))}

            {/* Available jobs route: light blue dashed only (clickable) */}
            {routes
              .filter((route) => route.routeType === "available" && (route.overviewPath?.length ?? 0) > 0)
              .map((route) => {
                const path = route.overviewPath ?? (() => {
                  const start = route.liveLocation || route.workLocation;
                  if (!start) return [];
                  return [{ lat: start.lat, lng: start.lng }, ...route.jobs.map((j) => ({ lat: j.lat, lng: j.lng }))];
                })();
                if (path.length < 2) return null;
                return (
                  <Polyline
                    key={`available-route-${route.teammateId}`}
                    path={path}
                    options={{
                      strokeColor: ROUTE_COLOR_AVAILABLE,
                      strokeWeight: 0,
                      strokeOpacity: 0,
                      geodesic: true,
                      clickable: true,
                      icons: [
                        { icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: ROUTE_COLOR_AVAILABLE, scale: 4 }, repeat: "20px" },
                      ],
                    }}
                    onClick={() => setSelectedRoute(route)}
                  />
                );
              })}

            {/* Clickable overlay on route lines */}
            {routes
              .filter((route) => route.jobs.length > 0 && ((route.overviewPath?.length ?? 0) > 0 || !!(route.liveLocation || route.workLocation)))
              .map((route) => {
                const path = route.overviewPath ?? (() => {
                  const start = route.liveLocation || route.workLocation;
                  if (!start) return [];
                  return [{ lat: start.lat, lng: start.lng }, ...route.jobs.map((j) => ({ lat: j.lat, lng: j.lng }))];
                })();
                if (path.length < 2) return null;
                return (
                  <Polyline
                    key={`click-${route.teammateId}`}
                    path={path}
                    options={{
                      strokeColor: "transparent",
                      strokeWeight: 24,
                      strokeOpacity: 0,
                      clickable: true,
                      zIndex: 10,
                    }}
                    onClick={() => setSelectedRoute(route)}
                  />
                );
              })}

            {/* Render simple polylines for routes without directions (fallback) */}
            {routes
              .filter((route) => route.route === null && route.jobs.length > 0 && route.routeType !== "available")
              .map((route) => {
                const startPoint = route.liveLocation || route.workLocation;
                const path = route.overviewPath && route.overviewPath.length > 1
                  ? route.overviewPath
                  : startPoint
                    ? [
                        { lat: startPoint.lat, lng: startPoint.lng },
                        ...route.jobs.map((job) => ({ lat: job.lat, lng: job.lng })),
                      ]
                    : [];
                if (path.length < 2) return null;
                return (
                  <Polyline
                    key={`polyline-${route.teammateId}`}
                    path={path}
                    options={{
                      strokeColor: route.routeColor,
                      strokeWeight: 3,
                      strokeOpacity: 0.6,
                      geodesic: true,
                    }}
                  />
                );
              })}
            {/* Past-day ghost full trail (faint) */}
            {dateMode === "past" && routes
              .filter((route) => Array.isArray(route.fullTrail) && (route.fullTrail?.length ?? 0) > 1)
              .map((route) => (
                <Polyline
                  key={`ghost-desktop-${route.teammateId}`}
                  path={(route.fullTrail || []).map((p) => ({ lat: p.lat, lng: p.lng }))}
                  options={{
                    strokeColor: route.routeColor,
                    strokeWeight: 2,
                    strokeOpacity: 0.2,
                    geodesic: true,
                    clickable: false,
                  }}
                />
              ))}

            {/* Historical replay markers along trail */}
            {dateMode === "past" && routes
              .filter((route) => Array.isArray(route.replayTrail) && (route.replayTrail?.length ?? 0) > 1)
              .flatMap((route) => {
                const trail = route.replayTrail!;
                const maxMarkers = 8;
                const step = Math.max(1, Math.floor(trail.length / maxMarkers));
                const points = trail.filter((_, idx) => idx % step === 0).slice(0, maxMarkers);
                return points.map((pt, idx) => (
                  <Marker
                    key={`replay-desktop-${route.teammateId}-${idx}`}
                    position={{ lat: pt.lat, lng: pt.lng }}
                    icon={{
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 3,
                      fillColor: route.routeColor,
                      fillOpacity: 0.9,
                      strokeColor: "#ffffff",
                      strokeWeight: 1,
                    }}
                    title={pt.createdAt ? `${route.teammateName} @ ${format(pt.createdAt, "HH:mm")}` : route.teammateName}
                  />
                ));
              })}

            {/* Render markers for start points (avatars, same as Find Work map) */}
            {routes.map((route) => {
              const startPoint = route.liveLocation || route.workLocation;
              if (!startPoint) return null;
              const avatarUrl = route.teammateAvatar
                ? (route.teammateAvatar.startsWith("http") || route.teammateAvatar.startsWith("data:")
                    ? route.teammateAvatar
                    : `${window.location.origin}${route.teammateAvatar.startsWith("/") ? "" : "/"}${route.teammateAvatar}`)
                : null;
              return (
                <OverlayView
                  key={`start-${route.teammateId}`}
                  position={{ lat: startPoint.lat, lng: startPoint.lng }}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                  <CalendarAvatarPin
                    name={route.teammateName}
                    avatarUrl={avatarUrl}
                    ringColorHex={route.routeColor}
                    title={`${route.teammateName} - ${route.liveLocation ? "Live Location" : "Start"}`}
                  />
                </OverlayView>
              );
            })}

            {/* Render owner's avatar pin when showBusinessOperator is true and owner doesn't have a route */}
            {!isEmployee && workerProfile && enabledTeammates.size === 0 && (
              (() => {
                // Check if owner has a route (routes built from teammates, so owner won't have one unless they're also a teammate)
                const ownerHasRoute = routes.some(r => r.teammateId === 0 || (workerProfile.avatarUrl && r.teammateAvatar === workerProfile.avatarUrl));
                if (ownerHasRoute) return null;
                
                let startPoint: { lat: number; lng: number } | null = null;
                if (workerProfile.latitude && workerProfile.longitude) {
                  startPoint = {
                    lat: parseFloat(workerProfile.latitude),
                    lng: parseFloat(workerProfile.longitude),
                  };
                } else if (workerProfile.address) {
                  const workerAddress = `${workerProfile.address}${workerProfile.city ? `, ${workerProfile.city}` : ""}${workerProfile.state ? `, ${workerProfile.state}` : ""}`;
                  const geocoded = geocodedAddressesRef.current.get(workerAddress);
                  if (geocoded) startPoint = geocoded;
                }
                // Fallback to map center if no location available
                if (!startPoint) {
                  startPoint = { lat: initialMapCenter.lat, lng: initialMapCenter.lng };
                }
                
                const avatarUrl = workerProfile.avatarUrl
                  ? (workerProfile.avatarUrl.startsWith("http") || workerProfile.avatarUrl.startsWith("data:")
                      ? workerProfile.avatarUrl
                      : `${window.location.origin}${workerProfile.avatarUrl.startsWith("/") ? "" : "/"}${workerProfile.avatarUrl}`)
                  : null;
                const name = "You";
                return (
                  <OverlayView
                    key="owner-avatar"
                    position={startPoint}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  >
                    <CalendarAvatarPin
                      name={name}
                      avatarUrl={avatarUrl}
                      ringColorHex="#3b82f6"
                      title={`${name} - ${workerProfile.latitude ? "Work Location" : "Default Location"}${routes.length === 0 ? " (No jobs today)" : ""}`}
                    />
                  </OverlayView>
                );
              })()
            )}

            {/* Render markers for ALL enabled teammates (even without routes) - avatars same as Find Work */}
            {teammates
              .filter(teammate => enabledTeammates.has(teammate.id))
              .filter(teammate => !routes.some(r => r.teammateId === teammate.id))
              .map((teammate) => {
                let startPoint = (teammate.liveLocationLat && teammate.liveLocationLng)
                  ? { lat: teammate.liveLocationLat, lng: teammate.liveLocationLng }
                  : (teammate.workLocationLat && teammate.workLocationLng)
                    ? { lat: teammate.workLocationLat, lng: teammate.workLocationLng }
                    : null;
                if (!startPoint && teammate.workLocationAddress) {
                  const geocoded = geocodedAddressesRef.current.get(teammate.workLocationAddress);
                  if (geocoded) startPoint = geocoded;
                }
                if (!startPoint && workerProfile) {
                  if (workerProfile.latitude && workerProfile.longitude) {
                    startPoint = {
                      lat: parseFloat(workerProfile.latitude),
                      lng: parseFloat(workerProfile.longitude),
                    };
                  } else if (workerProfile.address) {
                    const workerAddress = `${workerProfile.address}${workerProfile.city ? `, ${workerProfile.city}` : ""}${workerProfile.state ? `, ${workerProfile.state}` : ""}`;
                    const geocoded = geocodedAddressesRef.current.get(workerAddress);
                    if (geocoded) startPoint = geocoded;
                  }
                }
                // Fallback to map center if no location available (so avatar still shows)
                if (!startPoint) {
                  startPoint = { lat: initialMapCenter.lat, lng: initialMapCenter.lng };
                }

                const avatarUrl = teammate.avatarUrl
                  ? (teammate.avatarUrl.startsWith("http") || teammate.avatarUrl.startsWith("data:")
                      ? teammate.avatarUrl
                      : `${window.location.origin}${teammate.avatarUrl.startsWith("/") ? "" : "/"}${teammate.avatarUrl}`)
                  : null;
                const name = `${teammate.firstName} ${teammate.lastName}`;
                return (
                  <OverlayView
                    key={`teammate-${teammate.id}`}
                    position={startPoint}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  >
                    <CalendarAvatarPin
                      name={name}
                      avatarUrl={avatarUrl}
                      ringColorHex="#3b82f6"
                      title={`${name} - ${teammate.liveLocationLat ? "Live Location" : teammate.workLocationLat ? "Work Location" : "Default Location"}${routes.length === 0 ? " (No jobs today)" : ""}`}
                    />
                  </OverlayView>
                );
              })}

            {/* Render markers for job stops in routes */}
            {routes.map((route) =>
              route.jobs.map((job) => (
                <Marker
                  key={`job-${route.teammateId}-${job.jobId}`}
                  position={{ lat: job.lat, lng: job.lng }}
                  icon={{
                    path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                    scale: 6,
                    fillColor: route.routeColor,
                    fillOpacity: 1,
                    strokeColor: "#fff",
                    strokeWeight: 2,
                  }}
                  label={{
                    text: `${job.sequence}`,
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: "bold",
                  }}
                  onClick={() => setSelectedJobId(job.jobId)}
                  title={`${job.jobTitle} - Stop ${job.sequence}`}
                />
              ))
            )}

            {/* Render markers for unassigned jobs (jobs without teamMemberId) */}
            {unassignedJobs.map((assignment) => {
              const lat = assignment.latitude ? parseFloat(assignment.latitude) : null;
              const lng = assignment.longitude ? parseFloat(assignment.longitude) : null;
              
              if (!lat || !lng) return null;
              
              // Check if this job is already in a route
              const isInRoute = routes.some(route => 
                route.jobs.some(job => job.jobId === assignment.jobId)
              );
              if (isInRoute) return null; // Don't duplicate markers
              
              return (
                <Marker
                  key={`unassigned-job-${assignment.jobId}`}
                  position={{ lat, lng }}
                  icon={{
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 7,
                    fillColor: "#f59e0b", // Amber for unassigned/pending jobs
                    fillOpacity: 0.8,
                    strokeColor: "#fff",
                    strokeWeight: 2,
                  }}
                  label={{
                    text: "?",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: "bold",
                  }}
                  onClick={() => setSelectedJobId(assignment.jobId)}
                  title={`${assignment.jobTitle} - Unassigned`}
                />
              );
            })}

            {/* Render markers for available jobs (opportunities) */}
            {filteredAvailableJobs.map((job) => {
              const lat = job.latitude ? parseFloat(job.latitude) : null;
              const lng = job.longitude ? parseFloat(job.longitude) : null;
              
              if (!lat || !lng) return null;
              
              // Check if this job is already in a route or unassigned
              const isInRoute = routes.some(route => 
                route.jobs.some(j => j.jobId === job.id)
              );
              const isUnassigned = unassignedJobs.some(j => j.jobId === job.id);
              if (isInRoute || isUnassigned) return null; // Don't duplicate markers
              
              return (
                <Marker
                  key={`available-job-${job.id}`}
                  position={{ lat, lng }}
                  icon={{
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 7,
                    fillColor: "#10b981", // Green for available jobs
                    fillOpacity: 0.8,
                    strokeColor: "#fff",
                    strokeWeight: 2,
                  }}
                  label={{
                    text: "○",
                    color: "#fff",
                    fontSize: "14px",
                    fontWeight: "bold",
                  }}
                  onClick={() => {
                    setSelectedJobId(job.id);
                    if (onJobAction) onJobAction(job.id, "add-to-route");
                  }}
                  title={`${job.title} - Available (click to add to route)`}
                />
              );
            })}

            {/* Pop-up when user clicks a route line */}
            {selectedRoute && (() => {
              const pos = selectedRoute.workLocation || selectedRoute.jobs[0];
              if (!pos) return null;
              return (
                <InfoWindow
                  position={{ lat: pos.lat, lng: pos.lng }}
                  onCloseClick={() => setSelectedRoute(null)}
                >
                  <div className="p-2 min-w-[160px] max-w-[240px]">
                    <p className="font-medium text-sm mb-2">{selectedRoute.teammateName}</p>
                    {selectedRoute.routeType === "available" && selectedRoute.jobs.length > 0 && (
                      <button
                        type="button"
                        className="w-full text-left text-xs text-primary hover:underline mb-2"
                        onClick={() => {
                          if (onJobAction) onJobAction(selectedRoute.jobs[0].jobId, "add-to-route");
                          setSelectedRoute(null);
                        }}
                      >
                        Add to route / Apply (step 3)
                      </button>
                    )}
                    <div className="space-y-1">
                      {selectedRoute.jobs.map((job) => (
                        <button
                          key={job.jobId}
                          type="button"
                          className="w-full text-left text-xs text-muted-foreground hover:underline"
                          onClick={() => {
                            setSelectedJobId(job.jobId);
                            setSelectedRoute(null);
                          }}
                        >
                          {job.sequence}. {job.jobTitle}
                        </button>
                      ))}
                    </div>
                  </div>
                </InfoWindow>
              );
            })()}

            {/* Info window for selected job */}
            {selectedJobId && (() => {
              // Check if it's a route job, unassigned job, or available job
              const route = routes.find((r) => 
                r.jobs.some((j) => j.jobId === selectedJobId)
              );
              const unassignedJob = unassignedJobs.find((j) => j.jobId === selectedJobId);
              const availableJob = filteredAvailableJobs.find((j) => j.id === selectedJobId);
              
              if (route) {
                const jobStop = route.jobs.find((j) => j.jobId === selectedJobId);
                if (!jobStop) return null;

              return (
                <InfoWindow
                  position={{ lat: jobStop.lat, lng: jobStop.lng }}
                  onCloseClick={() => setSelectedJobId(null)}
                >
                  <div className="min-w-[280px] max-w-[360px] overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
                    {/* Gallery-style top (like job details popup) */}
                    <div className="relative w-full bg-muted overflow-hidden flex-shrink-0 aspect-video rounded-t-2xl">
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center">
                        <MapPin className="w-8 h-8 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground line-clamp-2">{jobStop.address}</p>
                        <p className="text-[10px] text-muted-foreground/80 uppercase tracking-wide">Full address</p>
                      </div>
                      <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/35 via-black/15 to-transparent pointer-events-none rounded-t-2xl" />
                    </div>
                    {/* Content card — rounded top overlap, job-details style */}
                    <div className="relative bg-background rounded-t-[28px] -mt-6 flex-shrink-0 flex flex-col px-4 pt-3 pb-4 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
                      {/* Worker on route */}
                      <div className="flex items-center gap-2 mb-3">
                        <Avatar className="w-9 h-9 flex-shrink-0">
                          <AvatarImage src={route.teammateAvatar || undefined} />
                          <AvatarFallback className="text-xs">
                            {route.teammateName.split(" ").map((n) => n[0]).join("").toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm truncate">{route.teammateName}</p>
                          {route.totalDistance && route.totalDuration && (
                            <p className="text-xs text-muted-foreground">{route.totalDistance} • {route.totalDuration}</p>
                          )}
                        </div>
                      </div>
                      {/* Job title + status badges */}
                      <div className="flex items-start gap-2 mb-2">
                        <p className="font-medium text-sm flex-1 min-w-0 line-clamp-2">{jobStop.jobTitle}</p>
                        {jobStop.isCurrent && (
                          <Badge variant={jobStop.isBehind ? "destructive" : "default"} className="text-xs flex-shrink-0">
                            {jobStop.isBehind ? <><AlertTriangle className="w-3 h-3 mr-1" /> Behind</> : <><CheckCircle2 className="w-3 h-3 mr-1" /> Current</>}
                          </Badge>
                        )}
                        {jobStop.isNext && !jobStop.isCurrent && (
                          <Badge variant="outline" className="text-xs flex-shrink-0"><Circle className="w-3 h-3 mr-1" /> Next</Badge>
                        )}
                      </div>
                      {/* Date section (like job details) */}
                      <div className="flex items-start gap-2 text-sm text-muted-foreground mb-2">
                        <Calendar className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div>
                          <p>{format(jobStop.scheduledStart, "EEEE, MMM d")}</p>
                          <p className="text-xs">{format(jobStop.scheduledStart, "h:mm a")} – {format(jobStop.scheduledEnd, "h:mm a")}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="line-clamp-2">{jobStop.address}</span>
                      </p>
                      {jobStop.isBehind && jobStop.isCurrent && (
                        <p className="text-xs text-destructive font-medium mb-2">
                          Running {Math.round((new Date().getTime() - jobStop.scheduledStart.getTime()) / (1000 * 60))} min late
                        </p>
                      )}
                      {onJobAction && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs w-full"
                          onClick={() => {
                            onJobAction(jobStop.jobId, "directions");
                            setSelectedJobId(null);
                          }}
                        >
                          <MapIcon className="w-3.5 h-3.5 mr-1.5" />
                          Directions
                        </Button>
                      )}
                    </div>
                  </div>
                </InfoWindow>
              );
              } else if (unassignedJob) {
                const lat = unassignedJob.latitude ? parseFloat(unassignedJob.latitude) : null;
                const lng = unassignedJob.longitude ? parseFloat(unassignedJob.longitude) : null;
                if (!lat || !lng) return null;

                const scheduledStart = typeof unassignedJob.scheduledStart === "string"
                  ? parseISO(unassignedJob.scheduledStart)
                  : unassignedJob.scheduledStart;
                const scheduledEnd = typeof unassignedJob.scheduledEnd === "string"
                  ? parseISO(unassignedJob.scheduledEnd)
                  : unassignedJob.scheduledEnd;

                return (
                  <InfoWindow
                    key={`info-unassigned-${selectedJobId}`}
                    position={{ lat, lng }}
                    onCloseClick={() => setSelectedJobId(null)}
                  >
                    <div className="min-w-[280px] max-w-[360px] overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
                      <div className="relative w-full bg-muted overflow-hidden flex-shrink-0 aspect-video rounded-t-2xl">
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center">
                          <MapPin className="w-8 h-8 text-muted-foreground" />
                          <p className="text-xs text-muted-foreground line-clamp-2">{unassignedJob.address}</p>
                        </div>
                        <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/35 via-black/15 to-transparent pointer-events-none rounded-t-2xl" />
                      </div>
                      <div className="relative bg-background rounded-t-[28px] -mt-6 flex-shrink-0 flex flex-col px-4 pt-3 pb-4 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="border-purple-500 text-purple-700 dark:text-purple-400 text-xs">
                            Unassigned
                          </Badge>
                        </div>
                        <p className="font-medium text-sm mb-2 line-clamp-2">{unassignedJob.jobTitle}</p>
                        <div className="flex items-start gap-2 text-sm text-muted-foreground mb-2">
                          <Calendar className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div>
                            <p>{format(scheduledStart, "EEEE, MMM d")}</p>
                            <p className="text-xs">{format(scheduledStart, "h:mm a")} – {format(scheduledEnd, "h:mm a")}</p>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span className="line-clamp-2">{unassignedJob.address}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Status: <Badge variant="outline" className="text-xs">{unassignedJob.status}</Badge>
                        </p>
                      </div>
                    </div>
                  </InfoWindow>
                );
              } else if (availableJob) {
                const lat = availableJob.latitude ? parseFloat(availableJob.latitude) : null;
                const lng = availableJob.longitude ? parseFloat(availableJob.longitude) : null;
                if (!lat || !lng) return null;
                const startDate = typeof availableJob.startDate === "string" ? parseISO(availableJob.startDate) : availableJob.startDate;

                return (
                  <InfoWindow
                    key={`info-available-${selectedJobId}`}
                    position={{ lat, lng }}
                    onCloseClick={() => setSelectedJobId(null)}
                  >
                    <div className="min-w-[280px] max-w-[360px] overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
                      <div className="relative w-full bg-muted overflow-hidden flex-shrink-0 aspect-video rounded-t-2xl">
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center">
                          <MapPin className="w-8 h-8 text-muted-foreground" />
                          <p className="text-xs text-muted-foreground">
                            {[availableJob.city, availableJob.state].filter(Boolean).join(", ") || "General area"}
                          </p>
                          <p className="text-[10px] text-muted-foreground/80 uppercase tracking-wide">Full address when accepted</p>
                        </div>
                        <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/35 via-black/15 to-transparent pointer-events-none rounded-t-2xl" />
                      </div>
                      <div className="relative bg-background rounded-t-[28px] -mt-6 flex-shrink-0 flex flex-col px-4 pt-3 pb-4 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400 text-xs">
                            Available
                          </Badge>
                        </div>
                        <p className="font-medium text-sm mb-2 line-clamp-2">{availableJob.title}</p>
                        <div className="flex items-start gap-2 text-sm text-muted-foreground mb-2">
                          <Calendar className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div>
                            <p>{format(startDate, "EEEE, MMM d")}</p>
                            {availableJob.scheduledTime && <p className="text-xs">{availableJob.scheduledTime}</p>}
                          </div>
                        </div>
                        {availableJob.hourlyRate && (
                          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />$
                            {(
                              (workerFacingJobHourlyCents(availableJob.hourlyRate) > 0
                                ? workerFacingJobHourlyCents(availableJob.hourlyRate)
                                : availableJob.hourlyRate) / 100
                            ).toFixed(2)}
                            /hr
                          </p>
                        )}
                        {onJobAction && (
                          <Button
                            size="sm"
                            className="h-8 text-xs w-full"
                            onClick={() => {
                              onJobAction(availableJob.id, "add-to-route");
                              setSelectedJobId(null);
                            }}
                          >
                            <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                            Add to route
                          </Button>
                        )}
                      </div>
                    </div>
                  </InfoWindow>
                );
              }
              return null;
            })()}
          </GoogleMap>
        )}
        {loadingRoutes && (
          <div className="absolute top-4 right-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg shadow-lg p-2 z-10">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Navigation className="w-3 h-3 animate-spin" />
              Calculating routes...
            </div>
          </div>
        )}
        {!loadingRoutes && !hasRouteContent && (
          <div className="absolute left-1/2 top-4 z-10 w-[min(92%,460px)] -translate-x-1/2 rounded-lg border border-border bg-background/95 p-3 text-center shadow-sm backdrop-blur-sm">
            <p className="text-sm font-medium">No routes for this date</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Zoomed out view shown. Try another date or enable more workers.
            </p>
          </div>
        )}
      </div>

      {/* Desktop Bottom Panel - Routes Table */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-background border-t border-border shadow-2xl transition-all duration-300 z-20 ${
          desktopPanelExpanded ? "h-[400px]" : "h-[60px]"
        }`}
      >
        {/* Panel Header with Expand/Collapse Button and optional right content (e.g. worker filter) */}
        <div className="flex items-center justify-between gap-2 p-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <TableIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <h3 className="font-semibold text-sm truncate">
              Routes for {format(selectedDate, "MMM d, yyyy")}
            </h3>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {dateMode}
            </Badge>
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              {routes.length} {routes.length === 1 ? "route" : "routes"}
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {replayEnabled && dateMode === "past" && (
              <div className="hidden lg:flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1">
                <span className="text-[10px] uppercase text-muted-foreground">Replay</span>
                <input
                  type="range"
                  min={0}
                  max={1439}
                  step={5}
                  value={replayMinute}
                  onChange={(e) => setReplayMinute(parseInt(e.target.value, 10))}
                  className="w-28"
                />
                <span className="text-xs tabular-nums">{replayLabel}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setReplayPlaying((v) => !v)}
                >
                  {replayPlaying ? "Pause" : "Play"}
                </Button>
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => jumpReplayEvent("prev")}>
                  Prev
                </Button>
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => jumpReplayEvent("next")}>
                  Next
                </Button>
                <Button
                  variant={showReplayJobStarts ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setShowReplayJobStarts((v) => !v)}
                >
                  Starts
                </Button>
                <Button
                  variant={showReplayJobEnds ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setShowReplayJobEnds((v) => !v)}
                >
                  Ends
                </Button>
                <Button
                  variant={showReplayPings ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setShowReplayPings((v) => !v)}
                >
                  Pings
                </Button>
                {replayEventTeammates.length > 0 && (
                  <div className="ml-1 flex max-w-[240px] items-center gap-1 overflow-x-auto border-l border-border pl-2">
                    <Button
                      variant={replayTeammateFilterIds.length === 0 ? "default" : "outline"}
                      size="sm"
                      className="h-6 px-2 text-[10px] whitespace-nowrap"
                      onClick={() => setReplayTeammateFilterIds([])}
                    >
                      All
                    </Button>
                    {replayEventTeammates.slice(0, 6).map((teammate) => (
                      <Button
                        key={`replay-desktop-worker-${teammate.id}`}
                        variant={replayTeammateFilterSet.has(teammate.id) ? "default" : "outline"}
                        size="sm"
                        className="h-6 px-2 text-[10px] whitespace-nowrap"
                        onClick={() => toggleReplayTeammateFilter(teammate.id)}
                      >
                        {teammate.firstName}
                      </Button>
                    ))}
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setReplayRailOpen((v) => !v)}
                >
                  {replayRailOpen ? "Hide events" : "Events"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={handleCopyReplayLink}
                  data-testid="button-replay-copy-link-desktop"
                >
                  {replayLinkCopied ? "Copied" : "Copy"}
                </Button>
                {replayEventChips.slice(0, 6).map((chip) => (
                  <Button
                    key={`chip-desktop-${chip.minute}-${chip.kind}`}
                    variant="outline"
                    size="sm"
                    className={`h-6 px-2 text-[10px] ${replayChipTone(chip.kind, chip.minute === replayMinute)}`}
                    onClick={() => {
                      setReplayPlaying(false);
                      setReplayMinute(chip.minute);
                    }}
                    title={chip.label}
                  >
                    {String(Math.floor(chip.minute / 60)).padStart(2, "0")}:{String(chip.minute % 60).padStart(2, "0")}
                  </Button>
                ))}
              </div>
            )}
            {toolbarRightContent}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDesktopPanelExpanded(!desktopPanelExpanded)}
              className="h-8 w-8 p-0"
            >
              {desktopPanelExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Panel Content - Table grouped by status; mobile: stacked cards (no horizontal scroll) */}
        {desktopPanelExpanded && (
          <div className="h-[340px] overflow-auto">
            {routes.length === 0 && filteredAvailableJobs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No routes available for this date
              </div>
            ) : (
              <div className="p-4">
                {replayEnabled && dateMode === "past" && replayRailOpen && replayEventTimeline.length > 0 && (
                  <div className="mb-3 rounded-lg border border-border bg-muted/30 p-2">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Replay event rail</div>
                    <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        Start
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        End
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                        Ping
                      </span>
                    </div>
                    {replayEventRail.length > 0 ? (
                      <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                        {replayEventRail.map((chip) => (
                          <button
                            key={`rail-desktop-${chip.minute}-${chip.kind}`}
                            type="button"
                            className={`rounded border px-2 py-1 text-left text-[11px] ${
                              replayChipTone(chip.kind, chip.minute === replayMinute)
                            }`}
                            onClick={() => {
                              setReplayPlaying(false);
                              setReplayMinute(chip.minute);
                            }}
                            title={chip.label}
                          >
                            <span className="mr-2 tabular-nums">
                              {String(Math.floor(chip.minute / 60)).padStart(2, "0")}:{String(chip.minute % 60).padStart(2, "0")}
                            </span>
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded border border-border bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
                        No replay events under current filters.
                      </div>
                    )}
                  </div>
                )}
                {(() => {
                  const acceptedRoutes = routes.filter((r) => r.routeType === "accepted");
                  const pendingRoutes = routes.filter((r) => r.routeType === "pending");
                  const availableRoutes = routes.filter((r) => r.routeType === "available");

                  const renderRouteRow = (route: TeammateRoute) => {
                    const currentJob = route.jobs.find((j) => j.isCurrent);
                    const nextJob = route.jobs.find((j) => j.isNext);
                    const behindJobs = route.jobs.filter((j) => j.isBehind);
                    const timelineNow = dateMode === "past" ? endOfDay(selectedDate) : new Date();
                    const completedCount = route.jobs.filter((j) => j.scheduledEnd.getTime() <= timelineNow.getTime()).length;
                    const upcomingCount = Math.max(0, route.jobs.length - completedCount);
                    const statusCell = dateMode === "past" ? (
                      <Badge variant="outline" className="text-xs">Historical</Badge>
                    ) : dateMode === "future" ? (
                      <Badge variant="outline" className="text-xs">Planned</Badge>
                    ) : behindJobs.length > 0 ? (
                      <Badge variant="destructive" className="text-xs"><AlertTriangle className="w-3 h-3 mr-1" /> Behind</Badge>
                    ) : currentJob ? (
                      <Badge variant="default" className="text-xs"><CheckCircle2 className="w-3 h-3 mr-1" /> On Time</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Scheduled</Badge>
                    );
                    const routeList = (
                      <div className="flex flex-col gap-1">
                        {route.jobs.slice(0, 3).map((job) => (
                          <div key={job.jobId} className="flex items-center gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: route.routeColor }} />
                            <span className="truncate flex-1">{job.sequence}. {job.jobTitle}</span>
                            {dateMode !== "past" && job.isCurrent && <Badge variant="default" className="text-[10px] px-1.5 py-0">Current</Badge>}
                            {dateMode !== "past" && job.isNext && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Next</Badge>}
                          </div>
                        ))}
                        {dateMode === "past" && (
                          <div className="text-[10px] text-muted-foreground ml-4">
                            Historical route ({completedCount} stops)
                          </div>
                        )}
                        {route.jobs.length > 3 && <span className="text-xs text-muted-foreground ml-4">+{route.jobs.length - 3} more</span>}
                      </div>
                    );
                    const workerCell = (
                      <div className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={route.teammateAvatar || undefined} />
                          <AvatarFallback className="text-xs">{route.teammateName.split(" ").map((n) => n[0]).join("").toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">{route.teammateName}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {route.routeSource || "polyline"}
                        </Badge>
                      </div>
                    );
                    const focusMap = () => {
                      if (mapRef.current && route.jobs.length > 0) {
                        const bounds = new google.maps.LatLngBounds();
                        if (route.workLocation) bounds.extend(new google.maps.LatLng(route.workLocation.lat, route.workLocation.lng));
                        if (route.liveLocation) bounds.extend(new google.maps.LatLng(route.liveLocation.lat, route.liveLocation.lng));
                        route.jobs.forEach((job) => bounds.extend(new google.maps.LatLng(job.lat, job.lng)));
                        fitBoundsWithZoomCap(bounds);
                      }
                    };
                    return { route, workerCell, routeList, statusCell, focusMap };
                  };

                  const GroupHeader = ({ label, badge }: { label: string; badge?: React.ReactNode }) => (
                    <TableRow className="bg-muted/60 hover:bg-muted/60 border-b-2 border-border">
                      <TableCell colSpan={6} className="font-semibold text-xs uppercase tracking-wide text-muted-foreground py-2">
                        <div className="flex items-center gap-2">
                          {label}
                          {badge}
                        </div>
                      </TableCell>
                    </TableRow>
                  );

                  if (isMobile) {
                    return (
                      <div className="space-y-4 overflow-x-hidden">
                        {acceptedRoutes.length > 0 && (
                          <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
                              Approved
                              <Badge variant="secondary" className="text-[10px]">{acceptedRoutes.length}</Badge>
                            </h3>
                            <div className="space-y-2">
                              {acceptedRoutes.map((route) => {
                                const r = renderRouteRow(route);
                                return (
                                  <div
                                    key={route.teammateId}
                                    role="button"
                                    tabIndex={0}
                                    onClick={r.focusMap}
                                    onKeyDown={(e) => e.key === "Enter" && r.focusMap()}
                                    className="p-3 rounded-lg border border-border bg-card text-left space-y-2"
                                  >
                                    <div className="flex justify-between items-start gap-2">
                                      <span className="text-[10px] text-muted-foreground uppercase">Worker</span>
                                      {r.workerCell}
                                    </div>
                                    <div className="flex justify-between items-start gap-2">
                                      <span className="text-[10px] text-muted-foreground uppercase">Jobs</span>
                                      <Badge variant="secondary" className="text-xs">{route.jobs.length}</Badge>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-muted-foreground uppercase block mb-1">Route</span>
                                      {r.routeList}
                                    </div>
                                    <div className="flex justify-between items-center gap-2 text-xs">
                                      <span className="text-muted-foreground">Distance</span>
                                      <span>{route.totalDistance || "—"}</span>
                                    </div>
                                    <div className="flex justify-between items-center gap-2 text-xs">
                                      <span className="text-muted-foreground">Duration</span>
                                      <span>{route.totalDuration || "—"}</span>
                                    </div>
                                    <div className="flex justify-between items-center gap-2">
                                      <span className="text-[10px] text-muted-foreground uppercase">Status</span>
                                      {r.statusCell}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        )}
                        {pendingRoutes.length > 0 && (
                          <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
                              Pending
                              <Badge variant="secondary" className="text-[10px]">{pendingRoutes.length}</Badge>
                            </h3>
                            <div className="space-y-2">
                              {pendingRoutes.map((route) => {
                                const r = renderRouteRow(route);
                                return (
                                  <div
                                    key={route.teammateId}
                                    role="button"
                                    tabIndex={0}
                                    onClick={r.focusMap}
                                    onKeyDown={(e) => e.key === "Enter" && r.focusMap()}
                                    className="p-3 rounded-lg border border-border bg-card text-left space-y-2"
                                  >
                                    <div className="flex justify-between items-start gap-2"><span className="text-[10px] text-muted-foreground uppercase">Worker</span>{r.workerCell}</div>
                                    <div className="flex justify-between items-start gap-2"><span className="text-[10px] text-muted-foreground uppercase">Jobs</span><Badge variant="secondary" className="text-xs">{route.jobs.length}</Badge></div>
                                    <div><span className="text-[10px] text-muted-foreground uppercase block mb-1">Route</span>{r.routeList}</div>
                                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Distance</span><span>{route.totalDistance || "—"}</span></div>
                                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Duration</span><span>{route.totalDuration || "—"}</span></div>
                                    <div className="flex justify-between items-center"><span className="text-[10px] text-muted-foreground uppercase">Status</span>{r.statusCell}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        )}
                        {availableRoutes.length > 0 && (
                          <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
                              Available
                              <Badge variant="secondary" className="text-[10px]">{availableRoutes.length}</Badge>
                            </h3>
                            <div className="space-y-2">
                              {availableRoutes.map((route) => {
                                const r = renderRouteRow(route);
                                return (
                                  <div
                                    key={route.teammateId}
                                    role="button"
                                    tabIndex={0}
                                    onClick={r.focusMap}
                                    onKeyDown={(e) => e.key === "Enter" && r.focusMap()}
                                    className="p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/20 text-left space-y-2"
                                  >
                                    <div className="flex justify-between items-start gap-2"><span className="text-[10px] text-muted-foreground uppercase">Worker</span>{r.workerCell}</div>
                                    <div className="flex justify-between items-start gap-2"><span className="text-[10px] text-muted-foreground uppercase">Jobs</span><Badge variant="secondary" className="text-xs">{route.jobs.length}</Badge></div>
                                    <div><span className="text-[10px] text-muted-foreground uppercase block mb-1">Route</span>{r.routeList}</div>
                                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Distance</span><span>{route.totalDistance || "—"}</span></div>
                                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Duration</span><span>{route.totalDuration || "—"}</span></div>
                                    <div className="flex justify-between items-center"><span className="text-[10px] text-muted-foreground uppercase">Status</span>{r.statusCell}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        )}
                        {filteredAvailableJobs.length > 0 && (
                          <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
                              Available jobs to add
                              <Badge variant="secondary" className="text-[10px]">{filteredAvailableJobs.length}</Badge>
                            </h3>
                            <div className="space-y-2">
                              {filteredAvailableJobs.map((job) => (
                                <div key={job.id} className="p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 dark:text-amber-400">Available</Badge>
                                    <span className="text-sm font-medium truncate flex-1">{job.title}</span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {[job.city, job.state].filter(Boolean).join(", ")}
                                    {job.scheduledTime && ` • ${job.scheduledTime}`}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {teammates.slice(0, 3).map((t) => (
                                      <Button key={t.id} variant="outline" size="sm" className="text-xs h-7" onClick={(e) => { e.stopPropagation(); onAddJobToRoute?.(job.id, t.id) ?? onJobAction?.(job.id, "add-to-route"); }}>
                                        <Avatar className="w-3 h-3 mr-1"><AvatarImage src={t.avatarUrl || undefined} /><AvatarFallback className="text-[7px]">{t.firstName[0]}{t.lastName[0]}</AvatarFallback></Avatar>
                                        Add
                                      </Button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                      </div>
                    );
                  }

                  return (
                    <TableComponent className="border-collapse">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[200px]">Worker</TableHead>
                          <TableHead className="w-[100px]">Jobs</TableHead>
                          <TableHead>Route</TableHead>
                          <TableHead className="w-[120px]">Distance</TableHead>
                          <TableHead className="w-[120px]">Duration</TableHead>
                          <TableHead className="w-[100px]">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {acceptedRoutes.length > 0 && (
                          <>
                            <GroupHeader label="Approved" badge={<Badge variant="secondary" className="text-[10px] ml-1">{acceptedRoutes.length}</Badge>} />
                            {acceptedRoutes.map((route) => {
                              const r = renderRouteRow(route);
                              return (
                                <TableRow key={route.teammateId} className="cursor-pointer hover:bg-muted/50" onClick={r.focusMap}>
                                  <TableCell>{r.workerCell}</TableCell>
                                  <TableCell><Badge variant="secondary" className="text-xs">{route.jobs.length}</Badge></TableCell>
                                  <TableCell>{r.routeList}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{route.totalDistance || "—"}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{route.totalDuration || "—"}</TableCell>
                                  <TableCell>{r.statusCell}</TableCell>
                                </TableRow>
                              );
                            })}
                          </>
                        )}
                        {pendingRoutes.length > 0 && (
                          <>
                            <GroupHeader label="Pending" badge={<Badge variant="secondary" className="text-[10px] ml-1">{pendingRoutes.length}</Badge>} />
                            {pendingRoutes.map((route) => {
                              const r = renderRouteRow(route);
                              return (
                                <TableRow key={route.teammateId} className="cursor-pointer hover:bg-muted/50" onClick={r.focusMap}>
                                  <TableCell>{r.workerCell}</TableCell>
                                  <TableCell><Badge variant="secondary" className="text-xs">{route.jobs.length}</Badge></TableCell>
                                  <TableCell>{r.routeList}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{route.totalDistance || "—"}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{route.totalDuration || "—"}</TableCell>
                                  <TableCell>{r.statusCell}</TableCell>
                                </TableRow>
                              );
                            })}
                          </>
                        )}
                        {availableRoutes.length > 0 && (
                          <>
                            <GroupHeader label="Available" badge={<Badge variant="secondary" className="text-[10px] ml-1">{availableRoutes.length}</Badge>} />
                            {availableRoutes.map((route) => {
                              const r = renderRouteRow(route);
                              return (
                                <TableRow key={route.teammateId} className="cursor-pointer hover:bg-amber-50/30 dark:bg-amber-950/10 hover:bg-amber-50/50 dark:hover:bg-amber-950/20" onClick={r.focusMap}>
                                  <TableCell>{r.workerCell}</TableCell>
                                  <TableCell><Badge variant="secondary" className="text-xs">{route.jobs.length}</Badge></TableCell>
                                  <TableCell>{r.routeList}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{route.totalDistance || "—"}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{route.totalDuration || "—"}</TableCell>
                                  <TableCell>{r.statusCell}</TableCell>
                                </TableRow>
                              );
                            })}
                          </>
                        )}
                      </TableBody>
                    </TableComponent>
                  );
                })()}

                {/* Available Jobs to add (desktop: below table) */}
                {!isMobile && filteredAvailableJobs.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-500" />
                      Available jobs to add ({filteredAvailableJobs.length})
                    </h3>
                    <div className="space-y-2">
                      {filteredAvailableJobs.map((job) => (
                        <div key={job.id} className="p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 dark:text-amber-400">Available</Badge>
                                <span className="text-sm font-medium truncate">{job.title}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {[job.city, job.state].filter(Boolean).join(", ")}
                                {job.scheduledTime && ` • ${job.scheduledTime}`}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {teammates.slice(0, 3).map((teammate) => (
                                <Button
                                  key={teammate.id}
                                  variant="outline"
                                  size="sm"
                                  className="text-xs h-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAddJobToRoute?.(job.id, teammate.id) ?? onJobAction?.(job.id, "add-to-route");
                                  }}
                                >
                                  <Avatar className="w-3 h-3 mr-1">
                                    <AvatarImage src={teammate.avatarUrl || undefined} />
                                    <AvatarFallback className="text-[7px]">{teammate.firstName[0]}{teammate.lastName[0]}</AvatarFallback>
                                  </Avatar>
                                  Add
                                </Button>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Future route efficiency suggestions */}
                {!isMobile && dateMode === "future" && optimizationSuggestions.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-primary" />
                      Reassignment gains ({optimizationSuggestions.length})
                    </h3>
                    <div className="space-y-2">
                      {optimizationSuggestions.map((suggestion) => (
                        <div key={`suggest-${suggestion.jobId}-${suggestion.currentTeammateName}`} className="rounded-lg border bg-card p-3">
                          <div className="text-sm font-medium truncate">{suggestion.jobTitle}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Move from <span className="font-medium text-foreground">{suggestion.currentTeammateName}</span> to{" "}
                            <span className="font-medium text-foreground">{suggestion.suggestedTeammateName}</span>
                          </div>
                          <div className="mt-1 text-xs text-primary">
                            Saves about {suggestion.gainMiles.toFixed(1)} mi ({suggestion.gainMinutes} min)
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
