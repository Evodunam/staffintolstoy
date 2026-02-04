import { Client } from "@googlemaps/google-maps-services-js";

const client = new Client({});

interface GeocodingResult {
  latitude: string;
  longitude: string;
}

export async function geocodeAddress(address: string): Promise<GeocodingResult | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  
  if (!apiKey) {
    console.warn("[Geocoding] GOOGLE_API_KEY not configured, skipping geocoding");
    return null;
  }

  try {
    const response = await client.geocode({
      params: {
        address,
        key: apiKey,
      },
      timeout: 5000,
    });

    if (response.data.results && response.data.results.length > 0) {
      const location = response.data.results[0].geometry.location;
      console.log(`[Geocoding] Geocoded "${address}" to ${location.lat}, ${location.lng}`);
      return {
        latitude: location.lat.toFixed(7),
        longitude: location.lng.toFixed(7),
      };
    }

    console.warn(`[Geocoding] No results for address: ${address}`);
    return null;
  } catch (error: any) {
    console.error(`[Geocoding] Error geocoding address: ${error.message}`);
    return null;
  }
}

export async function geocodeFullAddress(
  address: string,
  city: string,
  state: string,
  zipCode: string
): Promise<GeocodingResult | null> {
  const fullAddress = `${address}, ${city}, ${state} ${zipCode}`;
  return geocodeAddress(fullAddress);
}
