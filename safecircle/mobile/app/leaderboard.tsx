import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Image,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import * as Location from 'expo-location';

const { width } = Dimensions.get('window');

interface LeaderboardUser {
  id: string;
  name: string;
  initials: string;
  city: string;
  state: string;
  assists: number;
  credits: number;
  rank: number;
}

export default function LeaderboardScreen() {
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('week');
  const [scope, setScope] = useState<'city' | 'state' | 'india'>('india');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardUser[]>([]);
  const [myRankInfo, setMyRankInfo] = useState<LeaderboardUser | null>(null);

  // Current user location
  const [myCity, setMyCity] = useState('Nagpur');
  const [myState, setMyState] = useState('Maharashtra');

  // Reverse geocode to get city/state
  const detectLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;

      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
        headers: { 'User-Agent': 'SafeCircle-App/1.0' },
      });
      const data = await res.json();
      if (data && data.address) {
        const city = data.address.city || data.address.town || data.address.suburb || 'Nagpur';
        const state = data.address.state || 'Maharashtra';
        setMyCity(city);
        setMyState(state);
      }
    } catch (err) {
      console.warn('[Leaderboard] Location detection error:', err);
    }
  };

  const fetchLeaderboard = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch all users who are volunteers
      // In a real large app we would do grouping in SQL, but for our database and MVP size
      // we query the volunteers and their responses to build accurate counts and filter periods.
      const { data: usersData, error: usersErr } = await supabase
        .from('users')
        .select(`
          id,
          name,
          credits,
          current_lat,
          current_lng,
          volunteer_responses(status, created_at)
        `)
        .eq('is_volunteer', true);

      if (usersErr) throw usersErr;

      // Define date threshold based on period
      let dateLimit = new Date();
      if (period === 'week') {
        dateLimit.setDate(dateLimit.getDate() - 7);
      } else if (period === 'month') {
        dateLimit.setDate(dateLimit.getDate() - 30);
      } else {
        dateLimit = new Date(0); // all time
      }

      // Map mock cities/states for other users based on their lat/lng
      // NAGPUR center coords: 21.1458, 79.0882
      const mappedUsers: LeaderboardUser[] = (usersData ?? []).map((u: any) => {
        // Calculate assists count in time period
        const completedResponses = (u.volunteer_responses ?? []).filter((r: any) => {
          const isCompleted = r.status === 'completed';
          if (!isCompleted) return false;
          const createdAt = new Date(r.created_at);
          return createdAt >= dateLimit;
        });

        // Determine city/state deterministically for demo
        let city = 'Nagpur';
        let state = 'Maharashtra';

        // simple lat lng variance mock
        if (u.current_lat && u.current_lng) {
          const latDiff = Math.abs(u.current_lat - 21.1458);
          const lngDiff = Math.abs(u.current_lng - 79.0882);
          if (latDiff > 0.5 || lngDiff > 0.5) {
            // Further away — assign other Indian cities
            const mockCities = [
              { city: 'Mumbai', state: 'Maharashtra' },
              { city: 'Pune', state: 'Maharashtra' },
              { city: 'Delhi', state: 'Delhi' },
              { city: 'Bangalore', state: 'Karnataka' },
              { city: 'Hyderabad', state: 'Telangana' },
            ];
            const idx = Math.abs(u.id.charCodeAt(0) + u.id.charCodeAt(1)) % mockCities.length;
            city = mockCities[idx].city;
            state = mockCities[idx].state;
          }
        }

        const nameStr = u.name || 'Anonymous Shield';
        const parts = nameStr.split(' ');
        const initials = parts.map((p: string) => p[0]).join('').toUpperCase().slice(0, 2);
        const displayName = parts[0] + (parts[1] ? ` ${parts[1][0]}.` : '');

        return {
          id: u.id,
          name: displayName,
          initials: initials || 'V',
          city,
          state,
          assists: completedResponses.length,
          credits: u.credits ?? 0,
          rank: 0,
        };
      });

      // Filter by Scope
      let filtered = [...mappedUsers];
      if (scope === 'city') {
        filtered = filtered.filter((u) => u.city.toLowerCase() === myCity.toLowerCase());
      } else if (scope === 'state') {
        filtered = filtered.filter((u) => u.state.toLowerCase() === myState.toLowerCase());
      }

      // Sort by assists DESC, then credits DESC
      filtered.sort((a, b) => {
        if (b.assists !== a.assists) return b.assists - a.assists;
        return b.credits - a.credits;
      });

      // Assign ranks
      const ranked: LeaderboardUser[] = filtered.map((u, index) => ({
        ...u,
        rank: index + 1,
      }));

      setLeaderboardData(ranked);

      // Find my rank info
      const me = ranked.find((u) => u.id === user.id);
      if (me) {
        setMyRankInfo(me);
      } else {
        // I might not be a volunteer or ranked yet
        const myProfile = (usersData ?? []).find((u: any) => u.id === user.id);
        if (myProfile) {
          const parts = (myProfile.name || 'Me').split(' ');
          const initials = parts.map((p: string) => p[0]).join('').toUpperCase().slice(0, 2);
          setMyRankInfo({
            id: user.id,
            name: parts[0] + (parts[1] ? ` ${parts[1][0]}.` : ''),
            initials: initials || 'ME',
            city: myCity,
            state: myState,
            assists: 0,
            credits: myProfile.credits ?? 0,
            rank: ranked.length + 1,
          });
        }
      }
    } catch (err) {
      console.error('[Leaderboard] fetchLeaderboard error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, scope, myCity, myState]);

  useEffect(() => {
    detectLocation().then(fetchLeaderboard);
  }, [fetchLeaderboard]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchLeaderboard();
  };

  const getRankBadgeColor = (rank: number) => {
    if (rank === 1) return '#F1C40F'; // Gold
    if (rank === 2) return '#BDC3C7'; // Silver
    if (rank === 3) return '#D35400'; // Bronze
    return '#2A2A35';
  };

  const renderLeaderboardItem = ({ item }: { item: LeaderboardUser }) => {
    // Skip rendering top 3 in FlatList since they are in the header view
    if (item.rank <= 3) return null;

    return (
      <View style={styles.rankRow}>
        <Text style={styles.rankNum}>{item.rank}</Text>
        <View style={styles.avatarBg}>
          <Text style={styles.avatarText}>{item.initials}</Text>
        </View>
        <View style={styles.userDetails}>
          <Text style={styles.userName}>{item.name}</Text>
          <Text style={styles.userCity}>📍 {item.city}</Text>
        </View>
        <View style={styles.userStats}>
          <Text style={styles.assistVal}>{item.assists} assists</Text>
          <Text style={styles.creditVal}>🪙 {item.credits}</Text>
        </View>
      </View>
    );
  };

  const top3 = leaderboardData.slice(0, 3);
  const first = top3.find((u) => u.rank === 1);
  const second = top3.find((u) => u.rank === 2);
  const third = top3.find((u) => u.rank === 3);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {/* Back header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Leaderboard</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Scope selector tabs */}
        <View style={styles.scopeTabs}>
          {(['india', 'state', 'city'] as const).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setScope(s)}
              style={[styles.scopeBtn, scope === s && styles.scopeBtnActive]}
            >
              <Text style={[styles.scopeText, scope === s && styles.scopeTextActive]}>
                {s === 'india' ? 'All India' : s === 'state' ? myState : myCity}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Period selector tabs */}
        <View style={styles.periodTabs}>
          {(['week', 'month', 'all'] as const).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#EF9F27" />
            <Text style={styles.loadingText}>Fetching rankings...</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {/* Top 3 podium */}
            {leaderboardData.length > 0 && (
              <View style={styles.podiumContainer}>
                {/* 2nd place */}
                {second && (
                  <View style={[styles.podiumCard, styles.podiumCard2]}>
                    <View style={[styles.podiumRankCircle, { backgroundColor: '#BDC3C7' }]}>
                      <Text style={styles.podiumRankText}>2</Text>
                    </View>
                    <View style={styles.podiumAvatarBg}>
                      <Text style={styles.podiumAvatarText}>{second.initials}</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.podiumName}>
                      {second.name}
                    </Text>
                    <Text style={styles.podiumCity}>{second.city}</Text>
                    <Text style={styles.podiumAssists}>{second.assists} assists</Text>
                    <Text style={styles.podiumCredits}>🪙 {second.credits}</Text>
                  </View>
                )}

                {/* 1st place */}
                {first && (
                  <View style={[styles.podiumCard, styles.podiumCard1]}>
                    <Text style={styles.crown}>👑</Text>
                    <View style={[styles.podiumRankCircle, { backgroundColor: '#F1C40F' }]}>
                      <Text style={styles.podiumRankText}>1</Text>
                    </View>
                    <View style={[styles.podiumAvatarBg, styles.podiumAvatarBgGold]}>
                      <Text style={styles.podiumAvatarText}>{first.initials}</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.podiumName}>
                      {first.name}
                    </Text>
                    <Text style={styles.podiumCity}>{first.city}</Text>
                    <Text style={[styles.podiumAssists, { color: '#EF9F27' }]}>{first.assists} assists</Text>
                    <Text style={styles.podiumCredits}>🪙 {first.credits}</Text>
                  </View>
                )}

                {/* 3rd place */}
                {third && (
                  <View style={[styles.podiumCard, styles.podiumCard3]}>
                    <View style={[styles.podiumRankCircle, { backgroundColor: '#D35400' }]}>
                      <Text style={styles.podiumRankText}>3</Text>
                    </View>
                    <View style={styles.podiumAvatarBg}>
                      <Text style={styles.podiumAvatarText}>{third.initials}</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.podiumName}>
                      {third.name}
                    </Text>
                    <Text style={styles.podiumCity}>{third.city}</Text>
                    <Text style={styles.podiumAssists}>{third.assists} assists</Text>
                    <Text style={styles.podiumCredits}>🪙 {third.credits}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Rest of the list */}
            <FlatList
              data={leaderboardData}
              keyExtractor={(item) => item.id}
              refreshing={refreshing}
              onRefresh={onRefresh}
              renderItem={renderLeaderboardItem}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No rankings found for this filter</Text>
                </View>
              }
            />

            {/* Sticky footer for my rank */}
            {myRankInfo && (
              <View style={styles.myRankBar}>
                <Text style={styles.myRankNum}>{myRankInfo.rank}</Text>
                <View style={[styles.avatarBg, { backgroundColor: '#EF9F2733' }]}>
                  <Text style={[styles.avatarText, { color: '#EF9F27' }]}>{myRankInfo.initials}</Text>
                </View>
                <View style={styles.userDetails}>
                  <Text style={styles.myRankName}>My Standing ({myRankInfo.name})</Text>
                  <Text style={styles.userCity}>📍 {myRankInfo.city}</Text>
                </View>
                <View style={styles.userStats}>
                  <Text style={styles.assistVal}>{myRankInfo.assists} assists</Text>
                  <Text style={styles.creditVal}>🪙 {myRankInfo.credits}</Text>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2A2A35',
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  backButtonText: {
    color: '#EF9F27',
    fontSize: 14,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  scopeTabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 8,
  },
  scopeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1C1C24',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#2A2A35',
  },
  scopeBtnActive: {
    backgroundColor: '#EF9F2720',
    borderColor: '#EF9F27',
  },
  scopeText: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
  },
  scopeTextActive: {
    color: '#EF9F27',
  },
  periodTabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2A2A35',
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  periodBtnActive: {
    backgroundColor: '#EF9F2710',
    borderWidth: 0.5,
    borderColor: '#EF9F2755',
  },
  periodText: {
    fontSize: 10,
    color: '#666',
    fontWeight: '600',
  },
  periodTextActive: {
    color: '#EF9F27',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#888',
    fontSize: 13,
  },
  podiumContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2A2A35',
    backgroundColor: '#16162255',
  },
  podiumCard: {
    flex: 1,
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#2A2A35',
    position: 'relative',
  },
  podiumCard1: {
    zIndex: 2,
    borderWidth: 1,
    borderColor: '#EF9F2777',
    paddingVertical: 16,
    marginHorizontal: 4,
    transform: [{ translateY: -10 }],
    backgroundColor: '#EF9F2708',
  },
  podiumCard2: {
    marginRight: 4,
    height: 140,
  },
  podiumCard3: {
    marginLeft: 4,
    height: 130,
  },
  podiumRankCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    top: -8,
  },
  podiumRankText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFF',
  },
  crown: {
    position: 'absolute',
    top: -24,
    fontSize: 20,
  },
  podiumAvatarBg: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#2A2A35',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  podiumAvatarBgGold: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#EF9F27',
    backgroundColor: '#EF9F2722',
  },
  podiumAvatarText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFF',
  },
  podiumName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFF',
    textAlign: 'center',
  },
  podiumCity: {
    fontSize: 9,
    color: '#888',
    marginTop: 2,
  },
  podiumAssists: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#5DCAA5',
    marginTop: 6,
  },
  podiumCredits: {
    fontSize: 9,
    color: '#EF9F27',
    marginTop: 2,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 90, // space for sticky footer
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#888',
    fontSize: 13,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2A2A35',
    backgroundColor: '#0F0F14',
  },
  rankNum: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#888',
    width: 24,
    textAlign: 'center',
    marginRight: 8,
  },
  avatarBg: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1C1C24',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFF',
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFF',
  },
  userCity: {
    fontSize: 9,
    color: '#888',
    marginTop: 2,
  },
  userStats: {
    alignItems: 'flex-end',
  },
  assistVal: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5DCAA5',
  },
  creditVal: {
    fontSize: 10,
    color: '#EF9F27',
    marginTop: 2,
  },
  myRankBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#161622',
    borderTopWidth: 1,
    borderTopColor: '#EF9F2788',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  myRankNum: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#EF9F27',
    width: 24,
    textAlign: 'center',
    marginRight: 8,
  },
  myRankName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFF',
  },
});
