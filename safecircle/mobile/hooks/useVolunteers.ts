import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface VolunteerResponse {
  id: string;
  sos_id: string;
  volunteer_id: string;
  status: 'notified' | 'accepted' | 'en_route' | 'arrived' | 'declined' | 'completed';
  response_time_seconds: number | null;
  victim_rating: number | null;
  credits_awarded: number;
}

export function useVolunteers() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const broadcastChannelRef = useRef<RealtimeChannel | null>(null);

  // Clean up any active broadcast channel on unmount
  useEffect(() => {
    return () => {
      if (broadcastChannelRef.current) {
        supabase.removeChannel(broadcastChannelRef.current);
      }
    };
  }, []);

  /**
   * Fetch the number of active, verified volunteers within a given radius
   */
  const fetchNearbyVolunteerCount = useCallback(async (
    lat: number,
    lng: number,
    radiusKm: number
  ): Promise<number> => {
    try {
      setLoading(true);
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error: rpcError } = await supabase.rpc('find_nearby_volunteers', {
        p_victim_lat: lat,
        p_victim_lng: lng,
        p_victim_id: user?.id || '00000000-0000-0000-0000-000000000000',
        p_radius_meters: radiusKm * 1000,
        p_limit: 100,
      });

      if (rpcError) throw rpcError;
      return data ? data.length : 0;
    } catch (err: any) {
      console.error('[useVolunteers] fetchNearbyVolunteerCount error:', err);
      setError(err.message || 'Failed to fetch volunteer count');
      return 0;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Accept an SOS response request
   */
  const acceptSOS = useCallback(async (volunteerResponseId: string): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);
      
      // Calculate response time since alert was created
      const { data: currentResponse, error: fetchErr } = await supabase
        .from('volunteer_responses')
        .select('created_at')
        .eq('id', volunteerResponseId)
        .single();
        
      if (fetchErr) throw fetchErr;
      
      const responseTime = currentResponse?.created_at
        ? Math.floor((Date.now() - new Date(currentResponse.created_at).getTime()) / 1000)
        : null;

      const { error: updateErr } = await supabase
        .from('volunteer_responses')
        .update({
          status: 'accepted',
          response_time_seconds: responseTime,
        })
        .eq('id', volunteerResponseId);

      if (updateErr) throw updateErr;

      // If accepted in less than 2 minutes, we could award fast-response credits
      if (responseTime !== null && responseTime <= 120) {
        // Let's call the award-credits edge function for 'accepted_fast'
        supabase.functions.invoke('award-credits', {
          body: { volunteer_response_id: volunteerResponseId, action_type: 'accepted_fast' }
        }).catch(err => console.warn('[useVolunteers] Accepted fast credits award failed:', err));
      }

      return true;
    } catch (err: any) {
      console.error('[useVolunteers] acceptSOS error:', err);
      setError(err.message || 'Failed to accept SOS');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Decline an SOS response request
   */
  const declineSOS = useCallback(async (volunteerResponseId: string): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);

      const { error: updateErr } = await supabase
        .from('volunteer_responses')
        .update({ status: 'declined' })
        .eq('id', volunteerResponseId);

      if (updateErr) throw updateErr;
      return true;
    } catch (err: any) {
      console.error('[useVolunteers] declineSOS error:', err);
      setError(err.message || 'Failed to decline SOS');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Confirm physical arrival at victim location and trigger credit payout
   */
  const confirmArrival = useCallback(async (volunteerResponseId: string): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);

      // 1. Mark status as arrived in volunteer_responses
      const { error: updateErr } = await supabase
        .from('volunteer_responses')
        .update({ status: 'arrived' })
        .eq('id', volunteerResponseId);

      if (updateErr) throw updateErr;

      // 2. Invoke the Supabase Edge Function to award credits (action_type: 'confirmed_assist')
      const { error: edgeErr } = await supabase.functions.invoke('award-credits', {
        body: {
          volunteer_response_id: volunteerResponseId,
          action_type: 'confirmed_assist',
        },
      });

      if (edgeErr) throw edgeErr;
      return true;
    } catch (err: any) {
      console.error('[useVolunteers] confirmArrival error:', err);
      setError(err.message || 'Failed to confirm arrival');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Submit rating of the interaction (which can award additional credits if rated 5 stars)
   */
  const rateInteraction = useCallback(async (
    volunteerResponseId: string,
    rating: number
  ): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);

      // Update the rating in volunteer_responses
      const { error: updateErr } = await supabase
        .from('volunteer_responses')
        .update({ victim_rating: rating })
        .eq('id', volunteerResponseId);

      if (updateErr) throw updateErr;

      // If rated 5 stars, call the award-credits edge function
      if (rating === 5) {
        const { error: edgeErr } = await supabase.functions.invoke('award-credits', {
          body: {
            volunteer_response_id: volunteerResponseId,
            action_type: 'rated_5star',
          },
        });
        if (edgeErr) console.warn('[useVolunteers] Rated 5star credits award failed:', edgeErr);
      }

      return true;
    } catch (err: any) {
      console.error('[useVolunteers] rateInteraction error:', err);
      setError(err.message || 'Failed to submit rating');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Subscribe to new incoming alerts for a volunteer
   */
  const subscribeToNewAlerts = useCallback((
    volunteerId: string,
    onAlertReceived: (alert: VolunteerResponse) => void
  ) => {
    console.log(`[useVolunteers] Subscribing to new alerts for volunteer: ${volunteerId}`);
    
    const channel = supabase
      .channel(`new-alerts:${volunteerId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT or UPDATE
          schema: 'public',
          table: 'volunteer_responses',
          filter: `volunteer_id=eq.${volunteerId}`,
        },
        (payload) => {
          const newRow = payload.new as VolunteerResponse;
          if (newRow && (newRow.status === 'notified')) {
            onAlertReceived(newRow);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  /**
   * Stream volunteer GPS location in real-time to the database and broadcast to the victim
   */
  const shareVolunteerLocation = useCallback(async (
    sosId: string,
    lat: number,
    lng: number
  ): Promise<void> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Update users table with current location
      const { error: dbErr } = await supabase
        .from('users')
        .update({
          current_lat: lat,
          current_lng: lng,
          location_updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (dbErr) throw dbErr;

      // 2. Initialise and broadcast via Realtime channel
      let channel = broadcastChannelRef.current;
      if (!channel) {
        channel = supabase.channel(`sos_sharing:${sosId}`);
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[useVolunteers] Broadcast channel subscribed for SOS: ${sosId}`);
          }
        });
        broadcastChannelRef.current = channel;
      }

      channel.send({
        type: 'broadcast',
        event: 'volunteer_location',
        payload: { volunteerId: user.id, lat, lng },
      });
      
    } catch (err) {
      console.error('[useVolunteers] shareVolunteerLocation error:', err);
    }
  }, []);

  return {
    loading,
    error,
    fetchNearbyVolunteerCount,
    acceptSOS,
    declineSOS,
    confirmArrival,
    rateInteraction,
    subscribeToNewAlerts,
    shareVolunteerLocation,
  };
}

export default useVolunteers;
