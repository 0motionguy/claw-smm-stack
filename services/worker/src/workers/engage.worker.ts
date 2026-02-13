import { Pool } from 'pg';
import { InstagramClient } from '../integrations/instagram';
import { LLMRouter } from '../integrations/llm';
import { DeepSeekVectorStore } from '../integrations/deepseek';
import { RateLimiter } from '../utils/rate-limiter';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { logger } from '../utils/logger';

interface CommentPayload {
  ig_comment_id: string;
  text: string;
  author_name: string;
  post_id?: string;
}

interface DMPayload {
  ig_sender_id: string;
  sender_name: string;
  message_text: string;
}

export class EngagementWorker {
  constructor(
    private instagram: InstagramClient,
    private llmRouter: LLMRouter,
    private rag: DeepSeekVectorStore,
    private rateLimiter: RateLimiter,
    private circuitBreaker: CircuitBreaker,
    private db: Pool
  ) {}

  async processComment(tenantId: string, payload: CommentPayload): Promise<void> {
    try {
      const tenant = await this.db.query(
        'SELECT * FROM tenants WHERE id = $1',
        [tenantId]
      );

      if (tenant.rows.length === 0) {
        logger.warn('Tenant not found', { tenant_id: tenantId });
        return;
      }

      const tenantConfig = tenant.rows[0];

      // Retrieve context from RAG
      let context = '';
      try {
        const results = await this.rag.retrieveContext(tenantId, payload.text, 5);
        context = results.map(r => r.text).join('\n');
      } catch {
        logger.warn('RAG context retrieval failed, continuing without context', { tenant_id: tenantId });
      }

      // Check rate limit
      const allowed = await this.rateLimiter.checkLimit(tenantId, 'api');
      if (!allowed) {
        logger.warn('Rate limit exceeded, skipping comment', { tenant_id: tenantId, comment_id: payload.ig_comment_id });
        return;
      }

      // Classify intent using circuit breaker
      const intent = await this.circuitBreaker.execute(async () => {
        return this.llmRouter.classifyIntent(payload.text);
      });
      await this.rateLimiter.recordCall(tenantId, 'api');

      logger.info('Comment classified', { comment_id: payload.ig_comment_id, intent, tenant_id: tenantId });

      // Route based on intent
      switch (intent) {
        case 'praise':
          await this.autoReplyPraise(tenantConfig, payload);
          break;
        case 'question':
          await this.draftReplyForApproval(tenantConfig, payload, context);
          break;
        case 'complaint':
          await this.escalateComplaint(tenantConfig, payload, context);
          break;
        case 'spam':
          await this.hideSpam(tenantConfig, payload);
          break;
        case 'lead':
          await this.triggerLeadSequence(tenantConfig, payload);
          break;
        default:
          await this.draftReplyForApproval(tenantConfig, payload, context);
      }

      // Log to database
      await this.db.query(
        `INSERT INTO comments (tenant_id, ig_comment_id, author_name, text, intent, reply_status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, payload.ig_comment_id, payload.author_name, payload.text, intent, 'processed']
      );

      // Store interaction in RAG for future context
      try {
        await this.rag.storeContext(tenantId, `Comment from @${payload.author_name}: ${payload.text} [intent: ${intent}]`, {
          type: 'comment',
          intent,
          comment_id: payload.ig_comment_id,
        });
      } catch {
        logger.warn('Failed to store comment context in RAG', { tenant_id: tenantId });
      }
    } catch (error) {
      logger.error('Failed to process comment', { error: String(error), comment_id: payload.ig_comment_id, tenant_id: tenantId });
      throw error;
    }
  }

  async processDM(tenantId: string, payload: DMPayload): Promise<void> {
    try {
      const tenant = await this.db.query(
        'SELECT * FROM tenants WHERE id = $1',
        [tenantId]
      );

      if (tenant.rows.length === 0) {
        logger.warn('Tenant not found', { tenant_id: tenantId });
        return;
      }

      const tenantConfig = tenant.rows[0];

      // Check rate limit
      const allowed = await this.rateLimiter.checkLimit(tenantId, 'dm');
      if (!allowed) {
        logger.warn('DM rate limit exceeded', { tenant_id: tenantId, sender_id: payload.ig_sender_id });
        return;
      }

      // Retrieve context from RAG
      let context = '';
      try {
        const results = await this.rag.retrieveContext(tenantId, payload.message_text, 5);
        context = results.map(r => r.text).join('\n');
      } catch {
        logger.warn('RAG context retrieval failed for DM', { tenant_id: tenantId });
      }

      // Classify intent
      const intent = await this.circuitBreaker.execute(async () => {
        return this.llmRouter.classifyIntent(payload.message_text);
      });

      // Generate reply
      const reply = await this.llmRouter.generateReply({
        commentText: payload.message_text,
        brandVoice: tenantConfig.brand_voice,
        authorName: payload.sender_name,
        context: intent === 'complaint' ? 'complaint' : 'question',
      });

      // Store DM in database
      await this.db.query(
        `INSERT INTO dms (tenant_id, ig_sender_id, sender_name, message_text, category, reply_text, reply_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, payload.ig_sender_id, payload.sender_name, payload.message_text, intent,
         reply, intent === 'complaint' ? 'escalated' : 'pending_approval']
      );
      await this.rateLimiter.recordCall(tenantId, 'dm');

      logger.info('DM processed', { tenant_id: tenantId, sender: payload.sender_name, intent });
    } catch (error) {
      logger.error('Failed to process DM', { error: String(error), tenant_id: tenantId });
      throw error;
    }
  }

  async handleWebhook(tenantId: string, payload: any): Promise<void> {
    if (payload.object === 'instagram') {
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          if (change.value) {
            await this.processComment(tenantId, {
              ig_comment_id: change.value.id || `webhook_${Date.now()}`,
              text: change.value.text || '',
              author_name: change.value.from?.username || 'unknown',
              post_id: change.value.media?.id,
            });
          }
        }
      }
    }
  }

  private async autoReplyPraise(tenant: any, comment: CommentPayload): Promise<void> {
    const replies = [
      'Thank you!',
      'So glad you liked it!',
      'Appreciate you!',
      'Thanks for the love!',
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)] ?? 'Thank you!';

    await this.circuitBreaker.execute(async () => {
      await this.instagram.replyToComment(comment.ig_comment_id, reply);
    });

    logger.info('Auto-replied to praise', { comment_id: comment.ig_comment_id, reply });
  }

  private async draftReplyForApproval(tenant: any, comment: CommentPayload, context: string): Promise<void> {
    const draft = await this.llmRouter.generateReply({
      commentText: comment.text,
      brandVoice: tenant.brand_voice,
      authorName: comment.author_name,
      context: 'question',
    });

    await this.db.query(
      `UPDATE comments SET reply_text = $1, reply_status = 'pending_approval' WHERE ig_comment_id = $2`,
      [draft, comment.ig_comment_id]
    );

    logger.info('Draft reply created for approval', { comment_id: comment.ig_comment_id });
  }

  private async escalateComplaint(tenant: any, comment: CommentPayload, context: string): Promise<void> {
    const draft = await this.llmRouter.generateReply({
      commentText: comment.text,
      brandVoice: tenant.brand_voice,
      authorName: comment.author_name,
      context: 'complaint',
    });

    await this.db.query(
      `UPDATE comments SET reply_text = $1, reply_status = 'escalated' WHERE ig_comment_id = $2`,
      [draft, comment.ig_comment_id]
    );

    logger.warn('Complaint escalated to human', { comment_id: comment.ig_comment_id });
  }

  private async hideSpam(tenant: any, comment: CommentPayload): Promise<void> {
    await this.circuitBreaker.execute(async () => {
      await this.instagram.hideComment(comment.ig_comment_id);
    });

    await this.db.query(
      `UPDATE comments SET reply_status = 'spam_hidden' WHERE ig_comment_id = $1`,
      [comment.ig_comment_id]
    );

    logger.info('Spam comment hidden', { comment_id: comment.ig_comment_id });
  }

  private async triggerLeadSequence(tenant: any, comment: CommentPayload): Promise<void> {
    const dmMessage = `Hi ${comment.author_name}! Thanks for your interest. I'd love to help you with that. Can you share more details?`;

    await this.circuitBreaker.execute(async () => {
      await this.instagram.sendMessage(comment.ig_comment_id, dmMessage);
    });

    await this.db.query(
      `UPDATE comments SET reply_status = 'lead_triggered' WHERE ig_comment_id = $1`,
      [comment.ig_comment_id]
    );

    logger.info('Lead DM triggered', { comment_id: comment.ig_comment_id });
  }
}
