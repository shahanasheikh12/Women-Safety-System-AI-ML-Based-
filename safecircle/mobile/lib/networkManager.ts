import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import { supabase } from './supabase';

const OFFLINE_SOS_KEY = 'OFFLINE_SOS_QUEUE';
const CONTACTS_CACHE_KEY = 'EMERGENCY_CONTACTS_CACHE';

interface RetryItem {
  id: string;
  fnString: string; // Serialized Supabase query metadata
  params: any;
  retries: number;
  maxRetries: number;
}

export class NetworkManager {
  private static instance: NetworkManager;
  private connected: boolean = true;
  private type: string = 'wifi';
  private listeners: Set<(connected: boolean) => void> = new Set();
  private isSyncing: boolean = false;

  private constructor() {
    this.init();
  }

  static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  private async init() {
    NetInfo.fetch().then((state) => {
      this.updateState(state);
    });

    NetInfo.addEventListener((state) => {
      this.updateState(state);
    });
  }

  private updateState(state: NetInfoState) {
    const wasOffline = !this.connected;
    this.connected = !!state.isConnected;
    this.type = state.type;

    this.listeners.forEach((cb) => cb(this.connected));

    // If connection was restored, trigger offline synchronization
    if (wasOffline && this.connected) {
      console.log('[NetworkManager] Connection restored. Syncing offline cache.');
      this.syncOfflineSOS().catch((err) => {
        console.error('[NetworkManager] Failed to sync offline SOS:', err);
      });
    }
  }

  subscribe(callback: (connected: boolean) => void): () => void {
    this.listeners.add(callback);
    callback(this.connected); // Send current state instantly
    return () => {
      this.listeners.delete(callback);
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectionType(): string {
    return this.type;
  }

  // Caches contacts for offline use
  static async cacheEmergencyContacts(contacts: { phone: string }[]) {
    try {
      const numbers = contacts.map((c) => c.phone).filter(Boolean);
      await AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(numbers));
    } catch (err) {
      console.error('[NetworkManager] Failed to cache contacts:', err);
    }
  }

  // Executes a Supabase call with exponential backoff retry mechanism
  async executeWithRetry<T>(
    operation: () => Promise<{ data: T; error: any }>,
    maxRetries: number = 3
  ): Promise<T> {
    let delay = 1000; // start with 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.connected) {
          throw new Error('Device is offline.');
        }

        const { data, error } = await operation();
        if (error) throw error;
        return data;
      } catch (err) {
        console.warn(`[NetworkManager] Operation failed (Attempt ${attempt}/${maxRetries}):`, err);
        if (attempt === maxRetries) {
          throw err;
        }
        // Wait with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // double delay time
      }
    }
    throw new Error('Execution failed after retries.');
  }

  // Offline SOS handling
  async triggerOfflineSOS(lat: number, lng: number, userId: string, method: string) {
    console.log('[NetworkManager] Offline SOS triggered. Saving alert locally.');

    const offlineEvent = {
      id: `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      user_id: userId,
      started_at: new Date().toISOString(),
      location_lat: lat,
      location_lng: lng,
      trigger_method: method,
      status: 'active',
    };

    try {
      // 1. Save locally
      const queueStr = await AsyncStorage.getItem(OFFLINE_SOS_KEY);
      const queue = queueStr ? JSON.parse(queueStr) : [];
      queue.push(offlineEvent);
      await AsyncStorage.setItem(OFFLINE_SOS_KEY, JSON.stringify(queue));

      // 2. Load cached contacts & send SMS
      const contactsStr = await AsyncStorage.getItem(CONTACTS_CACHE_KEY);
      const phoneNumbers: string[] = contactsStr ? JSON.parse(contactsStr) : [];

      if (phoneNumbers.length > 0) {
        const separator = Platform.OS === 'ios' ? ',' : ';';
        const mapLink = `https://maps.google.com/?q=${lat},${lng}`;
        const message = `🚨 SafeCircle EMERGENCY SOS! I need help immediately. Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}. Location Link: ${mapLink}`;
        const url = `sms:${phoneNumbers.join(separator)}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`;

        await Linking.openURL(url);
      } else {
        console.warn('[NetworkManager] No emergency contacts cached. Cannot dispatch SMS.');
      }

      return offlineEvent;
    } catch (err) {
      console.error('[NetworkManager] Failed to run offline SOS handler:', err);
      throw err;
    }
  }

  // Synchronize cached offline events back to Supabase
  async syncOfflineSOS() {
    if (this.isSyncing || !this.connected) return;
    this.isSyncing = true;

    try {
      const queueStr = await AsyncStorage.getItem(OFFLINE_SOS_KEY);
      if (!queueStr) return;

      const queue = JSON.parse(queueStr);
      if (queue.length === 0) return;

      console.log(`[NetworkManager] Found ${queue.length} offline SOS events. Syncing now...`);

      const remainingQueue = [];

      for (const event of queue) {
        try {
          // Sync event record
          const { error } = await supabase.from('sos_events').insert({
            id: event.id.startsWith('offline-') ? undefined : event.id, // let Supabase auto-assign if mock ID
            user_id: event.user_id,
            started_at: event.started_at,
            location_lat: event.location_lat,
            location_lng: event.location_lng,
            trigger_method: event.trigger_method,
            status: event.status,
          });

          if (error) throw error;
          console.log(`[NetworkManager] Offline SOS event synced successfully:`, event.id);
        } catch (err) {
          console.error(`[NetworkManager] Failed to sync offline event ${event.id}:`, err);
          remainingQueue.push(event); // Keep in queue to retry later
        }
      }

      await AsyncStorage.setItem(OFFLINE_SOS_KEY, JSON.stringify(remainingQueue));
    } catch (err) {
      console.error('[NetworkManager] Error during offline SOS sync process:', err);
    } finally {
      this.isSyncing = false;
    }
  }
}
