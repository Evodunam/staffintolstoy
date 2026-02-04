import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { GoogleMap, useJsApiLoader, Marker, InfoWindow, OverlayView, DirectionsRenderer, Circle } from "@react-google-maps/api";
import type { Job } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { GOOGLE_MAPS_LOADER_ID, GOOGLE_MAPS_LIBRARIES } from "@/lib/google-maps";
import { MapPin, Clock, DollarSign, Home, Users, Activity } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface JobPin {
  id: number;
  lat: number;
  lng: number;
  title: string;
  trade?: string;
  hourlyRate?: number;
  city?: string;
  state?: string;
  urgencyColor?: string;
  payout?: string;
  startDate?: string;
  status?: "open" | "pending" | "confirmed";
  application?: any | null;
}

export interface PersonLocation {
  id: number | string;
  lat: number;
  lng: number;
  name: string;
  avatarUrl?: string | null;
  type: "worker" | "teammate" | "active";
  role?: string;
  jobTitle?: string;
}

interface JobsMapProps {
  jobs: JobPin[];
  workerLocation?: { lat: number; lng: number };
  workerAvatar?: string | null;
  workerName?: string;
  teammates?: PersonLocation[];
  activeClockIns?: PersonLocation[];
  selectedJobId?: number;
  onJobSelect?: (jobId: number) => void;
  onPersonSelect?: (person: PersonLocation) => void;
  onBoundsChanged?: (bounds: { north: number; south: number; east: number; west: number } | null) => void;
  height?: string;
  className?: string;
  showMiniInfo?: boolean;
  showPersonMarkers?: boolean;
  showPricePills?: boolean;
}

const mapStyles = [
  {
    featureType: "poi",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
];

function AvatarPin({ person, onClick }: { person: PersonLocation; onClick?: () => void }) {
  const getBackgroundColor = () => {
    switch (person.type) {
      case "worker": return "bg-emerald-500";
      case "teammate": return "bg-blue-500";
      case "active": return "bg-orange-500";
      default: return "bg-gray-500";
    }
  };

  const getBorderColor = () => {
    switch (person.type) {
      case "worker": return "border-emerald-600";
      case "teammate": return "border-blue-600";
      case "active": return "border-orange-600";
      default: return "border-gray-600";
    }
  };

  const getIcon = () => {
    switch (person.type) {
      case "worker": return <Home className="w-3 h-3 text-white" />;
      case "teammate": return <Users className="w-3 h-3 text-white" />;
      case "active": return <Activity className="w-3 h-3 text-white" />;
      default: return null;
    }
  };

  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div 
      className="flex flex-col items-center cursor-pointer transform -translate-x-1/2 -translate-y-full"
      onClick={onClick}
      data-testid={`avatar-pin-${person.type}-${person.id}`}
    >
      <div className={`relative rounded-full ${getBackgroundColor()} p-0.5 shadow-lg`}>
        <Avatar className={`w-8 h-8 border-2 ${getBorderColor()}`}>
          {person.avatarUrl ? (
            <AvatarImage src={person.avatarUrl} alt={person.name} />
          ) : null}
          <AvatarFallback className="text-xs font-semibold bg-white text-gray-800">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className={`absolute -bottom-1 -right-1 w-4 h-4 ${getBackgroundColor()} rounded-full flex items-center justify-center shadow-sm`}>
          {getIcon()}
        </div>
      </div>
      <div className={`w-2 h-2 ${getBackgroundColor()} rotate-45 -mt-1`} />
    </div>
  );
}

function PricePillMarker({ 
  job, 
  isSelected, 
  onClick 
}: { 
  job: JobPin; 
  isSelected?: boolean;
  onClick?: () => void;
}) {
  const getStatusStyles = () => {
    if (job.status === "pending") return "bg-yellow-500 border-yellow-600";
    if (job.status === "confirmed") return "bg-green-500 border-green-600";
    if (job.urgencyColor) {
      if (job.urgencyColor.includes("red")) return "bg-red-500 border-red-600";
      if (job.urgencyColor.includes("orange")) return "bg-orange-500 border-orange-600";
      if (job.urgencyColor.includes("yellow")) return "bg-yellow-500 border-yellow-600";
      if (job.urgencyColor.includes("green")) return "bg-green-500 border-green-600";
    }
    return "bg-primary border-primary";
  };

  const getArrowColor = () => {
    if (job.status === "pending") return "bg-yellow-500";
    if (job.status === "confirmed") return "bg-green-500";
    if (job.urgencyColor?.includes("red")) return "bg-red-500";
    if (job.urgencyColor?.includes("orange")) return "bg-orange-500";
    if (job.urgencyColor?.includes("yellow")) return "bg-yellow-500";
    if (job.urgencyColor?.includes("green")) return "bg-green-500";
    return "bg-primary";
  };

  const displayPrice = job.payout || (job.hourlyRate ? `$${(job.hourlyRate / 100).toFixed(0)}` : "$--");

  return (
    <div 
      className="flex flex-col items-center cursor-pointer transform -translate-x-1/2 -translate-y-full"
      onClick={onClick}
      data-testid={`price-pill-${job.id}`}
    >
      <div 
        className={`
          px-2 py-1 rounded-lg shadow-lg border-2 transition-all duration-200
          ${isSelected 
            ? "scale-125 z-50 ring-2 ring-white bg-primary border-primary" 
            : getStatusStyles()
          }
        `}
      >
        <span className="text-white font-bold text-xs whitespace-nowrap">
          {displayPrice}
        </span>
      </div>
      <div 
        className={`w-2 h-2 rotate-45 -mt-1 ${isSelected ? "bg-primary" : getArrowColor()}`} 
      />
    </div>
  );
}

export function JobsMap({
  jobs,
  workerLocation,
  workerAvatar,
  workerName = "You",
  teammates = [],
  activeClockIns = [],
  selectedJobId,
  onJobSelect,
  onPersonSelect,
  onBoundsChanged,
  height = "400px",
  className = "",
  showMiniInfo = true,
  showPersonMarkers = false,
  showPricePills = false,
}: JobsMapProps) {
  const [hoveredJob, setHoveredJob] = useState<number | null>(null);
  const [hoveredPerson, setHoveredPerson] = useState<PersonLocation | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || "";
  
  const { isLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Prioritize worker location, then job center, then a sensible US default
  const center = useMemo(() => {
    // First priority: worker's location
    if (workerLocation) {
      return workerLocation;
    }
    // Second priority: center on jobs if available
    if (jobs.length > 0) {
      const avgLat = jobs.reduce((acc, job) => acc + job.lat, 0) / jobs.length;
      const avgLng = jobs.reduce((acc, job) => acc + job.lng, 0) / jobs.length;
      return { lat: avgLat, lng: avgLng };
    }
    // Default fallback - central US
    return { lat: 39.8283, lng: -98.5795 };
  }, [jobs, workerLocation]);

  const allPersonLocations = useMemo(() => {
    const locations: PersonLocation[] = [];
    
    if (workerLocation && showPersonMarkers) {
      locations.push({
        id: "worker",
        lat: workerLocation.lat,
        lng: workerLocation.lng,
        name: workerName,
        avatarUrl: workerAvatar,
        type: "worker",
      });
    }
    
    if (showPersonMarkers) {
      teammates.forEach(t => locations.push(t));
      activeClockIns.forEach(a => locations.push(a));
    }
    
    return locations;
  }, [workerLocation, workerAvatar, workerName, teammates, activeClockIns, showPersonMarkers]);

  const bounds = useMemo(() => {
    if (!isLoaded) return undefined;
    
    const hasJobs = jobs.length > 0;
    const hasPersons = allPersonLocations.length > 0;
    
    if (!hasJobs && !hasPersons) return undefined;
    if (!hasJobs && workerLocation && !showPersonMarkers) return undefined;
    
    const b = new google.maps.LatLngBounds();
    jobs.forEach(job => b.extend({ lat: job.lat, lng: job.lng }));
    
    // Include worker location in bounds if available
    if (workerLocation) b.extend(workerLocation);
    
    // Include all person locations in bounds
    allPersonLocations.forEach(person => {
      if (person.lat && person.lng && !isNaN(person.lat) && !isNaN(person.lng)) {
        b.extend({ lat: person.lat, lng: person.lng });
      }
    });
    
    return b;
  }, [jobs, workerLocation, allPersonLocations, isLoaded, showPersonMarkers]);

  // Debounced hover handlers to prevent flickering
  const handleMouseOver = useCallback((jobId: number) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredJob(jobId);
  }, []);

  const handleMouseOut = useCallback(() => {
    // Small delay before clearing hover to prevent flickering
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredJob(null);
    }, 100);
  }, []);

  const getJobMarkerIcon = (job: JobPin) => {
    const isSelected = job.id === selectedJobId;
    const isHovered = job.id === hoveredJob;
    const hasApplication = !!job.application;
    const isAccepted = job.status === "confirmed";
    const isPending = job.status === "pending";
    
    // Different colors based on application status
    let fillColor = "#6366f1"; // Default blue
    if (isAccepted) {
      fillColor = "#22c55e"; // Green for accepted
    } else if (isPending) {
      fillColor = "#f59e0b"; // Amber for pending
    } else if (hasApplication) {
      fillColor = "#8b5cf6"; // Purple for applied
    }
    
    if (isSelected) fillColor = "#f59e0b"; // Orange when selected
    if (isHovered && !isSelected) fillColor = "#3b82f6"; // Blue when hovered
    
    return {
      path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
      fillColor,
      fillOpacity: 1,
      strokeWeight: isSelected || isHovered ? 2 : 1,
      strokeColor: "#ffffff",
      scale: isSelected ? 2 : isHovered ? 1.8 : 1.5,
      anchor: { x: 12, y: 24 } as google.maps.Point,
    };
  };

  const getWorkerMarkerIcon = () => ({
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: "#22c55e",
    fillOpacity: 1,
    strokeWeight: 3,
    strokeColor: "#ffffff",
    scale: 10,
  });

  const formatRate = (cents: number) => {
    return `$${(cents / 100).toFixed(0)}/hr`;
  };

  // Track map bounds changes
  const mapRef = useRef<google.maps.Map | null>(null);
  const boundsChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUserInteractingRef = useRef(false);

  const handleBoundsChanged = useCallback(() => {
    if (!mapRef.current || !onBoundsChanged) return;
    
    // Only update bounds if user is not actively interacting
    if (isUserInteractingRef.current) return;
    
    // Debounce bounds changes to avoid too many updates
    if (boundsChangeTimeoutRef.current) {
      clearTimeout(boundsChangeTimeoutRef.current);
    }
    
    boundsChangeTimeoutRef.current = setTimeout(() => {
      // Double-check user is not interacting
      if (isUserInteractingRef.current) return;
      
      const bounds = mapRef.current?.getBounds();
      if (bounds) {
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        onBoundsChanged({
          north: ne.lat(),
          south: sw.lat(),
          east: ne.lng(),
          west: sw.lng(),
        });
      } else {
        onBoundsChanged(null);
      }
    }, 500); // 500ms debounce - only updates well after user finishes interaction
  }, [onBoundsChanged]);

  const handleDragStart = useCallback(() => {
    isUserInteractingRef.current = true;
  }, []);

  const handleDragEnd = useCallback(() => {
    isUserInteractingRef.current = false;
    // Wait a bit before updating bounds to ensure user has finished
    setTimeout(() => {
      if (!isUserInteractingRef.current) {
        handleBoundsChanged();
      }
    }, 200);
  }, [handleBoundsChanged]);

  const handleZoomStart = useCallback(() => {
    isUserInteractingRef.current = true;
  }, []);

  const handleZoomChanged = useCallback(() => {
    // onZoomChanged fires continuously during zoom, so we need to debounce it heavily
    // Only update after user has stopped zooming for a while
    if (boundsChangeTimeoutRef.current) {
      clearTimeout(boundsChangeTimeoutRef.current);
    }
    
    // Set interacting flag during zoom
    isUserInteractingRef.current = true;
    
    boundsChangeTimeoutRef.current = setTimeout(() => {
      // Clear interacting flag after delay
      isUserInteractingRef.current = false;
      
      // Only update if callback exists and map is available
      if (mapRef.current && onBoundsChanged) {
        const bounds = mapRef.current.getBounds();
        if (bounds) {
          const ne = bounds.getNorthEast();
          const sw = bounds.getSouthWest();
          onBoundsChanged({
            north: ne.lat(),
            south: sw.lat(),
            east: ne.lng(),
            west: sw.lng(),
          });
        }
      }
    }, 1000); // 1 second delay - only updates well after user stops zooming
  }, [onBoundsChanged]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (boundsChangeTimeoutRef.current) {
        clearTimeout(boundsChangeTimeoutRef.current);
      }
    };
  }, []);

  if (loadError) {
    return (
      <div className={`flex items-center justify-center bg-muted rounded-md ${className}`} style={{ height }}>
        <p className="text-sm text-muted-foreground">Failed to load map</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className={`flex items-center justify-center bg-muted rounded-md animate-pulse ${className}`} style={{ height }}>
        <p className="text-sm text-muted-foreground">Loading map...</p>
      </div>
    );
  }

  return (
    <div className={className} style={{ height }}>
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "100%" }}
        center={center}
        zoom={11}
        options={{
          styles: mapStyles,
          disableDefaultUI: true,
          zoomControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "cooperative",
        }}
        onLoad={(map) => {
          mapRef.current = map;
          // Only fit bounds on initial load if map doesn't have bounds yet
          const currentBounds = map.getBounds();
          if (bounds && jobs.length > 1 && (!currentBounds || currentBounds.isEmpty())) {
            map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
          }
          // Initial bounds update only if callback exists
          if (onBoundsChanged) {
            setTimeout(() => {
              if (!isUserInteractingRef.current && mapRef.current) {
                handleBoundsChanged();
              }
            }, 100);
          }
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onZoomStart={handleZoomStart}
        onZoomChanged={handleZoomChanged}
      >
        {workerLocation && !showPersonMarkers && (
          <Marker
            position={workerLocation}
            icon={getWorkerMarkerIcon()}
            zIndex={1000}
          />
        )}

        {showPersonMarkers && allPersonLocations.map((person) => (
          person.lat && person.lng && !isNaN(person.lat) && !isNaN(person.lng) ? (
            <OverlayView
              key={`person-${person.type}-${person.id}`}
              position={{ lat: person.lat, lng: person.lng }}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            >
              <AvatarPin
                person={person}
                onClick={() => {
                  setHoveredPerson(person);
                  onPersonSelect?.(person);
                }}
              />
            </OverlayView>
          ) : null
        ))}

        {showPersonMarkers && hoveredPerson && (
          <InfoWindow
            position={{ lat: hoveredPerson.lat, lng: hoveredPerson.lng }}
            onCloseClick={() => setHoveredPerson(null)}
            options={{
              disableAutoPan: false,
              pixelOffset: new google.maps.Size(0, -45),
            }}
          >
            <div className="p-2 min-w-[120px] max-w-[200px]">
              <p className="font-medium text-sm break-words">{hoveredPerson.name}</p>
              {hoveredPerson.type === "active" && hoveredPerson.jobTitle && (
                <p className="text-xs text-orange-600 break-words">Working: {hoveredPerson.jobTitle}</p>
              )}
              {hoveredPerson.type === "teammate" && (
                <p className="text-xs text-blue-600">Team Member</p>
              )}
              {hoveredPerson.type === "worker" && (
                <p className="text-xs text-emerald-600">Your Location</p>
              )}
              {hoveredPerson.role && (
                <p className="text-xs text-gray-500 break-words">{hoveredPerson.role}</p>
              )}
            </div>
          </InfoWindow>
        )}

        {showPricePills ? (
          jobs.map((job) => (
            <OverlayView
              key={`price-${job.id}`}
              position={{ lat: job.lat, lng: job.lng }}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            >
              <PricePillMarker
                job={job}
                isSelected={job.id === selectedJobId}
                onClick={() => onJobSelect?.(job.id)}
              />
            </OverlayView>
          ))
        ) : (
          jobs.map((job) => (
            <Marker
              key={job.id}
              position={{ lat: job.lat, lng: job.lng }}
              icon={getJobMarkerIcon(job)}
              onClick={() => onJobSelect?.(job.id)}
              onMouseOver={() => handleMouseOver(job.id)}
              onMouseOut={handleMouseOut}
              zIndex={job.id === selectedJobId ? 999 : job.id === hoveredJob ? 998 : 1}
            />
          ))
        )}

        {showMiniInfo && hoveredJob && (() => {
          const hoveredJobData = jobs.find(j => j.id === hoveredJob);
          if (!hoveredJobData) return null;
          const hasApplication = !!hoveredJobData.application;
          const isAccepted = hoveredJobData.status === "confirmed";
          const isPending = hoveredJobData.status === "pending";
          return (
            <InfoWindow
              position={{ lat: hoveredJobData.lat + 0.003, lng: hoveredJobData.lng }}
              options={{
                disableAutoPan: true,
                pixelOffset: new google.maps.Size(0, -35),
              }}
            >
              <div 
                className="p-1 min-w-[150px] max-w-[200px]"
                onMouseEnter={() => handleMouseOver(hoveredJob)}
                onMouseLeave={handleMouseOut}
              >
                <p className="font-medium text-sm break-words">{hoveredJobData.title}</p>
                {hoveredJobData.trade && <p className="text-xs text-gray-600 break-words">{hoveredJobData.trade}</p>}
                {hoveredJobData.hourlyRate && (
                  <p className="text-xs text-green-600 font-medium">
                    {formatRate(hoveredJobData.hourlyRate)}
                  </p>
                )}
                {(hoveredJobData.city || hoveredJobData.state) && (
                  <p className="text-xs text-gray-500 break-words">
                    {[hoveredJobData.city, hoveredJobData.state].filter(Boolean).join(", ")}
                  </p>
                )}
                {hasApplication && (
                  <p className={`text-xs font-medium mt-1 ${
                    isAccepted ? "text-green-600" : isPending ? "text-amber-600" : "text-purple-600"
                  }`}>
                    {isAccepted ? "✓ Accepted" : isPending ? "⏳ Pending" : "✓ Applied"}
                  </p>
                )}
              </div>
            </InfoWindow>
          );
        })()}
      </GoogleMap>
    </div>
  );
}

interface MiniJobMapProps {
  job: JobPin;
  className?: string;
  /** Height for map container e.g. "256px" or "100%". Default "120px". */
  height?: string;
  /** Partial address (no street numbers) e.g. "Gage St, Cincinnati, 45219". Shown in InfoWindow on pin. */
  partialAddress?: string | null;
  /** When true, show a radius circle indicating approximate location; full address when you win. */
  showApproximateRadius?: boolean;
  /** Note shown when showApproximateRadius, e.g. "Full address when you win". */
  approximateNote?: string;
  /** Workers/teammates to plot as avatar pins; show distance from job. */
  personLocations?: PersonLocation[];
}

const APPROXIMATE_RADIUS_METERS = 350;

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function MiniJobMapAvatarPin({
  person,
  distanceMiles,
  onHover,
}: {
  person: PersonLocation;
  distanceMiles: number;
  onHover: (over: boolean) => void;
}) {
  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      className="flex flex-col items-center transform -translate-x-1/2 -translate-y-full cursor-default"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={(e) => e.stopPropagation()}
      role="img"
      aria-label={`${person.name}, ${distanceMiles.toFixed(1)} mi from job`}
    >
      <div className="relative rounded-full ring-2 ring-white shadow-lg bg-muted overflow-hidden">
        <Avatar className="w-8 h-8">
          {person.avatarUrl ? (
            <AvatarImage src={person.avatarUrl} alt={person.name} />
          ) : null}
          <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="w-2 h-2 bg-muted-foreground/80 rotate-45 -mt-0.5" />
    </div>
  );
}

export function MiniJobMap({
  job,
  className = "",
  height = "120px",
  partialAddress,
  showApproximateRadius = false,
  approximateNote,
  personLocations = [],
}: MiniJobMapProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || "";
  const mapRef = useRef<google.maps.Map | null>(null);
  const [hoveredPerson, setHoveredPerson] = useState<PersonLocation | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const center = useMemo(() => ({ lat: job.lat, lng: job.lng }), [job.lat, job.lng]);

  const personsWithDistance = useMemo(() => {
    return personLocations
      .filter((p) => p.lat != null && p.lng != null && !Number.isNaN(p.lat) && !Number.isNaN(p.lng))
      .map((p) => ({ person: p, distanceMiles: haversineMiles(job.lat, job.lng, p.lat, p.lng) }));
  }, [job.lat, job.lng, personLocations]);

  const bounds = useMemo(() => {
    if (personsWithDistance.length === 0) return null;
    let minLat = job.lat;
    let maxLat = job.lat;
    let minLng = job.lng;
    let maxLng = job.lng;
    personsWithDistance.forEach(({ person }) => {
      minLat = Math.min(minLat, person.lat);
      maxLat = Math.max(maxLat, person.lat);
      minLng = Math.min(minLng, person.lng);
      maxLng = Math.max(maxLng, person.lng);
    });
    const pad = 0.008;
    return { minLat: minLat - pad, maxLat: maxLat + pad, minLng: minLng - pad, maxLng: maxLng + pad };
  }, [job.lat, job.lng, personsWithDistance]);

  useEffect(() => {
    if (!isLoaded || !bounds || !mapRef.current || !window.google) return;
    const b = new google.maps.LatLngBounds(
      { lat: bounds.minLat, lng: bounds.minLng },
      { lat: bounds.maxLat, lng: bounds.maxLng }
    );
    mapRef.current.fitBounds(b, { top: 24, right: 24, bottom: 24, left: 24 });
  }, [isLoaded, bounds]);

  if (loadError || !isLoaded) {
    return (
      <div className={`bg-muted rounded-md ${className}`} style={{ height }}>
        <div className="flex items-center justify-center h-full">
          <MapPin className="w-6 h-6 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className={className} style={{ height }}>
      <GoogleMap
        mapContainerStyle={{ width: "100%", height, borderRadius: "0.375rem" }}
        center={center}
        zoom={personsWithDistance.length > 0 ? 11 : 13}
        options={{
          disableDefaultUI: true,
          draggable: false,
          zoomControl: false,
          scrollwheel: false,
          disableDoubleClickZoom: true,
          styles: mapStyles,
        }}
        onLoad={(map) => { mapRef.current = map; }}
        onUnmount={() => { mapRef.current = null; }}
      >
        {showApproximateRadius && (
          <Circle
            center={center}
            radius={APPROXIMATE_RADIUS_METERS}
            options={{
              fillColor: "#6366f1",
              fillOpacity: 0.12,
              strokeColor: "#6366f1",
              strokeOpacity: 0.5,
              strokeWeight: 2,
              clickable: false,
            }}
          />
        )}
        <Marker
          position={center}
          icon={{
            path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
            fillColor: "#6366f1",
            fillOpacity: 1,
            strokeWeight: 1,
            strokeColor: "#ffffff",
            scale: 1.5,
            anchor: { x: 12, y: 24 } as google.maps.Point,
          }}
        />
        {partialAddress && !hoveredPerson && (
          <InfoWindow position={center} options={{ pixelOffset: new google.maps.Size(0, -24) }}>
            <div style={{ padding: "4px 6px", minWidth: "120px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600 }}>{partialAddress}</div>
              {showApproximateRadius && approximateNote && (
                <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>{approximateNote}</div>
              )}
            </div>
          </InfoWindow>
        )}
        {personsWithDistance.map(({ person, distanceMiles }) => (
          <OverlayView
            key={`person-${person.type}-${person.id}`}
            position={{ lat: person.lat, lng: person.lng }}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <MiniJobMapAvatarPin
              person={person}
              distanceMiles={distanceMiles}
              onHover={(over) => setHoveredPerson(over ? person : null)}
            />
          </OverlayView>
        ))}
        {hoveredPerson && (() => {
          const entry = personsWithDistance.find(
            (e) => e.person.id === hoveredPerson.id && e.person.type === hoveredPerson.type
          );
          const dist = entry?.distanceMiles ?? 0;
          return (
            <InfoWindow
              position={{ lat: hoveredPerson.lat, lng: hoveredPerson.lng }}
              onCloseClick={() => setHoveredPerson(null)}
              options={{ pixelOffset: new google.maps.Size(0, -36) }}
            >
              <div style={{ padding: "6px 8px", minWidth: "100px" }}>
                <p style={{ fontSize: "13px", fontWeight: 600 }}>{hoveredPerson.name}</p>
                <p style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                  {dist.toFixed(1)} mi from job
                </p>
              </div>
            </InfoWindow>
          );
        })()}
      </GoogleMap>
    </div>
  );
}

const JOB_MARKER_ICON = {
  path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  fillColor: "#6366f1",
  fillOpacity: 1,
  strokeWeight: 1,
  strokeColor: "#ffffff",
  scale: 1.5,
  anchor: { x: 12, y: 24 } as google.maps.Point,
};

const USER_MARKER_ICON = {
  path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  fillColor: "#3b82f6",
  fillOpacity: 1,
  strokeWeight: 1,
  strokeColor: "#ffffff",
  scale: 1.5,
  anchor: { x: 12, y: 24 } as google.maps.Point,
};

const ROUTE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

export interface JobLocationMapProps {
  job: { id: number; lat: number; lng: number; title: string };
  userLocation?: { lat: number; lng: number } | null;
  className?: string;
  height?: string;
  onClick?: () => void;
  /** Partial address (no street numbers) e.g. "Gage St, Cincinnati, 45219". Shown in InfoWindow on pin. */
  partialAddress?: string | null;
  /** When true, show a radius circle indicating approximate location; full address when you win. */
  showApproximateRadius?: boolean;
  /** Note shown when showApproximateRadius, e.g. "Full address when you win". */
  approximateNote?: string;
  /** Pin + radius only: no directions, no user marker, no InfoWindow/hover, larger radius. Use for gallery map. */
  pinAndRadiusOnly?: boolean;
  /** Radius in meters when pinAndRadiusOnly or showApproximateRadius. Default 350; use e.g. 1000 for pinAndRadiusOnly. */
  approximateRadiusMeters?: number;
  /** Worker + teammates to show as pins and routes to job (one route per person). */
  personLocations?: PersonLocation[];
}

/** Map showing job location; when userLocation provided, shows route from user to job. With personLocations, shows pins + routes for each. */
export function JobLocationMap({
  job,
  userLocation,
  className = "",
  height = "180px",
  onClick,
  partialAddress,
  showApproximateRadius = false,
  approximateNote,
  pinAndRadiusOnly = false,
  approximateRadiusMeters,
  personLocations = [],
}: JobLocationMapProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || "";
  const { isLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const mapRef = useRef<google.maps.Map | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [multiDirections, setMultiDirections] = useState<{ key: string; result: google.maps.DirectionsResult }[]>([]);

  const useMinimal = pinAndRadiusOnly;
  const effectiveUserLocation = useMinimal ? null : userLocation;
  const radiusM = approximateRadiusMeters ?? (useMinimal ? 1000 : APPROXIMATE_RADIUS_METERS);
  const showRadius = useMinimal || showApproximateRadius;
  const showInfoWindow = !useMinimal && !!partialAddress;

  const personsWithCoords = useMemo(
    () =>
      personLocations.filter(
        (p) => p.lat != null && p.lng != null && !Number.isNaN(p.lat) && !Number.isNaN(p.lng)
      ),
    [personLocations]
  );

  const center = useMemo(() => {
    if (personsWithCoords.length > 0) return { lat: job.lat, lng: job.lng };
    if (effectiveUserLocation && directions?.routes?.[0]?.bounds) {
      const b = directions.routes[0].bounds;
      const c = b.getCenter();
      return { lat: c.lat(), lng: c.lng() };
    }
    if (effectiveUserLocation) {
      return {
        lat: (job.lat + effectiveUserLocation.lat) / 2,
        lng: (job.lng + effectiveUserLocation.lng) / 2,
      };
    }
    return { lat: job.lat, lng: job.lng };
  }, [job.lat, job.lng, effectiveUserLocation, directions, personsWithCoords.length]);

  useEffect(() => {
    if (!isLoaded || !effectiveUserLocation || !window.google || personsWithCoords.length > 0) return;
    const service = new google.maps.DirectionsService();
    service.route(
      {
        origin: { lat: effectiveUserLocation.lat, lng: effectiveUserLocation.lng },
        destination: { lat: job.lat, lng: job.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          setDirections(result);
          const bounds = result.routes[0]?.bounds;
          if (bounds && mapRef.current) mapRef.current.fitBounds(bounds);
        }
      }
    );
  }, [isLoaded, job.lat, job.lng, effectiveUserLocation?.lat, effectiveUserLocation?.lng, personsWithCoords.length]);

  useEffect(() => {
    if (!isLoaded || !window.google || personsWithCoords.length === 0) {
      setMultiDirections([]);
      return;
    }
    const service = new google.maps.DirectionsService();
    const dest = { lat: job.lat, lng: job.lng };
    Promise.all(
      personsWithCoords.map((p) => {
        const key = `${p.type}-${p.id}`;
        return new Promise<{ key: string; result: google.maps.DirectionsResult } | null>(
          (resolve) => {
            service.route(
              {
                origin: { lat: p.lat, lng: p.lng },
                destination: dest,
                travelMode: google.maps.TravelMode.DRIVING,
              },
              (result, status) => {
                if (status === google.maps.DirectionsStatus.OK && result) {
                  resolve({ key, result });
                } else {
                  resolve(null);
                }
              }
            );
          }
        );
      })
    ).then((results) => {
      setMultiDirections(results.filter((r): r is NonNullable<typeof r> => r != null));
    });
  }, [isLoaded, job.lat, job.lng, personsWithCoords]);

  useEffect(() => {
    if (personsWithCoords.length > 0) return;
    const b = directions?.routes?.[0]?.bounds;
    if (b && mapRef.current) mapRef.current.fitBounds(b);
  }, [directions, personsWithCoords.length]);

  useEffect(() => {
    if (multiDirections.length === 0 || !mapRef.current || !window.google) return;
    const bounds = new google.maps.LatLngBounds();
    multiDirections.forEach(({ result }) => {
      const r = result.routes[0]?.bounds;
      if (r) bounds.union(r);
    });
    if (directions?.routes?.[0]?.bounds) bounds.union(directions.routes[0].bounds);
    bounds.extend({ lat: job.lat, lng: job.lng });
    personsWithCoords.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    mapRef.current.fitBounds(bounds, { top: 24, right: 24, bottom: 24, left: 24 });
  }, [multiDirections, directions, job.lat, job.lng, personsWithCoords]);

  if (loadError || !isLoaded) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`} style={{ height }}>
        <MapPin className="w-6 h-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ height }}
      role={onClick && !useMinimal ? "button" : undefined}
      onClick={onClick && !useMinimal ? onClick : undefined}
      onKeyDown={onClick && !useMinimal ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      tabIndex={onClick && !useMinimal ? 0 : undefined}
    >
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "100%", borderRadius: "0.5rem" }}
        center={center}
        zoom={useMinimal ? 13 : 12}
        options={{
          disableDefaultUI: true,
          draggable: false,
          zoomControl: false,
          scrollwheel: false,
          disableDoubleClickZoom: true,
          styles: mapStyles,
          gestureHandling: onClick && !useMinimal ? "auto" : "none",
        }}
        onLoad={(map) => { mapRef.current = map; }}
        onUnmount={() => { mapRef.current = null; }}
      >
        {showRadius && (
          <Circle
            center={{ lat: job.lat, lng: job.lng }}
            radius={radiusM}
            options={{
              fillColor: "#6366f1",
              fillOpacity: 0.12,
              strokeColor: "#6366f1",
              strokeOpacity: 0.5,
              strokeWeight: 2,
              clickable: false,
            }}
          />
        )}
        {!useMinimal && directions && (
          <DirectionsRenderer
            directions={directions}
            options={{
              suppressMarkers: true,
              polylineOptions: { strokeColor: "#6366f1", strokeWeight: 4 },
            }}
          />
        )}
        {multiDirections.map(({ key, result }, i) => (
          <DirectionsRenderer
            key={key}
            directions={result}
            options={{
              suppressMarkers: true,
              polylineOptions: {
                strokeColor: ROUTE_COLORS[i % ROUTE_COLORS.length],
                strokeWeight: 3,
                strokeOpacity: 0.9,
              },
            }}
          />
        ))}
        <Marker
          position={{ lat: job.lat, lng: job.lng }}
          icon={JOB_MARKER_ICON}
          options={useMinimal ? { clickable: false } : undefined}
        />
        {effectiveUserLocation && personsWithCoords.length === 0 && (
          <Marker position={{ lat: effectiveUserLocation.lat, lng: effectiveUserLocation.lng }} icon={USER_MARKER_ICON} />
        )}
        {personsWithCoords.map((person, i) => (
          <OverlayView
            key={`person-${person.type}-${person.id}`}
            position={{ lat: person.lat, lng: person.lng }}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div className="flex flex-col items-center cursor-default transform -translate-x-1/2 -translate-y-full">
              <div
                className="relative rounded-full ring-2 ring-white shadow-lg bg-muted overflow-hidden"
                style={{ width: 32, height: 32 }}
              >
                <Avatar className="w-8 h-8">
                  {person.avatarUrl ? (
                    <AvatarImage src={person.avatarUrl} alt={person.name} />
                  ) : null}
                  <AvatarFallback
                    className="text-xs font-semibold"
                    style={{
                      backgroundColor: person.type === "worker" ? "#3b82f6" : "#10b981",
                      color: "white",
                    }}
                  >
                    {person.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div
                className="w-2 h-2 rotate-45 -mt-0.5"
                style={{
                  backgroundColor: person.type === "worker" ? "#3b82f6" : "#10b981",
                }}
              />
            </div>
          </OverlayView>
        ))}
        {showInfoWindow && (
          <InfoWindow position={{ lat: job.lat, lng: job.lng }} options={{ pixelOffset: new google.maps.Size(0, -24) }}>
            <div style={{ padding: "4px 6px", minWidth: "120px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600 }}>{partialAddress}</div>
              {showApproximateRadius && approximateNote && (
                <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>{approximateNote}</div>
              )}
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  );
}
