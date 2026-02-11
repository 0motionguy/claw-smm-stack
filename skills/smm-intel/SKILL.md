# SMM Intelligence Skill

## Overview
The Intelligence Worker monitors competitors, collects analytics, identifies trends, and provides strategic insights. This skill operates autonomously (Mode A) for data collection and surfaces actionable intelligence to clients.

## Skill ID
`smm-intel`

## Agent Assignment
**Primary Agent:** `intel-worker`
**Model:** Kimi K2.5 (default), GPT-4 Turbo for complex analytics
**Max Tokens:** 2048

## Tools Available
- `apify_scrape` - Scrape public Instagram data via Apify actors
- `instagram_insights` - Fetch analytics via Meta Graph API
- `qdrant_store` - Store collected data and insights

## Capabilities

### 1. Competitor Monitoring
- Track competitor posting frequency and times
- Analyze competitor engagement rates
- Identify competitor content themes and formats
- Detect competitor campaigns and promotions
- Monitor competitor follower growth trends

### 2. Analytics Collection
- Fetch account insights (reach, impressions, engagement)
- Track post performance metrics
- Analyze audience demographics and behavior
- Monitor story completion rates
- Calculate engagement rate trends

### 3. Trend Detection
- Identify emerging hashtags in niche
- Detect viral content formats
- Monitor industry conversations
- Track seasonal patterns
- Spot influencer collaborations

### 4. Strategic Insights
- Content performance gap analysis
- Best time to post recommendations
- Underperforming content diagnosis
- Growth opportunity identification
- Competitive positioning analysis

## Workflow

### Competitor Monitoring Cycle (Weekly)
```
INPUT: Competitor handle @[COMPETITOR]

PROCESS:
1. apify_scrape → Fetch last 30 posts (public data only)
2. Extract metrics: likes, comments, post times, hashtags, content types
3. Calculate engagement rate: (likes + comments) / followers
4. qdrant_store → Save data with timestamp
5. Compare to previous week's data
6. Identify changes and trends

OUTPUT:
{
  "competitor": "@competitor_handle",
  "period": "2024-W03",
  "posts_published": 12,
  "avg_engagement_rate": 4.2,
  "engagement_change": "+0.5%",
  "top_post": {
    "url": "...",
    "type": "reel",
    "engagement": 8.7,
    "theme": "behind-the-scenes"
  },
  "posting_times": ["Mon 9am", "Wed 6pm", "Fri 12pm"],
  "trending_hashtags": ["#tag1", "#tag2"],
  "insights": "Competitor increased reel frequency, seeing 30% higher engagement"
}
```

### Own Account Analytics (Daily)
```
INPUT: Client handle @[CLIENT]

PROCESS:
1. instagram_insights → Fetch last 24h metrics (requires access token)
2. Calculate key metrics:
   - Reach (unique accounts reached)
   - Impressions (total views)
   - Engagement rate
   - Follower growth
   - Top posts
3. qdrant_store → Save data
4. Compare to previous day and 7-day average
5. Flag anomalies (spikes or drops >20%)

OUTPUT:
{
  "date": "2024-01-15",
  "followers": 15234,
  "follower_change": +42,
  "reach": 8943,
  "impressions": 12876,
  "engagement_rate": 3.8,
  "profile_visits": 234,
  "website_clicks": 67,
  "top_post": {
    "id": "...",
    "type": "carousel",
    "reach": 3421,
    "engagement": 6.2,
    "saves": 187
  },
  "anomalies": ["Reach down 25% vs 7-day avg"],
  "recommendations": ["Post carousel content more often - highest engagement"]
}
```

### Trend Detection (Daily)
```
INPUT: Client niche [NICHE]

PROCESS:
1. apify_scrape → Sample 100 recent posts from niche hashtags
2. Analyze:
   - Most used hashtags
   - Emerging content formats
   - Trending topics
   - Caption styles
3. qdrant_retrieve → Compare to historical trends
4. qdrant_store → Update trend database

OUTPUT:
{
  "niche": "fitness_coaching",
  "date": "2024-01-15",
  "trending_hashtags": [
    {"tag": "#75Hard", "growth": "+120%", "volume": "12k posts/day"},
    {"tag": "#MacroTracking", "growth": "+45%", "volume": "3k posts/day"}
  ],
  "hot_formats": [
    {"type": "transformation_reel", "engagement_avg": 5.2},
    {"type": "day_in_life_story", "completion_rate": 0.78}
  ],
  "emerging_topics": ["weight training for women", "nutrition myths"],
  "opportunity": "Create #75Hard challenge content - trending with high engagement"
}
```

### Performance Gap Analysis (Weekly)
```
INPUT: Client data + Competitor data

PROCESS:
1. qdrant_retrieve → Fetch week's data for client and competitors
2. Compare metrics:
   - Engagement rate
   - Posting frequency
   - Content mix
   - Hashtag strategy
   - Posting times
3. Identify performance gaps
4. Generate actionable recommendations

OUTPUT:
{
  "analysis_period": "2024-W03",
  "client_performance": {
    "engagement_rate": 2.8,
    "posting_frequency": "3x/week",
    "best_format": "carousel"
  },
  "competitor_avg": {
    "engagement_rate": 4.1,
    "posting_frequency": "5x/week",
    "best_format": "reel"
  },
  "gaps": [
    {
      "metric": "engagement_rate",
      "gap": "-1.3%",
      "reason": "Posting fewer reels (20% vs competitor 50%)",
      "opportunity": "high"
    },
    {
      "metric": "posting_frequency",
      "gap": "-2 posts/week",
      "reason": "Inconsistent schedule",
      "opportunity": "medium"
    }
  ],
  "recommendations": [
    "Increase reel production to 2-3x/week (projected +1.5% engagement)",
    "Add Thursday and Sunday posts to match competitor cadence",
    "Test competitor's top hashtags: #tag1, #tag2"
  ]
}
```

## Data Collection Schedule

### Continuous (Real-time)
- Own account engagement (comments, DMs, likes)
- Mentions and tags
- Story views and interactions

### Hourly
- Scheduled post verification
- Rate limit headroom check
- Queue depth monitoring

### Daily (8 AM client timezone)
- Full account insights pull
- Yesterday's performance summary
- Follower growth tracking
- Trend detection scan

### Weekly (Monday 9 AM)
- Competitor analysis cycle
- Week-over-week performance comparison
- Content audit (what worked, what didn't)
- Strategic recommendations

### Monthly (1st of month)
- Comprehensive performance report
- Month-over-month growth analysis
- Goal progress check
- Strategy adjustment recommendations

## Context Requirements
Store in Qdrant:
- `client_analytics/` - Daily metrics time series
- `competitor_data/` - Competitor snapshots
- `trend_history/` - Historical trend data
- `content_performance/` - Individual post performance
- `hashtag_research/` - Hashtag effectiveness data
- `audience_insights/` - Demographics and behavior patterns

## Rate Limit Awareness
- Instagram Insights API: 200 calls/hour per user token
- Apify Scraping: Varies by plan (respect Apify limits)
- Batch requests when possible
- Cache insights for 24 hours (avoid redundant pulls)

## Quality Checks
Before storing analytics:
- [ ] Data completeness (no null critical fields)
- [ ] Timestamp accuracy
- [ ] Metric validity (engagement rate 0-100%, followers >= 0)
- [ ] Deduplication (check if already stored)
- [ ] Privacy compliance (only public or authorized data)

## Smart Behaviors

### Anomaly Detection
Trigger alerts if:
- Engagement rate drops >30% for 3 consecutive days → "Investigate content quality or algorithm change"
- Follower growth spikes >100/day → "Check for bot follows or viral post"
- Reach drops >50% suddenly → "Possible shadowban or content violation"
- DM spike >50 messages/hour → "Check for viral post or controversy"

### Competitive Intelligence
- Identify competitor posting gaps (times they don't post → opportunity windows)
- Detect competitor campaign launches (coordinated content series)
- Monitor competitor follower sentiment (comment tone analysis)
- Track competitor influencer partnerships

### Trend Forecasting
- Detect early-stage trends (hashtag growth acceleration)
- Predict seasonal content demand (historical pattern matching)
- Identify niche migrations (audience interest shifts)

## Success Metrics
Track and report:
- Data collection uptime (target: >99.5%)
- Insight accuracy (recommendations that improved performance)
- Anomaly detection precision (true positives / total alerts)
- Competitive intelligence value (client-reported usefulness)
- Trend prediction success rate (trends that materialized)

## Example Prompts for Kimi K2.5

**Competitor Analysis:**
```
Analyze this competitor's Instagram performance:

Competitor: @[HANDLE]
Period: Last 7 days
Posts: [POST_DATA]
Engagement: [ENGAGEMENT_DATA]

Previous week for comparison:
Posts: [PREVIOUS_POST_DATA]
Engagement: [PREVIOUS_ENGAGEMENT_DATA]

Provide:
1. Key metrics (posts/week, avg engagement rate, top format)
2. Week-over-week changes
3. Content themes and patterns
4. Strategic insights (what they're doing well)
5. Opportunities for our client to differentiate or compete
```

**Performance Gap Analysis:**
```
Compare client vs competitor performance:

Client: @[CLIENT_HANDLE]
- Engagement rate: [RATE]
- Posting frequency: [FREQUENCY]
- Top format: [FORMAT]
- Recent posts: [POST_DATA]

Competitor Benchmark (avg of 3 competitors):
- Engagement rate: [AVG_RATE]
- Posting frequency: [AVG_FREQUENCY]
- Top format: [AVG_FORMAT]

Identify:
1. Performance gaps (where client underperforms)
2. Root causes (why the gap exists)
3. Actionable recommendations (specific tactics to close gap)
4. Prioritization (high/medium/low opportunity)
```

**Trend Detection:**
```
Analyze these 100 recent posts from [NICHE] hashtags:

Posts: [SAMPLE_POST_DATA]

Historical trends (last 30 days):
[TREND_HISTORY]

Identify:
1. Emerging hashtags (accelerating growth)
2. Hot content formats (above-average engagement)
3. Rising topics (frequently mentioned themes)
4. Opportunity assessment for our client
5. Recommended actions (specific content to create)
```

## Integration Points
- **Apify:** Public Instagram scraping (competitor data)
- **Instagram Graph API:** Authorized account insights
- **Qdrant:** Time-series data storage and trend analysis
- **Telegram Bot:** Alert delivery for anomalies
- **Dashboard:** Analytics visualization and reporting

## Cost Optimization
- Kimi K2.5 for data analysis and reporting (~$0.02 per analysis)
- GPT-4 Turbo only for:
  - Complex strategic recommendations
  - Multi-competitor comparative analysis
  - Trend forecasting with predictive modeling
- Cache Apify results for 24 hours to avoid redundant scrapes
- Batch Instagram API calls (get 25 posts in one request vs 25 individual calls)

## Privacy & Compliance
- **Public data only via Apify** - Never scrape private accounts
- **Authorized data via Graph API** - Only with valid user access tokens
- **GDPR compliance** - Don't store personal info from comments/profiles
- **Meta Terms of Service** - Respect rate limits and usage policies
- **Competitor ethics** - Don't engage in unethical competitive practices (mass liking competitor posts, etc.)

## Human Escalation Triggers
Alert client immediately if:
- Engagement drops >40% for 3+ days (potential algorithm penalty)
- Sudden follower loss >500 (possible bot purge or crisis)
- Competitor launches major campaign targeting same audience
- Negative trend detected (brand mentions with negative sentiment spike)
- Viral post opportunity (trending topic perfectly aligned with brand)
