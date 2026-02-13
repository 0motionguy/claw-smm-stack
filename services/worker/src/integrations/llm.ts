import axios from 'axios';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

interface LLMConfig {
  moonshotKey: string;
  openrouterKey: string;
}

type TaskType = 'classify' | 'short_reply' | 'caption' | 'plan' | 'report' | 'client_comms' | 'crisis';

const TOKEN_CAPS: Record<TaskType, number> = {
  classify: 256,
  short_reply: 512,
  caption: 1024,
  plan: 2048,
  report: 2048,
  client_comms: 4096,
  crisis: 4096,
};

// Task -> Model routing: Kimi (~80%), Opus (~15%), Claude Pro (~5%)
const MODEL_ROUTING: Record<TaskType, 'kimi' | 'opus' | 'pro'> = {
  classify: 'kimi',
  short_reply: 'kimi',
  caption: 'kimi',
  plan: 'opus',
  report: 'opus',
  client_comms: 'pro',
  crisis: 'pro',
};

const COST_PER_1K: Record<string, number> = {
  'kimi-k2.5': 0.0001,
  'claude-opus-4-6': 0.015,
  'claude-sonnet-4-5': 0.003,
};

export class LLMRouter {
  private moonshotKey: string;
  private openrouterKey: string;
  private db: Pool | null;

  constructor(configOrDb: LLMConfig | Pool) {
    if (configOrDb instanceof Pool) {
      this.moonshotKey = process.env.MOONSHOT_API_KEY || '';
      this.openrouterKey = process.env.OPENROUTER_API_KEY || '';
      this.db = configOrDb;
    } else {
      this.moonshotKey = configOrDb.moonshotKey;
      this.openrouterKey = configOrDb.openrouterKey;
      this.db = null;
    }
  }

  async route(tenantId: string, task: TaskType, prompt: string, context?: string): Promise<string> {
    const maxTokens = TOKEN_CAPS[task] || 512;
    const tier = MODEL_ROUTING[task] || 'kimi';

    // Budget check
    if (this.db) {
      const budgetLimit = parseFloat(process.env.LLM_DAILY_BUDGET_USD || '5.00');
      const result = await this.db.query(
        `SELECT COALESCE(SUM(cost_usd), 0) as total FROM audit_log
         WHERE tenant_id = $1 AND created_at >= CURRENT_DATE AND cost_usd > 0`,
        [tenantId]
      );
      const spent = parseFloat(result.rows[0]?.total || '0');
      if (spent >= budgetLimit) {
        logger.warn('LLM budget exceeded', { tenant_id: tenantId, spent, limit: budgetLimit });
        throw new Error(`Daily LLM budget exceeded: $${spent.toFixed(2)}/$${budgetLimit}`);
      }
    }

    const fullPrompt = context ? `${prompt}\n\nContext:\n${context}` : prompt;
    let response: string;
    let model: string;

    switch (tier) {
      case 'kimi':
        response = await this.callKimi(fullPrompt, maxTokens);
        model = 'kimi-k2.5';
        break;
      case 'opus':
        response = await this.callOpus(fullPrompt, maxTokens);
        model = 'claude-opus-4-6';
        break;
      case 'pro':
        response = await this.callPro(fullPrompt, maxTokens);
        model = 'claude-sonnet-4-5';
        break;
      default:
        response = await this.callKimi(fullPrompt, maxTokens);
        model = 'kimi-k2.5';
    }

    // Log cost to audit_log
    const estimatedTokens = Math.ceil(response.length / 4) + Math.ceil(fullPrompt.length / 4);
    const cost = (estimatedTokens / 1000) * (COST_PER_1K[model] || 0.001);

    if (this.db && tenantId) {
      await this.db.query(
        `INSERT INTO audit_log (tenant_id, action, worker, model_used, tokens_used, cost_usd, details, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, `llm_${task}`, 'llm_router', model, estimatedTokens,
         Math.round(cost * 10000) / 10000,
         JSON.stringify({ task, max_tokens: maxTokens }), 'success']
      );
    }

    return response;
  }

  // Tier 1: Kimi K2.5 (cheapest, 80% of calls)
  private async callKimi(prompt: string, maxTokens: number): Promise<string> {
    try {
      const response = await axios.post(
        'https://api.moonshot.cn/v1/chat/completions',
        {
          model: 'kimi-k2.5',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${this.moonshotKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Kimi call failed, falling back to Opus', { error: String(error) });
      return this.callOpus(prompt, maxTokens);
    }
  }

  // Tier 2: Opus 4.6 (mid-tier, 15% of calls)
  private async callOpus(prompt: string, maxTokens: number): Promise<string> {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'anthropic/claude-opus-4-6',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${this.openrouterKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Opus call failed', { error: String(error) });
      throw error;
    }
  }

  // Tier 3: Claude Pro (premium, 5% of calls)
  private async callPro(prompt: string, maxTokens: number): Promise<string> {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'anthropic/claude-sonnet-4-5-20250929',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${this.openrouterKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Pro call failed, falling back to Opus', { error: String(error) });
      return this.callOpus(prompt, maxTokens);
    }
  }

  // Legacy compatibility methods (used by repo engage.worker)
  async classifyIntent(text: string): Promise<'praise' | 'question' | 'complaint' | 'spam' | 'lead'> {
    const prompt = `Classify this Instagram comment intent. Reply ONLY with one word: praise, question, complaint, spam, or lead.\n\nComment: "${text}"\n\nIntent:`;
    const result = await this.callKimi(prompt, 10);
    const intent = result.trim().toLowerCase();
    const validIntents = ['praise', 'question', 'complaint', 'spam', 'lead'];
    return (validIntents.includes(intent) ? intent : 'question') as any;
  }

  async generateReply(params: {
    commentText: string;
    brandVoice: string;
    authorName: string;
    context: string;
  }): Promise<string> {
    const prompt = `You are a social media manager for a brand with this voice: ${params.brandVoice || 'friendly and professional'}

Reply to this ${params.context} from @${params.authorName}:
"${params.commentText}"

Guidelines:
- Keep it under 100 words
- Match the brand voice
- Be genuine and helpful
- Use emojis naturally (1-2 max)

Reply:`;
    return this.callOpus(prompt, 512);
  }

  async generateClientCommunication(params: {
    type: 'briefing' | 'report' | 'crisis';
    data: any;
    tone: 'professional' | 'casual' | 'urgent';
  }): Promise<string> {
    let prompt = '';
    if (params.type === 'briefing') {
      prompt = `Create a morning briefing for a business owner. Data: ${JSON.stringify(params.data)}\nTone: ${params.tone}\nFormat: 5-7 bullet points, concise and actionable\nInclude: overnight summary, today's schedule, items needing attention`;
    } else if (params.type === 'report') {
      prompt = `Create a weekly analytics report. Data: ${JSON.stringify(params.data)}\nTone: ${params.tone}\nFormat: Highlights, metrics, comparison, recommendations`;
    } else {
      prompt = `Draft a crisis response. Situation: ${JSON.stringify(params.data)}\nTone: ${params.tone}\nFormat: Brief, empathetic, action-oriented`;
    }
    return this.callPro(prompt, 1024);
  }
}
