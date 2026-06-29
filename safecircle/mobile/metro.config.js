const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// ── Asset extensions ─────────────────────────────────────────
config.resolver.assetExts.push('tflite');

// ── Web stubs for native-only packages ───────────────────────
// When bundling for web, replace native-only modules with empty stubs
// so the bundle compiles without errors.
const nativeStub = path.resolve(__dirname, 'web-stubs/native-stub.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    const nativeOnlyPackages = [
      '@react-native-voice/voice',
      'react-native-fast-tflite',
      'expo-haptics',
      'expo-battery',
      'expo-camera',
      'expo-task-manager',
      'expo-background-fetch',
      'expo-keep-awake',
      'expo-speech',
      'expo-file-system/legacy',
      'expo-sensors',
    ];
    if (nativeOnlyPackages.some(pkg => moduleName === pkg || moduleName.startsWith(pkg + '/'))) {
      return { filePath: nativeStub, type: 'sourceFile' };
    }
  }
  // Default resolution
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
