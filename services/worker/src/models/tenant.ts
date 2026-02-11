import { z } from 'zod';

/**
 * Tenant model - multi-tenant isolation
 */

export const TenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  ig_user_id: z.string().optional().nullable(),
  ig_username: z.string().optional().nullable(),
  meta_access_token: z.string().optional().nullable(), // Encrypted
  meta_token_expires_at: z.date().optional().nullable(),
  meta_refresh_token: z.string().optional().nullable(), // Encrypted
  meta_app_id: z.string().optional().nullable(),
  meta_app_secret: z.string().optional().nullable(),
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
  subscription_tier: z.enum(['free', 'basic', 'pro', 'enterprise']).default('free'),
  onboarding_completed: z.boolean().default(false),
  settings: z.record(z.unknown()).optional().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Tenant = z.infer<typeof TenantSchema>;

export const CreateTenantSchema = TenantSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
}).partial({
  ig_user_id: true,
  ig_username: true,
  meta_access_token: true,
  meta_token_expires_at: true,
  meta_refresh_token: true,
  meta_app_id: true,
  meta_app_secret: true,
  status: true,
  subscription_tier: true,
  onboarding_completed: true,
  settings: true,
});

export type CreateTenant = z.infer<typeof CreateTenantSchema>;

export const UpdateTenantSchema = TenantSchema.partial().omit({
  id: true,
  created_at: true,
});

export type UpdateTenant = z.infer<typeof UpdateTenantSchema>;

/**
 * Tenant settings schema
 */
export const TenantSettingsSchema = z.object({
  // Comment moderation settings
  comment_moderation: z
    .object({
      enabled: z.boolean().default(true),
      auto_hide_toxic: z.boolean().default(true),
      auto_reply_enabled: z.boolean().default(true),
      reply_delay_seconds: z.number().min(0).max(3600).default(60),
      toxicity_threshold: z.number().min(0).max(1).default(0.7),
    })
    .optional(),

  // DM settings
  dm_settings: z
    .object({
      enabled: z.boolean().default(true),
      auto_reply_enabled: z.boolean().default(false),
      business_hours_only: z.boolean().default(false),
      business_hours: z
        .object({
          start: z.string().default('09:00'),
          end: z.string().default('17:00'),
          timezone: z.string().default('UTC'),
        })
        .optional(),
    })
    .optional(),

  // Content generation settings
  content_generation: z
    .object({
      enabled: z.boolean().default(true),
      auto_schedule: z.boolean().default(false),
      posts_per_week: z.number().min(0).max(21).default(3),
      preferred_posting_times: z.array(z.string()).optional(),
      brand_voice: z.string().optional(),
      topics: z.array(z.string()).optional(),
    })
    .optional(),

  // Analytics settings
  analytics: z
    .object({
      enabled: z.boolean().default(true),
      report_frequency: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
      metrics_tracked: z
        .array(
          z.enum([
            'engagement',
            'reach',
            'impressions',
            'followers',
            'saves',
            'shares',
            'profile_visits',
          ])
        )
        .optional(),
    })
    .optional(),

  // Notification settings
  notifications: z
    .object({
      email_enabled: z.boolean().default(true),
      email_address: z.string().email().optional(),
      notify_on_toxic_comment: z.boolean().default(true),
      notify_on_high_engagement: z.boolean().default(true),
      notify_on_crisis: z.boolean().default(true),
    })
    .optional(),
});

export type TenantSettings = z.infer<typeof TenantSettingsSchema>;
