/**
 * award-credits/index.ts
 *
 * Supabase Edge Function — awards credits to volunteers after an SOS event.
 *
 * Flow:
 *  1. Parse POST: { volunteer_response_id, action_type }
 *  2. Look up volunteer_response → get volunteer_id + sos_id
 *  3. Compute credit delta from action_type
 *  4. UPDATE users.credits atomically via RPC
 *  5. INSERT credit_transactions audit row
 *  6. Check milestone badges (5 assists → Silver Shield, 20 → Gold Champion)
 *  7. Return { credits_awarded, new_total, badge_earned }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type ActionType = 'accepted_fast' | 'confirmed_assist' | 'rated_5star' | 'false_report';

interface RequestBody {
  volunteer_response_id: string;
  action_type: ActionType;
}

interface VolunteerResponseRow {
  id: string;
  sos_id: string;
  volunteer_id: string;
  status: string;
  credits_awarded: number;
}

interface UserRow {
  id: string;
  credits: number;
  raw_user_meta_data?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Credit amounts
// ─────────────────────────────────────────────────────────────
const CREDIT_AMOUNTS: Record<ActionType, number> = {
  accepted_fast:    10,   // responded within 2 min
  confirmed_assist: 50,   // physically arrived and helped
  rated_5star:      25,   // victim gave 5-star rating
  false_report:    -100,  // penalty for abuse
};

// ─────────────────────────────────────────────────────────────
// Milestone definitions
// ─────────────────────────────────────────────────────────────
const MILESTONES: Array<{
  assists: number;
  badge: string;
  bonusCredits: number;
}> = [
  { assists:  5, badge: 'Silver Shield',  bonusCredits:    0 },
  { assists: 20, badge: 'Gold Champion',  bonusCredits: 500 },
];

// ─────────────────────────────────────────────────────────────
// CORS headers
// ─────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─────────────────────────────────────────────────────────────
// Admin client
// ─────────────────────────────────────────────────────────────
function makeAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Atomically update a user's credit balance.
 * Uses a raw SQL RPC to avoid race conditions (credits = credits + delta).
 */
async function updateCreditsAtomic(
  supabase: ReturnType<typeof makeAdminClient>,
  userId: string,
  delta: number
): Promise<number> {
  // Try the stored procedure first (preferred — atomic)
  const { data: rpcData, error: rpcError } = await supabase.rpc('increment_credits', {
    p_user_id: userId,
    p_delta:   delta,
  });

  if (!rpcError && rpcData !== null) {
    return rpcData as number; // returns new balance
  }

  // Fallback: read-modify-write (non-atomic, acceptable for MVP)
  console.warn('[award-credits] increment_credits RPC unavailable, using fallback:', rpcError?.message);

  const { data: user, error: fetchErr } = await supabase
    .from('users')
    .select('id, credits')
    .eq('id', userId)
    .single<UserRow>();

  if (fetchErr || !user) {
    throw new Error(`Failed to fetch user for credit update: ${fetchErr?.message}`);
  }

  const newTotal = Math.max(0, (user.credits ?? 0) + delta); // floor at 0

  const { error: updateErr } = await supabase
    .from('users')
    .update({ credits: newTotal })
    .eq('id', userId);

  if (updateErr) throw new Error(`Failed to update credits: ${updateErr.message}`);
  return newTotal;
}

/**
 * Insert a credit_transactions audit record.
 */
async function insertTransaction(
  supabase: ReturnType<typeof makeAdminClient>,
  userId: string,
  amount: number,
  reason: string,
  sosId: string
): Promise<void> {
  const { error } = await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount,
    reason,
    sos_id:  sosId,
  });
  if (error) {
    console.error('[award-credits] insertTransaction error:', error.message);
  }
}

/**
 * Count total confirmed assists for a volunteer across all SOS events.
 */
async function countTotalAssists(
  supabase: ReturnType<typeof makeAdminClient>,
  volunteerId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('volunteer_responses')
    .select('id', { count: 'exact', head: true })
    .eq('volunteer_id', volunteerId)
    .eq('status', 'completed');

  if (error) {
    console.warn('[award-credits] countTotalAssists error:', error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Read the current badge list from Supabase Auth user metadata.
 */
async function getUserBadges(
  supabase: ReturnType<typeof makeAdminClient>,
  userId: string
): Promise<string[]> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) return [];
  const meta = data.user.user_metadata ?? {};
  return Array.isArray(meta.badges) ? (meta.badges as string[]) : [];
}

/**
 * Add a badge to the user's auth metadata and optionally award bonus credits.
 * Returns the badge name if newly awarded, or null if already held.
 */
async function awardBadge(
  supabase: ReturnType<typeof makeAdminClient>,
  userId: string,
  badge: string,
  bonusCredits: number,
  sosId: string
): Promise<string | null> {
  const existingBadges = await getUserBadges(supabase, userId);

  if (existingBadges.includes(badge)) {
    return null; // already earned
  }

  const newBadges = [...existingBadges, badge];

  // Update auth metadata
  const { error: metaErr } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { badges: newBadges, last_badge: badge },
  });

  if (metaErr) {
    console.error('[award-credits] awardBadge metadata error:', metaErr.message);
    return null;
  }

  // Award bonus credits if any
  if (bonusCredits > 0) {
    await updateCreditsAtomic(supabase, userId, bonusCredits);
    await insertTransaction(
      supabase,
      userId,
      bonusCredits,
      `Milestone bonus: ${badge}`,
      sosId
    );
    console.log(`[award-credits] Awarded ${bonusCredits} bonus credits for milestone: ${badge}`);
  }

  return badge;
}

/**
 * Check all milestones and award badges if newly reached.
 * Returns the name of the first newly-earned badge (or null).
 */
async function checkAndAwardMilestones(
  supabase: ReturnType<typeof makeAdminClient>,
  volunteerId: string,
  totalAssists: number,
  sosId: string
): Promise<string | null> {
  for (const milestone of MILESTONES) {
    if (totalAssists >= milestone.assists) {
      const earned = await awardBadge(
        supabase,
        volunteerId,
        milestone.badge,
        milestone.bonusCredits,
        sosId
      );
      if (earned) {
        console.log(`[award-credits] 🏆 Milestone badge earned: ${earned}`);
        return earned;
      }
    }
  }
  return null;
}

/**
 * Mark the volunteer_response as completed and record credits_awarded.
 */
async function updateResponseCredits(
  supabase: ReturnType<typeof makeAdminClient>,
  responseId: string,
  creditsAwarded: number
): Promise<void> {
  const { error } = await supabase
    .from('volunteer_responses')
    .update({
      credits_awarded: creditsAwarded,
      status: 'completed',
    })
    .eq('id', responseId);

  if (error) {
    console.warn('[award-credits] updateResponseCredits error:', error.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Parse body ──────────────────────────────────────────
    const body = (await req.json()) as RequestBody;
    const { volunteer_response_id, action_type } = body;

    if (!volunteer_response_id || !action_type) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: volunteer_response_id, action_type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const creditDelta = CREDIT_AMOUNTS[action_type];
    if (creditDelta === undefined) {
      return new Response(
        JSON.stringify({ error: `Unknown action_type: ${action_type}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = makeAdminClient();

    // ── Fetch volunteer_response row ────────────────────────
    const { data: response, error: respErr } = await supabase
      .from('volunteer_responses')
      .select('id, sos_id, volunteer_id, status, credits_awarded')
      .eq('id', volunteer_response_id)
      .single<VolunteerResponseRow>();

    if (respErr || !response) {
      return new Response(
        JSON.stringify({ error: 'Volunteer response not found', detail: respErr?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { volunteer_id, sos_id } = response;

    console.log(`[award-credits] action=${action_type} volunteer=${volunteer_id} delta=${creditDelta}`);

    // ── Atomically update credits ───────────────────────────
    const newTotal = await updateCreditsAtomic(supabase, volunteer_id, creditDelta);

    // ── Insert transaction record ───────────────────────────
    const reasonMap: Record<ActionType, string> = {
      accepted_fast:    'Fast response to SOS (within 2 min)',
      confirmed_assist: 'Confirmed physical assistance to SOS victim',
      rated_5star:      'Received 5-star rating from SOS victim',
      false_report:     'Penalty: false report / abuse of system',
    };

    await insertTransaction(supabase, volunteer_id, creditDelta, reasonMap[action_type], sos_id);

    // ── Update volunteer_response if assist confirmed ───────
    if (action_type === 'confirmed_assist') {
      await updateResponseCredits(supabase, volunteer_response_id, creditDelta);
    }

    // ── Check milestone badges ──────────────────────────────
    let badgeEarned: string | null = null;
    if (action_type === 'confirmed_assist') {
      const totalAssists = await countTotalAssists(supabase, volunteer_id);
      badgeEarned = await checkAndAwardMilestones(supabase, volunteer_id, totalAssists, sos_id);
    }

    // ── Return result ───────────────────────────────────────
    return new Response(
      JSON.stringify({
        credits_awarded: creditDelta,
        new_total:       newTotal,
        badge_earned:    badgeEarned,
      }),
      {
        status:  200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (err) {
    console.error('[award-credits] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
