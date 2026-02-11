'use client';

import { useEffect, useState } from 'react';
import { EngagementChart } from '@/components/EngagementChart';

type DateRange = '7' | '30' | '90';

interface TenantAnalytics {
  id: string;
  name: string;
  follower_growth: number;
  engagement_rate: number;
  posts_count: number;
  comments_handled: number;
  dms_handled: number;
}

interface ChartDataPoint {
  date: string;
  engagement_rate: number;
  reach: number;
  impressions: number;
}

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState<DateRange>('30');
  const [tenants, setTenants] = useState<TenantAnalytics[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange]);

  async function fetchAnalytics() {
    try {
      const response = await fetch(`/api/tenants?analytics=true&range=${dateRange}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setTenants(data.tenants || []);
      setChartData(data.chartData || generateMockChartData(parseInt(dateRange)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
    }
  }

  // Generate mock chart data for demo purposes
  function generateMockChartData(days: number): ChartDataPoint[] {
    const data: ChartDataPoint[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toISOString().split('T')[0],
        engagement_rate: 3 + Math.random() * 2,
        reach: 10000 + Math.random() * 5000,
        impressions: 15000 + Math.random() * 10000,
      });
    }
    return data;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h3 className="text-lg font-semibold text-destructive">Error Loading Analytics</h3>
          <p className="mt-2 text-sm text-destructive/80">{error}</p>
          <button onClick={fetchAnalytics} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const totalFollowerGrowth = tenants.reduce((sum, t) => sum + t.follower_growth, 0);
  const avgEngagementRate =
    tenants.length > 0
      ? tenants.reduce((sum, t) => sum + t.engagement_rate, 0) / tenants.length
      : 0;
  const totalPosts = tenants.reduce((sum, t) => sum + t.posts_count, 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">Cross-tenant performance insights</p>
        </div>

        {/* Date Range Selector */}
        <div className="flex gap-2">
          <DateRangeButton
            active={dateRange === '7'}
            onClick={() => setDateRange('7')}
          >
            Last 7 Days
          </DateRangeButton>
          <DateRangeButton
            active={dateRange === '30'}
            onClick={() => setDateRange('30')}
          >
            Last 30 Days
          </DateRangeButton>
          <DateRangeButton
            active={dateRange === '90'}
            onClick={() => setDateRange('90')}
          >
            Last 90 Days
          </DateRangeButton>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-6 md:grid-cols-3">
        <div className="stat-card">
          <p className="text-sm font-medium text-muted-foreground">Total Follower Growth</p>
          <p className="mt-2 text-3xl font-bold">
            {totalFollowerGrowth >= 0 ? '+' : ''}
            {totalFollowerGrowth.toLocaleString()}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Last {dateRange} days</p>
        </div>
        <div className="stat-card">
          <p className="text-sm font-medium text-muted-foreground">Avg. Engagement Rate</p>
          <p className="mt-2 text-3xl font-bold">{avgEngagementRate.toFixed(2)}%</p>
          <p className="mt-1 text-sm text-muted-foreground">Across all tenants</p>
        </div>
        <div className="stat-card">
          <p className="text-sm font-medium text-muted-foreground">Total Posts</p>
          <p className="mt-2 text-3xl font-bold">{totalPosts.toLocaleString()}</p>
          <p className="mt-1 text-sm text-muted-foreground">Last {dateRange} days</p>
        </div>
      </div>

      {/* Engagement Chart */}
      <div className="stat-card">
        <h2 className="text-lg font-semibold mb-4">Engagement Trends</h2>
        <EngagementChart data={chartData} />
      </div>

      {/* Top Performing Tenants */}
      <div className="stat-card">
        <h2 className="text-lg font-semibold mb-4">Top Performing Tenants</h2>
        {tenants.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No tenant data available</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                    Tenant
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Follower Growth
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Engagement Rate
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Posts
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Comments
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    DMs
                  </th>
                </tr>
              </thead>
              <tbody>
                {tenants
                  .sort((a, b) => b.engagement_rate - a.engagement_rate)
                  .map((tenant) => (
                    <tr
                      key={tenant.id}
                      className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                    >
                      <td className="py-4 px-4 font-medium">{tenant.name}</td>
                      <td className="py-4 px-4 text-right">
                        <span
                          className={
                            tenant.follower_growth >= 0
                              ? 'text-green-600'
                              : 'text-red-600'
                          }
                        >
                          {tenant.follower_growth >= 0 ? '+' : ''}
                          {tenant.follower_growth.toLocaleString()}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-medium">
                        {tenant.engagement_rate.toFixed(2)}%
                      </td>
                      <td className="py-4 px-4 text-right">
                        {tenant.posts_count.toLocaleString()}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {tenant.comments_handled.toLocaleString()}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {tenant.dms_handled.toLocaleString()}
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

interface DateRangeButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function DateRangeButton({ active, onClick, children }: DateRangeButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}
    >
      {children}
    </button>
  );
}
