import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

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

// GET /api/tenants/[id] - Get tenant details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const client = await pool.connect();
    try {
      // Fetch tenant details
      const tenantResult = await client.query(
        `SELECT
          id,
          name,
          ig_handle,
          status,
          follower_count,
          engagement_rate,
          brand_voice,
          posting_frequency,
          timezone,
          no_go_topics,
          competitors,
          created_at,
          last_active_at
        FROM tenants
        WHERE id = $1`,
        [id]
      );

      if (tenantResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Tenant not found' },
          { status: 404 }
        );
      }

      const tenant = tenantResult.rows[0];

      // Parse JSON fields
      tenant.no_go_topics = JSON.parse(tenant.no_go_topics || '[]');
      tenant.competitors = JSON.parse(tenant.competitors || '[]');

      // Fetch recent posts
      const postsResult = await client.query(
        `SELECT
          id,
          content,
          status,
          scheduled_for,
          published_at,
          likes_count,
          comments_count,
          created_at
        FROM posts
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
        [id]
      );

      // Fetch recent comments
      const commentsResult = await client.query(
        `SELECT
          id,
          author_username as author,
          text,
          intent,
          reply_status,
          ai_reply,
          created_at
        FROM comments
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
        [id]
      );

      return NextResponse.json({
        tenant,
        posts: postsResult.rows,
        comments: commentsResult.rows,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('GET /api/tenants/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tenant', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// PATCH /api/tenants/[id] - Update tenant
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const allowedFields = [
      'name',
      'status',
      'brand_voice',
      'posting_frequency',
      'timezone',
      'no_go_topics',
      'competitors',
    ];

    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateFields.push(`${field} = $${paramIndex}`);
        values.push(
          field === 'no_go_topics' || field === 'competitors'
            ? JSON.stringify(body[field])
            : body[field]
        );
        paramIndex++;
      }
    }

    if (updateFields.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    updateFields.push(`updated_at = $${paramIndex}`);
    values.push(new Date());
    paramIndex++;

    values.push(id);

    const client = await pool.connect();
    try {
      const result = await client.query(
        `UPDATE tenants
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Tenant not found' },
          { status: 404 }
        );
      }

      const tenant = result.rows[0];
      tenant.no_go_topics = JSON.parse(tenant.no_go_topics || '[]');
      tenant.competitors = JSON.parse(tenant.competitors || '[]');

      return NextResponse.json({ tenant });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('PATCH /api/tenants/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to update tenant', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[id] - Delete tenant
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete related records first (foreign key constraints)
      await client.query('DELETE FROM posts WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM comments WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM direct_messages WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM tenant_metrics WHERE tenant_id = $1', [id]);

      // Delete tenant
      const result = await client.query(
        'DELETE FROM tenants WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Tenant not found' },
          { status: 404 }
        );
      }

      await client.query('COMMIT');

      return NextResponse.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('DELETE /api/tenants/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete tenant', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
