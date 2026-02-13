import Logger from '../utils/logger';
import { Portfolio } from '../core/portfolio';
import { StrategySignal } from '../strategies/base-strategy';

/**
 * Risk management configuration
 */
export interface RiskConfig {
    dailyLossLimitUSD: number; // Stop trading if daily PnL < -$X (default 20)
    maxPositionsPerCategory: number; // Max positions in same category (default 3)
    drawdownCircuitBreakerPercent: number; // Pause if portfolio drops X% from peak (default 10)
    maxConcurrentPositions: number; // Max open positions across all strategies (default 15)
    maxSinglePositionPercent: number; // Max single position as % of bankroll (default 5)
    correlationCheckEnabled: boolean; // Check for correlated bets (default true)
    circuitBreakerCooldownMs: number; // How long to pause after circuit breaker (default 24h)
}

const DEFAULT_CONFIG: RiskConfig = {
    dailyLossLimitUSD: 20,
    maxPositionsPerCategory: 3,
    drawdownCircuitBreakerPercent: 10,
    maxConcurrentPositions: 15,
    maxSinglePositionPercent: 5,
    correlationCheckEnabled: true,
    circuitBreakerCooldownMs: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Risk check result
 */
export interface RiskCheckResult {
    allowed: boolean;
    reason?: string;
}

/**
 * Risk Manager - enforces position limits, drawdown stops, and correlation checks
 */
export class RiskManager {
    private readonly config: RiskConfig;
    private readonly portfolio: Portfolio;
    private dailyPnl: number = 0;
    private circuitBreakerTriggeredAt: number = 0;
    private tradingPaused: boolean = false;
    private dailyResetTime: number;

    // Track market categories for correlation
    private positionCategories: Map<string, string[]> = new Map(); // category -> marketId[]

    constructor(portfolio: Portfolio, config?: Partial<RiskConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.portfolio = portfolio;
        this.dailyResetTime = this.getNextMidnightUTC();
    }

    /**
     * Check if a trade should be allowed
     */
    checkTrade(signal: StrategySignal): RiskCheckResult {
        // Check 1: Is trading paused by circuit breaker?
        if (this.tradingPaused) {
            const elapsed = Date.now() - this.circuitBreakerTriggeredAt;
            if (elapsed < this.config.circuitBreakerCooldownMs) {
                const remaining = Math.ceil((this.config.circuitBreakerCooldownMs - elapsed) / 3600000);
                return {
                    allowed: false,
                    reason: `Circuit breaker active (${remaining}h remaining)`,
                };
            }
            // Cooldown expired, resume trading
            this.tradingPaused = false;
            Logger.info('[Risk] Circuit breaker cooldown expired, resuming trading');
        }

        // Check 2: Daily loss limit
        if (this.dailyPnl < -this.config.dailyLossLimitUSD) {
            return {
                allowed: false,
                reason: `Daily loss limit hit: $${this.dailyPnl.toFixed(2)} (limit: -$${this.config.dailyLossLimitUSD})`,
            };
        }

        // Check 3: Drawdown circuit breaker
        const drawdown = this.portfolio.getDrawdown();
        if (drawdown > this.config.drawdownCircuitBreakerPercent) {
            this.triggerCircuitBreaker(`Drawdown ${drawdown.toFixed(1)}% exceeds ${this.config.drawdownCircuitBreakerPercent}%`);
            return {
                allowed: false,
                reason: `Drawdown circuit breaker: ${drawdown.toFixed(1)}%`,
            };
        }

        // Check 4: Max concurrent positions
        const openPositions = this.portfolio.getPositions();
        if (signal.action === 'buy' && openPositions.length >= this.config.maxConcurrentPositions) {
            return {
                allowed: false,
                reason: `Max positions reached: ${openPositions.length}/${this.config.maxConcurrentPositions}`,
            };
        }

        // Check 5: Single position size limit
        const maxPositionUSD = this.portfolio.getBankroll() * (this.config.maxSinglePositionPercent / 100);
        if (signal.amountUSD > maxPositionUSD) {
            return {
                allowed: false,
                reason: `Position too large: $${signal.amountUSD.toFixed(2)} (max: $${maxPositionUSD.toFixed(2)})`,
            };
        }

        // Check 6: Sufficient funds
        if (signal.action === 'buy' && !this.portfolio.canOpenPosition(signal.amountUSD)) {
            return {
                allowed: false,
                reason: `Insufficient funds: need $${signal.amountUSD.toFixed(2)}, have $${this.portfolio.getBankroll().toFixed(2)}`,
            };
        }

        // Check 7: Category concentration (if enabled)
        if (this.config.correlationCheckEnabled && signal.action === 'buy') {
            const category = this.categorizeMarket(signal.marketQuestion);
            const categoryPositions = this.positionCategories.get(category) || [];
            if (categoryPositions.length >= this.config.maxPositionsPerCategory) {
                return {
                    allowed: false,
                    reason: `Too many positions in category "${category}": ${categoryPositions.length}/${this.config.maxPositionsPerCategory}`,
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Record a completed trade's PnL
     */
    recordTradePnl(pnl: number): void {
        this.dailyPnl += pnl;

        // Check if daily reset is needed
        if (Date.now() >= this.dailyResetTime) {
            this.resetDaily();
        }
    }

    /**
     * Track a new position's category
     */
    trackPosition(marketId: string, marketQuestion: string): void {
        const category = this.categorizeMarket(marketQuestion);
        const existing = this.positionCategories.get(category) || [];
        if (!existing.includes(marketId)) {
            existing.push(marketId);
            this.positionCategories.set(category, existing);
        }
    }

    /**
     * Remove a position from category tracking
     */
    untrackPosition(marketId: string): void {
        for (const [category, markets] of this.positionCategories) {
            const filtered = markets.filter((id) => id !== marketId);
            if (filtered.length === 0) {
                this.positionCategories.delete(category);
            } else {
                this.positionCategories.set(category, filtered);
            }
        }
    }

    /**
     * Get current risk status
     */
    getStatus(): {
        tradingPaused: boolean;
        dailyPnl: number;
        drawdown: number;
        openPositions: number;
        maxPositions: number;
        categoryBreakdown: Record<string, number>;
    } {
        const categoryBreakdown: Record<string, number> = {};
        for (const [cat, markets] of this.positionCategories) {
            categoryBreakdown[cat] = markets.length;
        }

        return {
            tradingPaused: this.tradingPaused,
            dailyPnl: this.dailyPnl,
            drawdown: this.portfolio.getDrawdown(),
            openPositions: this.portfolio.getPositions().length,
            maxPositions: this.config.maxConcurrentPositions,
            categoryBreakdown,
        };
    }

    /**
     * Reset daily counters (called at midnight UTC)
     */
    private resetDaily(): void {
        this.dailyPnl = 0;
        this.dailyResetTime = this.getNextMidnightUTC();
        Logger.info('[Risk] Daily counters reset');
    }

    /**
     * Trigger the circuit breaker
     */
    private triggerCircuitBreaker(reason: string): void {
        this.tradingPaused = true;
        this.circuitBreakerTriggeredAt = Date.now();
        Logger.error(`[Risk] CIRCUIT BREAKER TRIGGERED: ${reason}`);
        Logger.warning(`[Risk] Trading paused for ${this.config.circuitBreakerCooldownMs / 3600000}h`);
    }

    /**
     * Categorize a market based on its question
     * Used for correlation checking (don't stack correlated bets)
     */
    private categorizeMarket(question: string): string {
        const q = question.toLowerCase();

        if (q.includes('bitcoin') || q.includes('btc')) return 'crypto-btc';
        if (q.includes('ethereum') || q.includes('eth')) return 'crypto-eth';
        if (q.includes('crypto') || q.includes('solana') || q.includes('sol')) return 'crypto-other';
        if (q.includes('election') || q.includes('president') || q.includes('vote')) return 'politics-election';
        if (q.includes('trump') || q.includes('biden') || q.includes('harris')) return 'politics-us';
        if (q.includes('fed') || q.includes('interest rate') || q.includes('inflation')) return 'economics';
        if (q.includes('weather') || q.includes('temperature') || q.includes('hurricane')) return 'weather';
        if (q.includes('nfl') || q.includes('nba') || q.includes('mlb') || q.includes('sports')) return 'sports';
        if (q.includes('ai') || q.includes('openai') || q.includes('google')) return 'tech';

        return 'other';
    }

    /**
     * Get next midnight UTC timestamp
     */
    private getNextMidnightUTC(): number {
        const now = new Date();
        const midnight = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1,
            0, 0, 0, 0
        ));
        return midnight.getTime();
    }
}
