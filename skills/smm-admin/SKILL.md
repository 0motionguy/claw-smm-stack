# SMM Admin Skill

## Overview
The Admin Worker handles system maintenance, health monitoring, token management, cost tracking, and operational reliability. This skill ensures the Claw SMM stack runs smoothly 24/7 and alerts when intervention is needed.

## Skill ID
`smm-admin`

## Agent Assignment
**Primary Agent:** `admin-worker`
**Model:** Kimi K2.5 (cost-efficient for system tasks)
**Max Tokens:** 512

## Tools Available
- `db_query` - Query PostgreSQL for system stats and logs
- `redis_check` - Check Redis health and cache status
- `token_refresh` - Refresh Instagram access tokens before expiry
- `health_check` - Ping all services (Postgres, Redis, Qdrant, n8n, worker, dashboard)

## Capabilities

### 1. Health Monitoring
- Service availability checks (every 15 min)
- Database connection pool monitoring
- Redis memory usage tracking
- Qdrant collection status
- n8n workflow status
- Worker API response times

### 2. Token Management
- Instagram access token expiry tracking
- Auto-refresh tokens <10 days from expiry
- Alert client for manual re-authentication if auto-refresh fails
- Track token usage rate vs. limits

### 3. Cost Tracking
- LLM API usage monitoring (Kimi, Claude, OpenAI)
- Daily cost tallying per tenant
- Budget threshold alerts ($5/day default)
- Cost optimization recommendations

### 4. Rate Limit Management
- Instagram API call tracking (180/hour, 190 DM/hour, 20 publish/day)
- Redis rate limit counter monitoring
- Alert when approaching limits (>80% usage)
- Pause non-critical operations if limits hit

### 5. System Alerts
- Downtime notifications
- Performance degradation alerts
- Disk space warnings
- Backup verification

## Workflow

### Health Check Cycle (Every 15 min)
```
PROCESS:
1. health_check → Ping all services
2. db_query → Check connection pool, query latency
3. redis_check → Check memory usage, connected clients, hit rate
4. Check Qdrant collections (vector count, disk usage)
5. Log status to database
6. If any service fails → Alert immediately

OUTPUT (healthy):
{
  "timestamp": "2024-01-15T10:15:00Z",
  "status": "healthy",
  "services": {
    "postgres": { "status": "up", "latency_ms": 12, "connections": 8 },
    "redis": { "status": "up", "memory_mb": 128, "hit_rate": 0.94 },
    "qdrant": { "status": "up", "collections": 5, "vectors": 12489 },
    "n8n": { "status": "up", "workflows": 12, "active": 8 },
    "worker": { "status": "up", "latency_ms": 45 },
    "dashboard": { "status": "up", "latency_ms": 120 }
  },
  "rate_limits": {
    "instagram_api": { "used": 87, "limit": 180, "percentage": 48 },
    "instagram_dm": { "used": 23, "limit": 190, "percentage": 12 },
    "instagram_publish": { "used": 5, "limit": 20, "percentage": 25 }
  },
  "cost_today": 2.34,
  "cost_limit": 5.00
}

OUTPUT (degraded):
{
  "timestamp": "2024-01-15T10:15:00Z",
  "status": "degraded",
  "alerts": [
    {
      "severity": "warning",
      "service": "redis",
      "issue": "Memory usage at 245MB (96% of 256MB limit)",
      "recommendation": "Increase maxmemory or clear old cache"
    },
    {
      "severity": "critical",
      "service": "qdrant",
      "issue": "Connection timeout after 5s",
      "recommendation": "Check Qdrant container status, restart if needed"
    }
  ],
  "action_taken": "Paused non-critical Qdrant writes, alerted operations team"
}
```

### Token Management (Daily check at 9 AM)
```
PROCESS:
1. db_query → Fetch all client access tokens and expiry dates
2. For each token:
   - If expires in <10 days → token_refresh (auto-renewal)
   - If expires in <3 days and auto-refresh failed → Alert client urgently
   - If expires in <1 day → Pause operations, escalate to human
3. Log token refresh status

OUTPUT:
{
  "date": "2024-01-15",
  "tokens_checked": 5,
  "status": {
    "healthy": 3,
    "expiring_soon": 1,
    "critical": 1
  },
  "actions": [
    {
      "client": "client_a",
      "token_expires": "2024-01-22",
      "days_remaining": 7,
      "action": "Auto-refreshed successfully",
      "new_expiry": "2024-03-15"
    },
    {
      "client": "client_b",
      "token_expires": "2024-01-17",
      "days_remaining": 2,
      "action": "Auto-refresh failed - Instagram API error",
      "alert": "Sent urgent notification to client - manual re-auth needed"
    }
  ]
}
```

### Cost Tracking (Continuous)
```
PROCESS:
1. Track every LLM API call with cost metadata
2. Aggregate by tenant and model
3. Store in database with timestamp
4. Alert if daily cost >$4.50 (90% of $5 limit)
5. Pause non-critical operations if >$5

OUTPUT (end of day summary):
{
  "date": "2024-01-15",
  "total_cost": 4.23,
  "budget": 5.00,
  "percentage_used": 84.6,
  "breakdown_by_model": {
    "kimi-k2.5": { "calls": 287, "cost": 2.45, "percentage": 57.9 },
    "claude-opus-4.6": { "calls": 12, "cost": 1.78, "percentage": 42.1 }
  },
  "breakdown_by_skill": {
    "smm-content": 1.56,
    "smm-engage": 0.89,
    "smm-intel": 1.23,
    "smm-comms": 0.55
  },
  "optimization_opportunities": [
    "Consider using Sonnet 3.5 for smm-comms daily briefings (save ~40%)",
    "Cache FAQ responses to reduce smm-engage LLM calls"
  ]
}
```

### Rate Limit Monitoring (Real-time)
```
PROCESS:
1. Increment Redis counter for each Instagram API call
2. Check counter every API request
3. If >80% of limit → Warn in logs
4. If >95% of limit → Pause non-critical operations (analytics collection, competitor scraping)
5. If =100% → Queue operations for next hour

OUTPUT (approaching limit):
{
  "timestamp": "2024-01-15T14:42:00Z",
  "limit_type": "instagram_api",
  "current": 162,
  "limit": 180,
  "percentage": 90,
  "time_until_reset": "17 minutes",
  "action": "Paused competitor monitoring, prioritizing comment replies and DMs",
  "queued_operations": [
    "Fetch competitor @competitor1 posts (deferred to 15:00)",
    "Update analytics dashboard (deferred to 15:00)"
  ]
}
```

### System Alert Examples

**Service Down:**
```
🚨 CRITICAL ALERT

Service: Qdrant vector database
Status: DOWN (connection timeout)
Impact: Content generation and engagement replies degraded (no brand context)
Started: 2024-01-15 14:23:17 UTC
Duration: 3 minutes

Actions taken:
1. Switched to fallback mode (generic responses without personalization)
2. Queued 7 operations for retry when Qdrant recovers
3. Attempting automatic container restart

Investigating...
```

**Performance Degradation:**
```
⚠️ WARNING

Service: PostgreSQL
Issue: Query latency spiked to 450ms (normal: <50ms)
Impact: Dashboard loading slowly, admin operations delayed
Started: 2024-01-15 10:15:00 UTC

Possible causes:
- Long-running query (analytics report generation?)
- Connection pool exhaustion
- Disk I/O bottleneck

Actions taken:
1. Logged slow queries for review
2. Increased connection pool size +5
3. Monitoring for improvement

No client impact yet, but will escalate if persists >15 min.
```

**Budget Alert:**
```
💰 BUDGET ALERT

Daily LLM cost: $4.67 / $5.00 (93.4%)
Time: 8:42 PM (3h 18m left in day)

High-cost operations today:
1. Intel worker - competitor analysis (23 calls, $1.23)
2. Content worker - 12 caption generations ($0.89)

Actions taken:
- Paused competitor scraping for rest of day
- Switched daily briefing to Sonnet 3.5 (from Opus)

Projected end-of-day cost: $4.85 (within budget)
```

**Token Expiry:**
```
⏰ URGENT: Token Expiring Soon

Client: @restaurant_client
Instagram Token expires: Jan 17, 2024 (2 days)

Auto-refresh attempted: FAILED
Error: "User must manually re-authenticate"

ACTION REQUIRED:
Client must log in to dashboard and reconnect Instagram account.

Sent notification via:
✅ Telegram
✅ Email
✅ Dashboard banner

Operations will pause in 48 hours if not resolved.
```

## Admin Dashboard Metrics

Track and display (internal monitoring):
- **Uptime:** 99.8% (30-day rolling)
- **Service Health:** All green / 1 warning / 0 critical
- **Avg Response Time:** Worker 42ms, Dashboard 98ms
- **Rate Limit Usage:** 48% API, 12% DM, 25% Publish
- **Daily Cost:** $2.34 / $5.00 (46.8%)
- **Tokens Status:** 4 healthy, 1 expiring in 7 days
- **Database Size:** 1.2 GB / 50 GB
- **Redis Memory:** 128 MB / 256 MB (50%)
- **Qdrant Vectors:** 12,489 vectors, 3.4 GB

## Automated Recovery Actions

### Service Restart
If service health check fails 3x in a row:
1. Log failure
2. Attempt Docker container restart: `docker restart claw-[service]`
3. Wait 30s for startup
4. Re-run health check
5. If still fails → Escalate to human (alert via Telegram)

### Cache Eviction
If Redis memory >90%:
1. Log warning
2. Trigger manual eviction of oldest keys (based on LRU)
3. If still >90% → Increase maxmemory limit +128MB (up to 512MB max)
4. If 512MB exhausted → Alert for infrastructure upgrade

### Rate Limit Reset
When Instagram API rate limit resets (hourly):
1. Reset Redis counters to 0
2. Process queued operations (FIFO)
3. Resume normal operation
4. Log recovery in database

### Token Auto-Refresh
When token <10 days from expiry:
1. Call Instagram token refresh endpoint with long-lived token
2. Receive new 60-day token
3. Update database with new token and expiry
4. Log success
5. If fails → Retry after 1 hour, max 3 attempts
6. If all fail → Alert client for manual re-auth

## Context Requirements
Store in database:
- `system_health_log` - Time-series health check results
- `cost_tracking` - Per-call LLM costs with metadata
- `rate_limit_log` - API usage patterns
- `token_status` - Token expiry dates and refresh history
- `alert_history` - All alerts sent (for pattern analysis)

## Success Metrics
Track internally:
- **Uptime:** Target >99.5%
- **Mean Time to Detect (MTTD):** <1 minute for critical issues
- **Mean Time to Recover (MTTR):** <5 minutes for auto-recoverable issues
- **False Alert Rate:** <5% (alerts that didn't require action)
- **Token Refresh Success Rate:** >95%
- **Cost Accuracy:** Tracked cost within 2% of actual API bills

## Integration Points
- **PostgreSQL:** System state storage, health logs
- **Redis:** Rate limit counters, cache monitoring
- **Qdrant:** Collection health checks
- **n8n:** Workflow status monitoring
- **Docker:** Container health and restarts
- **Telegram Bot:** Alert delivery
- **Instagram Graph API:** Token refresh
- **LLM APIs:** Cost tracking (Kimi, Claude, OpenAI)

## Cost Optimization
- Kimi K2.5 for all admin tasks (~$0.002 per health check)
- Cache health check results for 15 min (avoid redundant service pings)
- Batch database queries (one query for all token status, not per-token)
- Use Redis counters (not DB writes) for rate limits

## Human Escalation Triggers
Alert operations team immediately if:
- Any service down >5 minutes despite auto-restart
- Database disk usage >80%
- Token refresh fails 3x for same client
- Daily cost exceeds $5.50 (110% of budget)
- Rate limit hit for 3+ consecutive hours (indicates traffic spike or bug)
- Manual intervention required (e.g., Instagram API change, new auth flow)

## Example Prompts for Kimi K2.5

**Health Assessment:**
```
Analyze this system health data and determine severity:

Services:
- Postgres: Latency 450ms (normal: 50ms)
- Redis: Memory 245MB / 256MB (96%)
- Qdrant: Connection timeout (5 attempts failed)
- Worker: Responding normally
- Dashboard: Slow (500ms response time)

Rate limits:
- Instagram API: 175 / 180 (97%)
- Instagram DM: 23 / 190 (12%)

Classify each issue as:
- OK: No action needed
- WARNING: Monitor, not critical yet
- CRITICAL: Immediate action required

Provide:
1. Severity for each issue
2. Likely root cause
3. Recommended action
4. Impact on client operations
```

**Cost Analysis:**
```
Analyze today's LLM costs and find optimization opportunities:

Total: $4.23 / $5.00
- Kimi K2.5: 287 calls, $2.45
- Opus 4.6: 12 calls, $1.78

Breakdown by skill:
- smm-content: 98 calls, $1.56
- smm-engage: 112 calls, $0.89
- smm-intel: 67 calls, $1.23
- smm-comms: 10 calls, $0.55

Identify:
1. High-cost operations that could use cheaper models
2. Redundant API calls (caching opportunities)
3. Projected cost if trends continue
4. Recommended cost-saving actions
```

**Token Management:**
```
Prioritize token refresh actions:

Tokens:
1. Client A: Expires Jan 22 (7 days) - auto-refresh scheduled
2. Client B: Expires Jan 17 (2 days) - auto-refresh FAILED
3. Client C: Expires Feb 10 (26 days) - healthy
4. Client D: Expires Jan 16 (1 day) - auto-refresh in progress
5. Client E: Expires Mar 5 (50 days) - healthy

For each token, provide:
1. Priority (critical / high / medium / low)
2. Recommended action (auto-retry / alert client / wait / none)
3. Message to client (if alert needed)
4. Escalation timeline (when to involve human)
```
