import axios from 'axios';
import { logger } from '../utils/logger';

export class InstagramClient {
  private appId: string;
  private appSecret: string;
  private baseUrl = 'https://graph.facebook.com/v18.0';

  constructor(config: { appId: string; appSecret: string }) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
  }

  async getComments(mediaId: string, accessToken: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${mediaId}/comments`,
        {
          params: {
            access_token: accessToken,
            fields: 'id,text,timestamp,username,replies{id,text,username}',
          },
        }
      );
      return response.data.data || [];
    } catch (error) {
      logger.error({ error, mediaId }, 'Failed to get comments');
      throw error;
    }
  }

  async replyToComment(commentId: string, message: string, accessToken: string): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/${commentId}/replies`,
        {
          message,
          access_token: accessToken,
        }
      );
      logger.info({ commentId }, 'Replied to comment');
    } catch (error) {
      logger.error({ error, commentId }, 'Failed to reply to comment');
      throw error;
    }
  }

  async hideComment(commentId: string, accessToken: string): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/${commentId}`,
        {
          hide: true,
          access_token: accessToken,
        }
      );
      logger.info({ commentId }, 'Comment hidden');
    } catch (error) {
      logger.error({ error, commentId }, 'Failed to hide comment');
      throw error;
    }
  }

  async deleteComment(commentId: string, accessToken: string): Promise<void> {
    try {
      await axios.delete(`${this.baseUrl}/${commentId}`, {
        params: { access_token: accessToken },
      });
      logger.info({ commentId }, 'Comment deleted');
    } catch (error) {
      logger.error({ error, commentId }, 'Failed to delete comment');
      throw error;
    }
  }

  async sendDM(recipientId: string, message: string, accessToken: string): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/me/messages`,
        {
          recipient: { id: recipientId },
          message: { text: message },
          access_token: accessToken,
        }
      );
      logger.info({ recipientId }, 'DM sent');
    } catch (error) {
      logger.error({ error, recipientId }, 'Failed to send DM');
      throw error;
    }
  }

  async getInsights(igUserId: string, metrics: string[], period: string, accessToken: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${igUserId}/insights`,
        {
          params: {
            metric: metrics.join(','),
            period,
            access_token: accessToken,
          },
        }
      );
      return response.data.data;
    } catch (error) {
      logger.error({ error, igUserId }, 'Failed to get insights');
      throw error;
    }
  }

  async verifyWebhook(token: string, challenge: string): Promise<string> {
    if (token === this.appSecret) {
      return challenge;
    }
    throw new Error('Webhook verification failed');
  }

  async refreshToken(longLivedToken: string): Promise<string> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: this.appId,
            client_secret: this.appSecret,
            fb_exchange_token: longLivedToken,
          },
        }
      );
      return response.data.access_token;
    } catch (error) {
      logger.error({ error }, 'Failed to refresh token');
      throw error;
    }
  }
}
