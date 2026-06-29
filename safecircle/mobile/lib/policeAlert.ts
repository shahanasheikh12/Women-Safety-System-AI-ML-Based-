/**
 * mobile/lib/policeAlert.ts
 * ─────────────────────────
 * Police notification system for SafeCircle.
 *
 * Strategy (in priority order):
 *   1. Auto-SMS via Twilio (if TWILIO env vars set on backend)
 *      → calls the `notify-police` edge function
 *   2. Deep-link SMS to 112 with pre-filled message (always available)
 *   3. Direct call to 112 (fallback)
 *
 * Reverse geocoding uses Nominatim (free, no API key):
 *   https://nominatim.openstreetmap.org/reverse
 *
 * IMPORTANT: Always marks sos_events.police_notified = true in DB.
 */

import { Linking, Alert, Platform } from 'react-native';
import { supabase } from './supabase';

// ─── Types ─────────────────────────────────────────────────────
export interface GeoAddress {
  road:       string;
  suburb:     string;
  city:       string;
  state:      string;
  postcode:   string;
  formatted:  string;   // human-readable one-liner
  country:    string;
}

export interface PoliceAlertPayload {
  sosId:      string;
  userId:     string;
  lat:        number;
  lng:        number;
  startedAt:  string;
  victimName?: string;
}

export interface PoliceAlertResult {
  method:    'auto_sms' | 'manual_sms' | 'call' | 'none';
  address:   GeoAddress | null;
  message:   string;
  markedInDB: boolean;
}

// ─── Constants ─────────────────────────────────────────────────
const POLICE_NUMBER    = '112';            // India emergency + police
const POLICE_ALTERNATE = '100';            // India police direct
const NOMINATIM_URL    = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT       = 'SafeCircle-App/1.0 (emergency-safety-app)';

// ─── Nominatim reverse-geocode ─────────────────────────────────
/**
 * Free reverse geocoding via OpenStreetMap Nominatim.
 * No API key required. Rate limit: 1 request/second.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoAddress | null> {
  try {
    const url = `${NOMINATIM_URL}?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-IN,en',
      },
    });

    if (!res.ok) {
      console.warn('[policeAlert] Nominatim error:', res.status);
      return null;
    }

    const data = await res.json();
    const addr = data.address ?? {};

    const road     = addr.road ?? addr.pedestrian ?? addr.street ?? addr.neighbourhood ?? '';
    const suburb   = addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? addr.village ?? '';
    const city     = addr.city ?? addr.town ?? addr.county ?? addr.district ?? '';
    const state    = addr.state ?? '';
    const postcode = addr.postcode ?? '';
    const country  = addr.country ?? 'India';

    // Build a concise human-readable address
    const parts = [road, suburb, city, state, postcode].filter(Boolean);
    const formatted = parts.length > 0 ? parts.join(', ') : `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    return { road, suburb, city, state, postcode, formatted, country };

  } catch (e) {
    console.warn('[policeAlert] reverseGeocode error:', (e as Error).message);
    return null;
  }
}

// ─── Compose SMS message ───────────────────────────────────────
export function composeSMSMessage(
  payload:   PoliceAlertPayload,
  address:   GeoAddress | null,
  shareUrl?: string
): string {
  const { lat, lng, startedAt, victimName } = payload;
  const timeStr = new Date(startedAt).toLocaleString('en-IN', {
    timeZone:     'Asia/Kolkata',
    dateStyle:    'short',
    timeStyle:    'short',
  });

  const locationStr = address?.formatted ?? `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const gpsStr      = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const nameStr     = victimName ? ` (${victimName})` : '';
  const shareStr    = shareUrl ? `\nLive location: ${shareUrl}` : '';

  return (
    `EMERGENCY: Woman needs help${nameStr} at ${locationStr}.\n` +
    `GPS: ${gpsStr} | Time: ${timeStr} IST\n` +
    `App: SafeCircle | Incident ID: #${payload.sosId.slice(0, 8).toUpperCase()}` +
    shareStr +
    `\nPlease respond immediately. Call victim's phone or go to GPS location.`
  );
}

// ─── Mark police notified in DB ────────────────────────────────
async function markPoliceNotified(sosId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('sos_events')
      .update({
        police_notified: true,
        notes: `Police alerted at ${new Date().toISOString()}`,
      })
      .eq('id', sosId);

    if (error) {
      console.error('[policeAlert] DB update error:', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Try auto-SMS via backend (Twilio) ────────────────────────
async function tryAutoSMS(
  payload: PoliceAlertPayload,
  message: string
): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke('notify-police', {
      body: {
        sos_id:  payload.sosId,
        user_id: payload.userId,
        lat:     payload.lat,
        lng:     payload.lng,
        message,
        to:      POLICE_NUMBER,
      },
    });

    if (error) {
      // Edge function doesn't exist or Twilio not configured — expected in dev
      console.warn('[policeAlert] Auto-SMS not available:', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Open SMS deep-link ────────────────────────────────────────
async function openSMSDeepLink(phone: string, message: string): Promise<boolean> {
  try {
    // Platform-specific SMS URL scheme
    const smsUrl = Platform.OS === 'ios'
      ? `sms:${phone}&body=${encodeURIComponent(message)}`
      : `sms:${phone}?body=${encodeURIComponent(message)}`;

    const supported = await Linking.canOpenURL(smsUrl);
    if (supported) {
      await Linking.openURL(smsUrl);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Open dialler ─────────────────────────────────────────────
async function openDialler(phone: string): Promise<void> {
  try {
    await Linking.openURL(`tel:${phone}`);
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// PRIMARY EXPORT — alertPolice()
// ═══════════════════════════════════════════════════════════════
/**
 * Main entry-point. Call when user taps "Alert Police" in the SOS screen.
 *
 * Flow:
 *   1. Reverse-geocode the victim's GPS → human-readable address
 *   2. Build pre-filled SMS message
 *   3. Try auto-send via Twilio backend
 *   4. If auto fails → open SMS deep-link to 112
 *   5. Mark sos_events.police_notified = true
 *   6. Show confirmation dialog with options to also call 112
 */
export async function alertPolice(
  payload:  PoliceAlertPayload,
  shareUrl?: string
): Promise<PoliceAlertResult> {
  console.log('[policeAlert] Alerting police for SOS:', payload.sosId);

  // ── Step 1: Reverse geocode ──────────────────────────────────
  const address = await reverseGeocode(payload.lat, payload.lng);

  // ── Step 2: Compose message ──────────────────────────────────
  const message = composeSMSMessage(payload, address, shareUrl);

  let method:     PoliceAlertResult['method'] = 'none';
  let markedInDB  = false;

  // ── Step 3: Try Twilio auto-SMS via edge function ────────────
  const autoSent = await tryAutoSMS(payload, message);

  if (autoSent) {
    method = 'auto_sms';
    console.log('[policeAlert] ✅ Police SMS sent automatically via Twilio');
  } else {
    // ── Step 4: Fallback — open SMS deep-link to 112 ────────
    const smsOpened = await openSMSDeepLink(POLICE_NUMBER, message);
    if (smsOpened) {
      method = 'manual_sms';
    } else {
      method = 'none';
    }
  }

  // ── Step 5: Mark in DB ───────────────────────────────────────
  markedInDB = await markPoliceNotified(payload.sosId);

  // ── Step 6: Show confirmation + call option ──────────────────
  const confirmTitle  = autoSent
    ? '✅ Police SMS Sent Automatically'
    : method === 'manual_sms'
    ? '📨 SMS to Police Opened'
    : '⚠️ Could Not Send SMS';

  const confirmMsg = autoSent
    ? `An emergency SMS has been sent to Police (112) automatically.\n\nLocation: ${address?.formatted ?? 'GPS attached'}`
    : method === 'manual_sms'
    ? `An SMS to Police (112) has been pre-filled. Please tap "Send" to dispatch.\n\nLocation: ${address?.formatted ?? 'GPS attached'}`
    : `Could not open SMS. Please call 112 directly.`;

  // Show the dialog — Note: this returns immediately (not awaiting user response)
  // The caller should await this full function, and the dialog is shown inside
  Alert.alert(
    confirmTitle,
    confirmMsg,
    [
      {
        text: '📞 Also Call 112',
        style: 'default',
        onPress: () => openDialler(POLICE_NUMBER),
      },
      {
        text: '📞 Call 100 (Police)',
        style: 'default',
        onPress: () => openDialler(POLICE_ALTERNATE),
      },
      { text: 'OK', style: 'cancel' },
    ]
  );

  return { method, address, message, markedInDB };
}

// ─── Convenience: call 112 directly ───────────────────────────
export async function callPolice(): Promise<void> {
  await openDialler(POLICE_NUMBER);
}

// ─── Convenience: call 100 directly ───────────────────────────
export async function callPoliceAlternate(): Promise<void> {
  await openDialler(POLICE_ALTERNATE);
}
