#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# secrets-rotate.sh — Rotate Meta tokens and API keys
# ═══════════════════════════════════════════════════════════════

source "$(dirname "$0")/../.env" 2>/dev/null || true

echo "═══════════════════════════════════════════════════════"
echo "  Claw SMM — Token Rotation"
echo "═══════════════════════════════════════════════════════"
echo ""

# Find tenants with tokens expiring within 10 days
EXPIRING=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "
  SELECT id, name, ig_handle, ig_token_expires_at
  FROM tenants
  WHERE status = 'active'
    AND ig_token_expires_at IS NOT NULL
    AND ig_token_expires_at < NOW() + INTERVAL '10 days'
  ORDER BY ig_token_expires_at ASC;
")

if [ -z "$EXPIRING" ]; then
  echo "No tokens expiring within 10 days. All good!"
  exit 0
fi

echo "Tenants with expiring tokens:"
echo "$EXPIRING" | while IFS='|' read -r id name handle expires; do
  echo "  - $name (@$handle) expires: $expires"
done

echo ""
echo "Attempting automatic token refresh via Meta API..."

echo "$EXPIRING" | while IFS='|' read -r id name handle expires; do
  echo ""
  echo "Refreshing token for $name (@$handle)..."

  # Get current token from DB
  CURRENT_TOKEN=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
    "SELECT ig_access_token FROM tenants WHERE id = '$id';")

  if [ -z "$CURRENT_TOKEN" ]; then
    echo "  WARNING: No token found for $name. Skipping."
    continue
  fi

  # Exchange for new long-lived token
  RESPONSE=$(curl -s "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=$CURRENT_TOKEN")

  NEW_TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")

  if [ -n "$NEW_TOKEN" ]; then
    docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
      "UPDATE tenants SET ig_access_token = '$NEW_TOKEN', ig_token_expires_at = NOW() + INTERVAL '60 days', updated_at = NOW() WHERE id = '$id';"
    echo "  Token refreshed for $name. New expiry: +60 days."
  else
    echo "  FAILED to refresh token for $name. Manual intervention needed."
    echo "  Response: $RESPONSE"
  fi
done

echo ""
echo "Token rotation complete."
