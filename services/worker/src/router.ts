import { Pool } from 'pg';
import IORedis from 'ioredis';
import { logger } from './utils/logger';
import { CircuitBreaker } from './utils/circuit-breaker';
import { RateLimiter } from './utils/rate-limiter';
import { TokenManager } from './utils/token-manager';
import { InstagramClient } from './integrations/instagram';
import { LLMRouter } from './integrations/llm';
import { DeepSeekVectorStore } from './integrations/deepseek';
import { ApifyClient } from './integrations/apify';
import { MetricoolClient } from './integrations/metricool';
import { EngagementWorker } from './workers/engage.worker';
import { ContentWorker } from './workers/content.worker';
import { CommsWorker } from './workers/comms.worker';
import { IntelWorker } from './workers/intel.worker';
import { AdminWorker } from './workers/admin.worker';

export interface RouterDeps {
  db: Pool;
  redis: IORedis;
  ig: InstagramClient;
  llm: LLMRouter;
  rag: DeepSeekVectorStore;
  apify: ApifyClient;
  metricool: MetricoolClient;
  rateLimiter: RateLimiter;
  circuitBreaker: CircuitBreaker;
  tokenManager: TokenManager;
}

export class TaskRouter {
  private engage: EngagementWorker;
  private content: ContentWorker;
  private comms: CommsWorker;
  private intel: IntelWorker;
  private admin: AdminWorker;

  constructor(private deps: RouterDeps) {
    this.engage = new EngagementWorker(
      deps.ig, deps.llm, deps.rag,
      deps.rateLimiter, deps.circuitBreaker, deps.db
    );
    this.content = new ContentWorker(
      deps.ig, deps.llm, deps.rag, deps.metricool,
      deps.rateLimiter, deps.circuitBreaker, deps.db
    );
    this.comms = new CommsWorker(deps.llm, deps.rag, deps.db);
    this.intel = new IntelWorker(
      deps.ig, deps.llm, deps.rag, deps.apify,
      deps.rateLimiter, deps.circuitBreaker, deps.db
    );
    this.admin = new AdminWorker(deps.db, deps.redis, deps.tokenManager);
  }

  async route(task: string, tenantId: string, payload: any): Promise<any> {
    logger.info('Routing task', { task, tenant_id: tenantId });

    switch (task) {
      // Engage
      case 'process_comment':
        return this.engage.processComment(tenantId, payload);
      case 'process_dm':
        return this.engage.processDM(tenantId, payload);

      // Content
      case 'generate_caption':
        return this.content.generateCaption(tenantId, payload.topic, payload.image_url);
      case 'schedule_post':
        return this.content.schedulePost(tenantId, payload.post_id, new Date(payload.scheduled_at));
      case 'generate_calendar':
        return this.content.generateCalendar(tenantId, payload.days || 7);

      // Comms
      case 'daily_briefing':
        return this.comms.sendDailyBriefing(tenantId);
      case 'weekly_report':
        return this.comms.sendWeeklyReport(tenantId);
      case 'notify_lead':
        return this.comms.notifyNewLead(tenantId, payload);

      // Intel
      case 'collect_analytics':
        return this.intel.collectAnalytics(tenantId);
      case 'monitor_competitors':
        return this.intel.monitorCompetitors(tenantId);
      case 'check_engagement_spike':
        return this.intel.checkEngagementSpike(tenantId);

      // Admin
      case 'health_check':
        return this.admin.healthCheck(tenantId);
      case 'daily_cost':
        return this.admin.getDailyCost(tenantId);
      case 'check_token_expiry':
        return this.admin.checkTokenExpiry(tenantId);
      case 'cost_report':
        return this.admin.generateCostReport();

      default:
        logger.error('Unknown task', { task, tenant_id: tenantId });
        throw new Error(`Unknown task: ${task}`);
    }
  }

  getWorkers() {
    return { engage: this.engage, content: this.content, comms: this.comms, intel: this.intel, admin: this.admin };
  }
}
