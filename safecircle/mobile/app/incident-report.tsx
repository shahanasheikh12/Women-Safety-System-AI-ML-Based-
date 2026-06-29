/**
 * mobile/app/incident-report.tsx
 * ────────────────────────────────
 * Incident History & Report Download screen.
 *
 * Shows all past SOS events for the current user.
 * Each incident card includes:
 *   – Date/time, duration, status badge, location (reverse-geocoded address)
 *   – Volunteer count who helped
 *   – "Download Report" → calls generate-report edge function → opens share sheet
 *   – "Share with Police" → WhatsApp / native share with report URL
 *   – "Alert Police" → opens policeAlert flow for historical incidents
 *
 * Accessible from the Profile screen via "📋 Incident History".
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
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { reverseGeocode, alertPolice, type PoliceAlertPayload } from '../lib/policeAlert';
import Colors from '../constants/Colors';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface SOSEvent {
  id:              string;
  status:          'active' | 'resolved' | 'false_alarm' | 'escalated';
  trigger_method:  string | null;
  lat:             number;
  lng:             number;
  police_notified: boolean;
  started_at:      string;
  resolved_at:     string | null;
}

interface EnrichedEvent extends SOSEvent {
  address:             string | null;
  durationSec:         number | null;
  volunteersResponded: number;
}

interface ReportState {
  loading:   boolean;
  url:       string | null;
  error:     string | null;
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
    timeZone: 'Asia/Kolkata',
  });
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortId(uuid: string): string {
  return '#' + uuid.replace(/-/g, '').slice(0, 8).toUpperCase();
}

// ─────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: SOSEvent['status'] }) {
  const map: Record<SOSEvent['status'], { label: string; bg: string; text: string }> = {
    resolved:    { label: '✓ Resolved',    bg: 'rgba(30,132,73,0.15)',  text: Colors.safe },
    false_alarm: { label: '⚠ False Alarm', bg: 'rgba(211,84,0,0.12)',   text: Colors.warning },
    escalated:   { label: '🚨 Escalated',  bg: 'rgba(192,57,43,0.15)', text: Colors.primary },
    active:      { label: '● Active',      bg: 'rgba(192,57,43,0.15)', text: Colors.primary },
  };
  const cfg = map[status] ?? map.resolved;
  return (
    <View style={[badge.wrap, { backgroundColor: cfg.bg }]}>
      <Text style={[badge.text, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  text: { fontSize: 11, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────
// Trigger icon
// ─────────────────────────────────────────────────────────────
const TRIGGER_ICONS: Record<string, string> = {
  button:       '👆',
  voice:        '🎙️',
  shake:        '📳',
  power_button: '⏻',
  accelerometer:'📐',
};

// ─────────────────────────────────────────────────────────────
// Single incident card
// ─────────────────────────────────────────────────────────────
function IncidentCard({
  event,
  index,
  onDownloadReport,
  onSharePolice,
  onAlertPolice,
}: {
  event:            EnrichedEvent;
  index:            number;
  onDownloadReport: (event: EnrichedEvent) => void;
  onSharePolice:    (event: EnrichedEvent, url: string) => void;
  onAlertPolice:    (event: EnrichedEvent) => void;
}) {
  const slideAnim = useRef(new Animated.Value(30)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState(false);
  const [reportState, setReportState] = useState<ReportState>({
    loading: false,
    url:     null,
    error:   null,
  });

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0, duration: 350, delay: index * 80, useNativeDriver: true,
      }),
      Animated.timing(opacAnim, {
        toValue: 1, duration: 350, delay: index * 80, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleDownload = async () => {
    setReportState({ loading: true, url: null, error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await supabase.functions.invoke('generate-report', {
        body: { sos_id: event.id },
      });

      if (res.error) throw new Error(res.error.message);

      const { report_url } = res.data as { report_url: string };
      setReportState({ loading: false, url: report_url, error: null });

      // Open share sheet immediately
      onSharePolice(event, report_url);
    } catch (e: any) {
      setReportState({ loading: false, url: null, error: e.message });
      Alert.alert('Report Error', e.message || 'Could not generate report. Try again.');
    }
  };

  const handleShare = async () => {
    if (!reportState.url) {
      await handleDownload();
      return;
    }
    onSharePolice(event, reportState.url);
  };

  const triggerIcon  = TRIGGER_ICONS[event.trigger_method ?? 'button'] ?? '👆';
  const triggerLabel = (event.trigger_method ?? 'button').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Animated.View style={[styles.cardWrap, { opacity: opacAnim, transform: [{ translateY: slideAnim }] }]}>
      <TouchableOpacity
        style={styles.card}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.9}
      >
        {/* Card header row */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.incidentId}>{shortId(event.id)}</Text>
            <StatusBadge status={event.status} />
          </View>
          <View style={styles.cardHeaderRight}>
            <Text style={styles.cardDate}>{fmtDate(event.started_at)}</Text>
            <Text style={styles.cardTime}>{fmtTime(event.started_at)}</Text>
          </View>
        </View>

        {/* Quick meta row */}
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Text style={styles.metaEmoji}>{triggerIcon}</Text>
            <Text style={styles.metaText}>{triggerLabel}</Text>
          </View>
          {event.durationSec !== null && (
            <View style={styles.metaChip}>
              <Text style={styles.metaEmoji}>⏱</Text>
              <Text style={styles.metaText}>{fmtDuration(event.durationSec)}</Text>
            </View>
          )}
          {event.volunteersResponded > 0 && (
            <View style={styles.metaChip}>
              <Text style={styles.metaEmoji}>🤝</Text>
              <Text style={styles.metaText}>{event.volunteersResponded} helped</Text>
            </View>
          )}
          {event.police_notified && (
            <View style={[styles.metaChip, { backgroundColor: 'rgba(30,132,73,0.12)' }]}>
              <Text style={styles.metaEmoji}>👮</Text>
              <Text style={[styles.metaText, { color: Colors.safe }]}>Police notified</Text>
            </View>
          )}
        </View>

        {/* Address */}
        {event.address && (
          <View style={styles.addressRow}>
            <Text style={styles.addressPin}>📍</Text>
            <Text style={styles.addressText} numberOfLines={expanded ? undefined : 1}>
              {event.address}
            </Text>
          </View>
        )}

        {/* Expand/collapse indicator */}
        <Text style={styles.expandHint}>{expanded ? '▲ Collapse' : '▼ Show actions'}</Text>
      </TouchableOpacity>

      {/* Expanded action buttons */}
      {expanded && (
        <View style={styles.cardActions}>
          {/* Download / Generate Report */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={handleDownload}
            disabled={reportState.loading}
            activeOpacity={0.85}
          >
            {reportState.loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.actionBtnIcon}>📋</Text>
                <Text style={styles.actionBtnText}>
                  {reportState.url ? 'Re-Download Report' : 'Download Incident Report'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Share with Police */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnSecondary]}
            onPress={handleShare}
            disabled={reportState.loading}
            activeOpacity={0.85}
          >
            <Text style={styles.actionBtnIcon}>📤</Text>
            <Text style={[styles.actionBtnText, { color: Colors.text }]}>Share with Police</Text>
          </TouchableOpacity>

          {/* Alert Police (for unnotified incidents) */}
          {!event.police_notified && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPolice]}
              onPress={() => onAlertPolice(event)}
              activeOpacity={0.85}
            >
              <Text style={styles.actionBtnIcon}>👮</Text>
              <Text style={styles.actionBtnText}>Alert Police Now</Text>
            </TouchableOpacity>
          )}

          {/* Open in Maps */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnMap]}
            onPress={() => Linking.openURL(`https://maps.google.com/?q=${event.lat},${event.lng}`)}
            activeOpacity={0.85}
          >
            <Text style={styles.actionBtnIcon}>🗺️</Text>
            <Text style={[styles.actionBtnText, { color: Colors.text }]}>View in Maps</Text>
          </TouchableOpacity>

          {/* Error message */}
          {reportState.error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {reportState.error}</Text>
            </View>
          )}

          {/* Report URL (when generated) */}
          {reportState.url && (
            <View style={styles.reportUrlBox}>
              <Text style={styles.reportUrlLabel}>📎 Report ready:</Text>
              <Text style={styles.reportUrl} numberOfLines={1}>{reportState.url}</Text>
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
export default function IncidentReportScreen() {
  const [events,       setEvents]       = useState<EnrichedEvent[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [userId,       setUserId]       = useState<string | null>(null);
  const [totalEvents,  setTotalEvents]  = useState(0);

  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide   = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(headerSlide,   { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
    loadEvents();
  }, []);

  // ── Load events from Supabase ─────────────────────────────
  const loadEvents = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      // Fetch SOS events
      const { data: sosData, error } = await supabase
        .from('sos_events')
        .select('id, status, trigger_method, lat, lng, police_notified, started_at, resolved_at')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      const rawEvents = (sosData ?? []) as SOSEvent[];
      setTotalEvents(rawEvents.length);

      // Enrich: add address + volunteer count + duration in parallel
      const enriched = await Promise.all(
        rawEvents.map(async (ev): Promise<EnrichedEvent> => {
          const [addressResult, volResult] = await Promise.allSettled([
            reverseGeocode(ev.lat, ev.lng),
            supabase
              .from('volunteer_responses')
              .select('status', { count: 'exact', head: false })
              .eq('sos_id', ev.id)
              .in('status', ['accepted', 'en_route', 'arrived', 'completed']),
          ]);

          const address = addressResult.status === 'fulfilled'
            ? addressResult.value?.formatted ?? null
            : null;

          const volCount = volResult.status === 'fulfilled'
            ? (volResult.value.data?.length ?? 0)
            : 0;

          const durationSec = ev.resolved_at
            ? Math.round((new Date(ev.resolved_at).getTime() - new Date(ev.started_at).getTime()) / 1000)
            : null;

          return { ...ev, address, durationSec, volunteersResponded: volCount };
        })
      );

      setEvents(enriched);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load incidents.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadEvents();
  }, [loadEvents]);

  // ── Share report with native share sheet ──────────────────
  const handleSharePolice = useCallback(async (event: EnrichedEvent, url: string) => {
    const id      = shortId(event.id);
    const dateStr = fmtDate(event.started_at);
    const shareMsg =
      `SafeCircle Incident Report ${id} — ${dateStr}\n` +
      `Status: ${event.status.replace('_', ' ')}\n` +
      `Location: ${event.address ?? `${event.lat}, ${event.lng}`}\n\n` +
      `Download official report:\n${url}`;

    try {
      await Share.share({ message: shareMsg, url }, { dialogTitle: 'Share Incident Report' });
    } catch {}
  }, []);

  // ── Alert police for a historical incident ─────────────────
  const handleAlertPolice = useCallback(async (event: EnrichedEvent) => {
    Alert.alert(
      '👮 Alert Police',
      `This will send an emergency SMS to 112 with the details of incident ${shortId(event.id)}.\n\nContinue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Alert Police 112',
          style: 'destructive',
          onPress: async () => {
            const payload: PoliceAlertPayload = {
              sosId:     event.id,
              userId:    userId ?? '',
              lat:       event.lat,
              lng:       event.lng,
              startedAt: event.started_at,
            };
            await alertPolice(payload);
            // Refresh to update police_notified flag
            loadEvents();
          },
        },
      ]
    );
  }, [userId, loadEvents]);

  // ── Statistics summary ─────────────────────────────────────
  const resolvedCount    = events.filter((e) => e.status === 'resolved').length;
  const policeNotifCount = events.filter((e) => e.police_notified).length;
  const totalVolunteers  = events.reduce((sum, e) => sum + e.volunteersResponded, 0);

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {/* ── Back button ── */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {/* ── Header ── */}
        <Animated.View style={{ opacity: headerOpacity, transform: [{ translateY: headerSlide }] }}>
          <Text style={styles.screenLabel}>📋 Incident History</Text>
          <Text style={styles.screenTitle}>Your SOS Records</Text>
          <Text style={styles.screenSub}>
            Download official reports, share with police, and review your incident history.
          </Text>
        </Animated.View>

        {/* ── Stats row ── */}
        {events.length > 0 && (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{totalEvents}</Text>
              <Text style={styles.statLabel}>Total SOS</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: Colors.safe }]}>{resolvedCount}</Text>
              <Text style={styles.statLabel}>Resolved Safely</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: Colors.accent }]}>{totalVolunteers}</Text>
              <Text style={styles.statLabel}>Volunteers Helped</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: '#2980B9' }]}>{policeNotifCount}</Text>
              <Text style={styles.statLabel}>Police Alerted</Text>
            </View>
          </View>
        )}

        {/* ── Info banner ── */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerText}>
            🔒 Reports are encrypted and stored securely. Download URLs expire in 7 days.
          </Text>
        </View>

        {/* ── Loading state ── */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading your incidents…</Text>
          </View>
        )}

        {/* ── Empty state ── */}
        {!loading && events.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🛡️</Text>
            <Text style={styles.emptyTitle}>No incidents recorded</Text>
            <Text style={styles.emptyText}>
              Your SOS history will appear here.{'\n'}
              SafeCircle has been keeping you safe.
            </Text>
          </View>
        )}

        {/* ── Incident cards ── */}
        {events.map((event, i) => (
          <IncidentCard
            key={event.id}
            event={event}
            index={i}
            onDownloadReport={() => {/* handled inside card */}}
            onSharePolice={handleSharePolice}
            onAlertPolice={handleAlertPolice}
          />
        ))}

        {/* ── Auto-deletion notice ── */}
        {events.length > 0 && (
          <View style={styles.deletionNotice}>
            <Text style={styles.deletionNoticeText}>
              📅 Location tracking data older than 30 days is automatically deleted for your privacy.
            </Text>
          </View>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 32,
  },

  backBtn:  { marginBottom: 18 },
  backText: { color: Colors.textMuted, fontSize: 15 },

  screenLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.text,
    marginBottom: 8,
  },
  screenSub: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 20,
    marginBottom: 20,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  statValue: { fontSize: 22, fontWeight: '900', color: Colors.text },
  statLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: '600', textAlign: 'center', marginTop: 2 },

  // Info banner
  infoBanner: {
    backgroundColor: 'rgba(30,132,73,0.07)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: Colors.safe + '33',
  },
  infoBannerText: { color: Colors.textMuted, fontSize: 11, lineHeight: 17 },

  // Loading
  loadingContainer: { alignItems: 'center', paddingVertical: 60, gap: 14 },
  loadingText:      { color: Colors.textMuted, fontSize: 14 },

  // Empty
  emptyContainer: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyIcon:      { fontSize: 56 },
  emptyTitle:     { fontSize: 20, fontWeight: '800', color: Colors.text },
  emptyText:      { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 21 },

  // Card wrap
  cardWrap: { marginBottom: 14 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
  },

  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  cardHeaderLeft: { gap: 6 },
  cardHeaderRight: { alignItems: 'flex-end' },
  incidentId: { fontSize: 14, fontWeight: '900', color: Colors.primary, letterSpacing: 1 },
  cardDate:   { fontSize: 12, fontWeight: '700', color: Colors.text },
  cardTime:   { fontSize: 11, color: Colors.textMuted },

  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1A1A2E',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  metaEmoji: { fontSize: 12 },
  metaText:  { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },

  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 6,
  },
  addressPin:  { fontSize: 13, marginTop: 1 },
  addressText: { flex: 1, fontSize: 12, color: Colors.textMuted, lineHeight: 18 },

  expandHint: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: '700',
    textAlign: 'right',
    marginTop: 6,
  },

  // Action buttons
  cardActions: {
    backgroundColor: '#111122',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderColor: '#2A2A3E',
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  actionBtnPrimary: {
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  actionBtnSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
  },
  actionBtnPolice: {
    backgroundColor: '#1A3A5C',
    borderWidth: 1.5,
    borderColor: '#2980B9',
  },
  actionBtnMap: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
  },
  actionBtnIcon: { fontSize: 18 },
  actionBtnText: { fontSize: 14, fontWeight: '700', color: '#fff', flex: 1 },

  errorBox: {
    backgroundColor: 'rgba(192,57,43,0.12)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
  },
  errorText: { color: '#FF6B6B', fontSize: 12 },

  reportUrlBox: {
    backgroundColor: 'rgba(30,132,73,0.07)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.safe + '33',
    gap: 4,
  },
  reportUrlLabel: { color: Colors.safe, fontSize: 11, fontWeight: '700' },
  reportUrl:      { color: Colors.textMuted, fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // Deletion notice
  deletionNotice: {
    marginTop: 10,
    backgroundColor: '#111122',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  deletionNoticeText: { color: '#555', fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
