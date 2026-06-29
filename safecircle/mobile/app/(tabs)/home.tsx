import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  StatusBar,
  ScrollView,
  Alert,
  Modal,
  TouchableWithoutFeedback,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import { router } from 'expo-router';
import { Accelerometer } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import { SOSButton } from '../../components/SOSButton';
import { CountdownOverlay } from '../../components/CountdownOverlay';
import { useSOS } from '../../hooks/useSOS';
import { supabase, getCurrentUser, updateUserLocation } from '../../lib/supabase';
import { scheduleFakeCall } from '../../lib/fakeCall';
import { VoiceDistressDetector } from '../../lib/voiceDistress';
import { BatteryManager } from '../../lib/batteryManager';
import { NetworkManager } from '../../lib/networkManager';
import Colors from '../../constants/Colors';
import * as Location from 'expo-location';

// ── Mic indicator: pulsing mic shown when voice SOS is listening ──
function MicIndicator({ active }: { active: boolean }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacAnim, {
      toValue: active ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();

    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  return (
    <Animated.View style={[micStyles.wrap, { opacity: opacAnim }]}>
      <Animated.View style={[micStyles.dot, { transform: [{ scale: pulseAnim }] }]} />
      <Text style={micStyles.icon}>🎙️</Text>
      <Text style={micStyles.label}>Listening</Text>
    </Animated.View>
  );
}

// ── Brain indicator: pulsing brain shown when voice distress AI is active ──
function BrainIndicator({ active }: { active: boolean }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacAnim, {
      toValue: active ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();

    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  return (
    <Animated.View style={[brainStyles.wrap, { opacity: opacAnim }]}>
      <Animated.View style={[brainStyles.dot, { transform: [{ scale: pulseAnim }] }]} />
      <Text style={brainStyles.icon}>🧠</Text>
      <Text style={brainStyles.label}>AI Listening</Text>
    </Animated.View>
  );
}

const brainStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(155,89,182,0.12)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(155,89,182,0.3)',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#9B59B6',
  },
  icon:  { fontSize: 13 },
  label: { color: '#9B59B6', fontSize: 11, fontWeight: '700' },
});

const micStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(30,132,73,0.12)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.safe + '55',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.safe,
  },
  icon:  { fontSize: 13 },
  label: { color: Colors.safe, fontSize: 11, fontWeight: '700' },
});

// ── Shake detection constants ──────────────────────────────────
const SHAKE_THRESHOLD = 2.5;
const SHAKE_CONSECUTIVE = 3;

// ── Quick-action items ────────────────────────────────────────
const QUICK_ACTIONS = [
  { id: 'location', icon: '📍', label: 'Share Location' },
  { id: 'fakecall', icon: '📞', label: 'Fake Call' },
  { id: 'route',    icon: '🗺️', label: 'Safe Route' },
] as const;

type QuickActionId = (typeof QUICK_ACTIONS)[number]['id'];

export default function HomeScreen() {
  const sos = useSOS();

  const [userName, setUserName]           = useState('');
  const [volunteerCount, setVolunteerCount] = useState(0);
  const [shakeToast, setShakeToast]       = useState(false);
  const [fakeCallModalVisible, setFakeCallModalVisible] = useState(false);
  const [voiceDistressActive, setVoiceDistressActive] = useState(false);
  const [batteryTier, setBatteryTier] = useState<'critical' | 'low' | 'normal'>('normal');

  // ── Battery Management ──────────────────────────────────────
  useEffect(() => {
    const unsub = BatteryManager.getInstance().subscribe((tier) => {
      setBatteryTier(tier);
      if (tier === 'critical') {
        VoiceDistressDetector.getInstance().stop().then(() => setVoiceDistressActive(false));
      } else if (AppState.currentState === 'active') {
        VoiceDistressDetector.getInstance().start().then(() => {
          setVoiceDistressActive(VoiceDistressDetector.getInstance().isRunning);
        });
      }
    });
    return () => unsub();
  }, []);

  // ── Voice Distress AI Listening ─────────────────────────────
  useEffect(() => {
    const detector = VoiceDistressDetector.getInstance();

    detector.setCallback(() => {
      sos.startCountdown(false, 'voice');
    });

    const startDetector = async () => {
      const canRun = BatteryManager.getInstance().shouldRunFeature('voice');
      if (!canRun) {
        console.log('[Home] Battery critical. Disabling Voice Distress AI.');
        return;
      }
      await detector.start();
      setVoiceDistressActive(detector.isRunning);
    };

    const stopDetector = async () => {
      await detector.stop();
      setVoiceDistressActive(false);
    };

    if (AppState.currentState === 'active') {
      startDetector();
    }

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        startDetector();
      } else {
        stopDetector();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      stopDetector();
    };
  }, []);

  const triggerQuickFakeCall = async (delaySeconds: number) => {
    setFakeCallModalVisible(false);
    if (delaySeconds === 0) {
      router.push({
        pathname: '/fake-call',
        params: { mode: 'ringing', callerName: 'Mom', avatar: '👩', scriptId: 'mom' },
      });
    } else {
      try {
        await scheduleFakeCall(delaySeconds, 'Mom', '👩', 'mom');
        Alert.alert(
          'Deterrence Call Scheduled',
          `A fake call from Mom will ring in ${delaySeconds === 60 ? '1 minute' : '2 minutes'}.`
        );
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to schedule fake call.');
      }
    }
  };

  // Animations
  const headerAnim  = useRef(new Animated.Value(0)).current;
  const buttonAnim  = useRef(new Animated.Value(0)).current;
  const pillsAnim   = useRef(new Animated.Value(30)).current;
  const pillsOpacity = useRef(new Animated.Value(0)).current;
  const toastAnim   = useRef(new Animated.Value(0)).current;

  // Shake
  const shakeCount  = useRef(0);
  const accelSub    = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
  const lastShakeTs = useRef(0);

  // ── Entry animation ─────────────────────────────────────────
  useEffect(() => {
    Animated.stagger(120, [
      Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(buttonAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(pillsAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(pillsOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  // ── Fetch user + volunteer count ────────────────────────────
  useEffect(() => {
    loadUserData();
    loadVolunteerCount();
    startLocationTracking();
    startShakeDetection();

    return () => {
      accelSub.current?.remove();
      accelSub.current = null;
    };
  }, []);

  const loadUserData = async () => {
    const user = await getCurrentUser();
    if (user?.name) setUserName(user.name.split(' ')[0]);
  };

  const loadVolunteerCount = async () => {
    try {
      // Count volunteers who updated location in last 10 minutes
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('is_volunteer', true)
        .gte('location_updated_at', tenMinsAgo);

      setVolunteerCount(count ?? 0);
    } catch {
      setVolunteerCount(0);
    }
  };

  const startLocationTracking = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await updateUserLocation(loc.coords.latitude, loc.coords.longitude);
    } catch {}
  };

  // ── Shake detection ─────────────────────────────────────────
  const startShakeDetection = () => {
    const rate = BatteryManager.getInstance().getAccelerometerSampleRate();
    if (rate <= 0) {
      console.log('[Home] Battery critical or accelerometer disabled. Skipping shake detection.');
      return;
    }

    Accelerometer.setUpdateInterval(1000 / rate);
    accelSub.current = Accelerometer.addListener(({ x, y, z }) => {
      // Skip if SOS countdown or SOS is already active
      if (sos.countdownActive || sos.isSOSActive) return;

      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();

      if (magnitude > SHAKE_THRESHOLD) {
        // Prevent spamming (800ms debounce between triggers)
        if (now - lastShakeTs.current < 800) return;
        lastShakeTs.current = now;

        shakeCount.current += 1;
        if (shakeCount.current >= SHAKE_CONSECUTIVE) {
          shakeCount.current = 0;
          handleShakeTrigger();
        }
      } else {
        // Reset if stationary
        if (now - lastShakeTs.current > 500) shakeCount.current = 0;
      }
    });
  };

  const handleShakeTrigger = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    showShakeToast();
    sos.startCountdown(false, 'shake'); // pass trigger method for analytics
  };

  const showShakeToast = () => {
    setShakeToast(true);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setShakeToast(false));
  };

  // ── Quick actions ───────────────────────────────────────────
  const handleQuickAction = (id: QuickActionId) => {
    switch (id) {
      case 'location':
        router.push('/emergency-contacts');
        break;
      case 'fakecall':
        setFakeCallModalVisible(true);
        break;
      case 'route':
        router.push('/safe-route');
        break;
    }
  };

  // ── Volunteer status label ──────────────────────────────────
  const volunteerLabel =
    volunteerCount === 0
      ? 'No active volunteers nearby'
      : volunteerCount === 1
      ? '1 verified volunteer nearby'
      : `${volunteerCount} verified volunteers nearby`;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
      >
        {/* ── Header / Greeting ─────────────────────────────── */}
        <Animated.View style={[styles.header, { opacity: headerAnim }]}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.greeting}>
                {userName ? `Stay safe, ${userName} 👋` : 'Stay safe 👋'}
              </Text>
              <Text style={styles.subGreeting}>SafeCircle is watching over you</Text>
            </View>
            <View style={styles.headerRight}>
              {/* Pulsing mic indicator — shown when voice SOS is listening */}
              <MicIndicator active={sos.voiceListening} />
              {/* Pulsing brain indicator — shown when voice distress AI is active */}
              <BrainIndicator active={voiceDistressActive} />
              <View style={styles.shieldBadge}>
                <Text style={styles.shieldEmoji}>🛡️</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {batteryTier === 'critical' && (
          <View style={styles.batteryWarning}>
            <Text style={styles.batteryWarningText}>
              ⚠️ Low battery — some features paused to preserve SOS function
            </Text>
          </View>
        )}

        {/* ── SOS Button ─────────────────────────────────────── */}
        <Animated.View style={[styles.sosWrapper, { opacity: buttonAnim, transform: [{ scale: buttonAnim }] }]}>
          <SOSButton
            onPress={() => sos.startCountdown(false)}
            onLongPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
              sos.startCountdown(true);
            }}
            disabled={sos.isSOSActive}
          />

          {sos.isSOSActive && (
            <View style={styles.activeIndicator}>
              <View style={styles.activeDot} />
              <Text style={styles.activeText}>SOS ACTIVE — help is coming</Text>
            </View>
          )}
        </Animated.View>

        {/* ── Quick-action pills ──────────────────────────────── */}
        <Animated.View
          style={[
            styles.pillsRow,
            {
              opacity: pillsOpacity,
              transform: [{ translateY: pillsAnim }],
            },
          ]}
        >
          {QUICK_ACTIONS.map(({ id, icon, label }) => (
            <TouchableOpacity
              key={id}
              style={styles.pill}
              onPress={() => handleQuickAction(id)}
              activeOpacity={0.75}
            >
              <Text style={styles.pillIcon}>{icon}</Text>
              <Text style={styles.pillLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </Animated.View>

        {/* ── Volunteer count bar ─────────────────────────────── */}
        <Animated.View style={[styles.volunteerBar, { opacity: pillsOpacity }]}>
          <View style={[styles.dot, { backgroundColor: volunteerCount > 0 ? Colors.safe : '#666' }]} />
          <Text style={[styles.volunteerText, { color: volunteerCount > 0 ? Colors.safe : Colors.textMuted }]}>
            {volunteerLabel}
          </Text>
          {volunteerCount > 0 && (
            <TouchableOpacity onPress={loadVolunteerCount} style={styles.refreshBtn}>
              <Text style={styles.refreshText}>↻</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </ScrollView>

      {/* ── Countdown Overlay ───────────────────────────────── */}
      <CountdownOverlay
        visible={sos.countdownActive}
        countdown={sos.countdownValue}
        isSilent={sos.isSilentMode}
        onCancel={sos.cancelCountdown}
      />

      {/* ── Shake toast ─────────────────────────────────────── */}
      {shakeToast && (
        <Animated.View style={[styles.shakeToast, { opacity: toastAnim }]}>
          <Text style={styles.shakeToastText}>📳  Shake detected — activating SOS</Text>
        </Animated.View>
      )}

      {/* ── Fake Call Quick Action Sheet ──────────────────────── */}
      <Modal
        visible={fakeCallModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setFakeCallModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setFakeCallModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                <View style={styles.modalHeaderIndicator} />
                <Text style={styles.modalTitle}>📞 Quick Fake Call</Text>
                <Text style={styles.modalSubtitle}>Trigger a distraction call to safely exit a situation.</Text>

                <TouchableOpacity
                  onPress={() => triggerQuickFakeCall(0)}
                  style={styles.modalBtn}
                >
                  <Text style={styles.modalBtnIcon}>⚡</Text>
                  <View style={styles.modalBtnTextContainer}>
                    <Text style={styles.modalBtnTitle}>Call Now</Text>
                    <Text style={styles.modalBtnDesc}>Trigger the incoming call screen instantly</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => triggerQuickFakeCall(60)}
                  style={styles.modalBtn}
                >
                  <Text style={styles.modalBtnIcon}>⏱️</Text>
                  <View style={styles.modalBtnTextContainer}>
                    <Text style={styles.modalBtnTitle}>Call in 1 Minute</Text>
                    <Text style={styles.modalBtnDesc}>Rings after a 60-second delay</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => triggerQuickFakeCall(120)}
                  style={styles.modalBtn}
                >
                  <Text style={styles.modalBtnIcon}>⏱️</Text>
                  <View style={styles.modalBtnTextContainer}>
                    <Text style={styles.modalBtnTitle}>Call in 2 Minutes</Text>
                    <Text style={styles.modalBtnDesc}>Rings after a 120-second delay</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setFakeCallModalVisible(false);
                    router.push('/fake-call');
                  }}
                  style={[styles.modalBtn, styles.modalBtnCustom]}
                >
                  <Text style={styles.modalBtnIcon}>⚙️</Text>
                  <View style={styles.modalBtnTextContainer}>
                    <Text style={styles.modalBtnTitle}>Custom Details & Scripts...</Text>
                    <Text style={styles.modalBtnDesc}>Change caller name, avatar and voice message</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setFakeCallModalVisible(false)}
                  style={styles.modalCancelBtn}
                >
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 32,
    alignItems: 'center',
  },

  // ── Header ────────────────────────────────────────────────
  header: {
    width: '100%',
    marginBottom: 32,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  greeting: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  subGreeting: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  shieldBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  shieldEmoji: {
    fontSize: 24,
  },

  // ── SOS wrapper ───────────────────────────────────────────
  sosWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  activeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    backgroundColor: 'rgba(192,57,43,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.primary,
    gap: 8,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  activeText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // ── Quick-action pills ────────────────────────────────────
  pillsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 20,
  },
  pill: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    paddingVertical: 14,
    alignItems: 'center',
    gap: 6,
  },
  pillIcon: {
    fontSize: 20,
  },
  pillLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },

  // ── Volunteer bar ─────────────────────────────────────────
  volunteerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  volunteerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  refreshBtn: {
    padding: 4,
  },
  refreshText: {
    color: Colors.textMuted,
    fontSize: 16,
  },

  // ── Shake toast ───────────────────────────────────────────
  shakeToast: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    backgroundColor: Colors.warning,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  shakeToastText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.3,
  },

  // ── Modal Sheet ───────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#161622',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    borderWidth: 0.5,
    borderColor: '#2A2A3E',
  },
  modalHeaderIndicator: {
    width: 40,
    height: 4,
    backgroundColor: '#2A2A3E',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  modalSubtitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 20,
  },
  modalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E2A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: '#2A2A3E',
  },
  modalBtnCustom: {
    borderColor: '#EF9F2733',
    backgroundColor: '#EF9F2705',
  },
  modalBtnIcon: {
    fontSize: 20,
    marginRight: 14,
    color: '#EF9F27',
  },
  modalBtnTextContainer: {
    flex: 1,
  },
  modalBtnTitle: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalBtnDesc: {
    color: '#888',
    fontSize: 10,
    marginTop: 2,
  },
  modalCancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: '#0F0F14',
    borderWidth: 0.5,
    borderColor: '#2A2A3E',
  },
  modalCancelBtnText: {
    color: '#AAA',
    fontSize: 13,
    fontWeight: 'bold',
  },
  batteryWarning: {
    backgroundColor: '#7F1D1D',
    borderColor: '#F87171',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 20,
    marginTop: 10,
    alignItems: 'center',
  },
  batteryWarningText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
