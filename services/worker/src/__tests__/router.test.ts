import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all worker dependencies
vi.mock('../integrations/instagram', () => ({ InstagramClient: vi.fn() }));
vi.mock('../integrations/llm', () => ({ LLMRouter: vi.fn() }));
vi.mock('../integrations/deepseek', () => ({ DeepSeekVectorStore: vi.fn() }));
vi.mock('../integrations/apify', () => ({ ApifyClient: vi.fn() }));
vi.mock('../integrations/metricool', () => ({ MetricoolClient: vi.fn() }));

// Mock workers
const mockProcessComment = vi.fn().mockResolvedValue(undefined);
const mockProcessDM = vi.fn().mockResolvedValue(undefined);
const mockGenerateCaption = vi.fn().mockResolvedValue({ caption: 'test', hashtags: [] });
const mockHealthCheck = vi.fn().mockResolvedValue({ status: 'healthy', checks: {} });
const mockDailyBriefing = vi.fn().mockResolvedValue(undefined);
const mockCollectAnalytics = vi.fn().mockResolvedValue(undefined);

vi.mock('../workers/engage.worker', () => ({
  EngagementWorker: vi.fn().mockImplementation(() => ({
    processComment: mockProcessComment,
    processDM: mockProcessDM,
  })),
}));

vi.mock('../workers/content.worker', () => ({
  ContentWorker: vi.fn().mockImplementation(() => ({
    generateCaption: mockGenerateCaption,
    schedulePost: vi.fn(),
    generateCalendar: vi.fn(),
  })),
}));

vi.mock('../workers/comms.worker', () => ({
  CommsWorker: vi.fn().mockImplementation(() => ({
    sendDailyBriefing: mockDailyBriefing,
    sendWeeklyReport: vi.fn(),
    notifyNewLead: vi.fn(),
  })),
}));

vi.mock('../workers/intel.worker', () => ({
  IntelWorker: vi.fn().mockImplementation(() => ({
    collectAnalytics: mockCollectAnalytics,
    monitorCompetitors: vi.fn(),
    checkEngagementSpike: vi.fn(),
  })),
}));

vi.mock('../workers/admin.worker', () => ({
  AdminWorker: vi.fn().mockImplementation(() => ({
    healthCheck: mockHealthCheck,
    getDailyCost: vi.fn(),
    checkTokenExpiry: vi.fn(),
    generateCostReport: vi.fn(),
  })),
}));

import { TaskRouter } from '../router';

describe('TaskRouter', () => {
  let router: TaskRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new TaskRouter({
      db: {} as any,
      redis: {} as any,
      ig: {} as any,
      llm: {} as any,
      rag: {} as any,
      apify: {} as any,
      metricool: {} as any,
      rateLimiter: {} as any,
      circuitBreaker: {} as any,
      tokenManager: {} as any,
    });
  });

  it('should route process_comment to EngagementWorker', async () => {
    const payload = { ig_comment_id: '123', author_name: 'user', text: 'nice!' };
    await router.route('process_comment', 'tenant-1', payload);
    expect(mockProcessComment).toHaveBeenCalledWith('tenant-1', payload);
  });

  it('should route process_dm to EngagementWorker', async () => {
    const payload = { ig_sender_id: '456', sender_name: 'user', message_text: 'hello' };
    await router.route('process_dm', 'tenant-1', payload);
    expect(mockProcessDM).toHaveBeenCalledWith('tenant-1', payload);
  });

  it('should route generate_caption to ContentWorker', async () => {
    const payload = { topic: 'summer sale', image_url: 'https://example.com/img.jpg' };
    await router.route('generate_caption', 'tenant-1', payload);
    expect(mockGenerateCaption).toHaveBeenCalledWith('tenant-1', 'summer sale', 'https://example.com/img.jpg');
  });

  it('should route health_check to AdminWorker', async () => {
    await router.route('health_check', 'tenant-1', {});
    expect(mockHealthCheck).toHaveBeenCalledWith('tenant-1');
  });

  it('should route daily_briefing to CommsWorker', async () => {
    await router.route('daily_briefing', 'tenant-1', {});
    expect(mockDailyBriefing).toHaveBeenCalledWith('tenant-1');
  });

  it('should route collect_analytics to IntelWorker', async () => {
    await router.route('collect_analytics', 'tenant-1', {});
    expect(mockCollectAnalytics).toHaveBeenCalledWith('tenant-1');
  });

  it('should throw on unknown task', async () => {
    await expect(router.route('nonexistent_task', 'tenant-1', {})).rejects.toThrow('Unknown task: nonexistent_task');
  });
});
