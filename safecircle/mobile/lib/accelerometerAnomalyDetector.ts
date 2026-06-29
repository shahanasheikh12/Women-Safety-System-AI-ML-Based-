import { Alert, Platform } from 'react-native';
import { sendLocalNotification } from './notifications';

// Native-only modules — guarded for web
const Accelerometer = Platform.OS !== 'web'
  ? require('expo-sensors').Accelerometer
  : null;

const loadTensorflowModel: any = Platform.OS !== 'web'
  ? require('react-native-fast-tflite').loadTensorflowModel
  : async () => null;

const Haptics = Platform.OS !== 'web'
  ? require('expo-haptics')
  : { impactAsync: async () => {}, ImpactFeedbackStyle: { Heavy: 'Heavy' } };

const Battery = Platform.OS !== 'web'
  ? require('expo-battery')
  : { getBatteryLevelAsync: async () => 1.0 };

const TaskManager = Platform.OS !== 'web'
  ? require('expo-task-manager')
  : { defineTask: () => {} };

const LSTM_ASSET = Platform.OS !== 'web'
  ? require('../assets/models/anomaly_lstm.tflite')
  : null;

type TensorflowModel = any;

const ACCEL_TASK_NAME = 'background-accelerometer-detection';

export class AccelerometerAnomalyDetector {
  private static instance: AccelerometerAnomalyDetector | null = null;

  public isRunning: boolean = false;
  public anomalyThreshold: number = 0.8;
  public isPhoneStill: boolean = false;

  private sampleBuffer: number[][] = []; // stores [x, y, z] values
  private windowSize: number = 50; // 50 samples at 50Hz = 1 second
  private lastMovementTime: Date = new Date();
  private model: TensorflowModel | null = null;
  private subscription: any = null;

  // Callbacks registered by UI/hooks
  private onFallDetected: (() => void) | null = null;
  private onStruggleDetected: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): AccelerometerAnomalyDetector {
    if (!AccelerometerAnomalyDetector.instance) {
      AccelerometerAnomalyDetector.instance = new AccelerometerAnomalyDetector();
    }
    return AccelerometerAnomalyDetector.instance;
  }

  public registerCallbacks(onFall: () => void, onStruggle: () => void) {
    this.onFallDetected = onFall;
    this.onStruggleDetected = onStruggle;
  }

  /**
   * Initializes the TFLite model, checks battery guard, and subscribes to 50Hz Accelerometer.
   */
  public async start() {
    if (this.isRunning) return;

    try {
      // 1. Battery Guard (Pause if battery < 15%)
      const batteryLevel = await Battery.getBatteryLevelAsync();
      if (batteryLevel !== -1 && batteryLevel < 0.15) {
        console.warn('[AnomalyDetector] Battery below 15%. Aborting start to save power.');
        return;
      }

      // 2. Load TFLite Model
      console.log('[AnomalyDetector] Loading LSTM model...');
      this.model = await loadTensorflowModel(LSTM_ASSET, []);
      console.log('[AnomalyDetector] Model loaded successfully');

      // 3. Reset states
      this.sampleBuffer = [];
      this.isPhoneStill = false;
      this.lastMovementTime = new Date();
      this.isRunning = true;

      // 4. Subscribe to Accelerometer at 50Hz (20ms interval)
      Accelerometer.setUpdateInterval(20);
      this.subscription = Accelerometer.addListener(({ x, y, z }: any) => {
        this.onSample(x, y, z);
      });

      console.log('[AnomalyDetector] 50Hz Accelerometer listener active');
    } catch (err) {
      console.error('[AnomalyDetector] Failed to start:', err);
      this.isRunning = false;
    }
  }

  /**
   * Processes each incoming sample at 50Hz.
   */
  private async onSample(x: number, y: number, z: number) {
    if (!this.model || !this.isRunning) return;

    // 1. Add to circular buffer
    this.sampleBuffer.push([x, y, z]);

    // 2. Movement tracking (stillness check)
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    const deviationFromGravity = Math.abs(magnitude - 1.0); // 1.0g is standard gravity
    const now = new Date();

    if (deviationFromGravity > 0.1) {
      this.lastMovementTime = now;
      this.isPhoneStill = false;
    } else if (now.getTime() - this.lastMovementTime.getTime() > 30000) {
      // 30 seconds of stillness
      this.isPhoneStill = true;
    }

    // 3. Run prediction when window size reaches 50 samples
    if (this.sampleBuffer.length >= this.windowSize) {
      const window = this.sampleBuffer.slice(0, this.windowSize);

      // Slide window by 25 samples (50% overlap)
      this.sampleBuffer = this.sampleBuffer.slice(25);

      // Run inference in background to avoid blocking 50Hz sampling
      this.processWindow(window).catch((err) =>
        console.error('[AnomalyDetector] Error processing window:', err)
      );
    }
  }

  /**
   * Runs LSTM inference on a 50x3 window.
   */
  private async processWindow(window: number[][]) {
    if (!this.model) return;

    // Flat float array for model input (shape [50, 3] = 150 values)
    const flatInput = new Float32Array(150);
    for (let i = 0; i < this.windowSize; i++) {
      flatInput[i * 3] = window[i][0];
      flatInput[i * 3 + 1] = window[i][1];
      flatInput[i * 3 + 2] = window[i][2];
    }

    const outputBuffers = await this.model.run([flatInput.buffer as ArrayBuffer]);
    if (!outputBuffers || outputBuffers.length === 0) return;

    const scores = new Float32Array(outputBuffers[0]);
    const anomalyScore = scores[0] || 0;

    if (anomalyScore >= this.anomalyThreshold) {
      console.warn(`[AnomalyDetector] Anomaly detected! Score: ${anomalyScore.toFixed(3)}`);
      this.handleAnomaly(window);
    }
  }

  /**
   * Heuristic mapping to classify fall vs. struggle.
   */
  private handleAnomaly(window: number[][]) {
    // Fall signature: high impact/deviation followed by sudden stillness
    // Look at last 10 samples (200ms) of window:
    const recentSamples = window.slice(-10);
    const avgDeviation = recentSamples.reduce((acc, s) => {
      const mag = Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]);
      return acc + Math.abs(mag - 1.0);
    }, 0) / 10;

    if (avgDeviation < 0.15 || this.isPhoneStill) {
      // Sudden stillness (or overall still phone) after anomaly -> Fall
      console.warn('[AnomalyDetector] Fall pattern detected (high impact followed by stillness)');
      this.triggerFallCheck();
    } else {
      // Continuous high motion -> Struggle
      console.warn('[AnomalyDetector] Struggle pattern detected (persistent anomaly without stillness)');
      this.triggerStruggleCheck();
    }
  }

  private triggerFallCheck() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

    // If callback is set, let the active UI show a 10s cancel dialogue
    if (this.onFallDetected) {
      this.onFallDetected();
    } else {
      // Fallback local notification if running in background
      sendLocalNotification(
        '🚨 Fall Detected!',
        'SafeCircle detected a fall. Tap to cancel emergency SOS within 10 seconds.',
        { type: 'fall_detected' }
      );
    }
  }

  private triggerStruggleCheck() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    if (this.onStruggleDetected) {
      this.onStruggleDetected();
    } else {
      sendLocalNotification(
        '⚠️ Unusual Activity Detected',
        'Unusual motion detected. Tap here to trigger SOS if you are in danger.',
        { type: 'struggle_detected' }
      );
    }
  }

  /**
   * Unsubscribes from Accelerometer and releases TFLite model.
   */
  public async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log('[AnomalyDetector] Stopping Accelerometer Anomaly Detector...');

    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    this.model = null;
  }
}

/**
 * Registers background task using expo-task-manager.
 * (Note: On Android, this task can run as a Foreground Service to keep sampling.)
 */
export function defineBackgroundAccelerometerTask() {
  if (TaskManager.isTaskDefined(ACCEL_TASK_NAME)) return;

  TaskManager.defineTask(ACCEL_TASK_NAME, async () => {
    try {
      const detector = AccelerometerAnomalyDetector.getInstance();
      if (!detector.isRunning) {
        await detector.start();
      }
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (err) {
      console.error('[AnomalyDetector] Background task execution failed:', err);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

import * as BackgroundFetch from 'expo-background-fetch';
