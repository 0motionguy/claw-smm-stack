import { BaseStrategy, StrategySignal, StrategyConfig } from './base-strategy';
import { GammaClient, GammaMarket } from '../core/gamma-client';
import { Portfolio } from '../core/portfolio';
import Logger from '../utils/logger';

/**
 * High-Probability Bonds Strategy
 *
 * The "boring money" strategy — buy near-certain outcomes near resolution.
 * Find markets at 95-99¢ with < 48h to resolution, collect 1-5% at settlement.
 *
 * Expected edge: 1-4% in 24-48h
 * Win rate: ~95%
 * Risk: Very low — only loses if "guaranteed" outcome flips
 *
 * Filters:
 * - Only objective outcomes (crypto price, sports scores, official data)
 * - Price between 0.95 and 0.99
 * - End date within 48 hours
 * - Minimum liquidity $5,000
 */
export class HighProbBondsStrategy extends BaseStrategy {
    private readonly gamma: GammaClient;
    private readonly portfolio: Portfolio;
    private readonly minPrice: number = 0.95;
    private readonly maxPrice: number = 0.99;
    private readonly maxHoursToResolution: number = 48;
    private readonly minLiquidity: number = 5000;

    constructor(gamma: GammaClient, portfolio: Portfolio, config?: Partial<StrategyConfig>) {
        super('high-prob-bonds', {
            enabled: true,
            maxPositionUSD: 50,
            maxDailyTrades: 5,
            minConfidence: 0.90,
            scanIntervalMs: 60000, // Scan every 60 seconds
            ...config,
        });
        this.gamma = gamma;
        this.portfolio = portfolio;
    }

    getDescription(): string {
        return 'Buy 95-99¢ outcomes near resolution for guaranteed small profits';
    }

    async analyze(): Promise<StrategySignal[]> {
        if (!this.canTrade() || !this.shouldScan()) {
            return [];
        }

        this.markScanned();
        const signals: StrategySignal[] = [];

        try {
            // Get markets ending within 48 hours
            const markets = await this.gamma.getMarketsByEndDate(this.maxHoursToResolution);

            for (const market of markets) {
                const opportunities = this.evaluateMarket(market);
                signals.push(...opportunities);
            }

            if (signals.length > 0) {
                Logger.info(`[HighProbBonds] Found ${signals.length} bond opportunity(ies)`);
            }
        } catch (error) {
            Logger.error(`[HighProbBonds] Scan error: ${error instanceof Error ? error.message : error}`);
        }

        return signals;
    }

    private evaluateMarket(market: GammaMarket): StrategySignal[] {
        const signals: StrategySignal[] = [];
        const prices = this.gamma.parseOutcomePrices(market);
        const outcomes = this.gamma.parseOutcomes(market);
        const liquidity = parseFloat(market.liquidity || '0');

        // Check liquidity threshold
        if (liquidity < this.minLiquidity) return [];

        // Skip subjective markets (harder to predict resolution)
        if (this.isSubjectiveMarket(market.question)) return [];

        // Check each outcome for high-probability bond opportunity
        for (let i = 0; i < prices.length; i++) {
            const price = prices[i];
            const outcome = outcomes[i];

            if (price === undefined || outcome === undefined) continue;

            // Looking for outcomes priced 95-99¢ (near-certain to resolve YES)
            if (price >= this.minPrice && price <= this.maxPrice) {
                const tokenId = market.clobTokenIds[i];
                if (!tokenId) continue;

                // Confidence = price itself (95¢ outcome = 95% confidence)
                const confidence = price;

                // Edge = 1 - price (e.g., buy at 97¢, resolve at $1 = 3% edge)
                const edge = 1 - price;

                // Calculate position size using Kelly
                const positionSize = this.portfolio.calculatePositionSize(
                    confidence,
                    price,
                    this.config.maxPositionUSD
                );

                if (positionSize <= 0) continue;

                // Hours until resolution
                const hoursLeft = (new Date(market.endDate).getTime() - Date.now()) / 3600000;

                signals.push({
                    action: 'buy',
                    tokenId,
                    marketId: market.conditionId,
                    marketQuestion: market.question,
                    price,
                    confidence,
                    amountUSD: positionSize,
                    reason: `Bond: ${outcome} @ ${(price * 100).toFixed(1)}¢ | ` +
                        `Edge: ${(edge * 100).toFixed(1)}% | ` +
                        `Resolves in ${hoursLeft.toFixed(0)}h | ` +
                        `Liquidity: $${liquidity.toFixed(0)}`,
                    strategyName: this.name,
                });
            }
        }

        return signals;
    }

    /**
     * Filter out subjective/ambiguous markets that are harder to predict
     * Only trade objective outcomes with clear resolution criteria
     */
    private isSubjectiveMarket(question: string): boolean {
        const subjectiveKeywords = [
            'will say', 'will tweet', 'will announce',
            'will resign', 'scandal', 'opinion',
            'approval rating', 'popularity',
        ];

        const q = question.toLowerCase();
        return subjectiveKeywords.some((keyword) => q.includes(keyword));
    }
}
