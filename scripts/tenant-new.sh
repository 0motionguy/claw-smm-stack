#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# tenant-new.sh — Onboard a new client tenant
# ═══════════════════════════════════════════════════════════════

source "$(dirname "$0")/../.env" 2>/dev/null || true

echo "═══════════════════════════════════════════════════════"
echo "  Claw SMM — New Tenant Onboarding"
echo "═══════════════════════════════════════════════════════"
echo ""

read -rp "Business Name: " TENANT_NAME
read -rp "Instagram Handle (without @): " IG_HANDLE
read -rp "Instagram User ID: " IG_USER_ID
read -rp "Brand Voice (e.g., warm, playful): " BRAND_VOICE
read -rp "Posting Frequency (daily/3x-week/5x-week): " POST_FREQ
read -rp "Timezone (e.g., UTC, Asia/Bali): " TIMEZONE
read -rp "No-Go Topics (comma-separated): " NO_GO_RAW
read -rp "Competitors (comma-separated @handles): " COMPETITORS_RAW

# Format arrays for PostgreSQL
NO_GO_TOPICS=$(echo "$NO_GO_RAW" | sed "s/,/','/g" | sed "s/^/'{'/;s/$/'}'/")
COMPETITORS=$(echo "$COMPETITORS_RAW" | sed "s/,/','/g" | sed "s/^/'{'/;s/$/'}'/")

echo ""
echo "Creating tenant in database..."

TENANT_ID=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "
  INSERT INTO tenants (name, ig_handle, ig_user_id, brand_voice, posting_frequency, timezone, no_go_topics, competitors)
  VALUES ('$TENANT_NAME', '$IG_HANDLE', '$IG_USER_ID', '$BRAND_VOICE', '$POST_FREQ', '$TIMEZONE', $NO_GO_TOPICS, $COMPETITORS)
  RETURNING id;
")

echo "Tenant created: $TENANT_ID"

echo "Creating Qdrant collection..."
curl -s -X PUT "http://localhost:6333/collections/tenant_${TENANT_ID}_context" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "size": 1536,
      "distance": "Cosine"
    }
  }' > /dev/null

echo "Qdrant collection created: tenant_${TENANT_ID}_context"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Onboarding Complete!"
echo "═══════════════════════════════════════════════════════"
echo "  Tenant ID:  $TENANT_ID"
echo "  IG Handle:  @$IG_HANDLE"
echo "  Status:     active"
echo ""
echo "  Next steps:"
echo "  1. Add Instagram access token via dashboard"
echo "  2. Configure Meta webhook for @$IG_HANDLE"
echo "  3. Send welcome briefing to client"
echo "═══════════════════════════════════════════════════════"
