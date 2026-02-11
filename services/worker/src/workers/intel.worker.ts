import { Pool } from 'pg';
import { logger } from '../utils/logger';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { RateLimiter } from '../utils/rate-limiter';
import { InstagramClient } from '../integrations/instagram';
import { LLMRouter } from '../integrations/llm';
import { DeepSeekClient } from '../integrations/deepseek';
import { ApifyClient } from '../integrations/apify';

export class IntelWorker {
  constructor(
    private ig: InstagramClient,
    private llm: LLMRouter,
    private rag: DeepSeekClient,
    private apify: ApifyClient,
    private rateLimiter: RateLimiter,
    private circuitBreaker: CircuitBreaker,
    private db: Pool
  ) {}

  async collectAnalytics(tenantId: string): Promise<void> {
    logger.info('Collecting analytics', { tenant_id: tenantId });

    try {
      // 1. Fetch insights from IG API
      await this.rateLimiter.checkLimit(tenantId, 'api');
      const insights = await this.circuitBreaker.execute(() =>
        this.ig.getInsights(['follower_count', 'reach', 'impressions'], 'day')
      );
      await this.rateLimiter.recordCall(tenantId, 'api');

      // 2. Count today's comments and DMs from DB
      const counts = await this.db.query(`
        SELECT
          (SELECT COUNT(*) FROM comments WHERE tenant_id = $1 AND created_at >= CURRENT_DATE) as comments_received,
          (SELECT COUNT(*) FROM comments WHERE tenant_id = $1 AND created_at >= CURRENT_DATE AND reply_status IN ('auto', 'sent')) as comments_replied,
          (SELECT COUNT(*) FROM dms WHERE tenant_id = $1 AND created_at >= CURRENT_DATE) as dms_received,
          (SELECT COUNT(*) FROM dms WHERE tenant_id = $1 AND created_at >= CURRENT_DATE AND reply_status IN ('auto', 'sent')) as dms_replied,
          (SELECT COUNT(*) FROM dms WHERE tenant_id = $1 AND created_at >= CURRENT_DATE AND category = 'lead') as leads_captured
      `, [tenantId]);

      const c = counts.rows[0];

      // 3. Upsert analytics
      await this.db.query(`
        INSERT INTO analytics (tenant_id, date, followers, reach, impressions, comments_received, comments_replied, dms_received, dms_replied, leads_captured)
        VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (tenant_id, date) DO UPDATE SET
          followers = EXCLUDED.followers, reach = EXCLUDED.reach, impressions = EXCLUDED.impressions,
          comments_received = EXCLUDED.comments_received, comments_replied = EXCLUDED.comments_replied,
          dms_received = EXCLUDED.dms_received, dms_replied = EXCLUDED.dms_replied, leads_captured = EXCLUDED.leads_captured
      `, [tenantId, insights[0]?.values?.[0]?.value || 0, insights[1]?.values?.[0]?.value || 0,
          insights[2]?.values?.[0]?.value || 0, c.comments_received, c.comments_replied,
          c.dms_received, c.dms_replied, c.leads_captured]);

      // 4. Store in Qdrant
      await this.rag.storeContext(tenantId, `Analytics ${new Date().toISOString().split('T')[0]}: followers=${insights[0]?.values?.[0]?.value}, reach=${insights[1]?.values?.[0]?.value}`, {
        type: 'analytics', date: new Date().toISOString(),
      });

      logger.info('Analytics collected', { tenant_id: tenantId });
    } catch (error) {
      logger.error('Failed to collect analytics', { tenant_id: tenantId, error: String(error) });
      throw error;
    }
  }

  async monitorCompetitors(tenantId: string): Promise<any> {
    logger.info('Monitoring competitors', { tenant_id: tenantId });

    const tenant = await this.db.query('SELECT competitors FROM tenants WHERE id = $1', [tenantId]);
    const competitors: string[] = tenant.rows[0]?.competitors || [];

    if (competitors.length === 0) {
      logger.info('No competitors configured', { tenant_id: tenantId });
      return null;
    }

    const results = [];
    for (const handle of competitors) {
      try {
        const profile = await this.apify.scrapeProfile(handle.replace('@', ''));
        results.push({ handle, ...profile });
      } catch (error) {
        logger.warn('Failed to scrape competitor', { tenant_id: tenantId, handle, error: String(error) });
      }
    }

    // Generate summary via LLM
    const prompt = `Analyze these competitor profiles and provide a brief competitive intelligence summary (5-7 bullet points):\n\n${JSON.stringify(results, null, 2)}`;
    const summary = await this.llm.route(tenantId, 'plan', prompt);

    await this.rag.storeContext(tenantId, `Competitor pulse ${new Date().toISOString().split('T')[0]}: ${summary}`, {
      type: 'competitor_intel', date: new Date().toISOString(),
    });

    await this.db.query(
      `INSERT INTO audit_log (tenant_id, action, worker, details, status) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, 'competitor_monitoring', 'intel', JSON.stringify({ competitors: competitors.length }), 'success']
    );

    return { competitors: results, summary };
  }

  async checkEngagementSpike(tenantId: string): Promise<boolean> {
    const result = await this.db.query(`
      SELECT COUNT(*) as count FROM comments
      WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 hour'
    `, [tenantId]);

    const hourlyComments = parseInt(result.rows[0].count);
    const isSpike = hourlyComments >= 50;

    if (isSpike) {
      logger.warn('Engagement spike detected!', { tenant_id: tenantId, hourly_comments: hourlyComments });
    }

    return isSpike;
  }
}
