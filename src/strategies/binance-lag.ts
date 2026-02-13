import { BaseStrategy, StrategySignal, StrategyConfig } from './base-strategy';
import { GammaClient, GammaMarket } from '../core/gamma-client';
import { Portfolio } from '../core/portfolio';
import { BinanceFeed, ThresholdConfig, BinancePrice } from '../signals/binance-feed';
import Logger from '../utils/logger';

export interface BinanceLagConfig extends StrategyConfig {
    confirmationWindowMs: number;
    minEdgePercent: number;
    symbols: string[];
}

export interface ParsedThreshold {
    symbol: string;
    threshold: number;
    direction: 'above' | 'below';
}

interface ActiveLagMarket {
    market: GammaMarket;
    threshold: ParsedThreshold;
    tokenId: string;
}

export class BinanceLagStrategy extends BaseStrategy {
    private readonly gamma: GammaClient;
    private readonly portfolio: Portfolio;
    private readonly binanceFeed: BinanceFeed;
    private readonly lagConfig: BinanceLagConfig;
    private readonly activeLagMarkets: Map<string, ActiveLagMarket>;
    private lastMarketRefresh: number;
    private readonly marketRefreshIntervalMs: number;

    constructor(
        gamma: GammaClient,
        portfolio: Portfolio,
        binanceFeed: BinanceFeed,
        config?: Partial<BinanceLagConfig>
    ) {
        const defaultConfig: StrategyConfig = {
            enabled: true,
            maxPositionUSD: 200,
            maxDailyTrades: 20,
            minConfidence: 0.90,
            scanIntervalMs: 2000
        };

        super('binance-lag', { ...defaultConfig, ...config });

        this.gamma = gamma;
        this.portfolio = portfolio;
        this.binanceFeed = binanceFeed;

        this.lagConfig = {
            ...this.config,
            confirmationWindowMs: config?.confirmationWindowMs ?? 5000,
            minEdgePercent: config?.minEdgePercent ?? 5,
            symbols: config?.symbols ?? ['btcusdt', 'ethusdt', 'solusdt']
        };

        this.activeLagMarkets = new Map();
        this.lastMarketRefresh = 0;
        this.marketRefreshIntervalMs = 60000;

        Logger.info(
            `[BinanceLag] Initialized — maxPosition: $${this.lagConfig.maxPositionUSD} | ` +
            `minEdge: ${this.lagConfig.minEdgePercent}% | symbols: ${this.lagConfig.symbols.join(', ')}`
        );
    }

    async analyze(): Promise<StrategySignal[]> {
        if (!this.canTrade() || !this.shouldScan()) {
            return [];
        }

        this.markScanned();
        const signals: StrategySignal[] = [];

        try {
            // Refresh market list if stale
            const now = Date.now();
            if (now - this.lastMarketRefresh > this.marketRefreshIntervalMs) {
                await this.refreshCryptoMarkets();
            }

            // Get all current prices from Binance
            const allPrices = this.binanceFeed.getAllPrices();

            // Check each active lag market for opportunities
            for (const [marketId, lagMarket] of this.activeLagMarkets) {
                const signal = await this.evaluateLagMarket(lagMarket, allPrices);
                if (signal) {
                    signals.push(signal);
                    Logger.info(`[BinanceLag] Signal: ${lagMarket.market.question} | edge: ${signal.confidence.toFixed(2)}`);
                }
            }

            if (signals.length > 0) {
                Logger.success(`[BinanceLag] ${signals.length} lag signal(s) from ${this.activeLagMarkets.size} active markets`);
            }
        } catch (error) {
            Logger.error(`[BinanceLag] Analysis error: ${error instanceof Error ? error.message : error}`);
        }

        return signals;
    }

    private async evaluateLagMarket(
        lagMarket: ActiveLagMarket,
        binancePrices: Map<string, BinancePrice>
    ): Promise<StrategySignal | null> {
        const { market, threshold, tokenId } = lagMarket;

        // Get current Binance price
        const priceData = binancePrices.get(threshold.symbol);
        if (!priceData) return null;

        const currentPrice = priceData.price;

        // Check if threshold is confirmed
        const isConfirmed = threshold.direction === 'above'
            ? currentPrice > threshold.threshold
            : currentPrice < threshold.threshold;

        if (!isConfirmed) return null;

        // Parse Polymarket prices
        const prices = this.gamma.parseOutcomePrices(market);
        const outcomes = this.gamma.parseOutcomes(market);

        if (prices.length !== 2 || outcomes.length !== 2) return null;

        // Determine YES token index
        const yesIndex = outcomes.findIndex(outcome =>
            outcome.toLowerCase().includes('yes') ||
            outcome.toLowerCase().includes('above') ||
            outcome.toLowerCase().includes('over')
        );

        if (yesIndex === -1) return null;

        const yesPrice = prices[yesIndex] ?? 0;

        // Safeguard: Skip if market endDate < 5 minutes from now
        const endDate = new Date(market.endDate).getTime();
        const timeToEnd = endDate - Date.now();
        if (timeToEnd < 5 * 60 * 1000) return null;

        // Safeguard: Skip if Binance price within 0.1% of threshold
        const distancePercent = Math.abs((currentPrice - threshold.threshold) / threshold.threshold) * 100;
        if (distancePercent < 0.1) return null;

        // Safeguard: Skip if YES already > 0.95 (market already updated)
        if (yesPrice > 0.95) return null;

        // Safeguard: Skip if liquidity < $500
        const liquidity = parseFloat(market.liquidity);
        if (liquidity < 500) return null;

        // Calculate edge
        const fairValue = 0.99;
        const edge = this.calculateEdge(fairValue, yesPrice);

        // Check if edge meets minimum requirement
        if (edge < this.lagConfig.minEdgePercent) return null;

        // Calculate position size
        const confidence = Math.min(0.98, 0.85 + (edge / 100));
        const positionUSD = this.portfolio.calculatePositionSize(
            confidence,
            yesPrice,
            this.lagConfig.maxPositionUSD
        );

        return {
            action: 'buy',
            tokenId,
            marketId: market.id,
            marketQuestion: market.question,
            price: yesPrice,
            confidence,
            amountUSD: positionUSD,
            reason: `Binance ${threshold.symbol.toUpperCase()} @ $${currentPrice.toLocaleString()} ${threshold.direction} $${threshold.threshold.toLocaleString()} confirmed. ` +
                `Polymarket YES @ ${(yesPrice * 100).toFixed(1)}¢ is stale. Edge: ${edge.toFixed(1)}%`,
            strategyName: this.name
        };
    }

    private calculateEdge(fairValue: number, marketPrice: number): number {
        const edge = fairValue - marketPrice;
        return (edge / marketPrice) * 100;
    }

    private async refreshCryptoMarkets(): Promise<void> {
        try {
            Logger.info('[BinanceLag] Refreshing crypto markets...');

            const markets = await this.gamma.getActiveMarkets(500);

            const cryptoKeywords = [
                'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol',
                'dogecoin', 'doge', 'polygon', 'matic', 'cardano', 'ada',
                'ripple', 'xrp'
            ];

            const cryptoMarkets = markets.filter(market => {
                const question = market.question.toLowerCase();
                return cryptoKeywords.some(keyword => question.includes(keyword));
            });

            Logger.info(`[BinanceLag] Found ${cryptoMarkets.length} crypto markets out of ${markets.length} total`);

            const newActiveLagMarkets = new Map<string, ActiveLagMarket>();
            const newThresholds: ThresholdConfig[] = [];

            for (const market of cryptoMarkets) {
                if (market.closed || !market.active) continue;

                const threshold = this.parseThreshold(market.question);
                if (!threshold) continue;

                if (!this.lagConfig.symbols.includes(threshold.symbol)) continue;

                const outcomes = this.gamma.parseOutcomes(market);
                const yesIndex = outcomes.findIndex(outcome =>
                    outcome.toLowerCase().includes('yes') ||
                    outcome.toLowerCase().includes('above') ||
                    outcome.toLowerCase().includes('over')
                );

                if (yesIndex === -1 || !market.clobTokenIds[yesIndex]) continue;

                const tokenId = market.clobTokenIds[yesIndex]!;

                newActiveLagMarkets.set(market.id, {
                    market,
                    threshold,
                    tokenId
                });

                newThresholds.push({
                    symbol: threshold.symbol,
                    threshold: threshold.threshold,
                    direction: threshold.direction
                });
            }

            this.activeLagMarkets.clear();
            for (const [id, market] of newActiveLagMarkets) {
                this.activeLagMarkets.set(id, market);
            }

            if (newThresholds.length > 0) {
                this.binanceFeed.setThresholds(newThresholds);
            }

            this.lastMarketRefresh = Date.now();

            Logger.info(`[BinanceLag] Refresh complete — ${this.activeLagMarkets.size} active markets, ${newThresholds.length} thresholds`);
        } catch (error) {
            Logger.error(`[BinanceLag] Market refresh error: ${error instanceof Error ? error.message : error}`);
        }
    }

    private parseThreshold(question: string): ParsedThreshold | null {
        const lowerQuestion = question.toLowerCase();

        // Symbol mapping
        const symbolMap: Record<string, string> = {
            'bitcoin': 'btcusdt', 'btc': 'btcusdt',
            'ethereum': 'ethusdt', 'eth': 'ethusdt',
            'solana': 'solusdt', 'sol': 'solusdt',
            'dogecoin': 'dogeusdt', 'doge': 'dogeusdt',
            'polygon': 'maticusdt', 'matic': 'maticusdt',
            'cardano': 'adausdt', 'ada': 'adausdt',
            'ripple': 'xrpusdt', 'xrp': 'xrpusdt'
        };

        let symbol: string | null = null;
        for (const [key, value] of Object.entries(symbolMap)) {
            if (lowerQuestion.includes(key)) {
                symbol = value;
                break;
            }
        }
        if (!symbol) return null;

        // Determine direction
        const aboveKeywords = ['above', 'exceed', 'over', 'higher', 'reach', 'hit', 'surpass', 'cross'];
        const belowKeywords = ['below', 'under', 'drop', 'fall', 'lower', 'decline'];

        let direction: 'above' | 'below' | null = null;
        if (aboveKeywords.some(keyword => lowerQuestion.includes(keyword))) {
            direction = 'above';
        } else if (belowKeywords.some(keyword => lowerQuestion.includes(keyword))) {
            direction = 'below';
        }
        if (!direction) return null;

        // Extract price threshold: $100,000 / $100K / $95k / $2,500
        const pricePatterns = [
            /\$\s*(\d{1,3}(?:,\d{3})+)/,
            /\$\s*(\d+\.?\d*)\s*k/i,
            /\$\s*(\d+)/
        ];

        let threshold: number | null = null;
        for (const pattern of pricePatterns) {
            const match = question.match(pattern);
            if (match?.[1]) {
                if (/\$\s*\d+\.?\d*\s*k/i.test(question)) {
                    threshold = parseFloat(match[1]) * 1000;
                } else {
                    threshold = parseFloat(match[1].replace(/,/g, ''));
                }
                break;
            }
        }

        if (!threshold || threshold <= 0) return null;

        return { symbol, threshold, direction };
    }

    getDescription(): string {
        return 'Binance-Polymarket lag exploit — buy confirmed outcomes before odds update';
    }

    getConfig(): BinanceLagConfig {
        return this.lagConfig;
    }
}
