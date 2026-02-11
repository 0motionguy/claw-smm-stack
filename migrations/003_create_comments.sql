CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  ig_comment_id TEXT UNIQUE,
  author_id TEXT,
  author_name TEXT,
  text TEXT NOT NULL,
  intent TEXT CHECK (intent IN ('praise', 'question', 'complaint', 'spam', 'lead', 'neutral')),
  reply_text TEXT,
  reply_status TEXT DEFAULT 'pending' CHECK (reply_status IN ('pending', 'drafted', 'approved', 'sent', 'auto', 'skipped')),
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_tenant ON comments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(reply_status);
CREATE INDEX IF NOT EXISTS idx_comments_ig ON comments(ig_comment_id);
