import React, { useEffect, useState } from 'react';
import { router, Slot, useSegments } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';

// ─────────────────────────────────────────────────────────────
// Native-only background tasks — skip on web to avoid bundle errors
// ─────────────────────────────────────────────────────────────
if (Platform.OS !== 'web') {
  // Dynamic require so Metro doesn't try to resolve native deps on web
  const { defineBackgroundSOSTask } = require('../lib/powerButtonSOS');
  const { defineBackgroundAccelerometerTask } = require('../lib/accelerometerAnomalyDetector');
  const { defineBackgroundNotificationTask } = require('../lib/notifications');
  defineBackgroundSOSTask();
  defineBackgroundAccelerometerTask();
  defineBackgroundNotificationTask();
}

// On web, import a lightweight stub for InAppBanner & NotificationsManager
import {
  NotificationsManager,
  InAppBanner,
} from '../lib/notifications';

import { PERMISSIONS_DONE_KEY } from './permissions';

// ─────────────────────────────────────────────────────────────
// Auth + permissions guard
// ─────────────────────────────────────────────────────────────
function useProtectedRoute(
  session: boolean | null,
  permsDone: boolean | null,
  hasSeenOnboarding: boolean | null
) {
  const segments = useSegments();
  const isNavigating = React.useRef(false);

  useEffect(() => {
    if (session === null || permsDone === null || hasSeenOnboarding === null) return;
    if (isNavigating.current) return; // prevent double-fire

    const segs = segments as string[];
    const inSplash = segs.length === 0 || segs[0] === '' || segs[0] === 'index' || segs[0] === undefined;
    if (inSplash) return;

    const inAuthGroup   = segments[0] === '(auth)';
    const inPermsScreen = segments[0] === 'permissions';
    const inOnboarding  = segments[0] === 'onboarding';

    if (!hasSeenOnboarding) {
      if (!inOnboarding) {
        isNavigating.current = true;
        router.replace('/onboarding');
        setTimeout(() => { isNavigating.current = false; }, 500);
      }
      return;
    }

    if (!session && !inAuthGroup) {
      isNavigating.current = true;
      router.replace('/(auth)/login');
      setTimeout(() => { isNavigating.current = false; }, 500);
    } else if (session && !permsDone && !inPermsScreen) {
      isNavigating.current = true;
      router.replace('/permissions');
      setTimeout(() => { isNavigating.current = false; }, 500);
    } else if (session && permsDone && (inAuthGroup || inPermsScreen || inOnboarding)) {
      isNavigating.current = true;
      router.replace('/(tabs)/home');
      setTimeout(() => { isNavigating.current = false; }, 500);
    }
  }, [session, permsDone, hasSeenOnboarding, segments]);
}

export default function RootLayout() {
  const [session,           setSession]           = useState<boolean | null>(null);
  const [permsDone,         setPermsDone]          = useState<boolean | null>(null);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    // Check initial auth session
    supabase.auth.getSession().then(({ data }) => {
      setSession(!!data.session);
      if (data.session?.user?.id && Platform.OS !== 'web') {
        NotificationsManager.registerForPushNotificationsAsync(data.session.user.id);
      }
    });

    // Listen to auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(!!sess);
      if (sess?.user?.id && Platform.OS !== 'web') {
        NotificationsManager.registerForPushNotificationsAsync(sess.user.id);
      }
    });

    // Check permissions
    AsyncStorage.getItem(PERMISSIONS_DONE_KEY).then((val) => {
      setPermsDone(Platform.OS === 'web' ? true : !!val);
    });

    // Check onboarding
    AsyncStorage.getItem('has_seen_onboarding').then((val) => {
      setHasSeenOnboarding(val === 'true');
    });

    // Pre-generate TTS audio (native only)
    if (Platform.OS !== 'web') {
      const { preGenerateDefaultAudios } = require('../lib/fakeCall');
      preGenerateDefaultAudios();
    }

    // Notification listeners (native only)
    let unsubscribeNotifications: (() => void) | undefined;
    if (Platform.OS !== 'web') {
      unsubscribeNotifications = NotificationsManager.setupNotificationListeners();
    }

    return () => {
      listener.subscription.unsubscribe();
      if (unsubscribeNotifications) unsubscribeNotifications();
    };
  }, []);

  useProtectedRoute(session, permsDone, hasSeenOnboarding);

  if (session === null || permsDone === null || hasSeenOnboarding === null) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Slot />
      {Platform.OS !== 'web' && <InAppBanner />}
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
