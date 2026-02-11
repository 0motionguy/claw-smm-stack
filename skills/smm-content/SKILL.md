# SMM Content Generation Skill

## Overview
The Content Worker specializes in generating high-quality social media content including captions, hashtags, content calendars, and scheduling posts. This skill operates in draft-first mode (Mode B) to ensure client approval before publishing.

## Skill ID
`smm-content`

## Agent Assignment
**Primary Agent:** `content-worker`
**Model:** Kimi K2.5 (default), Claude Opus 4.6 (complex/creative)
**Max Tokens:** 1024

## Tools Available
- `instagram_publish` - Publish posts to Instagram via Meta Graph API
- `metricool_schedule` - Schedule posts via Metricool API
- `qdrant_retrieve` - Retrieve brand context, past performance data, style guides

## Capabilities

### 1. Caption Generation
- Brand voice-matched captions (50-150 characters for hooks, 200-2000 for full)
- Emoji usage aligned with brand personality
- Call-to-action optimization
- Storytelling structure (hook → value → CTA)
- Platform-specific formatting (Instagram vs Facebook)

### 2. Hashtag Research & Strategy
- Mix of niche (1k-50k), mid-tier (50k-500k), and trending hashtags
- Industry-specific hashtag discovery
- Competitor hashtag analysis
- Custom branded hashtag recommendations
- Optimal hashtag count (25-30 for Instagram, 5-10 for others)

### 3. Content Calendar Planning
- 7-30 day content calendars
- Content pillar distribution (educational 40%, entertaining 30%, promotional 20%, personal 10%)
- Posting time optimization based on audience analytics
- Campaign coordination (product launches, events, holidays)
- Content gap analysis

### 4. Post Scheduling
- Queue posts in Metricool for automated publishing
- Respect client timezone and peak engagement windows
- Coordinate multi-platform posting
- Track scheduled vs. published posts

## Workflow

### Caption Generation Request
```
INPUT: "Generate caption for [POST_TYPE] about [TOPIC] for @[HANDLE]"

PROCESS:
1. qdrant_retrieve → Pull brand voice, past successful captions, audience preferences
2. Generate 3 caption variations (short/medium/long)
3. Add relevant emojis and line breaks
4. Suggest 20-30 hashtags
5. Draft CTA aligned with goal (engagement/traffic/sales)

OUTPUT (Draft for approval):
{
  "caption_short": "...",
  "caption_medium": "...",
  "caption_long": "...",
  "hashtags": ["#tag1", "#tag2", ...],
  "cta": "...",
  "emoji_strategy": "...",
  "reasoning": "Why this approach works for this audience"
}
```

### Content Calendar Request
```
INPUT: "Create 7-day content calendar for @[HANDLE] starting [DATE]"

PROCESS:
1. qdrant_retrieve → Pull content pillars, past performance, upcoming events
2. Map content types to optimal posting days/times
3. Balance promotional vs. value content
4. Identify trending topics and holidays
5. Suggest content formats (carousel, reel, single image, story)

OUTPUT (Draft for approval):
{
  "calendar": [
    {
      "date": "2024-01-15",
      "time": "09:00 AM",
      "content_type": "Educational Carousel",
      "topic": "5 Ways to X",
      "caption_draft": "...",
      "hashtags": [...],
      "image_brief": "Design suggestion for carousel slides",
      "goal": "Engagement + Saves"
    },
    ...
  ],
  "weekly_theme": "New Year Optimization",
  "notes": "Launch promo on Friday to leverage weekend traffic"
}
```

### Scheduling Workflow
```
INPUT: Approved caption + media + schedule time

PROCESS:
1. Validate media format and size
2. Check rate limits (20 posts/day for Instagram)
3. metricool_schedule → Queue post
4. Log scheduled post in database
5. Set reminder to verify publication

OUTPUT:
{
  "status": "scheduled",
  "post_id": "...",
  "scheduled_time": "2024-01-15T09:00:00Z",
  "platform": "instagram",
  "verification_time": "2024-01-15T09:15:00Z"
}
```

## Context Requirements
Pull from Qdrant before every generation:
- `brand_voice.txt` - Tone, style, vocabulary
- `past_top_posts.json` - What resonated with audience
- `audience_insights.json` - Demographics, interests, active times
- `content_pillars.json` - Strategic content distribution
- `competitors.json` - Hashtags and topics to monitor

## Mode B (Draft-First) Protocol
**NEVER auto-publish content without approval.**

1. Generate content variations
2. Send to client via Telegram/Dashboard for review
3. Wait for explicit approval or edits
4. Only then schedule/publish

## Rate Limit Awareness
- Max 20 posts/day to Instagram
- Track daily post count in Redis
- Warn client if approaching limit
- Suggest scheduling posts across multiple days

## Quality Checks
Before sending draft:
- [ ] Matches brand voice (check against Qdrant context)
- [ ] Includes clear CTA
- [ ] Hashtags are relevant and not banned
- [ ] No typos or grammar errors
- [ ] Respects character limits (2,200 for Instagram)
- [ ] Emojis render correctly
- [ ] No sensitive/controversial topics without explicit client approval

## Error Handling
- If Qdrant context missing → Request brand onboarding
- If media invalid → Notify client of format requirements
- If Metricool API fails → Retry once, then manual scheduling fallback
- If rate limit hit → Queue for next available slot

## Success Metrics
Track and report:
- Caption approval rate (target: >80%)
- Average time from draft to approval
- Post performance vs. AI-generated baseline
- Client satisfaction score for content quality
- Hashtag discovery effectiveness (new hashtags driving engagement)

## Example Prompts for Kimi K2.5

**Caption Generation:**
```
You are a social media copywriter for [CLIENT_NAME], a [INDUSTRY] brand.

Brand Voice: [VOICE_DESCRIPTION]
Target Audience: [AUDIENCE_DESCRIPTION]
Post Topic: [TOPIC]
Goal: [ENGAGEMENT/TRAFFIC/SALES]

Write 3 caption variations:
1. Short (50-80 characters) - for quick scrollers
2. Medium (150-200 characters) - balanced value + hook
3. Long (300-500 characters) - storytelling format

Include:
- Relevant emojis (match brand personality)
- Clear CTA
- Line breaks for readability
- 25 hashtags (mix niche + trending)

Past successful posts for reference:
[TOP_3_POSTS]
```

**Content Calendar:**
```
You are a social media strategist for [CLIENT_NAME].

Context:
- Posting frequency: [FREQUENCY]
- Content pillars: [PILLARS]
- Upcoming events: [EVENTS]
- Peak engagement times: [TIMES]
- Recent topics: [TOPICS]

Create a 7-day content calendar that:
1. Balances educational, entertaining, promotional content
2. Aligns with content pillars
3. Leverages trending topics
4. Respects optimal posting times
5. Drives toward goal: [GOAL]

For each day, provide:
- Date & time
- Content type (carousel, reel, story, etc.)
- Topic & hook
- Draft caption (100-200 chars)
- Hashtags (15-20)
- Visual brief
- Primary goal (engagement/reach/conversion)
```

## Integration Points
- **Qdrant:** Context retrieval before every generation
- **Metricool API:** Post scheduling
- **Instagram Graph API:** Direct publishing (if client enables)
- **Telegram Bot:** Draft approval workflow
- **Dashboard:** Content calendar view and approval UI

## Cost Optimization
- Kimi K2.5 for standard captions and calendars (~$0.01 per request)
- Escalate to Opus 4.6 only for:
  - High-stakes campaigns
  - Complex storytelling
  - Brand-sensitive topics
  - Client explicitly requests premium quality

## Human Escalation Triggers
Pass to Mode C (human-only) if:
- Client requests sensitive topic (politics, religion, controversy)
- Legal/medical claims in content
- Crisis communication
- Major brand announcement
- Client explicitly requests personal review
