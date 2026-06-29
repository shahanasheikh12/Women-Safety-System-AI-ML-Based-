#!/usr/bin/env bash
# ============================================================
# SafeCircle — Supabase Edge Functions Deploy Script
# ============================================================
# Usage:
#   chmod +x supabase/deploy.sh
#   ./supabase/deploy.sh
#
# Prerequisites:
#   1. Supabase CLI installed: npm install -g supabase
#   2. Logged in: supabase login
#   3. Project linked: supabase link --project-ref <ref>
#   4. Secrets set (see ENV VARIABLES section below)
# ============================================================

set -euo pipefail

# ── Colours ─────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
error()   { echo -e "${RED}[error]${RESET} $*"; exit 1; }

# ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}🚀 SafeCircle — Deploying Edge Functions${RESET}\n"
# ────────────────────────────────────────────────────────────

# ── Guard: must be run from the repo root or supabase/ dir ──
if [[ ! -f "supabase/functions/notify-volunteers/index.ts" && \
      ! -f "functions/notify-volunteers/index.ts" ]]; then
  error "Run this script from the project root (where supabase/ lives)."
fi

# ── Check supabase CLI is available ─────────────────────────
if ! command -v supabase &> /dev/null; then
  error "Supabase CLI not found. Install: npm install -g supabase"
fi

# ── Set required secrets (idempotent) ────────────────────────
# These env vars must exist in your shell before running.
# Or set them manually with: supabase secrets set KEY=value

info "Setting Supabase function secrets…"

REQUIRED_SECRETS=(
  "WHATSAPP_PHONE_NUMBER_ID"
  "WHATSAPP_ACCESS_TOKEN"
)

OPTIONAL_SECRETS=(
  "TWILIO_ACCOUNT_SID"
  "TWILIO_AUTH_TOKEN"
  "TWILIO_FROM_NUMBER"
  "SAFECIRCLE_PUBLIC_URL"
)

for secret in "${REQUIRED_SECRETS[@]}"; do
  if [[ -z "${!secret:-}" ]]; then
    warn "Required secret not set in shell: $secret"
    warn "Set it with: supabase secrets set ${secret}=<value>"
  else
    supabase secrets set "${secret}=${!secret}" 2>/dev/null && \
      success "Secret set: $secret" || \
      warn "Failed to set secret: $secret (may already exist)"
  fi
done

for secret in "${OPTIONAL_SECRETS[@]}"; do
  if [[ -n "${!secret:-}" ]]; then
    supabase secrets set "${secret}=${!secret}" 2>/dev/null && \
      success "Optional secret set: $secret" || true
  else
    info "Optional secret not configured: $secret (skipping)"
  fi
done

echo ""

# ── Deploy functions ─────────────────────────────────────────

FUNCTIONS=(
  "notify-volunteers"
  "award-credits"
  "stream-emergency-contacts"
)

FAILED=()

for fn in "${FUNCTIONS[@]}"; do
  info "Deploying: $fn …"
  if supabase functions deploy "$fn" --no-verify-jwt; then
    success "Deployed: $fn"
  else
    FAILED+=("$fn")
    warn "Failed to deploy: $fn"
  fi
  echo ""
done

# ── Summary ──────────────────────────────────────────────────
echo -e "${BOLD}── Deployment Summary ──────────────────────────────${RESET}"
for fn in "${FUNCTIONS[@]}"; do
  if printf '%s\n' "${FAILED[@]}" | grep -qx "$fn"; then
    echo -e "  ${RED}✗${RESET} $fn"
  else
    echo -e "  ${GREEN}✓${RESET} $fn"
  fi
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo ""
  error "${#FAILED[@]} function(s) failed to deploy. Check logs above."
fi

echo ""
success "All edge functions deployed successfully! 🎉"
echo ""
echo -e "${BOLD}Next steps:${RESET}"
echo "  1. Run the helper SQL migration:"
echo "     supabase db push   (or apply migrations/002_edge_function_helpers.sql manually)"
echo "  2. Verify functions in the Supabase dashboard → Edge Functions"
echo "  3. Test notify-volunteers:"
echo "     curl -X POST https://<ref>.supabase.co/functions/v1/notify-volunteers \\"
echo "       -H 'Authorization: Bearer <anon_key>' \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"sos_id\":\"<uuid>\",\"victim_lat\":28.6,\"victim_lng\":77.2,\"user_id\":\"<uuid>\"}'"
echo ""
