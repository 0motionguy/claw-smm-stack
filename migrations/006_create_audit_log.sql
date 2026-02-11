CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  worker TEXT,
  details JSONB DEFAULT '{}',
  model_used TEXT,
  tokens_used INT DEFAULT 0,
  cost_usd DECIMAL(6,4) DEFAULT 0,
  status TEXT CHECK (status IN ('success', 'failed', 'escalated')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
