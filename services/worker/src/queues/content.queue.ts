import { Queue, Job } from 'bullmq';
import { z } from 'zod';
import { getQueueConnection } from './connection';

export const CONTENT_QUEUE = 'content-processing';

export const ContentJobSchema = z.object({
  tenantId: z.string().uuid(),
  type: z.enum(['generate_caption', 'schedule_post', 'generate_calendar']),
  topic: z.string().optional(),
  postId: z.string().uuid().optional(),
  scheduledAt: z.string().optional(),
  days: z.number().optional(),
});

export type ContentJobData = z.infer<typeof ContentJobSchema>;

export const contentQueue = new Queue<ContentJobData>(CONTENT_QUEUE, { connection: getQueueConnection() });

export async function addContentJob(data: ContentJobData): Promise<Job<ContentJobData>> {
  const validated = ContentJobSchema.parse(data);
  return contentQueue.add(data.type, validated, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
  });
}
