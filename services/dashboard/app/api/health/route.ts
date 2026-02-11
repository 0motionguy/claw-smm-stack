import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { createClient } from 'redis';

// PostgreSQL connection pool
const pgPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'claw_smm',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Redis client (singleton)
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
      },
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    await redisClient.connect();
  }
  return redisClient;
}

export async function GET() {
  const health = {
    status: 'ok' as 'ok' | 'degraded' | 'down',
    services: {
      db: false,
      redis: false,
      workers: false,
    },
    stats: {
      activeTenants: 0,
      todayComments: 0,
      todayDMs: 0,
    },
    timestamp: new Date().toISOString(),
  };

  // Check PostgreSQL
  try {
    const client = await pgPool.connect();
    try {
      await client.query('SELECT 1');
      health.services.db = true;

      // Fetch stats
      const tenantsResult = await client.query(
        "SELECT COUNT(*) as count FROM tenants WHERE status = 'active'"
      );
      health.stats.activeTenants = parseInt(tenantsResult.rows[0]?.count || '0');

      const commentsResult = await client.query(
        "SELECT COUNT(*) as count FROM comments WHERE created_at >= CURRENT_DATE"
      );
      health.stats.todayComments = parseInt(commentsResult.rows[0]?.count || '0');

      const dmsResult = await client.query(
        "SELECT COUNT(*) as count FROM direct_messages WHERE created_at >= CURRENT_DATE"
      );
      health.stats.todayDMs = parseInt(dmsResult.rows[0]?.count || '0');
    } catch (error) {
      console.error('PostgreSQL health check failed:', error);
      health.services.db = false;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('PostgreSQL connection failed:', error);
    health.services.db = false;
  }

  // Check Redis
  try {
    const redis = await getRedisClient();
    await redis.ping();
    health.services.redis = true;

    // Check worker queues
    const pendingComments = await redis.lLen('ai:comments:pending');
    const pendingDMs = await redis.lLen('ai:dms:pending');

    // If queues exist and are being processed, workers are healthy
    // Simple heuristic: if queues have jobs but not too many (< 1000), workers are working
    if (pendingComments < 1000 && pendingDMs < 1000) {
      health.services.workers = true;
    }
  } catch (error) {
    console.error('Redis health check failed:', error);
    health.services.redis = false;
  }

  // Determine overall status
  const servicesUp = Object.values(health.services).filter(Boolean).length;
  const totalServices = Object.keys(health.services).length;

  if (servicesUp === totalServices) {
    health.status = 'ok';
  } else if (servicesUp > 0) {
    health.status = 'degraded';
  } else {
    health.status = 'down';
  }

  const statusCode = health.status === 'ok' ? 200 : health.status === 'degraded' ? 200 : 503;

  return NextResponse.json(health, { status: statusCode });
}
