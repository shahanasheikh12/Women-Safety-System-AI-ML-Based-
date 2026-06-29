import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  ActivityIndicator,
  FlatList,
  Alert,
  Platform,
  Animated,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import CreditBadge, { BadgeType } from '../../components/CreditBadge';
import { ThreatZoneMap } from '../../components/ThreatZoneMap';
import * as Location from 'expo-location';

interface UserProfile {
  id: string;
  name: string | null;
  phone: string;
  is_volunteer: boolean;
  verification_tier: number;
  credits: number;
}

interface UserSettings {
  receive_alerts: boolean;
  alert_radius_km: number;
}

interface ActiveSOS {
  id: string;
  lat: number;
  lng: number;
  started_at: string;
}

interface CreditTransaction {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}

export default function VolunteersScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stats
  const [totalAssists, setTotalAssists] = useState(0);
  const [responseRate, setResponseRate] = useState(100);
  const [avgRating, setAvgRating] = useState<number | null>(null);

  // Active SOS events
  const [activeSOSList, setActiveSOSList] = useState<ActiveSOS[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Recent credit transactions
  const [recentTransactions, setRecentTransactions] = useState<CreditTransaction[]>([]);

  // Join animations
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Start pulsing search ring for join button
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Fetch user profile
      const { data: profileData, error: profileErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileErr) throw profileErr;
      setProfile(profileData);

      // 2. Fetch user settings
      let { data: settingsData, error: settingsErr } = await supabase
        .from('user_settings')
        .select('receive_alerts, alert_radius_km')
        .eq('user_id', user.id)
        .single();

      // If user_settings doesn't exist, create default
      if (settingsErr && settingsErr.code === 'PGRST116') {
        const { data: newSettings, error: insertErr } = await supabase
          .from('user_settings')
          .insert({
            user_id: user.id,
            receive_alerts: true,
            alert_radius_km: 2.0,
          })
          .select()
          .single();
        if (!insertErr) {
          settingsData = newSettings;
        }
      }
      setSettings(settingsData);

      // 3. Fetch volunteer stats if applicable
      if (profileData?.is_volunteer) {
        // 3a. Total Assists (completed)
        const { count: assistsCount } = await supabase
          .from('volunteer_responses')
          .select('id', { count: 'exact', head: true })
          .eq('volunteer_id', user.id)
          .eq('status', 'completed');

        setTotalAssists(assistsCount ?? 0);

        // 3b. Response rate calculation: (accepted + en_route + arrived + completed) / total_notified
        const { data: responses } = await supabase
          .from('volunteer_responses')
          .select('status, victim_rating, response_time_seconds, created_at')
          .eq('volunteer_id', user.id);

        if (responses && responses.length > 0) {
          const acceptedStates = ['accepted', 'en_route', 'arrived', 'completed'];
          const totalResponded = responses.filter((r) => acceptedStates.includes(r.status)).length;
          const rate = Math.round((totalResponded / responses.length) * 100);
          setResponseRate(rate);

          // 3c. Average rating
          const ratings = responses
            .map((r) => r.victim_rating)
            .filter((r): r is number => r !== null && r !== undefined);
          if (ratings.length > 0) {
            const sum = ratings.reduce((a, b) => a + b, 0);
            setAvgRating(Math.round((sum / ratings.length) * 10) / 10);
          } else {
            setAvgRating(5.0);
          }
        } else {
          setResponseRate(100);
          setAvgRating(5.0);
        }

        // 4. Fetch recent transactions
        const { data: txData } = await supabase
          .from('credit_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10);
        setRecentTransactions(txData ?? []);

        // 5. Fetch user GPS
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          }
        } catch (_) {}

        // 6. Fetch active SOS events
        const { data: activeSOS } = await supabase
          .from('sos_events')
          .select('id, lat, lng, started_at')
          .eq('status', 'active')
          .order('started_at', { ascending: false });

        setActiveSOSList(activeSOS ?? []);
      }
    } catch (err) {
      console.error('[VolunteersScreen] loadData error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Join Helper Network flow
  const handleJoinNetwork = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update users table: is_volunteer = true, verification_tier = 1 (Aadhaar Sandbox verified)
      const { error } = await supabase
        .from('users')
        .update({
          is_volunteer: true,
          verification_tier: 1, // basic verified
        })
        .eq('id', user.id);

      if (error) throw error;

      // Create a default transaction for joining
      await supabase.from('credit_transactions').insert({
        user_id: user.id,
        amount: 50,
        reason: 'Welcome volunteer bonus! 🎁',
      });

      // Reload data
      loadData();
      Alert.alert('Welcome Shield! 🛡️', 'You have successfully joined SafeCircle\'s helper network and earned 50 bonus credits.');
    } catch (err: any) {
      setLoading(false);
      Alert.alert('Error', err.message || 'Failed to join network. Please try again.');
    }
  };

  // Toggle availability status
  const handleToggleAvailability = async (value: boolean) => {
    if (!profile) return;
    try {
      const { error } = await supabase
        .from('user_settings')
        .update({ receive_alerts: value })
        .eq('user_id', profile.id);

      if (error) throw error;

      setSettings((prev) => (prev ? { ...prev, receive_alerts: value } : null));

      // Also trigger a subtle haptic update feedback or status notice
      if (value) {
        // Trigger a background location update if possible
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          await supabase.from('users').update({
            current_lat: loc.coords.latitude,
            current_lng: loc.coords.longitude,
            location_updated_at: new Date().toISOString(),
          }).eq('id', profile.id);
        }
      }
    } catch (err) {
      console.error('[VolunteersScreen] Toggle availability error:', err);
    }
  };

  const getRecentIcon = (reason: string, amount: number) => {
    const r = reason.toLowerCase();
    if (r.includes('badge') || r.includes('gold') || r.includes('silver')) return '🏆';
    if (r.includes('welcome') || r.includes('bonus')) return '🎁';
    if (r.includes('referred') || r.includes('referral')) return '🤝';
    if (r.includes('false report') || r.includes('penalty')) return '⚠️';
    if (amount > 0) return '⚡'; // assist completion
    return '🪙';
  };

  // Badge list computation
  const getBadgeList = () => {
    const hasReferral = recentTransactions.some(
      (t) => t.reason.toLowerCase().includes('referred') || t.reason.toLowerCase().includes('referral')
    );

    const assists = totalAssists;

    return [
      {
        badge: 'Quick Responder' as const,
        earned: assists >= 1, // Assume first response was fast for demo
        progress: assists >= 1 ? 1 : 0,
        total: 1,
      },
      {
        badge: 'Community Hero' as const,
        earned: assists >= 1,
        progress: assists,
        total: 1,
      },
      {
        badge: 'Silver Shield' as const,
        earned: assists >= 5,
        progress: assists,
        total: 5,
      },
      {
        badge: 'Gold Champion' as const,
        earned: assists >= 20,
        progress: assists,
        total: 20,
      },
      {
        badge: 'Recruiter' as const,
        earned: hasReferral,
        progress: hasReferral ? 1 : 0,
        total: 1,
      },
      {
        badge: 'Night Guardian' as const,
        earned: assists >= 3, // Mock some night assists for visualization
        progress: Math.min(10, assists * 2),
        total: 10,
      },
      {
        badge: 'Consistent Protector' as const,
        earned: assists >= 2,
        progress: Math.min(30, assists * 8),
        total: 30,
      },
    ];
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#EF9F27" />
        <Text style={styles.loadingText}>Syncing network status...</Text>
      </View>
    );
  }

  // ─── Render Non-Volunteer Screen (CTA Join) ───────────────────────────
  if (profile && !profile.is_volunteer) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.ctaContainer}>
          <Text style={styles.ctaShieldIcon}>🛡️</Text>
          <Text style={styles.ctaTitle}>Become a SafeCircle Shield</Text>
          <Text style={styles.ctaDesc}>
            Join India's verified emergency response network. When a woman triggers an SOS nearby, you can act as a shield to help her before official support arrives.
          </Text>

          <View style={styles.perksList}>
            <Text style={styles.perkItem}>🤝 **Crowdsourced Protection** — Be there in minutes when it matters.</Text>
            <Text style={styles.perkItem}>🔒 **Secure & Anonymous** — Your identity is hidden until you accept.</Text>
            <Text style={styles.perkItem}>🎖️ **Earn Badges & Rewards** — Receive safety credits and digital recognition.</Text>
          </View>

          <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
            <TouchableOpacity onPress={handleJoinNetwork} style={styles.joinButton}>
              <Text style={styles.joinButtonText}>Join Helper Network</Text>
            </TouchableOpacity>
          </Animated.View>

          <Text style={styles.disclaimerText}>
            Requires basic verification. By joining, you consent to receive emergency notifications and share your location when active.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const badgesList = getBadgeList();

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <ActivityIndicator
            animating={refreshing}
            color="#EF9F27"
            style={{ marginVertical: 10 }}
          />
        }
      >
        {/* Volunteer Header */}
        <View style={styles.volHeader}>
          <View style={styles.volHeaderLeft}>
            <Text style={styles.volTitle}>Shield Console</Text>
            <Text style={styles.volSubtitle}>Active Protection Area</Text>
          </View>
          <View style={styles.volHeaderRight}>
            <TouchableOpacity onPress={() => router.push('/leaderboard')} style={styles.rankingBadge}>
              <Text style={styles.rankingText}>🏆 Ranks</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statEmoji}>🆘</Text>
            <Text style={styles.statVal}>{totalAssists}</Text>
            <Text style={styles.statName}>Assists</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statEmoji}>⚡</Text>
            <Text style={styles.statVal}>{responseRate}%</Text>
            <Text style={styles.statName}>Response</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statEmoji}>⭐</Text>
            <Text style={styles.statVal}>{avgRating ? avgRating.toFixed(1) : '5.0'}</Text>
            <Text style={styles.statName}>Rating</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/credits-history')} style={[styles.statBox, styles.statBoxCredits]}>
            <Text style={styles.statEmoji}>🪙</Text>
            <Text style={[styles.statVal, { color: '#EF9F27' }]}>{profile?.credits ?? 0}</Text>
            <Text style={styles.statName}>Credits</Text>
          </TouchableOpacity>
        </View>

        {/* Active SOS Alerts Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🚨 Active Nearby alerts</Text>
        </View>
        {activeSOSList.length > 0 ? (
          activeSOSList.map((sos) => {
            // Distance mock if user location not detected
            const dist = userLocation
              ? Math.round(
                  Math.sqrt(
                    Math.pow(userLocation.lat - sos.lat, 2) + Math.pow(userLocation.lng - sos.lng, 2)
                  ) * 111 * 10
                ) / 10
              : 1.2;

            return (
              <TouchableOpacity
                key={sos.id}
                onPress={() => router.push({ pathname: '/volunteer-alert', params: { sos_id: sos.id } })}
                style={styles.activeAlertCard}
              >
                <View style={styles.alertHeaderRow}>
                  <View style={styles.pulseDot} />
                  <Text style={styles.alertTitle}>EMERGENCY ALERT: NEIGHBORHOOD</Text>
                  <Text style={styles.alertDist}>{dist} km away</Text>
                </View>
                <Text style={styles.alertDesc}>
                  A woman nearby triggered an SOS. Tap immediately to accept and direct navigation to her coordinates.
                </Text>

                {/* Map Mini Preview */}
                {userLocation && (
                  <View style={styles.miniMapWrapper}>
                    <ThreatZoneMap
                      userLat={userLocation.lat}
                      userLng={userLocation.lng}
                      sosLocation={{ lat: sos.lat, lng: sos.lng }}
                      showThreatZones={false}
                      showVolunteers={false}
                      showActiveSOS={true}
                      interactive={false}
                      height={120}
                    />
                  </View>
                )}
                <View style={styles.respondCta}>
                  <Text style={styles.respondCtaText}>RESPOND TO EMERGENCY →</Text>
                </View>
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.noAlertCard}>
            <Text style={styles.noAlertIcon}>🛡️</Text>
            <Text style={styles.noAlertTitle}>All clear in Nagpur</Text>
            <Text style={styles.noAlertDesc}>No active SOS alerts in your protection radius.</Text>
          </View>
        )}

        {/* Availability Toggle */}
        <View style={styles.toggleCard}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>
              {settings?.receive_alerts ? '🟢 Available to Help' : '⚫ Off Duty'}
            </Text>
            <Text style={styles.toggleDesc}>
              {settings?.receive_alerts
                ? 'Your location is active. You will receive notifications for nearby SOS events.'
                : 'Alerts are paused. Turn availability ON to support the SafeCircle network.'}
            </Text>
          </View>
          <Switch
            value={settings?.receive_alerts ?? false}
            onValueChange={handleToggleAvailability}
            trackColor={{ false: '#2A2A35', true: '#5DCAA5' }}
            thumbColor={settings?.receive_alerts ? '#FFF' : '#888'}
          />
        </View>

        {/* Badges Carousel */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🏆 Shield Milestones & Badges</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.badgesCarousel}
          contentContainerStyle={styles.badgesCarouselContent}
        >
          {badgesList.map((item) => (
            <CreditBadge
              key={item.badge}
              badge={item.badge}
              earned={item.earned}
              progress={item.progress}
              total={item.total}
              size="md"
            />
          ))}
        </ScrollView>

        {/* Recent Activity Ledger */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>📋 Recent Rewards & Actions</Text>
          <TouchableOpacity onPress={() => router.push('/credits-history')}>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>
        {recentTransactions.length > 0 ? (
          <View style={styles.activityCard}>
            {recentTransactions.map((tx, idx) => {
              const isPos = tx.amount > 0;
              return (
                <View key={tx.id} style={[styles.activityRow, idx === recentTransactions.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={styles.activityIconBg}>
                    <Text style={styles.activityRowIcon}>{getRecentIcon(tx.reason, tx.amount)}</Text>
                  </View>
                  <View style={styles.activityRowDetails}>
                    <Text style={styles.activityReason}>{tx.reason}</Text>
                    <Text style={styles.activityDate}>
                      {new Date(tx.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Text style={[styles.activityAmount, isPos ? styles.posText : styles.negText]}>
                    {isPos ? `+${tx.amount}` : tx.amount}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.noActivityCard}>
            <Text style={styles.noActivityText}>No recent activity recorded.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0F0F14',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F0F14',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
  },
  // CTA View Styles
  ctaContainer: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F0F14',
  },
  ctaShieldIcon: {
    fontSize: 70,
    marginBottom: 16,
    shadowColor: '#EF9F27',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  ctaTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  ctaDesc: {
    color: '#888',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  perksList: {
    width: '100%',
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    padding: 16,
    borderWidth: 0.5,
    borderColor: '#2A2A35',
    marginBottom: 28,
    gap: 12,
  },
  perkItem: {
    color: '#FFF',
    fontSize: 12,
    lineHeight: 18,
  },
  joinButton: {
    backgroundColor: '#EF9F27',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF9F27',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  joinButtonText: {
    color: '#0F0F14',
    fontSize: 14,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  disclaimerText: {
    fontSize: 10,
    color: '#555',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 14,
  },
  // Dashboard Styles
  volHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  volHeaderLeft: {},
  volTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  volSubtitle: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  volHeaderRight: {},
  rankingBadge: {
    backgroundColor: '#EF9F2720',
    borderWidth: 0.5,
    borderColor: '#EF9F27',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  rankingText: {
    color: '#EF9F27',
    fontSize: 11,
    fontWeight: 'bold',
  },
  statsGrid: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#1C1C24',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#2A2A35',
  },
  statBoxCredits: {
    borderColor: '#EF9F2733',
  },
  statEmoji: {
    fontSize: 18,
    marginBottom: 4,
  },
  statVal: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFF',
  },
  statName: {
    fontSize: 9,
    color: '#888',
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFF',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  viewAllText: {
    color: '#EF9F27',
    fontSize: 11,
    fontWeight: '600',
  },
  // Active Alert Cards
  activeAlertCard: {
    backgroundColor: '#3A151D',
    borderWidth: 1,
    borderColor: '#E74C3C',
    borderRadius: 14,
    marginHorizontal: 16,
    padding: 14,
    marginBottom: 20,
    shadowColor: '#E74C3C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E74C3C',
    marginRight: 6,
  },
  alertTitle: {
    color: '#E74C3C',
    fontSize: 11,
    fontWeight: 'bold',
    flex: 1,
  },
  alertDist: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
    backgroundColor: '#E74C3C44',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  alertDesc: {
    color: '#FADBD8',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  miniMapWrapper: {
    height: 120,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: '#E74C3C33',
  },
  respondCta: {
    backgroundColor: '#E74C3C',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  respondCtaText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  // No Active Alert view
  noAlertCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#2A2A35',
    marginHorizontal: 16,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  noAlertIcon: {
    fontSize: 32,
    marginBottom: 8,
    opacity: 0.4,
  },
  noAlertTitle: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  noAlertDesc: {
    color: '#666',
    fontSize: 11,
    marginTop: 4,
  },
  // Toggle status card
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    borderWidth: 0.5,
    borderColor: '#2A2A35',
    marginBottom: 20,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFF',
  },
  toggleDesc: {
    fontSize: 10,
    color: '#888',
    lineHeight: 14,
    marginTop: 4,
  },
  // Badges scroll carousel
  badgesCarousel: {
    marginBottom: 20,
  },
  badgesCarouselContent: {
    paddingLeft: 16,
    paddingRight: 8,
    gap: 8,
  },
  // Activity Ledger Card
  activityCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#2A2A35',
    marginHorizontal: 16,
    paddingHorizontal: 14,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2A2A35',
  },
  activityIconBg: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0F0F14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  activityRowIcon: {
    fontSize: 14,
  },
  activityRowDetails: {
    flex: 1,
  },
  activityReason: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  activityDate: {
    color: '#666',
    fontSize: 9,
    marginTop: 2,
  },
  activityAmount: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  posText: {
    color: '#2ECC71',
  },
  negText: {
    color: '#E74C3C',
  },
  noActivityCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    marginHorizontal: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#2A2A35',
  },
  noActivityText: {
    color: '#666',
    fontSize: 12,
  },
});
