import { Redis } from 'ioredis';
import { logger } from './logger';

/**
 * Sliding window rate limiter using Redis
 * Per-tenant limits: api: 180/hr, dm: 190/hr, publish: 20/24hr
 */

export type RateLimitType = 'api' | 'dm' | 'publish';

interface RateLimitConfig {
  maxCalls: number;
  windowMs: number;
}

const RATE_LIMITS: Record<RateLimitType, RateLimitConfig> = {
  api: {
    maxCalls: 180,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  dm: {
    maxCalls: 190,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  publish: {
    maxCalls: 20,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
  },
};

export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  /**
   * Check if a call would exceed rate limits
   * @param tenantId - Tenant identifier
   * @param type - Type of operation
   * @returns true if within limits, false if would exceed
   */
  async checkLimit(tenantId: string, type: RateLimitType): Promise<boolean> {
    const key = this.getKey(tenantId, type);
    const config = RATE_LIMITS[type];
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Remove expired entries
      await this.redis.zremrangebyscore(key, 0, windowStart);

      // Count current entries in window
      const count = await this.redis.zcard(key);

      const allowed = count < config.maxCalls;

      if (!allowed) {
        logger.warn('Rate limit check failed', {
          action: 'rate_limit_exceeded',
          tenant_id: tenantId,
          type,
          current_count: count,
          limit: config.maxCalls,
        });
      }

      return allowed;
    } catch (error) {
      logger.error('Rate limit check error', {
        action: 'rate_limit_check_error',
        tenant_id: tenantId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fail open - allow the call if rate limiter fails
      return true;
    }
  }

  /**
   * Record a call for rate limiting
   * @param tenantId - Tenant identifier
   * @param type - Type of operation
   */
  async recordCall(tenantId: string, type: RateLimitType): Promise<void> {
    const key = this.getKey(tenantId, type);
    const config = RATE_LIMITS[type];
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Use pipeline for atomic operations
      const pipeline = this.redis.pipeline();

      // Remove expired entries
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Add current call with timestamp as score
      pipeline.zadd(key, now, `${now}:${Math.random()}`);

      // Set expiration to window size + buffer
      pipeline.expire(key, Math.ceil(config.windowMs / 1000) + 60);

      await pipeline.exec();

      logger.debug('Rate limit call recorded', {
        action: 'rate_limit_recorded',
        tenant_id: tenantId,
        type,
      });
    } catch (error) {
      logger.error('Rate limit record error', {
        action: 'rate_limit_record_error',
        tenant_id: tenantId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get current usage stats for a tenant
   * @param tenantId - Tenant identifier
   * @param type - Type of operation
   */
  async getUsage(tenantId: string, type: RateLimitType): Promise<{
    current: number;
    limit: number;
    remaining: number;
    resetAt: Date;
  }> {
    const key = this.getKey(tenantId, type);
    const config = RATE_LIMITS[type];
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Remove expired entries and count
      await this.redis.zremrangebyscore(key, 0, windowStart);
      const count = await this.redis.zcard(key);

      return {
        current: count,
        limit: config.maxCalls,
        remaining: Math.max(0, config.maxCalls - count),
        resetAt: new Date(now + config.windowMs),
      };
    } catch (error) {
      logger.error('Rate limit usage check error', {
        action: 'rate_limit_usage_error',
        tenant_id: tenantId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return safe defaults on error
      return {
        current: 0,
        limit: config.maxCalls,
        remaining: config.maxCalls,
        resetAt: new Date(now + config.windowMs),
      };
    }
  }

  /**
   * Reset rate limit for a tenant (admin function)
   * @param tenantId - Tenant identifier
   * @param type - Type of operation (optional, resets all if not specified)
   */
  async reset(tenantId: string, type?: RateLimitType): Promise<void> {
    try {
      if (type) {
        const key = this.getKey(tenantId, type);
        await this.redis.del(key);
        logger.info('Rate limit reset', {
          action: 'rate_limit_reset',
          tenant_id: tenantId,
          type,
        });
      } else {
        // Reset all types
        const keys = Object.keys(RATE_LIMITS).map((t) =>
          this.getKey(tenantId, t as RateLimitType)
        );
        await this.redis.del(...keys);
        logger.info('All rate limits reset', {
          action: 'rate_limit_reset_all',
          tenant_id: tenantId,
        });
      }
    } catch (error) {
      logger.error('Rate limit reset error', {
        action: 'rate_limit_reset_error',
        tenant_id: tenantId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getKey(tenantId: string, type: RateLimitType): string {
    return `rate_limit:${tenantId}:${type}`;
  }
}
