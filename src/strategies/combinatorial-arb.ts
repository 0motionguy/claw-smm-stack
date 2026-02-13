import { BaseStrategy, StrategySignal, StrategyConfig } from './base-strategy';
import { GammaClient, GammaMarket } from '../core/gamma-client';
import { Portfolio } from '../core/portfolio';
import Logger from '../utils/logger';

interface MarketGroup {
    topic: string;
    markets: Array<{
        market: GammaMarket;
        threshold: number;
        yesPrice: number;
        tokenId: string;
    }>;
}

interface ArbOpportunity {
    lowerThresholdMarket: GammaMarket;
    higherThresholdMarket: GammaMarket;
    lowerYesPrice: number;
    higherYesPrice: number;
    lowerTokenId: string;
    higherTokenId: string;
    edge: number;
}

export class CombinatorialArbStrategy extends BaseStrategy {
    private readonly minEdge: number = 0.03; // 3% minimum edge
    private readonly minLiquidityUSD: number = 1000;

    constructor(
        private readonly gamma: GammaClient,
        private readonly portfolio: Portfolio,
        config?: Partial<StrategyConfig>
    ) {
        const defaultConfig: StrategyConfig = {
            enabled: true,
            maxPositionUSD: 100,
            maxDailyTrades: 5,
            minConfidence: 0.90,
            scanIntervalMs: 180000 // 3 minutes
        };

        super('combinatorial-arb', { ...defaultConfig, ...config });
    }

    async analyze(): Promise<StrategySignal[]> {
        try {
            if (!this.shouldScan()) {
                return [];
            }

            Logger.info('[CombinatorialArb] Starting scan for combinatorial arbitrage opportunities...');

            // Fetch active markets
            const markets = await this.gamma.getActiveMarkets(500);
            Logger.info(`[CombinatorialArb] Fetched ${markets.length} active markets`);

            // Group related markets by topic/timeframe
            const groups = this.groupRelatedMarkets(markets);
            Logger.info(`[CombinatorialArb] Found ${groups.length} market groups`);

            // Find arbitrage opportunities in each group
            const signals: StrategySignal[] = [];
            for (const group of groups) {
                const opportunities = this.findCombinatorialArb(group);

                for (const opp of opportunities) {
                    // Validate liquidity
                    const lowerLiquidity = parseFloat(opp.lowerThresholdMarket.liquidity);
                    const higherLiquidity = parseFloat(opp.higherThresholdMarket.liquidity);

                    if (lowerLiquidity < this.minLiquidityUSD || higherLiquidity < this.minLiquidityUSD) {
                        continue;
                    }

                    // Calculate confidence based on edge size
                    const confidence = Math.min(0.95, 0.70 + (opp.edge * 5));

                    if (confidence < this.config.minConfidence) {
                        continue;
                    }

                    // Buy the lower threshold YES (it's underpriced relative to higher threshold)
                    const positionSize = this.portfolio.calculatePositionSize(
                        confidence,
                        opp.lowerYesPrice,
                        this.config.maxPositionUSD
                    );

                    const signal: StrategySignal = {
                        action: 'buy',
                        tokenId: opp.lowerTokenId,
                        marketId: opp.lowerThresholdMarket.id,
                        marketQuestion: opp.lowerThresholdMarket.question,
                        price: opp.lowerYesPrice,
                        confidence,
                        amountUSD: positionSize,
                        reason: `Combinatorial arb: Lower threshold YES (${opp.lowerYesPrice.toFixed(3)}) < Higher threshold YES (${opp.higherYesPrice.toFixed(3)}) | Edge: ${(opp.edge * 100).toFixed(2)}% | Group: ${group.topic}`,
                        strategyName: this.name
                    };

                    signals.push(signal);

                    Logger.success(
                        `[CombinatorialArb] Found opportunity in ${group.topic}: ` +
                        `Buy lower threshold @ ${opp.lowerYesPrice.toFixed(3)} vs higher @ ${opp.higherYesPrice.toFixed(3)} ` +
                        `(edge: ${(opp.edge * 100).toFixed(2)}%)`
                    );
                }
            }

            this.markScanned();

            if (signals.length > 0) {
                Logger.success(`[CombinatorialArb] Generated ${signals.length} signals`);
            } else {
                Logger.info('[CombinatorialArb] No arbitrage opportunities found');
            }

            return signals;

        } catch (error) {
            Logger.error(`[CombinatorialArb] Error during analysis: ${error}`);
            return [];
        }
    }

    private groupRelatedMarkets(markets: GammaMarket[]): MarketGroup[] {
        const groups = new Map<string, MarketGroup>();

        for (const market of markets) {
            // Only process binary markets
            const outcomes = this.gamma.parseOutcomes(market);
            if (outcomes.length !== 2) {
                continue;
            }

            // Extract crypto symbol
            const symbol = this.extractCryptoSymbol(market.question);
            if (!symbol) {
                continue;
            }

            // Extract timeframe
            const timeframe = this.extractTimeframe(market.question);

            // Extract price threshold
            const threshold = this.extractPriceThreshold(market.question);
            if (threshold === null) {
                continue;
            }

            // Create topic key
            const topic = `${symbol}-${timeframe}`;

            // Get YES price (index 0 is typically YES)
            const prices = this.gamma.parseOutcomePrices(market);
            const yesPrice = prices[0] ?? 0;
            const tokenId = market.clobTokenIds[0] ?? '';

            // Add to group
            if (!groups.has(topic)) {
                groups.set(topic, {
                    topic,
                    markets: []
                });
            }

            const group = groups.get(topic)!;
            group.markets.push({
                market,
                threshold,
                yesPrice,
                tokenId
            });
        }

        // Filter groups with 2+ markets and sort by threshold
        const result: MarketGroup[] = [];
        for (const group of groups.values()) {
            if (group.markets.length >= 2) {
                // Sort by threshold ascending (lower thresholds first)
                group.markets.sort((a, b) => a.threshold - b.threshold);
                result.push(group);
            }
        }

        return result;
    }

    private findCombinatorialArb(group: MarketGroup): ArbOpportunity[] {
        const opportunities: ArbOpportunity[] = [];

        // Check each adjacent pair for threshold violations
        for (let i = 0; i < group.markets.length - 1; i++) {
            const lower = group.markets[i]!;
            const higher = group.markets[i + 1]!;

            // Core arbitrage: P(X > lower_threshold) MUST be >= P(X > higher_threshold)
            // If lower_yes_price < higher_yes_price, that's a violation
            const edge = higher.yesPrice - lower.yesPrice;

            if (edge > this.minEdge) {
                opportunities.push({
                    lowerThresholdMarket: lower.market,
                    higherThresholdMarket: higher.market,
                    lowerYesPrice: lower.yesPrice,
                    higherYesPrice: higher.yesPrice,
                    lowerTokenId: lower.tokenId,
                    higherTokenId: higher.tokenId,
                    edge
                });
            }

            // Cross-threshold check: if lower_yes + higher_no < 0.97, there's also arb
            // (because they should sum to near 1.0 for consistent probabilities)
            const higherNoPrice = 1.0 - higher.yesPrice;
            const crossEdge = 0.97 - (lower.yesPrice + higherNoPrice);

            if (crossEdge > this.minEdge) {
                opportunities.push({
                    lowerThresholdMarket: lower.market,
                    higherThresholdMarket: higher.market,
                    lowerYesPrice: lower.yesPrice,
                    higherYesPrice: higher.yesPrice,
                    lowerTokenId: lower.tokenId,
                    higherTokenId: higher.tokenId,
                    edge: crossEdge
                });
            }
        }

        return opportunities;
    }

    private extractCryptoSymbol(question: string): string | null {
        const lowerQuestion = question.toLowerCase();

        // Map keywords to symbols
        const symbolMap: Record<string, string> = {
            'bitcoin': 'btc',
            'btc': 'btc',
            'ethereum': 'eth',
            'eth': 'eth',
            'solana': 'sol',
            'sol': 'sol',
            'cardano': 'ada',
            'ada': 'ada',
            'avalanche': 'avax',
            'avax': 'avax',
            'polygon': 'matic',
            'matic': 'matic',
            'polkadot': 'dot',
            'dot': 'dot',
            'chainlink': 'link',
            'link': 'link',
            'uniswap': 'uni',
            'uni': 'uni',
            'dogecoin': 'doge',
            'doge': 'doge',
            'shiba': 'shib',
            'shib': 'shib'
        };

        for (const [keyword, symbol] of Object.entries(symbolMap)) {
            if (lowerQuestion.includes(keyword)) {
                return symbol;
            }
        }

        return null;
    }

    private extractTimeframe(question: string): string {
        const lowerQuestion = question.toLowerCase();

        // Month names
        const months = [
            'january', 'february', 'march', 'april', 'may', 'june',
            'july', 'august', 'september', 'october', 'november', 'december'
        ];

        for (const month of months) {
            if (lowerQuestion.includes(month)) {
                return month;
            }
        }

        // Quarter references
        if (lowerQuestion.includes('q1') || lowerQuestion.includes('quarter 1')) {
            return 'q1';
        }
        if (lowerQuestion.includes('q2') || lowerQuestion.includes('quarter 2')) {
            return 'q2';
        }
        if (lowerQuestion.includes('q3') || lowerQuestion.includes('quarter 3')) {
            return 'q3';
        }
        if (lowerQuestion.includes('q4') || lowerQuestion.includes('quarter 4')) {
            return 'q4';
        }

        // Year references
        const yearMatch = lowerQuestion.match(/\b(202[4-9]|203[0-9])\b/);
        if (yearMatch) {
            return yearMatch[1]!;
        }

        // End of year
        if (lowerQuestion.includes('end of') || lowerQuestion.includes('eoy')) {
            return 'eoy';
        }

        // Generic timeframe
        return 'near-term';
    }

    private extractPriceThreshold(question: string): number | null {
        // Match formats: $100,000 or $100K or $95k or 100000
        const patterns = [
            /\$([0-9]+),([0-9]+)/g,  // $100,000
            /\$([0-9]+)k/gi,           // $100k or $100K
            /\$([0-9]+)/g,             // $100
            /\b([0-9]+),([0-9]+)\b/g   // 100,000
        ];

        for (const pattern of patterns) {
            const matches = Array.from(question.matchAll(pattern));

            for (const match of matches) {
                if (match[1] && match[2]) {
                    // Format with comma: $100,000
                    const value = parseInt(match[1] + match[2], 10);
                    if (value > 0) {
                        return value;
                    }
                } else if (match[1]) {
                    // Check if it's in K format
                    if (question[match.index! + match[0].length]?.toLowerCase() === 'k') {
                        const value = parseInt(match[1], 10) * 1000;
                        if (value > 0) {
                            return value;
                        }
                    } else {
                        const value = parseInt(match[1], 10);
                        if (value > 0) {
                            return value;
                        }
                    }
                }
            }
        }

        return null;
    }

    getDescription(): string {
        return 'Combinatorial Dutch book — multi-market threshold arbitrage';
    }
}
