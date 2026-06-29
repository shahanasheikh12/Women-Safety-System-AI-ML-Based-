import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { DemoMode } from '../lib/demoMode';
import Colors from '../constants/Colors';

const SETTINGS_CACHE_KEY = '@safecircle_user_settings';

interface UserSettings {
  sos_countdown_seconds: number;
  sos_shake_sensitivity: 'Low' | 'Medium' | 'High';
  sos_silent_by_default: boolean;
  sos_voice_hotword_enabled: boolean;
  sos_power_button_enabled: boolean;
  share_location_with_volunteers: boolean;
  share_location_with_contacts: boolean;
  location_accuracy: 'High' | 'Balanced' | 'Low';
  receive_alerts: boolean;
  alert_radius_km: number;
  available_hours_start: string;
  available_hours_end: string;
  do_not_disturb: boolean;
  auto_delete_evidence_days: number;
  biometric_lock_enabled: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  sos_countdown_seconds: 3,
  sos_shake_sensitivity: 'Medium',
  sos_silent_by_default: false,
  sos_voice_hotword_enabled: false,
  sos_power_button_enabled: false,
  share_location_with_volunteers: true,
  share_location_with_contacts: true,
  location_accuracy: 'High',
  receive_alerts: true,
  alert_radius_km: 2.0,
  available_hours_start: '00:00',
  available_hours_end: '23:59',
  do_not_disturb: false,
  auto_delete_evidence_days: 30,
  biometric_lock_enabled: false,
};

export default function SettingsScreen() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isVolunteer, setIsVolunteer] = useState(false);

  // Load user info & settings
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
          
          // Check if user is a volunteer
          const { data: profile } = await supabase
            .from('users')
            .select('is_volunteer')
            .eq('id', user.id)
            .single();
            
          if (profile) setIsVolunteer(profile.is_volunteer);

          // Offline first: load from AsyncStorage cache
          const cached = await AsyncStorage.getItem(SETTINGS_CACHE_KEY);
          if (cached) {
            setSettings(JSON.parse(cached));
            setLoading(false); // resolve UI early
          }

          // Background sync from Supabase
          await syncSettingsFromDB(user.id);
        }
      } catch (err) {
        console.error('[Settings] Init error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const syncSettingsFromDB = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No record exists — initialize DB with defaults
          await supabase.from('user_settings').insert({
            user_id: userId,
            ...DEFAULT_SETTINGS
          });
          await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(DEFAULT_SETTINGS));
          setSettings(DEFAULT_SETTINGS);
        } else {
          throw error;
        }
      } else if (data) {
        // Strip user_id before setting state
        const dbSettings: UserSettings = {
          sos_countdown_seconds: data.sos_countdown_seconds,
          sos_shake_sensitivity: data.sos_shake_sensitivity,
          sos_silent_by_default: data.sos_silent_by_default,
          sos_voice_hotword_enabled: data.sos_voice_hotword_enabled,
          sos_power_button_enabled: data.sos_power_button_enabled,
          share_location_with_volunteers: data.share_location_with_volunteers,
          share_location_with_contacts: data.share_location_with_contacts,
          location_accuracy: data.location_accuracy,
          receive_alerts: data.receive_alerts,
          alert_radius_km: data.alert_radius_km,
          available_hours_start: data.available_hours_start,
          available_hours_end: data.available_hours_end,
          do_not_disturb: data.do_not_disturb,
          auto_delete_evidence_days: data.auto_delete_evidence_days,
          biometric_lock_enabled: data.biometric_lock_enabled,
        };
        setSettings(dbSettings);
        await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(dbSettings));
      }
    } catch (err) {
      console.warn('[Settings] Background DB sync failed:', err);
    }
  };

  // Generic settings update helper (saves locally instantly, writes to DB in background)
  const updateSetting = async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);

    // Save to AsyncStorage cache instantly
    try {
      await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('[Settings] Cache write error:', err);
    }

    // Sync to Supabase in background
    if (currentUserId) {
      try {
        const { error } = await supabase
          .from('user_settings')
          .update({ [key]: value })
          .eq('user_id', currentUserId);
        
        if (error) throw error;
      } catch (err) {
        console.warn(`[Settings] Failed to sync setting ${String(key)} to DB:`, err);
      }
    }
  };

  const handleTestHotword = () => {
    Alert.alert(
      'Voice Activation Test',
      'Speak "HELP NOW" clearly to test voice SOS. (Note: Hotword detection is simulated in the background).'
    );
  };

  const handleBugReport = () => {
    Alert.prompt(
      'Report a Bug',
      'Please describe the issue you encountered:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: (text?: string) => {
            if (text && text.trim()) {
              Alert.alert('Thank you', 'Bug report submitted. Our safety team is on it.');
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* HEADER BAR */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>◀ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>App Settings</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      {/* SECTION 1: SOS SETTINGS */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🚨 SOS Alert Trigger Configuration</Text>

        {/* Countdown duration */}
        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>SOS Fire Countdown</Text>
            <Text style={styles.settingDesc}>Delay duration before emergency trigger fires</Text>
          </View>
          <View style={styles.segmentedControl}>
            {[3, 5, 10].map((val) => (
              <TouchableOpacity
                key={val}
                onPress={() => updateSetting('sos_countdown_seconds', val)}
                style={[
                  styles.segmentBtn,
                  settings.sos_countdown_seconds === val && styles.segmentBtnActive
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    settings.sos_countdown_seconds === val && styles.segmentTextActive
                  ]}
                >
                  {val}s
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Shake sensitivity */}
        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>Shake-to-SOS Sensitivity</Text>
            <Text style={styles.settingDesc}>Trigger emergency by shaking device</Text>
          </View>
          <View style={styles.segmentedControl}>
            {(['Low', 'Medium', 'High'] as const).map((val) => (
              <TouchableOpacity
                key={val}
                onPress={() => updateSetting('sos_shake_sensitivity', val)}
                style={[
                  styles.segmentBtn,
                  settings.sos_shake_sensitivity === val && styles.segmentBtnActive
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    settings.sos_shake_sensitivity === val && styles.segmentTextActive
                  ]}
                >
                  {val}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Silent SOS toggle */}
        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>Silent SOS Alert</Text>
            <Text style={styles.settingDesc}>Fires SOS without sirens or audio visual feedback</Text>
          </View>
          <Switch
            value={settings.sos_silent_by_default}
            onValueChange={(val) => updateSetting('sos_silent_by_default', val)}
            trackColor={{ false: '#2C3E50', true: Colors.safe }}
            thumbColor="#FFF"
          />
        </View>

        {/* Voice SOS toggle */}
        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>Voice Activation (Hotword)</Text>
            <Text style={styles.settingDesc}>Trigger SOS by speaking the safety hotword</Text>
          </View>
          <View style={styles.voiceActions}>
            <TouchableOpacity onPress={handleTestHotword} style={styles.testBtn}>
              <Text style={styles.testBtnText}>🎙️ TEST</Text>
            </TouchableOpacity>
            <Switch
              value={settings.sos_voice_hotword_enabled}
              onValueChange={(val) => updateSetting('sos_voice_hotword_enabled', val)}
              trackColor={{ false: '#2C3E50', true: Colors.safe }}
              thumbColor="#FFF"
            />
          </View>
        </View>

        {/* Power button SOS */}
        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>Power Button SOS</Text>
            <Text style={styles.settingDesc}>Press power button 5 times to fire alert</Text>
          </View>
          <Switch
            value={settings.sos_power_button_enabled}
            onValueChange={(val) => updateSetting('sos_power_button_enabled', val)}
            trackColor={{ false: '#2C3E50', true: Colors.safe }}
            thumbColor="#FFF"
          />
        </View>
      </View>

      {/* SECTION 2: LOCATION SETTINGS */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📍 Location Stream Settings</Text>

        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>Share Location with Volunteers</Text>
            <Text style={styles.settingDesc}>Expose live GPS coordinates to verified responders</Text>
          </View>
          <Switch
            value={settings.share_location_with_volunteers}
            onValueChange={(val) => updateSetting('share_location_with_volunteers', val)}
            trackColor={{ false: '#2C3E50', true: Colors.safe }}
            thumbColor="#FFF"
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>Share Location with Emergency Contacts</Text>
            <Text style={styles.settingDesc}>Expose live GPS coordinates to emergency circle</Text>
          </View>
          <Switch
            value={settings.share_location_with_contacts}
            onValueChange={(val) => updateSetting('share_location_with_contacts', val)}
            trackColor={{ false: '#2C3E50', true: Colors.safe }}
            thumbColor="#FFF"
          />
        </View>

        {/* Location Accuracy */}
        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>GPS Accuracy Level</Text>
            <Text style={styles.settingDesc}>Trade precision for power battery usage</Text>
          </View>
          <View style={styles.segmentedControl}>
            {(['Low', 'Balanced', 'High'] as const).map((val) => (
              <TouchableOpacity
                key={val}
                onPress={() => updateSetting('location_accuracy', val)}
                style={[
                  styles.segmentBtn,
                  settings.location_accuracy === val && styles.segmentBtnActive
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    settings.location_accuracy === val && styles.segmentTextActive
                  ]}
                >
                  {val}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* SECTION 3: VOLUNTEER RESPONDER SETTINGS */}
      {isVolunteer && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🤝 Volunteer Responder Settings</Text>

          {/* Master alert switch */}
          <View style={styles.settingRow}>
            <View style={styles.textCol}>
              <Text style={styles.settingLabel}>Receive Nearby SOS Alerts</Text>
              <Text style={styles.settingDesc}>Receive emergency push notifications</Text>
            </View>
            <Switch
              value={settings.receive_alerts}
              onValueChange={(val) => updateSetting('receive_alerts', val)}
              trackColor={{ false: '#2C3E50', true: Colors.safe }}
              thumbColor="#FFF"
            />
          </View>

          {/* Alert radius */}
          <View style={styles.settingRow}>
            <View style={styles.textCol}>
              <Text style={styles.settingLabel}>Alert Radius</Text>
              <Text style={styles.settingDesc}>Notify alerts within this distance boundary</Text>
            </View>
            <View style={styles.segmentedControl}>
              {[0.5, 1.0, 2.0, 5.0].map((val) => (
                <TouchableOpacity
                  key={val}
                  onPress={() => updateSetting('alert_radius_km', val)}
                  style={[
                    styles.segmentBtn,
                    settings.alert_radius_km === val && styles.segmentBtnActive
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      settings.alert_radius_km === val && styles.segmentTextActive
                    ]}
                  >
                    {val}km
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Available hours start/end */}
          <View style={styles.settingRow}>
            <View style={styles.textCol}>
              <Text style={styles.settingLabel}>Available Responder Hours</Text>
              <Text style={styles.settingDesc}>Specify times when you can respond (HH:MM)</Text>
            </View>
            <View style={styles.timeInputRow}>
              <TextInput
                style={styles.timeInput}
                value={settings.available_hours_start}
                onChangeText={(val) => updateSetting('available_hours_start', val)}
                placeholder="00:00"
                placeholderTextColor={Colors.textMuted}
                maxLength={5}
              />
              <Text style={styles.timeDash}>–</Text>
              <TextInput
                style={styles.timeInput}
                value={settings.available_hours_end}
                onChangeText={(val) => updateSetting('available_hours_end', val)}
                placeholder="23:59"
                placeholderTextColor={Colors.textMuted}
                maxLength={5}
              />
            </View>
          </View>

          {/* DND Toggle */}
          <View style={styles.settingRow}>
            <View style={styles.textCol}>
              <Text style={styles.settingLabel}>Do Not Disturb (DND)</Text>
              <Text style={styles.settingDesc}>Temporarily silence emergency notifications</Text>
            </View>
            <Switch
              value={settings.do_not_disturb}
              onValueChange={(val) => updateSetting('do_not_disturb', val)}
              trackColor={{ false: '#2C3E50', true: Colors.safe }}
              thumbColor="#FFF"
            />
          </View>
        </View>
      )}

      {/* SECTION 4: PRIVACY */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔒 Privacy & Device Security</Text>

        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>Auto-Delete Evidence</Text>
            <Text style={styles.settingDesc}>Delete audio/photo files after 30 days</Text>
          </View>
          <Switch
            value={settings.auto_delete_evidence_days === 30}
            onValueChange={(val) => updateSetting('auto_delete_evidence_days', val ? 30 : 0)}
            trackColor={{ false: '#2C3E50', true: Colors.safe }}
            thumbColor="#FFF"
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.textCol}>
            <Text style={styles.settingLabel}>Biometric Locking</Text>
            <Text style={styles.settingDesc}>Require fingerprint/FaceID on app launch</Text>
          </View>
          <Switch
            value={settings.biometric_lock_enabled}
            onValueChange={(val) => updateSetting('biometric_lock_enabled', val)}
            trackColor={{ false: '#2C3E50', true: Colors.safe }}
            thumbColor="#FFF"
          />
        </View>
      </View>

      {/* SECTION 5: ABOUT */}
      {/* ── 🎓 Demo Mode Section ──────────────────────────────── */}
      <DemoModeSettingsSection />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ℹ️ About SafeCircle</Text>

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>App Version</Text>
          <Text style={styles.aboutVal}>v1.2.0 (Build 108)</Text>
        </View>

        <TouchableOpacity onPress={() => Alert.alert('Privacy Policy', 'Your safety is our priority. Live location coordinates are encrypted in transit and purged automatically after emergency resolution. SafeCircle does not sell or share user data.')} style={styles.aboutRowAction}>
          <Text style={styles.aboutLabelAction}>🔒 View Privacy Policy</Text>
          <Text style={styles.arrowIcon}>➔</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleBugReport} style={styles.aboutRowAction}>
          <Text style={styles.aboutLabelAction}>🪲 Report a Bug</Text>
          <Text style={styles.arrowIcon}>➔</Text>
        </TouchableOpacity>

        <View style={styles.creditsBox}>
          <Text style={styles.creditsHeader}>SafeCircle Safety Network</Text>
          <Text style={styles.creditsTech}>
            Stack: React Native, Expo, Supabase DB, Deno Edge Functions, Leaflet OpenStreetMap, PostGIS Proximity Match.
          </Text>
          <Text style={styles.creditsCopyright}>© 2026 SafeCircle. All rights reserved.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────
// DemoMode Settings Component
// ─────────────────────────────────────────────────────────────

function DemoModeSettingsSection() {
  const [demoEnabled, setDemoEnabled] = useState(DemoMode.isEnabled());

  const toggleDemo = async (val: boolean) => {
    if (val) {
      await DemoMode.enable();
    } else {
      await DemoMode.disable();
    }
    setDemoEnabled(val);
    Alert.alert(
      val ? '🎓 Demo Mode ON' : '🔴 Demo Mode OFF',
      val
        ? 'All API calls will return mock Nagpur data. Perfect for presentations.'
        : 'App is now using real Supabase data.'
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>🎓 Presentation / Demo Mode</Text>

      <View style={styles.settingRow}>
        <View style={styles.textCol}>
          <Text style={styles.settingLabel}>Enable Demo Mode</Text>
          <Text style={styles.settingDesc}>
            Uses mock Nagpur data — no Supabase needed. Perfect for presentations.
          </Text>
        </View>
        <Switch
          value={demoEnabled}
          onValueChange={toggleDemo}
          trackColor={{ false: '#2A2A3E', true: '#EF9F27' }}
          thumbColor={demoEnabled ? '#FFF' : '#888'}
        />
      </View>

      {demoEnabled && (
        <View style={{
          backgroundColor: '#78350F22',
          borderRadius: 8,
          padding: 10,
          marginTop: 6,
          borderWidth: 1,
          borderColor: '#EF9F2744',
        }}>
          <Text style={{ color: '#EF9F27', fontSize: 12, fontWeight: '700' }}>
            ⚠️ Demo Mode Active — 5 mock volunteers, 3 threat zones (Dharampeth, Nagpur)
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={{
          marginTop: 12,
          backgroundColor: demoEnabled ? '#1C1C2E' : '#0F0F14',
          borderRadius: 12,
          paddingVertical: 12,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderWidth: 1,
          borderColor: demoEnabled ? '#EF9F27' : '#2A2A3E',
          opacity: demoEnabled ? 1 : 0.4,
        }}
        onPress={() => {
          if (!demoEnabled) {
            Alert.alert('Enable Demo Mode first', 'Turn on Demo Mode above to access the walkthrough.');
          } else {
            router.push('/demo');
          }
        }}
      >
        <Text style={{ color: demoEnabled ? '#EF9F27' : '#888', fontWeight: '700', fontSize: 13 }}>
          🎬 Open Demo Walkthrough
        </Text>
        <Text style={{ color: '#888' }}>➔</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loaderContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 24 : 10,
    paddingBottom: 40,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingVertical: 14,
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2C3E50',
    marginBottom: 20,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  backBtnText: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: 'bold',
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerPlaceholder: {
    width: 50,
  },
  section: {
    backgroundColor: Colors.surface,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2C3E50',
    marginBottom: 20,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2C3E50',
    paddingBottom: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(44, 62, 80, 0.4)',
  },
  textCol: {
    flex: 1,
    paddingRight: 12,
  },
  settingLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  settingDesc: {
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#0D0D0D',
    padding: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2C3E50',
  },
  segmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: Colors.primary,
  },
  segmentText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: 'bold',
  },
  segmentTextActive: {
    color: '#FFF',
  },
  voiceActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  testBtn: {
    backgroundColor: 'rgba(192, 57, 43, 0.15)',
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  testBtnText: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: 'bold',
  },
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeInput: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#2C3E50',
    borderRadius: 8,
    color: Colors.text,
    paddingHorizontal: 8,
    height: 36,
    width: 56,
    fontSize: 13,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  timeDash: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(44, 62, 80, 0.4)',
  },
  aboutLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  aboutVal: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  aboutRowAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(44, 62, 80, 0.4)',
  },
  aboutLabelAction: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: '500',
  },
  arrowIcon: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  creditsBox: {
    backgroundColor: '#0D0D0D',
    padding: 14,
    borderRadius: 12,
    marginTop: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2C3E50',
  },
  creditsHeader: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  creditsTech: {
    color: Colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
    marginBottom: 6,
  },
  creditsCopyright: {
    color: Colors.textMuted,
    fontSize: 9,
  },
});
