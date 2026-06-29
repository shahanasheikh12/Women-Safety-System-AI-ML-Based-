/**
 * mobile/lib/voiceSOS.ts
 * ──────────────────────
 * Continuous hotword detection engine for SafeCircle.
 *
 * Uses @react-native-voice/voice for on-device speech recognition.
 * Runs a continuous listen → partial-match → restart loop.
 *
 * Hotwords (case-insensitive, punctuation-stripped):
 *   • "help me safecircle"
 *   • "safecircle sos"
 *   • "safecircle help"
 *   • "bachao bachao"      (Hindi: "save me save me")
 *   • "help help help"     (3× repetition)
 *   • Custom hotword stored in AsyncStorage key: sc_custom_hotword
 *
 * Architecture:
 *   VoiceSOSManager (singleton)
 *   ├─ start()         – request mic permission, begin loop
 *   ├─ stop()          – halt loop + release Voice
 *   ├─ setCallback()   – called when hotword detected
 *   ├─ setEnabled()    – toggle without full stop/start
 *   └─ updateCustomHotword() – refresh from settings
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ─── Type shim for @react-native-voice/voice ─────────────────
// We lazy-import so the app doesn't crash if the package isn't installed.
type VoiceModule = {
  start: (locale: string) => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
  cancel: () => Promise<void>;
  isAvailable: () => Promise<boolean>;
  isRecognizing: () => Promise<boolean>;
  onSpeechPartialResults: ((e: { value?: string[] }) => void) | null;
  onSpeechResults:        ((e: { value?: string[] }) => void) | null;
  onSpeechError:          ((e: { error?: { message?: string } }) => void) | null;
  onSpeechEnd:            (() => void) | null;
  removeAllListeners: () => void;
};

// ─── Battery shim ────────────────────────────────────────────
type BatteryModule = { getBatteryLevelAsync: () => Promise<number> };

// ─── Constants ────────────────────────────────────────────────
const RESTART_INTERVAL_MS     = 60_000;  // Android stops after ~60s; restart loop
const BATTERY_GUARD_THRESHOLD = 0.10;    // Pause below 10% battery
const BATTERY_CHECK_MS        = 30_000;  // Check battery every 30s
const LOCALE                  = 'en-IN'; // Indian English for best accuracy

const STORAGE_KEY_CUSTOM_HOTWORD = 'sc_custom_hotword';
const STORAGE_KEY_VOICE_ENABLED  = 'sc_voice_sos_enabled';

// ─── Built-in hotwords ────────────────────────────────────────
const BUILTIN_HOTWORDS: string[] = [
  'help me safecircle',
  'safecircle sos',
  'safecircle help',
  'bachao bachao',
  'help help help',
];

// ─── Utility: normalise a transcript string ───────────────────
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F ]/g, '') // strip punctuation, keep Devanagari
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Match hotword in last N words of transcript ──────────────
function containsHotword(transcript: string, hotwords: string[]): string | null {
  const norm = normalise(transcript);
  // Use the last 10 words to reduce false positives at the start of long transcripts
  const words    = norm.split(' ');
  const lastTen  = words.slice(-10).join(' ');

  for (const hw of hotwords) {
    if (lastTen.includes(normalise(hw))) return hw;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// VoiceSOSManager — singleton
// ═══════════════════════════════════════════════════════════════
class VoiceSOSManager {
  private static _instance: VoiceSOSManager | null = null;

  private Voice: VoiceModule | null = null;
  private Battery: BatteryModule | null = null;

  private _running      = false;
  private _enabled      = true;
  private _batteryLow   = false;
  private _hotwords: string[] = [...BUILTIN_HOTWORDS];

  private _onDetected: ((hotword: string) => void) | null = null;
  private _onStatusChange: ((status: VoiceSOSStatus) => void) | null = null;

  private _restartTimer:  ReturnType<typeof setTimeout>  | null = null;
  private _batteryTimer:  ReturnType<typeof setInterval> | null = null;

  // ── Singleton accessor ──────────────────────────────────────
  static getInstance(): VoiceSOSManager {
    if (!VoiceSOSManager._instance) {
      VoiceSOSManager._instance = new VoiceSOSManager();
    }
    return VoiceSOSManager._instance;
  }

  private constructor() {}

  // ── Lazy-load native modules ────────────────────────────────
  private async loadModules(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
      if (!this.Voice) {
        this.Voice = require('@react-native-voice/voice').default as VoiceModule;
      }
      if (!this.Battery) {
        this.Battery = require('expo-battery') as BatteryModule;
      }
      return true;
    } catch (e) {
      console.warn('[VoiceSOS] @react-native-voice/voice not installed:', (e as Error).message);
      return false;
    }
  }

  // ── Register detection callback ─────────────────────────────
  setCallback(cb: (hotword: string) => void) {
    this._onDetected = cb;
  }

  // ── Register status change callback ────────────────────────
  setStatusCallback(cb: (s: VoiceSOSStatus) => void) {
    this._onStatusChange = cb;
  }

  // ── Toggle without full teardown ────────────────────────────
  setEnabled(enabled: boolean) {
    this._enabled = enabled;
    if (!enabled && this._running) {
      this._stopListening();
    } else if (enabled && !this._running) {
      this._startListening();
    }
  }

  // ── Load custom hotword from AsyncStorage ───────────────────
  async updateCustomHotword(): Promise<void> {
    try {
      const custom = await AsyncStorage.getItem(STORAGE_KEY_CUSTOM_HOTWORD);
      // Rebuild hotwords list
      const base = [...BUILTIN_HOTWORDS];
      if (custom && custom.trim().length > 2) {
        base.push(custom.trim().toLowerCase());
      }
      this._hotwords = base;
    } catch {}
  }

  /** Persist a new custom hotword to AsyncStorage */
  async setCustomHotword(word: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY_CUSTOM_HOTWORD, word.trim());
    await this.updateCustomHotword();
  }

  /** Remove user's custom hotword */
  async clearCustomHotword(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY_CUSTOM_HOTWORD);
    this._hotwords = [...BUILTIN_HOTWORDS];
  }

  async getCustomHotword(): Promise<string | null> {
    return AsyncStorage.getItem(STORAGE_KEY_CUSTOM_HOTWORD);
  }

  // ── Public start ────────────────────────────────────────────
  async start(): Promise<boolean> {
    const loaded = await this.loadModules();
    if (!loaded) return false;

    // Check if user disabled voice SOS in settings
    try {
      const enabled = await AsyncStorage.getItem(STORAGE_KEY_VOICE_ENABLED);
      if (enabled === 'false') {
        this._enabled = false;
        this._emitStatus('disabled');
        return false;
      }
    } catch {}

    await this.updateCustomHotword();

    // Check platform availability
    try {
      const avail = await this.Voice!.isAvailable();
      if (!avail) {
        console.warn('[VoiceSOS] Speech recognition not available on this device');
        this._emitStatus('unavailable');
        return false;
      }
    } catch {}

    this._running = true;
    this._startBatteryWatcher();
    await this._startListening();
    return true;
  }

  // ── Public stop ─────────────────────────────────────────────
  async stop(): Promise<void> {
    this._running = false;
    this._clearRestartTimer();
    this._clearBatteryTimer();
    await this._stopListening();
    this._emitStatus('stopped');
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE
  // ─────────────────────────────────────────────────────────────

  private async _startListening(): Promise<void> {
    if (!this.Voice || !this._enabled || this._batteryLow) return;

    try {
      // Attach handlers (idempotent — reassigning is fine)
      this.Voice.onSpeechPartialResults = this._handlePartial.bind(this);
      this.Voice.onSpeechResults        = this._handleFinal.bind(this);
      this.Voice.onSpeechError          = this._handleError.bind(this);
      this.Voice.onSpeechEnd            = this._handleEnd.bind(this);

      await this.Voice.start(LOCALE);
      this._emitStatus('listening');

      // Schedule restart before Android's hard 60s timeout
      this._clearRestartTimer();
      this._restartTimer = setTimeout(() => {
        this._restartListening();
      }, RESTART_INTERVAL_MS);

    } catch (e) {
      console.warn('[VoiceSOS] _startListening error:', (e as Error).message);
      this._emitStatus('error');
      // Auto-retry after 3s
      this._restartTimer = setTimeout(() => this._restartListening(), 3_000);
    }
  }

  private async _stopListening(): Promise<void> {
    this._clearRestartTimer();
    try {
      await this.Voice?.stop();
      await this.Voice?.destroy();
      this.Voice?.removeAllListeners();
    } catch {}
  }

  private async _restartListening(): Promise<void> {
    if (!this._running) return;
    try {
      await this.Voice?.stop();
      await this.Voice?.destroy();
    } catch {}
    await this._startListening();
  }

  // ── Speech event handlers ────────────────────────────────────
  private _handlePartial(e: { value?: string[] }) {
    const values = e.value ?? [];
    for (const transcript of values) {
      const matched = containsHotword(transcript, this._hotwords);
      if (matched) {
        this._onHotwordDetected(matched);
        return;
      }
    }
  }

  private _handleFinal(e: { value?: string[] }) {
    // Same check on final results (catches slow recognisers)
    this._handlePartial(e);
  }

  private _handleError(e: { error?: { message?: string } }) {
    const msg = e.error?.message ?? 'unknown';
    console.warn('[VoiceSOS] recognition error:', msg);
    this._emitStatus('error');
    // Restart after brief pause unless we stopped intentionally
    if (this._running) {
      this._restartTimer = setTimeout(() => this._restartListening(), 2_000);
    }
  }

  private _handleEnd() {
    // Recognition session ended normally (timeout / silence) — restart
    if (this._running && this._enabled && !this._batteryLow) {
      this._restartTimer = setTimeout(() => this._restartListening(), 500);
    }
  }

  // ── Hotword detected ─────────────────────────────────────────
  private _onHotwordDetected(hotword: string) {
    console.log('[VoiceSOS] 🎙️ Hotword detected:', hotword);
    this._emitStatus('hotword_detected');

    // Brief pause so we don't re-trigger immediately
    this._running = false;
    this._stopListening();

    // Fire callback
    if (this._onDetected) {
      this._onDetected(hotword);
    }
  }

  // ── Battery watcher ──────────────────────────────────────────
  private _startBatteryWatcher() {
    this._clearBatteryTimer();
    this._batteryTimer = setInterval(async () => {
      if (!this.Battery) return;
      try {
        const level = await this.Battery.getBatteryLevelAsync();
        const isLow = level >= 0 && level < BATTERY_GUARD_THRESHOLD;

        if (isLow && !this._batteryLow) {
          // Transition → low
          this._batteryLow = true;
          console.warn('[VoiceSOS] Battery < 10% — pausing voice detection');
          this._emitStatus('battery_low');
          await this._stopListening();
        } else if (!isLow && this._batteryLow) {
          // Transition → recovered
          this._batteryLow = false;
          console.log('[VoiceSOS] Battery recovered — resuming voice detection');
          await this._startListening();
        }
      } catch {}
    }, BATTERY_CHECK_MS);
  }

  // ── Timer helpers ────────────────────────────────────────────
  private _clearRestartTimer() {
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
  }

  private _clearBatteryTimer() {
    if (this._batteryTimer) {
      clearInterval(this._batteryTimer);
      this._batteryTimer = null;
    }
  }

  // ── Status emitter ───────────────────────────────────────────
  private _emitStatus(status: VoiceSOSStatus) {
    this._onStatusChange?.(status);
  }

  // ── Public getters ───────────────────────────────────────────
  get isRunning()     { return this._running;      }
  get isBatteryLow()  { return this._batteryLow;   }
  get activeHotwords(){ return [...this._hotwords]; }
}

// ─── Exported status type ─────────────────────────────────────
export type VoiceSOSStatus =
  | 'listening'
  | 'stopped'
  | 'error'
  | 'hotword_detected'
  | 'battery_low'
  | 'disabled'
  | 'unavailable';

// ─── Export singleton ─────────────────────────────────────────
export const voiceSOS = VoiceSOSManager.getInstance();
export default voiceSOS;

// ─── Convenience helpers (used from Settings screen) ─────────
export const BUILTIN_HOTWORD_LIST = BUILTIN_HOTWORDS;
export { normalise, containsHotword };
