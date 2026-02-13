import { BaseStrategy, StrategySignal, StrategyConfig } from './base-strategy';
import { GammaClient, GammaMarket } from '../core/gamma-client';
import { Portfolio } from '../core/portfolio';
import Logger from '../utils/logger';

/**
 * NegRisk Rebalancing Arbitrage Strategy
 *
 * Scan multi-outcome markets where sum of all outcome prices < $1.00.
 * Buy all outcomes → guaranteed profit when any one resolves to $1.
 *
 * Example: 3-outcome market with prices [0.30, 0.25, 0.40] = sum 0.95
 * Buy all 3 for $0.95, one resolves to $1.00 → profit $0.05 (5.3%)
 * Minus 2% winner fee → net ~3.3%
 *
 * Threshold: sum(prices) < 0.97 (covers 2% fee + gas)
 * Expected edge: 1-3% per trade
 * Win rate: ~99% (arbitrage)
 * Frequency: Scan every 30s
 */
export class NegRiskArbStrategy extends BaseStrategy {
    private readonly gamma: GammaClient;
    private readonly portfolio: Portfolio;
    private readonly maxPriceSum: number = 0.97; // Max sum for profitable arb (covers 2% fee + gas)
    private readonly minLiquidity: number = 2000;

    constructor(gamma: GammaClient, portfolio: Portfolio, config?: Partial<StrategyConfig>) {
        super('negrisk-arb', {
            enabled: true,
            maxPositionUSD: 100,
            maxDailyTrades: 10,
            minConfidence: 0.95,
            scanIntervalMs: 30000, // Scan every 30 seconds
            ...config,
        });
        this.gamma = gamma;
        this.portfolio = portfolio;
    }

    getDescription(): string {
        return 'NegRisk arbitrage — buy all outcomes when sum < $0.97 for guaranteed profit';
    }

    async analyze(): Promise<StrategySignal[]> {
        if (!this.canTrade() || !this.shouldScan()) {
            return [];
        }

        this.markScanned();
        const signals: StrategySignal[] = [];

        try {
            // Get active markets
            const markets = await this.gamma.getActiveMarkets(200);

            for (const market of markets) {
                const opportunity = this.findArbOpportunity(market);
                if (opportunity) {
                    signals.push(...opportunity);
                }
            }

            if (signals.length > 0) {
                Logger.info(`[NegRiskArb] Found arbitrage across ${signals.length} outcome(s)`);
            }
        } catch (error) {
            Logger.error(`[NegRiskArb] Scan error: ${error instanceof Error ? error.message : error}`);
        }

        return signals;
    }

    private findArbOpportunity(market: GammaMarket): StrategySignal[] | null {
        const prices = this.gamma.parseOutcomePrices(market);
        const outcomes = this.gamma.parseOutcomes(market);
        const liquidity = parseFloat(market.liquidity || '0');

        // Need at least 2 outcomes
        if (prices.length < 2) return null;

        // Check liquidity
        if (liquidity < this.minLiquidity) return null;

        // Calculate sum of all outcome prices
        const priceSum = prices.reduce((sum, p) => sum + p, 0);

        // Check if sum is below threshold (arbitrage exists)
        if (priceSum >= this.maxPriceSum) return null;

        // Check that we have token IDs for all outcomes
        if (market.clobTokenIds.length !== prices.length) return null;

        // Calculate edge
        const edge = 1 - priceSum; // e.g., sum=0.95 → edge=5%
        const netEdge = edge - 0.02; // Minus 2% winner fee
        const grossProfit = netEdge; // Per $1 invested in all outcomes

        if (netEdge <= 0) return null; // No profit after fees

        // Calculate how much to invest (total across all outcomes)
        const maxTotal = Math.min(this.config.maxPositionUSD, this.portfolio.getBankroll() * 0.05);

        // Confidence is very high for arb (it's mathematically guaranteed)
        const confidence = 0.99;

        const signals: StrategySignal[] = [];

        // Create buy signal for each outcome
        for (let i = 0; i < prices.length; i++) {
            const price = prices[i];
            const outcome = outcomes[i];
            const tokenId = market.clobTokenIds[i];

            if (price === undefined || outcome === undefined || !tokenId) continue;

            // Amount for this outcome = total investment × (this price / sum of prices)
            const amountUSD = maxTotal * (price / priceSum);

            signals.push({
                action: 'buy',
                tokenId,
                marketId: market.conditionId,
                marketQuestion: market.question,
                price,
                confidence,
                amountUSD: Math.round(amountUSD * 100) / 100,
                reason: `NegRisk ARB: ${outcome} @ ${(price * 100).toFixed(1)}¢ | ` +
                    `Sum: ${(priceSum * 100).toFixed(1)}¢ | ` +
                    `Edge: ${(grossProfit * 100).toFixed(1)}% | ` +
                    `Net: ${(netEdge * 100).toFixed(1)}% after fees`,
                strategyName: this.name,
            });
        }

        if (signals.length > 0) {
            Logger.success(
                `[NegRiskArb] OPPORTUNITY: ${market.question.slice(0, 50)} | ` +
                `Sum: ${(priceSum * 100).toFixed(1)}¢ | Net edge: ${(netEdge * 100).toFixed(1)}%`
            );
        }

        return signals.length > 0 ? signals : null;
    }
}
