import React, { useState, useEffect, useRef } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Audio } from 'expo-av';
import { router } from 'expo-router';
import { supabase } from './supabase';

const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND_NOTIFICATION_TASK';

// Configure Foreground Notification Behavior
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const type = notification.request.content.data?.type;
    const isEmergency = type === 'sos_alert';
    return {
      shouldShowAlert: isEmergency, // Emergency shows native system alert, others use custom banner
      shouldPlaySound: isEmergency,
      shouldSetBadge: true,
      shouldShowBanner: isEmergency,
      shouldShowList: isEmergency,
    };
  },
});

// Event emitter subscription logic for in-app banner trigger
type BannerListener = (data: { title: string; body: string; data: any } | null) => void;
let bannerListener: BannerListener | null = null;

export function registerBannerListener(listener: BannerListener) {
  bannerListener = listener;
}

export function showInAppBanner(title: string, body: string, data: any) {
  if (bannerListener) {
    bannerListener({ title, body, data });
  }
}

// Centralized Notifications Manager
export class NotificationsManager {
  static async registerForPushNotificationsAsync(userId: string) {
    if (Platform.OS === 'web') return null;

    // Set up Android notification channels
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('emergency', {
        name: 'Emergency Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF0000',
        sound: 'sos_alert.mp3', // Uses custom alert sound asset
      });

      await Notifications.setNotificationChannelAsync('general', {
        name: 'General Alerts',
        importance: Notifications.AndroidImportance.DEFAULT,
      });

      await Notifications.setNotificationChannelAsync('rewards', {
        name: 'Rewards & Milestones',
        importance: Notifications.AndroidImportance.LOW,
      });
    }

    // Check permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[Notifications] Permission not granted for push notifications.');
      return null;
    }

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: undefined, // Automatically resolved from app.json
      });
      const token = tokenData.data;

      // Save token to Supabase users profile
      const { error } = await supabase
        .from('users')
        .update({ fcm_token: token }) // Sync token
        .eq('id', userId);

      if (error) {
        console.error('[Notifications] Failed to sync token with Supabase:', error);
      } else {
        console.log('[Notifications] Push token synced successfully:', token);
      }

      return token;
    } catch (err) {
      console.error('[Notifications] Error retrieving Expo push token:', err);
      return null;
    }
  }

  static setupNotificationListeners() {
    // 1. Listen for notification received while app is in foreground
    const foregroundSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body, data } = notification.request.content;
      const type = data?.type;

      // Show custom in-app banner for non-emergency notifications
      if (type && type !== 'sos_alert') {
        showInAppBanner(title || 'SafeCircle Alert', body || '', data);
      }
    });

    // 2. Listen for notification clicks (Deep Linking)
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      NotificationsManager.handleNotificationRoute(data);
    });

    return () => {
      foregroundSubscription.remove();
      responseSubscription.remove();
    };
  }

  static handleNotificationRoute(data: any) {
    if (!data || !data.type) return;

    switch (data.type) {
      case 'sos_alert':
        if (data.sos_id) {
          router.push({
            pathname: '/volunteer-alert',
            params: { sos_id: data.sos_id },
          });
        }
        break;
      case 'volunteer_accepted':
        router.push('/sos-active');
        break;
      case 'volunteer_arrived':
        // Show rating modal - redirect to main dashboard or trigger modal
        router.push('/(tabs)/home');
        break;
      case 'zone_warning':
        router.push('/(tabs)/map');
        break;
      case 'credit_awarded':
        router.push('/credits-history');
        break;
      case 'badge_earned':
        router.push('/(tabs)/profile');
        break;
      case 'fake_call':
        router.push({
          pathname: '/fake-call',
          params: {
            mode: 'ringing',
            callerName: data.callerName,
            avatar: data.avatar,
            scriptId: data.scriptId,
          },
        });
        break;
      default:
        console.log('[Notifications] Unhandled deep link payload:', data);
        break;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Define Background Notification Task (expo-task-manager)
// ─────────────────────────────────────────────────────────────
export function defineBackgroundNotificationTask() {
  if (TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) return;

  TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error('[Notifications Background] Task error:', error);
      return;
    }

    const payload = (data as any)?.notification?.request?.content?.data;
    if (payload && payload.type === 'sos_alert') {
      console.log('[Notifications Background] Play emergency SOS alert siren.');
      try {
        const { sound } = await Audio.Sound.createAsync(
          require('../assets/sos_alert.mp3'),
          { shouldPlay: true, volume: 1.0 }
        );
        // Play full length of clip
        await new Promise((resolve) => setTimeout(resolve, 8000));
        await sound.unloadAsync();
      } catch (err) {
        console.error('[Notifications Background] Sound play failed:', err);
      }
    }
  });

  Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch((err) => {
    console.error('[Notifications] Failed to register background task:', err);
  });
}

// ─────────────────────────────────────────────────────────────
// Custom Slide-Down In-App Notification Banner Component
// ─────────────────────────────────────────────────────────────
const { width } = Dimensions.get('window');

export function InAppBanner() {
  const [banner, setBanner] = useState<{ title: string; body: string; data: any } | null>(null);
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const dismissTimeout = useRef<any>(null);

  useEffect(() => {
    registerBannerListener((data) => {
      if (data) {
        // Clear previous timers if a new banner arrives
        if (dismissTimeout.current) clearTimeout(dismissTimeout.current);

        setBanner(data);

        // Slide down
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 40,
          friction: 8,
        }).start();

        // Dismiss after 4 seconds
        dismissTimeout.current = setTimeout(() => {
          dismissBanner();
        }, 4000);
      }
    });

    return () => {
      registerBannerListener(() => {});
      if (dismissTimeout.current) clearTimeout(dismissTimeout.current);
    };
  }, []);

  const dismissBanner = () => {
    Animated.timing(slideAnim, {
      toValue: -120,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setBanner(null);
    });
  };

  const handlePress = () => {
    if (banner) {
      NotificationsManager.handleNotificationRoute(banner.data);
      dismissBanner();
    }
  };

  if (!banner) return null;

  return (
    <Animated.View style={[styles.bannerContainer, { transform: [{ translateY: slideAnim }] }]}>
      <TouchableOpacity style={styles.banner} onPress={handlePress} activeOpacity={0.9}>
        <View style={styles.iconCircle}>
          <Text style={styles.bannerIcon}>
            {banner.data?.type === 'credit_awarded' ? '💰' : banner.data?.type === 'badge_earned' ? '🏅' : '🔔'}
          </Text>
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {banner.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {banner.body}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  banner: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  bannerIcon: {
    fontSize: 20,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  body: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
  },
});

// ─────────────────────────────────────────────────────────────
// Compatibility Helpers for Local and Welcome Notifications
// ─────────────────────────────────────────────────────────────
export async function sendLocalNotification(title: string, body: string, data?: any) {
  if (Platform.OS === 'web') {
    console.log('[Notifications Bypass] Local notification:', title, body);
    return;
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data || {},
    },
    trigger: null,
  });
}

export async function sendVerificationWelcomeNotification() {
  await sendLocalNotification(
    "🏅 Identity Verified!",
    "Congratulations! You are now a verified SafeCircle responder. We've awarded you +50 SafeCircle Credits!",
    { type: 'credit_awarded' }
  );
}

