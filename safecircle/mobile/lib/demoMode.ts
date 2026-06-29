/**
 * mobile/lib/demoMode.ts
 * ──────────────────────
 * Demo Mode controller for SafeCircle — final year project presentations.
 *
 * Provides:
 *  • Fully mocked Nagpur-area dataset (volunteers, threat zones, leaderboard, credits)
 *  • DemoScenario class that runs a 60-second scripted walkthrough
 *  • Global isDemoMode flag checked by API hooks to short-circuit real Supabase calls
 *
 * Usage:
 *   import { DemoMode, DemoScenario } from './demoMode';
 *   DemoMode.enable();
 *   const scenario = new DemoScenario(callback);
 *   scenario.start();
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_MODE_KEY = 'SAFECIRCLE_DEMO_MODE';

// Nagpur, Maharashtra coordinates (Dharampeth area)
const VICTIM_LOCATION = { lat: 21.1458, lng: 79.0882 };

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MockVolunteer {
  id: string;
  name: string;
  avatar: string;
  tier: 'bronze' | 'silver' | 'gold';
  distance_km: number;
  eta_minutes: number;
  lat: number;
  lng: number;
  trust_score: number;
  total_assists: number;
  rating: number;
  phone: string;
}

export interface MockThreatZone {
  id: string;
  center_lat: number;
  center_lng: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  incident_count: number;
  label: string;
  geojson: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface MockLeaderboardEntry {
  rank: number;
  name: string;
  credits: number;
  assists: number;
  tier: 'bronze' | 'silver' | 'gold';
  avatar: string;
  isMe: boolean;
}

export interface MockCreditTransaction {
  id: string;
  type: 'earned' | 'bonus';
  amount: number;
  reason: string;
  date: string;
  icon: string;
}

export interface DemoStep {
  id: number;
  title: string;
  description: string;
  annotation: string;
  triggerAtMs: number;
  screen?: string;
  action?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Datasets
// ─────────────────────────────────────────────────────────────────────────────

export const MOCK_VOLUNTEERS: MockVolunteer[] = [
  {
    id: 'vol-demo-001',
    name: 'Priya S.',
    avatar: '👩',
    tier: 'gold',
    distance_km: 0.4,
    eta_minutes: 3,
    lat: 21.1468,
    lng: 79.0895,
    trust_score: 94,
    total_assists: 47,
    rating: 4.9,
    phone: '+91-XXXXXXXXXX',
  },
  {
    id: 'vol-demo-002',
    name: 'Anjali M.',
    avatar: '👩‍💼',
    tier: 'silver',
    distance_km: 0.6,
    eta_minutes: 5,
    lat: 21.1445,
    lng: 79.0870,
    trust_score: 82,
    total_assists: 23,
    rating: 4.7,
    phone: '+91-XXXXXXXXXX',
  },
  {
    id: 'vol-demo-003',
    name: 'Rahul K.',
    avatar: '👮',
    tier: 'silver',
    distance_km: 0.8,
    eta_minutes: 6,
    lat: 21.1472,
    lng: 79.0862,
    trust_score: 78,
    total_assists: 18,
    rating: 4.6,
    phone: '+91-XXXXXXXXXX',
  },
  {
    id: 'vol-demo-004',
    name: 'Sneha R.',
    avatar: '🧑‍⚕️',
    tier: 'bronze',
    distance_km: 0.9,
    eta_minutes: 7,
    lat: 21.1449,
    lng: 79.0905,
    trust_score: 65,
    total_assists: 9,
    rating: 4.4,
    phone: '+91-XXXXXXXXXX',
  },
  {
    id: 'vol-demo-005',
    name: 'Deepa V.',
    avatar: '👩‍🦱',
    tier: 'bronze',
    distance_km: 0.95,
    eta_minutes: 8,
    lat: 21.1440,
    lng: 79.0888,
    trust_score: 61,
    total_assists: 6,
    rating: 4.3,
    phone: '+91-XXXXXXXXXX',
  },
];

// Threat zones around Dharampeth, Nagpur
export const MOCK_THREAT_ZONES: MockThreatZone[] = [
  {
    id: 'zone-demo-001',
    center_lat: 21.1462,
    center_lng: 79.0875,
    risk_level: 'high',
    incident_count: 8,
    label: 'Dharampeth Market',
    geojson: {
      type: 'Polygon',
      coordinates: [[
        [79.0855, 21.1450],
        [79.0895, 21.1450],
        [79.0895, 21.1475],
        [79.0855, 21.1475],
        [79.0855, 21.1450],
      ]],
    },
  },
  {
    id: 'zone-demo-002',
    center_lat: 21.1430,
    center_lng: 79.0840,
    risk_level: 'medium',
    incident_count: 4,
    label: 'Laxmi Nagar Junction',
    geojson: {
      type: 'Polygon',
      coordinates: [[
        [79.0825, 21.1420],
        [79.0858, 21.1420],
        [79.0858, 21.1442],
        [79.0825, 21.1442],
        [79.0825, 21.1420],
      ]],
    },
  },
  {
    id: 'zone-demo-003',
    center_lat: 21.1490,
    center_lng: 79.0920,
    risk_level: 'critical',
    incident_count: 13,
    label: 'Sitabuldi Overpass',
    geojson: {
      type: 'Polygon',
      coordinates: [[
        [79.0905, 21.1480],
        [79.0938, 21.1480],
        [79.0938, 21.1502],
        [79.0905, 21.1502],
        [79.0905, 21.1480],
      ]],
    },
  },
];

export const MOCK_LEADERBOARD: MockLeaderboardEntry[] = [
  { rank: 1, name: 'Priya S.',   credits: 1840, assists: 47, tier: 'gold',   avatar: '👩',      isMe: false },
  { rank: 2, name: 'Anjali M.',  credits: 1320, assists: 33, tier: 'gold',   avatar: '👩‍💼',    isMe: false },
  { rank: 3, name: 'Rahul K.',   credits:  980, assists: 25, tier: 'silver', avatar: '👮',      isMe: false },
  { rank: 4, name: 'Sneha R.',   credits:  740, assists: 19, tier: 'silver', avatar: '🧑‍⚕️',   isMe: false },
  { rank: 5, name: 'You ⭐',     credits:  610, assists: 14, tier: 'bronze', avatar: '🙋',      isMe: true  },
  { rank: 6, name: 'Deepa V.',   credits:  520, assists: 12, tier: 'bronze', avatar: '👩‍🦱',   isMe: false },
  { rank: 7, name: 'Kavya T.',   credits:  480, assists: 10, tier: 'bronze', avatar: '👧',      isMe: false },
];

export const MOCK_CREDIT_HISTORY: MockCreditTransaction[] = [
  { id: 'tx-001', type: 'earned', amount: 50,  reason: 'SOS response — Priya needed help',        date: 'Today, 2:35 PM',      icon: '🚨' },
  { id: 'tx-002', type: 'earned', amount: 50,  reason: 'SOS response — Anjali M.',                 date: 'Yesterday, 9:12 PM',  icon: '🚨' },
  { id: 'tx-003', type: 'bonus',  amount: 100, reason: '🏆 Milestone Bonus: 10 assists completed', date: 'Jun 25',              icon: '🏆' },
  { id: 'tx-004', type: 'earned', amount: 50,  reason: 'SOS response — Community assist',          date: 'Jun 24, 11:05 PM',    icon: '🚨' },
  { id: 'tx-005', type: 'earned', amount: 25,  reason: 'Night Shift Bonus (10 PM – 4 AM)',         date: 'Jun 23, 11:58 PM',    icon: '🌙' },
  { id: 'tx-006', type: 'earned', amount: 50,  reason: 'SOS response — Sneha R.',                  date: 'Jun 22, 8:40 PM',     icon: '🚨' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Demo Step Definitions (60-second walkthrough)
// ─────────────────────────────────────────────────────────────────────────────

export const DEMO_STEPS: DemoStep[] = [
  {
    id: 1,
    title: '🏠 Home Screen',
    description: 'SafeCircle home screen showing active volunteers nearby and the SOS button.',
    annotation: 'Notice the shield badge and volunteer count. 5 verified volunteers are within 1km right now.',
    triggerAtMs: 0,
    screen: 'home',
  },
  {
    id: 2,
    title: '🆘 SOS Triggered',
    description: 'User presses the SOS button. A 3-second countdown begins — giving time to cancel if accidental.',
    annotation: 'The 3-second grace period prevents false alarms. Press & hold for silent mode (no alarm sound).',
    triggerAtMs: 5000,
    screen: 'home',
    action: 'press_sos',
  },
  {
    id: 3,
    title: '⏱️ Countdown: 3... 2... 1...',
    description: 'Countdown overlay appears. User can cancel during this window.',
    annotation: 'This is critical UX — 87% of accidental SOS triggers are cancelled here in our user testing.',
    triggerAtMs: 6000,
    screen: 'countdown',
  },
  {
    id: 4,
    title: '🗺️ SOS Active — Map View',
    description: 'SOS fires! Your location is pinned on the map. Nearby volunteers are being notified via push notifications.',
    annotation: 'GPS coordinates are sent to Supabase. The ML trust scorer ranks volunteers — highest-trust get notified first.',
    triggerAtMs: 9000,
    screen: 'sos-active',
    action: 'sos_fired',
  },
  {
    id: 5,
    title: '📱 Volunteer Notified',
    description: '"Emergency nearby" push notification sent to Priya S. (trust score: 94, 0.4km away).',
    annotation: 'Only volunteers within 2km with trust_score > 60 are notified. Priya is top-ranked in this area.',
    triggerAtMs: 11000,
    screen: 'sos-active',
    action: 'volunteer_notified',
  },
  {
    id: 6,
    title: '✅ Volunteer Accepted',
    description: 'Priya S. accepted! Her volunteer card appears with ETA.',
    annotation: 'Volunteer acceptance triggers a Supabase Realtime subscription update — no polling needed.',
    triggerAtMs: 13000,
    screen: 'sos-active',
    action: 'volunteer_accepted',
  },
  {
    id: 7,
    title: '🏃 Volunteer En Route',
    description: 'Priya\'s location pin moves toward the victim on the live map.',
    annotation: 'Live location sharing uses the same battery-aware interval system (5s normal, 30s critical battery).',
    triggerAtMs: 15000,
    screen: 'sos-active',
    action: 'volunteer_moving',
  },
  {
    id: 8,
    title: '📍 Volunteer Arrived',
    description: '"Priya has arrived!" notification fires. The volunteer pin merges with the victim pin.',
    annotation: 'Arrival is detected via proximity check: distance < 50m triggers the "arrived" status update.',
    triggerAtMs: 36000,
    screen: 'sos-active',
    action: 'volunteer_arrived',
  },
  {
    id: 9,
    title: '🟢 I Am Safe',
    description: 'The green "I am safe" button pulses. User taps to resolve the SOS.',
    annotation: 'Either the victim or the volunteer can mark the SOS as resolved. All responders are notified.',
    triggerAtMs: 41000,
    screen: 'sos-active',
    action: 'highlight_safe_button',
  },
  {
    id: 10,
    title: '🎉 SOS Resolved — Credits Earned!',
    description: 'SOS marked as resolved. Credits animation: volunteer earns +50 credits for the assist.',
    annotation: 'Credits are stored in Supabase credit_transactions table. Leaderboard updates in real time.',
    triggerAtMs: 46000,
    screen: 'home',
    action: 'credits_earned',
  },
  {
    id: 11,
    title: '⭐ Review Prompt',
    description: 'User is prompted to rate their volunteer. Ratings feed back into the XGBoost trust model.',
    annotation: 'Avg victim rating is one of 9 features in the volunteer trust scoring model. It directly affects future rankings.',
    triggerAtMs: 51000,
    screen: 'home',
    action: 'show_review',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DemoMode — Global Enable/Disable
// ─────────────────────────────────────────────────────────────────────────────

export class DemoMode {
  private static _enabled: boolean = false;

  static async init() {
    try {
      const stored = await AsyncStorage.getItem(DEMO_MODE_KEY);
      DemoMode._enabled = stored === 'true';
    } catch {
      DemoMode._enabled = false;
    }
  }

  static async enable() {
    DemoMode._enabled = true;
    await AsyncStorage.setItem(DEMO_MODE_KEY, 'true');
    console.log('[DemoMode] ✅ Demo mode ENABLED');
  }

  static async disable() {
    DemoMode._enabled = false;
    await AsyncStorage.setItem(DEMO_MODE_KEY, 'false');
    console.log('[DemoMode] 🔴 Demo mode DISABLED');
  }

  static isEnabled(): boolean {
    return DemoMode._enabled;
  }

  /** Returns mock volunteers instead of real Supabase data. */
  static getMockVolunteers(): MockVolunteer[] {
    return MOCK_VOLUNTEERS;
  }

  /** Returns mock threat zones instead of real backend data. */
  static getMockThreatZones(): MockThreatZone[] {
    return MOCK_THREAT_ZONES;
  }

  /** Returns mock leaderboard. */
  static getMockLeaderboard(): MockLeaderboardEntry[] {
    return MOCK_LEADERBOARD;
  }

  /** Returns mock credit history. */
  static getMockCreditHistory(): MockCreditTransaction[] {
    return MOCK_CREDIT_HISTORY;
  }

  /** Returns the victim demo coordinate. */
  static getVictimLocation() {
    return VICTIM_LOCATION;
  }

  /**
   * Interpolates a volunteer's position between their start location and
   * the victim's location given elapsed seconds (0-30 seconds of movement).
   */
  static getVolunteerMovingPosition(
    volunteer: MockVolunteer,
    elapsedSeconds: number
  ): { lat: number; lng: number } {
    const TRAVEL_DURATION = 27; // volunteer reaches victim in 27s
    const t = Math.min(1, elapsedSeconds / TRAVEL_DURATION);

    return {
      lat: volunteer.lat + (VICTIM_LOCATION.lat - volunteer.lat) * t,
      lng: volunteer.lng + (VICTIM_LOCATION.lng - volunteer.lng) * t,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DemoScenario — Scripted 60-second walkthrough
// ─────────────────────────────────────────────────────────────────────────────

export type DemoStepCallback = (step: DemoStep) => void;

export class DemoScenario {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private callback: DemoStepCallback;
  private _isRunning: boolean = false;
  private _currentStep: number = 0;

  constructor(onStep: DemoStepCallback) {
    this.callback = onStep;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get currentStepIndex(): number {
    return this._currentStep;
  }

  /** Start the auto-play scenario. */
  start() {
    this.stop(); // clear any existing timers
    this._isRunning = true;
    this._currentStep = 0;

    DEMO_STEPS.forEach((step, idx) => {
      const timer = setTimeout(() => {
        this._currentStep = idx;
        this.callback(step);
      }, step.triggerAtMs);
      this.timers.push(timer);
    });

    // Mark as done after the last step
    const lastStep = DEMO_STEPS[DEMO_STEPS.length - 1];
    const doneTimer = setTimeout(() => {
      this._isRunning = false;
    }, lastStep.triggerAtMs + 5000);
    this.timers.push(doneTimer);
  }

  /** Stop / cancel the scenario. */
  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this._isRunning = false;
  }

  /** Manually advance to the next step. */
  nextStep() {
    const nextIdx = this._currentStep + 1;
    if (nextIdx < DEMO_STEPS.length) {
      this._currentStep = nextIdx;
      this.callback(DEMO_STEPS[nextIdx]);
    }
  }

  /** Manually go to the previous step. */
  prevStep() {
    const prevIdx = this._currentStep - 1;
    if (prevIdx >= 0) {
      this._currentStep = prevIdx;
      this.callback(DEMO_STEPS[prevIdx]);
    }
  }

  /** Jump directly to a step by index. */
  jumpTo(idx: number) {
    if (idx >= 0 && idx < DEMO_STEPS.length) {
      this._currentStep = idx;
      this.callback(DEMO_STEPS[idx]);
    }
  }

  /** Restart from beginning. */
  restart() {
    this.stop();
    this.start();
  }
}
