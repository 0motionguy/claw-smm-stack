# Architecture

## System Overview

```
                    ┌──────────────────────────────────────────────┐
                    │              Meta Platform                    │
                    │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
                    │  │ Comments  │ │   DMs    │ │  Insights    │ │
                    │  └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
                    └───────┼────────────┼──────────────┼──────────┘
                            │            │              │
                    ┌───────▼────────────▼──────────────▼──────────┐
                    │           Webhook Handler                     │
                    │     (Signature verify + routing)              │
                    └───────┬────────────┬─────────────────────────┘
                            │            │
                    ┌───────▼───┐  ┌─────▼─────┐
                    │  Comment   │  │   DM      │
                    │  Queue     │  │   Queue   │  ◄── BullMQ (Redis)
                    └───────┬───┘  └─────┬─────┘
                            │            │
┌───────────────────────────▼────────────▼─────────────────────────┐
│                      Worker Service                               │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌───────┐  ┌────────┐ │
│  │  Engage  │  │ Content  │  │ Comms  │  │ Intel │  │ Admin  │ │
│  │  Worker  │  │ Worker   │  │ Worker │  │Worker │  │Worker  │ │
│  └────┬─────┘  └────┬─────┘  └───┬────┘  └───┬───┘  └───┬────┘ │
│       │              │            │            │          │       │
│  ┌────▼──────────────▼────────────▼────────────▼──────────▼────┐ │
│  │                    Task Router                               │ │
│  └──────────────────────┬──────────────────────────────────────┘ │
│                         │                                        │
│  ┌──────────────────────▼──────────────────────────────────────┐ │
│  │  Utils: Circuit Breaker · Rate Limiter · Token Manager      │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────┬───────────────┬────────────────┬──────────────────┘
               │               │                │
       ┌───────▼───┐   ┌──────▼─────┐   ┌──────▼──────┐
       │ PostgreSQL │   │   Redis    │   │   Qdrant    │
       │ (tenants,  │   │ (queues,   │   │ (RAG vector │
       │  posts,    │   │  rate      │   │  memory)    │
       │  comments, │   │  limits,   │   │             │
       │  audit)    │   │  cache)    │   │             │
       └───────────┘   └────────────┘   └─────────────┘
```

## Data Flow: Comment Processing

1. Instagram sends webhook → Dashboard `/api/webhooks/instagram`
2. Signature verified → Job added to `comments` BullMQ queue
3. Worker picks up job → Resolves tenant from IG user ID
4. Retrieves brand context from Qdrant (k=10 results)
5. LLM Router classifies intent (Kimi K2.5, 256 token cap)
6. Routes based on intent:
   - **Praise** → Generate reply (Kimi) → Auto-send via IG API (Mode A)
   - **Question** → Generate draft (Kimi) → Queue for human approval (Mode B)
   - **Complaint** → Escalate to human dashboard (Mode C)
   - **Spam** → Auto-hide via IG API (Mode A)
   - **Lead** → Draft DM qualification (Kimi) → Queue for approval (Mode B)
7. Log to `comments` table + `audit_log`
8. Store interaction in Qdrant for future context

## LLM Routing Strategy

| Task Type | Model | Token Cap | Budget Share |
|-----------|-------|-----------|-------------|
| classify | Kimi K2.5 | 256 | ~80% |
| short_reply | Kimi K2.5 | 512 | |
| caption | Kimi K2.5 / Opus 4.6 | 1024 | |
| plan | Claude Opus 4.6 | 2048 | ~15% |
| report | Claude Opus 4.6 | 2048 | |
| client_comms | Claude Pro | 4096 | ~5% |
| crisis | Claude Pro | 4096 | |

Daily budget: $5/tenant. Router tracks costs in `audit_log.cost_usd`.

## Heartbeat Schedule

| Trigger | Frequency | Worker | Action |
|---------|-----------|--------|--------|
| Health check | Every 15 min | Admin | DB, Redis, token, rate limit check |
| Analytics | Hourly | Intel | Fetch IG insights, upsert analytics |
| Spike detection | Hourly (:30) | Intel | Check if >50 comments/hr |
| Morning briefing | Daily 8 AM | Comms | Generate + send daily stats |
| Token expiry | Daily midnight | Admin | Refresh tokens expiring within 10 days |
| Cost report | Daily 11 PM | Admin | Aggregate daily spend across tenants |
| Weekly report | Monday 9 AM | Comms | 7-day performance summary |
| Competitor pulse | Friday 10 AM | Intel | Scrape + analyze competitor profiles |

## Multi-Tenancy

- Every DB table has `tenant_id` foreign key
- Rate limits are per-tenant (Redis sorted sets)
- Qdrant collections are per-tenant
- Instagram tokens are per-tenant (encrypted)
- LLM budget is per-tenant ($5/day default)
- Queue jobs carry `tenantId` for routing

## Security

- Meta webhook signatures verified with HMAC SHA-256
- Instagram tokens encrypted at rest (AES-256-GCM)
- Auto-refresh tokens at 50 days (expires at 60)
- Secrets in .env only (never in code or logs)
- Circuit breaker prevents cascade failures
- Rate limiter prevents API ban
