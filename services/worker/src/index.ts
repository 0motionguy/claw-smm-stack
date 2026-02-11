import express from 'express';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { Worker as BullWorker } from 'bullmq';
import cron from 'node-cron';
import { logger } from './utils/logger';
import { CircuitBreaker } from './utils/circuit-breaker';
import { RateLimiter } from './utils/rate-limiter';
import { TokenManager } from './utils/token-manager';
import { InstagramClient } from './integrations/instagram';
import { LLMRouter } from './integrations/llm';
import { DeepSeekClient } from './integrations/deepseek';
import { ApifyClient } from './integrations/apify';
import { MetricoolClient } from './integrations/metricool';
import { TaskRouter } from './router';
import { COMMENT_QUEUE } from './queues/comment.queue';
import { DM_QUEUE } from './queues/dm.queue';
import { CONTENT_QUEUE } from './queues/content.queue';
import { REPORT_QUEUE } from './queues/report.queue';

const PORT = parseInt(process.env.WORKER_PORT || process.env.PORT || '4000');

async function main() {
  logger.info('Starting Clawbot SMM Worker Service...');

  // --- Database ---
  const db = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://smm:smm123@localhost:5432/smm_agent',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
  await db.query('SELECT 1');
  logger.info('Database connected');

  // --- Redis ---
  const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  await redis.ping();
  logger.info('Redis connected');

  // --- Dependencies ---
  const circuitBreaker = new CircuitBreaker({ maxFailures: 3, resetTimeout: 60000 });
  const rateLimiter = new RateLimiter(redis);
  const tokenManager = new TokenManager(db);
  const ig = new InstagramClient({
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
  });
  const llm = new LLMRouter(db);
  const rag = new DeepSeekClient();
  const apify = new ApifyClient();
  const metricool = new MetricoolClient();

  // --- Router ---
  const router = new TaskRouter({
    db, redis, ig, llm, rag, apify, metricool,
    rateLimiter, circuitBreaker, tokenManager,
  });

  // --- BullMQ Workers ---
  const connection = { host: redis.options.host || 'localhost', port: redis.options.port || 6379 };

  const commentWorker = new BullWorker(COMMENT_QUEUE, async (job) => {
    const { tenantId, ...data } = job.data;
    const tenant = await db.query('SELECT ig_access_token, ig_user_id FROM tenants WHERE id = $1', [tenantId]);
    if (tenant.rows[0]) {
      ig.updateCredentials(tenant.rows[0].ig_access_token, tenant.rows[0].ig_user_id);
    }
    await router.route('process_comment', tenantId, data);
  }, { connection, concurrency: 5 });

  const dmWorker = new BullWorker(DM_QUEUE, async (job) => {
    const { tenantId, ...data } = job.data;
    const tenant = await db.query('SELECT ig_access_token, ig_user_id FROM tenants WHERE id = $1', [tenantId]);
    if (tenant.rows[0]) {
      ig.updateCredentials(tenant.rows[0].ig_access_token, tenant.rows[0].ig_user_id);
    }
    await router.route('process_dm', tenantId, data);
  }, { connection, concurrency: 3 });

  const contentWorker = new BullWorker(CONTENT_QUEUE, async (job) => {
    const { tenantId, type, ...data } = job.data;
    const tenant = await db.query('SELECT ig_access_token, ig_user_id FROM tenants WHERE id = $1', [tenantId]);
    if (tenant.rows[0]) {
      ig.updateCredentials(tenant.rows[0].ig_access_token, tenant.rows[0].ig_user_id);
    }
    await router.route(type, tenantId, data);
  }, { connection, concurrency: 2 });

  const reportWorker = new BullWorker(REPORT_QUEUE, async (job) => {
    const { tenantId, type } = job.data;
    await router.route(type, tenantId, {});
  }, { connection, concurrency: 1 });

  logger.info('Queue workers registered');

  // --- Heartbeat Cron Jobs ---
  const getActiveTenants = async (): Promise<string[]> => {
    const result = await db.query("SELECT id FROM tenants WHERE status = 'active'");
    return result.rows.map((r: any) => r.id);
  };

  // Health check every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('[HEARTBEAT] Running health checks');
    const tenants = await getActiveTenants();
    for (const tid of tenants) {
      try { await router.route('health_check', tid, {}); } catch (e) { logger.error('Health check failed', { tenant_id: tid, error: String(e) }); }
    }
  });

  // Daily briefing at 8 AM
  cron.schedule('0 8 * * *', async () => {
    logger.info('[HEARTBEAT] Sending daily briefings');
    const tenants = await getActiveTenants();
    for (const tid of tenants) {
      try { await router.route('daily_briefing', tid, {}); } catch (e) { logger.error('Daily briefing failed', { tenant_id: tid, error: String(e) }); }
    }
  });

  // Hourly analytics collection
  cron.schedule('0 * * * *', async () => {
    logger.info('[HEARTBEAT] Collecting analytics');
    const tenants = await getActiveTenants();
    for (const tid of tenants) {
      try { await router.route('collect_analytics', tid, {}); } catch (e) { logger.error('Analytics failed', { tenant_id: tid, error: String(e) }); }
    }
  });

  // Hourly engagement spike check
  cron.schedule('30 * * * *', async () => {
    logger.info('[HEARTBEAT] Checking engagement spikes');
    const tenants = await getActiveTenants();
    for (const tid of tenants) {
      try { await router.route('check_engagement_spike', tid, {}); } catch (e) { logger.error('Spike check failed', { tenant_id: tid, error: String(e) }); }
    }
  });

  // Weekly report - Monday 9 AM
  cron.schedule('0 9 * * 1', async () => {
    logger.info('[HEARTBEAT] Generating weekly reports');
    const tenants = await getActiveTenants();
    for (const tid of tenants) {
      try { await router.route('weekly_report', tid, {}); } catch (e) { logger.error('Weekly report failed', { tenant_id: tid, error: String(e) }); }
    }
  });

  // Competitor pulse - Friday 10 AM
  cron.schedule('0 10 * * 5', async () => {
    logger.info('[HEARTBEAT] Running competitor monitoring');
    const tenants = await getActiveTenants();
    for (const tid of tenants) {
      try { await router.route('monitor_competitors', tid, {}); } catch (e) { logger.error('Competitor pulse failed', { tenant_id: tid, error: String(e) }); }
    }
  });

  // Token expiry check - daily at midnight
  cron.schedule('0 0 * * *', async () => {
    logger.info('[HEARTBEAT] Checking token expiry');
    const tenants = await getActiveTenants();
    for (const tid of tenants) {
      try { await router.route('check_token_expiry', tid, {}); } catch (e) { logger.error('Token check failed', { tenant_id: tid, error: String(e) }); }
    }
  });

  // Cost report - daily at 11 PM
  cron.schedule('0 23 * * *', async () => {
    logger.info('[HEARTBEAT] Generating cost report');
    try { await router.route('cost_report', '', {}); } catch (e) { logger.error('Cost report failed', { error: String(e) }); }
  });

  logger.info('Heartbeat cron jobs registered');

  // --- Express Health Server ---
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      await redis.ping();
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        queues: {
          comments: await commentWorker.isRunning(),
          dms: await dmWorker.isRunning(),
          content: await contentWorker.isRunning(),
          reports: await reportWorker.isRunning(),
        },
      });
    } catch (error) {
      res.status(503).json({ status: 'unhealthy', error: String(error) });
    }
  });

  app.get('/health/:tenantId', async (req, res) => {
    try {
      const result = await router.route('health_check', req.params.tenantId, {});
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/cost/:tenantId', async (req, res) => {
    try {
      const result = await router.route('daily_cost', req.params.tenantId, {});
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Legacy webhook endpoint (from original repo)
  app.post('/webhook/instagram/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    logger.info('Received Instagram webhook', { tenantId });
    // Route to engage worker via queue for better reliability
    const { Queue } = await import('bullmq');
    const commentQueue = new Queue(COMMENT_QUEUE, { connection });
    for (const entry of (req.body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.value) {
          await commentQueue.add('process_comment', {
            tenantId,
            ig_comment_id: change.value.id || `webhook_${Date.now()}`,
            author_name: change.value.from?.username || 'unknown',
            text: change.value.text || '',
            post_id: change.value.media?.id,
          });
        }
      }
    }
    res.status(200).send('OK');
  });

  app.listen(PORT, () => {
    logger.info(`Worker service listening on port ${PORT}`);
  });

  // --- Graceful Shutdown ---
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await commentWorker.close();
    await dmWorker.close();
    await contentWorker.close();
    await reportWorker.close();
    await db.end();
    redis.disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Fatal error starting worker', { error: String(error) });
  process.exit(1);
});
