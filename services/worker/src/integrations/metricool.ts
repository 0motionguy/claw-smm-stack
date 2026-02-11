import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { logger } from '../utils/logger';

/**
 * Metricool client for content scheduling
 * This is a stub interface - actual Metricool API integration to be implemented
 */

// Zod schemas
const ScheduledPostSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  caption: z.string(),
  imageUrl: z.string(),
  scheduledAt: z.date(),
  status: z.enum(['pending', 'published', 'failed', 'cancelled']),
  publishedAt: z.date().optional(),
  errorMessage: z.string().optional(),
});

export type ScheduledPost = z.infer<typeof ScheduledPostSchema>;

export interface SchedulePostParams {
  tenantId: string;
  caption: string;
  imageUrl: string;
  scheduledAt: Date;
}

export class MetricoolClient {
  private readonly client: AxiosInstance;
  private readonly apiKey: string;

  constructor() {
    this.apiKey = process.env.METRICOOL_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('METRICOOL_API_KEY not configured', {
        action: 'metricool_init_warning',
      });
    }

    this.client = axios.create({
      baseURL: 'https://api.metricool.com/v1', // Placeholder URL
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Schedule a post for future publishing
   * @param tenantId - Tenant identifier
   * @param caption - Post caption
   * @param imageUrl - URL of the image to post
   * @param scheduledAt - When to publish the post
   * @returns Scheduled post ID
   */
  async schedulePost(
    tenantId: string,
    caption: string,
    imageUrl: string,
    scheduledAt: Date
  ): Promise<string> {
    try {
      logger.info('Scheduling post via Metricool', {
        action: 'metricool_schedule_post',
        tenant_id: tenantId,
        scheduled_at: scheduledAt.toISOString(),
      });

      // TODO: Implement actual Metricool API call
      // This is a stub implementation

      const response = await this.client.post('/posts/schedule', {
        tenant_id: tenantId,
        caption,
        media: {
          type: 'image',
          url: imageUrl,
        },
        scheduled_at: scheduledAt.toISOString(),
        platforms: ['instagram'],
      });

      const postId = response.data.id || `scheduled_${Date.now()}`;

      logger.info('Post scheduled successfully', {
        action: 'metricool_schedule_post_success',
        tenant_id: tenantId,
        post_id: postId,
        scheduled_at: scheduledAt.toISOString(),
      });

      return postId;
    } catch (error) {
      logger.error('Failed to schedule post', {
        action: 'metricool_schedule_post_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all scheduled posts for a tenant
   * @param tenantId - Tenant identifier
   * @returns Array of scheduled posts
   */
  async getScheduledPosts(tenantId: string): Promise<ScheduledPost[]> {
    try {
      logger.debug('Fetching scheduled posts', {
        action: 'metricool_get_scheduled_posts',
        tenant_id: tenantId,
      });

      // TODO: Implement actual Metricool API call
      // This is a stub implementation

      const response = await this.client.get('/posts/scheduled', {
        params: {
          tenant_id: tenantId,
          status: 'pending',
        },
      });

      const posts = response.data.posts || [];

      // Map to our schema
      const scheduledPosts: ScheduledPost[] = posts.map((post: any) => ({
        id: post.id,
        tenantId: post.tenant_id || tenantId,
        caption: post.caption,
        imageUrl: post.media?.url || '',
        scheduledAt: new Date(post.scheduled_at),
        status: post.status || 'pending',
        publishedAt: post.published_at ? new Date(post.published_at) : undefined,
        errorMessage: post.error_message,
      }));

      logger.debug('Scheduled posts fetched', {
        action: 'metricool_get_scheduled_posts_success',
        tenant_id: tenantId,
        posts_count: scheduledPosts.length,
      });

      return scheduledPosts;
    } catch (error) {
      logger.error('Failed to get scheduled posts', {
        action: 'metricool_get_scheduled_posts_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Cancel a scheduled post
   * @param postId - Scheduled post ID
   * @returns Success boolean
   */
  async cancelScheduledPost(postId: string): Promise<boolean> {
    try {
      logger.info('Cancelling scheduled post', {
        action: 'metricool_cancel_post',
        post_id: postId,
      });

      // TODO: Implement actual Metricool API call
      const response = await this.client.delete(`/posts/scheduled/${postId}`);

      logger.info('Scheduled post cancelled', {
        action: 'metricool_cancel_post_success',
        post_id: postId,
      });

      return response.status === 200;
    } catch (error) {
      logger.error('Failed to cancel scheduled post', {
        action: 'metricool_cancel_post_error',
        post_id: postId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a scheduled post
   * @param postId - Scheduled post ID
   * @param updates - Fields to update
   * @returns Success boolean
   */
  async updateScheduledPost(
    postId: string,
    updates: Partial<{
      caption: string;
      imageUrl: string;
      scheduledAt: Date;
    }>
  ): Promise<boolean> {
    try {
      logger.info('Updating scheduled post', {
        action: 'metricool_update_post',
        post_id: postId,
      });

      // TODO: Implement actual Metricool API call
      const response = await this.client.patch(`/posts/scheduled/${postId}`, {
        caption: updates.caption,
        media: updates.imageUrl ? { type: 'image', url: updates.imageUrl } : undefined,
        scheduled_at: updates.scheduledAt?.toISOString(),
      });

      logger.info('Scheduled post updated', {
        action: 'metricool_update_post_success',
        post_id: postId,
      });

      return response.status === 200;
    } catch (error) {
      logger.error('Failed to update scheduled post', {
        action: 'metricool_update_post_error',
        post_id: postId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get post analytics
   * @param postId - Post ID
   * @returns Analytics data
   */
  async getPostAnalytics(postId: string): Promise<any> {
    try {
      logger.debug('Fetching post analytics', {
        action: 'metricool_get_analytics',
        post_id: postId,
      });

      // TODO: Implement actual Metricool API call
      const response = await this.client.get(`/posts/${postId}/analytics`);

      return response.data;
    } catch (error) {
      logger.error('Failed to get post analytics', {
        action: 'metricool_get_analytics_error',
        post_id: postId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Health check for Metricool API
   * @returns true if API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      logger.error('Metricool health check failed', {
        action: 'metricool_health_check_error',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
