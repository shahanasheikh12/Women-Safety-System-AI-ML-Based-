/**
 * mobile/hooks/useSOS.ts
 * ──────────────────────
 * Central SOS orchestration hook.
 *
 * Handles:
 *   • 3-second countdown before firing
 *   • GPS location capture
 *   • Supabase sos_events insert (with trigger_method)
 *   • Battery-aware location streaming
 *   • Volunteer notification via Edge Function
 *   • Alarm sound (unless silent mode)
 *   • Voice SOS hotword integration
 *   • Power-button 5× press integration
 *   • SOS resolution
 *
 * Trigger methods tracked in sos_events.trigger_method:
 *   'button'       — manual press on home screen SOS button
 *   'voice'        — "help me safecircle" hotword
 *   'shake'        — accelerometer shake detection
 *   'power_button' — 5× rapid power button press
 *   'accelerometer'— future: fall detection
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { AppState, Vibration } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { voiceSOS, VoiceSOSStatus } from '../lib/voiceSOS';
import { powerButtonSOS, PowerButtonStatus, defineBackgroundSOSTask } from '../lib/powerButtonSOS';
import { sendLocalNotification } from '../lib/notifications';
import { BatteryManager } from '../lib/batteryManager';
import { NetworkManager } from '../lib/networkManager';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export type SOSTriggerMethod =
  | 'button'
  | 'voice'
  | 'shake'
  | 'power_button'
  | 'accelerometer';

export interface SOSLocation {
  lat: number;
  lng: number;
}

export interface SOSState {
  isSOSActive:       boolean;
  sosEventId:        string | null;
  isSilentMode:      boolean;
  countdownActive:   boolean;
  countdownValue:    number;
  currentLocation:   SOSLocation | null;
  triggerMethod:     SOSTriggerMethod | null;

  // Voice SOS
  voiceListening:    boolean;
  voiceStatus:       VoiceSOSStatus | null;

  // Power button
  powerBtnPressCount: number;
}

export interface SOSActions {
  startCountdown: (silent?: boolean, method?: SOSTriggerMethod) => void;
  cancelCountdown: () => void;
  fireSOS:        (silent: boolean, method?: SOSTriggerMethod) => Promise<void>;
  resolveSOS:     (reason: 'safe' | 'false_alarm') => Promise<void>;
  enableVoiceSOS: () => Promise<void>;
  disableVoiceSOS: () => void;
  enablePowerButtonSOS: () => void;
  disablePowerButtonSOS: () => void;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const COUNTDOWN_SECONDS                 = 3;
const LOCATION_STREAM_INTERVAL_MS       = 5_000;
const LOCATION_STREAM_INTERVAL_LOW_BAT  = 10_000;
const BATTERY_LOW_THRESHOLD             = 0.20;

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────
export function useSOS(): SOSState & SOSActions {
  // ── Core SOS state ─────────────────────────────────────────
  const [isSOSActive,     setIsSOSActive]      = useState(false);
  const [sosEventId,      setSosEventId]        = useState<string | null>(null);
  const [isSilentMode,    setIsSilentMode]      = useState(false);
  const [countdownActive, setCountdownActive]   = useState(false);
  const [countdownValue,  setCountdownValue]    = useState(COUNTDOWN_SECONDS);
  const [currentLocation, setCurrentLocation]   = useState<SOSLocation | null>(null);
  const [triggerMethod,   setTriggerMethod]     = useState<SOSTriggerMethod | null>(null);

  // ── Voice SOS state ────────────────────────────────────────
  const [voiceListening,  setVoiceListening]    = useState(false);
  const [voiceStatus,     setVoiceStatus]       = useState<VoiceSOSStatus | null>(null);

  // ── Power button state ─────────────────────────────────────
  const [powerBtnPressCount, setPowerBtnPressCount] = useState(0);

  // ── Refs ────────────────────────────────────────────────────
  const countdownRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const silentRef         = useRef(false);
  const triggerMethodRef  = useRef<SOSTriggerMethod>('button');
  const sosEventIdRef     = useRef<string | null>(null);
  const soundRef          = useRef<Audio.Sound | null>(null);

  // ─────────────────────────────────────────────────────────────
  // Lifecycle: start voice + power-button detectors on mount
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // Define background task (must run at startup)
    defineBackgroundSOSTask();

    // ── Voice SOS ────────────────────────────────────────────
    voiceSOS.setCallback((hotword) => {
      console.log('[useSOS] Voice SOS triggered by hotword:', hotword);
      // Vibrate to acknowledge (brief non-alarm feedback)
      Vibration.vibrate([0, 100, 50, 100]);
      // Trigger with voice method
      startCountdown(false, 'voice');
    });

    voiceSOS.setStatusCallback((status) => {
      setVoiceStatus(status);
      setVoiceListening(status === 'listening');
    });

    // Start voice detection (no-op if @react-native-voice/voice not installed)
    voiceSOS.start().then((started) => {
      if (started) console.log('[useSOS] Voice SOS started');
    });

    // ── Power Button SOS ─────────────────────────────────────
    powerButtonSOS.setCallback(() => {
      console.log('[useSOS] Power Button SOS triggered');
      // Silent SOS for power-button trigger (screen is likely off/locked)
      fireSOS(true, 'power_button');
    });

    powerButtonSOS.setStatusCallback((status: PowerButtonStatus) => {
      if (status === 'triggered') {
        // Already handled above in setCallback
      }
    });

    powerButtonSOS.start();

    // ── Cleanup ───────────────────────────────────────────────
    return () => {
      clearCountdownTimer();
      clearStreamTimer();
      unloadSound();
      voiceSOS.stop();
      powerButtonSOS.stop();
    };
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Timer helpers
  // ─────────────────────────────────────────────────────────────
  const clearCountdownTimer = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  const clearStreamTimer = () => {
    if (streamRef.current) {
      clearInterval(streamRef.current);
      streamRef.current = null;
    }
  };

  const unloadSound = async () => {
    if (soundRef.current) {
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
  };

  // ─────────────────────────────────────────────────────────────
  // GPS helper
  // ─────────────────────────────────────────────────────────────
  const getLocation = async (): Promise<SOSLocation | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const coords: SOSLocation = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      };
      setCurrentLocation(coords);
      return coords;
    } catch {
      return null;
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Location streaming
  // ─────────────────────────────────────────────────────────────
  const streamOneLocation = useCallback(async () => {
    if (!sosEventIdRef.current) return;
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords: SOSLocation = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      };
      setCurrentLocation(coords);

      const netManager = NetworkManager.getInstance();
      if (netManager.isConnected() && !sosEventIdRef.current.startsWith('offline-')) {
        await netManager.executeWithRetry(async () => {
          return await supabase.from('location_stream').insert({
            sos_id:           sosEventIdRef.current!,
            lat:              coords.lat,
            lng:              coords.lng,
            accuracy_meters:  loc.coords.accuracy ?? undefined,
            recorded_at:      new Date().toISOString(),
          });
        });
      }
    } catch (e) {
      console.warn('[useSOS] streamOneLocation error:', e);
    }
  }, []);

  const startLocationStream = useCallback(async () => {
    const intervalMs = BatteryManager.getInstance().getLocationInterval();
    console.log(`[useSOS] Starting location stream with interval: ${intervalMs}ms`);
    streamRef.current = setInterval(streamOneLocation, intervalMs);
  }, [streamOneLocation]);

  // ─────────────────────────────────────────────────────────────
  // Alarm sound
  // ─────────────────────────────────────────────────────────────
  const playAlertSound = async () => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/sos_alert.mp3'),
        { shouldPlay: true, isLooping: true, volume: 1.0 }
      );
      soundRef.current = sound;
    } catch {
      console.warn('[useSOS] Alert sound not loaded (add assets/sos_alert.mp3)');
    }
  };

  // ═══════════════════════════════════════════════════════════
  // PUBLIC ACTIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Begin the 3-second countdown before SOS fires.
   *
   * @param silent  Suppress alarm sound (for discrete triggers like power-btn)
   * @param method  Which trigger initiated this countdown
   */
  const startCountdown = useCallback(
    (silent = false, method: SOSTriggerMethod = 'button') => {
      silentRef.current       = silent;
      triggerMethodRef.current = method;

      setIsSilentMode(silent);
      setTriggerMethod(method);
      setCountdownValue(COUNTDOWN_SECONDS);
      setCountdownActive(true);

      let remaining = COUNTDOWN_SECONDS;

      countdownRef.current = setInterval(() => {
        remaining -= 1;
        setCountdownValue(remaining);

        if (remaining <= 0) {
          clearCountdownTimer();
          setCountdownActive(false);
          fireSOS(silentRef.current, triggerMethodRef.current);
        }
      }, 1000);
    },
    []
  );

  /**
   * Cancel the countdown before it fires.
   */
  const cancelCountdown = useCallback(() => {
    clearCountdownTimer();
    setCountdownActive(false);
    setCountdownValue(COUNTDOWN_SECONDS);
  }, []);

  /**
   * Fire SOS immediately.
   *
   * @param silent  Whether to suppress the alarm sound
   * @param method  The trigger method for analytics (stored in sos_events)
   */
  const fireSOS = useCallback(
    async (silent: boolean, method: SOSTriggerMethod = 'button') => {
      try {
        setIsSOSActive(true);
        setIsSilentMode(silent);
        setTriggerMethod(method);

        // Stop voice detection during active SOS (save CPU/battery)
        voiceSOS.setEnabled(false);

        // 1. Get GPS
        const coords = await getLocation();

        // 2. Auth
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const netManager = NetworkManager.getInstance();
        let newSosId: string;

        // 3. Insert SOS event (with offline fallback or executeWithRetry)
        if (!netManager.isConnected()) {
          const offlineEvent = await netManager.triggerOfflineSOS(
            coords?.lat ?? 0,
            coords?.lng ?? 0,
            user.id,
            method
          );
          newSosId = offlineEvent.id;
        } else {
          const sosData = await netManager.executeWithRetry(async () => {
            return supabase
              .from('sos_events')
              .insert({
                user_id:        user.id,
                status:         'active',
                trigger_method: method,
                lat:            coords?.lat ?? 0,
                lng:            coords?.lng ?? 0,
              })
              .select('id')
              .single();
          });
          newSosId = (sosData as any).id;
        }

        sosEventIdRef.current = newSosId;
        setSosEventId(newSosId);

        // 4. Battery-aware location streaming
        await startLocationStream();

        // 5. Notify volunteers via Edge Function (skip if offline)
        if (netManager.isConnected() && !newSosId.startsWith('offline-')) {
          supabase.functions
            .invoke('notify-volunteers', {
              body: {
                sos_id:  newSosId,
                lat:     coords?.lat,
                lng:     coords?.lng,
                user_id: user.id,
                trigger: method,
              },
            })
            .catch((e) => console.warn('[useSOS] notify-volunteers error:', e));
        }

        // 6. Power-button SOS: show a local notification (screen may be off)
        if (method === 'power_button') {
          await sendLocalNotification(
            '🚨 SafeCircle Power Button SOS Activated',
            newSosId.startsWith('offline-')
              ? 'SOS registered locally & SMS sent. Check network.'
              : 'Power button SOS registered — help has been alerted.',
            { sosId: newSosId }
          );
        }

        // 7. Voice SOS acknowledgement notification
        if (method === 'voice') {
          Vibration.vibrate([0, 200, 100, 200, 100, 200]);
          await sendLocalNotification(
            '🎙️ Voice SOS Activated',
            newSosId.startsWith('offline-')
              ? 'Voice SOS registered locally & SMS sent. Check network.'
              : 'SafeCircle detected your voice trigger — help is on the way.',
            { sosId: newSosId }
          );
        }

        // 8. Alarm sound (skip for silent / power-button triggers)
        if (!silent && method !== 'power_button') {
          await playAlertSound();
        }

        // 9. Navigate to active SOS screen
        router.push({
          pathname: '/sos-active',
          params: {
            sosId: newSosId,
            trigger: method,
            offline: newSosId.startsWith('offline-') ? 'true' : 'false',
          },
        });

      } catch (err) {
        console.error('[useSOS] fireSOS error:', err);
        setIsSOSActive(false);
        // Re-enable voice detection on failure
        voiceSOS.setEnabled(true);
      }
    },
    [startLocationStream]
  );

  /**
   * Resolve the active SOS.
   */
  const resolveSOS = useCallback(async (reason: 'safe' | 'false_alarm') => {
    try {
      await soundRef.current?.stopAsync();
      await unloadSound();
      clearStreamTimer();

      const id = sosEventIdRef.current;
      if (id) {
        if (id.startsWith('offline-')) {
          // Update status in local storage offline queue
          const queueStr = await AsyncStorage.getItem('OFFLINE_SOS_QUEUE');
          if (queueStr) {
            const queue = JSON.parse(queueStr);
            const idx = queue.findIndex((e: any) => e.id === id);
            if (idx !== -1) {
              queue[idx].status = reason === 'safe' ? 'resolved' : 'false_alarm';
              queue[idx].resolved_at = new Date().toISOString();
              await AsyncStorage.setItem('OFFLINE_SOS_QUEUE', JSON.stringify(queue));
            }
          }
        } else {
          // Sync immediately or execute with retry
          await NetworkManager.getInstance().executeWithRetry(async () => {
            return await supabase
              .from('sos_events')
              .update({
                status:      reason === 'safe' ? 'resolved' : 'false_alarm',
                resolved_at: new Date().toISOString(),
              })
              .eq('id', id);
          });
        }
      }

      setIsSOSActive(false);
      setSosEventId(null);
      sosEventIdRef.current = null;
      setCurrentLocation(null);
      setIsSilentMode(false);
      setTriggerMethod(null);

      // Re-enable voice detection after SOS resolves
      voiceSOS.start();

      router.replace('/(tabs)/home');
    } catch (err) {
      console.error('[useSOS] resolveSOS error:', err);
    }
  }, []);

  // ── Voice SOS controls ──────────────────────────────────────
  const enableVoiceSOS = useCallback(async () => {
    const started = await voiceSOS.start();
    if (started) setVoiceListening(true);
  }, []);

  const disableVoiceSOS = useCallback(() => {
    voiceSOS.stop();
    setVoiceListening(false);
  }, []);

  // ── Power button controls ───────────────────────────────────
  const enablePowerButtonSOS = useCallback(() => {
    powerButtonSOS.setEnabled(true);
  }, []);

  const disablePowerButtonSOS = useCallback(() => {
    powerButtonSOS.setEnabled(false);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Return
  // ─────────────────────────────────────────────────────────────
  return {
    // State
    isSOSActive,
    sosEventId,
    isSilentMode,
    countdownActive,
    countdownValue,
    currentLocation,
    triggerMethod,
    voiceListening,
    voiceStatus,
    powerBtnPressCount,

    // Actions
    startCountdown,
    cancelCountdown,
    fireSOS,
    resolveSOS,
    enableVoiceSOS,
    disableVoiceSOS,
    enablePowerButtonSOS,
    disablePowerButtonSOS,
  };
}

export default useSOS;
