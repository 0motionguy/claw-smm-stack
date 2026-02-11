# SMM Engagement Skill

## Overview
The Engagement Worker handles all audience interactions including comment classification, reply generation, DM handling, and spam management. This skill operates across Mode A (auto) for safe actions and Mode B (draft-first) for sensitive responses.

## Skill ID
`smm-engage`

## Agent Assignment
**Primary Agent:** `engage-worker`
**Model:** Kimi K2.5 (default), Claude Opus 4.6 (complex/sensitive)
**Max Tokens:** 512

## Tools Available
- `instagram_comment` - Reply to comments via Meta Graph API
- `instagram_dm` - Send/reply to DMs via Meta Graph API
- `qdrant_retrieve` - Retrieve brand voice, FAQ responses, past conversations

## Capabilities

### 1. Comment Classification
Classify incoming comments into categories:
- **Positive:** Compliments, thank yous, positive feedback → Mode A (auto-reply)
- **Question:** Product/service inquiries, FAQs → Mode A if standard, Mode B if complex
- **Negative:** Complaints, criticism → Mode B (draft for approval)
- **Spam:** Promotional, bots, irrelevant → Mode A (hide/delete)
- **Lead:** Sales inquiries, booking requests → Mode B + notify client immediately
- **Troll:** Hate speech, harassment → Mode C (escalate to human)

### 2. Reply Generation
- Brand voice-matched responses
- Contextual awareness (references original post)
- Personalized (uses commenter's name when appropriate)
- Concise (1-2 sentences for most replies)
- Actionable (provides next step or link)

### 3. DM Management
- Welcome message for new followers (Mode A)
- FAQ auto-responses (Mode A if confident match)
- Sales inquiries (Mode B, human approval required)
- Support requests (Mode B, route to appropriate team)
- Spam detection and filtering (Mode A)

### 4. Spam & Moderation
- Auto-hide obvious spam (emojis only, irrelevant links)
- Detect follow-bait comments
- Block repeat offenders (3-strike rule)
- Report abusive content to Meta

## Workflow

### Comment Processing Pipeline
```
INPUT: New comment on post

PROCESS:
1. Fetch comment text and user metadata
2. qdrant_retrieve → Pull brand voice, FAQ database, past similar comments
3. Classify comment intent and sentiment
4. Determine execution mode (A/B/C)

MODE A (Auto-reply):
5a. Generate reply using Kimi K2.5
6a. instagram_comment → Post reply immediately
7a. Log interaction in database

MODE B (Draft-first):
5b. Generate 2-3 reply options
6b. Send to client for approval via Telegram
7b. Wait for approval
8b. instagram_comment → Post approved reply
9b. Log interaction

MODE C (Escalate):
5c. Flag for human review
6c. Send full context to client
7c. Disable auto-actions on this thread

OUTPUT:
{
  "comment_id": "...",
  "classification": "positive|question|negative|spam|lead|troll",
  "mode": "A|B|C",
  "reply": "..." OR "pending_approval",
  "confidence": 0.95,
  "reasoning": "Why this classification and response"
}
```

### Classification Rules

**Positive (Mode A - Auto):**
- Contains: "love", "amazing", "great", "thank you", "beautiful", fire emoji, heart emoji
- Sentiment score > 0.7
- No questions or requests
- Example replies:
  - "Thank you so much! We're thrilled you love it!"
  - "Your support means the world to us!"
  - "Glad you enjoyed it! Come back soon!"

**Question (Mode A/B - Conditional):**
Mode A if exact FAQ match:
- "What are your hours?" → "[HOURS]. See you soon!"
- "Do you ship to [COUNTRY]?" → "[YES/NO + DETAILS]. Order here: [LINK]"
- "Is this gluten-free?" → "[YES/NO + DETAILS]. Check full menu: [LINK]"

Mode B if complex or ambiguous:
- Custom requests
- Multi-part questions
- Requires nuanced answer

**Negative (Mode B - Draft):**
- Contains: "disappointed", "bad", "never again", "rude", "terrible"
- Sentiment score < -0.3
- Draft empathetic response for approval
- Example drafts:
  - "We're so sorry to hear this. This isn't the experience we want for you. Please DM us so we can make it right."
  - "Thank you for the feedback. We take this seriously and would love to understand what happened. Can you DM us your details?"

**Spam (Mode A - Auto-hide):**
- Contains: "check my page", "DM for promo", "click link in bio", excessive emojis only
- Generic comments on old posts
- Repeated identical comments
- Action: Hide comment, log pattern, block if 3+ spam comments

**Lead (Mode B - High Priority):**
- Contains: "quote", "price", "book", "reserve", "interested in", "how much", "available?"
- Immediate Telegram notification to client
- Draft response with clear next step
- Track in CRM

**Troll (Mode C - Escalate):**
- Hate speech, slurs, threats
- Personal attacks
- Doxxing attempts
- Action: Escalate immediately, disable auto-actions, report to Meta

### DM Handling

**New Follower Welcome (Mode A):**
```
Trigger: New follower
Wait: 2 hours (avoid spammy feel)
Message: "Hey [NAME]! Thanks for following us. We're excited to have you here! [BRAND_INTRO]. What brought you to our page?"
```

**FAQ Auto-Response (Mode A):**
```
Trigger: DM contains FAQ keyword
Confidence: >0.85 match
Response: [FAQ_ANSWER] + "Did this answer your question? Feel free to ask if you need more info!"
```

**Sales Inquiry (Mode B):**
```
Trigger: "price", "buy", "order", "purchase"
Action:
1. Draft response with product info + link
2. Send to client for approval
3. Flag as high-priority lead
4. Log in CRM
```

**Support Request (Mode B):**
```
Trigger: "help", "issue", "problem", "not working"
Action:
1. Acknowledge immediately: "We're on it! Give us a few minutes to get you the right answer."
2. Draft solution or escalate to support team
3. Follow up within 1 hour
```

## Context Requirements
Pull from Qdrant before every response:
- `brand_voice.txt` - Tone and style guidelines
- `faq_database.json` - Standard Q&A pairs
- `past_conversations.json` - Similar interactions and outcomes
- `banned_words.txt` - Terms to avoid
- `vip_customers.json` - Prioritize and personalize for VIPs

## Rate Limit Awareness
- Max 180 API calls/hour for comments
- Max 190 API calls/hour for DMs (stricter Meta limits)
- Track in Redis, pause if approaching limits
- Prioritize leads and negative comments over positive acknowledgments

## Quality Checks
Before posting reply:
- [ ] Matches brand voice (check against Qdrant context)
- [ ] Grammatically correct
- [ ] Personalized (uses commenter's name if appropriate)
- [ ] Helpful (provides value or next step)
- [ ] Concise (under 280 characters for comments)
- [ ] No automated-sounding language ("As an AI...", "How can I assist?")
- [ ] Respects client's no-go topics

## Smart Behaviors

### Response Time Optimization
- Positive comments: Reply within 30 minutes (builds community)
- Questions: Reply within 1 hour (prevents drop-off)
- Negative comments: Reply within 15 minutes (damage control)
- Leads: Reply within 5 minutes (maximize conversion)
- Spam: Hide within 5 minutes (protects brand image)

### Conversation Threading
- Track multi-comment threads
- Maintain context across replies
- Know when to move conversation to DM
- Example: "Great question! This is getting detailed - mind if I DM you with more info?"

### Emoji Strategy
- Match client's emoji usage patterns
- Never overuse (max 2-3 per reply)
- Context-appropriate (no laughing emoji on serious topics)
- Brand-aligned (luxury brands = minimal emojis, fun brands = generous)

## Error Handling
- If classification confidence < 0.7 → Default to Mode B (draft-first)
- If Qdrant context missing → Use generic safe response + log for training
- If Instagram API fails → Retry once, then queue for manual handling
- If spam filter false positive → Allow client to override and retrain model

## Success Metrics
Track and report:
- Average response time by category
- Reply approval rate (Mode B)
- False positive spam detection rate (target: <5%)
- Lead conversion rate (DM to sale)
- Negative comment resolution rate
- Community sentiment trend (positive/negative ratio)

## Example Prompts for Kimi K2.5

**Comment Classification:**
```
Classify this Instagram comment:
Comment: "[COMMENT_TEXT]"
Commenter: @[USERNAME]
Post Context: [POST_CAPTION]

Brand: [CLIENT_NAME]
Industry: [INDUSTRY]

Classify as: positive, question, negative, spam, lead, or troll

Provide:
1. Classification (with confidence 0-1)
2. Sentiment score (-1 to 1)
3. Recommended mode (A/B/C)
4. Key phrases that informed decision
```

**Reply Generation:**
```
Generate a reply to this comment:
Comment: "[COMMENT_TEXT]"
Classification: [CLASSIFICATION]
Commenter: @[USERNAME]

Brand Voice: [VOICE_DESCRIPTION]
Past Similar Replies: [EXAMPLES]

Requirements:
- Match brand voice exactly
- Be helpful and personalized
- 1-2 sentences max
- Include CTA if appropriate (visit, DM, link)
- Natural, not robotic

Generate reply:
```

## Integration Points
- **Qdrant:** Context retrieval, FAQ matching, conversation history
- **Instagram Graph API:** Comment/DM posting and retrieval
- **Telegram Bot:** Draft approval workflow and lead notifications
- **Redis:** Rate limit tracking, conversation state management
- **Database:** Interaction logging, sentiment tracking, performance analytics

## Cost Optimization
- Kimi K2.5 for 90% of comments (~$0.005 per classification + reply)
- Escalate to Opus 4.6 only for:
  - Complex negative comments requiring nuanced empathy
  - High-value leads (detected product interest + VIP customer)
  - Multi-part questions requiring deep context
  - Client explicitly requests premium handling

## Human Escalation Triggers
Pass to Mode C (human-only) if:
- Troll/hate speech detected
- Legal threat or demand
- Media/press inquiry
- Crisis situation (product recall, safety issue)
- Multiple negative comments on same post (>5 in 1 hour)
- Client explicitly requests personal handling for sensitive topics
