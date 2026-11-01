# Claw SMM Stack

A multi-tenant stack for running an AI social media manager on Instagram: it triages comments and DMs, drafts or sends replies, plans content and reports to the client.

Claw SMM Stack is aimed at an agency or operator who manages Instagram accounts for several small businesses and wants the repetitive work (answering comments, sorting DMs, writing captions, weekly numbers) handled by a queue of workers, with a human approving anything sensitive. Each client is a tenant with its own brand voice, off-limits topics, competitor list, rate limits and daily model budget. Account actions (replies, hiding, publishing, insights) go through Meta's Graph API.

## What it does

- **Comment and DM triage** (`workers/engage.worker.ts`): each comment is classified as praise, question, complaint, spam or lead. Praise gets an automatic reply, questions get a draft that waits for approval, complaints are escalated to a human, spam is hidden and leads start a follow-up sequence. Context comes from a per-tenant vector store.
- **Content planning** (`workers/content.worker.ts`): caption generation, publishing through the Graph API, scheduling through Metricool and 7-day content calendars.
- **Intel** (`workers/intel.worker.ts`): analytics collection from Instagram insights, engagement spike checks and a weekly competitor pulse using public profile data through Apify actors.
- **Client comms** (`workers/comms.worker.ts`): drafts the daily briefing, weekly report and new-lead notice with the LLM router and records them in the audit log. Delivery to the client's chat app is not wired in this repo.
- **Admin** (`workers/admin.worker.ts`): per-tenant health checks, cost reports and Meta token expiry handling.
- **Multi-model router** (`integrations/llm.ts`): task types map to three model tiers (a cheap default for classification and short replies, a stronger model for plans and reports, a premium one for client communication and crises) with token caps and a per-tenant daily budget that blocks calls once spent.
- **Safety plumbing:** BullMQ queues for comments, DMs, content and reports; a circuit breaker around the Meta API; a Redis sliding-window rate limiter per tenant (API calls, DMs, publishes); webhook signature verification; a token manager that encrypts Meta tokens with AES-256-GCM and refreshes them before expiry; an `audit_log` table.
- **Dashboard** (`services/dashboard`): Next.js pages for tenants (list, create, detail), an analytics page, an approval queue, a comment feed and a health endpoint, plus an Instagram webhook route.
- **Operations:** scripts to onboard and remove a tenant, back up the database, deploy with migrations, rotate Meta tokens and seed a demo tenant. Eight cron jobs drive the heartbeat (health every 15 minutes, hourly analytics, daily briefing, weekly report, Friday competitor pulse, token and cost checks).

## How it's built

```
Meta webhooks --> webhook handler (signature check) --> BullMQ queues on Redis
                                                              |
                     task router --> engage / content / intel / comms / admin workers
                                                              |
                         PostgreSQL (tenants, posts, comments, dms, analytics, audit_log)
                         Qdrant (RAG memory)    multi-model LLM router    Meta Graph API v21
```

- **Worker service:** TypeScript on Node, Express, BullMQ, `node-cron`, `pg`, `ioredis`, zod and winston. Vitest tests cover the circuit breaker, router, engagement logic and Instagram client (32 test cases).
- **Dashboard:** Next.js 15, React 19, Tailwind CSS and Recharts.
- **Infrastructure:** Docker Compose runs seven services: the OpenClaw gateway, PostgreSQL 16, Redis 7, Qdrant, n8n, the worker and the dashboard. Six SQL migrations create the schema on first start.
- **Agent definitions:** `config/` holds the gateway config, a SOUL and HEARTBEAT file and per-vertical SOUL templates (restaurant, e-commerce, creator); `skills/` holds five skill definitions, one per worker.

## Repository layout

- `services/worker/`: queue workers, integrations, utilities and tests.
- `services/dashboard/`: the Next.js admin dashboard.
- `migrations/`: six SQL files, run in order by the Postgres container.
- `config/`: gateway config, SOUL and HEARTBEAT, vertical templates.
- `skills/`: `smm-admin`, `smm-comms`, `smm-content`, `smm-engage`, `smm-intel`.
- `scripts/`: tenant, backup, deploy, token rotation and seed scripts.
- `docs/`: architecture, API reference, onboarding SOP and troubleshooting.
- `docker-compose.yml`, `docker-compose.dev.yml`: full stack and infrastructure-only.

## Run it locally

```bash
cp .env.example .env            # fill in the values
docker compose up -d
curl localhost:4000/health      # worker
./scripts/seed-demo.sh          # demo tenant

# development: infrastructure in Docker, services on the host
docker compose -f docker-compose.dev.yml up -d postgres redis qdrant
cd services/worker && npm install && npm run dev      # npm test for the suite
cd services/dashboard && npm install && npm run dev
```

Environment variables (keys only, see `.env.example`): database (`DB_USER`, `DB_PASS`, `DB_NAME`, `DATABASE_URL`), `REDIS_URL`, `QDRANT_URL`, n8n login (`N8N_USER`, `N8N_PASS`), model providers (`MOONSHOT_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`), Meta (`META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`), `ENCRYPTION_KEY`, `LLM_DAILY_BUDGET_USD`, `WORKER_PORT`, and optional Telegram notification settings.

You also need a Meta app with Instagram Graph API access and a client account connected to a Facebook Page; `docs/ONBOARDING.md` walks through it.

## Status

Prototype. The worker pipeline, schema and unit tests are the most complete part. The dashboard is a scaffold: its API routes read `DB_HOST` and `DB_PASSWORD` while Compose passes `DATABASE_URL`, and they query `direct_messages` and `tenant_metrics`, which the migrations do not create. The stack has not been verified against a live Meta app in this repository. Seven commits, 2026-02-11 to 2026-02-13.
