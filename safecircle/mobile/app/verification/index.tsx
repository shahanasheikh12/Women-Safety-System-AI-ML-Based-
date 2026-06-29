/**
 * mobile/app/verification/index.tsx
 * ──────────────────────────────────
 * Volunteer Identity Verification Hub
 * Step 1: Phone OTP   (completed at login — always ✓)
 * Step 2: Aadhaar OTP verification
 * Step 3: Selfie liveness check
 *
 * On all steps done → verification_tier = 1 + 50 bonus credits + success animation
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  StatusBar,
  Dimensions,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getCurrentUser } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { sendVerificationWelcomeNotification } from '../../lib/notifications';


const { width, height } = Dimensions.get('window');

// ─── Types ───────────────────────────────────────────────────
type StepStatus = 'done' | 'active' | 'pending';

interface Step {
  id: number;
  icon: string;
  title: string;
  description: string;
  status: StepStatus;
  route?: string;
}

// ─── FAQ accordion item ───────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    Animated.timing(anim, {
      toValue: open ? 0 : 1,
      duration: 250,
      useNativeDriver: false,
    }).start();
    setOpen(!open);
  };

  const maxH = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 120] });

  return (
    <View style={styles.faqItem}>
      <TouchableOpacity onPress={toggle} style={styles.faqQ} activeOpacity={0.75}>
        <Text style={styles.faqQText}>{q}</Text>
        <Text style={styles.faqChevron}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      <Animated.View style={{ maxHeight: maxH, overflow: 'hidden' }}>
        <Text style={styles.faqA}>{a}</Text>
      </Animated.View>
    </View>
  );
}

// ─── Step card ────────────────────────────────────────────────
function StepCard({
  step,
  onPress,
}: {
  step: Step;
  onPress?: () => void;
}) {
  const isActive = step.status === 'active';
  const isDone = step.status === 'done';
  const isPending = step.status === 'pending';

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isActive]);

  return (
    <Animated.View style={{ transform: [{ scale: isActive ? pulseAnim : 1 }] }}>
      <TouchableOpacity
        style={[
          styles.stepCard,
          isDone && styles.stepCardDone,
          isActive && styles.stepCardActive,
          isPending && styles.stepCardPending,
        ]}
        onPress={isActive ? onPress : undefined}
        activeOpacity={0.85}
      >
        {/* Step number + icon */}
        <View style={styles.stepLeft}>
          <View
            style={[
              styles.stepIconCircle,
              isDone && { backgroundColor: Colors.safe },
              isActive && { backgroundColor: Colors.primary },
              isPending && { backgroundColor: '#2A2A3E' },
            ]}
          >
            <Text style={styles.stepIcon}>{isDone ? '✓' : step.icon}</Text>
          </View>
        </View>

        {/* Content */}
        <View style={styles.stepContent}>
          <View style={styles.stepHeader}>
            <Text style={[styles.stepTitle, isPending && { color: Colors.textMuted }]}>
              {step.title}
            </Text>
            <View
              style={[
                styles.statusBadge,
                isDone && styles.badgeDone,
                isActive && styles.badgeActive,
                isPending && styles.badgePending,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  isDone && { color: Colors.safe },
                  isActive && { color: Colors.primary },
                  isPending && { color: Colors.textMuted },
                ]}
              >
                {isDone ? 'Completed' : isActive ? 'Action Required' : 'Pending'}
              </Text>
            </View>
          </View>
          <Text style={[styles.stepDesc, isPending && { color: '#555' }]}>
            {step.description}
          </Text>

          {isActive && (
            <TouchableOpacity style={styles.stepCta} onPress={onPress}>
              <Text style={styles.stepCtaText}>Begin →</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Success overlay ──────────────────────────────────────────
function SuccessOverlay({ visible }: { visible: boolean }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const ring1 = useRef(new Animated.Value(1)).current;
  const ring2 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 10 }),
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();

    // ripple rings
    const ripple = () => {
      ring1.setValue(1);
      ring2.setValue(1);
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1, { toValue: 2.5, duration: 1500, useNativeDriver: true }),
            Animated.timing(ring2, { toValue: 0, duration: 1500, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring1, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring2, { toValue: 1, duration: 0, useNativeDriver: true }),
          ])
        ])
      ).start();
    };
    setTimeout(ripple, 200);
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.successOverlay, { opacity }]}>
      <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
        {/* Ripple */}
        <Animated.View
          style={[
            styles.ripple,
            { transform: [{ scale: ring1 }], opacity: ring2 },
          ]}
        />
        <View style={styles.successCircle}>
          <Text style={styles.successCheck}>✓</Text>
        </View>
        <Text style={styles.successTitle}>Identity Verified! 🛡️</Text>
        <Text style={styles.successSub}>
          You are now a{'\n'}
          <Text style={styles.badgeLabel}>⭐ Basic Verified Volunteer</Text>
        </Text>
        <Text style={styles.successCredits}>+50 bonus credits awarded</Text>

        {/* Share badge */}
        <TouchableOpacity style={styles.shareBtn}>
          <Text style={styles.shareBtnText}>🟢 Share Badge on WhatsApp</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.successContinue}
          onPress={() => router.replace('/(tabs)/home')}
        >
          <Text style={styles.successContinueText}>Go to Dashboard →</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function VerificationHub() {
  const [aadhaarDone, setAadhaarDone] = useState(false);
  const [livenessDone, setLivenessDone] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const headerAnim = useRef(new Animated.Value(-60)).current;
  const headerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Slide header in
    Animated.parallel([
      Animated.timing(headerAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(headerOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    // Load persisted verification state from Supabase
    (async () => {
      const user = await getCurrentUser();
      if (!user) return;
      setUserId(user.id);

      // Persist state from DB if partially verified
      const { data } = await supabase
        .from('users')
        .select('verification_tier')
        .eq('id', user.id)
        .single();

      // tier=1 means aadhaar passed; we track liveness locally per session
      // (in production you'd store each sub-step separately)
      if (data && data.verification_tier >= 1) {
        setAadhaarDone(true);
      }
    })();
  }, []);

  // Check completion whenever steps change
  useEffect(() => {
    if (aadhaarDone && livenessDone) {
      grantVerification();
    }
  }, [aadhaarDone, livenessDone]);

  const grantVerification = async () => {
    if (!userId) return;

    // Update verification tier
    await supabase.from('users').update({ verification_tier: 1 }).eq('id', userId);

    // Award 50 bonus credits
    await supabase.from('credit_transactions').insert({
      user_id: userId,
      amount: 50,
      reason: 'Completed identity verification',
    });

    // Update credits balance
    const { data: u } = await supabase
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();
    if (u) {
      await supabase
        .from('users')
        .update({ credits: (u.credits || 0) + 50 })
        .eq('id', userId);
    }

    // 🔔 Send welcome push notification
    await sendVerificationWelcomeNotification();

    const popupShown = await AsyncStorage.getItem('sc_success_popup_shown');
    if (popupShown !== 'true') {
      await AsyncStorage.setItem('sc_success_popup_shown', 'true');
      setShowSuccess(true);
    }
  };

  // Determine step statuses
  const getStepStatus = (): [StepStatus, StepStatus, StepStatus] => {
    const phone: StepStatus = 'done'; // always done (logged in via OTP)
    const aadhaar: StepStatus = aadhaarDone ? 'done' : 'active';
    const liveness: StepStatus = aadhaarDone ? (livenessDone ? 'done' : 'active') : 'pending';
    return [phone, aadhaar, liveness];
  };

  const [phoneStatus, aadhaarStatus, livenessStatus] = getStepStatus();

  const steps: Step[] = [
    {
      id: 1,
      icon: '📱',
      title: 'Phone OTP',
      description: 'Your phone number has been verified via one-time password during sign-in.',
      status: phoneStatus,
    },
    {
      id: 2,
      icon: '🪪',
      title: 'Aadhaar OTP Verification',
      description:
        'Link your Aadhaar to confirm real-world identity. Only pass/fail is stored — never your Aadhaar number.',
      status: aadhaarStatus,
      route: '/verification/aadhaar-verify',
    },
    {
      id: 3,
      icon: '🤳',
      title: 'Selfie Liveness Check',
      description:
        'A quick 4-step facial liveness test ensures you are a real person and not a photo or recording.',
      status: livenessStatus,
      route: '/verification/selfie-liveness',
    },
  ];

  // Progress (0–3 steps done)
  const completedCount = [phoneStatus, aadhaarStatus, livenessStatus].filter(
    (s) => s === 'done'
  ).length;
  const progressPct = (completedCount / 3) * 100;

  const progressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progressPct,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [progressPct]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Back ── */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {/* ── Header ── */}
        <Animated.View
          style={{
            transform: [{ translateY: headerAnim }],
            opacity: headerOpacity,
            marginBottom: 28,
          }}
        >
          <Text style={styles.badge}>🔐 Volunteer Verification</Text>
          <Text style={styles.title}>Verify Your Identity</Text>
          <Text style={styles.subtitle}>
            Complete all steps to join SafeCircle's trusted volunteer network and earn
            your{' '}
            <Text style={{ color: Colors.accent }}>Basic Verified</Text> badge.
          </Text>
        </Animated.View>

        {/* ── Progress bar ── */}
        <View style={styles.progressContainer}>
          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>Verification Progress</Text>
            <Text style={styles.progressCount}>{completedCount} / 3 steps</Text>
          </View>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressWidth,
                  backgroundColor:
                    completedCount === 3
                      ? Colors.safe
                      : completedCount >= 2
                      ? '#F39C12'
                      : Colors.primary,
                },
              ]}
            />
          </View>
          {/* Step dots */}
          <View style={styles.stepDots}>
            {[1, 2, 3].map((n) => {
              const s = [phoneStatus, aadhaarStatus, livenessStatus][n - 1];
              return (
                <View
                  key={n}
                  style={[
                    styles.dot,
                    s === 'done' && { backgroundColor: Colors.safe },
                    s === 'active' && { backgroundColor: Colors.primary },
                    s === 'pending' && { backgroundColor: '#2A2A3E' },
                  ]}
                >
                  <Text style={styles.dotNum}>{n}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Step Cards ── */}
        <View style={styles.stepsSection}>
          {steps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              onPress={
                step.route
                  ? () => {
                      router.push({
                        pathname: step.route as any,
                        params: {
                          onDone:
                            step.id === 2
                              ? 'aadhaar'
                              : 'liveness',
                        },
                      });
                    }
                  : undefined
              }
            />
          ))}
        </View>

        {/* ── Why verify? ── */}
        <View style={styles.faqSection}>
          <Text style={styles.faqHeading}>🤔 Why do we verify?</Text>

          <FaqItem
            q="Why is Aadhaar required?"
            a="Aadhaar links your volunteer profile to a real-world identity, making the platform safe for victims who invite strangers into their emergency moments. It deters bad actors significantly."
          />
          <FaqItem
            q="Is my Aadhaar number stored?"
            a="Never. SafeCircle only stores a pass/fail result. Your Aadhaar number is sent directly to UIDAI's official API and discarded immediately — we never log it."
          />
          <FaqItem
            q="What is liveness verification?"
            a="A 4-step challenge (look straight, turn left, smile, blink) ensures the selfie is taken by a live person, not a printed photo or screen replay, providing anti-spoofing protection."
          />
          <FaqItem
            q="Can I skip verification?"
            a="You can use SafeCircle as a victim (SOS sender) without verification. Verification is required only to become a volunteer so we can maintain trust and safety standards."
          />
        </View>

        {/* Bottom spacer */}
        <View style={{ height: 60 }} />
      </ScrollView>

      {/* ── Refresh step completion (called from child routes via params) ── */}
      <VerificationParamListener
        onAadhaarDone={() => setAadhaarDone(true)}
        onLivenessDone={() => setLivenessDone(true)}
      />

      {/* ── Success overlay ── */}
      <SuccessOverlay visible={showSuccess} />
    </>
  );
}

/**
 * Listens for route focus events and reads query params set by child screens
 * to update step completion state without needing a state management library.
 */
function VerificationParamListener({
  onAadhaarDone,
  onLivenessDone,
}: {
  onAadhaarDone: () => void;
  onLivenessDone: () => void;
}) {
  // Expo Router doesn't yet have a clean way to pass data back
  // from a pushed screen, so we poll AsyncStorage as a lightweight
  // inter-screen signal.
  const { useEffect } = React;
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const AsyncStorage = (
          await import('@react-native-async-storage/async-storage')
        ).default;
        const aadhaar = await AsyncStorage.getItem('sc_aadhaar_verified');
        const liveness = await AsyncStorage.getItem('sc_liveness_verified');
        if (mounted && aadhaar === 'true') onAadhaarDone();
        if (mounted && liveness === 'true') onLivenessDone();
      } catch (_) {}
    };

    // Poll every second while screen is mounted (acceptable for this UX)
    const interval = setInterval(check, 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return null;
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },

  backBtn: { marginBottom: 16 },
  backText: { color: Colors.textMuted, fontSize: 15 },

  badge: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: Colors.text,
    marginBottom: 10,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 22,
  },

  // Progress
  progressContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  progressLabel: { color: Colors.text, fontWeight: '600', fontSize: 14 },
  progressCount: { color: Colors.textMuted, fontSize: 13 },
  progressTrack: {
    height: 8,
    backgroundColor: '#2A2A3E',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: { height: '100%', borderRadius: 4 },
  stepDots: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotNum: { color: Colors.text, fontWeight: '700', fontSize: 14 },

  // Steps
  stepsSection: { gap: 14, marginBottom: 28 },

  stepCard: {
    flexDirection: 'row',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
    backgroundColor: Colors.surface,
  },
  stepCardDone: {
    borderColor: Colors.safe + '55',
    backgroundColor: 'rgba(30,132,73,0.06)',
  },
  stepCardActive: {
    borderColor: Colors.primary + '88',
    backgroundColor: 'rgba(192,57,43,0.08)',
  },
  stepCardPending: {
    borderColor: '#1A1A2E',
    backgroundColor: '#111122',
    opacity: 0.7,
  },

  stepLeft: { marginRight: 14 },
  stepIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepIcon: { fontSize: 20 },

  stepContent: { flex: 1 },
  stepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
    flexWrap: 'wrap',
    gap: 6,
  },
  stepTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },

  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeDone: {
    borderColor: Colors.safe + '66',
    backgroundColor: 'rgba(30,132,73,0.12)',
  },
  badgeActive: {
    borderColor: Colors.primary + '66',
    backgroundColor: 'rgba(192,57,43,0.12)',
  },
  badgePending: {
    borderColor: '#2A2A3E',
    backgroundColor: '#1A1A2E',
  },
  badgeText: { fontSize: 11, fontWeight: '700' },

  stepDesc: { fontSize: 13, color: Colors.textMuted, lineHeight: 19 },

  stepCta: {
    marginTop: 12,
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  stepCtaText: { color: Colors.text, fontWeight: '700', fontSize: 14 },

  // FAQ
  faqSection: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  faqHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 14,
  },
  faqItem: {
    borderTopWidth: 1,
    borderTopColor: '#2A2A3E',
    paddingVertical: 10,
  },
  faqQ: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQText: { fontSize: 13, color: Colors.text, fontWeight: '600', flex: 1, lineHeight: 19 },
  faqChevron: { color: Colors.textMuted, fontSize: 12, marginLeft: 8 },
  faqA: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 20,
    paddingTop: 8,
  },

  // Success overlay
  successOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  ripple: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: Colors.safe + '66',
  },
  successCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: Colors.safe,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: Colors.safe,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 12,
  },
  successCheck: { fontSize: 52, color: '#fff', fontWeight: '900' },
  successTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  successSub: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 6,
  },
  badgeLabel: {
    color: '#F1C40F',
    fontWeight: '800',
    fontSize: 16,
  },
  successCredits: {
    fontSize: 14,
    color: Colors.safe,
    fontWeight: '700',
    marginBottom: 24,
  },
  shareBtn: {
    backgroundColor: '#25D366',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    marginBottom: 14,
    width: '100%',
    alignItems: 'center',
  },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  successContinue: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    width: '100%',
    alignItems: 'center',
  },
  successContinueText: { color: Colors.primary, fontWeight: '700', fontSize: 15 },
});
