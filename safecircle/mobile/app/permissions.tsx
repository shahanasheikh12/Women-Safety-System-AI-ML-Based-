/**
 * mobile/app/permissions.tsx
 * ───────────────────────────
 * First-launch permissions gate.
 *
 * Shows each required permission as a card with icon, rationale,
 * and a "Grant Permission" CTA. Tracks granted state in AsyncStorage.
 * Navigates to /(tabs)/home on completion (or skip).
 *
 * Permissions requested:
 *   📍 Location (foreground + background Always) — SOS location sharing
 *   🎙️ Microphone                               — Voice SOS hotword
 *   📷 Camera                                    — Evidence photo during SOS
 *   🔔 Notifications                             — Volunteer alerts & warnings
 *   📱 Background App Refresh                    — Background SOS + task manager
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  StatusBar,
  Platform,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Colors from '../constants/Colors';

const { height } = Dimensions.get('window');

// ─── Storage key ───────────────────────────────────────────────
export const PERMISSIONS_DONE_KEY = 'sc_permissions_done';
export const PERMISSIONS_STATE_KEY = 'sc_permissions_state';

// ─── Permission definitions ────────────────────────────────────
export type PermissionId =
  | 'location'
  | 'location_background'
  | 'microphone'
  | 'camera'
  | 'notifications'
  | 'background_refresh';

interface PermissionDef {
  id:          PermissionId;
  icon:        string;
  title:       string;
  rationale:   string;
  required:    boolean;   // If false → "Limited Mode" warning shown when denied
  limitedNote?: string;   // Warning shown when denied
}

const PERMISSIONS: PermissionDef[] = [
  {
    id:        'location',
    icon:      '📍',
    title:     'Location (Always)',
    rationale: 'To share your real-time GPS location with volunteers and emergency contacts during an SOS event — even when the app is in the background.',
    required:  true,
    limitedNote: 'Without location access, SafeCircle cannot pinpoint your position during emergencies. SOS will fire but without a map location.',
  },
  {
    id:        'microphone',
    icon:      '🎙️',
    title:     'Microphone',
    rationale: 'Enables Voice SOS — say "help me safecircle" or "bachao bachao" and SafeCircle will automatically trigger an emergency alert, even when your phone is locked.',
    required:  false,
    limitedNote: 'Voice SOS will be disabled. You can still use the manual button, shake, or power-button triggers.',
  },
  {
    id:        'camera',
    icon:      '📷',
    title:     'Camera',
    rationale: 'SafeCircle can silently capture a photo of your surroundings when an SOS is activated, providing visual evidence for responders and law enforcement.',
    required:  false,
    limitedNote: 'Evidence photo capture will be unavailable during SOS events.',
  },
  {
    id:        'notifications',
    icon:      '🔔',
    title:     'Notifications',
    rationale: 'To send you critical volunteer alerts, incoming SOS events nearby (if you\'re a volunteer), and safety warnings about your current location.',
    required:  true,
    limitedNote: 'You will not receive volunteer alerts, SOS updates, or area safety warnings. Critical for your safety as a volunteer.',
  },
  {
    id:        'background_refresh',
    icon:      '📱',
    title:     'Background App Refresh',
    rationale: 'Keeps SafeCircle\'s voice detection, power-button SOS, and location streaming active even when you switch to another app or lock your screen.',
    required:  false,
    limitedNote: 'Voice SOS and power-button SOS will only work while SafeCircle is the active foreground app.',
  },
];

// ─── Permission status type ────────────────────────────────────
type PermStatus = 'idle' | 'granted' | 'denied' | 'loading';

// ─── Permission card component ─────────────────────────────────
function PermissionCard({
  def,
  status,
  onGrant,
  index,
}: {
  def:     PermissionDef;
  status:  PermStatus;
  onGrant: () => void;
  index:   number;
}) {
  const slideAnim  = useRef(new Animated.Value(40)).current;
  const opacAnim   = useRef(new Animated.Value(0)).current;
  const scaleAnim  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 400,
        delay: index * 90,
        useNativeDriver: true,
      }),
      Animated.timing(opacAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 90,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Pulse when idle (to draw attention)
  useEffect(() => {
    if (status !== 'idle') return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.015, duration: 900, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [status]);

  const isGranted = status === 'granted';
  const isDenied  = status === 'denied';
  const isLoading = status === 'loading';

  return (
    <Animated.View
      style={{
        opacity:   opacAnim,
        transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
      }}
    >
      <View
        style={[
          styles.permCard,
          isGranted && styles.permCardGranted,
          isDenied  && styles.permCardDenied,
        ]}
      >
        {/* Left: icon + required badge */}
        <View style={styles.permLeft}>
          <View
            style={[
              styles.permIconWrap,
              isGranted && { backgroundColor: 'rgba(30,132,73,0.18)', borderColor: Colors.safe + '55' },
              isDenied  && { backgroundColor: 'rgba(192,57,43,0.12)', borderColor: Colors.primary + '55' },
            ]}
          >
            <Text style={styles.permIcon}>{def.icon}</Text>
          </View>
          {def.required && !isGranted && (
            <View style={styles.requiredBadge}>
              <Text style={styles.requiredText}>Required</Text>
            </View>
          )}
        </View>

        {/* Right: content */}
        <View style={styles.permContent}>
          <View style={styles.permHeader}>
            <Text style={[styles.permTitle, isGranted && { color: Colors.safe }]}>
              {def.title}
            </Text>
            {isGranted && <Text style={styles.grantedCheck}>✓</Text>}
          </View>

          <Text style={styles.permRationale}>{def.rationale}</Text>

          {/* Limited mode warning when denied */}
          {isDenied && def.limitedNote && (
            <View style={styles.limitedBox}>
              <Text style={styles.limitedText}>⚠️  {def.limitedNote}</Text>
            </View>
          )}

          {/* Action button */}
          {!isGranted && (
            <TouchableOpacity
              style={[
                styles.grantBtn,
                isDenied && styles.grantBtnDenied,
                isLoading && styles.grantBtnLoading,
              ]}
              onPress={onGrant}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.grantBtnText}>
                  {isDenied ? '⚙️ Open Settings' : 'Grant Permission →'}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {isGranted && (
            <View style={styles.grantedRow}>
              <View style={styles.grantedDot} />
              <Text style={styles.grantedLabel}>Permission granted</Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// ─── Main screen ───────────────────────────────────────────────
export default function PermissionsScreen() {
  const [statuses, setStatuses] = useState<Record<PermissionId, PermStatus>>({
    location:           'idle',
    location_background:'idle',
    microphone:         'idle',
    camera:             'idle',
    notifications:      'idle',
    background_refresh: 'idle',
  });

  const [allCriticalGranted, setAllCriticalGranted] = useState(false);
  const [hasLimitedMode,     setHasLimitedMode]      = useState(false);
  const [done,               setDone]                = useState(false);

  const heroAnim    = useRef(new Animated.Value(0)).current;
  const footerAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(heroAnim,   { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(footerAnim, { toValue: 1, duration: 800, delay: 200, useNativeDriver: true }),
    ]).start();

    // Check any already-granted permissions from a previous session
    checkExistingPermissions();
  }, []);

  // Recompute summary whenever statuses change
  useEffect(() => {
    const required = PERMISSIONS.filter((p) => p.required);
    const allReq   = required.every((p) => statuses[p.id] === 'granted');
    const anyDenied = PERMISSIONS.some((p) => statuses[p.id] === 'denied');

    setAllCriticalGranted(allReq);
    setHasLimitedMode(anyDenied && allReq);
  }, [statuses]);

  const setStatus = (id: PermissionId, status: PermStatus) =>
    setStatuses((prev) => ({ ...prev, [id]: status }));

  // ── Check existing permissions ─────────────────────────────
  const checkExistingPermissions = async () => {
    // Location
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') setStatus('location', 'granted');
    } catch {}

    // Background location
    try {
      const { status } = await Location.getBackgroundPermissionsAsync();
      if (status === 'granted') setStatus('location_background', 'granted');
    } catch {}

    // Camera
    try {
      const { status } = await Camera.getCameraPermissionsAsync();
      if (status === 'granted') setStatus('camera', 'granted');
    } catch {}

    // Microphone
    try {
      const perm = await Audio.getPermissionsAsync();
      if (perm.status === 'granted') setStatus('microphone', 'granted');
    } catch {}

    // Notifications
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'granted') setStatus('notifications', 'granted');
    } catch {}

    // Background refresh: no direct API — mark granted on Android by default
    if (Platform.OS === 'android') {
      setStatus('background_refresh', 'granted');
    }
  };

  // ── Grant handlers ─────────────────────────────────────────
  const grantLocation = useCallback(async () => {
    setStatus('location', 'loading');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setStatus('location', 'granted');
        // Immediately request background (Always) permission
        const bg = await Location.requestBackgroundPermissionsAsync();
        setStatus('location_background', bg.status === 'granted' ? 'granted' : 'denied');
      } else {
        setStatus('location', 'denied');
      }
    } catch {
      setStatus('location', 'denied');
    }
  }, []);

  const grantMicrophone = useCallback(async () => {
    setStatus('microphone', 'loading');
    try {
      const { status } = await Audio.requestPermissionsAsync();
      setStatus('microphone', status === 'granted' ? 'granted' : 'denied');
    } catch {
      setStatus('microphone', 'denied');
    }
  }, []);

  const grantCamera = useCallback(async () => {
    setStatus('camera', 'loading');
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setStatus('camera', status === 'granted' ? 'granted' : 'denied');
    } catch {
      setStatus('camera', 'denied');
    }
  }, []);

  const grantNotifications = useCallback(async () => {
    setStatus('notifications', 'loading');
    try {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowCriticalAlerts: true,
        },
      });
      setStatus('notifications', status === 'granted' ? 'granted' : 'denied');
    } catch {
      setStatus('notifications', 'denied');
    }
  }, []);

  const grantBackgroundRefresh = useCallback(async () => {
    // iOS: prompt user to enable manually in Settings; Android: always available
    if (Platform.OS === 'android') {
      setStatus('background_refresh', 'granted');
    } else {
      // On iOS, show instructions — no programmatic API exists
      setStatus('background_refresh', 'loading');
      setTimeout(() => {
        // Assume they did it; actual check is done on next foreground
        setStatus('background_refresh', 'granted');
      }, 1500);
    }
  }, []);

  const getGrantHandler = (id: PermissionId): (() => void) => {
    switch (id) {
      case 'location':
      case 'location_background':
        return grantLocation;
      case 'microphone':
        return grantMicrophone;
      case 'camera':
        return grantCamera;
      case 'notifications':
        return grantNotifications;
      case 'background_refresh':
        return grantBackgroundRefresh;
    }
  };

  // ── Finish & navigate ──────────────────────────────────────
  const handleContinue = async () => {
    // Persist that the permissions flow was completed
    await AsyncStorage.setItem(PERMISSIONS_DONE_KEY, 'true');
    await AsyncStorage.setItem(
      PERMISSIONS_STATE_KEY,
      JSON.stringify(statuses)
    );
    setDone(true);
    // Brief visual confirmation before navigating
    setTimeout(() => router.replace('/(tabs)/home'), 400);
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem(PERMISSIONS_DONE_KEY, 'skipped');
    router.replace('/(tabs)/home');
  };

  // ── Granted count ──────────────────────────────────────────
  const grantedCount = Object.values(statuses).filter((s) => s === 'granted').length;
  const totalCount   = PERMISSIONS.length;

  // Combine location + location_background into one card display
  const visiblePerms = PERMISSIONS.filter((p) => p.id !== 'location_background');

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <Animated.View style={[styles.hero, { opacity: heroAnim, transform: [{ scale: heroAnim }] }]}>
          <View style={styles.heroIconWrap}>
            <Text style={styles.heroIcon}>🛡️</Text>
            <View style={styles.heroGlow} />
          </View>
          <Text style={styles.heroTitle}>SafeCircle needs a few permissions</Text>
          <Text style={styles.heroSub}>
            These allow SafeCircle to protect you 24/7 — even when the app is closed.
            Each permission is used <Text style={{ color: Colors.accent }}>only for your safety</Text>.
          </Text>

          {/* Progress bar */}
          <View style={styles.progressWrap}>
            <View style={styles.progressRow}>
              <Text style={styles.progressLabel}>Permissions granted</Text>
              <Text style={styles.progressCount}>{grantedCount} / {totalCount}</Text>
            </View>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: `${(grantedCount / totalCount) * 100}%`,
                    backgroundColor: grantedCount === totalCount ? Colors.safe : Colors.primary,
                  },
                ]}
              />
            </View>
          </View>
        </Animated.View>

        {/* ── Permission cards ── */}
        <View style={styles.cardsSection}>
          {visiblePerms.map((def, i) => (
            <PermissionCard
              key={def.id}
              def={def}
              status={statuses[def.id]}
              onGrant={getGrantHandler(def.id)}
              index={i}
            />
          ))}
        </View>

        {/* ── Limited mode warning ── */}
        {hasLimitedMode && (
          <View style={styles.limitedModeCard}>
            <Text style={styles.limitedModeTitle}>⚠️  Limited Mode Active</Text>
            <Text style={styles.limitedModeText}>
              Some permissions were denied. SafeCircle will function with reduced
              capabilities. You can grant them later in your device Settings.
            </Text>
          </View>
        )}

        {/* ── CTA section ── */}
        <Animated.View style={[styles.footer, { opacity: footerAnim }]}>
          <TouchableOpacity
            style={[
              styles.continueBtn,
              !allCriticalGranted && styles.continueBtnPartial,
              done && { backgroundColor: Colors.safe },
            ]}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            <Text style={styles.continueBtnText}>
              {done
                ? '✓ All set!'
                : allCriticalGranted
                ? 'Continue to SafeCircle →'
                : 'Continue with Current Permissions →'}
            </Text>
          </TouchableOpacity>

          {!allCriticalGranted && (
            <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
              <Text style={styles.skipText}>Skip for now (Limited Mode)</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.footNote}>
            🔒 Your permissions are used only for safety features.{'\n'}
            We never share location or audio data with third parties.
          </Text>
        </Animated.View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 64 : 44,
    paddingBottom: 32,
  },

  // Hero
  hero: {
    alignItems: 'center',
    marginBottom: 28,
  },
  heroIconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroIcon: { fontSize: 64, zIndex: 2 },
  heroGlow: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: Colors.primary,
    opacity: 0.12,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 30,
  },
  heroSub: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
    paddingHorizontal: 10,
  },

  // Progress
  progressWrap: { width: '100%' },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: { color: Colors.textMuted, fontSize: 12 },
  progressCount:  { color: Colors.text, fontWeight: '700', fontSize: 12 },
  progressTrack: {
    height: 6,
    backgroundColor: '#1A1A2E',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },

  // Cards
  cardsSection: { gap: 14, marginBottom: 20 },

  permCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
    gap: 14,
  },
  permCardGranted: {
    borderColor: Colors.safe + '55',
    backgroundColor: 'rgba(30,132,73,0.05)',
  },
  permCardDenied: {
    borderColor: Colors.primary + '44',
    backgroundColor: 'rgba(192,57,43,0.05)',
  },

  permLeft: { alignItems: 'center', gap: 6, width: 48 },
  permIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#12122A',
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  permIcon: { fontSize: 22 },
  requiredBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  requiredText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },

  permContent: { flex: 1 },
  permHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  permTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.text,
    flex: 1,
  },
  grantedCheck: { color: Colors.safe, fontSize: 16, fontWeight: '900', marginLeft: 8 },
  permRationale: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
    marginBottom: 10,
  },

  limitedBox: {
    backgroundColor: 'rgba(192,57,43,0.1)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
  },
  limitedText: { color: '#FF6B6B', fontSize: 11, lineHeight: 16 },

  grantBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignSelf: 'flex-start',
    minWidth: 160,
    alignItems: 'center',
  },
  grantBtnDenied: { backgroundColor: '#555' },
  grantBtnLoading: { opacity: 0.7 },
  grantBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  grantedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  grantedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.safe,
  },
  grantedLabel: { color: Colors.safe, fontSize: 12, fontWeight: '600' },

  // Limited mode banner
  limitedModeCard: {
    backgroundColor: 'rgba(211,84,0,0.1)',
    borderWidth: 1.5,
    borderColor: Colors.warning + '66',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  limitedModeTitle: {
    color: Colors.warning,
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 6,
  },
  limitedModeText: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 19,
  },

  // Footer
  footer: { gap: 12 },
  continueBtn: {
    backgroundColor: Colors.primary,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  continueBtnPartial: { backgroundColor: '#444' },
  continueBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  skipBtn: { alignItems: 'center', paddingVertical: 4 },
  skipText: { color: Colors.textMuted, fontSize: 13, textDecorationLine: 'underline' },

  footNote: {
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
  },
});
