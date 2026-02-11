-- 001_create_tenants.sql
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    ig_handle TEXT NOT NULL,
    ig_user_id TEXT,
    ig_access_token TEXT,
    ig_token_expires_at TIMESTAMPTZ,
    meta_app_id TEXT,
    brand_voice TEXT,
    no_go_topics TEXT[],
    posting_frequency TEXT DEFAULT 'daily',
    best_times TEXT[],
    competitors TEXT[],
    timezone TEXT DEFAULT 'UTC',
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    weekend_posting BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'onboarding', 'inactive')),
    soul_config JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_ig_handle ON tenants(ig_handle);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
