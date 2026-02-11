'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface Tenant {
  id: string;
  name: string;
  ig_handle: string;
  status: 'active' | 'paused' | 'inactive';
  follower_count: number;
  last_active_at: string;
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenants();
  }, []);

  async function fetchTenants() {
    try {
      const response = await fetch('/api/tenants');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setTenants(data.tenants || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tenants');
      console.error('Failed to fetch tenants:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading tenants...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
          <Link href="/tenants/new" className="btn-primary">
            Add Tenant
          </Link>
        </div>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h3 className="text-lg font-semibold text-destructive">Error Loading Tenants</h3>
          <p className="mt-2 text-sm text-destructive/80">{error}</p>
          <button onClick={fetchTenants} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
          <p className="text-muted-foreground">
            Manage all Instagram accounts under AI management
          </p>
        </div>
        <Link href="/tenants/new" className="btn-primary">
          Add Tenant
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-6 md:grid-cols-3">
        <div className="stat-card">
          <p className="text-sm font-medium text-muted-foreground">Total Tenants</p>
          <p className="mt-2 text-3xl font-bold">{tenants.length}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm font-medium text-muted-foreground">Active</p>
          <p className="mt-2 text-3xl font-bold text-green-600">
            {tenants.filter(t => t.status === 'active').length}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-sm font-medium text-muted-foreground">Total Followers</p>
          <p className="mt-2 text-3xl font-bold">
            {tenants.reduce((sum, t) => sum + t.follower_count, 0).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Tenants Table */}
      <div className="stat-card">
        {tenants.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-lg font-medium text-muted-foreground">No tenants yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Get started by adding your first Instagram account
            </p>
            <Link href="/tenants/new" className="btn-primary mt-4 inline-flex">
              Add Your First Tenant
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                    IG Handle
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Followers
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                    Last Active
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr
                    key={tenant.id}
                    className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    <td className="py-4 px-4">
                      <Link
                        href={`/tenants/${tenant.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {tenant.name}
                      </Link>
                    </td>
                    <td className="py-4 px-4 text-muted-foreground">
                      @{tenant.ig_handle}
                    </td>
                    <td className="py-4 px-4">
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="py-4 px-4 text-right font-medium">
                      {tenant.follower_count.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-sm text-muted-foreground">
                      {tenant.last_active_at
                        ? formatDistanceToNow(new Date(tenant.last_active_at), {
                            addSuffix: true,
                          })
                        : 'Never'}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <Link
                        href={`/tenants/${tenant.id}`}
                        className="text-sm text-primary hover:underline"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  status: 'active' | 'paused' | 'inactive';
}

function StatusBadge({ status }: StatusBadgeProps) {
  const className = `status-badge ${
    status === 'active'
      ? 'status-active'
      : status === 'paused'
      ? 'status-paused'
      : 'status-inactive'
  }`;

  return <span className={className}>{status}</span>;
}
