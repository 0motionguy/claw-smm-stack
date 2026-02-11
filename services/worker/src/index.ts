import express from 'express';
import { createClient } from './db/client';
import { InstagramClient } from './integrations/instagram';
import { LLMRouter } from './integrations/llm';
import { EngagementWorker } from './workers/engage.worker';
import { logger } from './utils/logger';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize services
async function main() {
  logger.info('🦞 Starting SMM Worker...');

  // Database connection
  const db = createClient();
  await db.connect();
  logger.info('✅ Database connected');

  // Instagram API client
  const instagram = new InstagramClient({
    appId: process.env.META_APP_ID!,
    appSecret: process.env.META_APP_SECRET!,
  });
  logger.info('✅ Instagram client initialized');

  // LLM Router
  const llmRouter = new LLMRouter({
    moonshotKey: process.env.MOONSHOT_API_KEY!,
    openrouterKey: process.env.OPENROUTER_API_KEY!,
  });
  logger.info('✅ LLM Router initialized');

  // Engagement Worker (CRITICAL)
  const engagementWorker = new EngagementWorker(db, instagram, llmRouter);
  await engagementWorker.start();
  logger.info('✅ Engagement Worker started');

  // Webhook handler for Instagram
  app.post('/webhook/instagram/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const payload = req.body;
    
    logger.info({ tenantId, payload }, 'Received Instagram webhook');
    
    // Process webhook
    await engagementWorker.handleWebhook(tenantId, payload);
    
    res.status(200).send('OK');
  });

  // Start server
  app.listen(PORT, () => {
    logger.info(`🚀 Worker API listening on port ${PORT}`);
  });
}

main().catch((err) => {
  logger.error(err, 'Failed to start worker');
  process.exit(1);
});
