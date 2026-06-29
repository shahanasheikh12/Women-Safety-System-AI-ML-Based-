/**
 * mobile/app/(tabs)/map.tsx
 * ──────────────────────────
 * SafeCircle — Full-screen Safety Intelligence Map
 *
 * Features:
 *   • Leaflet.js + OpenStreetMap via WebView (free, no API key)
 *   • Layer 1: User pulsing location dot + accuracy ring
 *   • Layer 2: Threat zone heatmap (critical/high/medium polygons)
 *   • Layer 3: Anonymised volunteer green shield icons
 *   • Layer 4: Active SOS flashing red dots (Tier 1+ volunteers only)
 *   • Top search bar with Nominatim autocomplete
 *   • Layer toggle panel
 *   • Slide-up bottom panel: safety summary / zone detail / safe route
 *   • Safe Route modal: 3 route options (fastest/safest/balanced)
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Keyboard,
  Linking,
  Modal,
  Platform,
  PanResponder,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { ThreatZoneMap, ThreatZoneMapRef } from '../../components/ThreatZoneMap';
import {
  fetchThreatZones,
  fetchNearbyVolunteers,
  fetchActiveSOS,
  calculateAreaSafetyScore,
  searchLocation,
  buildSafeRoutes,
  type ThreatZone,
  type AnonymousVolunteer,
  type AnonymousSOS,
  type SafetyScore,
  type NominatimResult,
  type SafeRoute,
} from '../../lib/safetyMap';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────
// Layer toggle state
// ─────────────────────────────────────────────────────────────
interface LayerState {
  threatZones: boolean;
  volunteers:  boolean;
  activeSOS:   boolean;
}

// ─────────────────────────────────────────────────────────────
// Bottom panel modes
// ─────────────────────────────────────────────────────────────
type PanelMode = 'summary' | 'zone_detail' | 'route';

// ─────────────────────────────────────────────────────────────
// Helper: safety score color
// ─────────────────────────────────────────────────────────────
function scoreRing(score: number): string {
  if (score >= 75) return Colors.safe;
  if (score >= 50) return '#D4AC0D';
  if (score >= 30) return Colors.warning;
  return Colors.primary;
}

// ─────────────────────────────────────────────────────────────
// SafeRouteModal
// ─────────────────────────────────────────────────────────────
function SafeRouteModal({
  visible,
  userLat,
  userLng,
  onClose,
  onSelectRoute,
}: {
  visible:        boolean;
  userLat:        number;
  userLng:        number;
  onClose:        () => void;
  onSelectRoute:  (route: SafeRoute) => void;
}) {
  const [destination,   setDestination]   = useState('');
  const [suggestions,   setSuggestions]   = useState<NominatimResult[]>([]);
  const [loadingSugg,   setLoadingSugg]   = useState(false);
  const [routes,        setRoutes]        = useState<SafeRoute[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [selectedDest,  setSelectedDest]  = useState<NominatimResult | null>(null);
  const [searchTimer,   setSearchTimer]   = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleDestinationChange = (text: string) => {
    setDestination(text);
    setSelectedDest(null);
    setRoutes([]);

    if (searchTimer) clearTimeout(searchTimer);
    if (text.length < 3) { setSuggestions([]); return; }

    const timer = setTimeout(async () => {
      setLoadingSugg(true);
      const results = await searchLocation(text);
      setSuggestions(results);
      setLoadingSugg(false);
    }, 400);
    setSearchTimer(timer);
  };

  const handleSelectSuggestion = async (result: NominatimResult) => {
    setSelectedDest(result);
    setDestination(result.display_name.split(',').slice(0, 2).join(', '));
    setSuggestions([]);
    Keyboard.dismiss();
    setLoadingRoutes(true);

    try {
      const toLat = parseFloat(result.lat);
      const toLng = parseFloat(result.lng);
      const built = await buildSafeRoutes(
        { lat: userLat, lng: userLng },
        { lat: toLat,   lng: toLng }
      );
      setRoutes(built);
    } catch {
      Alert.alert('Error', 'Could not calculate routes. Please try again.');
    } finally {
      setLoadingRoutes(false);
    }
  };

  const handleLaunchRoute = (route: SafeRoute) => {
    Linking.openURL(route.googleMapsUrl).catch(() =>
      Alert.alert('Could not open Maps', 'Please install Google Maps or Apple Maps.')
    );
    onSelectRoute(route);
    onClose();
  };

  const handleClose = () => {
    setDestination('');
    setSuggestions([]);
    setRoutes([]);
    setSelectedDest(null);
    onClose();
  };

  const routeIcons = { fastest: '⚡', safest: '🛡️', balanced: '⚖️' };
  const routeDescriptions = {
    fastest:  'Quickest path — may pass through some risk areas',
    safest:   'Avoids all high-risk zones — recommended at night',
    balanced: 'Good balance of speed and safety',
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={routeModal.overlay} />
      </TouchableWithoutFeedback>

      <View style={routeModal.sheet}>
        {/* Header */}
        <View style={routeModal.header}>
          <View style={routeModal.pill} />
          <Text style={routeModal.title}>🗺️ Get Safe Route</Text>
          <TouchableOpacity onPress={handleClose} style={routeModal.closeBtn}>
            <Text style={routeModal.closeTxt}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={routeModal.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* From (current location) */}
          <Text style={routeModal.label}>From</Text>
          <View style={routeModal.fromField}>
            <Text style={routeModal.fromEmoji}>📍</Text>
            <Text style={routeModal.fromText}>Your current location</Text>
          </View>

          {/* Destination input */}
          <Text style={routeModal.label}>Destination</Text>
          <TextInput
            style={routeModal.input}
            value={destination}
            onChangeText={handleDestinationChange}
            placeholder="Search area or landmark…"
            placeholderTextColor="#555"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />

          {/* Autocomplete suggestions */}
          {loadingSugg && (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 8 }} />
          )}
          {suggestions.length > 0 && (
            <View style={routeModal.suggestionList}>
              {suggestions.map((s) => (
                <TouchableOpacity
                  key={s.place_id}
                  style={routeModal.suggestion}
                  onPress={() => handleSelectSuggestion(s)}
                  activeOpacity={0.75}
                >
                  <Text style={routeModal.suggEmoji}>📌</Text>
                  <Text style={routeModal.suggText} numberOfLines={2}>
                    {s.display_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Loading routes */}
          {loadingRoutes && (
            <View style={routeModal.loadingBox}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={routeModal.loadingText}>Calculating safest route…</Text>
            </View>
          )}

          {/* Route options */}
          {routes.length > 0 && (
            <>
              <Text style={[routeModal.label, { marginTop: 20 }]}>Route Options</Text>
              {routes.map((route) => (
                <TouchableOpacity
                  key={route.option}
                  style={[routeModal.routeCard, { borderLeftColor: route.color }]}
                  onPress={() => handleLaunchRoute(route)}
                  activeOpacity={0.85}
                >
                  <View style={routeModal.routeHeader}>
                    <Text style={routeModal.routeIcon}>{routeIcons[route.option]}</Text>
                    <Text style={routeModal.routeLabel}>{route.label}</Text>
                    <View style={[routeModal.scoreBadge, { backgroundColor: route.color + '22', borderColor: route.color + '55' }]}>
                      <Text style={[routeModal.scoreText, { color: route.color }]}>
                        🛡 {route.safetyScore}
                      </Text>
                    </View>
                  </View>
                  <Text style={routeModal.routeDesc}>{routeDescriptions[route.option]}</Text>
                  <View style={routeModal.routeMeta}>
                    <Text style={routeModal.routeMetaItem}>⏱ {route.durationMin} min</Text>
                    <Text style={routeModal.routeMetaItem}>📏 {route.distanceKm} km</Text>
                  </View>
                  <View style={[routeModal.routeBtn, { backgroundColor: route.color }]}>
                    <Text style={routeModal.routeBtnText}>Navigate →</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const routeModal = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SCREEN_H * 0.88,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    borderTopWidth: 1,
    borderColor: '#2A2A3E',
  },
  header: {
    alignItems: 'center',
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderColor: '#2A2A3E',
    flexDirection: 'row',
  },
  pill: {
    position: 'absolute',
    top: 6,
    left: '50%',
    width: 36,
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    marginLeft: -18,
  },
  title:    { flex: 1, fontSize: 18, fontWeight: '800', color: Colors.text, textAlign: 'center', marginTop: 8 },
  closeBtn: { padding: 6, marginTop: 8 },
  closeTxt: { fontSize: 18, color: Colors.textMuted },
  scroll:   { paddingHorizontal: 18, paddingTop: 16 },

  label: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },

  fromField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#111122',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  fromEmoji: { fontSize: 16 },
  fromText:  { color: Colors.textMuted, fontSize: 14 },

  input: {
    backgroundColor: '#111122',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1.5,
    borderColor: Colors.primary + '55',
    marginBottom: 8,
  },

  suggestionList: {
    backgroundColor: '#111122',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    overflow: 'hidden',
    marginBottom: 8,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#1A1A2E',
  },
  suggEmoji: { fontSize: 14, marginTop: 2 },
  suggText:  { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 20 },

  loadingBox: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  loadingText: { color: Colors.textMuted, fontSize: 14 },

  routeCard: {
    backgroundColor: '#111122',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: '#2A2A3E',
    borderRightColor: '#2A2A3E',
    borderBottomColor: '#2A2A3E',
  },
  routeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  routeIcon:   { fontSize: 20 },
  routeLabel:  { flex: 1, fontSize: 14, fontWeight: '800', color: Colors.text },
  scoreBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  scoreText:   { fontSize: 11, fontWeight: '700' },
  routeDesc:   { fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 18 },
  routeMeta:   { flexDirection: 'row', gap: 12, marginBottom: 10 },
  routeMetaItem: { fontSize: 12, color: Colors.textMuted },
  routeBtn:   { borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  routeBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});

// ─────────────────────────────────────────────────────────────
// Layer Toggle Panel
// ─────────────────────────────────────────────────────────────
function LayerPanel({
  layers,
  onToggle,
  onClose,
  volunteerCount,
  sosCount,
  zoneCount,
}: {
  layers:         LayerState;
  onToggle:       (key: keyof LayerState) => void;
  onClose:        () => void;
  volunteerCount: number;
  sosCount:       number;
  zoneCount:      number;
}) {
  const items: Array<{ key: keyof LayerState; icon: string; label: string; count: number; countLabel: string }> = [
    { key: 'threatZones', icon: '🔥', label: 'Threat Zones', count: zoneCount, countLabel: 'zones' },
    { key: 'volunteers',  icon: '🛡️', label: 'Volunteers',   count: volunteerCount, countLabel: 'active' },
    { key: 'activeSOS',   icon: '🚨', label: 'Active SOS',   count: sosCount, countLabel: 'events' },
  ];

  return (
    <View style={layerPanel.wrap}>
      <View style={layerPanel.header}>
        <Text style={layerPanel.title}>Map Layers</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={layerPanel.close}>✕</Text>
        </TouchableOpacity>
      </View>
      {items.map((item) => (
        <TouchableOpacity
          key={item.key}
          style={layerPanel.row}
          onPress={() => onToggle(item.key)}
          activeOpacity={0.8}
        >
          <Text style={layerPanel.icon}>{item.icon}</Text>
          <View style={layerPanel.textWrap}>
            <Text style={layerPanel.label}>{item.label}</Text>
            <Text style={layerPanel.count}>{item.count} {item.countLabel}</Text>
          </View>
          <View style={[layerPanel.toggle, layers[item.key] && layerPanel.toggleOn]}>
            <View style={[layerPanel.knob, layers[item.key] && layerPanel.knobOn]} />
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const layerPanel = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 130,
    right: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    width: 220,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 99,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title:  { fontSize: 14, fontWeight: '800', color: Colors.text },
  close:  { fontSize: 16, color: Colors.textMuted, padding: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#1A1A2E',
  },
  icon:      { fontSize: 20 },
  textWrap:  { flex: 1 },
  label:     { fontSize: 13, fontWeight: '600', color: Colors.text },
  count:     { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  toggle:    { width: 40, height: 22, borderRadius: 11, backgroundColor: '#333', justifyContent: 'center', padding: 2 },
  toggleOn:  { backgroundColor: Colors.safe },
  knob:      { width: 18, height: 18, borderRadius: 9, backgroundColor: '#666' },
  knobOn:    { backgroundColor: '#fff', alignSelf: 'flex-end' },
});

// ─────────────────────────────────────────────────────────────
// Main MapScreen
// ─────────────────────────────────────────────────────────────
export default function MapScreen() {
  const mapRef = useRef<ThreatZoneMapRef>(null);

  // Location
  const [userLat, setUserLat] = useState(21.1458);
  const [userLng, setUserLng] = useState(79.0882);
  const [locationReady, setLocationReady] = useState(false);

  // Data
  const [threatZones,  setThreatZones]  = useState<ThreatZone[]>([]);
  const [volunteers,   setVolunteers]   = useState<AnonymousVolunteer[]>([]);
  const [activeSOS,    setActiveSOS]    = useState<AnonymousSOS[]>([]);
  const [safetyScore,  setSafetyScore]  = useState<SafetyScore | null>(null);
  const [userTier,     setUserTier]     = useState(0);

  // UI state
  const [loading,           setLoading]           = useState(true);
  const [mapReady,          setMapReady]           = useState(false);
  const [showLayerPanel,    setShowLayerPanel]     = useState(false);
  const [showRouteModal,    setShowRouteModal]     = useState(false);
  const [layers,            setLayers]             = useState<LayerState>({
    threatZones: true,
    volunteers:  true,
    activeSOS:   true,
  });
  const [selectedZone,      setSelectedZone]       = useState<ThreatZone | null>(null);
  const [panelMode,         setPanelMode]          = useState<PanelMode>('summary');

  // Search
  const [searchText,   setSearchText]   = useState('');
  const [suggestions,  setSuggestions]  = useState<NominatimResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Routes
  const [safeRoutes,    setSafeRoutes]    = useState<SafeRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<SafeRoute['option'] | null>(null);

  // Bottom panel slide animation
  const panelAnim   = useRef(new Animated.Value(0)).current;
  const PANEL_MIN_H = 130;
  const PANEL_MAX_H = 320;
  const [panelH, setPanelH] = useState(PANEL_MIN_H);

  // ── Get user's GPS + tier ─────────────────────────────────
  useEffect(() => {
    (async () => {
      // Get user tier (determines if activeSOS layer is visible)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from('users')
            .select('verification_tier')
            .eq('id', user.id)
            .single();
          setUserTier(data?.verification_tier ?? 0);
        }
      } catch {}

      // Get GPS
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLocationReady(true);
          loadMapData(userLat, userLng);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
        setLocationReady(true);
        loadMapData(loc.coords.latitude, loc.coords.longitude);
      } catch {
        setLocationReady(true);
        loadMapData(userLat, userLng);
      }
    })();

    // Refresh location every 30s (battery-friendly)
    const interval = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
      } catch {}
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  // ── Load all map data ─────────────────────────────────────
  const loadMapData = useCallback(async (lat: number, lng: number) => {
    setLoading(true);
    try {
      const [zones, vols, sos, score] = await Promise.allSettled([
        fetchThreatZones(lat, lng, 10),
        fetchNearbyVolunteers(lat, lng, 5),
        fetchActiveSOS(lat, lng, 5),
        calculateAreaSafetyScore(lat, lng),
      ]);

      if (zones.status     === 'fulfilled') setThreatZones(zones.value);
      if (vols.status      === 'fulfilled') setVolunteers(vols.value);
      if (sos.status       === 'fulfilled') setActiveSOS(sos.value);
      if (score.status     === 'fulfilled') setSafetyScore(score.value);
    } catch {}
    setLoading(false);
  }, []);

  // ── Layer toggles ─────────────────────────────────────────
  const toggleLayer = useCallback((key: keyof LayerState) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Re-center on user ─────────────────────────────────────
  const handleMyLocation = useCallback(() => {
    mapRef.current?.panTo(userLat, userLng);
  }, [userLat, userLng]);

  // ── Zone tap ──────────────────────────────────────────────
  const handleZoneTap = useCallback((zone: ThreatZone) => {
    setSelectedZone(zone);
    setPanelMode('zone_detail');
    // Expand panel
    Animated.spring(panelAnim, { toValue: 1, useNativeDriver: false }).start();
  }, []);

  // ── Search ────────────────────────────────────────────────
  const handleSearchChange = (text: string) => {
    setSearchText(text);
    setSuggestions([]);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.length < 3) return;
    searchTimer.current = setTimeout(async () => {
      setLoadingSearch(true);
      const results = await searchLocation(text);
      setSuggestions(results);
      setLoadingSearch(false);
    }, 400);
  };

  const handleSelectSearchResult = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lng);
    mapRef.current?.panTo(lat, lng);
    setSearchText(result.display_name.split(',').slice(0, 2).join(', '));
    setSuggestions([]);
    Keyboard.dismiss();
  };

  // ── Route selection ───────────────────────────────────────
  const handleRouteSelected = useCallback((route: SafeRoute) => {
    setSelectedRoute(route.option);
    setSafeRoutes([route]);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  const riskLabel: Record<string, string> = {
    critical: '🔴 Critical', high: '🟠 High', medium: '🟡 Medium',
  };

  const weekIncidents = threatZones.reduce((sum, z) => sum + z.incident_count, 0);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ── Full-screen map ── */}
      {locationReady && (
        <ThreatZoneMap
          ref={mapRef}
          userLat={userLat}
          userLng={userLng}
          threatZones={threatZones}
          volunteers={volunteers}
          activeSOS={userTier >= 1 ? activeSOS : []}
          showThreatZones={layers.threatZones}
          showVolunteers={layers.volunteers}
          showActiveSOS={layers.activeSOS && userTier >= 1}
          interactive
          safeRoutes={safeRoutes}
          selectedRoute={selectedRoute}
          onZoneTap={handleZoneTap}
          onMapReady={() => setMapReady(true)}
          onMapTap={() => {
            setSelectedZone(null);
            setPanelMode('summary');
            setSuggestions([]);
          }}
        />
      )}

      {/* Loading splash */}
      {(!locationReady || loading) && (
        <View style={styles.loadingSplash}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>
            {!locationReady ? 'Getting your location…' : 'Loading safety data…'}
          </Text>
        </View>
      )}

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        {/* Search bar */}
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchText}
            onChangeText={handleSearchChange}
            placeholder="Search area or landmark…"
            placeholderTextColor="#555"
            returnKeyType="search"
          />
          {loadingSearch && <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 8 }} />}
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchText(''); setSuggestions([]); }}>
              <Text style={{ color: Colors.textMuted, paddingRight: 10, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Layer toggle */}
        <TouchableOpacity
          style={[styles.iconBtn, showLayerPanel && { backgroundColor: Colors.primary + '33' }]}
          onPress={() => setShowLayerPanel(!showLayerPanel)}
        >
          <Text style={styles.iconBtnText}>⊞</Text>
        </TouchableOpacity>
      </View>

      {/* Search suggestions dropdown */}
      {suggestions.length > 0 && (
        <View style={styles.suggestionDropdown}>
          {suggestions.map((s) => (
            <TouchableOpacity
              key={s.place_id}
              style={styles.suggRow}
              onPress={() => handleSelectSearchResult(s)}
              activeOpacity={0.75}
            >
              <Text style={styles.suggPin}>📍</Text>
              <Text style={styles.suggName} numberOfLines={2}>{s.display_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Volunteer count badge (top) ── */}
      {volunteers.length > 0 && (
        <View style={styles.volunteerBadge}>
          <View style={styles.volunteerDot} />
          <Text style={styles.volunteerBadgeText}>
            {volunteers.length} volunteer{volunteers.length !== 1 ? 's' : ''} active nearby
          </Text>
        </View>
      )}

      {/* ── My location + Refresh buttons (right side) ── */}
      <View style={styles.rightBtns}>
        <TouchableOpacity style={styles.circleBtn} onPress={handleMyLocation}>
          <Text style={styles.circleBtnText}>◎</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.circleBtn} onPress={() => loadMapData(userLat, userLng)}>
          <Text style={styles.circleBtnText}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* ── Legend ── */}
      {layers.threatZones && (
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Risk Levels</Text>
          {[
            { color: '#C0392B', label: 'Critical' },
            { color: '#E67E22', label: 'High' },
            { color: '#F1C40F', label: 'Medium' },
          ].map((item) => (
            <View key={item.label} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <Text style={styles.legendLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Layer control panel ── */}
      {showLayerPanel && (
        <LayerPanel
          layers={layers}
          onToggle={toggleLayer}
          onClose={() => setShowLayerPanel(false)}
          volunteerCount={volunteers.length}
          sosCount={activeSOS.length}
          zoneCount={threatZones.length}
        />
      )}

      {/* ── Bottom slide-up panel ── */}
      <View style={styles.bottomPanel}>
        {/* Panel drag handle */}
        <View style={styles.panelHandle} />

        {/* SUMMARY MODE */}
        {panelMode === 'summary' && (
          <>
            <View style={styles.summaryHeader}>
              <View>
                <Text style={styles.summaryTitle}>Safety Summary</Text>
                <Text style={styles.summaryArea} numberOfLines={1}>
                  {safetyScore ? `${safetyScore.label} — ${safetyScore.score}/100` : 'Loading…'}
                </Text>
              </View>
              {safetyScore && (
                <View style={[styles.scoreRing, { borderColor: scoreRing(safetyScore.score) }]}>
                  <Text style={[styles.scoreValue, { color: scoreRing(safetyScore.score) }]}>
                    {safetyScore.score}
                  </Text>
                  <Text style={styles.scoreSubtxt}>/ 100</Text>
                </View>
              )}
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={[styles.statVal, { color: Colors.safe }]}>{volunteers.length}</Text>
                <Text style={styles.statLbl}>Volunteers{'\n'}Nearby</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statVal, { color: Colors.warning }]}>{weekIncidents}</Text>
                <Text style={styles.statLbl}>Incidents{'\n'}This Week</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statVal, { color: scoreRing(safetyScore?.score ?? 50) }]}>
                  {safetyScore?.score ?? '—'}
                </Text>
                <Text style={styles.statLbl}>Your Safety{'\n'}Score</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.safeRouteBtn}
              onPress={() => setShowRouteModal(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.safeRouteBtnIcon}>🗺️</Text>
              <Text style={styles.safeRouteBtnText}>Get Safe Route</Text>
              <Text style={styles.safeRouteArrow}>→</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ZONE DETAIL MODE */}
        {panelMode === 'zone_detail' && selectedZone && (
          <>
            <View style={styles.zoneDetailHeader}>
              <Text style={styles.zoneDetailTitle}>
                {riskLabel[selectedZone.risk_level] ?? '⚠️ Risk Zone'}
              </Text>
              <TouchableOpacity onPress={() => setPanelMode('summary')}>
                <Text style={styles.zoneDetailClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.zoneStats}>
              <View style={styles.zoneStatItem}>
                <Text style={styles.zoneStatVal}>{selectedZone.incident_count}</Text>
                <Text style={styles.zoneStatLbl}>Incidents (30d)</Text>
              </View>
              <View style={styles.zoneStatItem}>
                <Text style={styles.zoneStatVal}>
                  {new Date(selectedZone.last_updated).toLocaleDateString('en-IN')}
                </Text>
                <Text style={styles.zoneStatLbl}>Last Updated</Text>
              </View>
            </View>
            <Text style={styles.zoneAdvice}>
              {selectedZone.risk_level === 'critical'
                ? '⚠️ Avoid this area. If you must pass through, stay aware and keep emergency contacts ready.'
                : selectedZone.risk_level === 'high'
                ? '🔶 Exercise caution in this area. Travel with a companion when possible.'
                : '🟡 This area has moderate risk. Stay aware of your surroundings.'}
            </Text>
            <TouchableOpacity
              style={styles.safeRouteBtn}
              onPress={() => { setPanelMode('summary'); setShowRouteModal(true); }}
            >
              <Text style={styles.safeRouteBtnIcon}>🗺️</Text>
              <Text style={styles.safeRouteBtnText}>Get Safe Route Around This Zone</Text>
              <Text style={styles.safeRouteArrow}>→</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Safe Route Modal ── */}
      <SafeRouteModal
        visible={showRouteModal}
        userLat={userLat}
        userLng={userLng}
        onClose={() => setShowRouteModal(false)}
        onSelectRoute={handleRouteSelected}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const TOP_BAR_TOP  = Platform.OS === 'ios' ? 54 : 36;
const BOTTOM_SAFE  = Platform.OS === 'ios' ? 90 : 70;  // tab bar height

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  loadingSplash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    gap: 16,
  },
  loadingText: { color: Colors.textMuted, fontSize: 14 },

  // ── Top bar ───────────────────────────────────────────────
  topBar: {
    position: 'absolute',
    top: TOP_BAR_TOP,
    left: 14,
    right: 14,
    flexDirection: 'row',
    gap: 8,
    zIndex: 50,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,38,0.96)',
    borderRadius: 14,
    paddingLeft: 12,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  searchIcon:  { fontSize: 16, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 12, paddingRight: 8 },
  iconBtn: {
    width: 48,
    height: 48,
    backgroundColor: 'rgba(20,20,38,0.96)',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  iconBtnText: { fontSize: 22, color: Colors.text },

  // ── Search dropdown ───────────────────────────────────────
  suggestionDropdown: {
    position: 'absolute',
    top: TOP_BAR_TOP + 58,
    left: 14,
    right: 14 + 56,
    backgroundColor: 'rgba(20,20,38,0.98)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    zIndex: 60,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 12,
  },
  suggRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#1A1A2E',
  },
  suggPin:  { fontSize: 14, marginTop: 2 },
  suggName: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 19 },

  // ── Volunteer badge ───────────────────────────────────────
  volunteerBadge: {
    position: 'absolute',
    top: TOP_BAR_TOP + 62,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(30,132,73,0.18)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.safe + '44',
    zIndex: 40,
  },
  volunteerDot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: Colors.safe },
  volunteerBadgeText: { color: Colors.safe, fontSize: 12, fontWeight: '700' },

  // ── Right side buttons ────────────────────────────────────
  rightBtns: {
    position: 'absolute',
    right: 14,
    bottom: BOTTOM_SAFE + 168,
    gap: 8,
    zIndex: 40,
  },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(20,20,38,0.96)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  circleBtnText: { fontSize: 22, color: Colors.text },

  // ── Legend ────────────────────────────────────────────────
  legend: {
    position: 'absolute',
    left: 14,
    bottom: BOTTOM_SAFE + 168,
    backgroundColor: 'rgba(20,20,38,0.92)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    gap: 5,
    zIndex: 40,
  },
  legendTitle: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 },
  legendRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:   { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 11, color: Colors.text, fontWeight: '600' },

  // ── Bottom panel ──────────────────────────────────────────
  bottomPanel: {
    position: 'absolute',
    bottom: BOTTOM_SAFE,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(20,20,38,0.97)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderColor: '#2A2A3E',
    zIndex: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 15,
  },
  panelHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },

  // Summary
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  summaryTitle: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  summaryArea:  { fontSize: 16, fontWeight: '800', color: Colors.text, marginTop: 2 },

  scoreRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreValue:  { fontSize: 18, fontWeight: '900', lineHeight: 22 },
  scoreSubtxt: { fontSize: 9, color: Colors.textMuted },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statCard: {
    flex: 1,
    backgroundColor: '#111122',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  statVal: { fontSize: 22, fontWeight: '900' },
  statLbl: { fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: 2 },

  safeRouteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 18,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  safeRouteBtnIcon: { fontSize: 20 },
  safeRouteBtnText: { flex: 1, fontSize: 15, fontWeight: '700', color: '#fff' },
  safeRouteArrow:   { fontSize: 18, color: 'rgba(255,255,255,0.7)' },

  // Zone detail
  zoneDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  zoneDetailTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },
  zoneDetailClose: { fontSize: 18, color: Colors.textMuted, padding: 4 },
  zoneStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  zoneStatItem: {
    flex: 1,
    backgroundColor: '#111122',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  zoneStatVal: { fontSize: 18, fontWeight: '800', color: Colors.primary },
  zoneStatLbl: { fontSize: 10, color: Colors.textMuted, marginTop: 3, textAlign: 'center' },
  zoneAdvice: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 20,
    marginBottom: 12,
    backgroundColor: 'rgba(192,57,43,0.07)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
});
