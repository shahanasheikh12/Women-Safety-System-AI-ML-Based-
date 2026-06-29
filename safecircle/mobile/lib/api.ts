export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

export async function fetchHeatmapData() {
  // Placeholder API call
  return [];
}

export async function fetchVolunteerScore(volunteerId: string) {
  // Placeholder API call
  return 1.0;
}

export async function fetchSafeRoute(origin: string, destination: string) {
  // Placeholder API call
  return null;
}

/**
 * Fetches threat zone polygons near a location (lat, lng) within radius
 */
export async function fetchThreatZones(lat: number, lng: number, radiusKm: number = 5.0) {
  try {
    const response = await fetch(
      `${API_URL}/ml/heatmap/zones?lat=${lat}&lng=${lng}&radius_km=${radiusKm}`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('[api] fetchThreatZones error:', error);
    return { type: 'FeatureCollection', features: [] };
  }
}

/**
 * Calculates safety score for a location (lat, lng) based on nearby threat zones
 */
export async function getAreaSafetyScore(lat: number, lng: number) {
  try {
    const response = await fetch(`${API_URL}/ml/heatmap/area-score?lat=${lat}&lng=${lng}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('[api] getAreaSafetyScore error:', error);
    return { score: 100, risk_level: 'safe', nearest_zone_distance_m: null };
  }
}

export default {
  fetchHeatmapData,
  fetchVolunteerScore,
  fetchSafeRoute,
  fetchThreatZones,
  getAreaSafetyScore,
};
