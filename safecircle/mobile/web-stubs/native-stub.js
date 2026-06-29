/**
 * web-stubs/native-stub.js
 * ─────────────────────────
 * Empty stub for native-only packages when bundling for web.
 * All exports return no-op functions or null values so the
 * web bundle compiles without errors.
 */

module.exports = new Proxy(
  {
    // Common default exports
    default: null,
    // Common named exports as no-ops
    start: async () => {},
    stop: async () => {},
    destroy: async () => {},
    isAvailableAsync: async () => false,
    getBatteryLevelAsync: async () => 1.0,
    getBatteryStateAsync: async () => 1,
    addBatteryLevelListener: () => ({ remove: () => {} }),
    addBatteryStateListener: () => ({ remove: () => {} }),
    requestPermissionsAsync: async () => ({ status: 'denied' }),
    defineTask: () => {},
    registerTaskAsync: async () => {},
    unregisterTaskAsync: async () => {},
    isTaskRegisteredAsync: async () => false,
    impactAsync: async () => {},
    notificationAsync: async () => {},
    selectionAsync: async () => {},
    ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
    NotificationFeedbackType: { Success: 'Success', Warning: 'Warning', Error: 'Error' },
    BatteryState: { UNKNOWN: 0, UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
    // Speech
    speak: () => {},
    isSpeakingAsync: async () => false,
    // File system
    readAsStringAsync: async () => '',
    writeAsStringAsync: async () => {},
    EncodingType: { Base64: 'base64', UTF8: 'utf8' },
    // Camera
    Camera: null,
    CameraType: { front: 'front', back: 'back' },
    // TFLite
    loadTensorflowModel: async () => null,
    // Voice
    Voice: null,
    // Sensors (expo-sensors)
    Accelerometer: {
      setUpdateInterval: () => {},
      addListener: () => ({ remove: () => {} }),
      removeAllListeners: () => {},
    },
    Gyroscope: {
      setUpdateInterval: () => {},
      addListener: () => ({ remove: () => {} }),
      removeAllListeners: () => {},
    },
    Magnetometer: {
      setUpdateInterval: () => {},
      addListener: () => ({ remove: () => {} }),
      removeAllListeners: () => {},
    },
    Barometer: {
      setUpdateInterval: () => {},
      addListener: () => ({ remove: () => {} }),
      removeAllListeners: () => {},
    },
    Pedometer: {
      isAvailableAsync: async () => false,
      watchStepCount: () => ({ remove: () => {} }),
    },
  },
  {
    // Any property not listed above returns a no-op function
    get: (target, prop) => {
      if (prop in target) return target[prop];
      if (prop === '__esModule') return true;
      return () => {};
    },
  }
);
