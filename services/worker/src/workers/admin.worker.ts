import { Pool } from 'pg';
import IORedis from 'ioredis';
import { logger } from '../utils/logger';
import { TokenManager } from '../utils/token-manager';

export class AdminWorker {
  constructor(
    private db: Pool,
    private redis: IORedis,
    private tokenManager: TokenManager
  ) {}

  async healthCheck(tenantId: string): Promise<{ status: string; checks: Record<string, boolean> }> {
    const checks: Record<string, boolean> = {
      db: false,
      redis: false,
      token_valid: false,
      rate_limit_ok: false,
    };

    // Check DB
    try {
      await this.db.query('SELECT 1');
      checks.db = true;
    } catch { /* noop */ }

    // Check Redis
    try {
      await this.redis.ping();
      checks.redis = true;
    } catch { /* noop */ }

    // Check token validity
    try {
      const tenant = await this.db.query(
        'SELECT ig_token_expires_at FROM tenants WHERE id = $1',
        [tenantId]
      );
      if (tenant.rows[0]?.ig_token_expires_at) {
        const expiresAt = new Date(tenant.rows[0].ig_token_expires_at);
        checks.token_valid = expiresAt > new Date();
      }
    } catch { /* noop */ }

    // Check rate limit headroom
    try {
      const apiUsed = await this.redis.zcard(`ratelimit:${tenantId}:api`);
      checks.rate_limit_ok = apiUsed < 160; // Under 180 limit with headroom
    } catch { /* noop */ }

    const allHealthy = Object.values(checks).every(Boolean);
    const status = allHealthy ? 'healthy' : Object.values(checks).some(Boolean) ? 'degraded' : 'down';

    await this.db.query(
      `INSERT INTO audit_log (tenant_id, action, worker, details, status) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, 'health_check', 'admin', JSON.stringify(checks), status === 'healthy' ? 'success' : 'failed']
    );

    return { status, checks };
  }

  async getDailyCost(tenantId: string): Promise<{ total_usd: number; by_model: Record<string, number>; budget_remaining: number }> {
    const result = await this.db.query(`
      SELECT model_used, SUM(cost_usd) as total
      FROM audit_log
      WHERE tenant_id = $1 AND created_at >= CURRENT_DATE AND cost_usd > 0
      GROUP BY model_used
    `, [tenantId]);

    const byModel: Record<string, number> = {};
    let totalUsd = 0;
    for (const row of result.rows) {
      const cost = parseFloat(row.total);
      byModel[row.model_used || 'unknown'] = cost;
      totalUsd += cost;
    }

    const budgetLimit = parseFloat(process.env.LLM_DAILY_BUDGET_USD || '5.00');

    return {
      total_usd: Math.round(totalUsd * 10000) / 10000,
      by_model: byModel,
      budget_remaining: Math.round((budgetLimit - totalUsd) * 10000) / 10000,
    };
  }

  async checkTokenExpiry(tenantId: string): Promise<void> {
    const tenant = await this.db.query(
      'SELECT ig_token_expires_at FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (!tenant.rows[0]?.ig_token_expires_at) return;

    const expiresAt = new Date(tenant.rows[0].ig_token_expires_at);
    const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

    if (daysUntilExpiry <= 10) {
      logger.warn('Token expiring soon, refreshing', { tenant_id: tenantId, days_remaining: Math.round(daysUntilExpiry) });
      try {
        await this.tokenManager.refreshToken(tenantId);
        logger.info('Token refreshed', { tenant_id: tenantId });
      } catch (error) {
        logger.error('Token refresh failed', { tenant_id: tenantId, error: String(error) });
      }
    }
  }

  async generateCostReport(): Promise<void> {
    logger.info('Generating cost report for all tenants');

    const result = await this.db.query(`
      SELECT t.name, t.id as tenant_id, COALESCE(SUM(a.cost_usd), 0) as daily_cost
      FROM tenants t
      LEFT JOIN audit_log a ON t.id = a.tenant_id AND a.created_at >= CURRENT_DATE AND a.cost_usd > 0
      WHERE t.status = 'active'
      GROUP BY t.id, t.name
      ORDER BY daily_cost DESC
    `);

    const totalCost = result.rows.reduce((sum: number, r: any) => sum + parseFloat(r.daily_cost), 0);

    await this.db.query(
      `INSERT INTO audit_log (action, worker, details, status) VALUES ($1, $2, $3, $4)`,
      ['cost_report', 'admin', JSON.stringify({
        total_cost: totalCost,
        tenant_count: result.rows.length,
        top_spender: result.rows[0]?.name,
      }), 'success']
    );

    logger.info('Cost report generated', { total_cost: totalCost, tenants: result.rows.length });
  }
}
