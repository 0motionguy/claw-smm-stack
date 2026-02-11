import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export class InstagramClient {
  private appId: string;
  private appSecret: string;
  private accessToken: string;
  private igUserId: string;
  private api: AxiosInstance;

  constructor(config: { appId: string; appSecret: string }) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.accessToken = '';
    this.igUserId = '';
    this.api = axios.create({
      baseURL: 'https://graph.facebook.com/v21.0',
      timeout: 15000,
    });
  }

  updateCredentials(accessToken: string, igUserId: string): void {
    this.accessToken = accessToken;
    this.igUserId = igUserId;
  }

  // --- Comments ---

  async getComments(mediaId: string): Promise<any[]> {
    try {
      const response = await this.api.get(`/${mediaId}/comments`, {
        params: {
          access_token: this.accessToken,
          fields: 'id,text,timestamp,username,replies{id,text,username}',
        },
      });
      return response.data.data || [];
    } catch (error) {
      logger.error('Failed to get comments', { mediaId, error: String(error) });
      throw error;
    }
  }

  async replyToComment(commentId: string, message: string): Promise<void> {
    try {
      await this.api.post(`/${commentId}/replies`, {
        message,
        access_token: this.accessToken,
      });
      logger.info('Replied to comment', { commentId });
    } catch (error) {
      logger.error('Failed to reply to comment', { commentId, error: String(error) });
      throw error;
    }
  }

  async hideComment(commentId: string): Promise<void> {
    try {
      await this.api.post(`/${commentId}`, {
        hide: true,
        access_token: this.accessToken,
      });
      logger.info('Comment hidden', { commentId });
    } catch (error) {
      logger.error('Failed to hide comment', { commentId, error: String(error) });
      throw error;
    }
  }

  async deleteComment(commentId: string): Promise<void> {
    try {
      await this.api.delete(`/${commentId}`, {
        params: { access_token: this.accessToken },
      });
      logger.info('Comment deleted', { commentId });
    } catch (error) {
      logger.error('Failed to delete comment', { commentId, error: String(error) });
      throw error;
    }
  }

  // --- Messaging ---

  async sendMessage(recipientId: string, message: string): Promise<void> {
    try {
      await this.api.post(`/me/messages`, {
        recipient: { id: recipientId },
        message: { text: message },
        access_token: this.accessToken,
      });
      logger.info('DM sent', { recipientId });
    } catch (error) {
      logger.error('Failed to send DM', { recipientId, error: String(error) });
      throw error;
    }
  }

  // --- Publishing ---

  async createMediaContainer(caption: string, imageUrl: string): Promise<string> {
    try {
      const response = await this.api.post(`/${this.igUserId}/media`, {
        image_url: imageUrl,
        caption,
        access_token: this.accessToken,
      });
      return response.data.id;
    } catch (error) {
      logger.error('Failed to create media container', { error: String(error) });
      throw error;
    }
  }

  async publishMedia(containerId: string): Promise<string> {
    try {
      const response = await this.api.post(`/${this.igUserId}/media_publish`, {
        creation_id: containerId,
        access_token: this.accessToken,
      });
      return response.data.id;
    } catch (error) {
      logger.error('Failed to publish media', { error: String(error) });
      throw error;
    }
  }

  // --- Insights ---

  async getInsights(metrics: string[], period: string): Promise<any[]> {
    try {
      const response = await this.api.get(`/${this.igUserId}/insights`, {
        params: {
          metric: metrics.join(','),
          period,
          access_token: this.accessToken,
        },
      });
      return response.data.data || [];
    } catch (error) {
      logger.error('Failed to get insights', { error: String(error) });
      throw error;
    }
  }

  // --- Webhook ---

  verifyWebhook(token: string, challenge: string): string {
    if (token === (process.env.META_VERIFY_TOKEN || this.appSecret)) {
      return challenge;
    }
    throw new Error('Webhook verification failed');
  }

  // --- Token Management ---

  async refreshToken(longLivedToken: string): Promise<string> {
    try {
      const response = await this.api.get('/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.appId,
          client_secret: this.appSecret,
          fb_exchange_token: longLivedToken,
        },
      });
      return response.data.access_token;
    } catch (error) {
      logger.error('Failed to refresh token', { error: String(error) });
      throw error;
    }
  }
}
