import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Animated,
  Dimensions,
  Alert,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Audio } from 'expo-av';
import { getInfoAsync } from 'expo-file-system/legacy';
import Colors from '../constants/Colors';
import {
  DEFAULT_SCRIPTS,
  scheduleFakeCall,
  getCallerAudioUri,
  cancelAllFakeCalls,
} from '../lib/fakeCall';

const { width, height } = Dimensions.get('window');

const EMOJI_AVATARS = ['👩', '👨', '👵', '👴', '💼', '📞', '🤫', '👮', '❤️', '🏡'];

export default function FakeCallScreen() {
  const params = useLocalSearchParams<{
    mode?: 'setup' | 'ringing' | 'connected';
    callerName?: string;
    avatar?: string;
    scriptId?: string;
  }>();

  // Screen Mode: 'setup' | 'ringing' | 'connected'
  const [screen, setScreen] = useState<'setup' | 'ringing' | 'connected'>(
    params.mode || 'setup'
  );

  // Setup Form States
  const [callerName, setCallerName] = useState(params.callerName || 'Mom');
  const [avatar, setAvatar] = useState(params.avatar || '👩');
  const [scriptId, setScriptId] = useState(params.scriptId || 'mom');
  const [delayType, setDelayType] = useState<'now' | '1m' | '2m' | '5m' | 'custom'>('now');
  const [customSeconds, setCustomSeconds] = useState('30');

  // Call States
  const [duration, setDuration] = useState(0);

  // Audio refs
  const ringtoneSoundRef = useRef<Audio.Sound | null>(null);
  const voiceSoundRef = useRef<Audio.Sound | null>(null);

  // Animation refs
  const ringPulse = useRef(new Animated.Value(1)).current;
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parse direct ring trigger on mount
  useEffect(() => {
    if (params.mode === 'ringing') {
      startRinging();
    }
  }, [params.mode]);

  // Handle ring pulse animation
  useEffect(() => {
    if (screen === 'ringing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(ringPulse, {
            toValue: 1.12,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(ringPulse, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      ringPulse.setValue(1);
    }
  }, [screen]);

  // Duration timer when connected
  useEffect(() => {
    if (screen === 'connected') {
      setDuration(0);
      timerIntervalRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [screen]);

  // Clean up sounds on unmount
  useEffect(() => {
    return () => {
      stopAllSounds();
    };
  }, []);

  const stopAllSounds = async () => {
    try {
      if (ringtoneSoundRef.current) {
        await ringtoneSoundRef.current.stopAsync();
        await ringtoneSoundRef.current.unloadAsync();
        ringtoneSoundRef.current = null;
      }
      if (voiceSoundRef.current) {
        await voiceSoundRef.current.stopAsync();
        await voiceSoundRef.current.unloadAsync();
        voiceSoundRef.current = null;
      }
    } catch (e) {
      console.warn('[FakeCall] Error stopping audio:', e);
    }
  };

  const startRinging = async () => {
    setScreen('ringing');
    await stopAllSounds();

    try {
      // Play standard telephone ringtone
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://www.soundjay.com/phone/sounds/telephone-ring-4.mp3' },
        { isLooping: true, volume: 0.8 }
      );
      ringtoneSoundRef.current = sound;
      await sound.playAsync();
    } catch (e) {
      console.warn('[FakeCall] Failed to play ringtone URL, using fallback silent ring');
    }
  };

  const handleDecline = async () => {
     HapticFeedback();
    await stopAllSounds();
    setScreen('setup');
    router.replace('/(tabs)/home');
  };

  const handleAnswer = async () => {
    HapticFeedback();
    setScreen('connected');

    try {
      // Stop ringtone
      if (ringtoneSoundRef.current) {
        await ringtoneSoundRef.current.stopAsync();
      }

      // Determine voice source
      const localUri = getCallerAudioUri(scriptId);
      const fileInfo = await getInfoAsync(localUri);

      let source;
      if (fileInfo.exists) {
        source = { uri: localUri };
      } else {
        // Fallback directly to Google TTS web API
        const scriptText =
          DEFAULT_SCRIPTS.find((s) => s.id === scriptId)?.text || 'Hello, are you there?';
        source = {
          uri: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
            scriptText
          )}&tl=en&client=tw-ob`,
        };
      }

      const { sound } = await Audio.Sound.createAsync(
        source,
        { shouldPlay: true, volume: 1.0 },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            console.log('[FakeCall] Voice playback finished');
          }
        }
      );

      voiceSoundRef.current = sound;
      await sound.playAsync();
    } catch (e) {
      console.warn('[FakeCall] Failed to play caller voice:', e);
    }
  };

  const handleStartSetup = async () => {
    let delay = 0;
    if (delayType === '1m') delay = 60;
    else if (delayType === '2m') delay = 120;
    else if (delayType === '5m') delay = 300;
    else if (delayType === 'custom') delay = parseInt(customSeconds, 10) || 10;

    if (delay === 0) {
      // Start ringing immediately
      startRinging();
    } else {
      try {
        await scheduleFakeCall(delay, callerName, avatar, scriptId);
        Alert.alert(
          'Call Scheduled',
          `A fake call from ${callerName} will ring in ${delay} seconds. You can lock your screen or use other apps now.`
        );
        router.back();
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to schedule fake call.');
      }
    }
  };

  const HapticFeedback = () => {
    if (Platform.OS !== 'web') {
      try {
        const Haptics = require('expo-haptics');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ─── Setup view ─────────────────────────────────────────────────────
  if (screen === 'setup') {
    return (
      <SafeAreaView style={styles.setupSafe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.setupHeader}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.setupTitle}>Deterrence Call Setup</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.setupScroll}>
          {/* Section: Caller Identity */}
          <View style={styles.setupCard}>
            <Text style={styles.cardLabel}>Caller Name</Text>
            <TextInput
              value={callerName}
              onChangeText={setCallerName}
              style={styles.textInput}
              placeholder="e.g. Mom, Boss, Hubby"
              placeholderTextColor="#555"
            />

            <Text style={[styles.cardLabel, { marginTop: 16 }]}>Choose Profile Emoji</Text>
            <View style={styles.emojiGrid}>
              {EMOJI_AVATARS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => setAvatar(emoji)}
                  style={[styles.emojiBtn, avatar === emoji && styles.emojiBtnActive]}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Section: Schedule Delay */}
          <View style={styles.setupCard}>
            <Text style={styles.cardLabel}>Trigger Schedule</Text>
            <View style={styles.delayRow}>
              {(['now', '1m', '2m', '5m'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  onPress={() => setDelayType(type)}
                  style={[styles.delayBtn, delayType === type && styles.delayBtnActive]}
                >
                  <Text style={[styles.delayBtnText, delayType === type && styles.delayBtnTextActive]}>
                    {type === 'now' ? 'Instant' : type}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => setDelayType('custom')}
                style={[styles.delayBtn, delayType === 'custom' && styles.delayBtnActive]}
              >
                <Text style={[styles.delayBtnText, delayType === 'custom' && styles.delayBtnTextActive]}>
                  Custom
                </Text>
              </TouchableOpacity>
            </View>

            {delayType === 'custom' && (
              <View style={styles.customDelayInputRow}>
                <TextInput
                  value={customSeconds}
                  onChangeText={setCustomSeconds}
                  keyboardType="number-pad"
                  style={[styles.textInput, { width: 100, textAlign: 'center' }]}
                />
                <Text style={styles.customDelayLabel}>Seconds delay</Text>
              </View>
            )}
          </View>

          {/* Section: Audio Script */}
          <View style={styles.setupCard}>
            <Text style={styles.cardLabel}>AI Voice Deterrence Script</Text>
            {DEFAULT_SCRIPTS.map((script) => (
              <TouchableOpacity
                key={script.id}
                onPress={() => setScriptId(script.id)}
                style={[styles.scriptRow, scriptId === script.id && styles.scriptRowActive]}
              >
                <Text style={styles.scriptLabel}>{script.label} Script</Text>
                <Text style={styles.scriptText}>"{script.text}"</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={handleStartSetup} style={styles.startBtn}>
            <Text style={styles.startBtnText}>
              {delayType === 'now' ? '📞 Trigger Call Now' : '⏰ Schedule Deterrence'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Incoming Call Ringing View ──────────────────────────────────────
  if (screen === 'ringing') {
    return (
      <View style={styles.callContainer}>
        <StatusBar barStyle="light-content" hidden />

        {/* Top bar (Fake status indicator) */}
        <View style={styles.fakeStatusBar}>
          <Text style={styles.fakeStatusTime}>12:45</Text>
          <Text style={styles.fakeStatusNetwork}>📶 5G 🔋 98%</Text>
        </View>

        {/* Center: Caller Meta */}
        <View style={styles.callProfileContainer}>
          <Animated.View
            style={[
              styles.callAvatarBg,
              { transform: [{ scale: ringPulse }] },
            ]}
          >
            <Text style={styles.callAvatarEmoji}>{avatar}</Text>
          </Animated.View>
          <Text style={styles.callNameText}>{callerName}</Text>
          <Text style={styles.callSubtitleText}>Mobile</Text>
        </View>

        {/* Bottom Buttons: Answer / Decline */}
        <View style={styles.dialActionsRow}>
          {/* Decline Button */}
          <View style={styles.actionBtnColumn}>
            <TouchableOpacity onPress={handleDecline} style={[styles.dialCircleBtn, styles.declineBtnBg]}>
              <Text style={styles.dialBtnIcon}>❌</Text>
            </TouchableOpacity>
            <Text style={styles.dialBtnLabel}>Decline</Text>
          </View>

          {/* Spacer */}
          <View style={{ width: 80 }} />

          {/* Answer Button */}
          <View style={styles.actionBtnColumn}>
            <TouchableOpacity onPress={handleAnswer} style={[styles.dialCircleBtn, styles.answerBtnBg]}>
              <Text style={styles.dialBtnIcon}>📞</Text>
            </TouchableOpacity>
            <Text style={styles.dialBtnLabel}>Answer</Text>
          </View>
        </View>
      </View>
    );
  }

  // ─── Connected View (During Active Chat) ─────────────────────────────
  return (
    <View style={styles.callContainer}>
      <StatusBar barStyle="light-content" hidden />

      {/* Top bar */}
      <View style={styles.fakeStatusBar}>
        <Text style={styles.fakeStatusTime}>{formatTimer(duration)}</Text>
        <Text style={styles.fakeStatusNetwork}>📶 5G 🔋 98%</Text>
      </View>

      {/* Center: Talking Info */}
      <View style={styles.callProfileContainer}>
        <View style={[styles.callAvatarBg, styles.connectedAvatarBorder]}>
          <Text style={styles.callAvatarEmoji}>{avatar}</Text>
        </View>
        <Text style={styles.callNameText}>{callerName}</Text>
        <Text style={styles.callTimerText}>{formatTimer(duration)}</Text>
      </View>

      {/* In-Call Settings Grid (Mocked look of standard smartphone e.g., iOS) */}
      <View style={styles.inCallGrid}>
        <View style={styles.gridRow}>
          <View style={styles.gridCell}>
            <View style={styles.gridCircle}><Text style={styles.gridEmoji}>🎙️</Text></View>
            <Text style={styles.gridLabel}>mute</Text>
          </View>
          <View style={styles.gridCell}>
            <View style={styles.gridCircle}><Text style={styles.gridEmoji}>🔢</Text></View>
            <Text style={styles.gridLabel}>keypad</Text>
          </View>
          <View style={styles.gridCell}>
            <View style={styles.gridCircle}><Text style={styles.gridEmoji}>🔊</Text></View>
            <Text style={styles.gridLabel}>speaker</Text>
          </View>
        </View>
        <View style={styles.gridRow}>
          <View style={styles.gridCell}>
            <View style={styles.gridCircle}><Text style={styles.gridEmoji}>➕</Text></View>
            <Text style={styles.gridLabel}>add call</Text>
          </View>
          <View style={styles.gridCell}>
            <View style={styles.gridCircle}><Text style={styles.gridEmoji}>📹</Text></View>
            <Text style={styles.gridLabel}>FaceTime</Text>
          </View>
          <View style={styles.gridCell}>
            <View style={styles.gridCircle}><Text style={styles.gridEmoji}>👤</Text></View>
            <Text style={styles.gridLabel}>contacts</Text>
          </View>
        </View>
      </View>

      {/* End Call Button */}
      <View style={styles.endCallRow}>
        <TouchableOpacity onPress={handleDecline} style={[styles.dialCircleBtn, styles.declineBtnBg, { width: 72, height: 72 }]}>
          <Text style={[styles.dialBtnIcon, { transform: [{ rotate: '135deg' }] }]}>📞</Text>
        </TouchableOpacity>
        <Text style={[styles.dialBtnLabel, { marginTop: 8 }]}>End Call</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Setup Styling
  setupSafe: {
    flex: 1,
    backgroundColor: '#0F0F14',
  },
  setupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2A2A35',
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  backBtnText: {
    color: '#EF9F27',
    fontSize: 14,
    fontWeight: '600',
  },
  setupTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  setupScroll: {
    padding: 16,
    paddingBottom: 40,
  },
  setupCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 14,
    padding: 16,
    borderWidth: 0.5,
    borderColor: '#2A2A35',
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#EF9F27',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
    marginBottom: 10,
  },
  textInput: {
    backgroundColor: '#0F0F14',
    borderWidth: 0.5,
    borderColor: '#3A3A4A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#FFF',
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emojiBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#0F0F14',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  emojiBtnActive: {
    borderColor: '#EF9F27',
    backgroundColor: '#EF9F2715',
  },
  emojiText: {
    fontSize: 22,
  },
  delayRow: {
    flexDirection: 'row',
    gap: 8,
  },
  delayBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#0F0F14',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  delayBtnActive: {
    borderColor: '#EF9F27',
    backgroundColor: '#EF9F2715',
  },
  delayBtnText: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
  },
  delayBtnTextActive: {
    color: '#EF9F27',
  },
  customDelayInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  customDelayLabel: {
    color: '#888',
    fontSize: 12,
  },
  scriptRow: {
    backgroundColor: '#0F0F14',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  scriptRowActive: {
    borderColor: '#EF9F27',
    backgroundColor: '#EF9F2708',
  },
  scriptLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#EF9F27',
    marginBottom: 4,
  },
  scriptText: {
    fontSize: 11,
    color: '#888',
    fontStyle: 'italic',
    lineHeight: 16,
  },
  startBtn: {
    backgroundColor: '#EF9F27',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#EF9F27',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  startBtnText: {
    color: '#0F0F14',
    fontSize: 14,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },

  // 📞 Fake Call Interface (iOS style mockup)
  callContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'space-between',
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  fakeStatusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  fakeStatusTime: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  fakeStatusNetwork: {
    color: '#FFF',
    fontSize: 11,
  },
  callProfileContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  callAvatarBg: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  connectedAvatarBorder: {
    borderWidth: 1.5,
    borderColor: '#5DCAA555',
  },
  callAvatarEmoji: {
    fontSize: 64,
  },
  callNameText: {
    fontSize: 26,
    fontWeight: '400',
    color: '#FFF',
  },
  callSubtitleText: {
    fontSize: 14,
    color: '#888',
    marginTop: 8,
  },
  callTimerText: {
    fontSize: 14,
    color: '#5DCAA5',
    marginTop: 8,
    fontWeight: '500',
  },
  // Ringing options buttons
  dialActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 40,
  },
  actionBtnColumn: {
    alignItems: 'center',
    gap: 8,
  },
  dialCircleBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  declineBtnBg: {
    backgroundColor: '#E74C3C',
  },
  answerBtnBg: {
    backgroundColor: '#2ECC71',
  },
  dialBtnIcon: {
    fontSize: 24,
    color: '#FFF',
    textAlign: 'center',
  },
  dialBtnLabel: {
    color: '#FFF',
    fontSize: 12,
  },

  // Active call screen items (connected grid)
  inCallGrid: {
    gap: 24,
    paddingHorizontal: 20,
    marginVertical: 20,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gridCell: {
    alignItems: 'center',
    width: 70,
  },
  gridCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1E1E1E',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  gridEmoji: {
    fontSize: 20,
    color: '#FFF',
  },
  gridLabel: {
    fontSize: 10,
    color: '#AAA',
  },
  endCallRow: {
    alignItems: 'center',
    marginBottom: 20,
  },
});
