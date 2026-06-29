import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';

const { height } = Dimensions.get('window');

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Animations
  const logoAnim   = useRef(new Animated.Value(0)).current;
  const formAnim   = useRef(new Animated.Value(40)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const errorShake  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(logoAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(formAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(formOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const shakeError = () => {
    Animated.sequence([
      Animated.timing(errorShake, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleSendOTP = async () => {
    setError('');

    if (phone.length !== 10 || !/^\d{10}$/.test(phone)) {
      setError('Please enter a valid 10-digit phone number.');
      shakeError();
      return;
    }

    const fullPhone = `+91${phone}`;
    setLoading(true);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: fullPhone,
    });

    setLoading(false);

    if (otpError) {
      setError(otpError.message || 'Failed to send OTP. Try again.');
      shakeError();
    } else {
      router.push({ pathname: '/(auth)/verify', params: { phone: fullPhone } });
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Hero section ── */}
      <Animated.View style={[styles.hero, { opacity: logoAnim, transform: [{ scale: logoAnim }] }]}>
        <View style={styles.shieldContainer}>
          <Text style={styles.shieldEmoji}>🛡️</Text>
          <View style={styles.shieldGlow} />
        </View>
        <Text style={styles.appName}>SafeCircle</Text>
        <Text style={styles.tagline}>Your circle of safety, always nearby</Text>
      </Animated.View>

      {/* ── Form ── */}
      <Animated.View
        style={[
          styles.form,
          {
            opacity: formOpacity,
            transform: [
              { translateY: formAnim },
              { translateX: errorShake },
            ],
          },
        ]}
      >
        <Text style={styles.label}>Enter your phone number</Text>

        {/* Phone input row */}
        <View style={styles.phoneRow}>
          <View style={styles.prefix}>
            <Text style={styles.prefixText}>🇮🇳  +91</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="9876543210"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            maxLength={10}
            value={phone}
            onChangeText={(t) => { setPhone(t.replace(/\D/g, '')); setError(''); }}
            selectionColor={Colors.primary}
          />
        </View>

        {/* Error message */}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️  {error}</Text>
          </View>
        ) : null}

        {/* Send OTP button */}
        <TouchableOpacity
          style={[styles.ctaButton, loading && styles.ctaDisabled]}
          onPress={handleSendOTP}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>Send OTP →</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.privacy}>
          By continuing you agree to our{' '}
          <Text style={styles.privacyLink}>Privacy Policy</Text>
        </Text>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: height * 0.08,
    paddingBottom: 40,
  },

  // Hero
  hero: {
    alignItems: 'center',
    marginBottom: 20,
  },
  shieldContainer: {
    position: 'relative',
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldEmoji: {
    fontSize: 80,
  },
  shieldGlow: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.primary,
    opacity: 0.15,
  },
  appName: {
    fontSize: 38,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: 1,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Form
  form: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  label: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },

  // Phone input
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
  },
  prefix: {
    backgroundColor: '#12122A',
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRightWidth: 1,
    borderRightColor: '#2A2A3E',
  },
  prefixText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    color: Colors.text,
    fontSize: 20,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 18,
    letterSpacing: 2,
  },

  // Error
  errorBox: {
    backgroundColor: 'rgba(192,57,43,0.15)',
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 13,
    fontWeight: '500',
  },

  // CTA
  ctaButton: {
    backgroundColor: Colors.primary,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Privacy
  privacy: {
    color: Colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  privacyLink: {
    color: Colors.accent,
    textDecorationLine: 'underline',
  },
});
