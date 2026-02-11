#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# tenant-remove.sh — Offboard a client tenant
# ═══════════════════════════════════════════════════════════════

source "$(dirname "$0")/../.env" 2>/dev/null || true

if [ -z "${1:-}" ]; then
  echo "Usage: ./tenant-remove.sh <tenant-id>"
  echo ""
  echo "Available tenants:"
  docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
    "SELECT id, name, ig_handle, status FROM tenants ORDER BY created_at DESC;"
  exit 1
fi

TENANT_ID="$1"

TENANT_NAME=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
  "SELECT name FROM tenants WHERE id = '$TENANT_ID';")

if [ -z "$TENANT_NAME" ]; then
  echo "Error: Tenant $TENANT_ID not found."
  exit 1
fi

echo "═══════════════════════════════════════════════════════"
echo "  Offboarding: $TENANT_NAME ($TENANT_ID)"
echo "═══════════════════════════════════════════════════════"
echo ""
read -rp "Are you sure? This will archive all data. (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo "Archiving tenant data..."

# Export data before deletion
mkdir -p "./backups/tenant-$TENANT_ID"
docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --table=comments --table=dms --table=posts --table=analytics --table=audit_log \
  --data-only -a \
  -c "tenant_id = '$TENANT_ID'" \
  > "./backups/tenant-$TENANT_ID/data-$(date +%Y%m%d).sql" 2>/dev/null || true

echo "Setting tenant status to offboarded..."
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
  "UPDATE tenants SET status = 'offboarded', ig_access_token = NULL, updated_at = NOW() WHERE id = '$TENANT_ID';"

echo "Removing Qdrant collection..."
curl -s -X DELETE "http://localhost:6333/collections/tenant_${TENANT_ID}_context" > /dev/null 2>&1 || true

echo ""
echo "Offboarding complete. Tenant archived (not deleted)."
echo "Backup saved to: ./backups/tenant-$TENANT_ID/"
