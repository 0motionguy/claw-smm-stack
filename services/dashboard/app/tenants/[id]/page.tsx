'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface TenantDetail {
  id: string;
  name: string;
  ig_handle: string;
  status: 'active' | 'paused' | 'inactive';
  follower_count: number;
  engagement_rate: number;
  brand_voice: string;
  posting_frequency: string;
  timezone: string;
  no_go_topics: string[];
  competitors: string[];
  created_at: string;
  last_active_at: string;
}

interface Post {
  id: string;
  content: string;
  status: 'draft' | 'scheduled' | 'published';
  scheduled_for: string | null;
  published_at: string | null;
  likes_count: number;
  comments_count: number;
}

interface Comment {
  id: string;
  author: string;
  text: string;
  intent: string;
  reply_status: 'pending' | 'approved' | 'rejected' | 'sent';
  ai_reply: string | null;
  created_at: string;
}

type Tab = 'posts' | 'comments' | 'dms' | 'analytics' | 'settings';

export default function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('posts');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantData();
  }, [resolvedParams.id]);

  async function fetchTenantData() {
    try {
      const response = await fetch(`/api/tenants/${resolvedParams.id}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setTenant(data.tenant);
      setPosts(data.posts || []);
      setComments(data.comments || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tenant data');
      console.error('Failed to fetch tenant:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading tenant...</p>
        </div>
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="space-y-8">
        <Link href="/tenants" className="text-sm text-primary hover:underline">
          ← Back to Tenants
        </Link>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h3 className="text-lg font-semibold text-destructive">Error Loading Tenant</h3>
          <p className="mt-2 text-sm text-destructive/80">
            {error || 'Tenant not found'}
          </p>
          <button onClick={fetchTenantData} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <Link href="/tenants" className="text-sm text-primary hover:underline">
        ← Back to Tenants
      </Link>

      {/* Header */}
      <div className="stat-card">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tenant.name}</h1>
            <p className="text-lg text-muted-foreground">@{tenant.ig_handle}</p>
            <div className="mt-4 flex items-center gap-4">
              <StatusBadge status={tenant.status} />
              <span className="text-sm text-muted-foreground">
                Last active{' '}
                {tenant.last_active_at
                  ? formatDistanceToNow(new Date(tenant.last_active_at), {
                      addSuffix: true,
                    })
                  : 'never'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Followers</p>
            <p className="text-3xl font-bold">{tenant.follower_count.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground mt-2">
              {tenant.engagement_rate.toFixed(2)}% engagement
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex space-x-8">
          <TabButton
            active={activeTab === 'posts'}
            onClick={() => setActiveTab('posts')}
          >
            Posts
          </TabButton>
          <TabButton
            active={activeTab === 'comments'}
            onClick={() => setActiveTab('comments')}
          >
            Comments
          </TabButton>
          <TabButton
            active={activeTab === 'dms'}
            onClick={() => setActiveTab('dms')}
          >
            DMs
          </TabButton>
          <TabButton
            active={activeTab === 'analytics'}
            onClick={() => setActiveTab('analytics')}
          >
            Analytics
          </TabButton>
          <TabButton
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </TabButton>
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'posts' && <PostsTab posts={posts} />}
        {activeTab === 'comments' && <CommentsTab comments={comments} />}
        {activeTab === 'dms' && <DMsTab />}
        {activeTab === 'analytics' && <AnalyticsTab tenant={tenant} />}
        {activeTab === 'settings' && <SettingsTab tenant={tenant} />}
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

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-1 py-4 text-sm font-medium transition-colors ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function PostsTab({ posts }: { posts: Post[] }) {
  return (
    <div className="space-y-4">
      {posts.length === 0 ? (
        <div className="stat-card text-center py-12">
          <p className="text-muted-foreground">No posts yet</p>
        </div>
      ) : (
        posts.map((post) => (
          <div key={post.id} className="stat-card">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm">{post.content}</p>
                <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                  <span>{post.likes_count} likes</span>
                  <span>{post.comments_count} comments</span>
                </div>
              </div>
              <StatusBadge status={post.status as 'active' | 'paused' | 'inactive'} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function CommentsTab({ comments }: { comments: Comment[] }) {
  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <div className="stat-card text-center py-12">
          <p className="text-muted-foreground">No comments yet</p>
        </div>
      ) : (
        comments.map((comment) => (
          <div key={comment.id} className="stat-card">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-medium">@{comment.author}</p>
                <p className="mt-1 text-sm text-muted-foreground">{comment.text}</p>
                {comment.ai_reply && (
                  <div className="mt-3 rounded-lg bg-accent p-3">
                    <p className="text-sm font-medium">AI Reply:</p>
                    <p className="mt-1 text-sm">{comment.ai_reply}</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <IntentBadge intent={comment.intent} />
                <span
                  className={`text-xs ${
                    comment.reply_status === 'sent'
                      ? 'text-green-600'
                      : comment.reply_status === 'approved'
                      ? 'text-blue-600'
                      : comment.reply_status === 'rejected'
                      ? 'text-red-600'
                      : 'text-yellow-600'
                  }`}
                >
                  {comment.reply_status}
                </span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  const color =
    intent === 'praise'
      ? 'bg-green-100 text-green-800'
      : intent === 'question'
      ? 'bg-blue-100 text-blue-800'
      : intent === 'complaint'
      ? 'bg-red-100 text-red-800'
      : intent === 'spam'
      ? 'bg-gray-100 text-gray-800'
      : intent === 'lead'
      ? 'bg-purple-100 text-purple-800'
      : 'bg-gray-100 text-gray-800';

  return <span className={`status-badge ${color}`}>{intent}</span>;
}

function DMsTab() {
  return (
    <div className="stat-card text-center py-12">
      <p className="text-muted-foreground">DMs feature coming soon</p>
    </div>
  );
}

function AnalyticsTab({ tenant }: { tenant: TenantDetail }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="stat-card">
        <p className="text-sm font-medium text-muted-foreground">Engagement Rate</p>
        <p className="mt-2 text-3xl font-bold">{tenant.engagement_rate.toFixed(2)}%</p>
      </div>
      <div className="stat-card">
        <p className="text-sm font-medium text-muted-foreground">Follower Count</p>
        <p className="mt-2 text-3xl font-bold">{tenant.follower_count.toLocaleString()}</p>
      </div>
    </div>
  );
}

function SettingsTab({ tenant }: { tenant: TenantDetail }) {
  return (
    <div className="space-y-6">
      <div className="stat-card">
        <h3 className="text-lg font-semibold mb-4">Configuration</h3>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Brand Voice</dt>
            <dd className="mt-1 text-sm">{tenant.brand_voice}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Posting Frequency</dt>
            <dd className="mt-1 text-sm">{tenant.posting_frequency}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Timezone</dt>
            <dd className="mt-1 text-sm">{tenant.timezone}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">No-Go Topics</dt>
            <dd className="mt-1 text-sm">{tenant.no_go_topics.join(', ') || 'None'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-sm font-medium text-muted-foreground">Competitors</dt>
            <dd className="mt-1 text-sm">{tenant.competitors.join(', ') || 'None'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
