import { z } from 'zod';

export const DMSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ig_sender_id: z.string(),
  sender_name: z.string().nullable(),
  message_text: z.string(),
  category: z.enum(['faq', 'order', 'lead', 'complaint', 'spam', 'general']).nullable(),
  reply_text: z.string().nullable(),
  reply_status: z.enum(['pending', 'drafted', 'approved', 'sent', 'auto', 'skipped']).default('pending'),
  replied_at: z.date().nullable(),
  created_at: z.date(),
});

export type DM = z.infer<typeof DMSchema>;

export const CreateDMSchema = DMSchema.omit({ id: true, created_at: true }).partial({
  category: true,
  reply_text: true,
  reply_status: true,
  replied_at: true,
  sender_name: true,
});

export type CreateDM = z.infer<typeof CreateDMSchema>;
