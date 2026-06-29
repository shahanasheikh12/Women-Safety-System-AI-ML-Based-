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
  ScrollView,
  StatusBar,
  Switch,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';

type Gender = 'female' | 'male' | 'other';

export default function ProfileSetupScreen() {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [isVolunteer, setIsVolunteer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Animations
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleComplete = async () => {
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (!gender)       { setError('Please select your gender.'); return; }

    setError('');
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { error: upsertError } = await supabase.from('users').upsert({
      id: user.id,
      phone: user.phone ?? '',
      name: name.trim(),
      gender,
      is_volunteer: isVolunteer,
    });

    setLoading(false);

    if (upsertError) {
      setError(upsertError.message || 'Failed to save profile. Try again.');
    } else {
      router.replace('/(tabs)/home');
    }
  };

  const GENDERS: { key: Gender; label: string; icon: string }[] = [
    { key: 'female', label: 'Female', icon: '♀' },
    { key: 'male',   label: 'Male',   icon: '♂' },
    { key: 'other',  label: 'Other',  icon: '⚥' },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          style={[
            styles.inner,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.emoji}>✨</Text>
            <Text style={styles.heading}>Set up your SafeCircle profile</Text>
            <Text style={styles.subheading}>
              This helps volunteers know who to look for in an emergency.
            </Text>
          </View>

          {/* ── Name ── */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Your Name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Priya Sharma"
              placeholderTextColor={Colors.textMuted}
              value={name}
              onChangeText={(t) => { setName(t); setError(''); }}
              autoCapitalize="words"
              returnKeyType="done"
              selectionColor={Colors.primary}
            />
          </View>

          {/* ── Gender ── */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.genderRow}>
              {GENDERS.map(({ key, label, icon }) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.genderPill,
                    gender === key && styles.genderPillActive,
                  ]}
                  onPress={() => { setGender(key); setError(''); }}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.genderIcon,
                      gender === key && styles.genderTextActive,
                    ]}
                  >
                    {icon}
                  </Text>
                  <Text
                    style={[
                      styles.genderLabel,
                      gender === key && styles.genderTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Volunteer toggle ── */}
          <View style={styles.volunteerCard}>
            <View style={styles.volunteerTextBlock}>
              <Text style={styles.volunteerTitle}>
                🤝  Become a volunteer helper
              </Text>
              <Text style={styles.volunteerDesc}>
                When someone nearby triggers SOS, you'll receive an alert
                to assist them. Earn credits for every successful response.
              </Text>
            </View>
            <Switch
              value={isVolunteer}
              onValueChange={setIsVolunteer}
              trackColor={{ false: '#2A2A3E', true: Colors.safe }}
              thumbColor={isVolunteer ? '#fff' : Colors.textMuted}
            />
          </View>

          {/* ── Error ── */}
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️  {error}</Text>
            </View>
          ) : null}

          {/* ── CTA ── */}
          <TouchableOpacity
            style={[styles.ctaButton, loading && styles.ctaDisabled]}
            onPress={handleComplete}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>Complete Setup →</Text>
            )}
          </TouchableOpacity>

          {/* Volunteer badge preview */}
          {isVolunteer && (
            <Animated.View style={styles.badgePreview}>
              <Text style={styles.badgeEmoji}>🏅</Text>
              <Text style={styles.badgeText}>
                You'll be listed as a SafeCircle Volunteer!
              </Text>
            </Animated.View>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 40,
  },
  inner: {
    flex: 1,
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: 36,
  },
  emoji: {
    fontSize: 52,
    marginBottom: 14,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 32,
    marginBottom: 10,
  },
  subheading: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Field group
  fieldGroup: {
    marginBottom: 24,
  },
  fieldLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  textInput: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
    color: Colors.text,
    fontSize: 16,
    fontWeight: '500',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },

  // Gender pills
  genderRow: {
    flexDirection: 'row',
    gap: 10,
  },
  genderPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
    backgroundColor: Colors.surface,
  },
  genderPillActive: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(192,57,43,0.15)',
  },
  genderIcon: {
    fontSize: 18,
    color: Colors.textMuted,
  },
  genderLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  genderTextActive: {
    color: Colors.text,
  },

  // Volunteer card
  volunteerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
    marginBottom: 24,
    gap: 14,
  },
  volunteerTextBlock: {
    flex: 1,
  },
  volunteerTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  volunteerDesc: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
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
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  ctaDisabled: {
    opacity: 0.5,
  },
  ctaText: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // Badge preview
  badgePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(30,132,73,0.15)',
    borderWidth: 1,
    borderColor: Colors.safe,
    borderRadius: 12,
    padding: 14,
  },
  badgeEmoji: {
    fontSize: 24,
  },
  badgeText: {
    flex: 1,
    color: Colors.safe,
    fontSize: 13,
    fontWeight: '600',
  },
});
