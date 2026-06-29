/**
 * notify-volunteers/index.ts
 *
 * Supabase Edge Function — fires when an SOS is created.
 *
 * Flow:
 *  1. Parse POST body: { sos_id, victim_lat, victim_lng, user_id, radius_km? }
 *  2. Query nearby volunteers with PostGIS ST_DWithin
 *  3. Rank by (tier * 0.4 + trust_score * 0.006) DESC, then distance ASC
 *  4. Insert volunteer_responses rows + send Expo push notifications
 *  5. Escalation: 2 km → 5 km → update status='escalated' + notify contacts
 *  6. Return { volunteers_notified, escalated }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface RequestBody {
  sos_id: string;
  victim_lat: number;
  victim_lng: number;
  user_id: string;
  radius_km?: number;
}

interface NearbyVolunteer {
  id: string;
  fcm_token: string | null;
  verification_tier: number;
  trust_score: number;
  name: string | null;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: string;
  priority: string;
  badge?: number;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const EXPO_PUSH_URL  = 'https://exp.host/--/api/v2/push/send';
const MAX_VOLUNTEERS = 20;
const EXPO_BATCH_SIZE = 100; // Expo supports batching up to 100

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Builds an authenticated Supabase admin client using the service role key.
 * Edge functions always have access to SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
function makeAdminClient() {
  const url    = Deno.env.get('SUPABASE_URL')!;
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, secret, {
    auth: { persistSession: false },
  });
}

/**
 * Query volunteers within `radiusMeters` of the victim using PostGIS.
 * Returns ordered list: best-ranked first, then nearest first.
 */
async function findNearbyVolunteers(
  supabase: ReturnType<typeof makeAdminClient>,
  victimLat: number,
  victimLng: number,
  victimUserId: string,
  radiusMeters: number
): Promise<NearbyVolunteer[]> {
  // We use supabase.rpc with a raw SQL approach via a stored procedure,
  // OR we fall back to the JS client with a PostGIS filter via .rpc.
  // Since we cannot use .from().select() with ST_DWithin directly in the
  // JS client filter, we call a raw SQL via the admin REST API.

  const { data, error } = await supabase.rpc('find_nearby_volunteers', {
    p_victim_lat:    victimLat,
    p_victim_lng:    victimLng,
    p_victim_id:     victimUserId,
    p_radius_meters: radiusMeters,
    p_limit:         MAX_VOLUNTEERS,
  });

  if (error) {
    // Fallback: simple distance filter without PostGIS
    // (works if PostGIS extension is not yet active or RPC not deployed)
    console.warn('[notify-volunteers] PostGIS RPC failed, using fallback:', error.message);
    return await findNearbyVolunteersFallback(
      supabase,
      victimLat,
      victimLng,
      victimUserId,
      radiusMeters
    );
  }

  return (data as NearbyVolunteer[]) ?? [];
}

/**
 * Fallback: Haversine approximation when PostGIS RPC is unavailable.
 * Fetches all volunteers then filters client-side (only safe for small volunteer sets).
 */
async function findNearbyVolunteersFallback(
  supabase: ReturnType<typeof makeAdminClient>,
  victimLat: number,
  victimLng: number,
  victimUserId: string,
  radiusMeters: number
): Promise<NearbyVolunteer[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, fcm_token, verification_tier, trust_score, name, current_lat, current_lng')
    .eq('is_volunteer', true)
    .gte('verification_tier', 1)
    .neq('id', victimUserId)
    .not('current_lat', 'is', null)
    .not('current_lng', 'is', null)
    .not('fcm_token', 'is', null);

  if (error || !data) return [];

  const radiusKm = radiusMeters / 1000;

  return (data as (NearbyVolunteer & { current_lat: number; current_lng: number })[])
    .filter((v) => {
      const dist = haversineKm(victimLat, victimLng, v.current_lat, v.current_lng);
      return dist <= radiusKm;
    })
    .sort((a, b) => {
      const scoreA = a.verification_tier * 0.4 + a.trust_score * 0.006;
      const scoreB = b.verification_tier * 0.4 + b.trust_score * 0.006;
      return scoreB - scoreA;
    })
    .slice(0, MAX_VOLUNTEERS);
}

/** Haversine distance in kilometres */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Insert a volunteer_responses row for each notified volunteer.
 * Uses upsert to avoid duplicates if function is called multiple times.
 */
async function insertVolunteerResponses(
  supabase: ReturnType<typeof makeAdminClient>,
  sosId: string,
  volunteers: NearbyVolunteer[]
): Promise<void> {
  if (volunteers.length === 0) return;

  const rows = volunteers.map((v) => ({
    sos_id:       sosId,
    volunteer_id: v.id,
    status:       'notified' as const,
  }));

  const { error } = await supabase
    .from('volunteer_responses')
    .upsert(rows, { onConflict: 'sos_id,volunteer_id', ignoreDuplicates: true });

  if (error) {
    console.error('[notify-volunteers] insertVolunteerResponses error:', error.message);
  }
}

/**
 * Send Expo push notifications in batches of 100.
 * Silently skips volunteers with null/invalid push tokens.
 */
async function sendExpoPushNotifications(
  volunteers: NearbyVolunteer[],
  sosId: string,
  victimLat: number,
  victimLng: number
): Promise<void> {
  const messages: ExpoPushMessage[] = volunteers
    .filter((v) => v.fcm_token && v.fcm_token.startsWith('ExponentPushToken'))
    .map((v) => ({
      to:       v.fcm_token!,
      title:    '🚨 Emergency Nearby',
      body:     'A woman needs help within 2km. Tap to respond immediately.',
      data:     {
        sos_id:     sosId,
        type:       'sos_alert',
        victim_lat: victimLat,
        victim_lng: victimLng,
        screen:     'volunteer-alert',
      },
      sound:    'default',
      priority: 'high',
      badge:    1,
    }));

  if (messages.length === 0) {
    console.log('[notify-volunteers] No valid Expo push tokens found.');
    return;
  }

  // Batch into chunks of EXPO_BATCH_SIZE
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':        'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[notify-volunteers] Expo push batch ${i} failed:`, text);
      } else {
        console.log(`[notify-volunteers] Expo push batch ${i}: OK (${batch.length} msgs)`);
      }
    } catch (err) {
      console.error(`[notify-volunteers] Expo push fetch error:`, err);
    }
  }
}

/**
 * Escalation: escalate the SOS event status and fire the
 * stream-emergency-contacts function to notify the victim's contacts.
 */
async function escalateSOS(
  supabase: ReturnType<typeof makeAdminClient>,
  sosId: string,
  userId: string
): Promise<void> {
  // Mark SOS as escalated
  const { error: updateError } = await supabase
    .from('sos_events')
    .update({ status: 'escalated' })
    .eq('id', sosId);

  if (updateError) {
    console.error('[notify-volunteers] escalateSOS update error:', updateError.message);
  }

  // Fire stream-emergency-contacts function
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/stream-emergency-contacts`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ sos_id: sosId, user_id: userId }),
      }
    );
    if (!res.ok) {
      console.warn('[notify-volunteers] stream-emergency-contacts call failed:', await res.text());
    }
  } catch (err) {
    console.error('[notify-volunteers] stream-emergency-contacts fetch error:', err);
  }
}

// ─────────────────────────────────────────────────────────────
// CORS headers
// ─────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Parse body ──────────────────────────────────────────
    const body = (await req.json()) as RequestBody;
    const {
      sos_id,
      victim_lat,
      victim_lng,
      user_id,
      radius_km = 2,
    } = body;

    if (!sos_id || !victim_lat || !victim_lng || !user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: sos_id, victim_lat, victim_lng, user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = makeAdminClient();
    let escalated = false;

    // ── Phase 1: search at requested radius (default 2 km) ──
    console.log(`[notify-volunteers] Searching within ${radius_km}km of (${victim_lat}, ${victim_lng})`);
    let volunteers = await findNearbyVolunteers(
      supabase,
      victim_lat,
      victim_lng,
      user_id,
      radius_km * 1000
    );

    // ── Phase 2: expand to 5 km if none found ──────────────
    if (volunteers.length === 0 && radius_km < 5) {
      console.log('[notify-volunteers] No volunteers at 2km — expanding to 5km');
      volunteers = await findNearbyVolunteers(
        supabase,
        victim_lat,
        victim_lng,
        user_id,
        5000
      );
    }

    // ── Phase 3: escalate if still nobody ──────────────────
    if (volunteers.length === 0) {
      console.warn('[notify-volunteers] No volunteers found within 5km — escalating');
      await escalateSOS(supabase, sos_id, user_id);
      escalated = true;
    } else {
      // ── Insert DB records ─────────────────────────────────
      await insertVolunteerResponses(supabase, sos_id, volunteers);

      // ── Send push notifications ───────────────────────────
      await sendExpoPushNotifications(volunteers, sos_id, victim_lat, victim_lng);

      console.log(`[notify-volunteers] Notified ${volunteers.length} volunteers for SOS ${sos_id}`);
    }

    // ── Always notify emergency contacts on SOS fire ────────
    // (runs in background, don't await to avoid timeout)
    fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/stream-emergency-contacts`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ sos_id, user_id }),
      }
    ).catch((e) => console.warn('[notify-volunteers] background contact notify error:', e));

    return new Response(
      JSON.stringify({
        volunteers_notified: volunteers.length,
        escalated,
      }),
      {
        status:  200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (err) {
    console.error('[notify-volunteers] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
