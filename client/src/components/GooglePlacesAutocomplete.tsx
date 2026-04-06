import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MapPin } from "lucide-react";

/** Address parts + lat/lng from Places API when user selects a suggestion (used globally for maps, location matching, fleet routing). */
export interface AddressComponents {
  streetNumber?: string;
  streetName?: string;
  address2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  /** Set when user picks a suggestion; persist with address for maps and distance filtering. */
  latitude?: number;
  longitude?: number;
}

interface GooglePlacesAutocompleteProps {
  value: string;
  onChange: (address: string, components: AddressComponents) => void;
  onPlaceSelect?: (place: any) => void;
  placeholder?: string;
  label?: string;
  id?: string;
  required?: boolean;
  className?: string;
  /** Class for the root container (label + input). Use e.g. pt-6 pb-6 px-6 for section padding. */
  containerClassName?: string;
  /** When true, show address suggestions globally (no region restriction). Default false = US/CA only. */
  global?: boolean;
}

interface AutocompletePrediction {
  placePrediction: {
    placeId: string;
    text: {
      text: string;
      matches: Array<{
        startOffset: number;
        endOffset: number;
      }>;
    };
    structuredFormat: {
      mainText: {
        text: string;
        matches: Array<{
          startOffset: number;
          endOffset: number;
        }>;
      };
      secondaryText: {
        text: string;
      };
    };
  };
}

/**
 * GooglePlacesAutocomplete - Uses Places API (New) REST API
 *
 * GLOBAL RULE: All address inputs MUST use this component with Places API (New).
 * When the user selects a suggestion from the dropdown, onChange receives
 * AddressComponents including latitude/longitude (from the place, no extra Geocode call).
 * Persist lat/lng with the address for maps, location matching, and fleet routing.
 * NEVER uses legacy JavaScript API - only REST API (New).
 */
export function GooglePlacesAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = "Enter address",
  label,
  id,
  required = false,
  className = "",
  containerClassName = "",
  global = false,
}: GooglePlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [predictions, setPredictions] = useState<AutocompletePrediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // Fetch autocomplete predictions using Places API (New) REST API
  const fetchPredictions = useCallback(async (input: string) => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (!apiKey || !input.trim() || input.length < 2) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }

    setIsLoading(true);
    try {
      const trimmedInput = input.trim();
      // Build request body according to Places API (New) specification
      const requestBody: Record<string, unknown> = {
        input: trimmedInput,
      };
      if (global) {
        // Global: no region or type restriction so suggestions work worldwide
      } else {
        requestBody.includedRegionCodes = ["us", "ca"];
        requestBody.includedPrimaryTypes = ["street_address", "premise", "subpremise"];
      }

      const response = await fetch(
        `https://places.googleapis.com/v1/places:autocomplete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Places API (New) error: ${response.status}`;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage += ` - ${errorJson.error?.message || errorText}`;
          
          // Provide helpful guidance for common errors
          if (response.status === 400) {
            console.error("⚠️ Places API (New) 400 Error - Common causes:");
            console.error("1. Places API (New) not enabled in Google Cloud Console");
            console.error("2. API key doesn't have Places API (New) permission");
            console.error("3. Check: APIs & Services → Library → Search 'Places API (New)' → Enable");
            console.error("4. Check: APIs & Services → Credentials → Edit API key → Add 'Places API (New)' to restrictions");
          }
        } catch {
          errorMessage += ` - ${errorText}`;
        }
        
        console.error("Places API (New) error response:", errorText);
        console.error("Request body sent:", JSON.stringify(requestBody, null, 2));
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const suggestions = data.suggestions || [];
      setPredictions(suggestions);
      setShowDropdown(suggestions.length > 0);
      setSelectedIndex(-1);
    } catch (error) {
      console.error("Failed to fetch autocomplete predictions:", error);
      setPredictions([]);
      setShowDropdown(false);
    } finally {
      setIsLoading(false);
    }
  }, [global]);

  // Debounced input handler
  const handleInputChange = useCallback((inputValue: string) => {
    onChange(inputValue, {});
    
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchPredictions(inputValue);
    }, 300);
  }, [fetchPredictions, onChange]);

  // Fetch place details using Places API (New)
  const fetchPlaceDetails = useCallback(async (placeId: string) => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (!apiKey) return;

    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}`,
        {
          method: "GET",
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "id,displayName,formattedAddress,addressComponents.longText,addressComponents.shortText,addressComponents.types,location.latitude,location.longitude",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Places API error: ${response.status}`);
      }

      const place = await response.json();
      
      // Parse address components - Places API (New) format
      const components: AddressComponents = {};
      
      if (place.addressComponents) {
        place.addressComponents.forEach((component: any) => {
          // New API uses types array, check all types. Support both longText/shortText and text.
          const types = component.types || [];
          const longVal = component.longText ?? component.text;
          const shortVal = component.shortText ?? component.text;

          if (types.includes("street_number")) {
            components.streetNumber = longVal;
          }
          if (types.includes("route")) {
            components.streetName = longVal;
          }
          if (types.includes("locality")) {
            components.city = longVal;
          }
          if (types.includes("sublocality") && !components.city) {
            components.city = longVal;
          }
          if (types.includes("administrative_area_level_1")) {
            components.state = shortVal;
          }
          if (types.includes("postal_code")) {
            components.zipCode = longVal;
          }
          if (types.includes("country")) {
            components.country = shortVal;
          }
        });
      }

      const formattedAddress = place.formattedAddress || place.displayName?.text || value;
      const hasLocation = place.location && typeof place.location.latitude === "number" && typeof place.location.longitude === "number";

      onChange(formattedAddress, {
        ...components,
        address2: "",
        ...(hasLocation && {
          latitude: place.location.latitude,
          longitude: place.location.longitude,
        }),
      });

      if (onPlaceSelect) {
        // Transform to match expected format for backward compatibility
        const transformedPlace = {
          formatted_address: formattedAddress,
          formattedAddress: formattedAddress,
          displayName: place.displayName,
          address_components: place.addressComponents?.map((comp: any) => ({
            long_name: comp.longText || comp.text,
            short_name: comp.shortText || comp.text,
            types: comp.types || [],
          })) || [],
          geometry: place.location ? {
            location: {
              lat: () => place.location.latitude,
              lng: () => place.location.longitude,
            },
          } : null,
          location: place.location,
          place_id: place.id,
          id: place.id,
          ...place,
        };
        onPlaceSelect(transformedPlace);
      }

      setShowDropdown(false);
      setPredictions([]);
    } catch (error) {
      console.error("Failed to fetch place details:", error);
    }
  }, [value, onChange, onPlaceSelect]);

  // Handle prediction selection
  const handleSelectPrediction = useCallback((prediction: AutocompletePrediction) => {
    if (prediction.placePrediction?.placeId) {
      fetchPlaceDetails(prediction.placePrediction.placeId);
    }
  }, [fetchPlaceDetails]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || predictions.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < predictions.length - 1 ? prev + 1 : prev));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < predictions.length) {
          handleSelectPrediction(predictions[selectedIndex]);
        } else if (predictions.length > 0) {
          handleSelectPrediction(predictions[0]);
        }
        break;
      case "Escape":
        setShowDropdown(false);
        setPredictions([]);
        break;
    }
  }, [showDropdown, predictions, selectedIndex, handleSelectPrediction]);

  // Update dropdown position (for portal - must appear above dialogs/overflow containers)
  const updateDropdownRect = useCallback(() => {
    if (inputRef.current && showDropdown) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownRect({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    } else {
      setDropdownRect(null);
    }
  }, [showDropdown]);

  useLayoutEffect(() => {
    if (!showDropdown || predictions.length === 0) {
      setDropdownRect(null);
      return;
    }
    updateDropdownRect();

    const handleScrollOrResize = () => updateDropdownRect();
    window.addEventListener("resize", handleScrollOrResize);

    // Attach scroll listener to scrollable ancestors (scroll doesn't bubble)
    const scrollParents: Element[] = [];
    let el: Element | null = inputRef.current;
    while (el) {
      const style = getComputedStyle(el);
      const overflowY = style.overflowY;
      if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
        scrollParents.push(el);
      }
      el = el.parentElement;
    }
    scrollParents.forEach((parent) => parent.addEventListener("scroll", handleScrollOrResize));

    return () => {
      window.removeEventListener("resize", handleScrollOrResize);
      scrollParents.forEach((parent) => parent.removeEventListener("scroll", handleScrollOrResize));
    };
  }, [showDropdown, predictions.length, updateDropdownRect]);

  // Close dropdown when clicking outside (container or portaled dropdown)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const insideInput = containerRef.current?.contains(target);
      const insideDropdown = target.closest("[data-google-places-dropdown]");
      if (!insideInput && !insideDropdown) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div ref={containerRef} className={cn("relative", containerClassName)}>
      {label && (
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (predictions.length > 0) {
              setShowDropdown(true);
            }
          }}
          placeholder={placeholder}
          className={className}
          data-testid={id}
        />
        
        {/* Dropdown - Portaled to body so it appears above dialogs/overflow containers */}
        {showDropdown && predictions.length > 0 && dropdownRect &&
          createPortal(
            <div
              data-google-places-dropdown
              className="fixed z-[99999] bg-background border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto"
              style={{
                top: dropdownRect.top,
                left: dropdownRect.left,
                width: dropdownRect.width,
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                pointerEvents: "auto",
              }}
            >
              {predictions.map((prediction, index) => {
                const placePred = prediction.placePrediction;
                if (!placePred) return null;

                const isSelected = index === selectedIndex;
                const mainText = placePred.structuredFormat?.mainText?.text || placePred.text?.text || "";
                const secondaryText = placePred.structuredFormat?.secondaryText?.text || "";

                return (
                  <div
                    key={placePred.placeId || index}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelectPrediction(prediction);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelectPrediction(prediction);
                    }}
                    className={`px-4 py-3 cursor-pointer transition-colors border-b border-border last:border-b-0 select-none ${
                      isSelected ? "bg-muted" : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-foreground">
                          {mainText}
                        </div>
                        {secondaryText && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {secondaryText}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>,
            document.body
          )
        }

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
