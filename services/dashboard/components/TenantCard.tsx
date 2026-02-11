'use client';

import Link from 'next/link';

interface TenantCardProps {
  id: string;
  name: string;
  ig_handle: string;
  status: 'active' | 'paused' | 'onboarding';
  followers?: number;
  pending_items?: number;
}

export function TenantCard({ id, name, ig_handle, status, followers, pending_items }: TenantCardProps) {
  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
    onboarding: 'bg-blue-100 text-blue-800',
  };

  return (
    <Link href={`/tenants/${id}`}>
      <div className="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer bg-white">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-lg">{name}</h3>
          <span className={`text-xs px-2 py-1 rounded-full ${statusColors[status] || 'bg-gray-100'}`}>
            {status}
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-3">@{ig_handle}</p>
        <div className="flex justify-between text-sm">
          <div>
            <span className="text-gray-400">Followers</span>
            <p className="font-medium">{followers?.toLocaleString() ?? 'N/A'}</p>
          </div>
          {pending_items !== undefined && pending_items > 0 && (
            <div className="text-right">
              <span className="text-gray-400">Pending</span>
              <p className="font-medium text-orange-600">{pending_items}</p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
