import { Pool } from 'pg';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { logger } from '../utils/logger';
import { verifySignature } from './verify';
import { COMMENT_QUEUE } from '../queues/comment.queue';
import { DM_QUEUE } from '../queues/dm.queue';

interface WebhookEntry {
  id: string;
  time: number;
  messaging?: any[];
  changes?: any[];
}

interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export class InstagramWebhookHandler {
  private commentQueue: Queue;
  private dmQueue: Queue;

  constructor(private db: Pool, redis: IORedis) {
    const connection = { host: redis.options.host || 'localhost', port: redis.options.port || 6379 };
    this.commentQueue = new Queue(COMMENT_QUEUE, { connection });
    this.dmQueue = new Queue(DM_QUEUE, { connection });
  }

  async processPayload(rawBody: string, signature: string, payload: WebhookPayload): Promise<void> {
    // Verify signature
    if (!verifySignature(rawBody, signature)) {
      logger.warn('Invalid webhook signature');
      throw new Error('Invalid signature');
    }

    if (payload.object !== 'instagram') {
      logger.warn('Unexpected webhook object type', { object: payload.object });
      return;
    }

    for (const entry of payload.entry) {
      // Process field changes (comments, mentions)
      if (entry.changes) {
        for (const change of entry.changes) {
          await this.processChange(entry.id, change);
        }
      }

      // Process messaging (DMs)
      if (entry.messaging) {
        for (const message of entry.messaging) {
          await this.processMessage(entry.id, message);
        }
      }
    }
  }

  private async processChange(igUserId: string, change: any): Promise<void> {
    const tenant = await this.resolveTenant(igUserId);
    if (!tenant) {
      logger.warn('No tenant found for IG user', { ig_user_id: igUserId });
      return;
    }

    switch (change.field) {
      case 'comments': {
        const value = change.value;
        logger.info('New comment received', { tenant_id: tenant.id, comment_id: value.id });
        await this.commentQueue.add('process_comment', {
          tenantId: tenant.id,
          ig_comment_id: value.id,
          author_name: value.from?.username || 'unknown',
          text: value.text,
          post_id: value.media?.id,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
        break;
      }
      case 'mentions': {
        logger.info('Mention received', { tenant_id: tenant.id });
        // Treat mentions as comments for processing
        const mentionValue = change.value;
        await this.commentQueue.add('process_comment', {
          tenantId: tenant.id,
          ig_comment_id: mentionValue.comment_id || `mention_${Date.now()}`,
          author_name: mentionValue.from?.username || 'unknown',
          text: mentionValue.text || '@mention',
          post_id: mentionValue.media_id,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
        break;
      }
      default:
        logger.debug('Unhandled webhook change field', { field: change.field });
    }
  }

  private async processMessage(igUserId: string, message: any): Promise<void> {
    const tenant = await this.resolveTenant(igUserId);
    if (!tenant) {
      logger.warn('No tenant found for IG user', { ig_user_id: igUserId });
      return;
    }

    // Skip echo messages (sent by us)
    if (message.message?.is_echo) return;

    const senderId = message.sender?.id;
    if (!senderId || senderId === igUserId) return;

    logger.info('New DM received', { tenant_id: tenant.id, sender: senderId });

    await this.dmQueue.add('process_dm', {
      tenantId: tenant.id,
      ig_sender_id: senderId,
      sender_name: message.sender?.username || 'unknown',
      message_text: message.message?.text || '',
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  private async resolveTenant(igUserId: string): Promise<{ id: string } | null> {
    const result = await this.db.query(
      "SELECT id FROM tenants WHERE ig_user_id = $1 AND status = 'active'",
      [igUserId]
    );
    return result.rows[0] || null;
  }
}
