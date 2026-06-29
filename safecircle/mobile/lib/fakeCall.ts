import { documentDirectory, downloadAsync, getInfoAsync } from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export interface FakeCallScript {
  id: string;
  label: string;
  text: string;
}

export const DEFAULT_SCRIPTS: FakeCallScript[] = [
  {
    id: 'mom',
    label: 'Mom',
    text: "Hello? Are you okay? Where are you? I'm coming to pick you up right now.",
  },
  {
    id: 'friend',
    label: 'Friend',
    text: "Hey! Where are you? I'm already here at the restaurant, are you close?",
  },
  {
    id: 'boss',
    label: 'Boss',
    text: "Hi, I need you in the office now. Can you come immediately?",
  },
];

/**
 * Gets the local file URI for a cached script ID
 */
export function getCallerAudioUri(scriptId: string): string {
  return `${documentDirectory}fake_call_${scriptId}.mp3`;
}

/**
 * Downloads a TTS audio file from Google Translate TTS API and saves it locally
 */
export async function generateAudio(text: string, filename: string): Promise<string> {
  const fileUri = `${documentDirectory}${filename}`;
  try {
    const info = await getInfoAsync(fileUri);
    if (info.exists) {
      return fileUri;
    }

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
      text
    )}&tl=en&client=tw-ob`;

    const result = await downloadAsync(ttsUrl, fileUri);
    if (result.status !== 200) {
      throw new Error(`Failed to download audio, status code: ${result.status}`);
    }

    console.log(`[fakeCall] Audio saved to: ${fileUri}`);
    return fileUri;
  } catch (error) {
    console.error(`[fakeCall] generateAudio error for ${filename}:`, error);
    throw error;
  }
}

/**
 * Pre-generates and caches all three default scripts on app launch
 */
export async function preGenerateDefaultAudios(): Promise<void> {
  console.log('[fakeCall] Pre-generating default audio scripts...');
  try {
    for (const script of DEFAULT_SCRIPTS) {
      const filename = `fake_call_${script.id}.mp3`;
      await generateAudio(script.text, filename);
    }
    console.log('[fakeCall] All default scripts cached successfully!');
  } catch (error) {
    console.error('[fakeCall] Error pre-generating default audios:', error);
  }
}

/**
 * Schedules a local push notification that will launch the fake call screen
 */
export async function scheduleFakeCall(
  delaySeconds: number,
  callerName: string,
  avatarEmoji: string,
  scriptId: string
): Promise<string> {
  if (Platform.OS === 'web') {
    console.log(`[fakeCall Web Simulator] Will trigger fake call from ${callerName} in ${delaySeconds}s`);
    setTimeout(() => {
      const { router } = require('expo-router');
      router.push({
        pathname: '/fake-call',
        params: { callerName, avatar: avatarEmoji, scriptId }
      });
    }, delaySeconds * 1000);
    return 'web-fake-call-id';
  }

  try {
    // 1. Cancel any existing scheduled fake calls first
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notification of scheduled) {
      const data = notification.content.data;
      if (data && data.type === 'fake_call') {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }

    const title = `📞 Incoming Call`;
    const body = `${callerName} is calling...`;

    // 2. Determine trigger
    const trigger = delaySeconds > 0 ? { seconds: delaySeconds } : null;

    // 3. Schedule notification
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          type: 'fake_call',
          callerName,
          avatar: avatarEmoji,
          scriptId,
        },
        sound: Platform.OS === 'android' ? 'default' : undefined, // standard notification chime
      },
      trigger: trigger as any,
    });

    console.log(
      `[fakeCall] Scheduled fake call from ${callerName} in ${delaySeconds}s (id: ${identifier})`
    );
    return identifier;
  } catch (error) {
    console.error('[fakeCall] Error scheduling fake call:', error);
    throw error;
  }
}

/**
 * Cancels all currently scheduled fake calls
 */
export async function cancelAllFakeCalls(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notification of scheduled) {
      const data = notification.content.data;
      if (data && data.type === 'fake_call') {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }
    console.log('[fakeCall] Cancelled all scheduled fake calls');
  } catch (error) {
    console.error('[fakeCall] Error cancelling scheduled fake calls:', error);
  }
}
