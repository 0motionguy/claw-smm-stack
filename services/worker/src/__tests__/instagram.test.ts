import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstagramClient } from '../integrations/instagram';

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn().mockReturnValue({
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    }),
  },
}));

import axios from 'axios';

describe('InstagramClient', () => {
  let client: InstagramClient;
  let mockAxios: any;

  beforeEach(() => {
    client = new InstagramClient('test_token_123', 'user_456');
    mockAxios = (axios.create as any).mock.results[0]?.value || {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
  });

  it('should construct with access token and user ID', () => {
    expect(client).toBeDefined();
  });

  it('should update credentials', () => {
    client.updateCredentials('new_token', 'new_user');
    expect(client).toBeDefined();
  });

  describe('replyToComment', () => {
    it('should send reply via Graph API', async () => {
      mockAxios.post.mockResolvedValueOnce({ data: { id: 'reply_789' } });

      await client.replyToComment('comment_123', 'Thank you!');

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('comment_123'),
        expect.objectContaining({ message: 'Thank you!' })
      );
    });
  });

  describe('hideComment', () => {
    it('should hide comment via Graph API', async () => {
      mockAxios.post.mockResolvedValueOnce({ data: { success: true } });

      await client.hideComment('comment_123');

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('comment_123'),
        expect.objectContaining({ hide: true })
      );
    });
  });

  describe('sendMessage', () => {
    it('should send DM via Messaging API', async () => {
      mockAxios.post.mockResolvedValueOnce({ data: { message_id: 'msg_123' } });

      await client.sendMessage('recipient_456', 'Hello!');

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('messages'),
        expect.objectContaining({
          recipient: expect.objectContaining({ id: 'recipient_456' }),
        })
      );
    });
  });

  describe('createMediaContainer', () => {
    it('should create media container for image post', async () => {
      mockAxios.post.mockResolvedValueOnce({ data: { id: 'container_123' } });

      const containerId = await client.createMediaContainer('Test caption', 'https://example.com/img.jpg');

      expect(containerId).toBe('container_123');
    });
  });

  describe('getInsights', () => {
    it('should fetch insights metrics', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { name: 'follower_count', values: [{ value: 1000 }] },
            { name: 'reach', values: [{ value: 5000 }] },
          ],
        },
      });

      const insights = await client.getInsights(['follower_count', 'reach'], 'day');

      expect(insights).toHaveLength(2);
      expect(insights[0].name).toBe('follower_count');
    });
  });
});
