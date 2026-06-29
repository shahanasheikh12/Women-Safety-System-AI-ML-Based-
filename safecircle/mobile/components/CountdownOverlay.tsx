import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import Colors from '../constants/Colors';

interface CountdownOverlayProps {
  visible: boolean;
  countdown: number;        // 3, 2, 1 — passed from useSOS
  isSilent: boolean;
  onCancel: () => void;
  onCountdownEnd?: () => void;  // optional callback when 0 reached from outside
}

// ──────────────────────────────────────────────────────────────
// Shake detection config
// ──────────────────────────────────────────────────────────────
const SHAKE_THRESHOLD = 2.5;
const SHAKE_CONSECUTIVE = 3;

export function CountdownOverlay({
  visible,
  countdown,
  isSilent,
  onCancel,
}: CountdownOverlayProps) {
  const [showCancelled, setShowCancelled] = useState(false);

  // Animation refs
  const numberScale    = useRef(new Animated.Value(1.4)).current;
  const numberOpacity  = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cancelScale    = useRef(new Animated.Value(1)).current;
  const ringScale      = useRef(new Animated.Value(0.8)).current;

  // Shake detection
  const shakeCount = useRef(0);
  const accelSub   = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);

  // ── Entry animation ─────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setShowCancelled(false);
      Animated.parallel([
        Animated.timing(overlayOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(cancelScale, { toValue: 1, useNativeDriver: true, speed: 12 }),
      ]).start();
      startShakeDetection();
    } else {
      Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      stopShakeDetection();
    }

    return () => stopShakeDetection();
  }, [visible]);

  // ── Haptic + number animation on each countdown tick ────────
  useEffect(() => {
    if (!visible) return;

    // Heavy haptic on each tick
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});

    // Number pop animation
    numberScale.setValue(1.6);
    numberOpacity.setValue(0);

    Animated.parallel([
      Animated.spring(numberScale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 18,
        bounciness: 10,
      }),
      Animated.timing(numberOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    // Ring pulse on each tick
    ringScale.setValue(0.7);
    Animated.spring(ringScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 10,
      bounciness: 8,
    }).start();
  }, [countdown, visible]);

  // ── Shake detection during countdown ───────────────────────
  const startShakeDetection = () => {
    shakeCount.current = 0;
    Accelerometer.setUpdateInterval(100);
    accelSub.current = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (magnitude > SHAKE_THRESHOLD) {
        shakeCount.current += 1;
        if (shakeCount.current >= SHAKE_CONSECUTIVE) {
          shakeCount.current = 0;
          handleCancel(true);
        }
      } else {
        shakeCount.current = 0;
      }
    });
  };

  const stopShakeDetection = () => {
    accelSub.current?.remove();
    accelSub.current = null;
  };

  // ── Cancel handler ──────────────────────────────────────────
  const handleCancel = (fromShake = false) => {
    stopShakeDetection();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setShowCancelled(true);
    onCancel();

    // Show "cancelled" toast briefly
    setTimeout(() => setShowCancelled(false), 1800);
  };

  const handleCancelPress = () => handleCancel(false);

  // ── Countdown color shifts: 3=yellow, 2=orange, 1=red ──────
  const countdownColor = countdown === 3
    ? '#F4D03F'
    : countdown === 2
    ? Colors.warning
    : '#FF3B30';

  const modeLabel = isSilent ? '🔇  SILENT SOS ACTIVATING' : '🚨  SOS ACTIVATING';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleCancelPress}
    >
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>

        {/* Mode label */}
        <Animated.Text style={[styles.modeLabel, { opacity: overlayOpacity }]}>
          {modeLabel}
        </Animated.Text>

        {/* Ring around countdown */}
        <Animated.View
          style={[
            styles.countdownRing,
            { borderColor: countdownColor, transform: [{ scale: ringScale }] },
          ]}
        />

        {/* Giant countdown number */}
        <Animated.Text
          style={[
            styles.countdownNumber,
            { color: countdownColor, transform: [{ scale: numberScale }], opacity: numberOpacity },
          ]}
        >
          {countdown}
        </Animated.Text>

        {/* Sub label */}
        <Text style={styles.tapCancel}>
          {countdown === 1 ? 'Sending SOS…' : 'Tap below to cancel'}
        </Text>

        {/* Cancel button */}
        <Animated.View style={[styles.cancelWrapper, { transform: [{ scale: cancelScale }] }]}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancelPress}
            activeOpacity={0.8}
            accessibilityLabel="Cancel SOS"
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>✕  CANCEL SOS</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Shake hint */}
        <Text style={styles.shakeHint}>Or shake your phone to cancel</Text>

        {/* Cancelled toast */}
        {showCancelled && (
          <View style={styles.cancelledToast}>
            <Text style={styles.cancelledText}>✓  SOS Cancelled</Text>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },

  // Mode label
  modeLabel: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 32,
    textAlign: 'center',
  },

  // Ring
  countdownRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 3,
    borderColor: Colors.primary,
    opacity: 0.5,
  },

  // Number
  countdownNumber: {
    fontSize: 130,
    fontWeight: '900',
    lineHeight: 150,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
  },

  tapCancel: {
    color: Colors.textMuted,
    fontSize: 13,
    marginTop: 12,
    marginBottom: 48,
    letterSpacing: 0.5,
  },

  // Cancel button
  cancelWrapper: {
    width: '100%',
  },
  cancelButton: {
    height: 64,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: Colors.secondary,
    backgroundColor: 'rgba(146,43,33,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  cancelText: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.5,
  },

  shakeHint: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },

  // Cancelled toast
  cancelledToast: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    backgroundColor: Colors.safe,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 30,
  },
  cancelledText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});

export default CountdownOverlay;
