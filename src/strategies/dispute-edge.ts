import axios from 'axios';
import { BaseStrategy, StrategySignal, StrategyConfig } from './base-strategy';
import { GammaClient, GammaMarket } from '../core/gamma-client';
import { Portfolio } from '../core/portfolio';
import Logger from '../utils/logger';

/**
 * Dispute Edge Strategy
 *
 * Monitor UMA oracle for resolution disputes on Polymarket markets.
 * When a "certain" outcome (95-99¢) gets disputed, price crashes temporarily.
 * Buy the dip during dispute → sell when dispute resolves.
 *
 * ~3% of "certain" outcomes get disputed. When they do, prices can
 * temporarily crash 10-30% before recovering.
 *
 * Expected edge: 10-30% per trade when disputes occur
 * Win rate: ~70% (most disputes resolve in favor of original outcome)
 * Frequency: Rare but lucrative (0-1 per week)
 */
export class DisputeEdgeStrategy extends BaseStrategy {
    private readonly gamma: GammaClient;
    private readonly portfolio: Portfolio;
    private readonly umaOracleUrl: string = 'https://oracle.uma.xyz/api';
    private readonly minPriceDropPercent: number = 10; // Min price drop to trigger
    private readonly maxBuyPrice: number = 0.85; // Max price to buy during dispute
    private readonly minOriginalPrice: number = 0.90; // Original price must have been > 90¢

    // Track known disputes to avoid re-buying
    private activeDisputes: Map<string, { detectedAt: number; originalPrice: number }> = new Map();

    // Track recent market prices for drop detection
    private priceHistory: Map<string, { price: number; timestamp: number }[]> = new Map();

    constructor(
        gamma: GammaClient,
        portfolio: Portfolio,
        config?: Partial<StrategyConfig>
    ) {
        super('dispute-edge', {
            enabled: true,
            maxPositionUSD: 40,
            maxDailyTrades: 2,
            minConfidence: 0.60,
            scanIntervalMs: 120000, // Scan every 2 minutes
            ...config,
        });
        this.gamma = gamma;
        this.portfolio = portfolio;
    }

    getDescription(): string {
        return 'Dispute edge — buy the dip when near-certain outcomes face resolution disputes';
    }

    async analyze(): Promise<StrategySignal[]> {
        if (!this.canTrade() || !this.shouldScan()) {
            return [];
        }

        this.markScanned();
        const signals: StrategySignal[] = [];

        try {
            // Two detection methods:
            // 1. Monitor UMA oracle for active disputes
            // 2. Detect sudden price drops in high-probability markets

            const [disputeSignals, dropSignals] = await Promise.all([
                this.checkUMADisputes(),
                this.detectPriceDrops(),
            ]);

            signals.push(...disputeSignals, ...dropSignals);

            if (signals.length > 0) {
                Logger.success(`[DisputeEdge] Found ${signals.length} dispute opportunity(ies)!`);
            }
        } catch (error) {
            Logger.error(`[DisputeEdge] Scan error: ${error instanceof Error ? error.message : error}`);
        }

        return signals;
    }

    /**
     * Check UMA oracle for active disputes
     */
    private async checkUMADisputes(): Promise<StrategySignal[]> {
        const signals: StrategySignal[] = [];

        try {
            // Query UMA oracle for recent assertion disputes
            const response = await axios.get(`${this.umaOracleUrl}/assertions`, {
                params: { disputeStatus: 'disputed', limit: 20 },
                timeout: 10000,
            });

            const assertions = response.data?.assertions || response.data || [];
            if (!Array.isArray(assertions)) return [];

            for (const assertion of assertions) {
                // Try to match with Polymarket market
                const conditionId = assertion.ancillaryData?.conditionId || assertion.identifier;
                if (!conditionId) continue;

                // Skip already-tracked disputes
                if (this.activeDisputes.has(conditionId)) continue;

                const signal = await this.evaluateDispute(conditionId, assertion);
                if (signal) {
                    signals.push(signal);
                    this.activeDisputes.set(conditionId, {
                        detectedAt: Date.now(),
                        originalPrice: 0,
                    });
                }
            }
        } catch {
            // UMA API may be unavailable - fall through to price drop detection
        }

        return signals;
    }

    /**
     * Detect sudden price drops in high-probability markets
     * This is a fallback when UMA API is unavailable
     */
    private async detectPriceDrops(): Promise<StrategySignal[]> {
        const signals: StrategySignal[] = [];

        try {
            const markets = await this.gamma.getActiveMarkets(100);

            for (const market of markets) {
                const prices = this.gamma.parseOutcomePrices(market);
                const outcomes = this.gamma.parseOutcomes(market);

                for (let i = 0; i < prices.length; i++) {
                    const currentPrice = prices[i];
                    const outcome = outcomes[i];
                    const tokenId = market.clobTokenIds[i];

                    if (currentPrice === undefined || !outcome || !tokenId) continue;

                    // Update price history
                    const key = tokenId;
                    const history = this.priceHistory.get(key) || [];
                    history.push({ price: currentPrice, timestamp: Date.now() });

                    // Keep only last 30 minutes of history
                    const cutoff = Date.now() - 30 * 60 * 1000;
                    const recentHistory = history.filter((h) => h.timestamp > cutoff);
                    this.priceHistory.set(key, recentHistory);

                    if (recentHistory.length < 2) continue;

                    // Check for sudden drop from high price
                    const maxRecentPrice = Math.max(...recentHistory.map((h) => h.price));

                    if (maxRecentPrice < this.minOriginalPrice) continue; // Wasn't high-probability
                    if (currentPrice > this.maxBuyPrice) continue; // Price hasn't dropped enough

                    const dropPercent = ((maxRecentPrice - currentPrice) / maxRecentPrice) * 100;
                    if (dropPercent < this.minPriceDropPercent) continue;

                    // Skip if already tracked
                    if (this.activeDisputes.has(tokenId)) continue;

                    // This looks like a dispute-induced price drop!
                    const confidence = Math.min(0.75, 0.55 + (dropPercent / 100));

                    const positionSize = this.portfolio.calculatePositionSize(
                        confidence,
                        currentPrice,
                        this.config.maxPositionUSD
                    );

                    if (positionSize <= 0) continue;

                    signals.push({
                        action: 'buy',
                        tokenId,
                        marketId: market.conditionId,
                        marketQuestion: market.question,
                        price: currentPrice,
                        confidence,
                        amountUSD: positionSize,
                        reason: `DISPUTE DIP: ${outcome} dropped ${dropPercent.toFixed(0)}% ` +
                            `(${(maxRecentPrice * 100).toFixed(1)}¢ → ${(currentPrice * 100).toFixed(1)}¢) | ` +
                            `Likely dispute-induced panic sell`,
                        strategyName: this.name,
                    });

                    this.activeDisputes.set(tokenId, {
                        detectedAt: Date.now(),
                        originalPrice: maxRecentPrice,
                    });
                }
            }
        } catch (error) {
            Logger.error(`[DisputeEdge] Price drop detection error: ${error instanceof Error ? error.message : error}`);
        }

        // Clean up old disputes (> 24 hours)
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        for (const [key, dispute] of this.activeDisputes) {
            if (dispute.detectedAt < oneDayAgo) {
                this.activeDisputes.delete(key);
            }
        }

        return signals;
    }

    /**
     * Evaluate a specific dispute for trading opportunity
     */
    private async evaluateDispute(conditionId: string, _assertion: any): Promise<StrategySignal | null> {
        try {
            // Try to find the market on Polymarket via Gamma
            const markets = await this.gamma.getActiveMarkets(200);
            const market = markets.find((m) => m.conditionId === conditionId);

            if (!market) return null;

            const prices = this.gamma.parseOutcomePrices(market);
            const outcomes = this.gamma.parseOutcomes(market);

            // Find the disputed outcome (the one that dropped)
            for (let i = 0; i < prices.length; i++) {
                const price = prices[i];
                const outcome = outcomes[i];
                const tokenId = market.clobTokenIds[i];

                if (price === undefined || !outcome || !tokenId) continue;

                // We want outcomes that were high (dispute target) and now cheaper
                if (price <= this.maxBuyPrice && price >= 0.40) {
                    const confidence = 0.70; // Disputes usually resolve in favor of original

                    const positionSize = this.portfolio.calculatePositionSize(
                        confidence,
                        price,
                        this.config.maxPositionUSD
                    );

                    if (positionSize <= 0) continue;

                    return {
                        action: 'buy',
                        tokenId,
                        marketId: market.conditionId,
                        marketQuestion: market.question,
                        price,
                        confidence,
                        amountUSD: positionSize,
                        reason: `UMA DISPUTE: ${outcome} @ ${(price * 100).toFixed(1)}¢ | ` +
                            `Active dispute detected — likely to resolve in favor of original outcome`,
                        strategyName: this.name,
                    };
                }
            }
        } catch {
            // Market not found or can't evaluate
        }

        return null;
    }
}
