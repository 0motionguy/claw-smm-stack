import { z } from 'zod';

export const AnalyticsSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  date: z.string(), // DATE as ISO string
  followers: z.number().default(0),
  following: z.number().default(0),
  posts_count: z.number().default(0),
  engagement_rate: z.number().default(0),
  reach: z.number().default(0),
  impressions: z.number().default(0),
  comments_received: z.number().default(0),
  comments_replied: z.number().default(0),
  dms_received: z.number().default(0),
  dms_replied: z.number().default(0),
  leads_captured: z.number().default(0),
  created_at: z.date(),
});

export type Analytics = z.infer<typeof AnalyticsSchema>;

export const UpsertAnalyticsSchema = AnalyticsSchema.omit({ id: true, created_at: true });
export type UpsertAnalytics = z.infer<typeof UpsertAnalyticsSchema>;
