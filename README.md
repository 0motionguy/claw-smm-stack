# 🦞 CLAW SMM STACK

**AI Social Media Employee — $997/mo Productized Service**

> Multi-tenant, Docker-based AI employee that manages Instagram, replies to comments, handles DMs, and communicates with clients via WhatsApp/Telegram.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT LAYER (WhatsApp/Telegram/Email)                     │
├─────────────────────────────────────────────────────────────┤
│  OpenClaw Gateway (Message Router + Auth)                   │
├─────────────────────────────────────────────────────────────┤
│  WORKER SERVICES                                            │
│  ├── Content Worker (captions, calendars)                   │
│  ├── Engagement Worker (comments, DMs) ⭐ CRITICAL          │
│  ├── Intel Worker (competitor monitoring)                   │
│  ├── Comms Worker (client briefings)                        │
│  └── Admin Worker (analytics, reports)                      │
├─────────────────────────────────────────────────────────────┤
│  INTEGRATIONS                                               │
│  ├── Meta Instagram Graph API                               │
│  ├── Instagram Messaging API                                │
│  ├── Qdrant (Vector DB / RAG)                               │
│  ├── DeepSeek (Embeddings)                                  │
│  └── Multi-LLM Router (Kimi/Opus/Claude)                    │
├─────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE                                             │
│  ├── PostgreSQL (Tenant DB)                                 │
│  ├── Redis (Queue + Cache)                                  │
│  ├── n8n (Workflow Automation)                              │
│  └── Next.js Dashboard                                      │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/0motionguy/claw-smm-stack.git
cd claw-smm-stack

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 3. Start full stack
docker compose up -d

# 4. Migrations run automatically via Docker entrypoint

# 5. Verify
curl localhost:4000/health   # Worker
curl localhost:3000           # Dashboard

# 6. Create demo tenant
./scripts/seed-demo.sh
```

### Local Development

```bash
# Start infrastructure only
docker compose -f docker-compose.dev.yml up -d postgres redis qdrant

# Worker (hot reload)
cd services/worker && npm install && npm run dev

# Dashboard (hot reload)
cd services/dashboard && npm install && npm run dev
```

## Multi-Agent Team

- **CLAW (Mac)** - Coordinator, gateway, integrations
- **Berni (AWS)** - Heavy compute, database, workers
- **DROID (Solana Saga)** - Mobile testing, client demos

## Revenue Model

| Tier | Price | Features |
|------|-------|----------|
| **Base** | $997/mo | 1 IG account, full automation |
| **Assistant** | +$497/mo | Email, calendar, extended support |
| **Multi-Channel** | +$297/mo/channel | TikTok, LinkedIn, X |
| **White-Label** | Custom | Agency branding, multi-client |

**Unit Economics:**
- Revenue: $997/mo
- Cost: $65-145/mo
- **Margin: 85-93%**

## Build Status

- [x] Docker Compose stack (7 services: gateway, postgres, redis, qdrant, n8n, worker, dashboard)
- [x] Database schema (6 migration files with indexes)
- [x] Instagram Graph API v21.0 integration (comments, DMs, publishing, insights)
- [x] Engagement Worker (classify -> route -> reply/draft/escalate/hide)
- [x] Content Worker (captions, scheduling, calendar generation)
- [x] Intel Worker (analytics, competitor monitoring, spike detection)
- [x] Comms Worker (daily briefing, weekly report, lead notifications)
- [x] Admin Worker (health checks, cost tracking, token management)
- [x] DeepSeek RAG (Qdrant vector search)
- [x] Multi-LLM Router (Kimi K2.5 80% / Opus 4.6 15% / Claude Pro 5%)
- [x] BullMQ Job Queues (comment, dm, content, report)
- [x] Heartbeat System (cron-driven: health, analytics, briefings, reports)
- [x] Next.js Dashboard (tenant CRUD, analytics charts, approval queue)
- [x] Circuit Breaker + Rate Limiter + Token Manager
- [x] DROID Mobile Agent (Puppeteer + ADB automation)
- [x] OpenClaw Skills (5 skill definitions)
- [x] Operational Scripts (onboard, offboard, backup, deploy, seed)
- [x] Tests (circuit-breaker, router, engage, instagram)
- [x] Documentation (onboarding, troubleshooting, API, architecture)

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/tenant-new.sh` | Onboard new client |
| `scripts/tenant-remove.sh` | Offboard client |
| `scripts/secrets-rotate.sh` | Rotate Meta tokens |
| `scripts/backup.sh` | Database backup |
| `scripts/deploy.sh` | Zero-downtime deploy |
| `scripts/seed-demo.sh` | Create demo tenant |

## Key Constraints

- All API calls through circuit breaker (max 3 failures -> pause)
- All LLM calls through router (never direct) with $5/day budget per tenant
- Rate limits: 180 API/hr, 190 DM/hr, 20 publishes/24hr per tenant
- TypeScript strict mode, Zod validation on all boundaries
- All actions logged to audit_log with cost tracking

## Docs

- [Onboarding](docs/ONBOARDING.md) - Client onboarding SOP
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues
- [API Reference](docs/API.md) - Endpoint docs
- [Architecture](docs/ARCHITECTURE.md) - System design

## License

Private - ICM Motion / Basil Dolger
