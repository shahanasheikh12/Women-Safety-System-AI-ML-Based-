import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface LocationPoint {
  lat: number;
  lng: number;
  recorded_at: string;
  accuracy_meters?: number | null;
}

export interface UseRealtimeLocationReturn {
  /** Latest location received from the stream (null until first update) */
  latestLocation: LocationPoint | null;
  /** Full ordered history of location points received this session */
  locationHistory: LocationPoint[];
  /** Whether the channel subscription is established */
  isConnected: boolean;
  /** Subscribe as a volunteer to watch a victim's live location */
  subscribeAsVolunteer: (sosId: string, onUpdate: (point: LocationPoint) => void) => () => void;
}

// ─────────────────────────────────────────────────────────────
// Hook — useRealtimeLocation
//
// Subscribes to Supabase Realtime on the `location_stream` table
// filtered by `sos_id`, streaming INSERT events.
//
// Automatically unsubscribes when the component unmounts.
// ─────────────────────────────────────────────────────────────
export function useRealtimeLocation(sosId: string | null): UseRealtimeLocationReturn {
  const [latestLocation, setLatestLocation] = useState<LocationPoint | null>(null);
  const [locationHistory, setLocationHistory] = useState<LocationPoint[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!sosId) return;

    // Clean up any previous subscription
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channelName = `sos:${sosId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'location_stream',
          filter: `sos_id=eq.${sosId}`,
        },
        (payload) => {
          const row = payload.new as {
            lat: number;
            lng: number;
            recorded_at: string;
            accuracy_meters?: number | null;
          };

          const point: LocationPoint = {
            lat: row.lat,
            lng: row.lng,
            recorded_at: row.recorded_at,
            accuracy_meters: row.accuracy_meters ?? null,
          };

          setLatestLocation(point);
          setLocationHistory((prev) => [...prev, point]);
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') {
          console.log(`[useRealtimeLocation] Subscribed to channel: ${channelName}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`[useRealtimeLocation] Channel error on: ${channelName}`);
        }
      });

    channelRef.current = channel;

    // Auto-unsubscribe when component unmounts or sosId changes
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        setIsConnected(false);
      }
    };
  }, [sosId]);

  // ── subscribeAsVolunteer ─────────────────────────────────────
  /**
   * One-shot subscription used by volunteers to watch victim location.
   * Returns a cleanup function that removes the channel.
   *
   * @example
   *   const unsub = subscribeAsVolunteer(sosId, (pt) => updateMap(pt));
   *   // later:
   *   unsub();
   */
  const subscribeAsVolunteer = useCallback(
    (targetSosId: string, onUpdate: (point: LocationPoint) => void): (() => void) => {
      const volChannelName = `volunteer:sos:${targetSosId}:${Date.now()}`;

      const volChannel = supabase
        .channel(volChannelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'location_stream',
            filter: `sos_id=eq.${targetSosId}`,
          },
          (payload) => {
            const row = payload.new as {
              lat: number;
              lng: number;
              recorded_at: string;
              accuracy_meters?: number | null;
            };

            onUpdate({
              lat: row.lat,
              lng: row.lng,
              recorded_at: row.recorded_at,
              accuracy_meters: row.accuracy_meters ?? null,
            });
          }
        )
        .subscribe((status) => {
          console.log(`[useRealtimeLocation] Volunteer channel status: ${status}`);
        });

      // Return cleanup
      return () => {
        supabase.removeChannel(volChannel);
      };
    },
    []
  );

  return {
    latestLocation,
    locationHistory,
    isConnected,
    subscribeAsVolunteer,
  };
}

export default useRealtimeLocation;
