import { z } from 'zod';

export const PostSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ig_media_id: z.string().nullable(),
  caption: z.string().nullable(),
  hashtags: z.array(z.string()).default([]),
  image_url: z.string().nullable(),
  scheduled_at: z.date().nullable(),
  published_at: z.date().nullable(),
  status: z.enum(['draft', 'scheduled', 'published', 'failed']).default('draft'),
  engagement_count: z.number().default(0),
  created_at: z.date(),
});

export type Post = z.infer<typeof PostSchema>;

export const CreatePostSchema = PostSchema.omit({ id: true, created_at: true }).partial({
  ig_media_id: true,
  hashtags: true,
  image_url: true,
  scheduled_at: true,
  published_at: true,
  status: true,
  engagement_count: true,
});

export type CreatePost = z.infer<typeof CreatePostSchema>;
