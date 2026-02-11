-- 001_create_tenants.sql
CREATE TABLE tenants (
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
    status TEXT DEFAULT 'active',
    soul_config JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 002_create_posts.sql
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    ig_media_id TEXT,
    caption TEXT,
    hashtags TEXT[],
    scheduled_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    status TEXT DEFAULT 'draft',
    engagement_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 003_create_comments.sql
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    post_id UUID REFERENCES posts(id),
    ig_comment_id TEXT,
    author_name TEXT,
    text TEXT,
    intent TEXT,
    reply_text TEXT,
    reply_status TEXT DEFAULT 'pending',
    replied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 004_create_dms.sql
CREATE TABLE dms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    ig_sender_id TEXT,
    sender_name TEXT,
    message_text TEXT,
    category TEXT,
    reply_text TEXT,
    reply_status TEXT DEFAULT 'pending',
    replied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 005_create_analytics.sql
CREATE TABLE analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    date DATE NOT NULL,
    followers INT,
    following INT,
    posts_count INT,
    engagement_rate DECIMAL(5,2),
    reach INT,
    impressions INT,
    comments_received INT,
    comments_replied INT,
    dms_received INT,
    dms_replied INT,
    leads_captured INT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, date)
);

-- 006_create_audit_log.sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    action TEXT NOT NULL,
    details JSONB,
    model_used TEXT,
    tokens_used INT,
    cost_usd DECIMAL(6,4),
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
