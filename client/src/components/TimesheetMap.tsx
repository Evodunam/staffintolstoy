import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { GoogleMap, useJsApiLoader, InfoWindow, Polyline, OverlayView } from "@react-google-maps/api";
import { GOOGLE_MAPS_LOADER_ID, GOOGLE_MAPS_LIBRARIES } from "@/lib/google-maps";

interface TimesheetMapProps {
  jobSite?: { lat: number; lng: number; title: string };
  clockIn?: { lat: number; lng: number; time: string; distanceMeters: number };
  clockOut?: { lat: number; lng: number; time: string; distanceMeters: number };
  className?: string;
  height?: string;
  showLines?: boolean;
  /** Hide the legend below the map (pills are now inside the map as pins) */
  hideLegend?: boolean;
}

const containerStyle = {
  width: "100%",
  height: "300px",
};

const JOB_SITE_COLOR = "#3b82f6";
const CLOCK_IN_COLOR = "#22c55e";
const CLOCK_OUT_COLOR = "#ef4444";

/** Pill label rendered at a lat/lng on the map (the pin itself) */
function MapPillPin({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center cursor-pointer transform -translate-x-1/2 -translate-y-full"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <span
        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-white shadow-md border border-white/30 whitespace-nowrap"
        style={{ backgroundColor: color }}
      >
        {label}
      </span>
    </div>
  );
}

/** Unique pin positions for bounds (dedupe ~1m). */
function collectPinPoints(
  jobSite: TimesheetMapProps["jobSite"],
  clockIn: TimesheetMapProps["clockIn"],
  clockOut: TimesheetMapProps["clockOut"]
): google.maps.LatLngLiteral[] {
  const pts: google.maps.LatLngLiteral[] = [];
  const seen = new Set<string>();
  const add = (lat?: number, lng?: number) => {
    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return;
    const k = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (seen.has(k)) return;
    seen.add(k);
    pts.push({ lat, lng });
  };
  add(jobSite?.lat, jobSite?.lng);
  add(clockIn?.lat, clockIn?.lng);
  add(clockOut?.lat, clockOut?.lng);
  return pts;
}

function applyBoundsToMap(map: google.maps.Map, points: google.maps.LatLngLiteral[]) {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setCenter(points[0]);
    map.setZoom(16);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  points.forEach((p) => bounds.extend(p));
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const latSpan = Math.abs(ne.lat() - sw.lat());
  const lngSpan = Math.abs(ne.lng() - sw.lng());
  // Degenerate bounds (same spot) — avoid extreme zoom
  if (latSpan < 1e-6 && lngSpan < 1e-6) {
    map.setCenter(points[0]);
    map.setZoom(16);
    return;
  }
  map.fitBounds(bounds, { top: 36, right: 36, bottom: 36, left: 36 });
}

export function TimesheetMap({ jobSite, clockIn, clockOut, className, height = "300px", showLines = true, hideLegend = false }: TimesheetMapProps) {
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || "";
  
  const { isLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const pinPoints = useMemo(
    () => collectPinPoints(jobSite, clockIn, clockOut),
    [jobSite, clockIn, clockOut]
  );

  const center = jobSite 
    ? { lat: jobSite.lat, lng: jobSite.lng }
    : clockIn 
      ? { lat: clockIn.lat, lng: clockIn.lng }
      : { lat: 30.2672, lng: -97.7431 };

  const onMapLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      applyBoundsToMap(map, pinPoints);
    },
    [pinPoints]
  );

  useEffect(() => {
    if (!mapRef.current) return;
    applyBoundsToMap(mapRef.current, pinPoints);
  }, [pinPoints]);

  const formatDistance = (meters: number) => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1609.34).toFixed(2)} mi`;
  };

  const polylinePath: google.maps.LatLngLiteral[] = [];
  if (showLines) {
    if (clockIn) {
      polylinePath.push({ lat: clockIn.lat, lng: clockIn.lng });
    }
    if (jobSite) {
      polylinePath.push({ lat: jobSite.lat, lng: jobSite.lng });
    }
    if (clockOut) {
      polylinePath.push({ lat: clockOut.lat, lng: clockOut.lng });
    }
  }

  const polylineOptions = {
    strokeColor: "#6366f1",
    strokeOpacity: 0.8,
    strokeWeight: 3,
    geodesic: true,
  };

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
    <div className={className}>
      <GoogleMap
        mapContainerStyle={{ ...containerStyle, height }}
        center={center}
        onLoad={onMapLoad}
        options={{ mapTypeControl: false, streetViewControl: false }}
      >
        {showLines && polylinePath.length >= 2 && (
          <Polyline path={polylinePath} options={polylineOptions} />
        )}

        {jobSite && (
          <>
            <OverlayView
              position={{ lat: jobSite.lat, lng: jobSite.lng }}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            >
              <MapPillPin
                label="Job site"
                color={JOB_SITE_COLOR}
                onClick={() => setSelectedMarker("jobsite")}
              />
            </OverlayView>
            {selectedMarker === "jobsite" && (
              <InfoWindow
                position={{ lat: jobSite.lat, lng: jobSite.lng }}
                onCloseClick={() => setSelectedMarker(null)}
              >
                <div className="p-1">
                  <p className="font-medium text-sm">Job Site</p>
                  <p className="text-xs text-gray-600">{jobSite.title}</p>
                </div>
              </InfoWindow>
            )}
          </>
        )}

        {clockIn && (
          <>
            <OverlayView
              position={{ lat: clockIn.lat, lng: clockIn.lng }}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            >
              <MapPillPin
                label="Clock in"
                color={CLOCK_IN_COLOR}
                onClick={() => setSelectedMarker("clockin")}
              />
            </OverlayView>
            {selectedMarker === "clockin" && (
              <InfoWindow
                position={{ lat: clockIn.lat, lng: clockIn.lng }}
                onCloseClick={() => setSelectedMarker(null)}
              >
                <div className="p-1">
                  <p className="font-medium text-sm">Clock In</p>
                  <p className="text-xs text-gray-600">{clockIn.time}</p>
                  <p className="text-xs text-gray-600">
                    {formatDistance(clockIn.distanceMeters)} from job site
                  </p>
                </div>
              </InfoWindow>
            )}
          </>
        )}

        {clockOut && (
          <>
            <OverlayView
              position={{ lat: clockOut.lat, lng: clockOut.lng }}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            >
              <MapPillPin
                label="Clock out"
                color={CLOCK_OUT_COLOR}
                onClick={() => setSelectedMarker("clockout")}
              />
            </OverlayView>
            {selectedMarker === "clockout" && (
              <InfoWindow
                position={{ lat: clockOut.lat, lng: clockOut.lng }}
                onCloseClick={() => setSelectedMarker(null)}
              >
                <div className="p-1">
                  <p className="font-medium text-sm">Clock Out</p>
                  <p className="text-xs text-gray-600">{clockOut.time}</p>
                  <p className="text-xs text-gray-600">
                    {formatDistance(clockOut.distanceMeters)} from job site
                  </p>
                </div>
              </InfoWindow>
            )}
          </>
        )}
      </GoogleMap>
    </div>
  );
}
