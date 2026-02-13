/**
 * Base Strategy - Abstract base class for all trading strategies
 * All strategies must extend this class and implement analyze() and getDescription()
 */

export interface StrategySignal {
    action: 'buy' | 'sell' | 'hold';
    tokenId: string;
    marketId: string;
    marketQuestion: string;
    price: number;
    confidence: number; // 0.0 - 1.0
    amountUSD: number;
    reason: string;
    strategyName: string;
}

export interface StrategyConfig {
    enabled: boolean;
    maxPositionUSD: number;
    maxDailyTrades: number;
    minConfidence: number; // 0.0-1.0, minimum confidence to execute
    scanIntervalMs: number; // how often to scan for opportunities
}

export abstract class BaseStrategy {
    readonly name: string;
    protected config: StrategyConfig;
    protected dailyTradeCount: number;
    protected lastScanTime: number;

    constructor(name: string, config: StrategyConfig) {
        this.name = name;
        this.config = config;
        this.dailyTradeCount = 0;
        this.lastScanTime = 0;
    }

    /**
     * Analyze markets and generate trading signals
     * Must be implemented by each strategy
     */
    abstract analyze(): Promise<StrategySignal[]>;

    /**
     * Get human-readable description of the strategy
     * Must be implemented by each strategy
     */
    abstract getDescription(): string;

    /**
     * Check if the strategy can trade right now
     * Checks: enabled status, daily trade limit, scan interval
     */
    canTrade(): boolean {
        if (!this.config.enabled) {
            return false;
        }

        if (this.dailyTradeCount >= this.config.maxDailyTrades) {
            return false;
        }

        return true;
    }

    /**
     * Check if enough time has passed since last scan
     */
    shouldScan(): boolean {
        const now = Date.now();
        const timeSinceLastScan = now - this.lastScanTime;
        return timeSinceLastScan >= this.config.scanIntervalMs;
    }

    /**
     * Mark that a scan was performed (updates lastScanTime)
     */
    markScanned(): void {
        this.lastScanTime = Date.now();
    }

    /**
     * Record that a trade was executed (increments daily count)
     */
    recordTrade(): void {
        this.dailyTradeCount++;
    }

    /**
     * Reset daily counters (call at midnight UTC)
     */
    resetDaily(): void {
        this.dailyTradeCount = 0;
    }

    /**
     * Get current configuration
     */
    getConfig(): StrategyConfig {
        return { ...this.config };
    }

    /**
     * Get current status
     */
    getStatus(): {
        name: string;
        enabled: boolean;
        dailyTrades: number;
        maxDailyTrades: number;
        canTrade: boolean;
        lastScanTime: number;
    } {
        return {
            name: this.name,
            enabled: this.config.enabled,
            dailyTrades: this.dailyTradeCount,
            maxDailyTrades: this.config.maxDailyTrades,
            canTrade: this.canTrade(),
            lastScanTime: this.lastScanTime,
        };
    }
}
