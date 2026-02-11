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
git clone https://github.com/1337/claw-smm-stack.git
cd claw-smm-stack

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 3. Start services
docker-compose up -d

# 4. Run migrations
docker-compose exec postgres psql -U smm -d smm_agent -f /docker-entrypoint-initdb.d/001_create_tenants.sql

# 5. Worker is running!
docker-compose logs -f worker
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

- [x] Docker Compose stack
- [x] Database schema
- [ ] Instagram API integration
- [ ] Engagement Worker (CRITICAL)
- [ ] Content Worker
- [ ] DeepSeek RAG
- [ ] LLM Router
- [ ] Dashboard

## License

Private — ICM Motion / Basil Dölger
