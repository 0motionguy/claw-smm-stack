# Troubleshooting Guide

## Common Issues

### 1. Token Expired / Instagram API 401

**Symptoms:** Comments/DMs not processing, audit_log shows `failed` entries

**Fix:**
```bash
# Check token status
psql $DATABASE_URL -c "SELECT id, name, ig_token_expires_at FROM tenants WHERE status = 'active';"

# Manually refresh
./scripts/secrets-rotate.sh
```

The system auto-refreshes tokens at 50 days (expires at 60). If expired, re-authenticate via OAuth.

### 2. Rate Limit Hit (429 errors)

**Symptoms:** `Rate limit exceeded` in logs

**Check current usage:**
```bash
redis-cli ZCARD ratelimit:{tenant-id}:api
redis-cli ZCARD ratelimit:{tenant-id}:dm
```

**Limits:** 180 API calls/hr, 190 DMs/hr, 20 publishes/24hr

**Fix:** Wait for window to reset (sliding 1-hour window). Reduce polling frequency if recurring.

### 3. Circuit Breaker Open

**Symptoms:** `Circuit breaker is OPEN` in logs, all calls for a service failing

**Fix:** The circuit resets automatically after 60 seconds. Check the underlying service (Instagram API, LLM API) for outages. Monitor:
```bash
curl localhost:4000/health/{tenant-id}
```

### 4. LLM Budget Exceeded

**Symptoms:** `Budget exceeded` errors, $5/day limit hit

**Check spending:**
```bash
curl localhost:4000/cost/{tenant-id}
```

**Fix:** Increase `LLM_DAILY_BUDGET_USD` in .env or wait for daily reset (midnight UTC).

### 5. Qdrant Connection Failed

**Symptoms:** RAG context retrieval errors, poor reply quality

**Fix:**
```bash
docker compose restart qdrant
# Verify
curl localhost:6333/collections
```

### 6. Queue Backlog

**Symptoms:** Comments/DMs processing slowly

**Check queue depth:**
```bash
redis-cli LLEN bull:comments:wait
redis-cli LLEN bull:dms:wait
redis-cli LLEN bull:content:wait
redis-cli LLEN bull:reports:wait
```

**Fix:** Scale worker concurrency in `index.ts` or add more worker instances.

### 7. Webhook Not Receiving Events

**Verify webhook registration:**
1. Check Meta App Dashboard → Webhooks
2. Verify the webhook URL is publicly accessible
3. Test with: `curl -X GET "https://your-domain.com/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test"`

### 8. Database Connection Pool Exhausted

**Symptoms:** `too many clients already` error

**Fix:** Check `max` setting in pool config (default: 20). Identify long-running queries:
```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity WHERE state != 'idle' ORDER BY duration DESC;
```

## Health Check Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Worker service health |
| `GET /health/:tenantId` | Per-tenant health (DB, Redis, token, rate limits) |
| `GET /cost/:tenantId` | Daily LLM cost breakdown |

## Log Locations

- Worker: stdout (Docker) or `docker compose logs worker`
- Dashboard: stdout or `docker compose logs dashboard`
- Audit trail: `SELECT * FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50;`
