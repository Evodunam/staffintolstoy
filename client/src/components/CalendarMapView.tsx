import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, InfoWindow, Polyline } from "@react-google-maps/api";
import { format, parseISO, isSameDay, addDays, subDays, isToday, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MapPin, Clock, User, Navigation, AlertCircle, ChevronLeft, ChevronRight, Calendar, MoreVertical, Phone, MessageSquare, Map as MapIcon, AlertTriangle, CheckCircle2, Circle, ChevronUp, ChevronDown, Table as TableIcon, Zap, DollarSign, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Table as TableComponent, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GOOGLE_MAPS_LOADER_ID, GOOGLE_MAPS_LIBRARIES } from "@/lib/google-maps";

const mapStyles = [
  {
    featureType: "poi",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
];

// Data model interfaces
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
  totalDistance?: string;
  totalDuration?: string;
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
}

interface CalendarMapViewProps {
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
  }>;
  workerProfile?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    latitude?: string | null;
    longitude?: string | null;
  } | null; // Worker's profile for fallback location
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
}

// Color palette for routes
const ROUTE_COLORS = [
  "#3B82F6", // Blue
  "#10B981", // Green
  "#F59E0B", // Amber
  "#EF4444", // Red
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#F97316", // Orange
];

export function CalendarMapView({
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
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [bottomSheetPosition, setBottomSheetPosition] = useState<"collapsed" | "peek" | "full">("peek");
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
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  // Filter job assignments for selected date and job type visibility
  const filteredJobAssignments = useMemo(() => {
    console.log(`📅 Filtering jobs for date: ${format(selectedDate, "yyyy-MM-dd")}`);
    console.log(`📦 Total job assignments: ${jobAssignments.length}`);
    
    if (jobAssignments.length === 0) {
      console.warn(`⚠️ No job assignments received! Check if applications are being loaded correctly.`);
    }
    
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
        console.log(`  ⏭️ Skipping job ${assignment.jobId} (${assignment.jobTitle}): date ${format(assignmentDate, "yyyy-MM-dd")} not within ±1 day of ${format(selectedDate, "yyyy-MM-dd")}`);
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
    
    console.log(`✅ Filtered to ${filtered.length} jobs for selected date`);
    filtered.forEach(job => {
      console.log(`  📍 Job ${job.jobId}: ${job.jobTitle} (teammate ${job.teamMemberId}, status: ${job.status}) - ${job.latitude || "NO LAT"}, ${job.longitude || "NO LNG"}`);
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
      if (teammate.liveLocationLat && teammate.liveLocationLng) {
        startLat = teammate.liveLocationLat;
        startLng = teammate.liveLocationLng;
      } 
      // Priority 2: Use work location coordinates (from address geocoding) if available
      else if (teammate.workLocationLat && teammate.workLocationLng) {
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
      
      if (isPendingOrAvailable) {
        // Find closest enabled teammate within 15 miles
        let closestTeammateId: number | null = null;
        let closestDistance = Infinity;
        
        teammateStartLocations.forEach((startLoc, teammateId) => {
          const distance = calculateDistanceMiles(startLoc.lat, startLoc.lng, lat, lng);
          if (distance <= 15 && distance < closestDistance) {
            closestDistance = distance;
            closestTeammateId = teammateId;
          }
        });
        
        if (!closestTeammateId) {
          // Job is outside 15mi geofence for all teammates - skip it
          return;
        }
        
        // Assign to closest teammate within geofence
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
          sequence: 0, // Will be set after sorting
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
        sequence: 0, // Will be set after sorting
      });
    });
    
    // Note: Available jobs are shown as separate markers, not automatically added to routes
    // They will be displayed with route optimization suggestions in the marker info windows

    // Sort jobs by scheduled start time and assign sequence, determine current/next/behind status
    const now = new Date();
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
    let colorIndex = 0;
    for (const teammate of teammates) {
      if (!enabledTeammates.has(teammate.id)) continue;

      const jobs = jobsByTeammate.get(teammate.id) || [];
      if (jobs.length === 0) continue;

      const routeColor = ROUTE_COLORS[colorIndex % ROUTE_COLORS.length];
      colorIndex++;

      // Determine starting point with fallback logic:
      // 1. Use live location (GPS) if available - real-time location from location services
      // 2. Fall back to work location coordinates (home/start address coordinates) if no live location
      // 3. Geocode work location address if coordinates not available
      // 4. Fallback to worker profile address/coordinates if teammate has no location
      // 5. Skip if no address or location available at all
      let startLat: number;
      let startLng: number;
      let startAddress: string;

      if (teammate.liveLocationLat && teammate.liveLocationLng) {
        // Use live location (GPS) if available - this is where the worker is RIGHT NOW
        startLat = teammate.liveLocationLat;
        startLng = teammate.liveLocationLng;
        startAddress = "Current Location (GPS)";
      } else if (teammate.workLocationLat && teammate.workLocationLng) {
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
        workLocation: teammate.workLocationAddress && teammate.workLocationLat && teammate.workLocationLng
          ? {
              address: teammate.workLocationAddress,
              lat: teammate.workLocationLat,
              lng: teammate.workLocationLng,
            }
          : null,
        liveLocation: teammate.liveLocationLat && teammate.liveLocationLng
          ? {
              lat: teammate.liveLocationLat,
              lng: teammate.liveLocationLng,
              timestamp: teammate.liveLocationTimestamp || new Date(),
            }
          : null,
        jobs,
        route: null,
        routeColor,
      };

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
            
            // Use total distance and duration from API response
            const totalDistanceMeters = data.totalDistance || 0;
            const totalDurationSeconds = parseInt(data.totalDuration?.replace("s", "") || "0");
            
            route.totalDistance = `${(totalDistanceMeters / 1609.34).toFixed(1)} mi`;
            route.totalDuration = `${Math.round(totalDurationSeconds / 60)} min`;

            // Create DirectionsRenderer for the route
            const renderer = new google.maps.DirectionsRenderer({
              map: mapRef.current,
              directions: directionsResult,
              suppressMarkers: true, // We'll use custom markers
              polylineOptions: {
                strokeColor: routeColor,
                strokeWeight: 4,
                strokeOpacity: 0.8,
              },
            });

            newRenderers.push(renderer);
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
            
            let totalDistance = 0;
            let totalDuration = 0;
            
            result.routes[0]?.legs.forEach((leg) => {
              if (leg.distance) totalDistance += leg.distance.value;
              if (leg.duration) totalDuration += leg.duration.value;
            });

            route.totalDistance = `${(totalDistance / 1609.34).toFixed(1)} mi`;
            route.totalDuration = `${Math.round(totalDuration / 60)} min`;

            const renderer = new google.maps.DirectionsRenderer({
              map: mapRef.current,
              directions: result,
              suppressMarkers: true,
              polylineOptions: {
                strokeColor: routeColor,
                strokeWeight: 4,
                strokeOpacity: 0.8,
              },
            });

            newRenderers.push(renderer);
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
    
    console.log(`📊 Built ${newRoutes.length} routes total`);
    console.log(`📋 Enabled teammates: ${Array.from(enabledTeammates).join(", ")}`);
    console.log(`📋 Jobs by teammate:`, Array.from(jobsByTeammate.entries()).map(([id, jobs]) => ({ teammateId: id, jobCount: jobs.length })));

    setRoutes(newRoutes);
    setDirectionsServices(newServices);
    setDirectionsRenderers(newRenderers);
    setLoadingRoutes(false);
    
    console.log(`🗺️ Routes updated: ${newRoutes.length} routes, ${newRoutes.filter(r => r.route !== null).length} with directions`);

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
      }

      if (bounds.isEmpty()) {
        // Default to San Jose area if no bounds
        bounds.extend(new google.maps.LatLng(37.3382, -121.8863));
      }
      
      mapRef.current.fitBounds(bounds);
      // Clear focus after fitting bounds
      if (focusedTeammateId) {
        setTimeout(() => setFocusedTeammateId(null), 100);
      }
    }
  }, [isLoaded, filteredJobAssignments, teammates, enabledTeammates, focusedTeammateId, filteredAvailableJobs, calculateDistanceMiles, showAcceptedJobs, showPendingJobs, showAvailableJobs]);

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

  // Rebuild routes when dependencies change (date, jobs, teammates, etc.)
  useEffect(() => {
    if (isLoaded && mapRef.current) {
      console.log(`🔄 Rebuilding routes - Date: ${format(selectedDate, "yyyy-MM-dd")}, Jobs: ${filteredJobAssignments.length}, Teammates: ${teammates.length}, Enabled: ${enabledTeammates.size}`);
      
      // Clear existing renderers before building new routes
      directionsRenderers.forEach((renderer) => {
        renderer.setMap(null);
      });
      
      buildRoutes();
    }
  }, [isLoaded, buildRoutes, selectedDate, filteredJobAssignments, teammates, enabledTeammates, showAcceptedJobs, showPendingJobs, showAvailableJobs]);

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
    
    if (loadError) {
      return (
        <div className="w-full flex flex-col items-center justify-center p-8 text-center" style={{ height }}>
          <AlertCircle className="w-12 h-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold mb-2">Failed to Load Google Maps</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            {loadError.message || "Please check your API key and ensure the Maps JavaScript API is enabled."}
          </p>
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

  if (isMobile) {
    // Mobile layout: Map on top, list on bottom
    return (
      <div className="w-full flex flex-col" style={{ height }}>
        {/* Map Section - Top */}
        <div className="flex-1 relative min-h-0">
          {!isLoaded ? (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <Skeleton className="w-full h-full" />
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "100%" }}
              center={{ lat: 37.7749, lng: -122.4194 }}
              zoom={10}
              onLoad={onMapLoad}
              options={{
                styles: mapStyles,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
              }}
            >
              {/* Render routes with directions */}
              {routes
                .filter((route) => route.route !== null)
                .map((route) => (
                  <DirectionsRenderer
                    key={route.teammateId}
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

              {/* Render simple polylines for routes without directions (fallback) */}
              {routes
                .filter((route) => route.route === null && route.jobs.length > 0)
                .map((route) => {
                  const startPoint = route.liveLocation || route.workLocation;
                  if (!startPoint) return null;
                  
                  // Create path: start -> job1 -> job2 -> ... -> jobN
                  const path = [
                    { lat: startPoint.lat, lng: startPoint.lng },
                    ...route.jobs.map(job => ({ lat: job.lat, lng: job.lng }))
                  ];
                  
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

              {/* Render markers for start points (real-time location) */}
              {routes.map((route) => {
                const startPoint = route.liveLocation || route.workLocation;
                if (!startPoint) return null;

                return (
                  <Marker
                    key={`start-${route.teammateId}`}
                    position={{ lat: startPoint.lat, lng: startPoint.lng }}
                    icon={{
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 10,
                      fillColor: route.routeColor,
                      fillOpacity: 1,
                      strokeColor: "#fff",
                      strokeWeight: 3,
                    }}
                    title={`${route.teammateName} - ${route.liveLocation ? "Live Location" : "Start"}`}
                  />
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
                      if (onJobAction) {
                        onJobAction(job.id, "view");
                      }
                    }}
                    title={`${job.title} - Available`}
                  />
                );
              })}
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

          {/* Legend - Top Right (Desktop) or Bottom (Mobile) */}
          {!isMobile ? (
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
          ) : (
            // Mobile legend - at bottom above routes list (adjusts with bottom sheet position)
            <div className={`absolute left-0 right-0 z-10 bg-background/95 backdrop-blur-sm border-t border-border shadow-lg px-3 py-2 transition-all ${
              bottomSheetPosition === "collapsed" 
                ? "bottom-[60px]" 
                : bottomSheetPosition === "peek" 
                  ? "bottom-[240px]" 
                  : "bottom-0"
            }`}>
              <div className="text-xs font-semibold mb-2">Legend</div>
              <div className="flex gap-4 justify-center">
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="legend-accepted-mobile"
                    checked={showAcceptedJobs}
                    onCheckedChange={setShowAcceptedJobs}
                  />
                  <Label htmlFor="legend-accepted-mobile" className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span>Accepted</span>
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="legend-pending-mobile"
                    checked={showPendingJobs}
                    onCheckedChange={setShowPendingJobs}
                  />
                  <Label htmlFor="legend-pending-mobile" className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <Circle className="w-3 h-3 text-yellow-500" />
                    <span>Pending</span>
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="legend-available-mobile"
                    checked={showAvailableJobs}
                    onCheckedChange={setShowAvailableJobs}
                  />
                  <Label htmlFor="legend-available-mobile" className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <Zap className="w-3 h-3 text-amber-500" />
                    <span>Available</span>
                  </Label>
                </div>
              </div>
            </div>
          )}

          {/* Teammate Filter - Below Legend (Desktop only) */}
          {!isMobile && (
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
        </div>

        {/* Routes List - Bottom Sheet (like find page) */}
        <div 
          className={`absolute left-0 right-0 bg-background shadow-2xl border-t transition-all ease-out ${
            isDragging ? "duration-0" : "duration-300"
          } ${
            bottomSheetPosition === "full" ? "z-[100]" : "z-10"
          } ${
            bottomSheetPosition === "collapsed" 
              ? "bottom-0 h-[60px] rounded-t-3xl" 
              : bottomSheetPosition === "peek" 
                ? "bottom-0 h-[240px] rounded-t-3xl" 
                : "bottom-0 top-0 h-full rounded-t-none"
          }`}
          style={isDragging ? { 
            height: `calc(100% - ${Math.max(0, Math.min(window.innerHeight - 60, dragCurrentY))}px)`,
            borderTopLeftRadius: dragCurrentY < 60 ? 0 : undefined,
            borderTopRightRadius: dragCurrentY < 60 ? 0 : undefined,
          } : bottomSheetPosition === "full" ? {
            top: 0,
            height: '100%'
          } : undefined}
        >
          {/* Drag Handle */}
          <div 
            className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
            onTouchStart={(e) => {
              setIsDragging(true);
              setDragStartY(e.touches[0].clientY);
              setDragCurrentY(e.touches[0].clientY);
            }}
            onTouchMove={(e) => {
              if (isDragging) {
                setDragCurrentY(e.touches[0].clientY);
              }
            }}
            onTouchEnd={() => {
              if (isDragging) {
                const deltaY = dragCurrentY - dragStartY;
                const screenHeight = window.innerHeight;
                const currentPosition = dragCurrentY;
                
                if (currentPosition < screenHeight * 0.25) {
                  setBottomSheetPosition("full");
                } else if (currentPosition < screenHeight * 0.6) {
                  setBottomSheetPosition("peek");
                } else {
                  setBottomSheetPosition("collapsed");
                }
                setIsDragging(false);
              }
            }}
            onMouseDown={(e) => {
              setIsDragging(true);
              setDragStartY(e.clientY);
              setDragCurrentY(e.clientY);
            }}
            onMouseMove={(e) => {
              if (isDragging) {
                setDragCurrentY(e.clientY);
              }
            }}
            onMouseUp={() => {
              if (isDragging) {
                const screenHeight = window.innerHeight;
                const currentPosition = dragCurrentY;
                
                if (currentPosition < screenHeight * 0.25) {
                  setBottomSheetPosition("full");
                } else if (currentPosition < screenHeight * 0.6) {
                  setBottomSheetPosition("peek");
                } else {
                  setBottomSheetPosition("collapsed");
                }
                setIsDragging(false);
              }
            }}
            onMouseLeave={() => {
              if (isDragging) {
                const screenHeight = window.innerHeight;
                const currentPosition = dragCurrentY;
                
                if (currentPosition < screenHeight * 0.25) {
                  setBottomSheetPosition("full");
                } else if (currentPosition < screenHeight * 0.6) {
                  setBottomSheetPosition("peek");
                } else {
                  setBottomSheetPosition("collapsed");
                }
                setIsDragging(false);
              }
            }}
          >
            <div className="w-12 h-1.5 bg-muted-foreground/40 rounded-full" />
          </div>
          
          {/* Sheet Header */}
          <div className="px-4 pb-2 flex items-center justify-between border-b border-border/50">
            <h2 className="font-semibold text-sm">
              Routes for {format(selectedDate, "MMM d, yyyy")}
            </h2>
            {bottomSheetPosition === "full" && (
              <Button 
                variant="ghost" 
                size="icon"
                className="w-7 h-7"
                onClick={() => setBottomSheetPosition("peek")}
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Routes List */}
          <div className={`overflow-y-auto px-4 ${
            bottomSheetPosition === "collapsed" 
              ? "h-0 overflow-hidden pt-2" 
              : bottomSheetPosition === "peek"
                ? "h-[160px] pt-2"
                : "h-[calc(100%-80px)] pt-[calc(0.5rem+80px)]"
          }`}
          style={bottomSheetPosition === "full" ? { 
            scrollPaddingTop: '80px'
          } : {}}
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
                          mapRef.current.fitBounds(bounds);
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
                      
                      {/* Compact route list */}
                      <div className="space-y-0.5 mb-1.5 ml-7">
                        {route.jobs.slice(0, 2).map((job) => (
                          <div key={job.jobId} className="flex items-center gap-1.5 text-[10px]">
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
                          <div className="text-[10px] text-muted-foreground ml-2.5">
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
                            className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"
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
        </div>
      </div>
    );
  }

  // Desktop layout: Full map with overlay controls
  return (
    <div className="w-full relative" style={{ height }}>
      {/* Map Section - Full Width */}
      <div className="w-full h-full relative">
        {!isLoaded ? (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Skeleton className="w-full h-full" />
          </div>
        ) : (
          <GoogleMap
            mapContainerStyle={{ width: "100%", height: "100%" }}
            center={{ lat: 37.7749, lng: -122.4194 }}
            zoom={10}
            onLoad={onMapLoad}
            options={{
              styles: mapStyles,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
            }}
          >
            {/* Render routes with directions */}
            {routes
              .filter((route) => route.route !== null)
              .map((route) => (
                <DirectionsRenderer
                  key={route.teammateId}
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

            {/* Render simple polylines for routes without directions (fallback) */}
            {routes
              .filter((route) => route.route === null && route.jobs.length > 0)
              .map((route) => {
                const startPoint = route.liveLocation || route.workLocation;
                if (!startPoint) return null;
                
                // Create path: start -> job1 -> job2 -> ... -> jobN
                const path = [
                  { lat: startPoint.lat, lng: startPoint.lng },
                  ...route.jobs.map(job => ({ lat: job.lat, lng: job.lng }))
                ];
                
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

            {/* Render markers for start points (real-time location) for routes - using avatars */}
            {routes.map((route) => {
              const startPoint = route.liveLocation || route.workLocation;
              if (!startPoint) return null;

              // Create avatar icon - convert to full URL if needed
              const avatarUrl = route.teammateAvatar 
                ? (route.teammateAvatar.startsWith("http") 
                    ? route.teammateAvatar 
                    : `${window.location.origin}${route.teammateAvatar.startsWith("/") ? "" : "/"}${route.teammateAvatar}`)
                : null;
              const initials = route.teammateName
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);

              return (
                <Marker
                  key={`start-${route.teammateId}`}
                  position={{ lat: startPoint.lat, lng: startPoint.lng }}
                  icon={avatarUrl ? {
                    url: avatarUrl,
                    scaledSize: new google.maps.Size(40, 40),
                    anchor: new google.maps.Point(20, 20),
                  } : {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 10,
                    fillColor: route.routeColor,
                    fillOpacity: 1,
                    strokeColor: "#fff",
                    strokeWeight: 3,
                  }}
                  label={avatarUrl ? undefined : {
                    text: initials,
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: "bold",
                  }}
                  title={`${route.teammateName} - ${route.liveLocation ? "Live Location" : "Start"}`}
                />
              );
            })}

            {/* Render markers for ALL enabled teammates (even without routes) - using avatars */}
            {teammates
              .filter(teammate => enabledTeammates.has(teammate.id))
              .filter(teammate => !routes.some(r => r.teammateId === teammate.id))
              .map((teammate) => {
                // Use same priority logic as route building:
                // 1. Live location (real-time GPS)
                // 2. Work location coordinates
                // 3. Geocoded address from cache
                let startPoint = (teammate.liveLocationLat && teammate.liveLocationLng) 
                  ? { lat: teammate.liveLocationLat, lng: teammate.liveLocationLng }
                  : (teammate.workLocationLat && teammate.workLocationLng)
                    ? { lat: teammate.workLocationLat, lng: teammate.workLocationLng }
                    : null;
                
                // If no coordinates but has address, try geocoded cache
                if (!startPoint && teammate.workLocationAddress) {
                  const geocoded = geocodedAddressesRef.current.get(teammate.workLocationAddress);
                  if (geocoded) {
                    startPoint = geocoded;
                  } else {
                    // Address not yet geocoded - skip for now (will be geocoded during route building)
                    return null;
                  }
                }
                
                // Fallback to worker profile address/coordinates if teammate has no location
                if (!startPoint && workerProfile) {
                  if (workerProfile.latitude && workerProfile.longitude) {
                    startPoint = {
                      lat: parseFloat(workerProfile.latitude),
                      lng: parseFloat(workerProfile.longitude),
                    };
                    console.log(`📍 Using worker profile coordinates for ${teammate.firstName} ${teammate.lastName} marker: ${startPoint.lat}, ${startPoint.lng}`);
                  } else if (workerProfile.address) {
                    const workerAddress = `${workerProfile.address}${workerProfile.city ? `, ${workerProfile.city}` : ""}${workerProfile.state ? `, ${workerProfile.state}` : ""}`;
                    const geocoded = geocodedAddressesRef.current.get(workerAddress);
                    if (geocoded) {
                      startPoint = geocoded;
                      console.log(`📍 Using geocoded worker profile address for ${teammate.firstName} ${teammate.lastName} marker: ${startPoint.lat}, ${startPoint.lng}`);
                    } else {
                      // Address not yet geocoded - will be geocoded during route building
                      return null;
                    }
                  }
                }
                
                if (!startPoint) {
                  // No location or address available - skip marker
                  console.warn(`⚠️ No location or address for teammate ${teammate.firstName} ${teammate.lastName} (ID: ${teammate.id}) and no worker profile fallback`);
                  return null;
                }

                const initials = `${teammate.firstName[0]}${teammate.lastName[0]}`.toUpperCase();
                const avatarUrl = teammate.avatarUrl 
                  ? (teammate.avatarUrl.startsWith("http") 
                      ? teammate.avatarUrl 
                      : `${window.location.origin}${teammate.avatarUrl.startsWith("/") ? "" : "/"}${teammate.avatarUrl}`)
                  : null;
                return (
                  <Marker
                    key={`teammate-${teammate.id}`}
                    position={startPoint}
                    icon={avatarUrl ? {
                      url: avatarUrl,
                      scaledSize: new google.maps.Size(36, 36),
                      anchor: new google.maps.Point(18, 18),
                    } : {
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 8,
                      fillColor: "#94a3b8",
                      fillOpacity: 0.7,
                      strokeColor: "#fff",
                      strokeWeight: 2,
                    }}
                    label={avatarUrl ? undefined : {
                      text: initials,
                      color: "#fff",
                      fontSize: "10px",
                      fontWeight: "bold",
                    }}
                    title={`${teammate.firstName} ${teammate.lastName} - ${teammate.liveLocationLat ? "Live Location" : "Work Location"}${routes.length === 0 ? " (No jobs today)" : ""}`}
                  />
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
                    if (onJobAction) {
                      onJobAction(job.id, "view");
                    }
                  }}
                  title={`${job.title} - Available`}
                />
              );
            })}

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
                  <div className="p-2 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-2">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={route.teammateAvatar || undefined} />
                        <AvatarFallback>
                          {route.teammateName
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold text-sm">{route.teammateName}</p>
                        {route.totalDistance && route.totalDuration && (
                          <p className="text-xs text-muted-foreground">
                            {route.totalDistance} • {route.totalDuration}
                          </p>
                        )}
                      </div>
                    </div>
                    <Separator className="my-2" />
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <p className="font-medium text-sm flex-1">{jobStop.jobTitle}</p>
                        {jobStop.isCurrent && (
                          <Badge variant={jobStop.isBehind ? "destructive" : "default"} className="text-xs">
                            {jobStop.isBehind ? (
                              <>
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Behind
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Current
                              </>
                            )}
                          </Badge>
                        )}
                        {jobStop.isNext && (
                          <Badge variant="outline" className="text-xs">
                            <Circle className="w-3 h-3 mr-1" />
                            Next
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {jobStop.address}
                      </p>
                      <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(jobStop.scheduledStart, "h:mm a")} - {format(jobStop.scheduledEnd, "h:mm a")}
                      </p>
                      {jobStop.isBehind && jobStop.isCurrent && (
                        <p className="text-xs text-destructive font-medium">
                          Running {Math.round((new Date().getTime() - jobStop.scheduledStart.getTime()) / (1000 * 60))} minutes late
                        </p>
                      )}
                      {onJobAction && (
                        <div className="flex gap-1 mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs flex-1"
                            onClick={() => {
                              onJobAction(jobStop.jobId, "view");
                              setSelectedJobId(null);
                            }}
                          >
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs flex-1"
                            onClick={() => {
                              onJobAction(jobStop.jobId, "directions");
                              setSelectedJobId(null);
                            }}
                          >
                            <MapIcon className="w-3 h-3 mr-1" />
                            Route
                          </Button>
                        </div>
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
                    <div className="p-2 min-w-[200px]">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="border-purple-500 text-purple-700 dark:text-purple-400">
                          Unassigned
                        </Badge>
                        <p className="font-semibold text-sm flex-1">{unassignedJob.jobTitle}</p>
                      </div>
                      <Separator className="my-2" />
                      <div>
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {unassignedJob.address}
                        </p>
                        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(scheduledStart, "h:mm a")} - {format(scheduledEnd, "h:mm a")}
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Status: <Badge variant="outline" className="text-xs">{unassignedJob.status}</Badge>
                        </p>
                        {onJobAction && (
                          <div className="flex gap-1 mt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs flex-1"
                              onClick={() => {
                                onJobAction(unassignedJob.jobId, "view");
                                setSelectedJobId(null);
                              }}
                            >
                              View
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </InfoWindow>
                );
              } else if (availableJob) {
                const lat = availableJob.latitude ? parseFloat(availableJob.latitude) : null;
                const lng = availableJob.longitude ? parseFloat(availableJob.longitude) : null;
                if (!lat || !lng) return null;

                return (
                  <InfoWindow
                    key={`info-available-${selectedJobId}`}
                    position={{ lat, lng }}
                    onCloseClick={() => setSelectedJobId(null)}
                  >
                    <div className="p-2 min-w-[200px]">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                          Available
                        </Badge>
                        <p className="font-semibold text-sm flex-1">{availableJob.title}</p>
                      </div>
                      <Separator className="my-2" />
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {availableJob.address || availableJob.location || "Address not provided"}
                        </p>
                        {availableJob.scheduledTime && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                            <Clock className="w-3 h-3" />
                            <span>{availableJob.scheduledTime}</span>
                          </div>
                        )}
                        {availableJob.hourlyRate && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <DollarSign className="w-3 h-3" />
                            <span>${(availableJob.hourlyRate / 100).toFixed(2)}/hr</span>
                          </div>
                        )}
                        {onJobAction && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-2"
                            onClick={() => {
                              onJobAction(availableJob.id, "view");
                              setSelectedJobId(null);
                            }}
                          >
                            View Job
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
      </div>

      {/* Desktop Bottom Panel - Routes Table */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-background border-t border-border shadow-2xl transition-all duration-300 z-20 ${
          desktopPanelExpanded ? "h-[400px]" : "h-[60px]"
        }`}
      >
        {/* Panel Header with Expand/Collapse Button */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <TableIcon className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">
              Routes for {format(selectedDate, "MMM d, yyyy")}
            </h3>
            <Badge variant="secondary" className="text-xs">
              {routes.length} {routes.length === 1 ? "route" : "routes"}
            </Badge>
          </div>
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

        {/* Panel Content - Table */}
        {desktopPanelExpanded && (
          <div className="h-[340px] overflow-auto">
            {routes.length === 0 && filteredAvailableJobs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No routes available for this date
              </div>
            ) : (
              <div className="p-4">
                {routes.length > 0 ? (
                  <TableComponent>
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
                      {routes.map((route) => {
                    const teammate = teammates.find((t) => t.id === route.teammateId);
                    const currentJob = route.jobs.find((j) => j.isCurrent);
                    const nextJob = route.jobs.find((j) => j.isNext);
                    const behindJobs = route.jobs.filter((j) => j.isBehind);

                    return (
                      <TableRow
                        key={route.teammateId}
                        className="cursor-pointer hover:bg-muted/50"
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
                            mapRef.current.fitBounds(bounds);
                          }
                        }}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="w-6 h-6">
                              <AvatarImage src={route.teammateAvatar || undefined} />
                              <AvatarFallback className="text-xs">
                                {route.teammateName
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium">{route.teammateName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {route.jobs.length}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {route.jobs.slice(0, 3).map((job, idx) => (
                              <div key={job.jobId} className="flex items-center gap-2 text-xs">
                                <div
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: route.routeColor }}
                                />
                                <span className="truncate flex-1">
                                  {job.sequence}. {job.jobTitle}
                                </span>
                                {job.isCurrent && (
                                  <Badge variant="default" className="text-[10px] px-1.5 py-0">
                                    Current
                                  </Badge>
                                )}
                                {job.isNext && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    Next
                                  </Badge>
                                )}
                              </div>
                            ))}
                            {route.jobs.length > 3 && (
                              <span className="text-xs text-muted-foreground ml-4">
                                +{route.jobs.length - 3} more
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {route.totalDistance || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {route.totalDuration || "—"}
                        </TableCell>
                        <TableCell>
                          {behindJobs.length > 0 ? (
                            <Badge variant="destructive" className="text-xs">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Behind
                            </Badge>
                          ) : currentJob ? (
                            <Badge variant="default" className="text-xs">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              On Time
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              Scheduled
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                    </TableBody>
                  </TableComponent>
                ) : null}
                
                {/* Available Jobs Section for Desktop */}
                {filteredAvailableJobs.length > 0 ? (
                  <div className={`mt-4 pt-4 border-t ${routes.length > 0 ? '' : ''}`}>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-500" />
                      Available Jobs ({filteredAvailableJobs.length})
                    </h3>
                    <div className="space-y-2">
                      {filteredAvailableJobs.map((job) => (
                        <div
                          key={job.id}
                          className="p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 dark:text-amber-400">
                                  Available
                                </Badge>
                                <span className="text-sm font-medium truncate">{job.title}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {job.address && `${job.address}, ${job.city || ""} ${job.state || ""}`}
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
                                    if (onAddJobToRoute) {
                                      onAddJobToRoute(job.id, teammate.id);
                                    } else if (onJobAction) {
                                      onJobAction(job.id, "add-to-route");
                                    }
                                  }}
                                >
                                  <Avatar className="w-3 h-3 mr-1">
                                    <AvatarImage src={teammate.avatarUrl || undefined} />
                                    <AvatarFallback className="text-[7px]">
                                      {teammate.firstName[0]}{teammate.lastName[0]}
                                    </AvatarFallback>
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
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
