import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Image } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';

export default function SplashScreen() {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. Run fade-in animations
    Animated.sequence([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Perform background checks and transition after 2.2 seconds
    const performRedirect = async () => {
      try {
        // Wait for visual splash effect to complete
        await new Promise((resolve) => setTimeout(resolve, 2200));

        // Check if user has seen onboarding
        const seenOnboarding = await AsyncStorage.getItem('has_seen_onboarding');
        const hasSeenOnboarding = seenOnboarding === 'true';

        if (!hasSeenOnboarding) {
          router.replace('/onboarding');
          return;
        }

        // Check active login session
        const { data } = await supabase.auth.getSession();
        const hasSession = !!data.session;

        if (hasSession) {
          router.replace('/(tabs)/home');
        } else {
          router.replace('/(auth)/login');
        }
      } catch (err) {
        console.error('[Splash] Check failed, falling back to login:', err);
        router.replace('/(auth)/login');
      }
    };

    performRedirect();
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.logoContainer, { opacity: logoOpacity }]}>
        <Text style={styles.logoIcon}>🛡️</Text>
        <Text style={styles.logoTitle}>SafeCircle</Text>
      </Animated.View>

      <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
        Your circle of safety
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D', // Dark premium background
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logoIcon: {
    fontSize: 82,
    marginBottom: 12,
  },
  logoTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 15,
    fontWeight: '600',
    color: '#94A3B8',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 8,
  },
});
