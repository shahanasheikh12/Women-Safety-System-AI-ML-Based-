import { API_URL } from './api';

export interface RouteCoordinate {
  lat: number;
  lng: number;
}

export interface WarningZone {
  lat: number;
  lng: number;
  risk_level: 'critical' | 'high' | 'medium' | 'low';
  description: string;
}

export interface SuggestRouteResponse {
  label: string; // "Safest Route" | "Balanced Route" | "Fastest Route"
  safety_score: number;
  duration_minutes: number;
  distance_meters: number;
  geometry: {
    type: 'LineString';
    coordinates: number[][]; // [[lng, lat], ...]
  };
  warning_zones: WarningZone[];
}

/**
 * Calls FastAPI route suggestions endpoint.
 */
export async function suggestRoutes(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<SuggestRouteResponse[]> {
  try {
    const currentHour = new Date().getHours();
    const response = await fetch(`${API_URL}/ml/route/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        dest_lat: destination.lat,
        dest_lng: destination.lng,
        hour_of_day: currentHour,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch routes: ${response.statusText}`);
    }

    const data = await response.json();
    return data.routes || [];
  } catch (error) {
    console.error('[safeRoute] Error fetching route suggestions:', error);
    throw error;
  }
}

/**
 * Queries OpenStreetMap Nominatim for address autocomplete suggestions.
 */
export async function geocodeAddress(query: string): Promise<any[]> {
  if (!query || query.trim().length < 3) return [];

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    query
  )}&limit=5`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SafeCircle-App/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.map((item: any) => ({
      display_name: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }));
  } catch (error) {
    console.error('[safeRoute] Geocode error:', error);
    return [];
  }
}

/**
 * Formats duration in minutes/hours for display.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = Math.round(minutes % 60);
  return remainingMins > 0 ? `${hours} hr ${remainingMins} min` : `${hours} hr`;
}

/**
 * Returns color-coded hex representing route safety.
 */
export function getRouteColor(safetyScore: number): string {
  if (safetyScore >= 75) {
    return '#27AE60'; // Green
  } else if (safetyScore >= 50) {
    return '#E67E22'; // Orange
  } else {
    return '#C0392B'; // Red
  }
}
