import { Pool } from 'pg';
import { InstagramClient } from '../integrations/instagram';
import { LLMRouter } from '../integrations/llm';
import { logger } from '../utils/logger';
import { CircuitBreaker } from '../utils/circuit-breaker';

interface CommentPayload {
  id: string;
  text: string;
  from: { username: string; id: string };
  media_id: string;
}

interface DMPayload {
  sender: { id: string; username: string };
  message: { text: string };
}

export class EngagementWorker {
  private db: Pool;
  private instagram: InstagramClient;
  private llmRouter: LLMRouter;
  private circuitBreaker: CircuitBreaker;

  constructor(db: Pool, instagram: InstagramClient, llmRouter: LLMRouter) {
    this.db = db;
    this.instagram = instagram;
    this.llmRouter = llmRouter;
    this.circuitBreaker = new CircuitBreaker({
      maxRetries: 2,
      resetTimeout: 60000,
    });
  }

  async start(): Promise<void> {
    logger.info('Engagement Worker starting...');
    // Start polling for pending comments/DMs
    setInterval(() => this.processPendingComments(), 30000);
    setInterval(() => this.processPendingDMs(), 30000);
  }

  async handleWebhook(tenantId: string, payload: any): Promise<void> {
    if (payload.object === 'instagram') {
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          if (change.value.field === 'mentions') {
            await this.handleComment(tenantId, change.value);
          }
        }
      }
    }
  }

  private async handleComment(tenantId: string, comment: CommentPayload): Promise<void> {
    try {
      // Get tenant config
      const tenant = await this.db.query(
        'SELECT * FROM tenants WHERE id = $1',
        [tenantId]
      );

      if (tenant.rows.length === 0) {
        logger.warn({ tenantId }, 'Tenant not found');
        return;
      }

      const tenantConfig = tenant.rows[0];

      // Classify intent using cheap model
      const intent = await this.circuitBreaker.execute(async () => {
        return this.llmRouter.classifyIntent(comment.text);
      });

      logger.info({ commentId: comment.id, intent }, 'Comment classified');

      // Route based on intent
      switch (intent) {
        case 'praise':
          await this.autoReplyPraise(tenantConfig, comment);
          break;
        case 'question':
          await this.draftReplyForApproval(tenantConfig, comment);
          break;
        case 'complaint':
          await this.escalateComplaint(tenantConfig, comment);
          break;
        case 'spam':
          await this.hideSpam(tenantConfig, comment);
          break;
        case 'lead':
          await this.triggerLeadSequence(tenantConfig, comment);
          break;
        default:
          await this.draftReplyForApproval(tenantConfig, comment);
      }

      // Log to database
      await this.db.query(
        `INSERT INTO comments (tenant_id, ig_comment_id, author_name, text, intent, reply_status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, comment.id, comment.from.username, comment.text, intent, 'processed']
      );

    } catch (error) {
      logger.error({ error, commentId: comment.id }, 'Failed to handle comment');
    }
  }

  private async autoReplyPraise(tenant: any, comment: CommentPayload): Promise<void> {
    const replies = [
      'Thank you! 🙏',
      'So glad you liked it! ❤️',
      'Appreciate you! 🙌',
      'Thanks for the love! 💯',
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)];

    await this.instagram.replyToComment(comment.id, reply);
    
    logger.info({ commentId: comment.id, reply }, 'Auto-replied to praise');
  }

  private async draftReplyForApproval(tenant: any, comment: CommentPayload): Promise<void> {
    // Generate contextual reply using LLM
    const draft = await this.llmRouter.generateReply({
      commentText: comment.text,
      brandVoice: tenant.brand_voice,
      authorName: comment.from.username,
      context: 'question',
    });

    // Store draft for approval
    await this.db.query(
      `UPDATE comments SET reply_text = $1, reply_status = 'pending_approval' WHERE ig_comment_id = $2`,
      [draft, comment.id]
    );

    // Notify client (placeholder - integrate with WhatsApp/Telegram)
    logger.info({ commentId: comment.id, draft }, 'Draft reply created for approval');
  }

  private async escalateComplaint(tenant: any, comment: CommentPayload): Promise<void> {
    // Draft empathetic response but require human approval
    const draft = await this.llmRouter.generateReply({
      commentText: comment.text,
      brandVoice: tenant.brand_voice,
      authorName: comment.from.username,
      context: 'complaint',
    });

    await this.db.query(
      `UPDATE comments SET reply_text = $1, reply_status = 'escalated' WHERE ig_comment_id = $2`,
      [draft, comment.id]
    );

    logger.warn({ commentId: comment.id }, 'Complaint escalated to human');
  }

  private async hideSpam(tenant: any, comment: CommentPayload): Promise<void> {
    await this.instagram.hideComment(comment.id);
    
    await this.db.query(
      `UPDATE comments SET reply_status = 'spam_hidden' WHERE ig_comment_id = $1`,
      [comment.id]
    );

    logger.info({ commentId: comment.id }, 'Spam comment hidden');
  }

  private async triggerLeadSequence(tenant: any, comment: CommentPayload): Promise<void> {
    // Send DM to lead
    const dmMessage = `Hi ${comment.from.username}! Thanks for your interest. I'd love to help you with that. Can you share more details?`;
    
    await this.instagram.sendDM(comment.from.id, dmMessage);
    
    await this.db.query(
      `UPDATE comments SET reply_status = 'lead_triggered' WHERE ig_comment_id = $1`,
      [comment.id]
    );

    logger.info({ commentId: comment.id, userId: comment.from.id }, 'Lead DM triggered');
  }

  private async processPendingComments(): Promise<void> {
    // Poll for comments that need processing
    const pending = await this.db.query(
      `SELECT * FROM comments WHERE reply_status = 'pending' ORDER BY created_at ASC LIMIT 10`
    );

    for (const comment of pending.rows) {
      // Process each pending comment
      logger.info({ commentId: comment.id }, 'Processing pending comment');
    }
  }

  private async processPendingDMs(): Promise<void> {
    // Poll for pending DMs
    const pending = await this.db.query(
      `SELECT * FROM dms WHERE reply_status = 'pending' ORDER BY created_at ASC LIMIT 10`
    );

    for (const dm of pending.rows) {
      logger.info({ dmId: dm.id }, 'Processing pending DM');
    }
  }
}
