import { Queue, Job } from 'bullmq';
import { z } from 'zod';
import { getQueueConnection } from './connection';

export const REPORT_QUEUE = 'report-processing';

export const ReportJobSchema = z.object({
  tenantId: z.string().uuid(),
  type: z.enum(['daily_briefing', 'weekly_report', 'monthly_review', 'competitor_pulse', 'cost_report']),
});

export type ReportJobData = z.infer<typeof ReportJobSchema>;

export const reportQueue = new Queue<ReportJobData>(REPORT_QUEUE, { connection: getQueueConnection() });

export async function addReportJob(data: ReportJobData): Promise<Job<ReportJobData>> {
  const validated = ReportJobSchema.parse(data);
  return reportQueue.add(data.type, validated, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
  });
}
