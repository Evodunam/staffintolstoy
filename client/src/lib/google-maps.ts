/**
 * Shared Google Maps loader config for @react-google-maps/api useJsApiLoader.
 * All map components must use the same id + libraries; otherwise the loader
 * throws "Loader must not be called again with different options."
 */
export const GOOGLE_MAPS_LOADER_ID = "google-map-script" as const;
export const GOOGLE_MAPS_LIBRARIES: ("places" | "maps")[] = ["places", "maps"];
