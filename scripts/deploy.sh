#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# deploy.sh — Zero-downtime production deploy
# ═══════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════"
echo "  Claw SMM — Production Deploy"
echo "═══════════════════════════════════════════════════════"
echo ""

# Pre-deploy backup
echo "[1/5] Running pre-deploy backup..."
bash "$(dirname "$0")/backup.sh"

# Pull latest code
echo ""
echo "[2/5] Pulling latest code..."
git pull origin main

# Build new images
echo ""
echo "[3/5] Building new images..."
docker compose build --no-cache worker dashboard

# Run migrations
echo ""
echo "[4/5] Running database migrations..."
for migration in migrations/*.sql; do
  echo "  Applying: $(basename "$migration")"
  docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -f "/migrations/$(basename "$migration")" 2>/dev/null || true
done

# Rolling restart
echo ""
echo "[5/5] Rolling restart..."
docker compose up -d --no-deps worker
echo "  Worker restarted. Waiting 10s for health check..."
sleep 10

WORKER_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health 2>/dev/null || echo "000")
if [ "$WORKER_HEALTH" = "200" ]; then
  echo "  Worker healthy."
else
  echo "  WARNING: Worker health check returned $WORKER_HEALTH"
fi

docker compose up -d --no-deps dashboard
echo "  Dashboard restarted."

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Deploy complete!"
echo "  Worker:    http://localhost:4000/health"
echo "  Dashboard: http://localhost:3000"
echo "═══════════════════════════════════════════════════════"
