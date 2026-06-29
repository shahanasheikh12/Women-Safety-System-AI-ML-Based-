/**
 * mobile/app/demo.tsx
 * ────────────────────
 * Demo Walkthrough Screen for SafeCircle final year project presentation.
 *
 * Features:
 *  • "DEMO MODE" banner at top so evaluators know it's a demo
 *  • Step indicator (Step X of 11)
 *  • Description card explaining what each step demonstrates
 *  • Auto-play toggle (runs timed scenario) OR manual Next/Prev
 *  • Restart button
 *  • Volunteer card animation simulating acceptance
 *  • Credits earned animation at step 10
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  StatusBar,
  Animated,
  Dimensions,
  Platform,
  FlatList,
} from 'react-native';
import { router } from 'expo-router';
import {
  DemoMode,
  DemoScenario,
  DemoStep,
  DEMO_STEPS,
  MOCK_VOLUNTEERS,
  MOCK_THREAT_ZONES,
  MOCK_CREDIT_HISTORY,
} from '../lib/demoMode';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ── Risk colour map ───────────────────────────────────────────────────────────
const RISK_COLORS: Record<string, string> = {
  low:      '#22C55E',
  medium:   '#F59E0B',
  high:     '#EF4444',
  critical: '#7C3AED',
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function DemoBanner() {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View style={[styles.demoBanner, { opacity: pulseAnim }]}>
      <Text style={styles.demoBannerText}>🎓 DEMO MODE — Final Year Project Presentation</Text>
    </Animated.View>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.stepIndicatorRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.stepDot,
            i < current  && styles.stepDotDone,
            i === current && styles.stepDotActive,
          ]}
        />
      ))}
    </View>
  );
}

function DescriptionCard({ step }: { step: DemoStep }) {
  const slideAnim = useRef(new Animated.Value(30)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    slideAnim.setValue(30);
    opacAnim.setValue(0);
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
      Animated.timing(opacAnim,  { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, [step.id]);

  return (
    <Animated.View style={[styles.descCard, { opacity: opacAnim, transform: [{ translateY: slideAnim }] }]}>
      <Text style={styles.descCardTitle}>{step.title}</Text>
      <Text style={styles.descCardBody}>{step.description}</Text>
      <View style={styles.annotationBox}>
        <Text style={styles.annotationIcon}>💡</Text>
        <Text style={styles.annotationText}>{step.annotation}</Text>
      </View>
    </Animated.View>
  );
}

function VolunteerPreviewCard() {
  const vol = MOCK_VOLUNTEERS[0];
  return (
    <View style={styles.volunteerCard}>
      <Text style={styles.volunteerAvatar}>{vol.avatar}</Text>
      <View style={styles.volunteerInfo}>
        <Text style={styles.volunteerName}>{vol.name} is coming to help!</Text>
        <Text style={styles.volunteerSub}>ETA ~{vol.eta_minutes} min · Trust {vol.trust_score}/100</Text>
        <View style={styles.volunteerBadge}>
          <Text style={styles.volunteerBadgeText}>🥇 Gold Volunteer</Text>
        </View>
      </View>
      <View style={styles.volunteerEta}>
        <Text style={styles.volunteerEtaNum}>{vol.eta_minutes}</Text>
        <Text style={styles.volunteerEtaLabel}>min</Text>
      </View>
    </View>
  );
}

function ThreatZonePreviewList() {
  return (
    <View style={styles.zonesContainer}>
      <Text style={styles.sectionHeader}>⚠️ Active Threat Zones (Mock)</Text>
      {MOCK_THREAT_ZONES.map(zone => (
        <View key={zone.id} style={styles.zoneRow}>
          <View style={[styles.zoneRiskDot, { backgroundColor: RISK_COLORS[zone.risk_level] }]} />
          <View style={styles.zoneTextBlock}>
            <Text style={styles.zoneName}>{zone.label}</Text>
            <Text style={styles.zoneSub}>{zone.incident_count} incidents · {zone.risk_level.toUpperCase()} risk</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function CreditsAnimation() {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1.2, useNativeDriver: true }),
        Animated.timing(opacAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.creditsAnim, { opacity: opacAnim, transform: [{ scale: scaleAnim }] }]}>
      <Text style={styles.creditsAnimIcon}>🪙</Text>
      <Text style={styles.creditsAnimText}>+50 Credits Earned!</Text>
      <Text style={styles.creditsAnimSub}>Priya received her reward for helping</Text>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function DemoScreen() {
  const [currentStep, setCurrentStep]   = useState<DemoStep>(DEMO_STEPS[0]);
  const [stepIdx, setStepIdx]           = useState(0);
  const [autoPlay, setAutoPlay]         = useState(false);
  const [demoEnabled, setDemoEnabled]   = useState(DemoMode.isEnabled());
  const scenarioRef = useRef<DemoScenario | null>(null);

  // ── Scenario setup ──────────────────────────────────────────────────────
  useEffect(() => {
    const onStep = (step: DemoStep) => {
      setCurrentStep(step);
      setStepIdx(step.id - 1);
    };
    scenarioRef.current = new DemoScenario(onStep);
    return () => {
      scenarioRef.current?.stop();
    };
  }, []);

  const toggleAutoPlay = useCallback((val: boolean) => {
    setAutoPlay(val);
    if (val) {
      scenarioRef.current?.start();
    } else {
      scenarioRef.current?.stop();
    }
  }, []);

  const handleNext = useCallback(() => {
    const nextIdx = stepIdx + 1;
    if (nextIdx < DEMO_STEPS.length) {
      setStepIdx(nextIdx);
      setCurrentStep(DEMO_STEPS[nextIdx]);
    }
  }, [stepIdx]);

  const handlePrev = useCallback(() => {
    const prevIdx = stepIdx - 1;
    if (prevIdx >= 0) {
      setStepIdx(prevIdx);
      setCurrentStep(DEMO_STEPS[prevIdx]);
    }
  }, [stepIdx]);

  const handleRestart = useCallback(() => {
    scenarioRef.current?.stop();
    setAutoPlay(false);
    setStepIdx(0);
    setCurrentStep(DEMO_STEPS[0]);
  }, []);

  const toggleDemoMode = useCallback(async (val: boolean) => {
    if (val) {
      await DemoMode.enable();
    } else {
      await DemoMode.disable();
    }
    setDemoEnabled(val);
  }, []);

  // ── Render step-specific panel ──────────────────────────────────────────
  const renderStepPanel = () => {
    if (currentStep.action === 'volunteer_accepted' || currentStep.action === 'volunteer_moving') {
      return <VolunteerPreviewCard />;
    }
    if (currentStep.action === 'credits_earned') {
      return <CreditsAnimation />;
    }
    if (currentStep.screen === 'home' && stepIdx === 0) {
      return <ThreatZonePreviewList />;
    }
    return null;
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FCD34D" />

      {/* ── Demo Banner ─────────────────────────────────────────────── */}
      <DemoBanner />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Exit Demo</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>SafeCircle Demo</Text>
          <Text style={styles.stepCounter}>Step {stepIdx + 1} of {DEMO_STEPS.length}</Text>
        </View>

        {/* ── Step Progress Dots ───────────────────────────────────── */}
        <StepIndicator current={stepIdx} total={DEMO_STEPS.length} />

        {/* ── Description Card ─────────────────────────────────────── */}
        <DescriptionCard step={currentStep} />

        {/* ── Step-specific content ─────────────────────────────────── */}
        {renderStepPanel()}

        {/* ── Navigation Controls ──────────────────────────────────── */}
        <View style={styles.navRow}>
          <TouchableOpacity
            style={[styles.navBtn, stepIdx === 0 && styles.navBtnDisabled]}
            onPress={handlePrev}
            disabled={stepIdx === 0}
          >
            <Text style={styles.navBtnText}>← Prev</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.restartBtn} onPress={handleRestart}>
            <Text style={styles.restartBtnText}>↺ Restart</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnNext, stepIdx === DEMO_STEPS.length - 1 && styles.navBtnDisabled]}
            onPress={handleNext}
            disabled={stepIdx === DEMO_STEPS.length - 1}
          >
            <Text style={[styles.navBtnText, styles.navBtnNextText]}>Next →</Text>
          </TouchableOpacity>
        </View>

        {/* ── Auto-play Toggle ──────────────────────────────────────── */}
        <View style={styles.autoPlayRow}>
          <Text style={styles.autoPlayLabel}>🎬 Auto-play (60s walkthrough)</Text>
          <Switch
            value={autoPlay}
            onValueChange={toggleAutoPlay}
            trackColor={{ false: '#2A2A3E', true: '#EF9F27' }}
            thumbColor={autoPlay ? '#FFF' : '#888'}
          />
        </View>

        {/* ── Demo Mode Global Toggle ───────────────────────────────── */}
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>⚙️ Demo Mode Settings</Text>
          <View style={styles.settingsRow}>
            <View>
              <Text style={styles.settingsLabel}>Enable Demo Mode</Text>
              <Text style={styles.settingsSub}>
                When ON, all API calls return mock data (no Supabase needed)
              </Text>
            </View>
            <Switch
              value={demoEnabled}
              onValueChange={toggleDemoMode}
              trackColor={{ false: '#2A2A3E', true: '#22C55E' }}
              thumbColor={demoEnabled ? '#FFF' : '#888'}
            />
          </View>
          {demoEnabled && (
            <View style={styles.demoActiveIndicator}>
              <View style={styles.demoActiveDot} />
              <Text style={styles.demoActiveText}>Demo data active — app using mock Nagpur dataset</Text>
            </View>
          )}
        </View>

        {/* ── Volunteer Roster Preview ─────────────────────────────── */}
        <View style={styles.rosterCard}>
          <Text style={styles.sectionHeader}>👥 Demo Volunteers (Dharampeth, Nagpur)</Text>
          {MOCK_VOLUNTEERS.map(vol => (
            <View key={vol.id} style={styles.rosterRow}>
              <Text style={styles.rosterAvatar}>{vol.avatar}</Text>
              <View style={styles.rosterInfo}>
                <Text style={styles.rosterName}>{vol.name}</Text>
                <Text style={styles.rosterSub}>
                  {vol.distance_km} km · Trust {vol.trust_score} · {vol.total_assists} assists
                </Text>
              </View>
              <View style={[
                styles.rosterTierBadge,
                vol.tier === 'gold'   && { backgroundColor: '#D97706' },
                vol.tier === 'silver' && { backgroundColor: '#6B7280' },
                vol.tier === 'bronze' && { backgroundColor: '#92400E' },
              ]}>
                <Text style={styles.rosterTierText}>{vol.tier.toUpperCase()}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Credit History Preview ────────────────────────────────── */}
        <View style={styles.creditsCard}>
          <Text style={styles.sectionHeader}>🪙 Demo Credit History</Text>
          {MOCK_CREDIT_HISTORY.map(tx => (
            <View key={tx.id} style={styles.creditRow}>
              <Text style={styles.creditIcon}>{tx.icon}</Text>
              <View style={styles.creditInfo}>
                <Text style={styles.creditReason}>{tx.reason}</Text>
                <Text style={styles.creditDate}>{tx.date}</Text>
              </View>
              <Text style={[styles.creditAmount, { color: tx.amount > 0 ? '#22C55E' : '#EF4444' }]}>
                +{tx.amount}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D0D14',
  },
  scroll: {
    paddingBottom: 40,
  },

  // ── Banner ──────────────────────────────────────────────────────
  demoBanner: {
    backgroundColor: '#FCD34D',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 52 : 28,
  },
  demoBannerText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#78350F',
    letterSpacing: 0.5,
  },

  // ── Header ──────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backBtn: {
    padding: 8,
  },
  backBtnText: {
    color: '#EF9F27',
    fontWeight: '700',
    fontSize: 13,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
  },
  stepCounter: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Step dots ───────────────────────────────────────────────────
  stepIndicatorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexWrap: 'wrap',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2A2A3E',
  },
  stepDotActive: {
    width: 20,
    backgroundColor: '#EF9F27',
  },
  stepDotDone: {
    backgroundColor: '#22C55E',
  },

  // ── Description card ────────────────────────────────────────────
  descCard: {
    backgroundColor: '#1C1C2E',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 18,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  descCardTitle: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 8,
  },
  descCardBody: {
    color: '#CCC',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  annotationBox: {
    backgroundColor: '#EF9F2710',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EF9F2733',
    padding: 10,
    flexDirection: 'row',
    gap: 8,
  },
  annotationIcon: {
    fontSize: 16,
  },
  annotationText: {
    color: '#EF9F27',
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
    fontStyle: 'italic',
  },

  // ── Navigation ──────────────────────────────────────────────────
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 8,
  },
  navBtn: {
    backgroundColor: '#1C1C2E',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    flex: 1,
    alignItems: 'center',
  },
  navBtnNext: {
    backgroundColor: '#EF9F27',
    borderColor: '#EF9F27',
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navBtnText: {
    color: '#CCC',
    fontWeight: '700',
    fontSize: 13,
  },
  navBtnNextText: {
    color: '#1C1C2E',
  },
  restartBtn: {
    backgroundColor: '#0F0F14',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    alignItems: 'center',
  },
  restartBtnText: {
    color: '#888',
    fontWeight: '700',
    fontSize: 13,
  },

  // ── Auto-play toggle ────────────────────────────────────────────
  autoPlayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#1C1C2E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  autoPlayLabel: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },

  // ── Settings card ───────────────────────────────────────────────
  settingsCard: {
    backgroundColor: '#1C1C2E',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  settingsTitle: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 12,
  },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  settingsLabel: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
    flex: 1,
  },
  settingsSub: {
    color: '#888',
    fontSize: 11,
    flex: 1,
    marginTop: 2,
  },
  demoActiveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    backgroundColor: '#14532D',
    borderRadius: 8,
    padding: 8,
  },
  demoActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  demoActiveText: {
    color: '#4ADE80',
    fontSize: 11,
    fontWeight: '600',
  },

  // ── Volunteer card ──────────────────────────────────────────────
  volunteerCard: {
    backgroundColor: '#14532D',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#22C55E55',
  },
  volunteerAvatar: {
    fontSize: 36,
  },
  volunteerInfo: {
    flex: 1,
  },
  volunteerName: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  volunteerSub: {
    color: '#86EFAC',
    fontSize: 11,
    marginTop: 2,
  },
  volunteerBadge: {
    backgroundColor: '#D97706',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  volunteerBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  volunteerEta: {
    alignItems: 'center',
    backgroundColor: '#166534',
    borderRadius: 10,
    padding: 8,
    minWidth: 44,
  },
  volunteerEtaNum: {
    color: '#22C55E',
    fontSize: 22,
    fontWeight: '900',
  },
  volunteerEtaLabel: {
    color: '#86EFAC',
    fontSize: 10,
    fontWeight: '600',
  },

  // ── Credits animation ───────────────────────────────────────────
  creditsAnim: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#1C1401',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EF9F2755',
  },
  creditsAnimIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  creditsAnimText: {
    color: '#EF9F27',
    fontSize: 22,
    fontWeight: '900',
  },
  creditsAnimSub: {
    color: '#D97706',
    fontSize: 12,
    marginTop: 4,
  },

  // ── Threat zones ────────────────────────────────────────────────
  zonesContainer: {
    backgroundColor: '#1C1C2E',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  sectionHeader: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 13,
    marginBottom: 10,
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  zoneRiskDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  zoneTextBlock: { flex: 1 },
  zoneName: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 12,
  },
  zoneSub: {
    color: '#888',
    fontSize: 10,
    marginTop: 1,
  },

  // ── Volunteer roster ────────────────────────────────────────────
  rosterCard: {
    backgroundColor: '#1C1C2E',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  rosterAvatar: {
    fontSize: 26,
  },
  rosterInfo: { flex: 1 },
  rosterName: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },
  rosterSub: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  rosterTierBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rosterTierText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // ── Credit history ──────────────────────────────────────────────
  creditsCard: {
    backgroundColor: '#1C1C2E',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  creditIcon: {
    fontSize: 22,
  },
  creditInfo: { flex: 1 },
  creditReason: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  creditDate: {
    color: '#888',
    fontSize: 10,
    marginTop: 2,
  },
  creditAmount: {
    fontWeight: '900',
    fontSize: 16,
  },
});
