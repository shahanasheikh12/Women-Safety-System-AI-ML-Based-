import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────
// Environment variables (set in .env or app.config.ts)
// ─────────────────────────────────────────────────────────────
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key-string-long-enough-to-pass-validation';

// ─────────────────────────────────────────────────────────────
// TypeScript Database Interface — mirrors the SQL schema
// ─────────────────────────────────────────────────────────────
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          phone: string;
          name: string | null;
          gender: 'female' | 'male' | 'other' | null;
          is_volunteer: boolean;
          verification_tier: number;
          trust_score: number;
          credits: number;
          fcm_token: string | null;
          current_lat: number | null;
          current_lng: number | null;
          location_updated_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          phone: string;
          name?: string | null;
          gender?: 'female' | 'male' | 'other' | null;
          is_volunteer?: boolean;
          verification_tier?: number;
          trust_score?: number;
          credits?: number;
          fcm_token?: string | null;
          current_lat?: number | null;
          current_lng?: number | null;
          location_updated_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };

      sos_events: {
        Row: {
          id: string;
          user_id: string;
          status: 'active' | 'resolved' | 'false_alarm' | 'escalated';
          trigger_method: 'button' | 'voice' | 'shake' | 'accelerometer' | 'power_button' | null;
          lat: number;
          lng: number;
          audio_url: string | null;
          photo_url: string | null;
          police_notified: boolean;
          notes: string | null;
          started_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: 'active' | 'resolved' | 'false_alarm' | 'escalated';
          trigger_method?: 'button' | 'voice' | 'shake' | 'accelerometer' | 'power_button' | null;
          lat: number;
          lng: number;
          audio_url?: string | null;
          photo_url?: string | null;
          police_notified?: boolean;
          notes?: string | null;
          started_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['sos_events']['Insert']>;
      };

      location_stream: {
        Row: {
          id: string;
          sos_id: string;
          lat: number;
          lng: number;
          accuracy_meters: number | null;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          sos_id: string;
          lat: number;
          lng: number;
          accuracy_meters?: number | null;
          recorded_at?: string;
        };
        Update: Partial<Database['public']['Tables']['location_stream']['Insert']>;
      };

      volunteer_responses: {
        Row: {
          id: string;
          sos_id: string;
          volunteer_id: string;
          status: 'notified' | 'accepted' | 'en_route' | 'arrived' | 'declined' | 'completed';
          response_time_seconds: number | null;
          victim_rating: number | null;
          credits_awarded: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          sos_id: string;
          volunteer_id: string;
          status?: 'notified' | 'accepted' | 'en_route' | 'arrived' | 'declined' | 'completed';
          response_time_seconds?: number | null;
          victim_rating?: number | null;
          credits_awarded?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['volunteer_responses']['Insert']>;
      };

      emergency_contacts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          phone: string;
          relationship: string | null;
          notify_on_sos: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          phone: string;
          relationship?: string | null;
          notify_on_sos?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['emergency_contacts']['Insert']>;
      };

      threat_zones: {
        Row: {
          id: string;
          cluster_id: number | null;
          geojson: Json | null;
          risk_level: 'low' | 'medium' | 'high' | 'critical' | null;
          incident_count: number;
          center_lat: number | null;
          center_lng: number | null;
          last_updated: string;
        };
        Insert: {
          id?: string;
          cluster_id?: number | null;
          geojson?: Json | null;
          risk_level?: 'low' | 'medium' | 'high' | 'critical' | null;
          incident_count?: number;
          center_lat?: number | null;
          center_lng?: number | null;
          last_updated?: string;
        };
        Update: Partial<Database['public']['Tables']['threat_zones']['Insert']>;
      };

      credit_transactions: {
        Row: {
          id: string;
          user_id: string;
          amount: number;
          reason: string | null;
          sos_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          amount: number;
          reason?: string | null;
          sos_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['credit_transactions']['Insert']>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

// ─────────────────────────────────────────────────────────────
// Typed Supabase Client (Overridden for Dev/Demo Bypass support)
// ─────────────────────────────────────────────────────────────
const client = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

const originalAuth = client.auth;
let authListeners: Array<(event: string, session: any) => void> = [];

const getMockSession = async () => {
  try {
    const val = await AsyncStorage.getItem('sc_mock_user_session');
    if (val) {
      const parsed = JSON.parse(val);
      return {
        access_token: 'mock-token-12345',
        user: {
          id: parsed.id || 'd0b00000-0000-0000-0000-000000000001',
          phone: parsed.phone || '+918605508910',
          email: '',
        }
      };
    }
  } catch {}
  return null;
};

const mockAuth = {
  ...originalAuth,

  async getSession() {
    const mock = await getMockSession();
    if (mock) return { data: { session: mock }, error: null };
    return originalAuth.getSession();
  },

  async getUser() {
    const mock = await getMockSession();
    if (mock) return { data: { user: mock.user }, error: null };
    return originalAuth.getUser();
  },

  onAuthStateChange(callback: any) {
    authListeners.push(callback);
    getMockSession().then((mock) => {
      if (mock) {
        callback('SIGNED_IN', mock);
      } else {
        originalAuth.getSession().then(({ data }) => {
          callback(data.session ? 'SIGNED_IN' : 'SIGNED_OUT', data.session);
        });
      }
    });

    const originalSubscription = originalAuth.onAuthStateChange(callback);
    return {
      data: {
        subscription: {
          unsubscribe() {
            authListeners = authListeners.filter(l => l !== callback);
            originalSubscription.data.subscription.unsubscribe();
          }
        }
      }
    };
  },

  async signInWithOtp(params: any) {
    console.log('[supabase.auth] signInWithOtp called for:', params.phone);
    // Allow any number to proceed to verify screen
    return { data: {}, error: null };
  },

  async verifyOtp(params: any) {
    console.log('[supabase.auth] verifyOtp called with token:', params.token);
    const mockUser = {
      id: 'usr-' + params.phone.replace(/[^0-9]/g, ''),
      phone: params.phone,
    };
    const mockSession = {
      access_token: 'mock-token-' + mockUser.id,
      user: mockUser,
    };
    await AsyncStorage.setItem('sc_mock_user_session', JSON.stringify(mockUser));

    const isDefaultPresenter = params.phone.includes('9876543210');
    activeMockProfile = {
      id: mockUser.id,
      name: isDefaultPresenter ? 'Shraddha S.' : 'SafeCircle Member',
      phone: params.phone,
      is_volunteer: isDefaultPresenter,
      verification_tier: isDefaultPresenter ? 1 : 0,
      trust_score: isDefaultPresenter ? 95 : 80,
      current_lat: 21.1458,
      current_lng: 79.0882,
      credits: isDefaultPresenter ? 250 : 0,
      created_at: new Date().toISOString(),
    };
    await AsyncStorage.setItem(`sc_profile_${params.phone}`, JSON.stringify(activeMockProfile));

    isMockSessionActive = true;
    authListeners.forEach(l => l('SIGNED_IN', mockSession));
    return { data: { user: mockUser, session: mockSession }, error: null };
  },

  async signOut() {
    await AsyncStorage.removeItem('sc_mock_user_session');
    await AsyncStorage.removeItem('sc_success_popup_shown');
    await AsyncStorage.removeItem('sc_liveness_verified');
    await AsyncStorage.removeItem('sc_aadhaar_verified');
    activeMockProfile = null;
    isMockSessionActive = false;
    authListeners.forEach(l => l('SIGNED_OUT', null));
    return originalAuth.signOut();
  }
};

// Replace auth property dynamically
Object.defineProperty(client, 'auth', {
  get() {
    return mockAuth as any;
  }
});

let isMockSessionActive = false;
let activeMockProfile: any = null;

const initializeMockSession = async () => {
  try {
    const val = await AsyncStorage.getItem('sc_mock_user_session');
    isMockSessionActive = !!val;
    if (val) {
      const parsed = JSON.parse(val);
      const profileKey = `sc_profile_${parsed.phone || 'default'}`;
      const profileStr = await AsyncStorage.getItem(profileKey);
      if (profileStr) {
        activeMockProfile = JSON.parse(profileStr);
      } else {
        const isDefaultPresenter = (parsed.phone || '').includes('9876543210');
        activeMockProfile = {
          id: parsed.id || 'd0b00000-0000-0000-0000-000000000001',
          name: isDefaultPresenter ? 'Shraddha S.' : 'SafeCircle Member',
          phone: parsed.phone || '+918605508910',
          is_volunteer: isDefaultPresenter,
          verification_tier: isDefaultPresenter ? 1 : 0,
          trust_score: isDefaultPresenter ? 95 : 80,
          current_lat: 21.1458,
          current_lng: 79.0882,
          credits: isDefaultPresenter ? 250 : 0,
          created_at: new Date().toISOString(),
        };
        await AsyncStorage.setItem(profileKey, JSON.stringify(activeMockProfile));
      }
    }
  } catch (e) {
    console.error('[supabase] error initializing mock session:', e);
  }
};

initializeMockSession();

const originalFrom = client.from;

const mockFrom = (table: string) => {
  console.log('[supabase.from] Mocked query on table:', table);
  let isSingle = false;
  let updateFields: any = null;

  const builder: any = {
    update: (fields: any) => {
      updateFields = fields;
      return builderProxy;
    },
    insert: (fields: any) => {
      return builderProxy;
    },
    single: () => { isSingle = true; return builderProxy; },
    maybeSingle: () => { isSingle = true; return builderProxy; },
    then: (onfulfilled: any) => {
      let data: any = null;
      if (table === 'users') {
        if (updateFields && activeMockProfile) {
          activeMockProfile = { ...activeMockProfile, ...updateFields };
          AsyncStorage.setItem(`sc_profile_${activeMockProfile.phone}`, JSON.stringify(activeMockProfile));
        }
        data = activeMockProfile || {
          id: 'd0b00000-0000-0000-0000-000000000001',
          name: 'Shraddha S.',
          phone: '+91-9876543210',
          is_volunteer: true,
          verification_tier: 1,
          trust_score: 95,
          current_lat: 21.1458,
          current_lng: 79.0882,
          credits: 250,
          created_at: new Date().toISOString(),
        };
      } else if (table === 'threat_zones') {
        const zones = [
          {
            id: 'zone-demo-001',
            center_lat: 21.1462,
            center_lng: 79.0875,
            risk_level: 'high',
            geojson: { type: 'Polygon', coordinates: [[[79.0855, 21.1450], [79.0895, 21.1450], [79.0895, 21.1475], [79.0855, 21.1475], [79.0855, 21.1450]]] }
          },
          {
            id: 'zone-demo-002',
            center_lat: 21.1430,
            center_lng: 79.0840,
            risk_level: 'medium',
            geojson: { type: 'Polygon', coordinates: [[[79.0825, 21.1420], [79.0858, 21.1420], [79.0858, 21.1442], [79.0825, 21.1442], [79.0825, 21.1420]]] }
          },
          {
            id: 'zone-demo-003',
            center_lat: 21.1490,
            center_lng: 79.0920,
            risk_level: 'critical',
            geojson: { type: 'Polygon', coordinates: [[[79.0905, 21.1480], [79.0938, 21.1480], [79.0938, 21.1502], [79.0905, 21.1502], [79.0905, 21.1480]]] }
          }
        ];
        data = isSingle ? zones[0] : zones;
      } else if (table === 'volunteer_responses') {
        const responses = [
          {
            id: 'resp-demo-001',
            volunteer_id: 'vol-demo-001',
            status: 'accepted',
            users: {
              name: 'Priya S.',
              verification_tier: 3,
              trust_score: 94,
              current_lat: 21.1468,
              current_lng: 79.0895
            }
          },
          {
            id: 'resp-demo-002',
            volunteer_id: 'vol-demo-002',
            status: 'accepted',
            users: {
              name: 'Anjali M.',
              verification_tier: 2,
              trust_score: 82,
              current_lat: 21.1445,
              current_lng: 79.0870
            }
          }
        ];
        data = isSingle ? responses[0] : responses;
      } else if (table === 'emergency_contacts') {
        const contacts = [
          {
            id: 'contact-demo-001',
            user_id: 'd0b00000-0000-0000-0000-000000000001',
            name: 'Mom ❤️',
            phone: '+91-9876543210',
            relationship: 'Mother',
            created_at: new Date().toISOString()
          },
          {
            id: 'contact-demo-002',
            user_id: 'd0b00000-0000-0000-0000-000000000001',
            name: 'Dad 👨',
            phone: '+91-9876543211',
            relationship: 'Father',
            created_at: new Date().toISOString()
          },
          {
            id: 'contact-demo-003',
            user_id: 'd0b00000-0000-0000-0000-000000000001',
            name: 'Best Friend 🤝',
            phone: '+91-9876543212',
            relationship: 'Friend',
            created_at: new Date().toISOString()
          }
        ];
        data = isSingle ? contacts[0] : contacts;
      } else if (table === 'credit_transactions') {
        const transactions = [
          { id: 'tx-001', type: 'earned', amount: 50,  reason: 'SOS response — Priya needed help',        date: 'Today, 2:35 PM' },
          { id: 'tx-002', type: 'earned', amount: 50,  reason: 'SOS response — Anjali M.',                 date: 'Yesterday, 9:12 PM' },
          { id: 'tx-003', type: 'bonus',  amount: 100, reason: 'Milestone Bonus: 10 assists completed', date: 'Jun 25' },
          { id: 'tx-004', type: 'earned', amount: 50,  reason: 'SOS response — Community assist',          date: 'Jun 24, 11:05 PM' },
          { id: 'tx-005', type: 'earned', amount: 25,  reason: 'Night Shift Bonus (10 PM – 4 AM)',         date: 'Jun 23, 11:58 PM' },
          { id: 'tx-006', type: 'earned', amount: 50,  reason: 'SOS response — Sneha R.',                  date: 'Jun 22, 8:40 PM' },
        ];
        data = isSingle ? transactions[0] : transactions;
      } else {
        const row = {
          id: 'sos-event-demo-12345',
          status: 'active',
          lat: 21.1458,
          lng: 79.0882,
        };
        data = isSingle ? row : [row];
      }
      return Promise.resolve(onfulfilled({ data, error: null }));
    }
  };

  const builderProxy: any = new Proxy(builder, {
    get: (target, prop) => {
      if (prop in target) return target[prop];
      if (prop === 'then') return target.then;
      return () => builderProxy;
    }
  });

  return builderProxy;
};

Object.defineProperty(client, 'from', {
  get() {
    if (isMockSessionActive) {
      return mockFrom;
    }
    return originalFrom.bind(client);
  }
});

export const supabase = client;

// ─────────────────────────────────────────────────────────────
// Convenience type aliases
// ─────────────────────────────────────────────────────────────
export type User               = Database['public']['Tables']['users']['Row'];
export type SOSEvent           = Database['public']['Tables']['sos_events']['Row'];
export type LocationStreamRow  = Database['public']['Tables']['location_stream']['Row'];
export type VolunteerResponse  = Database['public']['Tables']['volunteer_responses']['Row'];
export type EmergencyContact   = Database['public']['Tables']['emergency_contacts']['Row'];
export type ThreatZone         = Database['public']['Tables']['threat_zones']['Row'];
export type CreditTransaction  = Database['public']['Tables']['credit_transactions']['Row'];

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

/**
 * Returns the currently authenticated Supabase user,
 * along with their extended profile from the `users` table.
 */
export async function getCurrentUser(): Promise<User | null> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('[supabase] getCurrentUser error:', error.message);
    return null;
  }

  return data;
}

/**
 * Upserts the authenticated user's current GPS coordinates
 * into the `users` table, enabling volunteer proximity matching.
 */
export async function updateUserLocation(lat: number, lng: number): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const { error } = await supabase
    .from('users')
    .update({
      current_lat: lat,
      current_lng: lng,
      location_updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) {
    console.error('[supabase] updateUserLocation error:', error.message);
  }
}

export default supabase;
