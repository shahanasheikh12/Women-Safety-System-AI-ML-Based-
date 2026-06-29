/**
 * sos-active.tsx
 *
 * Full-screen Active SOS experience for SafeCircle.
 * Shown immediately after SOS fires — cannot be easily dismissed.
 *
 * Features:
 *  - Red top bar with 🚨 pulsing dot and elapsed-time counter
 *  - Leaflet.js map (via WebView + OpenStreetMap) — no API key needed
 *  - Real-time victim location updates (every 5 s) via useRealtimeLocation
 *  - Volunteer cards with tier badge, status chip, ETA, and star trust score
 *  - "I AM SAFE" / "Report False Alarm" / "Alert Police" bottom actions
 *  - expo-keep-awake to prevent screen sleep
 *  - Back-button blocked (Android hardware back)
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';

// ── Optional: expo-keep-awake (install: npx expo install expo-keep-awake) ──
// We use a try/require pattern so the app still compiles if not installed.
let useKeepAwake: (() => void) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  useKeepAwake = require('expo-keep-awake').useKeepAwake;
} catch {
  // expo-keep-awake not installed — screen may sleep during SOS
}

// ── Optional: react-native-webview (install: npx expo install react-native-webview) ──
let WebView: React.ComponentType<{
  source: { html: string };
  style?: object;
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  ref?: React.Ref<{ postMessage: (msg: string) => void }>;
  javaScriptEnabled?: boolean;
  scrollEnabled?: boolean;
}> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebView = require('react-native-webview').WebView;
} catch {
  // react-native-webview not installed — map will show placeholder
}

import { supabase } from '../lib/supabase';
import useRealtimeLocation from '../hooks/useRealtimeLocation';
import { useSOS } from '../hooks/useSOS';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type VolunteerStatus = 'notified' | 'accepted' | 'en_route' | 'arrived' | 'declined' | 'completed';

interface VolunteerCard {
  id: string;
  volunteer_id: string;
  status: VolunteerStatus;
  name: string;
  initials: string;
  verification_tier: number; // 1 Basic | 2 Community | 3 Champion
  trust_score: number;       // 0–5
  eta_minutes: number | null;
  lat?: number | null;
  lng?: number | null;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function tierLabel(tier: number): string {
  switch (tier) {
    case 3: return '🥇 Champion';
    case 2: return '🟢 Community';
    default: return '🔵 Basic';
  }
}

function tierColor(tier: number): string {
  switch (tier) {
    case 3: return '#F5C518';
    case 2: return '#27AE60';
    default: return '#2E86C1';
  }
}

function statusLabel(status: VolunteerStatus): string {
  switch (status) {
    case 'notified':   return 'Notified';
    case 'accepted':   return 'Coming to help';
    case 'en_route':   return 'On the way';
    case 'arrived':    return 'Arrived ✓';
    case 'declined':   return 'Unavailable';
    case 'completed':  return 'Completed';
    default:           return status;
  }
}

function statusColor(status: VolunteerStatus): string {
  switch (status) {
    case 'notified':   return '#7F8C8D';
    case 'accepted':   return '#2E86C1';
    case 'en_route':   return '#D35400';
    case 'arrived':    return '#1E8449';
    case 'declined':   return '#922B21';
    case 'completed':  return '#1E8449';
    default:           return '#7F8C8D';
  }
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// ─────────────────────────────────────────────────────────────
// Leaflet HTML — inline WebView map
// ─────────────────────────────────────────────────────────────
function buildLeafletHTML(lat: number, lng: number): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; background: #1a1a2e; }

    /* Pulsing victim marker */
    .victim-pulse-container { position: relative; }
    .victim-pulse {
      width: 20px; height: 20px;
      border-radius: 50%;
      background: #C0392B;
      border: 3px solid #fff;
      box-shadow: 0 0 0 0 rgba(192, 57, 43, 0.7);
      animation: pulse 1.5s ease-out infinite;
    }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(192,57,43,0.7); }
      70%  { box-shadow: 0 0 0 16px rgba(192,57,43,0); }
      100% { box-shadow: 0 0 0 0 rgba(192,57,43,0); }
    }

    /* Volunteer badge marker */
    .vol-marker {
      width: 30px; height: 30px;
      border-radius: 50%;
      background: #27AE60;
      border: 3px solid #fff;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 700; font-size: 12px;
      font-family: sans-serif;
      box-shadow: 0 2px 6px rgba(0,0,0,0.5);
    }
    .vol-marker.tier-3 { background: #F5C518; color: #1a1a2e; }
    .vol-marker.tier-2 { background: #27AE60; }
    .vol-marker.tier-1 { background: #2E86C1; }

    /* Dark mode map tiles via CSS filter */
    .leaflet-tile-pane { filter: brightness(0.75) saturate(0.9); }
  </style>
</head>
<body>
<div id="map"></div>
<script>
  var INIT_LAT = ${lat};
  var INIT_LNG = ${lng};
  var map = L.map('map', { zoomControl: false }).setView([INIT_LAT, INIT_LNG], 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  // ── Victim marker ─────────────────────────────────
  var victimIcon = L.divIcon({
    className: '',
    html: '<div class="victim-pulse-container"><div class="victim-pulse"></div></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
  var victimMarker = L.marker([INIT_LAT, INIT_LNG], { icon: victimIcon }).addTo(map);

  // ── Accuracy circle ───────────────────────────────
  var accuracyCircle = L.circle([INIT_LAT, INIT_LNG], {
    radius: 20,
    color: '#C0392B',
    fillColor: '#C0392B',
    fillOpacity: 0.15,
    weight: 1
  }).addTo(map);

  // ── Volunteer markers store ───────────────────────
  var volunteerMarkers = {};

  // ── Threat zone store ─────────────────────────────
  var threatLayers = {};

  // ── Receive messages from React Native ────────────
  document.addEventListener('message', handleMessage);
  window.addEventListener('message', handleMessage);

  function handleMessage(event) {
    try {
      var msg = JSON.parse(event.data);
      if (msg.type === 'UPDATE_VICTIM') {
        updateVictim(msg.lat, msg.lng, msg.accuracy);
      } else if (msg.type === 'UPDATE_VOLUNTEERS') {
        updateVolunteers(msg.volunteers);
      } else if (msg.type === 'ADD_THREAT_ZONES') {
        addThreatZones(msg.zones);
      }
    } catch(e) {}
  }

  function updateVictim(lat, lng, accuracy) {
    victimMarker.setLatLng([lat, lng]);
    accuracyCircle.setLatLng([lat, lng]);
    if (accuracy) accuracyCircle.setRadius(accuracy);
    map.panTo([lat, lng], { animate: true, duration: 1 });
  }

  function updateVolunteers(vols) {
    // Remove markers for volunteers no longer in list
    var currentIds = vols.map(function(v) { return v.id; });
    Object.keys(volunteerMarkers).forEach(function(id) {
      if (!currentIds.includes(id)) {
        map.removeLayer(volunteerMarkers[id]);
        delete volunteerMarkers[id];
      }
    });

    // Add/update markers
    vols.forEach(function(v, idx) {
      var tierClass = 'tier-' + (v.tier || 1);
      var icon = L.divIcon({
        className: '',
        html: '<div class="vol-marker ' + tierClass + '">' + (idx + 1) + '</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      if (volunteerMarkers[v.id]) {
        volunteerMarkers[v.id].setLatLng([v.lat, v.lng]);
        volunteerMarkers[v.id].setIcon(icon);
      } else {
        volunteerMarkers[v.id] = L.marker([v.lat, v.lng], { icon: icon })
          .bindPopup(v.name || 'Volunteer')
          .addTo(map);
      }
    });
  }

  function addThreatZones(zones) {
    zones.forEach(function(z) {
      if (threatLayers[z.id]) return; // already added
      var color = z.risk === 'critical' ? '#922B21'
                : z.risk === 'high'     ? '#C0392B'
                : z.risk === 'medium'   ? '#D35400'
                                        : '#F39C12';
      if (z.geojson) {
        var layer = L.geoJSON(z.geojson, {
          style: { color: color, fillColor: color, fillOpacity: 0.25, weight: 2 }
        }).addTo(map);
        threatLayers[z.id] = layer;
      } else if (z.lat && z.lng && z.radius) {
        var circle = L.circle([z.lat, z.lng], {
          radius: z.radius,
          color: color, fillColor: color, fillOpacity: 0.2, weight: 2
        }).addTo(map);
        threatLayers[z.id] = circle;
      }
    });
  }
</script>
</body>
</html>
`;
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

/** Pulsing red dot for the top bar */
function PulsingDot() {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.5, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [scale]);

  return (
    <Animated.View
      style={[styles.pulsingDot, { transform: [{ scale }] }]}
    />
  );
}

/** Star rating display */
function StarRating({ score }: { score: number }) {
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={[styles.star, { opacity: i <= Math.round(score) ? 1 : 0.3 }]}>
          ★
        </Text>
      ))}
    </View>
  );
}

/** Single volunteer card */
function VolunteerCard({ vol }: { vol: VolunteerCard }) {
  const isActive = vol.status === 'accepted' || vol.status === 'en_route' || vol.status === 'arrived';

  return (
    <View style={[styles.volCard, isActive && styles.volCardActive]}>
      {/* Avatar */}
      <View style={[styles.avatar, { borderColor: tierColor(vol.verification_tier) }]}>
        <Text style={styles.avatarText}>{vol.initials}</Text>
      </View>

      {/* Info */}
      <View style={styles.volInfo}>
        <View style={styles.volNameRow}>
          <Text style={styles.volName} numberOfLines={1}>{vol.name}</Text>
          <View style={[styles.tierBadge, { backgroundColor: tierColor(vol.verification_tier) + '22', borderColor: tierColor(vol.verification_tier) }]}>
            <Text style={[styles.tierText, { color: tierColor(vol.verification_tier) }]}>
              {tierLabel(vol.verification_tier)}
            </Text>
          </View>
        </View>

        <StarRating score={vol.trust_score} />

        <View style={styles.volStatusRow}>
          <View style={[styles.statusChip, { backgroundColor: statusColor(vol.status) + '22', borderColor: statusColor(vol.status) }]}>
            <Text style={[styles.statusText, { color: statusColor(vol.status) }]}>
              {statusLabel(vol.status)}
            </Text>
          </View>
          {vol.eta_minutes !== null && vol.status !== 'arrived' && (
            <Text style={styles.etaText}>~{vol.eta_minutes} min away</Text>
          )}
        </View>
      </View>
    </View>
  );
}

/** Map placeholder when WebView is unavailable */
function MapPlaceholder({ lat, lng }: { lat: number | null; lng: number | null }) {
  return (
    <View style={styles.mapPlaceholder}>
      <Text style={styles.mapPlaceholderIcon}>📍</Text>
      <Text style={styles.mapPlaceholderTitle}>Live Map</Text>
      <Text style={styles.mapPlaceholderSub}>
        {lat && lng
          ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
          : 'Acquiring location…'}
      </Text>
      <Text style={styles.mapPlaceholderHint}>
        Install react-native-webview for full map view
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
export default function SOSActiveScreen() {
  const { sosId } = useLocalSearchParams<{ sosId: string }>();

  // ── Keep screen awake ────────────────────────────────────────
  if (useKeepAwake) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useKeepAwake();
  }

  // ── Block Android hardware back button ───────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Show confirmation instead of silently navigating away
      Alert.alert(
        'SOS is Active',
        'Your SOS is still active. Tap "I AM SAFE" to resolve it first.',
        [{ text: 'OK', style: 'cancel' }]
      );
      return true; // consume the event
    });
    return () => sub.remove();
  }, []);

  // ── Elapsed time counter ─────────────────────────────────────
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Realtime location stream ─────────────────────────────────
  const { latestLocation, isConnected } = useRealtimeLocation(sosId ?? null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);

  // ── WebView ref for postMessage ──────────────────────────────
  const webViewRef = useRef<{ postMessage: (msg: string) => void } | null>(null);

  // Push new location to Leaflet map via postMessage
  useEffect(() => {
    if (!latestLocation) return;
    setMapCenter({ lat: latestLocation.lat, lng: latestLocation.lng });

    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'UPDATE_VICTIM',
        lat: latestLocation.lat,
        lng: latestLocation.lng,
        accuracy: latestLocation.accuracy_meters,
      })
    );
  }, [latestLocation]);

  // ── Volunteer responses (Realtime) ───────────────────────────
  const [volunteers, setVolunteers] = useState<VolunteerCard[]>([]);

  useEffect(() => {
    if (!sosId) return;

    // Initial fetch
    (async () => {
      const { data, error } = await supabase
        .from('volunteer_responses')
        .select(`
          id,
          volunteer_id,
          status,
          users:volunteer_id (
            name,
            verification_tier,
            trust_score,
            current_lat,
            current_lng
          )
        `)
        .eq('sos_id', sosId);

      if (!error && data) {
        const cards: VolunteerCard[] = (data as any[]).map((row: any) => {
          const user = Array.isArray(row.users) ? row.users[0] : row.users;
          return {
            id: row.id,
            volunteer_id: row.volunteer_id,
            status: row.status,
            name: user?.name ?? 'Volunteer',
            initials: initialsFromName(user?.name ?? 'V'),
            verification_tier: user?.verification_tier ?? 1,
            trust_score: user?.trust_score ?? 0,
            eta_minutes: null,
            lat: user?.current_lat ?? null,
            lng: user?.current_lng ?? null,
          };
        });
        setVolunteers(cards);
      }
    })();

    // Realtime updates to volunteer_responses
    const channel = supabase
      .channel(`vol-responses:${sosId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT and UPDATE
          schema: 'public',
          table: 'volunteer_responses',
          filter: `sos_id=eq.${sosId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string;
            volunteer_id: string;
            status: VolunteerStatus;
          };

          // Fetch volunteer profile
          const { data: userData } = await supabase
            .from('users')
            .select('name, verification_tier, trust_score, current_lat, current_lng')
            .eq('id', row.volunteer_id)
            .single();

          const card: VolunteerCard = {
            id: row.id,
            volunteer_id: row.volunteer_id,
            status: row.status,
            name: userData?.name ?? 'Volunteer',
            initials: initialsFromName(userData?.name ?? 'V'),
            verification_tier: userData?.verification_tier ?? 1,
            trust_score: userData?.trust_score ?? 0,
            eta_minutes: null,
            lat: userData?.current_lat ?? null,
            lng: userData?.current_lng ?? null,
          };

          setVolunteers((prev) => {
            const existing = prev.findIndex((v) => v.id === row.id);
            if (existing >= 0) {
              const updated = [...prev];
              // Retain lat/lng from broadcast channel if database hasn't synced yet
              updated[existing] = {
                ...card,
                lat: card.lat ?? prev[existing].lat,
                lng: card.lng ?? prev[existing].lng,
              };
              return updated;
            }
            return [...prev, card];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sosId]);

  // Subscribe to real-time volunteer location broadcasts
  useEffect(() => {
    if (!sosId) return;

    const shareChannel = supabase
      .channel(`sos_sharing:${sosId}`)
      .on('broadcast', { event: 'volunteer_location' }, (payload) => {
        const { volunteerId, lat, lng } = payload.payload;
        
        setVolunteers((prev) => {
          const idx = prev.findIndex((v) => v.volunteer_id === volunteerId);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              lat,
              lng,
            };
            return updated;
          }
          return prev;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(shareChannel);
    };
  }, [sosId]);

  // Push volunteer locations to map when they update
  useEffect(() => {
    const volMapData = volunteers
      .filter((v) => (v.status === 'accepted' || v.status === 'en_route' || v.status === 'arrived') && v.lat && v.lng)
      .map((v) => ({
        id: v.volunteer_id,
        name: v.name,
        tier: v.verification_tier,
        lat: v.lat!,
        lng: v.lng!,
      }));

    if (volMapData.length > 0 && webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({ type: 'UPDATE_VOLUNTEERS', volunteers: volMapData })
      );
    }
  }, [volunteers, mapCenter]);

  // ── Load threat zones ────────────────────────────────────────
  useEffect(() => {
    if (!mapCenter) return;

    (async () => {
      const { data } = await supabase
        .from('threat_zones')
        .select('id, geojson, risk_level, center_lat, center_lng')
        .not('center_lat', 'is', null);

      if (data && data.length > 0 && webViewRef.current) {
        const zones = data.map((z: {
          id: string;
          geojson: unknown;
          risk_level: string | null;
          center_lat: number | null;
          center_lng: number | null;
        }) => ({
          id: z.id,
          geojson: z.geojson,
          risk: z.risk_level,
          lat: z.center_lat,
          lng: z.center_lng,
          radius: 150,
        }));
        webViewRef.current.postMessage(
          JSON.stringify({ type: 'ADD_THREAT_ZONES', zones })
        );
      }
    })();
  }, [mapCenter]);

  // ── SOS actions ──────────────────────────────────────────────
  const { resolveSOS } = useSOS();
  const [resolving, setResolving] = useState(false);
  const [showSafeModal, setShowSafeModal] = useState(false);

  const handleSafe = useCallback(async () => {
    setResolving(true);
    await resolveSOS('safe');
    setResolving(false);
  }, [resolveSOS]);

  const handleFalseAlarm = useCallback(() => {
    Alert.alert(
      'Report False Alarm?',
      'This will cancel the SOS and notify volunteers that it was a false alarm.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, False Alarm',
          style: 'destructive',
          onPress: async () => {
            setResolving(true);
            await resolveSOS('false_alarm');
            setResolving(false);
          },
        },
      ]
    );
  }, [resolveSOS]);

  const handlePolice = useCallback(() => {
    const smsBody = encodeURIComponent(
      `🚨 EMERGENCY — I need police assistance immediately!\n` +
      (mapCenter
        ? `My location: https://www.openstreetmap.org/?mlat=${mapCenter.lat}&mlon=${mapCenter.lng}&zoom=16`
        : 'Location unavailable')
    );
    const smsUrl = Platform.OS === 'ios'
      ? `sms:112&body=${smsBody}`
      : `sms:112?body=${smsBody}`;

    Linking.canOpenURL(smsUrl)
      .then((supported) => {
        if (supported) {
          Linking.openURL(smsUrl);
        } else {
          Linking.openURL(`tel:112`);
        }
      })
      .catch(() => Linking.openURL(`tel:112`));
  }, [mapCenter]);

  // ── Leaflet HTML — initialized once, updated via postMessage ──
  const leafletHTML = useMemo(() => {
    // Use a default location until the first GPS point arrives
    const initLat = mapCenter?.lat ?? 20.5937;
    const initLng = mapCenter?.lng ?? 78.9629;
    return buildLeafletHTML(initLat, initLng);
  // Re-build only once after first real location arrives
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!mapCenter]);

  // ── Active/inactive volunteer counts ────────────────────────
  const activeVols = volunteers.filter(
    (v) => v.status !== 'declined' && v.status !== 'completed'
  );
  const respondingVols = volunteers.filter(
    (v) => v.status === 'accepted' || v.status === 'en_route' || v.status === 'arrived'
  );

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar backgroundColor="#8B0000" barStyle="light-content" />

      {/* ── TOP BAR ─────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <SafeAreaView style={styles.topBarInner}>
          <View style={styles.topBarContent}>
            {/* Left: Pulsing dot */}
            <PulsingDot />

            {/* Center: Title + sub */}
            <View style={styles.topBarCenter}>
              <Text style={styles.sosTitle}>🚨 SOS ACTIVE</Text>
              {isConnected ? (
                <Text style={styles.liveIndicator}>● LIVE</Text>
              ) : (
                <Text style={styles.connectingIndicator}>Connecting…</Text>
              )}
            </View>

            {/* Right: Elapsed timer */}
            <View style={styles.timerBox}>
              <Text style={styles.timerText}>{formatElapsed(elapsedSeconds)}</Text>
              <Text style={styles.timerLabel}>elapsed</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>

      {/* ── MAP SECTION ──────────────────────────────────────── */}
      <View style={styles.mapSection}>
        {WebView ? (
          // @ts-ignore — dynamic import, ref type relaxed
          <WebView
            ref={webViewRef as React.Ref<{ postMessage: (msg: string) => void }>}
            source={{ html: leafletHTML }}
            style={styles.webView}
            javaScriptEnabled
            scrollEnabled={false}
            onMessage={() => {/* not used */}}
          />
        ) : (
          <MapPlaceholder lat={mapCenter?.lat ?? null} lng={mapCenter?.lng ?? null} />
        )}

        {/* Map overlay: coordinate badge */}
        {mapCenter && (
          <View style={styles.coordBadge}>
            <Text style={styles.coordText}>
              {mapCenter.lat.toFixed(5)}, {mapCenter.lng.toFixed(5)}
            </Text>
          </View>
        )}
      </View>

      {/* ── VOLUNTEERS + ACTIONS ─────────────────────────────── */}
      <View style={styles.bottomPanel}>
        {/* Volunteer header */}
        <View style={styles.volHeader}>
          <Text style={styles.volHeaderText}>
            {activeVols.length === 0
              ? 'Notifying volunteers nearby…'
              : `${activeVols.length} volunteer${activeVols.length !== 1 ? 's' : ''} notified`}
          </Text>
          {respondingVols.length > 0 && (
            <View style={styles.respondingBadge}>
              <Text style={styles.respondingText}>
                {respondingVols.length} coming
              </Text>
            </View>
          )}
        </View>

        {/* Volunteer list */}
        {activeVols.length > 0 ? (
          <ScrollView
            style={styles.volList}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {activeVols.map((vol) => (
              <VolunteerCard key={vol.id} vol={vol} />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.volEmptyState}>
            <Text style={styles.volEmptyIcon}>🔍</Text>
            <Text style={styles.volEmptyText}>Searching for nearby volunteers…</Text>
          </View>
        )}

        {/* ── ACTION BUTTONS ────────────────────────────────── */}
        <View style={styles.actions}>
          {/* Primary: I AM SAFE */}
          <Pressable
            style={({ pressed }) => [
              styles.btnSafe,
              pressed && styles.btnPressed,
              resolving && styles.btnDisabled,
            ]}
            onPress={() => setShowSafeModal(true)}
            disabled={resolving}
            accessibilityLabel="I am safe — resolve SOS"
          >
            <Text style={styles.btnSafeText}>
              {resolving ? '⏳ Resolving…' : '✅  I AM SAFE'}
            </Text>
          </Pressable>

          {/* Secondary row */}
          <View style={styles.actionsRow}>
            <Pressable
              style={({ pressed }) => [styles.btnFalseAlarm, pressed && styles.btnPressed]}
              onPress={handleFalseAlarm}
              disabled={resolving}
              accessibilityLabel="Report false alarm"
            >
              <Text style={styles.btnFalseAlarmText}>Report False Alarm</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.btnPolice, pressed && styles.btnPressed]}
              onPress={handlePolice}
              accessibilityLabel="Alert police via SMS"
            >
              <Text style={styles.btnPoliceText}>🚔  Alert Police</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* ── SAFE CONFIRMATION MODAL ──────────────────────────── */}
      <Modal
        transparent
        visible={showSafeModal}
        animationType="fade"
        onRequestClose={() => setShowSafeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalIcon}>✅</Text>
            <Text style={styles.modalTitle}>Confirm You're Safe</Text>
            <Text style={styles.modalBody}>
              This will stop your SOS, notify your contacts that you're safe, and
              dismiss all responding volunteers.
            </Text>
            <Pressable
              style={[styles.btnSafe, { marginTop: 16 }]}
              onPress={() => {
                setShowSafeModal(false);
                handleSafe();
              }}
            >
              <Text style={styles.btnSafeText}>Yes, I'm Safe</Text>
            </Pressable>
            <Pressable
              style={styles.modalCancel}
              onPress={() => setShowSafeModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel — Keep SOS Active</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const COLORS = {
  sosBg:       '#8B0000',
  sosAccent:   '#C0392B',
  safe:        '#1E8449',
  safeLight:   '#1A6637',
  police:      '#C0392B',
  bg:          '#0D0D0D',
  surface:     '#161625',
  surfaceHigh: '#1E1E35',
  border:      '#2A2A45',
  text:        '#FDFEFE',
  textMuted:   '#95A5A6',
  white:       '#FFFFFF',
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // ── Top bar ────────────────────────────────────────────────
  topBar: {
    backgroundColor: COLORS.sosBg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 12,
    zIndex: 10,
  },
  topBarInner: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0,
  },
  topBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pulsingDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FF6B6B',
    borderWidth: 2,
    borderColor: '#FFB3B3',
  },
  topBarCenter: {
    flex: 1,
    alignItems: 'center',
  },
  sosTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1,
  },
  liveIndicator: {
    color: '#FF6B6B',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: 2,
  },
  connectingIndicator: {
    color: '#FFCDD2',
    fontSize: 11,
    marginTop: 2,
  },
  timerBox: {
    alignItems: 'flex-end',
  },
  timerText: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  timerLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // ── Map ────────────────────────────────────────────────────
  mapSection: {
    height: '42%',
    position: 'relative',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    overflow: 'hidden',
  },
  webView: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mapPlaceholderIcon: { fontSize: 40 },
  mapPlaceholderTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  mapPlaceholderSub: { color: COLORS.textMuted, fontSize: 13 },
  mapPlaceholderHint: {
    color: '#4A4A6A',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  coordBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  coordText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },

  // ── Bottom panel ───────────────────────────────────────────
  bottomPanel: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },

  // Volunteer header
  volHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  volHeaderText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  respondingBadge: {
    backgroundColor: COLORS.safe + '33',
    borderColor: COLORS.safe,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  respondingText: {
    color: COLORS.safe,
    fontSize: 11,
    fontWeight: '700',
  },

  // Volunteer list
  volList: {
    flex: 1,
    marginBottom: 8,
  },

  // Empty state
  volEmptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    opacity: 0.6,
  },
  volEmptyIcon: { fontSize: 28 },
  volEmptyText: { color: COLORS.textMuted, fontSize: 13 },

  // Volunteer card
  volCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  volCardActive: {
    borderColor: COLORS.safe + '66',
    backgroundColor: COLORS.safe + '0D',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#2A2A4A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '800',
  },
  volInfo: {
    flex: 1,
    gap: 3,
  },
  volNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  volName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  tierBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tierText: {
    fontSize: 10,
    fontWeight: '700',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 1,
  },
  star: {
    color: '#F5C518',
    fontSize: 12,
  },
  volStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  etaText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
  },

  // ── Action buttons ─────────────────────────────────────────
  actions: {
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    gap: 8,
  },
  btnSafe: {
    backgroundColor: COLORS.safe,
    borderRadius: 14,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.safe,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  btnSafeText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  btnFalseAlarm: {
    flex: 1,
    backgroundColor: COLORS.surfaceHigh,
    borderRadius: 12,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnFalseAlarmText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  btnPolice: {
    flex: 1,
    backgroundColor: COLORS.police + '22',
    borderRadius: 12,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.police,
  },
  btnPoliceText: {
    color: COLORS.police,
    fontSize: 13,
    fontWeight: '700',
  },
  btnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // ── Safe modal ─────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 20,
  },
  modalIcon: {
    fontSize: 52,
    marginBottom: 12,
  },
  modalTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalBody: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  modalCancel: {
    marginTop: 12,
    paddingVertical: 10,
  },
  modalCancelText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
