import axios from 'axios';
import Logger from '../utils/logger';

/**
 * Economic calendar event
 */
export interface EconomicEvent {
    title: string;
    date: string;
    time: string;
    country: string;
    impact: 'high' | 'medium' | 'low';
    forecast?: string;
    previous?: string;
    actual?: string;
    category: string;
}

/**
 * RSS feed item
 */
export interface NewsItem {
    title: string;
    link: string;
    pubDate: string;
    source: string;
    categories: string[];
}

/**
 * News Feed Signal Provider
 *
 * Aggregates data from free sources:
 * - Economic calendar (ForexFactory JSON, free)
 * - RSS feeds from major news sources
 *
 * Used by:
 * - news-catalyst strategy (event scheduling)
 * - Other strategies as supplementary sentiment signal
 */
export class NewsFeed {
    private economicEvents: EconomicEvent[] = [];
    private newsItems: NewsItem[] = [];
    private lastEconomicFetch: number = 0;
    private lastNewsFetch: number = 0;
    private readonly economicCacheTtl: number = 3600000; // 1 hour
    private readonly newsCacheTtl: number = 300000; // 5 minutes

    /**
     * Fetch this week's economic calendar events
     */
    async fetchEconomicCalendar(): Promise<EconomicEvent[]> {
        if (Date.now() - this.lastEconomicFetch < this.economicCacheTtl && this.economicEvents.length > 0) {
            return this.economicEvents;
        }

        try {
            // ForexFactory JSON feed (free, no auth)
            const response = await axios.get(
                'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
                { timeout: 10000 }
            );

            if (Array.isArray(response.data)) {
                this.economicEvents = response.data.map((event: any): EconomicEvent => ({
                    title: event.title || '',
                    date: event.date || '',
                    time: event.time || '',
                    country: event.country || '',
                    impact: this.normalizeImpact(event.impact),
                    forecast: event.forecast || undefined,
                    previous: event.previous || undefined,
                    actual: event.actual || undefined,
                    category: this.categorizeEconomicEvent(event.title || ''),
                }));

                this.lastEconomicFetch = Date.now();
                Logger.info(`[NewsFeed] Loaded ${this.economicEvents.length} economic events`);
            }
        } catch (error) {
            Logger.warning(`[NewsFeed] Economic calendar fetch failed: ${error instanceof Error ? error.message : error}`);
        }

        return this.economicEvents;
    }

    /**
     * Fetch news from RSS feeds
     */
    async fetchNews(): Promise<NewsItem[]> {
        if (Date.now() - this.lastNewsFetch < this.newsCacheTtl && this.newsItems.length > 0) {
            return this.newsItems;
        }

        const feeds = [
            { url: 'https://feeds.reuters.com/reuters/topNews', source: 'Reuters' },
            { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC' },
        ];

        const allItems: NewsItem[] = [];

        for (const feed of feeds) {
            try {
                const response = await axios.get(feed.url, {
                    timeout: 10000,
                    headers: { 'User-Agent': 'PolyClaw-Pro/1.0' },
                });

                const items = this.parseRSS(response.data, feed.source);
                allItems.push(...items);
            } catch {
                // Individual feed failure is non-critical
            }
        }

        if (allItems.length > 0) {
            this.newsItems = allItems;
            this.lastNewsFetch = Date.now();
        }

        return this.newsItems;
    }

    /**
     * Get upcoming high-impact events within specified hours
     */
    async getUpcomingHighImpactEvents(withinHours: number): Promise<EconomicEvent[]> {
        const events = await this.fetchEconomicCalendar();
        const now = Date.now();
        const cutoff = now + withinHours * 3600000;

        return events.filter((event) => {
            if (event.impact !== 'high') return false;

            const eventTime = new Date(`${event.date} ${event.time}`).getTime();
            return eventTime > now && eventTime <= cutoff;
        });
    }

    /**
     * Check if there are any high-impact events in the next N hours
     */
    async hasUpcomingEvent(withinHours: number): Promise<boolean> {
        const events = await this.getUpcomingHighImpactEvents(withinHours);
        return events.length > 0;
    }

    /**
     * Get news items matching keywords
     */
    async searchNews(keywords: string[]): Promise<NewsItem[]> {
        const news = await this.fetchNews();
        return news.filter((item) => {
            const title = item.title.toLowerCase();
            return keywords.some((kw) => title.includes(kw.toLowerCase()));
        });
    }

    /**
     * Simple RSS XML parser (extracts title, link, pubDate)
     */
    private parseRSS(xmlContent: string, source: string): NewsItem[] {
        const items: NewsItem[] = [];

        // Simple regex-based XML parsing (avoid heavy XML dependency)
        const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
        let match;

        while ((match = itemRegex.exec(xmlContent)) !== null) {
            const itemContent = match[1] || '';

            const title = this.extractXMLTag(itemContent, 'title');
            const link = this.extractXMLTag(itemContent, 'link');
            const pubDate = this.extractXMLTag(itemContent, 'pubDate');

            if (title) {
                items.push({
                    title,
                    link: link || '',
                    pubDate: pubDate || '',
                    source,
                    categories: this.categorizeNewsItem(title),
                });
            }
        }

        return items.slice(0, 20); // Limit per source
    }

    /**
     * Extract content from an XML tag
     */
    private extractXMLTag(content: string, tag: string): string {
        const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 'is');
        const match = regex.exec(content);
        return match ? match[1]!.trim() : '';
    }

    /**
     * Normalize impact level
     */
    private normalizeImpact(impact: string): 'high' | 'medium' | 'low' {
        const i = (impact || '').toLowerCase();
        if (i === 'high' || i === 'holiday') return 'high';
        if (i === 'medium') return 'medium';
        return 'low';
    }

    /**
     * Categorize economic event
     */
    private categorizeEconomicEvent(title: string): string {
        const t = title.toLowerCase();
        if (t.includes('rate') || t.includes('fomc') || t.includes('fed')) return 'monetary-policy';
        if (t.includes('cpi') || t.includes('inflation') || t.includes('pce')) return 'inflation';
        if (t.includes('gdp') || t.includes('growth')) return 'growth';
        if (t.includes('employment') || t.includes('jobs') || t.includes('payroll')) return 'employment';
        if (t.includes('trade') || t.includes('export') || t.includes('import')) return 'trade';
        return 'other';
    }

    /**
     * Categorize a news item based on title
     */
    private categorizeNewsItem(title: string): string[] {
        const categories: string[] = [];
        const t = title.toLowerCase();

        if (t.includes('bitcoin') || t.includes('crypto') || t.includes('ethereum')) categories.push('crypto');
        if (t.includes('election') || t.includes('president') || t.includes('congress')) categories.push('politics');
        if (t.includes('fed') || t.includes('economy') || t.includes('inflation')) categories.push('economics');
        if (t.includes('weather') || t.includes('hurricane') || t.includes('storm')) categories.push('weather');
        if (t.includes('war') || t.includes('conflict') || t.includes('military')) categories.push('geopolitics');

        return categories;
    }
}
