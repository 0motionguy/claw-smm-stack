'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DataPoint {
  date: string;
  followers: number;
  reach: number;
  impressions: number;
  comments_received: number;
  dms_received: number;
}

interface EngagementChartProps {
  data: DataPoint[];
  metric?: 'followers' | 'reach' | 'impressions' | 'engagement';
}

const COLORS = {
  followers: '#6366f1',
  reach: '#22c55e',
  impressions: '#f59e0b',
  comments_received: '#ef4444',
  dms_received: '#3b82f6',
};

export function EngagementChart({ data, metric }: EngagementChartProps) {
  if (!data || data.length === 0) {
    return <div className="border rounded-lg p-8 text-center text-gray-400">No analytics data yet</div>;
  }

  const formattedData = data.map((d) => ({
    ...d,
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  if (metric === 'engagement') {
    return (
      <div className="border rounded-lg p-4 bg-white">
        <h3 className="font-semibold mb-4">Engagement Overview</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={formattedData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="comments_received" stroke={COLORS.comments_received} name="Comments" strokeWidth={2} />
            <Line type="monotone" dataKey="dms_received" stroke={COLORS.dms_received} name="DMs" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const activeMetric = metric || 'followers';

  return (
    <div className="border rounded-lg p-4 bg-white">
      <h3 className="font-semibold mb-4 capitalize">{activeMetric}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={formattedData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" fontSize={12} />
          <YAxis fontSize={12} />
          <Tooltip />
          <Line
            type="monotone"
            dataKey={activeMetric}
            stroke={COLORS[activeMetric as keyof typeof COLORS] || '#6366f1'}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
