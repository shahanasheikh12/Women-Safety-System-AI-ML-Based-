import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
  Dimensions,
  Platform
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';

const { width } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface UserProfile {
  id: string;
  name: string | null;
  phone: string;
  is_volunteer: boolean;
  verification_tier: number;
  trust_score: number;
  credits: number;
}

interface Incident {
  id: string;
  status: string;
  started_at: string;
  lat: number;
  lng: number;
}

interface CreditTransaction {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Volunteer stats
  const [totalAssists, setTotalAssists] = useState<number>(0);
  const [badges, setBadges] = useState<string[]>([]);
  
  // History modals
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [loadingIncidents, setLoadingIncidents] = useState(false);

  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [creditsModalVisible, setCreditsModalVisible] = useState(false);
  const [loadingCredits, setLoadingCredits] = useState(false);

  // Load profile data
  const loadProfileData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // 1. Fetch user profile
      const { data: userProfile, error: profileErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileErr) throw profileErr;
      setProfile(userProfile);

      // 2. Fetch volunteer stats if applicable
      if (userProfile?.is_volunteer) {
        // Fetch total assists count
        const { count, error: countErr } = await supabase
          .from('volunteer_responses')
          .select('id', { count: 'exact', head: true })
          .eq('volunteer_id', user.id)
          .eq('status', 'completed');
        
        if (!countErr) setTotalAssists(count ?? 0);

        // Fetch badges from auth user metadata (client safe)
        const meta = user.user_metadata ?? {};
        const badgesArr = Array.isArray(meta.badges) ? meta.badges : [];
        if (badgesArr.length === 0 && (count ?? 0) >= 1) {
          // If metadata is empty but has assists, auto-mock basic badges to avoid blank screens
          badgesArr.push('Community Hero', 'Quick Responder');
          if ((count ?? 0) >= 5) badgesArr.push('Silver Shield');
          if ((count ?? 0) >= 20) badgesArr.push('Gold Champion');
        }
        setBadges(badgesArr);
      }
    } catch (err: any) {
      console.error('[ProfileScreen] loadProfileData error:', err);
      setErrorMsg(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  // Logout flow
  const handleLogout = () => {
    const performLogout = async () => {
      await supabase.auth.signOut();
      router.replace('/(auth)/login');
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to log out of SafeCircle?')) {
        performLogout();
      }
      return;
    }

    Alert.alert(
      'Logout',
      'Are you sure you want to log out of SafeCircle?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: performLogout,
        },
      ]
    );
  };

  // Toggle volunteer availability directly
  const handleToggleVolunteer = async () => {
    if (!profile) return;
    try {
      const nextVolunteerState = !profile.is_volunteer;
      const { error } = await supabase
        .from('users')
        .update({ is_volunteer: nextVolunteerState })
        .eq('id', profile.id);

      if (error) throw error;
      setProfile({ ...profile, is_volunteer: nextVolunteerState });
      loadProfileData();
      Alert.alert(
        'Success',
        nextVolunteerState
          ? 'You are now registered as a SafeCircle Volunteer! Verify your identity to unlock higher tiers.'
          : 'Volunteer responder mode deactivated.'
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update volunteer status');
    }
  };

  // Navigate to dedicated Incident Report screen
  const handleViewIncidents = () => {
    router.push('/incident-report');
  };


  // Navigate to dedicated credits history screen
  const handleViewCreditsHistory = () => {
    router.push('/credits-history');
  };

  const handleVerifyIdentity = () => {
    // Navigate to the full verification hub (Aadhaar OTP + Selfie Liveness)
    router.push('/verification' as any);
  };

  // Helpers
  const getTierDetails = (tier: number) => {
    switch (tier) {
      case 3:
        return { label: '🥇 Champion Responder', color: '#F1C40F' };
      case 2:
        return { label: '🟢 Community Verified', color: Colors.safe };
      case 1:
      default:
        return { label: '🔵 Basic Verified', color: '#2980B9' };
    }
  };

  const getTrustColor = (score: number) => {
    if (score >= 70) return Colors.safe;
    if (score >= 40) return Colors.warning;
    return Colors.primary;
  };

  const getMockRank = (credits: number) => {
    if (credits > 300) return 'Top 8% in Nagpur';
    if (credits > 100) return 'Top 15% in Nagpur';
    return 'Top 25% in Nagpur';
  };

  const initialsFromName = (fullName: string | null) => {
    if (!fullName) return 'U';
    return fullName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const tierInfo = getTierDetails(profile?.verification_tier ?? 1);
  const trustColor = getTrustColor(profile?.trust_score ?? 50);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* USER HEADER CARD */}
      <View style={styles.profileHeaderCard}>
        <View style={[styles.avatarCircle, { backgroundColor: tierInfo.color }]}>
          <Text style={styles.avatarText}>
            {initialsFromName(profile?.name ?? null)}
          </Text>
        </View>
        <Text style={styles.nameText}>{profile?.name || 'SafeCircle User'}</Text>
        <Text style={styles.phoneText}>{profile?.phone}</Text>
        
        <View style={[styles.tierBadge, { borderColor: tierInfo.color }]}>
          <Text style={[styles.tierBadgeText, { color: tierInfo.color }]}>
            {tierInfo.label}
          </Text>
        </View>

        {/* TRUST SCORE BAR */}
        <View style={styles.trustScoreContainer}>
          <View style={styles.trustScoreHeader}>
            <Text style={styles.trustScoreLabel}>Trust Rating</Text>
            <Text style={[styles.trustScoreVal, { color: trustColor }]}>
              {profile?.trust_score.toFixed(0)}%
            </Text>
          </View>
          <View style={styles.trustScoreTrack}>
            <View
              style={[
                styles.trustScoreProgress,
                { width: `${profile?.trust_score ?? 50}%`, backgroundColor: trustColor }
              ]}
            />
          </View>
        </View>
      </View>

      {/* VOLUNTEER STATS PANEL */}
      {profile?.is_volunteer && (
        <View style={styles.volunteerPanel}>
          <Text style={styles.panelTitle}>🤝 Volunteer Achievements</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{totalAssists}</Text>
              <Text style={styles.statLbl}>SOS Assists</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>💰 {profile?.credits}</Text>
              <Text style={styles.statLbl}>Credits Balance</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValText}>{getMockRank(profile?.credits ?? 0)}</Text>
              <Text style={styles.statLbl}>Nagpur Rank</Text>
            </View>
          </View>

          {/* BADGES COLLECTION */}
          <Text style={styles.badgeSectionTitle}>🏅 Earned Badges</Text>
          {badges.length > 0 ? (
            <View style={styles.badgesRow}>
              {badges.map((badge, idx) => (
                <View key={idx} style={styles.badgeChip}>
                  <Text style={styles.badgeChipText}>🛡️ {badge}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.noBadgesText}>
              No milestone badges earned yet. Respond to SOS alerts to earn badges!
            </Text>
          )}
        </View>
      )}

      {/* QUICK ACTIONS LIST */}
      <View style={styles.actionsPanel}>
        <Text style={styles.panelTitle}>🛡️ Quick Actions</Text>

        <TouchableOpacity
          onPress={() => router.push('/emergency-contacts')}
          style={styles.actionItem}
        >
          <Text style={styles.actionItemText}>📞 Emergency Contacts</Text>
          <Text style={styles.chevron}>➔</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/settings')}
          style={styles.actionItem}
        >
          <Text style={styles.actionItemText}>🔔 Notification & Alert Settings</Text>
          <Text style={styles.chevron}>➔</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleVerifyIdentity}
          style={styles.actionItem}
        >
          <Text style={styles.actionItemText}>🛡️ Verify Responder Profile</Text>
          <Text style={styles.chevron}>➔</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleViewIncidents}
          style={styles.actionItem}
        >
          <Text style={styles.actionItemText}>📋 Incident History &amp; Reports</Text>
          <Text style={styles.chevron}>➔</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleViewCreditsHistory}
          style={styles.actionItem}
        >
          <Text style={styles.actionItemText}>📋 Credits & Rewards Balance</Text>
          <Text style={styles.chevron}>➔</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleToggleVolunteer}
          style={styles.actionItem}
        >
          <Text style={styles.actionItemText}>
            {profile?.is_volunteer ? '❌ Deactivate Volunteer Mode' : '🤝 Activate Volunteer Mode'}
          </Text>
          <Text style={styles.chevron}>➔</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleLogout}
          style={[styles.actionItem, styles.logoutItem]}
        >
          <Text style={[styles.actionItemText, styles.logoutText]}>🚪 Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* MODAL 1: INCIDENT HISTORY */}
      <Modal
        visible={historyModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeader}>Incident History</Text>
            {loadingIncidents ? (
              <ActivityIndicator color={Colors.primary} style={styles.modalLoader} />
            ) : incidents.length > 0 ? (
              <FlatList
                data={incidents}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={styles.historyCard}>
                    <View style={styles.historyRow}>
                      <Text style={styles.historyStatus}>
                        🚨 Status: {item.status.toUpperCase()}
                      </Text>
                      <Text style={styles.historyDate}>
                        {new Date(item.started_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text style={styles.historyLoc}>
                      Coords: {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                    </Text>
                  </View>
                )}
              />
            ) : (
              <Text style={styles.modalEmpty}>No past SOS alerts found.</Text>
            )}
            <TouchableOpacity
              onPress={() => setHistoryModalVisible(false)}
              style={styles.closeModalBtn}
            >
              <Text style={styles.closeModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL 2: CREDITS HISTORY */}
      <Modal
        visible={creditsModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setCreditsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeader}>Credits Transactions</Text>
            {loadingCredits ? (
              <ActivityIndicator color={Colors.primary} style={styles.modalLoader} />
            ) : transactions.length > 0 ? (
              <FlatList
                data={transactions}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={styles.historyCard}>
                    <View style={styles.historyRow}>
                      <Text style={[styles.historyStatus, { color: item.amount > 0 ? Colors.safe : Colors.primary }]}>
                        {item.amount > 0 ? `+${item.amount}` : item.amount} Credits
                      </Text>
                      <Text style={styles.historyDate}>
                        {new Date(item.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text style={styles.historyLoc}>{item.reason}</Text>
                  </View>
                )}
              />
            ) : (
              <Text style={styles.modalEmpty}>No credit transactions found.</Text>
            )}
            <TouchableOpacity
              onPress={() => setCreditsModalVisible(false)}
              style={styles.closeModalBtn}
            >
              <Text style={styles.closeModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {errorMsg && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loaderContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 24 : 10,
    paddingBottom: 40,
  },
  profileHeaderCard: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2C3E50',
    marginBottom: 20,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  avatarText: {
    color: '#FFF',
    fontSize: 32,
    fontWeight: 'bold',
  },
  nameText: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  phoneText: {
    color: Colors.textMuted,
    fontSize: 14,
    marginBottom: 12,
  },
  tierBadge: {
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 20,
  },
  tierBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  trustScoreContainer: {
    width: '100%',
    marginTop: 8,
  },
  trustScoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  trustScoreLabel: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  trustScoreVal: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  trustScoreTrack: {
    height: 8,
    backgroundColor: '#2C3E50',
    borderRadius: 4,
    overflow: 'hidden',
  },
  trustScoreProgress: {
    height: '100%',
    borderRadius: 4,
  },
  volunteerPanel: {
    backgroundColor: Colors.surface,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2C3E50',
    marginBottom: 20,
  },
  panelTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#1E272E',
  },
  statVal: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statValText: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
    height: 22,
    justifyContent: 'center',
  },
  statBgText: {
    fontSize: 11,
  },
  statLbl: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  badgeSectionTitle: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgeChip: {
    backgroundColor: '#34495E',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeChipText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  noBadgesText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  actionsPanel: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#2C3E50',
    marginBottom: 20,
  },
  actionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2C3E50',
  },
  actionItemText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  chevron: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  logoutItem: {
    borderBottomWidth: 0,
    justifyContent: 'center',
    paddingTop: 20,
  },
  logoutText: {
    color: Colors.primary,
    fontWeight: 'bold',
  },
  errorContainer: {
    backgroundColor: Colors.primary,
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  errorText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    height: '60%',
    borderWidth: 1,
    borderColor: '#2C3E50',
  },
  modalHeader: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 18,
    textAlign: 'center',
  },
  modalLoader: {
    marginTop: 40,
  },
  historyCard: {
    backgroundColor: '#0D0D0D',
    padding: 14,
    borderRadius: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#2C3E50',
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  historyStatus: {
    color: Colors.accent,
    fontWeight: 'bold',
    fontSize: 13,
  },
  historyDate: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  historyLoc: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  modalEmpty: {
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },
  closeModalBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  closeModalText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
