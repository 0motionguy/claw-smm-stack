CREATE TABLE IF NOT EXISTS analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  followers INT DEFAULT 0,
  following INT DEFAULT 0,
  posts_count INT DEFAULT 0,
  engagement_rate DECIMAL(5,2) DEFAULT 0,
  reach INT DEFAULT 0,
  impressions INT DEFAULT 0,
  comments_received INT DEFAULT 0,
  comments_replied INT DEFAULT 0,
  dms_received INT DEFAULT 0,
  dms_replied INT DEFAULT 0,
  leads_captured INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_tenant_date ON analytics(tenant_id, date DESC);
