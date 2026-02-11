CREATE TABLE IF NOT EXISTS dms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ig_sender_id TEXT NOT NULL,
  sender_name TEXT,
  message_text TEXT NOT NULL,
  category TEXT CHECK (category IN ('faq', 'order', 'lead', 'complaint', 'spam', 'general')),
  reply_text TEXT,
  reply_status TEXT DEFAULT 'pending' CHECK (reply_status IN ('pending', 'drafted', 'approved', 'sent', 'auto', 'skipped')),
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dms_tenant ON dms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dms_status ON dms(reply_status);
CREATE INDEX IF NOT EXISTS idx_dms_sender ON dms(ig_sender_id);
