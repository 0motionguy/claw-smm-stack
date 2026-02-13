import { ClobClient } from '@polymarket/clob-client';
import { BaseStrategy, StrategySignal, StrategyConfig } from './base-strategy';
import { GammaClient, GammaMarket } from '../core/gamma-client';
import { analyzeOrderBook, OrderBookAnalysis } from '../core/orderbook';
import { Portfolio } from '../core/portfolio';
import Logger from '../utils/logger';

/**
 * Inventory position tracking for market making
 */
interface InventoryPosition {
    tokenId: string;
    marketId: string;
    longShares: number;
    shortShares: number;
    netExposure: number; // positive = long, negative = short
    avgEntryPrice: number;
    lastUpdated: number;
}

/**
 * Polymarket liquidity rewards estimate
 */
interface RewardsEstimate {
    dailyRewardsUSD: number;
    rewardMultiplier: number;
    qualifiesForBonus: boolean;
    reason: string;
}

/**
 * Spread Capture / Market Making Strategy
 *
 * Place both buy and sell limit orders around fair value to earn the bid-ask spread.
 * This is the "few bucks a day with high winrate" strategy.
 *
 * How it works:
 * 1. Find markets with wide spreads (> 3%) and high liquidity (> $100K volume)
 * 2. Estimate fair value from mid-price
 * 3. Place buy order below fair value, sell order above
 * 4. When both fill → earn the spread
 * 5. Track inventory to avoid excessive one-sided exposure
 * 6. Earn 3x liquidity rewards from Polymarket
 *
 * Expected edge: 0.5-1.5% per round trip + liquidity rewards
 * Win rate: ~70%
 * Frequency: 5-15 trades/day
 * Risk: Getting stuck on one side if market moves sharply
 */
export class SpreadCaptureStrategy extends BaseStrategy {
    private readonly gamma: GammaClient;
    private readonly clobClient: ClobClient;
    private readonly portfolio: Portfolio;
    private readonly minSpreadPercent: number = 3.0; // Minimum spread to trade
    private readonly minVolumeUSD: number = 100000; // Min market volume
    private readonly spreadFraction: number = 0.4; // Place orders at 40% of spread from mid

    // Inventory management
    private inventory: Map<string, InventoryPosition> = new Map();
    private readonly rewardMultiplier: number = 3.0; // Polymarket's 3x liquidity rewards
    private readonly maxNetExposure: number = 0.3; // max 30% net exposure per market
    private readonly inventorySkewFactor: number = 0.02; // price skew per 10% inventory imbalance
    private twoSidedQuotes: number = 0; // counter for two-sided quotes placed

    constructor(
        gamma: GammaClient,
        clobClient: ClobClient,
        portfolio: Portfolio,
        config?: Partial<StrategyConfig>
    ) {
        super('spread-capture', {
            enabled: true,
            maxPositionUSD: 30,
            maxDailyTrades: 15,
            minConfidence: 0.60,
            scanIntervalMs: 45000, // Scan every 45 seconds
            ...config,
        });
        this.gamma = gamma;
        this.clobClient = clobClient;
        this.portfolio = portfolio;
    }

    getDescription(): string {
        return 'Market-making spread capture — earn bid-ask spread + 3x liquidity rewards on liquid markets';
    }

    async analyze(): Promise<StrategySignal[]> {
        if (!this.canTrade() || !this.shouldScan()) {
            return [];
        }

        this.markScanned();
        const signals: StrategySignal[] = [];

        try {
            // Get high-volume markets
            const markets = await this.gamma.getActiveMarkets(100);
            const liquidMarkets = markets.filter(
                (m) => parseFloat(m.volume || '0') >= this.minVolumeUSD
            );

            // Analyze order books for spread opportunities
            for (const market of liquidMarkets.slice(0, 20)) {
                const opportunities = await this.evaluateSpread(market);
                if (opportunities.length > 0) {
                    signals.push(...opportunities);
                }
            }

            if (signals.length > 0) {
                Logger.info(`[SpreadCapture] Found ${signals.length} spread opportunity(ies)`);
                const rewardsEst = this.getRewardsEstimate();
                Logger.info(`[SpreadCapture] Rewards estimate: $${rewardsEst.dailyRewardsUSD.toFixed(2)}/day (${rewardsEst.reason})`);
            }
        } catch (error) {
            Logger.error(`[SpreadCapture] Scan error: ${error instanceof Error ? error.message : error}`);
        }

        return signals;
    }

    private async evaluateSpread(market: GammaMarket): Promise<StrategySignal[]> {
        // Pick the first outcome token to analyze
        const tokenId = market.clobTokenIds[0];
        if (!tokenId) return [];

        let analysis: OrderBookAnalysis;
        try {
            analysis = await analyzeOrderBook(tokenId, this.clobClient);
        } catch {
            return [];
        }

        // Check spread is wide enough to be profitable
        if (analysis.spreadPercent < this.minSpreadPercent) return [];

        // Need both sides of the book
        if (analysis.bestBid <= 0 || analysis.bestAsk <= 0) return [];

        // Skip extreme prices (too close to 0 or 1)
        if (analysis.midPrice < 0.10 || analysis.midPrice > 0.90) return [];

        // Check order book is balanced (avoid one-sided markets)
        if (Math.abs(analysis.imbalance) > 0.7) return [];

        // Get inventory skew for this token
        const inventorySkew = this.getInventorySkew(tokenId);

        // Check if we're over max net exposure
        const position = this.inventory.get(tokenId);
        if (position) {
            const totalShares = position.longShares + position.shortShares;
            if (totalShares > 0) {
                const exposureRatio = Math.abs(position.netExposure) / totalShares;
                if (exposureRatio > this.maxNetExposure) {
                    Logger.warning(`[SpreadCapture] Skipping ${tokenId}: net exposure ${(exposureRatio * 100).toFixed(1)}% exceeds max`);
                    return [];
                }
            }
        }

        // Calculate our buy and sell prices
        const halfSpread = analysis.spread / 2;
        const offset = halfSpread * this.spreadFraction;

        // Apply inventory skew: if we're long, lower buy price and raise sell price to reduce exposure
        // Skew ranges from -1 (short) to +1 (long)
        // Positive skew → we want to sell more → raise sell price, lower buy price
        const skewAdjustment = inventorySkew * this.inventorySkewFactor;

        const buyPrice = Math.max(0.01, Math.min(0.99, analysis.midPrice - offset - skewAdjustment));
        const sellPrice = Math.max(0.01, Math.min(0.99, analysis.midPrice + offset + skewAdjustment));

        // Expected profit per round trip
        const roundTripProfit = sellPrice - buyPrice;
        const roundTripProfitPercent = (roundTripProfit / buyPrice) * 100;

        // Minus fees (2% on winning side)
        const netProfitPercent = roundTripProfitPercent - 2.0;
        if (netProfitPercent <= 0) return [];

        // Confidence based on spread stability and depth
        const confidence = Math.min(0.80, 0.50 + (analysis.bidDepth + analysis.askDepth) / 50000);

        const positionSize = this.portfolio.calculatePositionSize(
            confidence,
            buyPrice,
            this.config.maxPositionUSD
        );

        if (positionSize <= 0) return [];

        const outcomes = this.gamma.parseOutcomes(market);
        const outcomeName = outcomes[0] || 'Yes';

        // Increment two-sided quote counter
        this.twoSidedQuotes++;

        // Build reason string
        const baseReason = `Spread: ${outcomeName} | Spread: ${analysis.spreadPercent.toFixed(1)}% | ` +
            `Net profit: ${netProfitPercent.toFixed(1)}% | ` +
            `Depth: $${(analysis.bidDepth + analysis.askDepth).toFixed(0)}`;

        const skewInfo = inventorySkew !== 0
            ? ` | Inventory skew: ${(inventorySkew * 100).toFixed(1)}%`
            : '';

        // Return both BUY and SELL signals
        const signals: StrategySignal[] = [
            {
                action: 'buy',
                tokenId,
                marketId: market.conditionId,
                marketQuestion: market.question,
                price: buyPrice,
                confidence,
                amountUSD: positionSize,
                reason: `[BUY] ${baseReason} | Buy @ ${(buyPrice * 100).toFixed(1)}¢${skewInfo}`,
                strategyName: this.name,
            },
            {
                action: 'sell',
                tokenId,
                marketId: market.conditionId,
                marketQuestion: market.question,
                price: sellPrice,
                confidence,
                amountUSD: positionSize,
                reason: `[SELL] ${baseReason} | Sell @ ${(sellPrice * 100).toFixed(1)}¢${skewInfo}`,
                strategyName: this.name,
            },
        ];

        return signals;
    }

    /**
     * Update inventory after a trade execution
     */
    updateInventory(
        tokenId: string,
        marketId: string,
        side: 'buy' | 'sell',
        shares: number,
        price: number
    ): void {
        let position = this.inventory.get(tokenId);

        if (!position) {
            position = {
                tokenId,
                marketId,
                longShares: 0,
                shortShares: 0,
                netExposure: 0,
                avgEntryPrice: price,
                lastUpdated: Date.now(),
            };
            this.inventory.set(tokenId, position);
        }

        // Update shares based on side
        if (side === 'buy') {
            // Buying increases long position
            const prevLongValue = position.longShares * position.avgEntryPrice;
            const newLongValue = shares * price;
            position.longShares += shares;

            // Update weighted average entry price
            if (position.longShares > 0) {
                position.avgEntryPrice = (prevLongValue + newLongValue) / position.longShares;
            }
        } else {
            // Selling increases short position
            const prevShortValue = position.shortShares * position.avgEntryPrice;
            const newShortValue = shares * price;
            position.shortShares += shares;

            // Update weighted average entry price
            if (position.shortShares > 0) {
                position.avgEntryPrice = (prevShortValue + newShortValue) / position.shortShares;
            }
        }

        // Recalculate net exposure
        position.netExposure = position.longShares - position.shortShares;
        position.lastUpdated = Date.now();

        Logger.info(`[SpreadCapture] Updated inventory for ${tokenId}: ` +
            `long=${position.longShares}, short=${position.shortShares}, net=${position.netExposure}`);
    }

    /**
     * Get inventory skew for a token (-1 to +1)
     * Negative = short biased, Positive = long biased
     */
    getInventorySkew(tokenId: string): number {
        const position = this.inventory.get(tokenId);
        if (!position) return 0;

        const totalShares = position.longShares + position.shortShares;
        if (totalShares === 0) return 0;

        // Net exposure normalized by total shares
        const skew = position.netExposure / totalShares;

        // Clamp to [-1, 1]
        return Math.max(-1, Math.min(1, skew));
    }

    /**
     * Estimate daily liquidity rewards from Polymarket
     */
    getRewardsEstimate(): RewardsEstimate {
        // Base reward per two-sided quote: $0.50-$2.00 depending on market
        // We use conservative $1.00 estimate
        const baseRewardPerQuote = 1.0;

        // Apply 3x multiplier
        const dailyRewardsUSD = this.twoSidedQuotes * baseRewardPerQuote * this.rewardMultiplier;

        // Bonus qualification: at least 10 two-sided quotes per day
        const qualifiesForBonus = this.twoSidedQuotes >= 10;

        const reason = qualifiesForBonus
            ? `${this.twoSidedQuotes} two-sided quotes with 3x multiplier + bonus`
            : `${this.twoSidedQuotes} two-sided quotes with 3x multiplier`;

        return {
            dailyRewardsUSD,
            rewardMultiplier: this.rewardMultiplier,
            qualifiesForBonus,
            reason,
        };
    }
}
