import { Queue, Job } from 'bullmq';
import { z } from 'zod';
import { getQueueConnection } from './connection';

export const COMMENT_QUEUE = 'comment-processing';

export const CommentJobSchema = z.object({
  tenantId: z.string().uuid(),
  ig_comment_id: z.string(),
  author_name: z.string(),
  text: z.string(),
  post_id: z.string().optional(),
});

export type CommentJobData = z.infer<typeof CommentJobSchema>;

export const commentQueue = new Queue<CommentJobData>(COMMENT_QUEUE, { connection: getQueueConnection() });

export async function addCommentJob(data: CommentJobData): Promise<Job<CommentJobData>> {
  const validated = CommentJobSchema.parse(data);
  return commentQueue.add('process-comment', validated, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  });
}
