import { Queue, Job } from 'bullmq';
import { z } from 'zod';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

export const ReportJobSchema = z.object({
  tenantId: z.string().uuid(),
  type: z.enum(['daily_briefing', 'weekly_report', 'monthly_review', 'competitor_pulse', 'cost_report']),
});

export type ReportJobData = z.infer<typeof ReportJobSchema>;

export const reportQueue = new Queue<ReportJobData>('report-processing', { connection });

export async function addReportJob(data: ReportJobData): Promise<Job<ReportJobData>> {
  const validated = ReportJobSchema.parse(data);
  return reportQueue.add(data.type, validated, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
  });
}
