import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'claw_smm',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Validation schema for creating a tenant
const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  ig_handle: z.string().min(1).max(30).regex(/^[a-zA-Z0-9._]+$/),
  brand_voice: z.string().min(10),
  posting_frequency: z.enum(['daily', 'twice_daily', 'weekly', 'custom']),
  timezone: z.string(),
  no_go_topics: z.array(z.string()),
  competitors: z.array(z.string()),
});

// GET /api/tenants - List all tenants
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeAnalytics = searchParams.get('analytics') === 'true';
    const range = searchParams.get('range') || '30';

    const client = await pool.connect();
    try {
      if (includeAnalytics) {
        // Fetch tenants with analytics data
        const result = await client.query(`
          SELECT
            t.id,
            t.name,
            t.ig_handle,
            t.status,
            t.follower_count,
            COALESCE(
              (SELECT COUNT(*) FROM posts WHERE tenant_id = t.id AND published_at >= NOW() - INTERVAL '${parseInt(range)} days'),
              0
            ) as posts_count,
            COALESCE(
              (SELECT COUNT(*) FROM comments WHERE tenant_id = t.id AND created_at >= NOW() - INTERVAL '${parseInt(range)} days'),
              0
            ) as comments_handled,
            COALESCE(
              (SELECT COUNT(*) FROM direct_messages WHERE tenant_id = t.id AND created_at >= NOW() - INTERVAL '${parseInt(range)} days'),
              0
            ) as dms_handled,
            COALESCE(t.engagement_rate, 0) as engagement_rate,
            COALESCE(
              (SELECT follower_count FROM tenant_metrics WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1 OFFSET 1),
              0
            ) as previous_follower_count
          FROM tenants t
          ORDER BY t.created_at DESC
        `);

        const tenants = result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          follower_growth: row.follower_count - (row.previous_follower_count || row.follower_count),
          engagement_rate: parseFloat(row.engagement_rate),
          posts_count: parseInt(row.posts_count),
          comments_handled: parseInt(row.comments_handled),
          dms_handled: parseInt(row.dms_handled),
        }));

        // Mock chart data - in production, query actual metrics
        const chartData = generateMockChartData(parseInt(range));

        return NextResponse.json({ tenants, chartData });
      } else {
        // Simple tenant list
        const result = await client.query(`
          SELECT
            id,
            name,
            ig_handle,
            status,
            follower_count,
            last_active_at,
            created_at
          FROM tenants
          ORDER BY created_at DESC
        `);

        return NextResponse.json({ tenants: result.rows });
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('GET /api/tenants error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tenants', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/tenants - Create new tenant
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const validationResult = createTenantSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert tenant
      const result = await client.query(
        `INSERT INTO tenants (
          name,
          ig_handle,
          status,
          brand_voice,
          posting_frequency,
          timezone,
          no_go_topics,
          competitors,
          follower_count,
          engagement_rate,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING *`,
        [
          data.name,
          data.ig_handle,
          'active',
          data.brand_voice,
          data.posting_frequency,
          data.timezone,
          JSON.stringify(data.no_go_topics),
          JSON.stringify(data.competitors),
          0, // Initial follower count
          0, // Initial engagement rate
        ]
      );

      await client.query('COMMIT');

      const tenant = result.rows[0];

      // Parse JSON fields for response
      const responseData = {
        ...tenant,
        no_go_topics: JSON.parse(tenant.no_go_topics || '[]'),
        competitors: JSON.parse(tenant.competitors || '[]'),
      };

      return NextResponse.json({ tenant: responseData }, { status: 201 });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('POST /api/tenants error:', error);
    return NextResponse.json(
      { error: 'Failed to create tenant', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Helper function to generate mock chart data
function generateMockChartData(days: number) {
  const data = [];
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
