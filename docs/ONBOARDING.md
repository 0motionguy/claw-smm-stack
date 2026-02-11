# Client Onboarding SOP

## Prerequisites

1. Client has an Instagram Business/Creator account
2. Client has a connected Facebook Page
3. Meta App is configured with Instagram API access

## Step-by-Step

### 1. Create Tenant

```bash
./scripts/tenant-new.sh
```

Follow the prompts:
- Client name
- Instagram handle
- Brand voice description
- No-go topics (comma-separated)
- Industry vertical (restaurant/ecommerce/creator/custom)

### 2. Connect Instagram

1. Guide client through Meta OAuth flow
2. Obtain long-lived access token (60-day)
3. Store encrypted token in tenant record
4. System auto-refreshes at 50 days

### 3. Configure SOUL

Edit `config/SOUL.md` template variables or use vertical-specific templates:
- `config/templates/soul-restaurant.md`
- `config/templates/soul-ecommerce.md`
- `config/templates/soul-creator.md`

Key settings:
- `brand_voice`: Tone and personality
- `no_go_topics`: Topics to avoid
- `auto_reply_enabled`: true/false per intent type
- `approval_mode`: 'auto' | 'draft_first' | 'human_only'

### 4. Upload Brand Knowledge

Upload brand FAQs, product info, and tone examples to Qdrant via:
```bash
curl -X POST localhost:4000/api/tenants/{id}/context \
  -H 'Content-Type: application/json' \
  -d '{"text": "Brand knowledge here...", "metadata": {"type": "faq"}}'
```

### 5. Set Up Webhooks

Register Instagram webhooks for the client's account:
- Comments on posts
- DMs/messaging
- Mentions

The webhook URL is: `https://your-domain.com/api/webhooks/instagram`

### 6. Configure Competitors (Optional)

Add competitor handles via dashboard or DB:
```sql
UPDATE tenants SET competitors = ARRAY['@competitor1', '@competitor2'] WHERE id = 'tenant-id';
```

### 7. Verify

1. Check health: `curl localhost:4000/health/{tenant-id}`
2. Post a test comment → verify auto-reply or draft
3. Send a test DM → verify classification
4. Check dashboard for real-time data

## Post-Onboarding

- Daily briefings start automatically at 8 AM
- Weekly reports every Monday 9 AM
- Competitor pulse every Friday 10 AM
- All actions visible in dashboard audit log
