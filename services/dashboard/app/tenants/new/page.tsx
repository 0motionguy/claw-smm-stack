'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';

const tenantSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  ig_handle: z
    .string()
    .min(1, 'Instagram handle is required')
    .max(30, 'Handle too long')
    .regex(/^[a-zA-Z0-9._]+$/, 'Invalid Instagram handle format'),
  brand_voice: z.string().min(10, 'Brand voice description too short'),
  posting_frequency: z.enum(['daily', 'twice_daily', 'weekly', 'custom']),
  timezone: z.string().min(1, 'Timezone is required'),
  no_go_topics: z.string(), // Comma-separated, will be parsed
  competitors: z.string(), // Comma-separated, will be parsed
});

type TenantFormData = z.infer<typeof tenantSchema>;

export default function NewTenantPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<TenantFormData>({
    name: '',
    ig_handle: '',
    brand_voice: '',
    posting_frequency: 'daily',
    timezone: 'America/New_York',
    no_go_topics: '',
    competitors: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof TenantFormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error for this field
    if (errors[name as keyof TenantFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setSubmitError(null);

    // Validate with Zod
    const result = tenantSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof TenantFormData, string>> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as keyof TenantFormData] = err.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);

    try {
      // Parse comma-separated values
      const payload = {
        ...result.data,
        no_go_topics: result.data.no_go_topics
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        competitors: result.data.competitors
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      };

      const response = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      router.push(`/tenants/${data.tenant.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create tenant');
      console.error('Failed to create tenant:', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Breadcrumb */}
      <Link href="/tenants" className="text-sm text-primary hover:underline">
        ← Back to Tenants
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Add New Tenant</h1>
        <p className="text-muted-foreground">
          Onboard a new Instagram account for AI management
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="stat-card space-y-6">
        {submitError && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{submitError}</p>
          </div>
        )}

        {/* Name */}
        <div>
          <label htmlFor="name" className="label">
            Brand Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleChange}
            className="input-field mt-2"
            placeholder="e.g., Acme Corp"
            disabled={submitting}
          />
          {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name}</p>}
        </div>

        {/* IG Handle */}
        <div>
          <label htmlFor="ig_handle" className="label">
            Instagram Handle
          </label>
          <div className="relative mt-2">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
              @
            </span>
            <input
              id="ig_handle"
              name="ig_handle"
              type="text"
              value={formData.ig_handle}
              onChange={handleChange}
              className="input-field pl-7"
              placeholder="username"
              disabled={submitting}
            />
          </div>
          {errors.ig_handle && (
            <p className="mt-1 text-sm text-destructive">{errors.ig_handle}</p>
          )}
        </div>

        {/* Brand Voice */}
        <div>
          <label htmlFor="brand_voice" className="label">
            Brand Voice
          </label>
          <textarea
            id="brand_voice"
            name="brand_voice"
            value={formData.brand_voice}
            onChange={handleChange}
            rows={4}
            className="input-field mt-2"
            placeholder="Describe the brand's tone, personality, and communication style..."
            disabled={submitting}
          />
          {errors.brand_voice && (
            <p className="mt-1 text-sm text-destructive">{errors.brand_voice}</p>
          )}
        </div>

        {/* Posting Frequency */}
        <div>
          <label htmlFor="posting_frequency" className="label">
            Posting Frequency
          </label>
          <select
            id="posting_frequency"
            name="posting_frequency"
            value={formData.posting_frequency}
            onChange={handleChange}
            className="input-field mt-2"
            disabled={submitting}
          >
            <option value="daily">Daily</option>
            <option value="twice_daily">Twice Daily</option>
            <option value="weekly">Weekly</option>
            <option value="custom">Custom</option>
          </select>
          {errors.posting_frequency && (
            <p className="mt-1 text-sm text-destructive">{errors.posting_frequency}</p>
          )}
        </div>

        {/* Timezone */}
        <div>
          <label htmlFor="timezone" className="label">
            Timezone
          </label>
          <select
            id="timezone"
            name="timezone"
            value={formData.timezone}
            onChange={handleChange}
            className="input-field mt-2"
            disabled={submitting}
          >
            <option value="America/New_York">America/New_York (EST)</option>
            <option value="America/Chicago">America/Chicago (CST)</option>
            <option value="America/Denver">America/Denver (MST)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
            <option value="Europe/Paris">Europe/Paris (CET)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="Australia/Sydney">Australia/Sydney (AEDT)</option>
          </select>
          {errors.timezone && <p className="mt-1 text-sm text-destructive">{errors.timezone}</p>}
        </div>

        {/* No-Go Topics */}
        <div>
          <label htmlFor="no_go_topics" className="label">
            No-Go Topics
          </label>
          <input
            id="no_go_topics"
            name="no_go_topics"
            type="text"
            value={formData.no_go_topics}
            onChange={handleChange}
            className="input-field mt-2"
            placeholder="politics, religion, competitors (comma-separated)"
            disabled={submitting}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Comma-separated list of topics to avoid
          </p>
          {errors.no_go_topics && (
            <p className="mt-1 text-sm text-destructive">{errors.no_go_topics}</p>
          )}
        </div>

        {/* Competitors */}
        <div>
          <label htmlFor="competitors" className="label">
            Competitors
          </label>
          <input
            id="competitors"
            name="competitors"
            type="text"
            value={formData.competitors}
            onChange={handleChange}
            className="input-field mt-2"
            placeholder="@competitor1, @competitor2 (comma-separated)"
            disabled={submitting}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Comma-separated list of competitor handles
          </p>
          {errors.competitors && (
            <p className="mt-1 text-sm text-destructive">{errors.competitors}</p>
          )}
        </div>

        {/* Submit Buttons */}
        <div className="flex gap-4">
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Creating...' : 'Create Tenant'}
          </button>
          <Link href="/tenants" className="btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
