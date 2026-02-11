import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngageWorker } from '../workers/engage.worker';

describe('EngageWorker', () => {
  let worker: EngageWorker;
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
      route: vi.fn().mockResolvedValue('Thank you!'),
    };

    mockRag = {
      retrieveContext: vi.fn().mockResolvedValue([{ text: 'brand context' }]),
      storeContext: vi.fn().mockResolvedValue(undefined),
    };

    mockRateLimiter = {
      checkLimit: vi.fn().mockResolvedValue(undefined),
      recordCall: vi.fn().mockResolvedValue(undefined),
    };

    mockCircuitBreaker = {
      execute: vi.fn().mockImplementation((fn: any) => fn()),
    };

    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    worker = new EngageWorker(mockIg, mockLlm, mockRag, mockRateLimiter, mockCircuitBreaker, mockDb);
  });

  describe('processComment', () => {
    const baseComment = {
      ig_comment_id: 'comment_123',
      author_name: 'testuser',
      text: 'Amazing post!',
    };

    it('should auto-reply to praise comments', async () => {
      mockLlm.route.mockResolvedValueOnce('praise').mockResolvedValueOnce('Thanks so much!');

      await worker.processComment('tenant-1', baseComment);

      expect(mockRag.retrieveContext).toHaveBeenCalledWith('tenant-1', 'Amazing post!');
      expect(mockLlm.route).toHaveBeenCalledTimes(2);
      expect(mockIg.replyToComment).toHaveBeenCalledWith('comment_123', 'Thanks so much!');
      expect(mockRateLimiter.checkLimit).toHaveBeenCalled();
      expect(mockRateLimiter.recordCall).toHaveBeenCalled();
    });

    it('should draft reply for questions', async () => {
      mockLlm.route.mockResolvedValueOnce('question').mockResolvedValueOnce('Here is the answer...');

      await worker.processComment('tenant-1', { ...baseComment, text: 'What are your hours?' });

      expect(mockIg.replyToComment).not.toHaveBeenCalled();
      // Should insert with 'drafted' status
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO comments'),
        expect.arrayContaining(['drafted'])
      );
    });

    it('should hide spam comments', async () => {
      mockLlm.route.mockResolvedValueOnce('spam');

      await worker.processComment('tenant-1', { ...baseComment, text: 'BUY FOLLOWERS NOW!!!' });

      expect(mockIg.hideComment).toHaveBeenCalledWith('comment_123');
      expect(mockIg.replyToComment).not.toHaveBeenCalled();
    });

    it('should escalate complaints', async () => {
      mockLlm.route.mockResolvedValueOnce('complaint');

      await worker.processComment('tenant-1', { ...baseComment, text: 'Terrible service!!!' });

      expect(mockIg.replyToComment).not.toHaveBeenCalled();
      expect(mockIg.hideComment).not.toHaveBeenCalled();
      // Should insert with 'pending' status for human review
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO comments'),
        expect.arrayContaining(['pending'])
      );
    });

    it('should store context in Qdrant after processing', async () => {
      mockLlm.route.mockResolvedValueOnce('neutral');

      await worker.processComment('tenant-1', baseComment);

      expect(mockRag.storeContext).toHaveBeenCalledWith(
        'tenant-1',
        expect.stringContaining('testuser'),
        expect.objectContaining({ type: 'comment' })
      );
    });

    it('should log to audit_log on failure', async () => {
      mockRag.retrieveContext.mockRejectedValueOnce(new Error('qdrant down'));

      await expect(worker.processComment('tenant-1', baseComment)).rejects.toThrow('qdrant down');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining(['failed'])
      );
    });
  });

  describe('processDM', () => {
    const baseDM = {
      ig_sender_id: 'sender_456',
      sender_name: 'dmuser',
      message_text: 'What are your prices?',
    };

    it('should auto-reply to FAQ DMs', async () => {
      mockLlm.route.mockResolvedValueOnce('faq').mockResolvedValueOnce('Our prices start at...');

      await worker.processDM('tenant-1', baseDM);

      expect(mockIg.sendMessage).toHaveBeenCalledWith('sender_456', 'Our prices start at...');
      expect(mockRateLimiter.checkLimit).toHaveBeenCalledWith('tenant-1', 'dm');
    });

    it('should draft reply for lead DMs', async () => {
      mockLlm.route.mockResolvedValueOnce('lead').mockResolvedValueOnce('Thanks for your interest!');

      await worker.processDM('tenant-1', baseDM);

      expect(mockIg.sendMessage).not.toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO dms'),
        expect.arrayContaining(['drafted'])
      );
    });

    it('should skip spam DMs', async () => {
      mockLlm.route.mockResolvedValueOnce('spam');

      await worker.processDM('tenant-1', { ...baseDM, message_text: 'FREE FOLLOWERS!!!' });

      expect(mockIg.sendMessage).not.toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO dms'),
        expect.arrayContaining(['skipped'])
      );
    });
  });
});
