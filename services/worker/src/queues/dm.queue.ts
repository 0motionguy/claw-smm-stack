import { Queue, Job } from 'bullmq';
import { z } from 'zod';
import { getQueueConnection } from './connection';

export const DM_QUEUE = 'dm-processing';

export const DMJobSchema = z.object({
  tenantId: z.string().uuid(),
  ig_sender_id: z.string(),
  sender_name: z.string(),
  message_text: z.string(),
});

export type DMJobData = z.infer<typeof DMJobSchema>;

export const dmQueue = new Queue<DMJobData>(DM_QUEUE, { connection: getQueueConnection() });

export async function addDMJob(data: DMJobData): Promise<Job<DMJobData>> {
  const validated = DMJobSchema.parse(data);
  return dmQueue.add('process-dm', validated, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  });
}
