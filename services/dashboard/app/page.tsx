'use client';

import { useEffect, useState } from 'react';

interface HealthData {
  status: 'ok' | 'degraded' | 'down';
  services: {
    db: boolean;
    redis: boolean;
    workers: boolean;
  };
  stats: {
    activeTenants: number;
    todayComments: number;
    todayDMs: number;
  };
}

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth();
    // Refresh every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchHealth() {
    try {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setHealth(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health data');
      console.error('Health check failed:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
        <h3 className="text-lg font-semibold text-destructive">Error Loading Dashboard</h3>
        <p className="mt-2 text-sm text-destructive/80">{error}</p>
        <button onClick={fetchHealth} className="btn-primary mt-4">
          Retry
        </button>
      </div>
    );
  }

  const statusColor = health?.status === 'ok'
    ? 'text-green-600'
    : health?.status === 'degraded'
    ? 'text-yellow-600'
    : 'text-red-600';

  const statusBg = health?.status === 'ok'
    ? 'bg-green-100'
    : health?.status === 'degraded'
    ? 'bg-yellow-100'
    : 'bg-red-100';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor your AI social media management system
        </p>
      </div>

      {/* System Health */}
      <div className="stat-card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">System Health</h2>
            <p className="text-sm text-muted-foreground">
              Last updated: {new Date().toLocaleTimeString()}
            </p>
          </div>
          <div className={`flex items-center gap-2 rounded-full px-4 py-2 ${statusBg}`}>
            <div className={`h-3 w-3 rounded-full ${statusColor.replace('text-', 'bg-')}`}></div>
            <span className={`text-sm font-semibold uppercase ${statusColor}`}>
              {health?.status}
            </span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <ServiceStatus
            name="Database"
            status={health?.services.db ?? false}
          />
          <ServiceStatus
            name="Redis"
            status={health?.services.redis ?? false}
          />
          <ServiceStatus
            name="Workers"
            status={health?.services.workers ?? false}
          />
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-6 md:grid-cols-3">
        <StatCard
          title="Active Tenants"
          value={health?.stats.activeTenants ?? 0}
          description="Currently managed accounts"
          icon="👥"
        />
        <StatCard
          title="Comments Handled"
          value={health?.stats.todayComments ?? 0}
          description="Today"
          icon="💬"
        />
        <StatCard
          title="DMs Handled"
          value={health?.stats.todayDMs ?? 0}
          description="Today"
          icon="📨"
        />
      </div>

      {/* Quick Actions */}
      <div className="stat-card">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <a href="/tenants/new" className="btn-primary">
            Add New Tenant
          </a>
          <a href="/tenants" className="btn-secondary">
            View All Tenants
          </a>
          <a href="/analytics" className="btn-secondary">
            View Analytics
          </a>
        </div>
      </div>
    </div>
  );
}

interface ServiceStatusProps {
  name: string;
  status: boolean;
}

function ServiceStatus({ name, status }: ServiceStatusProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-4">
      <div className={`h-2 w-2 rounded-full ${status ? 'bg-green-500' : 'bg-red-500'}`}></div>
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          {status ? 'Online' : 'Offline'}
        </p>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: number;
  description: string;
  icon: string;
}

function StatCard({ title, value, description, icon }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold">{value.toLocaleString()}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}
