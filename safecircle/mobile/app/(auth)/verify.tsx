import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  StatusBar,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 30;

export default function VerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendTimer, setResendTimer] = useState(RESEND_COOLDOWN);
  const [canResend, setCanResend] = useState(false);

  const inputRefs = useRef<(TextInput | null)[]>([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  // Entry animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start(() => {
      // Auto-focus first box
      inputRefs.current[0]?.focus();
    });
  }, []);

  // Resend countdown
  useEffect(() => {
    if (resendTimer <= 0) { setCanResend(true); return; }
    const t = setInterval(() => setResendTimer((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [resendTimer]);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 12, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  // ── Verify OTP ────────────────────────────────────────────
  const verifyOTP = useCallback(async (code: string) => {
    if (code.length < OTP_LENGTH) return;
    setLoading(true);
    setError('');

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      phone: phone ?? '',
      token: code,
      type: 'sms',
    });

    setLoading(false);

    if (verifyError) {
      setError('Incorrect OTP. Please try again.');
      shake();
      setOtp(Array(OTP_LENGTH).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
      return;
    }

    if (data?.user) {
      // Check if profile exists
      const { data: profile } = await supabase
        .from('users')
        .select('name')
        .eq('id', data.user.id)
        .single();

      if (!profile?.name) {
        // New user — collect profile
        router.replace('/(auth)/profile-setup');
      } else {
        // Existing user — go home
        router.replace('/(tabs)/home');
      }
    }
  }, [phone]);

  // ── OTP box handlers ───────────────────────────────────────
  const handleChange = (text: string, index: number) => {
    const digit = text.replace(/\D/g, '').slice(-1);
    const updated = [...otp];
    updated[index] = digit;
    setOtp(updated);
    setError('');

    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when last digit entered
    if (digit && index === OTP_LENGTH - 1) {
      const code = [...updated.slice(0, OTP_LENGTH - 1), digit].join('');
      if (code.length === OTP_LENGTH) verifyOTP(code);
    }
  };

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // ── Resend OTP ─────────────────────────────────────────────
  const handleResend = async () => {
    if (!canResend) return;
    setCanResend(false);
    setResendTimer(RESEND_COOLDOWN);
    setOtp(Array(OTP_LENGTH).fill(''));
    setError('');

    await supabase.auth.signInWithOtp({ phone: phone ?? '' });
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  };

  const maskedPhone = phone
    ? `${phone.slice(0, 3)}${'•'.repeat(phone.length - 6)}${phone.slice(-3)}`
    : '';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Back button */}
      <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.7}>
        <Text style={styles.backText}>←  Back</Text>
      </TouchableOpacity>

      <Animated.View
        style={[
          styles.content,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Header */}
        <Text style={styles.shield}>🛡️</Text>
        <Text style={styles.heading}>Enter the 6-digit OTP</Text>
        <Text style={styles.subheading}>
          Sent to{' '}
          <Text style={styles.phoneHighlight}>{maskedPhone || phone}</Text>
        </Text>

        {/* OTP input boxes */}
        <Animated.View
          style={[styles.otpRow, { transform: [{ translateX: shakeAnim }] }]}
        >
          {otp.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => { inputRefs.current[index] = ref; }}
              style={[
                styles.otpBox,
                digit ? styles.otpBoxFilled : null,
                error ? styles.otpBoxError : null,
              ]}
              value={digit}
              onChangeText={(t) => handleChange(t, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              selectionColor={Colors.primary}
              caretHidden
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
            />
          ))}
        </Animated.View>

        {/* Error */}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️  {error}</Text>
          </View>
        ) : null}

        {/* Loading indicator */}
        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={Colors.primary} size="small" />
            <Text style={styles.loadingText}>  Verifying…</Text>
          </View>
        )}

        {/* Verify button (manual) */}
        <TouchableOpacity
          style={[styles.ctaButton, (loading || otp.join('').length < OTP_LENGTH) && styles.ctaDisabled]}
          onPress={() => verifyOTP(otp.join(''))}
          disabled={loading || otp.join('').length < OTP_LENGTH}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>Verify OTP ✓</Text>
          )}
        </TouchableOpacity>

        {/* Resend */}
        <TouchableOpacity
          style={[styles.resendBtn, !canResend && styles.resendDisabled]}
          onPress={handleResend}
          disabled={!canResend}
          activeOpacity={canResend ? 0.7 : 1}
        >
          <Text style={[styles.resendText, !canResend && styles.resendTextDisabled]}>
            {canResend ? 'Resend OTP' : `Resend OTP in ${resendTimer}s`}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  back: {
    alignSelf: 'flex-start',
    marginBottom: 32,
    paddingVertical: 4,
  },
  backText: {
    color: Colors.textMuted,
    fontSize: 16,
    fontWeight: '500',
  },
  content: {
    flex: 1,
    alignItems: 'center',
  },
  shield: {
    fontSize: 52,
    marginBottom: 20,
  },
  heading: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subheading: {
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 40,
    textAlign: 'center',
  },
  phoneHighlight: {
    color: Colors.accent,
    fontWeight: '700',
  },

  // OTP boxes
  otpRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  otpBox: {
    width: 46,
    height: 58,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2A2A3E',
    backgroundColor: Colors.surface,
    color: Colors.text,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  otpBoxFilled: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(192,57,43,0.12)',
  },
  otpBoxError: {
    borderColor: '#FF4444',
    backgroundColor: 'rgba(255,68,68,0.08)',
  },

  // Error
  errorBox: {
    backgroundColor: 'rgba(192,57,43,0.15)',
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 20,
    width: '100%',
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },

  // Loading
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
  },

  // CTA
  ctaButton: {
    backgroundColor: Colors.primary,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  ctaDisabled: {
    opacity: 0.45,
  },
  ctaText: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // Resend
  resendBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  resendDisabled: {
    opacity: 0.5,
  },
  resendText: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  resendTextDisabled: {
    color: Colors.textMuted,
  },
});
