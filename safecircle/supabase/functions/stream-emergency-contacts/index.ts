/**
 * stream-emergency-contacts/index.ts
 *
 * Supabase Edge Function — notifies a victim's emergency contacts when SOS fires.
 *
 * Flow:
 *  1. Parse POST: { sos_id, user_id }
 *  2. Fetch victim's name and emergency_contacts (notify_on_sos = true)
 *  3. Build a public shareable live-location URL for this SOS
 *  4. For each contact:
 *     a. Try WhatsApp via Meta Cloud API (free tier)
 *     b. Fallback: log SMS URL (Twilio) for manual use in MVP
 *  5. Return { contacts_notified, failed_contacts, public_url }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface RequestBody {
  sos_id: string;
  user_id: string;
}

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
}

interface NotifyResult {
  contact_id: string;
  name: string;
  phone: string;
  method: 'whatsapp' | 'sms_fallback' | 'failed';
  success: boolean;
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
// URL builder
// ─────────────────────────────────────────────────────────────

/**
 * Builds a public shareable live-location URL for this SOS.
 * Format: https://<project-ref>.supabase.co/sos-live/<sos_id>
 *
 * In production this would be your custom domain / web app URL.
 * For MVP we use the Supabase project URL as the base.
 */
function buildPublicSosUrl(sosId: string): string {
  const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
  // Prefer a custom public web URL if configured
  const publicWebUrl = Deno.env.get('SAFECIRCLE_PUBLIC_URL') ?? projectUrl;
  return `${publicWebUrl}/sos-live/${sosId}`;
}

// ─────────────────────────────────────────────────────────────
// WhatsApp via Meta Cloud API
// ─────────────────────────────────────────────────────────────

/**
 * Sends a WhatsApp message via Meta Cloud API.
 *
 * Required env vars:
 *   WHATSAPP_PHONE_NUMBER_ID   — from Meta developer console
 *   WHATSAPP_ACCESS_TOKEN      — permanent system user token
 *
 * Phone number must be in E.164 format without '+', e.g. "919876543210".
 */
async function sendWhatsApp(
  toPhone: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const accessToken   = Deno.env.get('WHATSAPP_ACCESS_TOKEN');

  if (!phoneNumberId || !accessToken) {
    return { success: false, error: 'WhatsApp credentials not configured' };
  }

  // Normalise phone: strip non-digits, ensure no leading '+'
  const e164 = toPhone.replace(/\D/g, '');

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:                e164,
          type:              'text',
          text:              { preview_url: true, body: message },
        }),
      }
    );

    if (res.ok) {
      const data = await res.json();
      console.log(`[stream-emergency-contacts] WhatsApp sent to ${e164}:`, data.messages?.[0]?.id);
      return { success: true };
    } else {
      const err = await res.text();
      console.warn(`[stream-emergency-contacts] WhatsApp failed for ${e164}:`, err);
      return { success: false, error: err };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────
// SMS fallback (Twilio — URL construction only for MVP)
// ─────────────────────────────────────────────────────────────

/**
 * Attempts to send SMS via Twilio REST API.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER   — E.164, e.g. "+14155552671"
 *
 * Falls back gracefully (logs URL) if not configured.
 */
async function sendTwilioSMS(
  toPhone: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

  if (!accountSid || !authToken || !fromNumber) {
    // MVP fallback: log a pre-filled URL so operators can act manually
    const smsUrl = `sms:${toPhone}?body=${encodeURIComponent(message)}`;
    console.log(`[stream-emergency-contacts] SMS fallback URL for ${toPhone}: ${smsUrl}`);
    return { success: false, error: 'Twilio not configured — SMS URL logged' };
  }

  try {
    const body = new URLSearchParams({
      To:   toPhone,
      From: fromNumber,
      Body: message,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }
    );

    if (res.ok) {
      const data = await res.json();
      console.log(`[stream-emergency-contacts] Twilio SMS sent to ${toPhone}:`, data.sid);
      return { success: true };
    } else {
      const err = await res.text();
      console.warn(`[stream-emergency-contacts] Twilio SMS failed for ${toPhone}:`, err);
      return { success: false, error: err };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────
// Main notification dispatcher
// ─────────────────────────────────────────────────────────────
async function notifyContact(
  contact: EmergencyContact,
  message: string
): Promise<NotifyResult> {
  // 1. Try WhatsApp first
  const waResult = await sendWhatsApp(contact.phone, message);
  if (waResult.success) {
    return {
      contact_id: contact.id,
      name:       contact.name,
      phone:      contact.phone,
      method:     'whatsapp',
      success:    true,
    };
  }

  // 2. Fallback to SMS (Twilio or logged URL)
  const smsResult = await sendTwilioSMS(contact.phone, message);
  if (smsResult.success) {
    return {
      contact_id: contact.id,
      name:       contact.name,
      phone:      contact.phone,
      method:     'sms_fallback',
      success:    true,
    };
  }

  // 3. Both failed
  console.error(
    `[stream-emergency-contacts] Failed to notify ${contact.name} (${contact.phone})`,
    'WhatsApp:', waResult.error,
    'SMS:', smsResult.error
  );
  return {
    contact_id: contact.id,
    name:       contact.name,
    phone:      contact.phone,
    method:     'failed',
    success:    false,
  };
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
    const { sos_id, user_id } = body;

    if (!sos_id || !user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: sos_id, user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = makeAdminClient();

    // ── Fetch victim's name ─────────────────────────────────
    const { data: victim, error: victimErr } = await supabase
      .from('users')
      .select('name')
      .eq('id', user_id)
      .single<{ name: string | null }>();

    if (victimErr) {
      console.warn('[stream-emergency-contacts] Failed to fetch victim:', victimErr.message);
    }
    const victimName = victim?.name ?? 'Someone';

    // ── Fetch emergency contacts ────────────────────────────
    const { data: contacts, error: contactsErr } = await supabase
      .from('emergency_contacts')
      .select('id, name, phone, relationship')
      .eq('user_id', user_id)
      .eq('notify_on_sos', true);

    if (contactsErr || !contacts || contacts.length === 0) {
      console.log('[stream-emergency-contacts] No emergency contacts found for user:', user_id);
      return new Response(
        JSON.stringify({
          contacts_notified:  0,
          failed_contacts:    0,
          public_url:         buildPublicSosUrl(sos_id),
          message:            'No emergency contacts configured',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Build public SOS URL ────────────────────────────────
    const publicUrl = buildPublicSosUrl(sos_id);

    // ── Build message ───────────────────────────────────────
    const alertMessage =
      `🚨 EMERGENCY ALERT\n\n` +
      `${victimName} has triggered an emergency SOS on SafeCircle and may be in danger.\n\n` +
      `📍 Live location: ${publicUrl}\n\n` +
      `Please check on them immediately or call emergency services (112).\n\n` +
      `— SafeCircle Safety Network`;

    // ── Notify all contacts in parallel ────────────────────
    console.log(`[stream-emergency-contacts] Notifying ${contacts.length} contacts for SOS ${sos_id}`);

    const results = await Promise.all(
      (contacts as EmergencyContact[]).map((c) => notifyContact(c, alertMessage))
    );

    const notified = results.filter((r) => r.success).length;
    const failed   = results.filter((r) => !r.success).length;

    console.log(`[stream-emergency-contacts] Done: ${notified} notified, ${failed} failed`);

    return new Response(
      JSON.stringify({
        contacts_notified: notified,
        failed_contacts:   failed,
        public_url:        publicUrl,
        results,
      }),
      {
        status:  200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (err) {
    console.error('[stream-emergency-contacts] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
