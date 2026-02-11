#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# seed-demo.sh — Create demo tenant with sample data
# ═══════════════════════════════════════════════════════════════

source "$(dirname "$0")/../.env" 2>/dev/null || true

echo "═══════════════════════════════════════════════════════"
echo "  Claw SMM — Seed Demo Data"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "Creating demo tenant..."

TENANT_ID=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "
  INSERT INTO tenants (name, ig_handle, ig_user_id, brand_voice, posting_frequency, timezone, no_go_topics, competitors, best_times, soul_config)
  VALUES (
    'Sweet Dreams Bakery',
    'sweetdreamsbali',
    'demo_12345',
    'Warm, playful, food-focused, emoji-friendly',
    '5x-week',
    'Asia/Makassar',
    '{\"politics\",\"religion\",\"competitor mentions\"}',
    '{\"@balibakes\",\"@cocobali\",\"@flourpower\"}',
    '{\"10:00\",\"18:00\"}',
    '{\"agent_name\": \"Alex\", \"client_name\": \"Sarah\", \"industry\": \"Food & Beverage\", \"target_audience\": \"Bali locals + tourists, 25-45, food lovers\", \"goals\": \"Grow to 10K followers, increase DM leads\"}'
  )
  RETURNING id;
")

echo "Demo tenant: $TENANT_ID"

echo "Seeding sample posts..."
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
  INSERT INTO posts (tenant_id, caption, hashtags, status, published_at, engagement_count) VALUES
  ('$TENANT_ID', 'Rise and shine, Bali! Fresh croissants just out of the oven 🥐', '{\"#balibakery\",\"#freshbaked\",\"#balifoodies\"}', 'published', NOW() - INTERVAL '2 days', 47),
  ('$TENANT_ID', 'New menu drop! Our matcha lava cake is here to stay 🍵🎂', '{\"#matchacake\",\"#balicafe\",\"#newmenu\"}', 'published', NOW() - INTERVAL '1 day', 89),
  ('$TENANT_ID', 'Weekend special: Buy 2 pastries, get a free latte ☕', '{\"#baliweekend\",\"#bakerydeals\",\"#sweetdreams\"}', 'scheduled', NOW() + INTERVAL '1 day', 0);
"

echo "Seeding sample comments..."
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
  INSERT INTO comments (tenant_id, author_name, text, intent, reply_status) VALUES
  ('$TENANT_ID', 'foodie_sarah', 'OMG this looks amazing! 😍', 'praise', 'auto'),
  ('$TENANT_ID', 'bali_traveler', 'What time do you open?', 'question', 'pending'),
  ('$TENANT_ID', 'hangry_mike', 'I waited 30 minutes and my order was wrong', 'complaint', 'pending'),
  ('$TENANT_ID', 'spam_bot_99', 'Check out my profile for FREE followers!!!', 'spam', 'auto'),
  ('$TENANT_ID', 'event_planner', 'Do you do catering for events?', 'lead', 'drafted');
"

echo "Seeding sample DMs..."
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
  INSERT INTO dms (tenant_id, ig_sender_id, sender_name, message_text, category, reply_status) VALUES
  ('$TENANT_ID', 'sender_001', 'wedding_planner', 'Hi! Can you do 200 cupcakes for a wedding next month?', 'lead', 'pending'),
  ('$TENANT_ID', 'sender_002', 'local_regular', 'Are you open on public holidays?', 'faq', 'auto'),
  ('$TENANT_ID', 'sender_003', 'unhappy_customer', 'My birthday cake arrived damaged. Very disappointed.', 'complaint', 'pending');
"

echo "Seeding analytics snapshots..."
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
  INSERT INTO analytics (tenant_id, date, followers, following, posts_count, engagement_rate, reach, impressions, comments_received, comments_replied, dms_received, dms_replied, leads_captured) VALUES
  ('$TENANT_ID', CURRENT_DATE - 6, 4820, 312, 145, 3.2, 2100, 5400, 12, 11, 4, 3, 1),
  ('$TENANT_ID', CURRENT_DATE - 5, 4835, 312, 146, 3.5, 2300, 5800, 15, 14, 5, 5, 2),
  ('$TENANT_ID', CURRENT_DATE - 4, 4851, 313, 146, 2.8, 1900, 4900, 8, 8, 3, 3, 0),
  ('$TENANT_ID', CURRENT_DATE - 3, 4870, 313, 147, 4.1, 2800, 6200, 22, 20, 6, 5, 1),
  ('$TENANT_ID', CURRENT_DATE - 2, 4889, 314, 148, 3.7, 2500, 5900, 18, 17, 4, 4, 1),
  ('$TENANT_ID', CURRENT_DATE - 1, 4912, 314, 149, 5.2, 3200, 7100, 31, 28, 8, 7, 3),
  ('$TENANT_ID', CURRENT_DATE,     4938, 315, 150, 3.9, 2600, 6000, 14, 12, 5, 4, 1);
"

echo "Creating Qdrant collection..."
curl -s -X PUT "http://localhost:6333/collections/tenant_${TENANT_ID}_context" \
  -H "Content-Type: application/json" \
  -d '{"vectors": {"size": 1536, "distance": "Cosine"}}' > /dev/null 2>&1 || true

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Demo data seeded!"
echo "═══════════════════════════════════════════════════════"
echo "  Tenant: Sweet Dreams Bakery ($TENANT_ID)"
echo "  Posts:  3 (2 published, 1 scheduled)"
echo "  Comments: 5 (mixed intents)"
echo "  DMs:    3 (lead, faq, complaint)"
echo "  Analytics: 7 days of snapshots"
echo "═══════════════════════════════════════════════════════"
