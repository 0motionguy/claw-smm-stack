import axios from 'axios';
import { logger } from '../utils/logger';

interface LLMConfig {
  moonshotKey: string;
  openrouterKey: string;
}

export class LLMRouter {
  private moonshotKey: string;
  private openrouterKey: string;

  constructor(config: LLMConfig) {
    this.moonshotKey = config.moonshotKey;
    this.openrouterKey = config.openrouterKey;
  }

  // Tier 1: Kimi K2.5 (cheapest, 80% of calls)
  async classifyIntent(text: string): Promise<'praise' | 'question' | 'complaint' | 'spam' | 'lead'> {
    const prompt = `Classify this Instagram comment intent. Reply ONLY with one word: praise, question, complaint, spam, or lead.

Comment: "${text}"

Intent:`;

    try {
      const response = await axios.post(
        'https://api.moonshot.cn/v1/chat/completions',
        {
          model: 'kimi-k2.5',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 10,
          temperature: 0,
        },
        {
          headers: {
            Authorization: `Bearer ${this.moonshotKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const intent = response.data.choices[0].message.content.trim().toLowerCase();
      
      // Validate intent
      const validIntents = ['praise', 'question', 'complaint', 'spam', 'lead'];
      if (validIntents.includes(intent)) {
        return intent as any;
      }
      
      return 'question'; // Default fallback
    } catch (error) {
      logger.error({ error, text }, 'Failed to classify intent');
      return 'question';
    }
  }

  // Tier 2: Opus 4.6 (mid-tier, 15% of calls)
  async generateReply(params: {
    commentText: string;
    brandVoice: string;
    authorName: string;
    context: 'question' | 'complaint' | 'praise' | 'lead';
  }): Promise<string> {
    const { commentText, brandVoice, authorName, context } = params;

    const prompt = `You are a social media manager for a brand with this voice: ${brandVoice || 'friendly and professional'}

Reply to this ${context} from @${authorName}:
"${commentText}"

Guidelines:
- Keep it under 100 words
- Match the brand voice
- Be genuine and helpful
- Use emojis naturally (1-2 max)

Reply:`;

    try {
      // Use Opus for complex replies
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'anthropic/claude-opus-4-6',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 512,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${this.openrouterKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      logger.error({ error }, 'Failed to generate reply');
      return 'Thanks for reaching out! We\'ll get back to you soon.';
    }
  }

  // Tier 3: Claude Pro (premium, 5% of calls)
  async generateClientCommunication(params: {
    type: 'briefing' | 'report' | 'crisis';
    data: any;
    tone: 'professional' | 'casual' | 'urgent';
  }): Promise<string> {
    const { type, data, tone } = params;

    let prompt = '';
    
    if (type === 'briefing') {
      prompt = `Create a morning briefing for a business owner. Data: ${JSON.stringify(data)}
Tone: ${tone}
Format: 5-7 bullet points, concise and actionable
Include: overnight summary, today's schedule, items needing attention`;
    } else if (type === 'report') {
      prompt = `Create a weekly analytics report. Data: ${JSON.stringify(data)}
Tone: ${tone}
Format: Highlights, metrics, comparison, recommendations`;
    }

    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'anthropic/claude-3.5-sonnet',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1024,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${this.openrouterKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      logger.error({ error }, 'Failed to generate client communication');
      return 'Report generation failed. Please check the dashboard for details.';
    }
  }
}
