# SafeCircle — Edge Function Environment Variables

All secrets are set via the Supabase CLI:
```bash
supabase secrets set KEY=value
```

Or using the deploy script which reads them from your shell environment:
```bash
export WHATSAPP_PHONE_NUMBER_ID="..."
./supabase/deploy.sh
```

---

## Auto-Provided by Supabase (no setup needed)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your project's REST API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key — bypasses RLS |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_DB_URL` | Direct Postgres connection string |

---

## Required — Push Notifications (Expo)

No setup needed — Expo Push Service is free and requires no API key.
The `fcm_token` stored per user must be a valid `ExponentPushToken[...]` string.

Push tokens are obtained client-side:
```ts
import * as Notifications from 'expo-notifications';
const { data: token } = await Notifications.getExpoPushTokenAsync();
// Save token to users.fcm_token via Supabase
```

---

## Required — Emergency Contact Notifications

### WhatsApp (Meta Cloud API) — Free tier: 1,000 conversations/month

| Variable | Where to get it |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Developer Console → WhatsApp → API Setup |
| `WHATSAPP_ACCESS_TOKEN` | Meta Developer Console → System User permanent token |

**Setup steps:**
1. Go to https://developers.facebook.com/
2. Create a Business App → Add WhatsApp product
3. Get Phone Number ID from "API Setup"
4. Create a System User with `whatsapp_business_messaging` permission
5. Generate a permanent access token

```bash
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=123456789012345
supabase secrets set WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxx
```

---

## Optional — SMS Fallback (Twilio)

Only needed if WhatsApp is unavailable. Free trial: $15 credit.

| Variable | Where to get it |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Console → Dashboard |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Dashboard |
| `TWILIO_FROM_NUMBER` | Twilio Console → Phone Numbers (E.164 format: `+14155552671`) |

```bash
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_FROM_NUMBER=+14155552671
```

---

## Optional — Custom Public URL

| Variable | Description |
|---|---|
| `SAFECIRCLE_PUBLIC_URL` | Base URL for shareable SOS live-location links (default: Supabase URL) |

Example:
```bash
supabase secrets set SAFECIRCLE_PUBLIC_URL=https://safecircle.app
# Generates links like: https://safecircle.app/sos-live/<sos_id>
```

---

## Viewing & Managing Secrets

```bash
# List all set secrets
supabase secrets list

# Set a secret
supabase secrets set KEY=value

# Delete a secret
supabase secrets unset KEY
```

---

## Verify All Secrets Are Set

```bash
supabase secrets list | grep -E "WHATSAPP|TWILIO|SAFECIRCLE"
```

---

## Edge Function URLs (after deploy)

```
https://<project-ref>.supabase.co/functions/v1/notify-volunteers
https://<project-ref>.supabase.co/functions/v1/award-credits
https://<project-ref>.supabase.co/functions/v1/stream-emergency-contacts
```

Find your project ref: `supabase status` or Supabase Dashboard → Project Settings → General.
