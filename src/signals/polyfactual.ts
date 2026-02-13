import axios from 'axios';
import Logger from '../utils/logger';

/**
 * Polyfactual market analysis
 */
export interface PolyfactualAnalysis {
    marketId: string;
    question: string;
    fairValue: number; // Estimated fair probability (0-1)
    confidence: number; // How confident the estimate is (0-1)
    reasoning: string;
    lastUpdated: number;
}

/**
 * Polyfactual.com API client
 *
 * Free tier: AI-powered market research and fair value estimation.
 * Used as supplementary signal for strategies:
 * - High-prob bonds (validate near-certain outcomes)
 * - Liquidity snipe (estimate fair value for new markets)
 * - News catalyst (event impact analysis)
 */
export class PolyfactualClient {
    private readonly baseUrl: string = 'https://api.polyfactual.com';
    private readonly cache: Map<string, PolyfactualAnalysis> = new Map();
    private readonly cacheTtlMs: number = 300000; // 5 minutes
    private lastRequestTime: number = 0;
    private readonly minRequestInterval: number = 2000; // 2 seconds between requests

    /**
     * Get AI analysis for a specific market
     */
    async getMarketAnalysis(marketId: string, question: string): Promise<PolyfactualAnalysis | null> {
        // Check cache
        const cached = this.cache.get(marketId);
        if (cached && Date.now() - cached.lastUpdated < this.cacheTtlMs) {
            return cached;
        }

        // Rate limit
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
            await new Promise((resolve) =>
                setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
            );
        }

        try {
            this.lastRequestTime = Date.now();

            const response = await axios.get(`${this.baseUrl}/v1/markets/${marketId}/analysis`, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'PolyClaw-Pro/1.0',
                },
            });

            const data = response.data;
            if (!data) return null;

            const analysis: PolyfactualAnalysis = {
                marketId,
                question,
                fairValue: data.fair_value ?? data.probability ?? 0.5,
                confidence: data.confidence ?? 0.5,
                reasoning: data.reasoning ?? data.summary ?? '',
                lastUpdated: Date.now(),
            };

            this.cache.set(marketId, analysis);
            return analysis;
        } catch (error) {
            // Polyfactual API may be rate limited or unavailable
            Logger.warning(`[Polyfactual] API error for ${marketId}: ${error instanceof Error ? error.message : error}`);
            return null;
        }
    }

    /**
     * Get bulk market analyses
     */
    async getBulkAnalysis(marketIds: string[]): Promise<Map<string, PolyfactualAnalysis>> {
        const results = new Map<string, PolyfactualAnalysis>();

        for (const marketId of marketIds) {
            const analysis = await this.getMarketAnalysis(marketId, '');
            if (analysis) {
                results.set(marketId, analysis);
            }
        }

        return results;
    }

    /**
     * Check if the estimated fair value differs significantly from market price
     * Returns the deviation (positive = underpriced on market)
     */
    getDeviation(analysis: PolyfactualAnalysis, marketPrice: number): number {
        return analysis.fairValue - marketPrice;
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
    }
}
