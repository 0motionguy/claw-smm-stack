import { Pool } from 'pg';
import { logger } from '../utils/logger';
import { LLMRouter } from '../integrations/llm';
import { DeepSeekClient } from '../integrations/deepseek';

export class CommsWorker {
  constructor(
    private llm: LLMRouter,
    private rag: DeepSeekClient,
    private db: Pool
  ) {}

  async sendDailyBriefing(tenantId: string): Promise<void> {
    logger.info('Generating daily briefing', { tenant_id: tenantId });

    // 1. Gather stats
    const stats = await this.db.query(`
      SELECT
        (SELECT COUNT(*) FROM comments WHERE tenant_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '1 day') as new_comments,
        (SELECT COUNT(*) FROM dms WHERE tenant_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '1 day') as new_dms,
        (SELECT COUNT(*) FROM comments WHERE tenant_id = $1 AND reply_status = 'pending') as pending_comments,
        (SELECT COUNT(*) FROM dms WHERE tenant_id = $1 AND reply_status = 'pending') as pending_dms,
        (SELECT COUNT(*) FROM posts WHERE tenant_id = $1 AND status = 'scheduled' AND scheduled_at >= CURRENT_DATE AND scheduled_at < CURRENT_DATE + INTERVAL '1 day') as scheduled_posts
    `, [tenantId]);

    const s = stats.rows[0];

    // 2. Get latest analytics
    const analytics = await this.db.query(
      'SELECT * FROM analytics WHERE tenant_id = $1 ORDER BY date DESC LIMIT 2',
      [tenantId]
    );

    const today = analytics.rows[0] || {};
    const yesterday = analytics.rows[1] || {};
    const followerChange = (today.followers || 0) - (yesterday.followers || 0);

    // 3. Generate briefing
    const prompt = `Generate a concise daily morning briefing for a social media client.

Stats:
- New comments overnight: ${s.new_comments}
- New DMs overnight: ${s.new_dms}
- Pending approvals: ${parseInt(s.pending_comments) + parseInt(s.pending_dms)}
- Scheduled posts today: ${s.scheduled_posts}
- Follower change: ${followerChange >= 0 ? '+' : ''}${followerChange}
- Current followers: ${today.followers || 'N/A'}

Format as a quick bullet-point briefing (5-7 lines). Use emoji for visual scanning. End with any action items needed.`;

    const briefing = await this.llm.route(tenantId, 'client_comms', prompt);

    // 4. Log
    await this.db.query(
      `INSERT INTO audit_log (tenant_id, action, worker, details, status) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, 'daily_briefing', 'comms', JSON.stringify({ briefing: briefing.substring(0, 500) }), 'success']
    );

    logger.info('Daily briefing generated', { tenant_id: tenantId });
    // TODO: Send via Telegram/WhatsApp bot
  }

  async sendWeeklyReport(tenantId: string): Promise<void> {
    logger.info('Generating weekly report', { tenant_id: tenantId });

    const analytics = await this.db.query(
      'SELECT * FROM analytics WHERE tenant_id = $1 AND date >= CURRENT_DATE - 7 ORDER BY date ASC',
      [tenantId]
    );

    const rows = analytics.rows;
    const startFollowers = rows[0]?.followers || 0;
    const endFollowers = rows[rows.length - 1]?.followers || 0;
    const totalComments = rows.reduce((sum: number, r: any) => sum + (r.comments_received || 0), 0);
    const totalDMs = rows.reduce((sum: number, r: any) => sum + (r.dms_received || 0), 0);
    const avgEngagement = rows.length > 0
      ? rows.reduce((sum: number, r: any) => sum + parseFloat(r.engagement_rate || 0), 0) / rows.length
      : 0;

    const prompt = `Generate a weekly performance report for a social media client.

7-Day Summary:
- Follower growth: ${startFollowers} → ${endFollowers} (${endFollowers - startFollowers >= 0 ? '+' : ''}${endFollowers - startFollowers})
- Total comments: ${totalComments}
- Total DMs: ${totalDMs}
- Avg engagement rate: ${avgEngagement.toFixed(2)}%
- Total leads: ${rows.reduce((sum: number, r: any) => sum + (r.leads_captured || 0), 0)}

Format as a structured weekly report with sections: Performance Overview, Top Highlights, Recommendations. Keep it under 300 words.`;

    const report = await this.llm.route(tenantId, 'report', prompt);

    await this.db.query(
      `INSERT INTO audit_log (tenant_id, action, worker, details, status) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, 'weekly_report', 'comms', JSON.stringify({ report: report.substring(0, 500) }), 'success']
    );

    logger.info('Weekly report generated', { tenant_id: tenantId });
  }

  async notifyNewLead(tenantId: string, leadData: { sender_name: string; message: string; source: string }): Promise<void> {
    logger.info('Notifying new lead', { tenant_id: tenantId, sender: leadData.sender_name });

    const prompt = `Format a lead alert notification. Keep it urgent but brief (3-4 lines).

New Lead:
- From: ${leadData.sender_name}
- Source: ${leadData.source}
- Message: "${leadData.message}"

Include: lead classification, priority level, recommended response.`;

    const notification = await this.llm.route(tenantId, 'client_comms', prompt);

    await this.db.query(
      `INSERT INTO audit_log (tenant_id, action, worker, details, status) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, 'lead_notification', 'comms', JSON.stringify({ lead: leadData.sender_name }), 'success']
    );

    logger.info('Lead notification sent', { tenant_id: tenantId });
    // TODO: Send via Telegram/WhatsApp bot
  }
}
