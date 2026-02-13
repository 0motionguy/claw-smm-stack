import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngagementWorker } from '../workers/engage.worker';

describe('EngagementWorker', () => {
  let worker: EngagementWorker;
  let mockIg: any;
  let mockLlm: any;
  let mockRag: any;
  let mockRateLimiter: any;
  let mockCircuitBreaker: any;
  let mockDb: any;

  beforeEach(() => {
    mockIg = {
      replyToComment: vi.fn().mockResolvedValue(undefined),
      hideComment: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };

    mockLlm = {
      classifyIntent: vi.fn().mockResolvedValue('question'),
      generateReply: vi.fn().mockResolvedValue('Thank you for reaching out!'),
    };

    mockRag = {
      retrieveContext: vi.fn().mockResolvedValue([{ text: 'brand context', score: 0.9, metadata: {} }]),
      storeContext: vi.fn().mockResolvedValue(undefined),
    };

    mockRateLimiter = {
      checkLimit: vi.fn().mockResolvedValue(true),
      recordCall: vi.fn().mockResolvedValue(undefined),
    };

    mockCircuitBreaker = {
      execute: vi.fn().mockImplementation((fn: any) => fn()),
    };

    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'tenant-1', brand_voice: 'friendly', status: 'active' }] }),
    };

    worker = new EngagementWorker(mockIg, mockLlm, mockRag, mockRateLimiter, mockCircuitBreaker, mockDb);
  });

  describe('processComment', () => {
    const baseComment = {
      ig_comment_id: 'comment_123',
      author_name: 'testuser',
      text: 'Amazing post!',
    };

    it('should auto-reply to praise comments', async () => {
      mockLlm.classifyIntent.mockResolvedValueOnce('praise');

      await worker.processComment('tenant-1', baseComment);

      expect(mockRag.retrieveContext).toHaveBeenCalledWith('tenant-1', 'Amazing post!', 5);
      expect(mockCircuitBreaker.execute).toHaveBeenCalled();
      expect(mockIg.replyToComment).toHaveBeenCalledWith('comment_123', expect.any(String));
      expect(mockRateLimiter.checkLimit).toHaveBeenCalledWith('tenant-1', 'api');
      expect(mockRateLimiter.recordCall).toHaveBeenCalledWith('tenant-1', 'api');
    });

    it('should draft reply for questions', async () => {
      mockLlm.classifyIntent.mockResolvedValueOnce('question');

      await worker.processComment('tenant-1', { ...baseComment, text: 'What are your hours?' });

      expect(mockIg.replyToComment).not.toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('pending_approval'),
        expect.any(Array)
      );
    });

    it('should hide spam comments', async () => {
      mockLlm.classifyIntent.mockResolvedValueOnce('spam');

      await worker.processComment('tenant-1', { ...baseComment, text: 'BUY FOLLOWERS NOW!!!' });

      expect(mockIg.hideComment).toHaveBeenCalledWith('comment_123');
      expect(mockIg.replyToComment).not.toHaveBeenCalled();
    });

    it('should escalate complaints', async () => {
      mockLlm.classifyIntent.mockResolvedValueOnce('complaint');

      await worker.processComment('tenant-1', { ...baseComment, text: 'Terrible service!!!' });

      expect(mockIg.replyToComment).not.toHaveBeenCalled();
      expect(mockIg.hideComment).not.toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('escalated'),
        expect.any(Array)
      );
    });

    it('should trigger lead sequence for leads', async () => {
      mockLlm.classifyIntent.mockResolvedValueOnce('lead');

      await worker.processComment('tenant-1', baseComment);

      expect(mockIg.sendMessage).toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('lead_triggered'),
        expect.any(Array)
      );
    });

    it('should store context in RAG after processing', async () => {
      mockLlm.classifyIntent.mockResolvedValueOnce('question');

      await worker.processComment('tenant-1', baseComment);

      expect(mockRag.storeContext).toHaveBeenCalledWith(
        'tenant-1',
        expect.stringContaining('testuser'),
        expect.objectContaining({ type: 'comment' })
      );
    });

    it('should skip when rate limit exceeded', async () => {
      mockRateLimiter.checkLimit.mockResolvedValueOnce(false);

      await worker.processComment('tenant-1', baseComment);

      expect(mockLlm.classifyIntent).not.toHaveBeenCalled();
      expect(mockIg.replyToComment).not.toHaveBeenCalled();
    });

    it('should skip when tenant not found', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await worker.processComment('tenant-1', baseComment);

      expect(mockLlm.classifyIntent).not.toHaveBeenCalled();
    });
  });

  describe('processDM', () => {
    const baseDM = {
      ig_sender_id: 'sender_456',
      sender_name: 'dmuser',
      message_text: 'What are your prices?',
    };

    it('should process DM and generate reply', async () => {
      mockLlm.classifyIntent.mockResolvedValueOnce('question');

      await worker.processDM('tenant-1', baseDM);

      expect(mockRateLimiter.checkLimit).toHaveBeenCalledWith('tenant-1', 'dm');
      expect(mockLlm.classifyIntent).toHaveBeenCalledWith('What are your prices?');
      expect(mockLlm.generateReply).toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO dms'),
        expect.any(Array)
      );
      expect(mockRateLimiter.recordCall).toHaveBeenCalledWith('tenant-1', 'dm');
    });

    it('should escalate complaint DMs', async () => {
      mockLlm.classifyIntent.mockResolvedValueOnce('complaint');

      await worker.processDM('tenant-1', { ...baseDM, message_text: 'This is terrible!' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO dms'),
        expect.arrayContaining(['escalated'])
      );
    });

    it('should skip when DM rate limit exceeded', async () => {
      mockRateLimiter.checkLimit.mockResolvedValueOnce(false);

      await worker.processDM('tenant-1', baseDM);

      expect(mockLlm.classifyIntent).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    it('should route webhook entries to processComment', async () => {
      mockLlm.classifyIntent.mockResolvedValue('praise');
      const payload = {
        object: 'instagram',
        entry: [{
          changes: [{
            value: {
              id: 'webhook_comment_1',
              text: 'Great post!',
              from: { username: 'webhookuser' },
              media: { id: 'media_1' },
            },
          }],
        }],
      };

      await worker.handleWebhook('tenant-1', payload);

      expect(mockCircuitBreaker.execute).toHaveBeenCalled();
    });
  });
});
