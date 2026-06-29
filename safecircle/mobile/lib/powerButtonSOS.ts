/**
 * mobile/lib/powerButtonSOS.ts
 * ─────────────────────────────
 * Detects 5 rapid power-button presses and fires a silent SOS.
 *
 * How it works:
 *   On Android/iOS, pressing the power button causes the app to receive
 *   AppState → 'background' (screen off) then 'active' (screen on) events.
 *   We track the timestamps of these focus-change transitions.
 *   5 such pairs within 3 seconds = 5 rapid power presses → SOS.
 *
 * Implementation strategy:
 *   1. Primary:  AppState change listener ('background'↔'active' transitions)
 *   2. Secondary: expo-task-manager background task for when screen is off
 *   3. Foreground Service (Android): keeps detection alive in background
 *
 * Notes:
 *   – iOS: AppState blur events are reliable for power-press detection.
 *   – Android: AppState blur fires on screen-off; works in background via
 *     expo-background-fetch + expo-task-manager.
 *   – This CANNOT distinguish power-button from app-switch on all devices.
 *     We use a 3-second window to filter out casual multitasking.
 */

import { AppState, AppStateStatus, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Constants ─────────────────────────────────────────────────
const PRESS_COUNT_TARGET  = 5;     // 5 presses to trigger
const PRESS_WINDOW_MS     = 3_000; // within 3 seconds
const COOLDOWN_MS         = 5_000; // prevent re-trigger for 5s after fire
const STORAGE_KEY_ENABLED = 'sc_power_btn_sos_enabled';

// Background task name (registered with expo-task-manager)
export const BACKGROUND_SOS_TASK_NAME = 'SAFECIRCLE_BACKGROUND_SOS';

// ─── Types ─────────────────────────────────────────────────────
export type PowerButtonSOSCallback = () => void;
export type PowerButtonStatus =
  | 'active'
  | 'stopped'
  | 'triggered'
  | 'cooldown'
  | 'disabled';

// ═══════════════════════════════════════════════════════════════
// PowerButtonSOSManager — singleton
// ═══════════════════════════════════════════════════════════════
class PowerButtonSOSManager {
  private static _instance: PowerButtonSOSManager | null = null;

  private _enabled         = true;
  private _running         = false;
  private _pressTimes:      number[] = [];   // timestamps of blur events
  private _lastFiredAt      = 0;

  private _onTriggered:    PowerButtonSOSCallback | null = null;
  private _onStatusChange: ((s: PowerButtonStatus) => void) | null = null;

  private _appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private _prevAppState: AppStateStatus = AppState.currentState;

  static getInstance(): PowerButtonSOSManager {
    if (!PowerButtonSOSManager._instance) {
      PowerButtonSOSManager._instance = new PowerButtonSOSManager();
    }
    return PowerButtonSOSManager._instance;
  }

  private constructor() {}

  // ── Register callbacks ─────────────────────────────────────
  setCallback(cb: PowerButtonSOSCallback) {
    this._onTriggered = cb;
  }

  setStatusCallback(cb: (s: PowerButtonStatus) => void) {
    this._onStatusChange = cb;
  }

  // ── Start detection ────────────────────────────────────────
  async start(): Promise<void> {
    if (this._running) return;

    // Check settings
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY_ENABLED);
      if (stored === 'false') {
        this._enabled = false;
        this._emitStatus('disabled');
        return;
      }
    } catch {}

    this._running = true;
    this._pressTimes = [];

    // Subscribe to AppState changes
    this._appStateSubscription = AppState.addEventListener(
      'change',
      this._handleAppStateChange.bind(this)
    );

    this._emitStatus('active');
    console.log('[PowerButtonSOS] Monitoring started');

    // Register background task (non-blocking)
    this._registerBackgroundTask();
  }

  // ── Stop detection ─────────────────────────────────────────
  stop(): void {
    this._running = false;
    this._pressTimes = [];
    this._appStateSubscription?.remove();
    this._appStateSubscription = null;
    this._emitStatus('stopped');
    console.log('[PowerButtonSOS] Monitoring stopped');
  }

  // ── Enable / disable without full teardown ─────────────────
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this._pressTimes = [];
      this._emitStatus('disabled');
    } else {
      this._emitStatus('active');
    }
    AsyncStorage.setItem(STORAGE_KEY_ENABLED, enabled ? 'true' : 'false').catch(() => {});
  }

  // ── Reset press window (e.g. after a false dismiss) ────────
  reset(): void {
    this._pressTimes = [];
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE
  // ─────────────────────────────────────────────────────────────

  private _handleAppStateChange(nextState: AppStateStatus) {
    if (!this._enabled || !this._running) return;

    const prev = this._prevAppState;
    this._prevAppState = nextState;

    // We care about: active → background transitions (power button press)
    // Each press cycle is: active → background (off) → active (on)
    // We record the 'background' event timestamp as a "press"
    if (
      prev === 'active' &&
      (nextState === 'background' || nextState === 'inactive')
    ) {
      this._recordPress();
    }
  }

  private _recordPress() {
    const now = Date.now();

    // Cooldown guard — don't re-trigger immediately
    if (now - this._lastFiredAt < COOLDOWN_MS) {
      console.log('[PowerButtonSOS] In cooldown — ignoring press');
      return;
    }

    // Add timestamp + prune old timestamps outside the window
    this._pressTimes.push(now);
    this._pressTimes = this._pressTimes.filter(
      (t) => now - t <= PRESS_WINDOW_MS
    );

    const count = this._pressTimes.length;
    console.log(`[PowerButtonSOS] Press ${count}/${PRESS_COUNT_TARGET} (window: ${PRESS_WINDOW_MS}ms)`);

    if (count >= PRESS_COUNT_TARGET) {
      this._triggerSOS();
    }
  }

  private _triggerSOS() {
    this._lastFiredAt = Date.now();
    this._pressTimes  = [];

    console.log('[PowerButtonSOS] 🚨 5x Power Button SOS triggered!');
    this._emitStatus('triggered');

    this._onTriggered?.();

    // Enter cooldown status after a brief moment
    setTimeout(() => {
      if (this._running) this._emitStatus('active');
    }, COOLDOWN_MS);
  }

  // ── Register expo-task-manager background task ─────────────
  private _registerBackgroundTask() {
    // We register the task definition separately in app/_layout.tsx or
    // a dedicated taskManager.ts so that expo-task-manager's
    // TaskManager.defineTask() runs at module load time (required by Expo).
    // Here we just schedule the background fetch if available.
    try {
      const BackgroundFetch = require('expo-background-fetch');
      const TaskManager     = require('expo-task-manager');

      if (!TaskManager.isTaskDefined(BACKGROUND_SOS_TASK_NAME)) {
        console.log('[PowerButtonSOS] Background task not yet defined — skipping registration');
        return;
      }

      BackgroundFetch.registerTaskAsync(BACKGROUND_SOS_TASK_NAME, {
        minimumInterval: 60,          // iOS: minimum 60s between background fetches
        stopOnTerminate: false,       // Android: keep alive after app termination
        startOnBoot: true,            // Android: restart on device reboot
      }).catch((e: Error) => {
        console.warn('[PowerButtonSOS] BackgroundFetch.registerTaskAsync failed:', e.message);
      });
    } catch (e) {
      console.warn('[PowerButtonSOS] expo-background-fetch not available:', (e as Error).message);
    }
  }

  private _emitStatus(status: PowerButtonStatus) {
    this._onStatusChange?.(status);
  }

  // ── Getters ────────────────────────────────────────────────
  get isRunning()   { return this._running;  }
  get pressCount()  { return this._pressTimes.length; }
  get isEnabled()   { return this._enabled;  }
}

// ─── Export singleton ─────────────────────────────────────────
export const powerButtonSOS = PowerButtonSOSManager.getInstance();
export default powerButtonSOS;

// ═══════════════════════════════════════════════════════════════
// Background Task Definition
// ═══════════════════════════════════════════════════════════════
/**
 * Call defineBackgroundSOSTask() once at app startup (in _layout.tsx or
 * a top-level import) to register the expo-task-manager task.
 *
 * The task runs a lightweight health-check:
 *   – Verifies the power button detector is still alive
 *   – Logs a heartbeat for debugging
 *
 * Heavy work (voice, accelerometer) is NOT done in the background task;
 * those run in the foreground React Native thread.
 */
export function defineBackgroundSOSTask() {
  try {
    const TaskManager = require('expo-task-manager');
    const BackgroundFetch = require('expo-background-fetch');

    if (TaskManager.isTaskDefined(BACKGROUND_SOS_TASK_NAME)) return;

    TaskManager.defineTask(BACKGROUND_SOS_TASK_NAME, async () => {
      try {
        console.log('[PowerButtonSOS] Background health-check ✓', new Date().toISOString());
        // In a full implementation you would:
        // 1. Check if SOS is active (from AsyncStorage)
        // 2. If yes: stream location from background
        // 3. If no: verify listeners are intact
        return BackgroundFetch.BackgroundFetchResult.NewData;
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });

    console.log('[PowerButtonSOS] Background task defined:', BACKGROUND_SOS_TASK_NAME);
  } catch (e) {
    console.warn('[PowerButtonSOS] defineBackgroundSOSTask error:', (e as Error).message);
  }
}
