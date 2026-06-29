/**
 * mobile/components/ThreatZoneMap.tsx
 * ──────────────────────────────────────
 * Reusable Leaflet.js map component powered by react-native-webview.
 *
 * Props:
 *   userLat / userLng        – user GPS position
 *   sosLocation              – override center (active SOS screen)
 *   threatZones              – ThreatZone[] from safetyMap.ts
 *   volunteers               – AnonymousVolunteer[] (green shield icons)
 *   activeSOS                – AnonymousSOS[] (flashing red dots)
 *   showThreatZones          – toggle heatmap layer
 *   showVolunteers           – toggle volunteer layer
 *   showActiveSOS            – toggle active SOS layer
 *   interactive              – enable/disable tap events
 *   height                   – component height (default: flex 1)
 *   onZoneTap                – callback when a threat zone is tapped
 *   onMapReady               – callback when Leaflet finishes loading
 *   safeRoutes               – SafeRoute[] to draw on the map
 *   selectedRoute            – which route is highlighted
 */

import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import type {
  ThreatZone,
  AnonymousVolunteer,
  AnonymousSOS,
  SafeRoute,
} from '../lib/safetyMap';

// ── Optional WebView (lazy-require so app compiles without it) ──
type WVType = React.ComponentType<{
  source:               { html: string };
  style?:               object;
  onMessage?:           (e: { nativeEvent: { data: string } }) => void;
  ref?:                 React.Ref<{ postMessage: (msg: string) => void }>;
  javaScriptEnabled?:   boolean;
  scrollEnabled?:       boolean;
  allowsInlineMediaPlayback?: boolean;
  originWhitelist?:     string[];
  mixedContentMode?:    'never' | 'always' | 'compatibility';
}>;

let WebView: WVType | null = null;
try {
  WebView = require('react-native-webview').WebView;
} catch {
  // react-native-webview not installed
}

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
export interface ThreatZoneMapProps {
  userLat?:           number;
  userLng?:           number;
  sosLocation?:       { lat: number; lng: number };
  threatZones?:       ThreatZone[];
  volunteers?:        AnonymousVolunteer[];
  activeSOS?:         AnonymousSOS[];
  showThreatZones?:   boolean;
  showVolunteers?:    boolean;
  showActiveSOS?:     boolean;
  interactive?:       boolean;
  height?:            number;
  onZoneTap?:         (zone: ThreatZone) => void;
  onMapTap?:          (lat: number, lng: number) => void;
  onMapReady?:        () => void;
  safeRoutes?:        SafeRoute[];
  selectedRoute?:     'fastest' | 'safest' | 'balanced' | null;
}

export interface ThreatZoneMapRef {
  /** Re-center map on a given coordinate */
  panTo: (lat: number, lng: number) => void;
  /** Tell the webview to reload/re-draw threat zones */
  refresh: () => void;
}

// ─────────────────────────────────────────────────────────────
// Leaflet HTML builder
// ─────────────────────────────────────────────────────────────

function buildLeafletHTML(props: ThreatZoneMapProps): string {
  const {
    userLat = 21.1458,   // Nagpur center as default
    userLng = 79.0882,
    sosLocation,
    threatZones = [],
    volunteers  = [],
    activeSOS   = [],
    showThreatZones = true,
    showVolunteers  = true,
    showActiveSOS   = true,
    interactive     = true,
    safeRoutes      = [],
    selectedRoute   = null,
  } = props;

  const centerLat = sosLocation?.lat ?? userLat;
  const centerLng = sosLocation?.lng ?? userLng;
  const zoom      = sosLocation ? 16 : 14;

  // Risk level color map
  const riskColors: Record<string, { fill: string; opacity: number }> = {
    critical: { fill: '#C0392B', opacity: 0.42 },
    high:     { fill: '#E67E22', opacity: 0.38 },
    medium:   { fill: '#F1C40F', opacity: 0.30 },
    low:      { fill: '#2ECC71', opacity: 0.18 },
  };

  // Route colors
  const routeColors = {
    fastest:  '#E74C3C',
    safest:   '#1E8449',
    balanced: '#F39C12',
  };

  // Serialise data for injection
  const threatZonesJSON  = JSON.stringify(
    showThreatZones ? threatZones.map((z) => ({
      id:             z.id,
      center_lat:     z.center_lat,
      center_lng:     z.center_lng,
      risk_level:     z.risk_level,
      incident_count: z.incident_count,
      geojson:        z.geojson,
    })) : []
  );
  const volunteersJSON   = JSON.stringify(showVolunteers ? volunteers : []);
  const activeSosJSON    = JSON.stringify(showActiveSOS  ? activeSOS  : []);
  const safeRoutesJSON   = JSON.stringify(safeRoutes);
  const selectedRouteStr = JSON.stringify(selectedRoute);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #map { width: 100%; height: 100%; background: #0D0D0D; }

  /* ── Popups ── */
  .leaflet-popup-content-wrapper {
    background: #1A1A2E;
    color: #FDFEFE;
    border: 1px solid #2A2A3E;
    border-radius: 12px;
    font-family: -apple-system, 'Helvetica Neue', sans-serif;
  }
  .leaflet-popup-tip { background: #1A1A2E; }
  .leaflet-popup-content { margin: 10px 14px; font-size: 13px; line-height: 1.6; }
  .popup-title { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
  .popup-stat  { font-size: 12px; color: #BDC3C7; margin: 2px 0; }
  .popup-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .badge-critical { background: rgba(192,57,43,0.25); color: #E74C3C; }
  .badge-high     { background: rgba(230,126,34,0.25); color: #E67E22; }
  .badge-medium   { background: rgba(241,196,15,0.25); color: #F1C40F; }

  /* ── SOS flash animation ── */
  @keyframes sos-pulse {
    0%   { transform: scale(1);   opacity: 1; }
    50%  { transform: scale(1.6); opacity: 0.4; }
    100% { transform: scale(1);   opacity: 1; }
  }
  .sos-dot-inner { animation: sos-pulse 1.2s ease-in-out infinite; }

  /* ── User location pulse ── */
  @keyframes user-pulse {
    0%   { transform: scale(1);   opacity: 0.8; }
    70%  { transform: scale(2.2); opacity: 0; }
    100% { transform: scale(1);   opacity: 0; }
  }
  .user-pulse-ring { animation: user-pulse 2s ease-out infinite; }
</style>
</head>
<body>
<div id="map"></div>
<script>
(function() {
  // ── Init map ──────────────────────────────────────────────
  const map = L.map('map', {
    center:            [${centerLat}, ${centerLng}],
    zoom:              ${zoom},
    zoomControl:       false,
    attributionControl: false,
    dragging:          ${interactive},
    scrollWheelZoom:   ${interactive},
    doubleClickZoom:   ${interactive},
    touchZoom:         ${interactive},
  });

  // Dark OpenStreetMap tile
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
  }).addTo(map);

  // ── Data from React Native ────────────────────────────────
  const threatZones  = ${threatZonesJSON};
  const volunteers   = ${volunteersJSON};
  const activeSosArr = ${activeSosJSON};
  const safeRoutes   = ${safeRoutesJSON};
  const selectedRoute = ${selectedRouteStr};

  // ── Layer groups ──────────────────────────────────────────
  const zoneLayer      = L.layerGroup().addTo(map);
  const volunteerLayer = L.layerGroup().addTo(map);
  const sosLayer       = L.layerGroup().addTo(map);
  const routeLayer     = L.layerGroup().addTo(map);
  const userLayer      = L.layerGroup().addTo(map);

  // ─────────────────────────────────────────────────────────
  // Layer 1 — User location (blue pulsing dot)
  // ─────────────────────────────────────────────────────────
  const userLat = ${centerLat};
  const userLng = ${centerLng};

  const userIcon = L.divIcon({
    className: '',
    html: \`<div style="position:relative;width:24px;height:24px;">
      <div class="user-pulse-ring" style="
        position:absolute;top:0;left:0;
        width:24px;height:24px;border-radius:50%;
        background:rgba(52,152,219,0.4);border:2px solid rgba(52,152,219,0.7);
      "></div>
      <div style="
        position:absolute;top:6px;left:6px;
        width:12px;height:12px;border-radius:50%;
        background:#3498DB;border:2px solid #fff;
        box-shadow:0 0 8px rgba(52,152,219,0.8);
      "></div>
    </div>\`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

  L.marker([userLat, userLng], { icon: userIcon })
    .addTo(userLayer)
    .bindPopup('<div class="popup-title">📍 Your Location</div><div class="popup-stat">This is your current position</div>');

  // Accuracy circle (placeholder ~100m radius)
  L.circle([userLat, userLng], {
    radius: 100,
    color: '#3498DB',
    fillColor: '#3498DB',
    fillOpacity: 0.06,
    weight: 1,
    dashArray: '4 4',
  }).addTo(userLayer);

  // ─────────────────────────────────────────────────────────
  // Layer 2 — Threat Zone Heatmap
  // ─────────────────────────────────────────────────────────
  const riskColors = {
    critical: { fill: '#C0392B', opacity: 0.42 },
    high:     { fill: '#E67E22', opacity: 0.38 },
    medium:   { fill: '#F1C40F', opacity: 0.30 },
    low:      { fill: '#2ECC71', opacity: 0.18 },
  };

  const riskEmoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };

  threatZones.forEach(function(zone) {
    const cfg    = riskColors[zone.risk_level] || riskColors.medium;
    const emoji  = riskEmoji[zone.risk_level] || '🟡';
    const rLabel = zone.risk_level.charAt(0).toUpperCase() + zone.risk_level.slice(1);

    const popupHTML = \`
      <div class="popup-title">\${emoji} \${rLabel} Risk Zone</div>
      <span class="popup-badge badge-\${zone.risk_level}">\${rLabel}</span>
      <div class="popup-stat">🚨 <b>\${zone.incident_count}</b> incident\${zone.incident_count !== 1 ? 's' : ''} in last 30 days</div>
      <div class="popup-stat" style="margin-top:4px;font-size:11px;color:#95A5A6;">Tap map to dismiss</div>
    \`;

    // Draw GeoJSON polygon if available, otherwise draw a circle
    if (zone.geojson && (zone.geojson.type === 'Polygon' || zone.geojson.type === 'Feature')) {
      try {
        L.geoJSON(zone.geojson, {
          style: {
            color:       cfg.fill,
            fillColor:   cfg.fill,
            fillOpacity: cfg.opacity,
            weight:      1.5,
            opacity:     0.7,
          },
        })
        .bindPopup(popupHTML)
        .on('click', function() {
          sendMessage({ type: 'zone_tap', zone_id: zone.id });
        })
        .addTo(zoneLayer);
      } catch(e) {
        // Fallback: circle
        drawZoneCircle(zone, cfg, popupHTML);
      }
    } else {
      drawZoneCircle(zone, cfg, popupHTML);
    }
  });

  function drawZoneCircle(zone, cfg, popupHTML) {
    // Radius approximation: larger radius for more incidents
    const radius = Math.min(600, 150 + zone.incident_count * 25);
    L.circle([zone.center_lat, zone.center_lng], {
      radius:      radius,
      color:       cfg.fill,
      fillColor:   cfg.fill,
      fillOpacity: cfg.opacity,
      weight:      1.5,
      opacity:     0.7,
    })
    .bindPopup(popupHTML)
    .on('click', function() {
      sendMessage({ type: 'zone_tap', zone_id: zone.id });
    })
    .addTo(zoneLayer);
  }

  // ─────────────────────────────────────────────────────────
  // Layer 3 — Nearby Volunteers (green shield icons)
  // ─────────────────────────────────────────────────────────
  const tierColors = ['#95A5A6', '#27AE60', '#2980B9', '#8E44AD'];

  volunteers.forEach(function(vol) {
    const tierColor = tierColors[vol.verification_tier] || tierColors[1];
    const tierLabel = ['Unverified', 'Basic', 'Community', 'Champion'][vol.verification_tier] || 'Verified';

    const volIcon = L.divIcon({
      className: '',
      html: \`<div style="
        width:28px;height:28px;border-radius:50%;
        background:\${tierColor};
        border:2px solid rgba(255,255,255,0.6);
        display:flex;align-items:center;justify-content:center;
        font-size:14px;
        box-shadow:0 2px 8px rgba(0,0,0,0.5);
        cursor:pointer;
      ">🛡️</div>\`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    L.marker([vol.lat, vol.lng], { icon: volIcon })
      .bindPopup(\`
        <div class="popup-title">🛡️ Verified Volunteer</div>
        <div class="popup-stat">Tier: <b>\${tierLabel}</b></div>
        <div class="popup-stat" style="color:#27AE60;">● Active now</div>
        <div class="popup-stat" style="font-size:10px;color:#7F8C8D;margin-top:4px;">Identity protected</div>
      \`)
      .addTo(volunteerLayer);
  });

  // ─────────────────────────────────────────────────────────
  // Layer 4 — Active SOS events (flashing red dots)
  // ─────────────────────────────────────────────────────────
  activeSosArr.forEach(function(sos) {
    const elapsedMin = Math.round((Date.now() - new Date(sos.started_at).getTime()) / 60000);

    const sosIcon = L.divIcon({
      className: '',
      html: \`<div style="position:relative;width:20px;height:20px;">
        <div class="sos-dot-inner" style="
          position:absolute;top:0;left:0;
          width:20px;height:20px;border-radius:50%;
          background:rgba(192,57,43,0.35);
          border:2px solid #C0392B;
        "></div>
        <div style="
          position:absolute;top:5px;left:5px;
          width:10px;height:10px;border-radius:50%;
          background:#C0392B;
          box-shadow:0 0 10px rgba(192,57,43,0.9);
        "></div>
      </div>\`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    L.marker([sos.lat, sos.lng], { icon: sosIcon })
      .bindPopup(\`
        <div class="popup-title" style="color:#E74C3C;">🚨 Active Emergency</div>
        <div class="popup-stat">Active for <b>\${elapsedMin} min</b></div>
        <div class="popup-stat" style="font-size:10px;color:#7F8C8D;">Victim identity protected</div>
      \`)
      .addTo(sosLayer);
  });

  // ─────────────────────────────────────────────────────────
  // Safe Routes
  // ─────────────────────────────────────────────────────────
  const routeStyleMap = {
    fastest:  { color: '#E74C3C', weight: 4, dashArray: null },
    safest:   { color: '#1E8449', weight: 5, dashArray: null },
    balanced: { color: '#F39C12', weight: 4, dashArray: '8 4' },
  };

  safeRoutes.forEach(function(route) {
    if (!route.waypoints || route.waypoints.length < 2) return;
    const isSelected = selectedRoute === route.option;
    const style = routeStyleMap[route.option] || routeStyleMap.fastest;

    const opacity = isSelected ? 0.95 : 0.4;
    const weight  = isSelected ? style.weight + 2 : style.weight;

    const poly = L.polyline(route.waypoints, {
      color:     style.color,
      weight:    weight,
      opacity:   opacity,
      dashArray: style.dashArray,
      lineCap:   'round',
      lineJoin:  'round',
    })
    .bindPopup(\`
      <div class="popup-title">\${route.label}</div>
      <div class="popup-stat">⏱ \${route.durationMin} min · \${route.distanceKm} km</div>
      <div class="popup-stat">🛡️ Safety: <b>\${route.safetyScore}/100</b></div>
      <div class="popup-stat" style="font-size:11px;color:#BDC3C7;">\${route.description}</div>
    \`)
    .on('click', function() {
      sendMessage({ type: 'route_tap', option: route.option });
    })
    .addTo(routeLayer);

    // Route labels
    if (isSelected) {
      const midIdx = Math.floor(route.waypoints.length / 2);
      const midPt  = route.waypoints[midIdx] || route.waypoints[0];
      L.marker(midPt, {
        icon: L.divIcon({
          className: '',
          html: \`<div style="
            background:\${style.color};color:#fff;padding:3px 8px;
            border-radius:10px;font-size:10px;font-weight:700;
            white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.5);
          ">\${route.label}</div>\`,
          iconAnchor: [40, 10],
        }),
      }).addTo(routeLayer);
    }
  });

  // ─────────────────────────────────────────────────────────
  // Map click events → React Native
  // ─────────────────────────────────────────────────────────
  if (${interactive}) {
    map.on('click', function(e) {
      sendMessage({ type: 'map_tap', lat: e.latlng.lat, lng: e.latlng.lng });
    });
  }

  // ─────────────────────────────────────────────────────────
  // postMessage bridge → React Native
  // ─────────────────────────────────────────────────────────
  function sendMessage(data) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(data));
    }
  }

  // ─────────────────────────────────────────────────────────
  // React Native → WebView commands
  // ─────────────────────────────────────────────────────────
  window.handleRNMessage = function(msgStr) {
    try {
      const msg = JSON.parse(msgStr);
      if (msg.type === 'pan_to') {
        map.setView([msg.lat, msg.lng], msg.zoom || 15, { animate: true });
      } else if (msg.type === 'set_zoom') {
        map.setZoom(msg.zoom, { animate: true });
      } else if (msg.type === 'toggle_layer') {
        const layerMap = {
          zones:       zoneLayer,
          volunteers:  volunteerLayer,
          sos:         sosLayer,
          routes:      routeLayer,
        };
        const layer = layerMap[msg.layer];
        if (layer) {
          if (msg.visible) { map.addLayer(layer); }
          else             { map.removeLayer(layer); }
        }
      }
    } catch(e) {}
  };

  // Signal ready
  setTimeout(function() {
    sendMessage({ type: 'ready', volunteer_count: volunteers.length, sos_count: activeSosArr.length });
  }, 500);

})();
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Fallback — shown if WebView is not installed
// ─────────────────────────────────────────────────────────────
import { Text } from 'react-native';

function WebViewFallback() {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>
        📦 Install react-native-webview:{'\n'}
        npx expo install react-native-webview
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
export const ThreatZoneMap = forwardRef<ThreatZoneMapRef, ThreatZoneMapProps>(
  function ThreatZoneMap(props, ref) {
    const { height, onZoneTap, onMapTap, onMapReady, threatZones = [] } = props;
    const webViewRef = useRef<{ postMessage: (msg: string) => void } | null>(null);

    // Expose imperative methods to parent via ref
    useImperativeHandle(ref, () => ({
      panTo(lat: number, lng: number) {
        webViewRef.current?.postMessage(JSON.stringify({ type: 'pan_to', lat, lng, zoom: 15 }));
      },
      refresh() {
        // Reload happens via key change in parent — just pan to user for now
        if (props.userLat && props.userLng) {
          webViewRef.current?.postMessage(
            JSON.stringify({ type: 'pan_to', lat: props.userLat, lng: props.userLng })
          );
        }
      },
    }));

    const handleMessage = (e: { nativeEvent: { data: string } }) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);
        switch (msg.type) {
          case 'ready':
            onMapReady?.();
            break;
          case 'zone_tap': {
            const zone = threatZones.find((z) => z.id === msg.zone_id);
            if (zone) onZoneTap?.(zone);
            break;
          }
          case 'map_tap':
            onMapTap?.(msg.lat, msg.lng);
            break;
        }
      } catch {}
    };

    if (!WebView) {
      return <WebViewFallback />;
    }

    const html = buildLeafletHTML(props);

    return (
      <View style={[styles.container, height ? { height } : { flex: 1 }]}>
        <WebView
          ref={webViewRef as any}
          source={{ html }}
          style={styles.webView}
          javaScriptEnabled
          scrollEnabled={false}
          allowsInlineMediaPlayback
          originWhitelist={['*']}
          mixedContentMode={Platform.OS === 'android' ? 'compatibility' : undefined}
          onMessage={handleMessage}
        />
      </View>
    );
  }
);

ThreatZoneMap.displayName = 'ThreatZoneMap';
export default ThreatZoneMap;

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  webView:   { flex: 1, backgroundColor: '#0D0D0D' },
  fallback:  {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    padding: 24,
  },
  fallbackText: {
    color: '#BDC3C7',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
