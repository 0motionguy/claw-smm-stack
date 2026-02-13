import { Pool } from 'pg';
import { logger } from '../utils/logger';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { RateLimiter } from '../utils/rate-limiter';
import { InstagramClient } from '../integrations/instagram';
import { LLMRouter } from '../integrations/llm';
import { DeepSeekVectorStore } from '../integrations/deepseek';
import { MetricoolClient } from '../integrations/metricool';

export class ContentWorker {
  constructor(
    private ig: InstagramClient,
    private llm: LLMRouter,
    private rag: DeepSeekVectorStore,
    private metricool: MetricoolClient,
    private rateLimiter: RateLimiter,
    private circuitBreaker: CircuitBreaker,
    private db: Pool
  ) {}

  async generateCaption(tenantId: string, topic: string, imageUrl?: string): Promise<{ caption: string; hashtags: string[] }> {
    logger.info('Generating caption', { tenant_id: tenantId, topic });

    const context = await this.rag.retrieveContext(tenantId, topic);
    const contextStr = context.map((c: any) => c.text).join('\n');

    const prompt = `Generate an Instagram caption for this topic: "${topic}"
Include:
- Engaging hook (first line)
- Value-driven body (2-3 sentences)
- Clear call-to-action
- 20-25 relevant hashtags on a separate line prefixed with "HASHTAGS:"

Brand context:
${contextStr}`;

    const response = await this.llm.route(tenantId, 'caption', prompt, contextStr);

    // Parse hashtags from response
    const hashtagMatch = response.match(/HASHTAGS?:\s*(.*)/i);
    const hashtags = hashtagMatch
      ? (hashtagMatch[1] ?? '').match(/#\w+/g) || []
      : response.match(/#\w+/g) || [];
    const caption = response.replace(/HASHTAGS?:.*$/im, '').trim();

    // Save as draft post
    const result = await this.db.query(
      `INSERT INTO posts (tenant_id, caption, hashtags, image_url, status)
       VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
      [tenantId, caption, hashtags, imageUrl || null]
    );

    await this.db.query(
      `INSERT INTO audit_log (tenant_id, action, worker, details, status) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, 'generate_caption', 'content', JSON.stringify({ topic, post_id: result.rows[0].id }), 'success']
    );

    logger.info('Caption generated', { tenant_id: tenantId, post_id: result.rows[0].id });
    return { caption, hashtags };
  }

  async schedulePost(tenantId: string, postId: string, scheduledAt: Date): Promise<void> {
    logger.info('Scheduling post', { tenant_id: tenantId, post_id: postId });

    const postResult = await this.db.query('SELECT * FROM posts WHERE id = $1 AND tenant_id = $2', [postId, tenantId]);
    if (postResult.rows.length === 0) throw new Error(`Post ${postId} not found`);

    const post = postResult.rows[0];

    await this.rateLimiter.checkLimit(tenantId, 'publish');

    if (post.image_url) {
      const containerId = await this.circuitBreaker.execute(() =>
        this.ig.createMediaContainer(post.caption, post.image_url)
      );
      await this.rateLimiter.recordCall(tenantId, 'api');

      // Schedule via Metricool or publish directly
      if (scheduledAt > new Date()) {
        await this.metricool.schedulePost(tenantId, post.caption, post.image_url, scheduledAt);
      } else {
        await this.circuitBreaker.execute(() => this.ig.publishMedia(containerId));
        await this.rateLimiter.recordCall(tenantId, 'publish');
      }
    }

    await this.db.query(
      'UPDATE posts SET status = $1, scheduled_at = $2 WHERE id = $3',
      [scheduledAt > new Date() ? 'scheduled' : 'published', scheduledAt, postId]
    );

    logger.info('Post scheduled', { tenant_id: tenantId, post_id: postId });
  }

  async generateCalendar(tenantId: string, days: number): Promise<any[]> {
    logger.info('Generating content calendar', { tenant_id: tenantId, days });

    const context = await this.rag.retrieveContext(tenantId, 'content calendar strategy');
    const contextStr = context.map((c: any) => c.text).join('\n');

    const prompt = `Create a ${days}-day Instagram content calendar. For each day provide:
- date (relative: Day 1, Day 2...)
- content_type (carousel, reel, single, story)
- topic
- caption_hook (first line only)
- goal (engagement/reach/conversion)

Return as JSON array. Brand context:
${contextStr}`;

    const response = await this.llm.route(tenantId, 'plan', prompt, contextStr);

    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      logger.warn('Failed to parse calendar JSON, returning raw', { tenant_id: tenantId });
      return [{ raw: response }];
    }
  }
}
