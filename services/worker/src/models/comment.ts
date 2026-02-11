import { z } from 'zod';

/**
 * Comment model - Instagram comments and moderation
 */

export const CommentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ig_comment_id: z.string(),
  ig_media_id: z.string(),
  ig_user_id: z.string(),
  ig_username: z.string(),
  text: z.string(),
  timestamp: z.date(),
  parent_comment_id: z.string().optional().nullable(), // For replies
  like_count: z.number().default(0),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'toxic']).optional().nullable(),
  toxicity_score: z.number().min(0).max(1).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  status: z
    .enum(['pending', 'reviewed', 'replied', 'hidden', 'deleted', 'ignored'])
    .default('pending'),
  auto_moderated: z.boolean().default(false),
  reply_id: z.string().uuid().optional().nullable(), // Reference to our reply comment
  reply_text: z.string().optional().nullable(),
  replied_at: z.date().optional().nullable(),
  hidden_at: z.date().optional().nullable(),
  deleted_at: z.date().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Comment = z.infer<typeof CommentSchema>;

export const CreateCommentSchema = CommentSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
}).partial({
  parent_comment_id: true,
  like_count: true,
  sentiment: true,
  toxicity_score: true,
  priority: true,
  status: true,
  auto_moderated: true,
  reply_id: true,
  reply_text: true,
  replied_at: true,
  hidden_at: true,
  deleted_at: true,
  metadata: true,
});

export type CreateComment = z.infer<typeof CreateCommentSchema>;

export const UpdateCommentSchema = CommentSchema.partial().omit({
  id: true,
  tenant_id: true,
  ig_comment_id: true,
  created_at: true,
});

export type UpdateComment = z.infer<typeof UpdateCommentSchema>;

/**
 * Comment moderation action
 */
export const CommentActionSchema = z.object({
  id: z.string().uuid(),
  comment_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  action_type: z.enum(['reply', 'hide', 'delete', 'ignore', 'escalate']),
  action_reason: z.string().optional().nullable(),
  performed_by: z.enum(['system', 'user', 'ai']),
  performed_at: z.date(),
  success: z.boolean(),
  error_message: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type CommentAction = z.infer<typeof CommentActionSchema>;

export const CreateCommentActionSchema = CommentActionSchema.omit({
  id: true,
  performed_at: true,
}).partial({
  action_reason: true,
  success: true,
  error_message: true,
  metadata: true,
});

export type CreateCommentAction = z.infer<typeof CreateCommentActionSchema>;

/**
 * Comment filters
 */
export const CommentFiltersSchema = z.object({
  tenant_id: z.string().uuid(),
  status: z
    .enum(['pending', 'reviewed', 'replied', 'hidden', 'deleted', 'ignored'])
    .optional(),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'toxic']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  from_date: z.date().optional(),
  to_date: z.date().optional(),
  ig_media_id: z.string().optional(),
  ig_username: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

export type CommentFilters = z.infer<typeof CommentFiltersSchema>;
