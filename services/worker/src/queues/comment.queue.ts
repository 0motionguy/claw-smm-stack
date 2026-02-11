import { Queue, Worker, Job } from 'bullmq';
import { z } from 'zod';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

export const CommentJobSchema = z.object({
  tenantId: z.string().uuid(),
  ig_comment_id: z.string(),
  author_name: z.string(),
  text: z.string(),
  post_id: z.string().optional(),
});

export type CommentJobData = z.infer<typeof CommentJobSchema>;

export const commentQueue = new Queue<CommentJobData>('comment-processing', { connection });

export async function addCommentJob(data: CommentJobData): Promise<Job<CommentJobData>> {
  const validated = CommentJobSchema.parse(data);
  return commentQueue.add('process-comment', validated, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  });
}
