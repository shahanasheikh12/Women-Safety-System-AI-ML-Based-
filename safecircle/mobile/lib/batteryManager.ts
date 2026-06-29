import * as Battery from 'expo-battery';

export type BatteryTier = 'critical' | 'low' | 'normal';

export class BatteryManager {
  private static instance: BatteryManager;
  private level: number = 1.0; // 0.0 to 1.0
  private charging: boolean = false;
  private listeners: Set<(tier: BatteryTier) => void> = new Set();

  private constructor() {
    this.init();
  }

  static getInstance(): BatteryManager {
    if (!BatteryManager.instance) {
      BatteryManager.instance = new BatteryManager();
    }
    return BatteryManager.instance;
  }

  private async init() {
    try {
      const isAvailable = await Battery.isAvailableAsync();
      if (!isAvailable) return;

      const [batteryLevel, batteryState] = await Promise.all([
        Battery.getBatteryLevelAsync(),
        Battery.getBatteryStateAsync(),
      ]);

      this.level = batteryLevel;
      this.charging =
        batteryState === Battery.BatteryState.CHARGING ||
        batteryState === Battery.BatteryState.FULL;

      // Initial notifications
      this.notifyListeners();
    } catch (err) {
      console.error('[BatteryManager] Initialization error:', err);
    }
  }

  subscribe(callback: (tier: BatteryTier) => void): () => void {
    this.listeners.add(callback);
    callback(this.getTier()); // Run initial value immediately

    const levelSubscription = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      this.level = batteryLevel;
      this.notifyListeners();
    });

    const stateSubscription = Battery.addBatteryStateListener(({ batteryState }) => {
      this.charging =
        batteryState === Battery.BatteryState.CHARGING ||
        batteryState === Battery.BatteryState.FULL;
      this.notifyListeners();
    });

    return () => {
      this.listeners.delete(callback);
      levelSubscription.remove();
      stateSubscription.remove();
    };
  }

  private notifyListeners() {
    const currentTier = this.getTier();
    this.listeners.forEach((cb) => cb(currentTier));
  }

  getTier(): BatteryTier {
    if (this.charging) return 'normal';

    const percentage = this.level * 100;
    if (percentage < 15) return 'critical';
    if (percentage <= 30) return 'low';
    return 'normal';
  }

  shouldRunFeature(feature: 'voice' | 'accelerometer' | 'location' | 'sos'): boolean {
    const tier = this.getTier();

    if (feature === 'sos') return true; // SOS triggers are always enabled

    if (tier === 'critical') {
      // Disable voice, accelerometer, and location updates entirely (or run passive location only)
      if (feature === 'voice' || feature === 'accelerometer') return false;
      if (feature === 'location') return false; // Location stream off, only updates on manual SOS
    }

    return true;
  }

  getLocationInterval(): number {
    if (this.charging) return 5000;

    const percentage = this.level * 100;
    if (percentage < 15) return 30000; // 30s interval
    if (percentage <= 30) return 15000; // 15s interval
    return 5000; // 5s standard
  }

  getAccelerometerSampleRate(): number {
    if (this.charging) return 50;

    const percentage = this.level * 100;
    if (percentage < 15) return 0; // Disabled
    if (percentage <= 30) return 10; // 10Hz low-power mode
    return 50; // 50Hz normal mode
  }
}
