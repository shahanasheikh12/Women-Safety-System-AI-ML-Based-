import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Colors from '../constants/Colors';

interface SOSButtonProps {
  onPress: () => void;
  onLongPress: () => void;   // silent SOS
  disabled?: boolean;
}

export function SOSButton({ onPress, onLongPress, disabled = false }: SOSButtonProps) {
  const pulseScale  = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;
  const pressScale  = useRef(new Animated.Value(1)).current;

  // ── Continuous pulse animation ──────────────────────────────
  useEffect(() => {
    if (disabled) {
      pulseScale.setValue(1);
      pulseOpacity.setValue(0);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 1.18,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.5,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [disabled]);

  // ── Button core scale animation ─────────────────────────────
  const handlePressIn = () => {
    Animated.spring(pressScale, {
      toValue: 0.94,
      useNativeDriver: true,
      speed: 30,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(pressScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
    }).start();
  };

  if (disabled) {
    return (
      <View style={styles.wrapper}>
        <View style={[styles.button, styles.buttonDisabled]}>
          <Text style={styles.labelDisabled}>SOS{'\n'}Disabled</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {/* Outer ripple ring */}
      <Animated.View
        style={[
          styles.ripple,
          {
            transform: [{ scale: pulseScale }],
            opacity: pulseOpacity,
          },
        ]}
      />

      {/* Middle glow ring */}
      <Animated.View
        style={[
          styles.glowRing,
          {
            transform: [{ scale: Animated.multiply(pulseScale, 0.92) }],
            opacity: Animated.multiply(pulseOpacity, 1.4),
          },
        ]}
      />

      {/* The button itself */}
      <Animated.View style={{ transform: [{ scale: pressScale }] }}>
        <TouchableOpacity
          style={styles.button}
          onPress={onPress}
          onLongPress={onLongPress}
          delayLongPress={2000}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={1}
          accessibilityLabel="SOS Emergency Button"
          accessibilityHint="Press to start emergency SOS. Hold 2 seconds for silent mode."
          accessibilityRole="button"
        >
          {/* Inner highlight arc */}
          <View style={styles.innerHighlight} />

          <Text style={styles.label}>SOS</Text>
          <Text style={styles.labelSub}>HOLD FOR SILENT</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const BTN_SIZE = 200;

const styles = StyleSheet.create({
  wrapper: {
    width: BTN_SIZE + 80,
    height: BTN_SIZE + 80,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Ripple rings
  ripple: {
    position: 'absolute',
    width: BTN_SIZE + 60,
    height: BTN_SIZE + 60,
    borderRadius: (BTN_SIZE + 60) / 2,
    backgroundColor: Colors.primary,
    opacity: 0.3,
  },
  glowRing: {
    position: 'absolute',
    width: BTN_SIZE + 28,
    height: BTN_SIZE + 28,
    borderRadius: (BTN_SIZE + 28) / 2,
    backgroundColor: Colors.primary,
    opacity: 0.2,
  },

  // Main button
  button: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    // Multi-layer glow shadow
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 20,
    elevation: 14,
  },
  buttonDisabled: {
    backgroundColor: '#3A3A3A',
    shadowOpacity: 0,
    elevation: 0,
  },

  // Inner top highlight (gives 3D depth)
  innerHighlight: {
    position: 'absolute',
    top: 16,
    left: 30,
    right: 30,
    height: BTN_SIZE * 0.35,
    borderRadius: BTN_SIZE,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  label: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 3,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  labelSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 4,
  },
  labelDisabled: {
    color: '#666',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 26,
  },
});

export default SOSButton;
