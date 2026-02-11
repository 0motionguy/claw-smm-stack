# API Reference

## Worker Service (port 4000)

### Health

#### `GET /health`
Worker service health check.

**Response:**
```json
{
  "status": "healthy",
  "uptime": 3600,
  "queues": { "comments": true, "dms": true, "content": true, "reports": true }
}
```

#### `GET /health/:tenantId`
Per-tenant health check (DB, Redis, token validity, rate limits).

**Response:**
```json
{
  "status": "healthy",
  "checks": { "db": true, "redis": true, "token_valid": true, "rate_limit_ok": true }
}
```

#### `GET /cost/:tenantId`
Daily LLM cost for a tenant.

**Response:**
```json
{
  "total_usd": 2.34,
  "by_model": { "kimi-k2.5": 0.80, "claude-opus-4.6": 1.54 },
  "budget_remaining": 2.66
}
```

---

## Dashboard API (port 3000)

### Tenants

#### `GET /api/tenants`
List all tenants.

#### `POST /api/tenants`
Create a new tenant.

**Body:**
```json
{
  "name": "Client Name",
  "ig_handle": "clienthandle",
  "ig_access_token": "token...",
  "ig_user_id": "12345",
  "brand_voice": "Warm and professional",
  "no_go_topics": ["politics", "religion"],
  "status": "active"
}
```

#### `GET /api/tenants/:id`
Get tenant details.

#### `PATCH /api/tenants/:id`
Update tenant.

#### `DELETE /api/tenants/:id`
Soft-delete tenant (sets status to 'inactive').

### Webhooks

#### `GET /api/webhooks/instagram`
Meta webhook verification (challenge-response).

**Query params:** `hub.mode`, `hub.verify_token`, `hub.challenge`

#### `POST /api/webhooks/instagram`
Receive Instagram webhook events. Validates `x-hub-signature-256`, routes comments to comment queue and DMs to DM queue.

### Health

#### `GET /api/health`
Dashboard + infrastructure health.

**Response:**
```json
{
  "status": "healthy",
  "services": { "database": "connected", "redis": "connected", "worker": "healthy" }
}
```

---

## Queue Job Schemas

### Comment Job
```json
{
  "tenantId": "uuid",
  "ig_comment_id": "string",
  "author_name": "string",
  "text": "string",
  "post_id": "string (optional)"
}
```

### DM Job
```json
{
  "tenantId": "uuid",
  "ig_sender_id": "string",
  "sender_name": "string",
  "message_text": "string"
}
```

### Content Job
```json
{
  "tenantId": "uuid",
  "type": "generate_caption | schedule_post | generate_calendar",
  "topic": "string",
  "image_url": "string (optional)",
  "post_id": "string (for schedule_post)",
  "days": "number (for generate_calendar)"
}
```

### Report Job
```json
{
  "tenantId": "uuid",
  "type": "daily_briefing | weekly_report | monthly_review | competitor_pulse | cost_report"
}
```
