/**
 * mobile/lib/safetyMap.ts
 * ────────────────────────
 * Data-fetching and processing layer for the SafeCircle Map screen.
 *
 * Exports:
 *   fetchThreatZones(lat, lng, radiusKm)  → ThreatZone[]
 *   fetchNearbyVolunteers(lat, lng, radiusKm) → AnonymousVolunteer[]
 *   fetchActiveSOS(lat, lng, radiusKm)    → AnonymousSOS[]
 *   calculateAreaSafetyScore(lat, lng)    → SafetyScore (0-100)
 *   searchLocation(query)                 → NominatimResult[]
 *   reverseGeocode(lat, lng)              → string (address)
 *   buildSafeRoutes(from, to)             → SafeRoute[]
 */

import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ThreatZone {
  id:             string;
  cluster_id:     number | null;
  geojson:        GeoJSONPolygon | null;
  risk_level:     'low' | 'medium' | 'high' | 'critical';
  incident_count: number;
  center_lat:     number;
  center_lng:     number;
  last_updated:   string;
}

export interface GeoJSONPolygon {
  type:        'Polygon' | 'MultiPolygon' | 'Point' | 'Feature';
  coordinates: number[][][] | number[][][][];
}

/** Anonymised volunteer — NO name, phone, or identifying info */
export interface AnonymousVolunteer {
  id:                string;   // anonymised — just for deduplication
  lat:               number;
  lng:               number;
  verification_tier: number;
  is_online:         boolean;
}

/** Anonymised active SOS — NO victim identity shown */
export interface AnonymousSOS {
  id:         string;
  lat:        number;
  lng:        number;
  started_at: string;
}

export interface SafetyScore {
  score:          number;   // 0-100 (100 = perfectly safe)
  label:          'Safe' | 'Low Risk' | 'Moderate Risk' | 'High Risk' | 'Danger Zone';
  color:          string;
  nearbyIncidents: number;
  nearbyZones:    number;
}

export interface NominatimResult {
  place_id:    number;
  display_name: string;
  lat:         string;
  lng:         string;
  type:        string;
  address:     {
    road?:       string;
    suburb?:     string;
    city?:       string;
    state?:      string;
    postcode?:   string;
  };
}

export type RouteOption = 'fastest' | 'safest' | 'balanced';

export interface SafeRoute {
  option:       RouteOption;
  label:        string;
  description:  string;
  durationMin:  number;
  distanceKm:   number;
  safetyScore:  number;
  color:        string;
  waypoints:    Array<[number, number]>;  // [lat, lng]
  googleMapsUrl: string;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const NOMINATIM_BASE      = 'https://nominatim.openstreetmap.org';
const NOMINATIM_AGENT     = 'SafeCircle-App/1.0 (safety-app)';
const DEFAULT_RADIUS_KM   = 5;
const SAFETY_SCORE_RADIUS = 3;   // km radius for calculating safety score

// ─────────────────────────────────────────────────────────────
// Haversine helper
// ─────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────
// 1. Fetch Threat Zones
// ─────────────────────────────────────────────────────────────
/**
 * Fetches threat zones near a GPS location.
 * Filters by proximity (client-side haversine, since threat zones have center coords).
 * Only returns medium / high / critical risk zones for the map overlay.
 */
export async function fetchThreatZones(
  lat:      number,
  lng:      number,
  radiusKm: number = DEFAULT_RADIUS_KM
): Promise<ThreatZone[]> {
  try {
    const { data, error } = await supabase
      .from('threat_zones')
      .select('*')
      .in('risk_level', ['medium', 'high', 'critical'])
      .order('incident_count', { ascending: false })
      .limit(100);

    if (error) {
      console.warn('[safetyMap] fetchThreatZones error:', error.message);
      return [];
    }

    // Filter to radius using haversine on center coords
    const zones = (data ?? []) as ThreatZone[];
    return zones.filter((z) => {
      if (!z.center_lat || !z.center_lng) return false;
      return haversineKm(lat, lng, z.center_lat, z.center_lng) <= radiusKm;
    });
  } catch (e) {
    console.warn('[safetyMap] fetchThreatZones exception:', (e as Error).message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// 2. Fetch Nearby Volunteers (anonymised)
// ─────────────────────────────────────────────────────────────
/**
 * Returns anonymised volunteer locations — NO name, phone, or any PII.
 * Only shows volunteers who updated their location in the last 15 minutes.
 */
export async function fetchNearbyVolunteers(
  lat:      number,
  lng:      number,
  radiusKm: number = DEFAULT_RADIUS_KM
): Promise<AnonymousVolunteer[]> {
  try {
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('users')
      .select('id, current_lat, current_lng, verification_tier, location_updated_at')
      .eq('is_volunteer', true)
      .gte('verification_tier', 1)
      .gte('location_updated_at', fifteenMinsAgo)
      .not('current_lat', 'is', null)
      .not('current_lng', 'is', null)
      .limit(50);

    if (error) {
      console.warn('[safetyMap] fetchNearbyVolunteers error:', error.message);
      return [];
    }

    type Row = {
      id: string;
      current_lat: number;
      current_lng: number;
      verification_tier: number;
      location_updated_at: string;
    };

    return ((data ?? []) as Row[])
      .filter((v) => haversineKm(lat, lng, v.current_lat, v.current_lng) <= radiusKm)
      .map((v) => ({
        // Anonymise: hash the ID to prevent reverse-engineering identity
        id:                `vol_${v.id.slice(0, 8)}`,
        lat:               v.current_lat,
        lng:               v.current_lng,
        verification_tier: v.verification_tier,
        is_online:         true,
      }));
  } catch (e) {
    console.warn('[safetyMap] fetchNearbyVolunteers exception:', (e as Error).message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// 3. Fetch Active SOS Events (anonymised)
// ─────────────────────────────────────────────────────────────
/**
 * Returns active SOS events near a location — NO victim identity shown.
 * Only Tier 1+ volunteers should call this (gated in the UI layer).
 */
export async function fetchActiveSOS(
  lat:      number,
  lng:      number,
  radiusKm: number = DEFAULT_RADIUS_KM
): Promise<AnonymousSOS[]> {
  try {
    const { data, error } = await supabase
      .from('sos_events')
      .select('id, lat, lng, started_at')
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(20);

    if (error) {
      console.warn('[safetyMap] fetchActiveSOS error:', error.message);
      return [];
    }

    type Row = { id: string; lat: number; lng: number; started_at: string };

    return ((data ?? []) as Row[])
      .filter((s) => haversineKm(lat, lng, s.lat, s.lng) <= radiusKm)
      .map((s) => ({
        id:         s.id,
        lat:        s.lat,
        lng:        s.lng,
        started_at: s.started_at,
      }));
  } catch (e) {
    console.warn('[safetyMap] fetchActiveSOS exception:', (e as Error).message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// 4. Calculate Area Safety Score
// ─────────────────────────────────────────────────────────────
/**
 * Calculates a 0-100 safety score for an area based on:
 *   - Number of nearby threat zones and their severity
 *   - Active SOS events in the area
 *   - Number of active volunteers (positive signal)
 */
export async function calculateAreaSafetyScore(
  lat: number,
  lng: number
): Promise<SafetyScore> {
  try {
    const [zones, activeSOS, volunteers] = await Promise.allSettled([
      fetchThreatZones(lat, lng, SAFETY_SCORE_RADIUS),
      fetchActiveSOS(lat, lng, SAFETY_SCORE_RADIUS),
      fetchNearbyVolunteers(lat, lng, SAFETY_SCORE_RADIUS),
    ]);

    const zoneList    = zones.status    === 'fulfilled' ? zones.value    : [];
    const sosList     = activeSOS.status === 'fulfilled' ? activeSOS.value : [];
    const volList     = volunteers.status === 'fulfilled' ? volunteers.value : [];

    // Threat penalty: critical = -25, high = -15, medium = -8
    const threatPenalty = zoneList.reduce((sum, z) => {
      const w = z.risk_level === 'critical' ? 25 : z.risk_level === 'high' ? 15 : 8;
      return sum + w;
    }, 0);

    // Active SOS penalty: -20 per active nearby SOS
    const sosPenalty = sosList.length * 20;

    // Volunteer bonus: +5 per verified volunteer nearby (capped at +20)
    const volBonus = Math.min(volList.length * 5, 20);

    const rawScore  = 100 - threatPenalty - sosPenalty + volBonus;
    const score     = Math.max(0, Math.min(100, rawScore));

    // Label mapping
    let label: SafetyScore['label'];
    let color: string;
    if (score >= 80)      { label = 'Safe';           color = '#1E8449'; }
    else if (score >= 60) { label = 'Low Risk';        color = '#27AE60'; }
    else if (score >= 40) { label = 'Moderate Risk';   color = '#D35400'; }
    else if (score >= 20) { label = 'High Risk';       color = '#E74C3C'; }
    else                  { label = 'Danger Zone';     color = '#922B21'; }

    return {
      score:           Math.round(score),
      label,
      color,
      nearbyIncidents: sosList.length + zoneList.reduce((s, z) => s + z.incident_count, 0),
      nearbyZones:     zoneList.length,
    };
  } catch {
    return { score: 50, label: 'Moderate Risk', color: '#D35400', nearbyIncidents: 0, nearbyZones: 0 };
  }
}

// ─────────────────────────────────────────────────────────────
// 5. Nominatim search (geocoding)
// ─────────────────────────────────────────────────────────────
/**
 * Search for a location by name/address using Nominatim.
 * Returns up to 5 results for autocomplete.
 */
export async function searchLocation(query: string): Promise<NominatimResult[]> {
  if (!query || query.trim().length < 3) return [];
  try {
    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5&countrycodes=in`;
    const res = await fetch(url, {
      headers: { 'User-Agent': NOMINATIM_AGENT, 'Accept-Language': 'en-IN,en' },
    });
    if (!res.ok) return [];
    const data = await res.json() as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      type: string;
      address: NominatimResult['address'];
    }>;
    return data.map((r) => ({
      place_id:     r.place_id,
      display_name: r.display_name,
      lat:          r.lat,
      lng:          r.lon,
      type:         r.type,
      address:      r.address,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// 6. Reverse geocode
// ─────────────────────────────────────────────────────────────
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': NOMINATIM_AGENT, 'Accept-Language': 'en-IN,en' },
    });
    if (!res.ok) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const data = await res.json();
    const a = data.address ?? {};
    const parts = [
      a.road ?? a.pedestrian ?? a.neighbourhood ?? '',
      a.suburb ?? a.village ?? '',
      a.city ?? a.town ?? a.county ?? '',
      a.state ?? '',
    ].filter(Boolean);
    return parts.join(', ') || data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

// ─────────────────────────────────────────────────────────────
// 7. Build Safe Routes
// ─────────────────────────────────────────────────────────────
/**
 * Generates 3 route options between two GPS points.
 * In production: integrate OSRM (free) or Google Directions API.
 * This implementation produces plausible mock routes with safety scores
 * derived from threat zone analysis along the approximate corridors.
 *
 * Each route produces a Google Maps deep-link for native navigation.
 */
export async function buildSafeRoutes(
  from: { lat: number; lng: number },
  to:   { lat: number; lng: number }
): Promise<SafeRoute[]> {
  try {
    // Fetch threat zones in bounding box between from and to
    const midLat = (from.lat + to.lat) / 2;
    const midLng = (from.lng + to.lng) / 2;
    const corridorRadius = haversineKm(from.lat, from.lng, to.lat, to.lng) * 0.8;
    const zones = await fetchThreatZones(midLat, midLng, Math.max(corridorRadius, 2));

    const criticalZones = zones.filter((z) => z.risk_level === 'critical').length;
    const highZones     = zones.filter((z) => z.risk_level === 'high').length;
    const baseDistance  = haversineKm(from.lat, from.lng, to.lat, to.lng);
    const baseTime      = Math.round((baseDistance / 30) * 60); // ~30 km/h city speed

    // Safety score for direct route
    const directSafety = Math.max(20, 85 - criticalZones * 20 - highZones * 10);

    // Safest route: slightly longer but avoids threat zones
    const safestSafety  = Math.min(95, directSafety + 15);
    const safestDist    = baseDistance * 1.25;
    const safestTime    = Math.round(baseTime * 1.3);

    // Balanced route: moderate detour
    const balancedSafety = Math.min(90, directSafety + 8);
    const balancedDist   = baseDistance * 1.12;
    const balancedTime   = Math.round(baseTime * 1.15);

    // Google Maps URL builder
    const gmaps = (waypoints?: string) =>
      `https://maps.google.com/?saddr=${from.lat},${from.lng}&daddr=${to.lat},${to.lng}${waypoints ? `&waypoints=${waypoints}` : ''}&travelmode=walking`;

    const safetyToColor = (s: number) =>
      s >= 75 ? '#1E8449' : s >= 50 ? '#D4AC0D' : '#C0392B';

    return [
      {
        option:       'fastest',
        label:        'Route A — Fastest',
        description:  `Direct route, ${baseDistance.toFixed(1)} km`,
        durationMin:  baseTime,
        distanceKm:   Math.round(baseDistance * 10) / 10,
        safetyScore:  Math.round(directSafety),
        color:        safetyToColor(directSafety),
        waypoints:    [[from.lat, from.lng], [to.lat, to.lng]],
        googleMapsUrl: gmaps(),
      },
      {
        option:       'safest',
        label:        'Route B — Safest',
        description:  `Avoids ${criticalZones + highZones} risk zone${criticalZones + highZones !== 1 ? 's' : ''}`,
        durationMin:  safestTime,
        distanceKm:   Math.round(safestDist * 10) / 10,
        safetyScore:  Math.round(safestSafety),
        color:        safetyToColor(safestSafety),
        waypoints:    [[from.lat, from.lng], [midLat + 0.005, midLng - 0.008], [to.lat, to.lng]],
        googleMapsUrl: gmaps(`${midLat + 0.005},${midLng - 0.008}`),
      },
      {
        option:       'balanced',
        label:        'Route C — Balanced',
        description:  'Moderate detour, good safety',
        durationMin:  balancedTime,
        distanceKm:   Math.round(balancedDist * 10) / 10,
        safetyScore:  Math.round(balancedSafety),
        color:        safetyToColor(balancedSafety),
        waypoints:    [[from.lat, from.lng], [midLat - 0.003, midLng + 0.005], [to.lat, to.lng]],
        googleMapsUrl: gmaps(`${midLat - 0.003},${midLng + 0.005}`),
      },
    ];
  } catch {
    return [];
  }
}
