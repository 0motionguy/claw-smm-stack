#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# backup.sh — Database backup
# ═══════════════════════════════════════════════════════════════

source "$(dirname "$0")/../.env" 2>/dev/null || true

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/claw_smm_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "═══════════════════════════════════════════════════════"
echo "  Claw SMM — Database Backup"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Timestamp: $TIMESTAMP"
echo "Output: $BACKUP_FILE"
echo ""

echo "Dumping database..."
docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --no-owner --no-privileges --clean --if-exists \
  | gzip > "$BACKUP_FILE"

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup complete: $BACKUP_FILE ($FILESIZE)"

# Cleanup old backups (keep last 30)
echo "Cleaning up old backups (keeping last 30)..."
ls -t "$BACKUP_DIR"/claw_smm_*.sql.gz 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

BACKUP_COUNT=$(ls "$BACKUP_DIR"/claw_smm_*.sql.gz 2>/dev/null | wc -l)
echo "Total backups retained: $BACKUP_COUNT"
echo ""
echo "Done."
