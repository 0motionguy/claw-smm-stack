import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import Logger from '../utils/logger';
import { analyzeOrderBook, calculateSlippage } from '../core/orderbook';
import { StrategySignal } from '../strategies/base-strategy';

/**
 * Order execution result
 */
export interface ExecutionResult {
    success: boolean;
    orderId?: string;
    fillPrice?: number;
    fillSize?: number;
    fillAmountUSD?: number;
    error?: string;
    signal: StrategySignal;
    executedAt: number;
}

/**
 * Executor configuration
 */
export interface ExecutorConfig {
    maxSlippagePercent: number; // Max acceptable slippage (default 2%)
    minLiquidityUSD: number; // Min order book depth to trade (default 500)
    maxOrderSizeUSD: number; // Max single order size (default 100)
    splitThresholdUSD: number; // Split orders above this amount (default 50)
    splitCount: number; // Number of splits for large orders (default 3)
    useGTC: boolean; // Use Good-Til-Cancelled limit orders (default true)
    priceImprovementCents: number; // Improve on best price by this many cents (default 0.5)
    orderType: 'GTC' | 'GTD' | 'FAK'; // Order type (default 'GTC')
    maxBatchSize: number; // Maximum orders per batch (default 15)
    supportFAK: boolean; // Support Fill-and-Kill orders (default true)
}

const DEFAULT_CONFIG: ExecutorConfig = {
    maxSlippagePercent: 2.0,
    minLiquidityUSD: 500,
    maxOrderSizeUSD: 100,
    splitThresholdUSD: 50,
    splitCount: 3,
    useGTC: true,
    priceImprovementCents: 0.5,
    orderType: 'GTC',
    maxBatchSize: 15,
    supportFAK: true,
};

/**
 * Order executor - handles order placement with spread optimization
 * Always uses limit orders (never market orders) to save 1-3% slippage
 */
export class Executor {
    private readonly clobClient: ClobClient;
    private readonly config: ExecutorConfig;

    constructor(clobClient: ClobClient, config?: Partial<ExecutorConfig>) {
        this.clobClient = clobClient;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Execute a strategy signal as a limit order
     * Returns execution result with fill details
     */
    async execute(signal: StrategySignal): Promise<ExecutionResult> {
        const startTime = Date.now();

        try {
            // Step 1: Check order book liquidity
            const analysis = await analyzeOrderBook(signal.tokenId, this.clobClient);
            const totalDepth = analysis.bidDepth + analysis.askDepth;

            if (totalDepth < this.config.minLiquidityUSD) {
                return {
                    success: false,
                    error: `Insufficient liquidity: $${totalDepth.toFixed(0)} (min: $${this.config.minLiquidityUSD})`,
                    signal,
                    executedAt: startTime,
                };
            }

            // Step 2: Check slippage
            const slippage = await calculateSlippage(
                signal.tokenId,
                signal.action === 'buy' ? 'buy' : 'sell',
                signal.amountUSD,
                this.clobClient
            );

            if (slippage > this.config.maxSlippagePercent) {
                return {
                    success: false,
                    error: `Slippage too high: ${slippage.toFixed(2)}% (max: ${this.config.maxSlippagePercent}%)`,
                    signal,
                    executedAt: startTime,
                };
            }

            // Step 3: Calculate limit order price with improvement
            const improvementCents = this.config.priceImprovementCents / 100;
            let limitPrice: number;

            if (signal.action === 'buy') {
                // Place bid slightly above current best bid
                limitPrice = analysis.bestBid + improvementCents;
                // But never above the ask
                limitPrice = Math.min(limitPrice, analysis.bestAsk - 0.001);
            } else {
                // Place ask slightly below current best ask
                limitPrice = analysis.bestAsk - improvementCents;
                // But never below the bid
                limitPrice = Math.max(limitPrice, analysis.bestBid + 0.001);
            }

            // Step 4: Split large orders and place via CLOB API
            const amounts = this.splitOrder(signal.amountUSD);

            Logger.info(
                `[Executor] ${signal.action.toUpperCase()} $${signal.amountUSD.toFixed(2)} @ ${limitPrice.toFixed(4)} | ` +
                `Spread: ${analysis.spreadPercent.toFixed(2)}% | Slippage: ${slippage.toFixed(2)}% | ` +
                `Splits: ${amounts.length}`
            );
            let totalFillSize = 0;
            let lastOrderId = '';

            for (const amount of amounts) {
                const orderArgs = {
                    tokenID: signal.tokenId,
                    price: parseFloat(limitPrice.toFixed(4)),
                    side: signal.action === 'buy' ? Side.BUY : Side.SELL,
                    size: parseFloat((amount / limitPrice).toFixed(2)),
                };

                const signedOrder = await this.clobClient.createOrder(orderArgs);
                const resp = await this.clobClient.postOrder(signedOrder, OrderType.GTC);

                if (resp.success) {
                    totalFillSize += orderArgs.size;
                    lastOrderId = resp.orderID || `exec-${Date.now()}`;
                    Logger.success(
                        `[Executor] Order placed: ${signal.action.toUpperCase()} ${orderArgs.size} @ ${limitPrice.toFixed(4)} | ID: ${lastOrderId}`
                    );
                } else {
                    Logger.warning(`[Executor] Order rejected: ${JSON.stringify(resp)}`);
                }
            }

            if (totalFillSize === 0) {
                return {
                    success: false,
                    error: 'All order splits rejected',
                    signal,
                    executedAt: startTime,
                };
            }

            return {
                success: true,
                orderId: lastOrderId,
                fillPrice: limitPrice,
                fillSize: totalFillSize,
                fillAmountUSD: totalFillSize * limitPrice,
                signal,
                executedAt: startTime,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            Logger.error(`[Executor] Failed: ${errorMsg}`);

            return {
                success: false,
                error: errorMsg,
                signal,
                executedAt: startTime,
            };
        }
    }

    /**
     * Execute a Fill-and-Kill order for speed-critical strategies
     * Skips slippage pre-check and uses signal price directly
     */
    async executeFAK(signal: StrategySignal): Promise<ExecutionResult> {
        const startTime = Date.now();

        try {
            // Step 1: Check order book liquidity only
            const analysis = await analyzeOrderBook(signal.tokenId, this.clobClient);
            const totalDepth = analysis.bidDepth + analysis.askDepth;

            if (totalDepth < this.config.minLiquidityUSD) {
                return {
                    success: false,
                    error: `Insufficient liquidity: $${totalDepth.toFixed(0)} (min: $${this.config.minLiquidityUSD})`,
                    signal,
                    executedAt: startTime,
                };
            }

            // Step 2: Use signal price directly (no improvement)
            const limitPrice = signal.price;

            Logger.info(
                `[Executor] FAK order ${signal.action.toUpperCase()} $${signal.amountUSD.toFixed(2)} @ ${limitPrice.toFixed(4)} | ` +
                `Spread: ${analysis.spreadPercent.toFixed(2)}%`
            );

            // Step 3: Place FAK order via CLOB API
            const fillSize = signal.amountUSD / limitPrice;
            const orderArgs = {
                tokenID: signal.tokenId,
                price: parseFloat(limitPrice.toFixed(4)),
                side: signal.action === 'buy' ? Side.BUY : Side.SELL,
                size: parseFloat(fillSize.toFixed(2)),
            };

            const signedOrder = await this.clobClient.createOrder(orderArgs);
            const resp = await this.clobClient.postOrder(signedOrder, OrderType.FOK);

            if (!resp.success) {
                return {
                    success: false,
                    error: `FAK rejected: ${JSON.stringify(resp)}`,
                    signal,
                    executedAt: startTime,
                };
            }

            Logger.success(
                `[Executor] FAK filled: ${signal.action.toUpperCase()} ${orderArgs.size} @ ${limitPrice.toFixed(4)}`
            );

            return {
                success: true,
                orderId: resp.orderID || `exec-fak-${Date.now()}`,
                fillPrice: limitPrice,
                fillSize: orderArgs.size,
                fillAmountUSD: signal.amountUSD,
                signal,
                executedAt: startTime,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            Logger.error(`[Executor] FAK order failed: ${errorMsg}`);

            return {
                success: false,
                error: errorMsg,
                signal,
                executedAt: startTime,
            };
        }
    }

    /**
     * Execute multiple orders in batches
     * Processes up to maxBatchSize orders per batch
     */
    async executeBatch(signals: StrategySignal[]): Promise<ExecutionResult[]> {
        const results: ExecutionResult[] = [];
        const batchSize = this.config.maxBatchSize;
        const totalBatches = Math.ceil(signals.length / batchSize);

        for (let i = 0; i < signals.length; i += batchSize) {
            const batch = signals.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;

            Logger.info(
                `[Executor] Batch: processing ${batch.length} order(s) (batch ${batchNumber}/${totalBatches})`
            );

            // Process all signals in the batch
            for (const signal of batch) {
                const orderType = this.getOrderType(signal);
                let result: ExecutionResult;

                if (orderType === 'FAK') {
                    result = await this.executeFAK(signal);
                } else {
                    result = await this.execute(signal);
                }

                results.push(result);
            }
        }

        return results;
    }

    /**
     * Determine the appropriate order type for a signal
     */
    getOrderType(signal: StrategySignal): 'GTC' | 'GTD' | 'FAK' {
        // Check if signal has a preferred order type
        const preferredType = (signal as any).preferredOrderType;

        if (preferredType === 'FAK' && this.config.supportFAK) {
            return 'FAK';
        }

        return this.config.orderType;
    }

    /**
     * Split a large order into smaller chunks to reduce market impact
     */
    private splitOrder(amountUSD: number): number[] {
        if (amountUSD <= this.config.splitThresholdUSD) {
            return [amountUSD];
        }

        const splitSize = amountUSD / this.config.splitCount;
        const amounts: number[] = [];

        for (let i = 0; i < this.config.splitCount; i++) {
            if (i === this.config.splitCount - 1) {
                // Last split gets remainder to avoid rounding issues
                const usedSoFar = amounts.reduce((s, a) => s + a, 0);
                amounts.push(amountUSD - usedSoFar);
            } else {
                amounts.push(Math.round(splitSize * 100) / 100);
            }
        }

        return amounts;
    }

    /**
     * Check if market conditions are favorable for trading
     */
    async canExecute(tokenId: string, amountUSD: number): Promise<{ ok: boolean; reason?: string }> {
        try {
            const analysis = await analyzeOrderBook(tokenId, this.clobClient);
            const totalDepth = analysis.bidDepth + analysis.askDepth;

            if (totalDepth < this.config.minLiquidityUSD) {
                return { ok: false, reason: `Low liquidity: $${totalDepth.toFixed(0)}` };
            }

            // Check if spread + fees would eat the edge
            // Polymarket has 2% winner fee, so effective cost = spread + 2%
            const effectiveCost = analysis.spreadPercent + 2.0;
            if (effectiveCost > 5.0) {
                return { ok: false, reason: `Effective cost too high: ${effectiveCost.toFixed(1)}%` };
            }

            const slippage = await calculateSlippage(tokenId, 'buy', amountUSD, this.clobClient);
            if (slippage > this.config.maxSlippagePercent) {
                return { ok: false, reason: `Slippage: ${slippage.toFixed(2)}%` };
            }

            return { ok: true };
        } catch (error) {
            return { ok: false, reason: `Error: ${error instanceof Error ? error.message : String(error)}` };
        }
    }
}
