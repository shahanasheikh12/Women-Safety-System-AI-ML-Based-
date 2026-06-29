import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Alert,
  Dimensions,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Colors from '../constants/Colors';
import {
  suggestRoutes,
  geocodeAddress,
  formatDuration,
  getRouteColor,
  SuggestRouteResponse,
} from '../lib/safeRoute';

const { width, height } = Dimensions.get('window');

// Helper to calculate distance in km between two points
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function SafeRouteScreen() {
  // Screen views: 'input' | 'options' | 'navigation'
  const [screenMode, setScreenMode] = useState<'input' | 'options' | 'navigation'>('input');
  const [loading, setLoading] = useState(false);

  // Locations
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [originName, setOriginName] = useState('My Location');
  const [destQuery, setDestQuery] = useState('');
  const [destSuggestions, setDestSuggestions] = useState<any[]>([]);
  const [destination, setDestination] = useState<{ lat: number; lng: number; display_name: string } | null>(null);

  // Routes
  const [routes, setRoutes] = useState<SuggestRouteResponse[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  
  // Live GPS tracking
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showProximityWarning, setShowProximityWarning] = useState(false);

  const webViewRef = useRef<WebView>(null);
  const locationSubRef = useRef<any>(null);

  // Fetch initial location
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Location permissions are required for safe routing.');
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setOrigin(coords);
        setCurrentLocation(coords);
      } catch (err) {
        console.error('Error fetching initial location:', err);
      }
    })();
  }, []);

  // Live tracking during navigation mode
  useEffect(() => {
    if (screenMode === 'navigation') {
      startLiveTracking();
    } else {
      stopLiveTracking();
    }
    return () => stopLiveTracking();
  }, [screenMode, selectedRouteIndex, routes]);

  const startLiveTracking = async () => {
    try {
      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 3000,
          distanceInterval: 5,
        },
        (loc) => {
          const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setCurrentLocation(coords);
          
          // Send location update to WebView
          webViewRef.current?.postMessage(
            JSON.stringify({ type: 'update_location', lat: coords.lat, lng: coords.lng })
          );

          // Check proximity to warning zones (50 meters threshold)
          checkWarningProximity(coords.lat, coords.lng);
        }
      );
    } catch (err) {
      console.error('Error starting live tracking:', err);
    }
  };

  const stopLiveTracking = () => {
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
  };

  const checkWarningProximity = (lat: number, lng: number) => {
    const activeRoute = routes[selectedRouteIndex];
    if (!activeRoute || !activeRoute.warning_zones) return;

    let warningActive = false;
    for (const zone of activeRoute.warning_zones) {
      const dist = calculateDistance(lat, lng, zone.lat, zone.lng);
      if (dist <= 0.05) { // 50 meters
        warningActive = true;
        break;
      }
    }

    if (warningActive && !showProximityWarning) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
    setShowProximityWarning(warningActive);
  };

  // Address search query handler
  const handleDestSearch = async (text: string) => {
    setDestQuery(text);
    if (text.length >= 3) {
      const results = await geocodeAddress(text);
      setDestSuggestions(results);
    } else {
      setDestSuggestions([]);
    }
  };

  const selectDestination = (item: any) => {
    setDestination({
      lat: item.lat,
      lng: item.lng,
      display_name: item.display_name,
    });
    setDestQuery(item.display_name);
    setDestSuggestions([]);
  };

  // Request routes
  const handleFindRoutes = async () => {
    if (!origin || !destination) {
      Alert.alert('Missing Info', 'Please set destination point.');
      return;
    }

    setLoading(true);
    try {
      const suggested = await suggestRoutes(origin, { lat: destination.lat, lng: destination.lng });
      if (suggested.length === 0) {
        Alert.alert('No Routes Found', 'Could not locate any safe walking routes.');
        return;
      }
      setRoutes(suggested);
      setSelectedRouteIndex(0);
      setScreenMode('options');
    } catch (err: any) {
      Alert.alert('Routing Error', err.message || 'Failed to request safe routes.');
    } finally {
      setLoading(false);
    }
  };

  // Synchronizes routes to map when WebView loads
  const handleMapLoad = () => {
    if (!origin || !destination || routes.length === 0) return;

    // Send markers and paths to Leaflet inside WebView
    const webviewMsg = {
      type: 'init_routing',
      origin: origin,
      destination: { lat: destination.lat, lng: destination.lng },
      routes: routes.map((r, idx) => ({
        index: idx,
        color: getRouteColor(r.safety_score),
        coordinates: r.geometry.coordinates.map((c) => [c[1], c[0]]), // convert [lng, lat] to [lat, lng]
      })),
      selectedRouteIndex: selectedRouteIndex,
      warningZones: routes[selectedRouteIndex]?.warning_zones || [],
    };

    webViewRef.current?.postMessage(JSON.stringify(webviewMsg));
  };

  // Select alternative route
  const selectRoute = (index: number) => {
    setSelectedRouteIndex(index);
    Haptics.selectionAsync().catch(() => {});
    webViewRef.current?.postMessage(
      JSON.stringify({ type: 'select_route', index: index })
    );
  };

  // Google Maps navigation deep link
  const startExternalNavigation = () => {
    if (!destination) return;
    const lat = origin?.lat || currentLocation?.lat;
    const lng = origin?.lng || currentLocation?.lng;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${destination.lat},${destination.lng}&travelmode=walking`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to launch Google Maps.');
    });
  };

  // Complete navigation
  const handleArrivedSafely = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert('Arrived Safely', 'Glad you made it safely! Your routing logs have been recorded.', [
      { text: 'Back to Home', onPress: () => router.replace('/(tabs)/home') },
    ]);
  };

  // HTML Source for the Leaflet WebView Map
  const mapHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #1B263B; }
        .pulsing-dot {
          width: 14px; height: 14px; background: #3498DB; border: 2.5px solid white;
          border-radius: 50%; box-shadow: 0 0 8px rgba(52, 152, 219, 0.8);
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(52, 152, 219, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(52, 152, 219, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(52, 152, 219, 0); }
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', { zoomControl: false }).setView([0, 0], 2);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        var originMarker = null;
        var destMarker = null;
        var liveLocationMarker = null;
        var polylines = [];
        var warningCircleMarkers = [];

        window.addEventListener('message', function(event) {
          var msg = JSON.parse(event.data);

          if (msg.type === 'init_routing') {
            // Clear existing elements
            if (originMarker) map.removeLayer(originMarker);
            if (destMarker) map.removeLayer(destMarker);
            polylines.forEach(function(p) { map.removeLayer(p); });
            polylines = [];
            warningCircleMarkers.forEach(function(c) { map.removeLayer(c); });
            warningCircleMarkers = [];

            // Add markers
            originMarker = L.marker([msg.origin.lat, msg.origin.lng]).addTo(map).bindPopup("Origin");
            destMarker = L.marker([msg.destination.lat, msg.destination.lng]).addTo(map).bindPopup("Destination");

            // Draw all route polylines
            msg.routes.forEach(function(route) {
              var isSelected = route.index === msg.selectedRouteIndex;
              var line = L.polyline(route.coordinates, {
                color: route.color,
                weight: isSelected ? 6 : 3,
                opacity: isSelected ? 0.95 : 0.45
              }).addTo(map);

              line.routeIndex = route.index;
              line.routeColor = route.color;
              polylines.push(line);
            });

            // Draw warning danger zones (red transparency circles)
            msg.warningZones.forEach(function(zone) {
              var circle = L.circle([zone.lat, zone.lng], {
                color: '#C0392B',
                fillColor: '#C0392B',
                fillOpacity: 0.25,
                radius: 100 // 100 meters radius
              }).addTo(map).bindPopup("<b>" + zone.risk_level.toUpperCase() + " Danger Area</b><br>Deducted safety score.");
              warningCircleMarkers.push(circle);
            });

            // Fit bounds to fit the route geometries
            var group = new L.featureGroup([originMarker, destMarker]);
            map.fitBounds(group.getBounds().pad(0.15));
          }

          if (msg.type === 'select_route') {
            polylines.forEach(function(polyline) {
              if (polyline.routeIndex === msg.index) {
                polyline.setStyle({ weight: 6, opacity: 0.95 });
                polyline.bringToFront();
              } else {
                polyline.setStyle({ weight: 3, opacity: 0.35 });
              }
            });
          }

          if (msg.type === 'update_location') {
            if (liveLocationMarker) {
              liveLocationMarker.setLatLng([msg.lat, msg.lng]);
            } else {
              var icon = L.divIcon({ className: 'pulsing-dot', iconSize: [14, 14] });
              liveLocationMarker = L.marker([msg.lat, msg.lng], { icon: icon }).addTo(map);
            }
            map.setView([msg.lat, msg.lng], map.getZoom());
          }
        });

        // Notify parent React Native code when map scripts are ready
        setTimeout(function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
        }, 300);
      </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      {/* ── SCREEN 1: INPUT ADDRESSES ───────────────────────────── */}
      {screenMode === 'input' && (
        <View style={styles.formContainer}>
          <Text style={styles.title}>Plan Safe Walking Route 🗺️</Text>
          <Text style={styles.subtitle}>
            SafeCircle scans threat zones dynamically to plot paths with minimal risk.
          </Text>

          <Text style={styles.label}>Origin</Text>
          <TextInput
            style={[styles.input, { opacity: 0.8 }]}
            value={originName}
            editable={false}
          />

          <Text style={styles.label}>Destination</Text>
          <TextInput
            style={styles.input}
            placeholder="Type address or location..."
            placeholderTextColor="#888"
            value={destQuery}
            onChangeText={handleDestSearch}
          />

          {/* Autocomplete suggestions */}
          {destSuggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {destSuggestions.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.suggestionItem}
                  onPress={() => selectDestination(item)}
                >
                  <Text style={styles.suggestionText} numberOfLines={1}>
                    📍 {item.display_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {loading ? (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 30 }} />
          ) : (
            <TouchableOpacity
              style={[styles.searchButton, !destination && styles.disabledButton]}
              onPress={handleFindRoutes}
              disabled={!destination}
            >
              <Text style={styles.buttonText}>Find Safe Routes</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── SCREEN 2 & 3: ROUTE OPTIONS & NAVIGATION ───────────────── */}
      {(screenMode === 'options' || screenMode === 'navigation') && (
        <View style={{ flex: 1 }}>
          {/* Proximity emergency warning */}
          {showProximityWarning && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                ⚠️ Entering High-Risk Threat Zone in 50m! Stay alert!
              </Text>
            </View>
          )}

          {/* Leaflet WebView Map */}
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: mapHtml }}
            style={{ flex: 1 }}
            onMessage={(e) => {
              try {
                const data = JSON.parse(e.nativeEvent.data);
                if (data.type === 'ready') {
                  handleMapLoad();
                }
              } catch (err) {}
            }}
          />

          {/* Selection drawer on Screen 2 */}
          {screenMode === 'options' && (
            <View style={styles.drawer}>
              <Text style={styles.drawerTitle}>Select a Route Path</Text>
              
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cardContainer}
              >
                {routes.map((route, index) => {
                  const isSelected = index === selectedRouteIndex;
                  const borderCol = isSelected ? getRouteColor(route.safety_score) : '#2B3E50';

                  return (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.routeCard,
                        isSelected && styles.activeRouteCard,
                        { borderColor: borderCol },
                      ]}
                      onPress={() => selectRoute(index)}
                    >
                      <View style={styles.cardHeader}>
                        <Text style={styles.routeLabel}>{route.label}</Text>
                        <View
                          style={[
                            styles.scoreBadge,
                            { backgroundColor: getRouteColor(route.safety_score) + '22' },
                          ]}
                        >
                          <Text
                            style={[
                              styles.scoreText,
                              { color: getRouteColor(route.safety_score) },
                            ]}
                          >
                            🛡️ {route.safety_score}/100
                          </Text>
                        </View>
                      </View>

                      <View style={styles.statsRow}>
                        <Text style={styles.statsText}>
                          ⏱️ {formatDuration(route.duration_minutes)}
                        </Text>
                        <Text style={styles.statsText}>
                          🚶 {Math.round(route.distance_meters)} m
                        </Text>
                      </View>

                      <Text style={styles.warningsCount}>
                        {route.warning_zones.length === 0
                          ? '✅ Clear path (0 risk zones)'
                          : `⚠️ ${route.warning_zones.length} threat areas near path`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setScreenMode('input')}
                >
                  <Text style={styles.cancelBtnText}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.navBtn}
                  onPress={() => setScreenMode('navigation')}
                >
                  <Text style={styles.navBtnText}>Start Safe Walk</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deepLinkBtn}
                  onPress={startExternalNavigation}
                >
                  <Text style={styles.deepLinkBtnText}>Google Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Navigation controls on Screen 3 */}
          {screenMode === 'navigation' && (
            <View style={styles.navConsole}>
              <View style={styles.navStats}>
                <Text style={styles.navStatsHeader}>WALKING ALONG SAFEST PATH</Text>
                <Text style={styles.navStatsSubtitle}>
                  In-app navigation maps threat circles in real-time.
                </Text>
              </View>

              <TouchableOpacity
                style={styles.arrivedButton}
                onPress={handleArrivedSafely}
              >
                <Text style={styles.arrivedBtnText}>I've Arrived Safely</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  // Form input screen
  formContainer: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFF',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  searchButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  // Autocomplete
  suggestionsContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    marginTop: -16,
    marginBottom: 20,
    maxHeight: 180,
  },
  suggestionItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  suggestionText: {
    color: '#E2E8F0',
    fontSize: 14,
  },
  // Map View warning banner
  warningBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 20,
    right: 20,
    zIndex: 99,
    backgroundColor: '#C0392B',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  warningText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  // Drawer options
  drawer: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  drawerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 16,
  },
  cardContainer: {
    gap: 12,
    paddingBottom: 16,
  },
  routeCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 2.5,
    padding: 16,
    width: width * 0.72,
  },
  activeRouteCard: {
    backgroundColor: '#1E293B',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  routeLabel: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  scoreText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  statsText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  warningsCount: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
  },
  navBtn: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  navBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  deepLinkBtn: {
    flex: 1.5,
    backgroundColor: '#27AE60',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deepLinkBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  // Nav Mode Console
  navConsole: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  navStats: {
    alignItems: 'center',
    marginBottom: 20,
  },
  navStatsHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: '#3498DB',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  navStatsSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
  },
  arrivedButton: {
    backgroundColor: '#27AE60',
    borderRadius: 8,
    width: '100%',
    paddingVertical: 16,
    alignItems: 'center',
  },
  arrivedBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
