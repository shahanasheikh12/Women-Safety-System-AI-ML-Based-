import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  BackHandler,
  Linking,
  Platform,
  ActivityIndicator,
  SafeAreaView
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import Colors from '../constants/Colors';
import { supabase } from '../lib/supabase';
import { useVolunteers } from '../hooks/useVolunteers';
import { useRealtimeLocation } from '../hooks/useRealtimeLocation';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Leaflet HTML template for volunteer view
function buildLeafletHTML(vLat: number, vLng: number, volLat: number | null, volLng: number | null): string {
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
      html, body, #map { width: 100%; height: 100%; background: #0D0D0D; }
      
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

      .vol-marker {
        width: 22px; height: 22px;
        border-radius: 50%;
        background: #27AE60;
        border: 3px solid #fff;
        box-shadow: 0 2px 6px rgba(0,0,0,0.5);
      }

      .leaflet-tile-pane { filter: brightness(0.7) saturate(0.85); }
    </style>
  </head>
  <body>
  <div id="map"></div>
  <script>
    var vLat = ${vLat};
    var vLng = ${vLng};
    var volLat = ${volLat || 'null'};
    var volLng = ${volLng || 'null'};

    var map = L.map('map', { zoomControl: false }).setView([vLat, vLng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    // Victim marker (Red)
    var victimIcon = L.divIcon({
      className: '',
      html: '<div class="victim-pulse-container"><div class="victim-pulse"></div></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
    var victimMarker = L.marker([vLat, vLng], { icon: victimIcon }).addTo(map);

    // Volunteer marker (Green)
    var volunteerMarker = null;
    if (volLat !== null && volLng !== null) {
      var volIcon = L.divIcon({
        className: '',
        html: '<div class="vol-marker"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      volunteerMarker = L.marker([volLat, volLng], { icon: volIcon }).addTo(map);
      
      var group = new L.featureGroup([victimMarker, volunteerMarker]);
      map.fitBounds(group.getBounds().pad(0.2));
    }

    // Dynamic messaging from RN
    document.addEventListener('message', handleMessage);
    window.addEventListener('message', handleMessage);

    function handleMessage(event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg.type === 'UPDATE_LOCATIONS') {
          if (msg.victim) {
            victimMarker.setLatLng([msg.victim.lat, msg.victim.lng]);
          }
          if (msg.volunteer && msg.volunteer.lat && msg.volunteer.lng) {
            if (volunteerMarker) {
              volunteerMarker.setLatLng([msg.volunteer.lat, msg.volunteer.lng]);
            } else {
              var volIcon = L.divIcon({
                className: '',
                html: '<div class="vol-marker"></div>',
                iconSize: [22, 22],
                iconAnchor: [11, 11]
              });
              volunteerMarker = L.marker([msg.volunteer.lat, msg.volunteer.lng], { icon: volIcon }).addTo(map);
            }
          }
          
          if (victimMarker && volunteerMarker) {
            var group = new L.featureGroup([victimMarker, volunteerMarker]);
            map.fitBounds(group.getBounds().pad(0.2));
          }
        }
      } catch(e) {}
    }
  </script>
  </body>
  </html>
  `;
}

// ─────────────────────────────────────────────────────────────
// Screen Component
// ─────────────────────────────────────────────────────────────

export default function VolunteerAlertScreen() {
  useKeepAwake(); // Keep screen awake during emergency response
  const { sos_id } = useLocalSearchParams<{ sos_id: string }>();
  const webViewRef = useRef<WebView | null>(null);

  // States
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [responseRow, setResponseRow] = useState<any>(null);
  const [sosEvent, setSosEvent] = useState<any>(null);
  const [uiState, setUiState] = useState<'incoming' | 'en_route' | 'arrived' | 'completed'>('incoming');
  
  // Location States
  const [victimLocation, setVictimLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [volunteerLocation, setVolunteerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  
  // Metadata States
  const [areaName, setAreaName] = useState<string>('Loading address...');
  const [threatMessage, setThreatMessage] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  
  // Rating State
  const [rating, setRating] = useState<number>(5);

  // Hooks
  const {
    loading,
    error,
    acceptSOS,
    declineSOS,
    confirmArrival,
    rateInteraction,
    shareVolunteerLocation,
  } = useVolunteers();

  // Pulse glow border animation
  const glowAnim = useRef(new Animated.Value(0.2)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1.0,
          duration: 1500,
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.2,
          duration: 1500,
          useNativeDriver: false,
        }),
      ])
    ).start();
  }, []);

  const animatedBorderColor = glowAnim.interpolate({
    inputRange: [0.2, 1.0],
    outputRange: ['rgba(192, 57, 43, 0.2)', 'rgba(192, 57, 43, 1.0)'],
  });

  // Get current user ID
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  // Fetch response and SOS details
  useEffect(() => {
    if (!sos_id || !currentUserId) return;

    (async () => {
      // 1. Fetch volunteer response row
      const { data: resp, error: respErr } = await supabase
        .from('volunteer_responses')
        .select('*')
        .eq('sos_id', sos_id)
        .eq('volunteer_id', currentUserId)
        .single();

      if (!respErr && resp) {
        setResponseRow(resp);
        // Map DB status to UI state
        if (resp.status === 'accepted' || resp.status === 'en_route') {
          setUiState('en_route');
        } else if (resp.status === 'arrived') {
          setUiState('arrived');
        } else if (resp.status === 'completed') {
          setUiState('completed');
        } else if (resp.status === 'declined') {
          router.back();
        }
      }

      // 2. Fetch SOS event details
      const { data: event, error: eventErr } = await supabase
        .from('sos_events')
        .select('*')
        .eq('id', sos_id)
        .single();

      if (!eventErr && event) {
        setSosEvent(event);
        setVictimLocation({ lat: event.lat, lng: event.lng });

        // Reverse geocoding (Nominatim)
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${event.lat}&lon=${event.lng}&zoom=18&addressdetails=1`,
            { headers: { 'User-Agent': 'SafeCircleVolunteerApp/1.0' } }
          );
          if (res.ok) {
            const data = await res.json();
            const addr = data.address;
            const sub = addr.suburb || addr.neighbourhood || addr.village || addr.city_district || addr.city || 'Nagpur';
            setAreaName(sub);
          } else {
            setAreaName('Nagpur Area');
          }
        } catch {
          setAreaName('Nagpur Area');
        }

        // Proximity threat zones
        try {
          const { data: zones } = await supabase
            .from('threat_zones')
            .select('center_lat, center_lng, incident_count')
            .not('center_lat', 'is', null);

          if (zones) {
            let count = 0;
            zones.forEach((z) => {
              const dist = haversineKm(event.lat, event.lng, z.center_lat!, z.center_lng!);
              if (dist <= 0.5) { // 500 meters
                count += z.incident_count || 0;
              }
            });
            if (count > 0) {
              setThreatMessage(`⚠️ This area has ${count} recent incidents`);
            }
          }
        } catch (e) {
          console.warn('Failed to load threat zones:', e);
        }
      }
    })();
  }, [sos_id, currentUserId]);

  // Subscribe to real-time updates for victim location
  const realtimeLocation = useRealtimeLocation(
    uiState === 'en_route' ? sos_id : null
  );

  useEffect(() => {
    if (realtimeLocation.latestLocation) {
      setVictimLocation({
        lat: realtimeLocation.latestLocation.lat,
        lng: realtimeLocation.latestLocation.lng,
      });
    }
  }, [realtimeLocation.latestLocation]);

  // Watch volunteer GPS position
  useEffect(() => {
    let watchSub: any = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setVolunteerLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });

      watchSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 10,
          timeInterval: 5000,
        },
        (loc) => {
          setVolunteerLocation({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });
        }
      );
    })();

    return () => {
      if (watchSub) watchSub.remove();
    };
  }, []);

  // Recalculate distance and postMessage to WebView
  useEffect(() => {
    if (victimLocation && volunteerLocation) {
      const dist = haversineKm(
        victimLocation.lat,
        victimLocation.lng,
        volunteerLocation.lat,
        volunteerLocation.lng
      );
      setDistanceKm(dist);

      if (webViewRef.current) {
        webViewRef.current.postMessage(
          JSON.stringify({
            type: 'UPDATE_LOCATIONS',
            victim: victimLocation,
            volunteer: volunteerLocation,
          })
        );
      }
    }
  }, [victimLocation, volunteerLocation]);

  // Stream volunteer GPS when en route
  useEffect(() => {
    if (uiState !== 'en_route') return;
    if (!sos_id || !volunteerLocation) return;

    // Immediate stream
    shareVolunteerLocation(sos_id, volunteerLocation.lat, volunteerLocation.lng);

    // Stream every 5 seconds
    const streamInterval = setInterval(() => {
      shareVolunteerLocation(sos_id, volunteerLocation.lat, volunteerLocation.lng);
    }, 5000);

    return () => clearInterval(streamInterval);
  }, [uiState, sos_id, volunteerLocation]);

  // Count up timer (elapsed since SOS fired)
  useEffect(() => {
    if (!sosEvent?.started_at) return;

    const timerInterval = setInterval(() => {
      const diff = Date.now() - new Date(sosEvent.started_at).getTime();
      const finalDiff = Math.max(0, diff);

      const hours = Math.floor(finalDiff / 3600000);
      const mins = Math.floor((finalDiff % 3600000) / 60000);
      const secs = Math.floor((finalDiff % 60000) / 1000);

      setElapsedTime(
        `${String(hours).padStart(2, '0')}:${String(String(mins)).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      );
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [sosEvent?.started_at]);

  // Accidental hardware back press block (only disabled once completed or declined)
  useEffect(() => {
    const handleBackButton = () => {
      if (uiState !== 'completed') {
        return true; // blocks back action
      }
      return false;
    };

    const handler = BackHandler.addEventListener('hardwareBackPress', handleBackButton);
    return () => handler.remove();
  }, [uiState]);

  // ── Operations ─────────────────────────────────────────────

  const handleAccept = async () => {
    if (!responseRow) return;
    const ok = await acceptSOS(responseRow.id);
    if (ok) {
      setUiState('en_route');
      // Launch external maps app automatically
      if (victimLocation) {
        openMapsNavigation(victimLocation.lat, victimLocation.lng);
      }
    }
  };

  const handleDecline = async () => {
    if (!responseRow) return;
    const ok = await declineSOS(responseRow.id);
    if (ok) {
      router.back();
    }
  };

  const handleArrived = async () => {
    if (!responseRow) return;
    setUiState('arrived'); // transition locally to block navigation screen
    confirmArrival(responseRow.id); // updates status + edge function
  };

  const handleRate = async (star: number) => {
    if (!responseRow) return;
    setRating(star);
    const ok = await rateInteraction(responseRow.id, star);
    if (ok) {
      setUiState('completed');
    }
  };

  const openMapsNavigation = (lat: number, lng: number) => {
    const url = Platform.OS === 'ios'
      ? `maps://0,0?q=${lat},${lng}`
      : `geo:0,0?q=${lat},${lng}`;
      
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
    });
  };

  // ── Rendering States ────────────────────────────────────────

  const walkETA = distanceKm !== null ? Math.round(distanceKm * 12) : 0;
  const driveETA = distanceKm !== null ? Math.round(distanceKm * 2.4) : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.View
        style={[
          styles.container,
          { borderWidth: uiState === 'incoming' ? 4 : 0, borderColor: animatedBorderColor }
        ]}
      >
        {/* HEADER BAR */}
        <View style={[styles.headerBar, uiState !== 'incoming' && styles.headerBarAlt]}>
          <View style={styles.headerInfo}>
            <Text style={styles.headerEmoji}>
              {uiState === 'completed' ? '🎉' : '🚨'}
            </Text>
            <View>
              <Text style={styles.headerTitle}>
                {uiState === 'incoming' && 'EMERGENCY NEARBY'}
                {uiState === 'en_route' && 'EN ROUTE TO VICTIM'}
                {uiState === 'arrived' && 'ARRIVED AT VICTIM'}
                {uiState === 'completed' && 'RESCUE COMPLETED'}
              </Text>
              <Text style={styles.headerSubtitle}>
                {uiState === 'incoming' && `A woman needs help nearby — Area: ${areaName}`}
                {uiState === 'en_route' && 'Navigating live location…'}
                {uiState === 'arrived' && 'Please verify safety & complete feedback'}
                {uiState === 'completed' && 'Thank you for your assistance!'}
              </Text>
            </View>
          </View>
          {uiState !== 'completed' && (
            <View style={styles.timerBadge}>
              <View style={styles.pulseDot} />
              <Text style={styles.timerText}>{elapsedTime}</Text>
            </View>
          )}
        </View>

        {/* MAP VIEW */}
        {uiState !== 'completed' && victimLocation && (
          <View style={styles.mapContainer}>
            <WebView
              ref={webViewRef}
              originWhitelist={['*']}
              source={{ html: buildLeafletHTML(victimLocation.lat, victimLocation.lng, volunteerLocation?.lat ?? null, volunteerLocation?.lng ?? null) }}
              style={styles.mapWeb}
              javaScriptEnabled={true}
              domStorageEnabled={true}
            />
          </View>
        )}

        {/* MIDDLE CONTENT SECTION */}
        <View style={styles.contentContainer}>
          {uiState === 'incoming' && (
            <View style={styles.infoCard}>
              <View style={styles.victimProfile}>
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarText}>A</Text>
                </View>
                <View>
                  <Text style={styles.victimName}>Anonymous User</Text>
                  <Text style={styles.victimSafeStatus}>SafeCircle Verified Alert</Text>
                </View>
              </View>

              <View style={styles.geoStats}>
                {distanceKm !== null && (
                  <>
                    <Text style={styles.distanceValue}>
                      📍 {distanceKm.toFixed(2)} km away
                    </Text>
                    <Text style={styles.etaEstimate}>
                      🚶 {walkETA} min walk  •  🚗 {driveETA} min drive
                    </Text>
                  </>
                )}
                {threatMessage && (
                  <View style={styles.threatBadge}>
                    <Text style={styles.threatText}>{threatMessage}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {uiState === 'en_route' && (
            <View style={styles.infoCard}>
              <Text style={styles.enRouteInstruction}>
                Follow navigation parameters. Live location coordinates are streaming to coordinates.
              </Text>
              <TouchableOpacity
                onPress={() => victimLocation && openMapsNavigation(victimLocation.lat, victimLocation.lng)}
                style={styles.navButton}
              >
                <Text style={styles.navButtonText}>🗺️ OPEN EXTERNAL MAPS</Text>
              </TouchableOpacity>
              {distanceKm !== null && (
                <Text style={styles.enRouteDistance}>
                  Distance Remaining: {distanceKm.toFixed(2)} km ({walkETA} min walk)
                </Text>
              )}
            </View>
          )}

          {uiState === 'arrived' && (
            <View style={styles.infoCard}>
              <Text style={styles.rateTitle}>Rate this Interaction</Text>
              <Text style={styles.rateSubtitle}>
                Your arrival triggers rescue verification. Please rate safety and interaction:
              </Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity
                    key={star}
                    onPress={() => handleRate(star)}
                    style={styles.starTouch}
                  >
                    <Text style={[styles.starEmoji, rating >= star ? styles.starFilled : styles.starEmpty]}>
                      ★
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {uiState === 'completed' && (
            <View style={styles.completeCard}>
              <Text style={styles.completeHeader}>🥇 HERO LEVEL RESPONDER</Text>
              <Text style={styles.completeText}>
                You have earned +50 Credits for this assist.
              </Text>
              <Text style={styles.completeSubtext}>
                SafeCircle credits improve your trust score and help us maintain verify status.
              </Text>
              <TouchableOpacity
                onPress={() => router.replace('/(tabs)/home')}
                style={styles.homeButton}
              >
                <Text style={styles.homeButtonText}>RETURN TO HOME</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* BOTTOM ACTION BUTTONS */}
        {uiState === 'incoming' && (
          <View style={styles.bottomActions}>
            <TouchableOpacity
              onPress={handleAccept}
              disabled={loading}
              style={styles.acceptBtn}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.acceptText}>✅ I'M COMING TO HELP</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleDecline}
              disabled={loading}
              style={styles.declineBtn}
            >
              <Text style={styles.declineText}>❌ I Can't Help Right Now</Text>
            </TouchableOpacity>
          </View>
        )}

        {uiState === 'en_route' && (
          <View style={styles.bottomActions}>
            <TouchableOpacity
              onPress={handleArrived}
              disabled={loading}
              style={styles.arrivedBtn}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.arrivedText}>🏠 I'VE ARRIVED</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    padding: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  headerBarAlt: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: '#2C3E50',
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerEmoji: {
    fontSize: 28,
    marginRight: 12,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
    maxWidth: '90%',
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E74C3C',
    marginRight: 6,
  },
  timerText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  mapContainer: {
    height: '45%',
    width: '100%',
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderColor: '#2C3E50',
  },
  mapWeb: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  contentContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  infoCard: {
    backgroundColor: Colors.surface,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2C3E50',
  },
  victimProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#34495E',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  victimName: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  victimSafeStatus: {
    color: Colors.accent,
    fontSize: 12,
  },
  geoStats: {
    marginTop: 8,
  },
  distanceValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  etaEstimate: {
    color: Colors.textMuted,
    fontSize: 14,
    marginBottom: 12,
  },
  threatBadge: {
    backgroundColor: 'rgba(211, 84, 0, 0.2)',
    borderWidth: 1,
    borderColor: Colors.warning,
    padding: 8,
    borderRadius: 8,
  },
  threatText: {
    color: Colors.warning,
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  enRouteInstruction: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
    textAlign: 'center',
  },
  navButton: {
    backgroundColor: '#2980B9',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 14,
  },
  navButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  enRouteDistance: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  rateTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  rateSubtitle: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  starTouch: {
    paddingHorizontal: 8,
  },
  starEmoji: {
    fontSize: 42,
  },
  starFilled: {
    color: '#F1C40F',
  },
  starEmpty: {
    color: '#7F8C8D',
  },
  completeCard: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.safe,
  },
  completeHeader: {
    color: Colors.safe,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  completeText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  completeSubtext: {
    color: Colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 24,
  },
  homeButton: {
    backgroundColor: Colors.safe,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 24,
    alignItems: 'center',
  },
  homeButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  bottomActions: {
    padding: 16,
  },
  acceptBtn: {
    backgroundColor: Colors.safe,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.safe,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
    marginBottom: 12,
  },
  acceptText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  declineBtn: {
    backgroundColor: Colors.surface,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#34495E',
  },
  declineText: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  arrivedBtn: {
    backgroundColor: Colors.safe,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.safe,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  arrivedText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorBanner: {
    backgroundColor: Colors.primary,
    padding: 10,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  errorText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
});
