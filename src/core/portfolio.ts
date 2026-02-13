import Logger from '../utils/logger';

/**
 * Position tracked by the portfolio manager
 */
export interface TrackedPosition {
    marketId: string;
    tokenId: string;
    question: string;
    outcome: string;
    side: 'buy' | 'sell';
    entryPrice: number;
    currentPrice: number;
    size: number; // number of shares
    costBasis: number; // total USD spent
    currentValue: number;
    pnl: number;
    pnlPercent: number;
    strategyName: string;
    entryTime: number;
    isPaper: boolean;
}

/**
 * Strategy performance metrics
 */
export interface StrategyMetrics {
    strategyName: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgPnlPerTrade: number;
    maxDrawdown: number;
    sharpeRatio: number;
}

/**
 * Portfolio manager - tracks positions, calculates Kelly sizing, manages bankroll
 */
export class Portfolio {
    private positions: Map<string, TrackedPosition> = new Map();
    private tradeHistory: Array<{
        marketId: string;
        tokenId: string;
        strategyName: string;
        pnl: number;
        entryPrice: number;
        exitPrice: number;
        size: number;
        entryTime: number;
        exitTime: number;
    }> = [];
    private bankroll: number;
    private peakBankroll: number;
    private readonly maxPositionPercent: number = 0.05; // 5% of bankroll per market
    private readonly maxCategoryPercent: number = 0.20; // 20% per category
    private readonly kellyFraction: number = 0.5; // half-Kelly for safety

    constructor(initialBankroll: number) {
        this.bankroll = initialBankroll;
        this.peakBankroll = initialBankroll;
    }

    /**
     * Kelly Criterion for optimal bet sizing
     * f* = (bp - q) / b
     * where b = odds (decimal), p = win probability, q = 1 - p
     * Uses half-Kelly for safety
     */
    calculateKellySize(
        winProbability: number,
        odds: number, // decimal odds (e.g., price 0.60 means odds = 1/0.60 - 1 = 0.667)
        maxPositionUSD?: number
    ): number {
        if (winProbability <= 0 || winProbability >= 1 || odds <= 0) {
            return 0;
        }

        const q = 1 - winProbability;
        const kelly = (odds * winProbability - q) / odds;

        if (kelly <= 0) {
            return 0; // Negative edge, don't bet
        }

        // Apply half-Kelly
        const halfKelly = kelly * this.kellyFraction;

        // Calculate position size in USD
        let positionSize = this.bankroll * halfKelly;

        // Apply max position limit (5% of bankroll)
        const maxPosition = this.bankroll * this.maxPositionPercent;
        positionSize = Math.min(positionSize, maxPosition);

        // Apply strategy-specific limit if provided
        if (maxPositionUSD !== undefined) {
            positionSize = Math.min(positionSize, maxPositionUSD);
        }

        // Minimum trade size $1
        if (positionSize < 1) {
            return 0;
        }

        return Math.round(positionSize * 100) / 100; // Round to 2 decimal places
    }

    /**
     * Calculate position size from price (converts price to odds internally)
     */
    calculatePositionSize(
        winProbability: number,
        price: number, // outcome price (0.01 - 0.99)
        maxPositionUSD?: number
    ): number {
        if (price <= 0 || price >= 1) {
            return 0;
        }
        // Convert price to decimal odds: odds = (1/price) - 1
        const odds = (1 / price) - 1;
        return this.calculateKellySize(winProbability, odds, maxPositionUSD);
    }

    /**
     * Add a new position (paper or live)
     */
    addPosition(position: Omit<TrackedPosition, 'currentValue' | 'pnl' | 'pnlPercent'>): void {
        const key = `${position.tokenId}:${position.strategyName}`;
        const currentValue = position.currentPrice * position.size;
        const pnl = currentValue - position.costBasis;
        const pnlPercent = position.costBasis > 0 ? (pnl / position.costBasis) * 100 : 0;

        this.positions.set(key, {
            ...position,
            currentValue,
            pnl,
            pnlPercent,
        });

        Logger.info(
            `[Portfolio] Added position: ${position.question.slice(0, 40)} | ` +
            `$${position.costBasis.toFixed(2)} @ ${position.entryPrice.toFixed(3)} | ` +
            `Strategy: ${position.strategyName}`
        );
    }

    /**
     * Update current price for a position
     */
    updatePrice(tokenId: string, strategyName: string, currentPrice: number): void {
        const key = `${tokenId}:${strategyName}`;
        const position = this.positions.get(key);
        if (!position) return;

        position.currentPrice = currentPrice;
        position.currentValue = currentPrice * position.size;
        position.pnl = position.currentValue - position.costBasis;
        position.pnlPercent = position.costBasis > 0
            ? (position.pnl / position.costBasis) * 100
            : 0;
    }

    /**
     * Close a position and record the trade
     */
    closePosition(tokenId: string, strategyName: string, exitPrice: number): number {
        const key = `${tokenId}:${strategyName}`;
        const position = this.positions.get(key);
        if (!position) return 0;

        const exitValue = exitPrice * position.size;
        const pnl = exitValue - position.costBasis;

        // Record in trade history
        this.tradeHistory.push({
            marketId: position.marketId,
            tokenId: position.tokenId,
            strategyName: position.strategyName,
            pnl,
            entryPrice: position.entryPrice,
            exitPrice,
            size: position.size,
            entryTime: position.entryTime,
            exitTime: Date.now(),
        });

        // Update bankroll
        this.bankroll += pnl;
        if (this.bankroll > this.peakBankroll) {
            this.peakBankroll = this.bankroll;
        }

        this.positions.delete(key);

        const pnlSign = pnl >= 0 ? '+' : '';
        Logger.info(
            `[Portfolio] Closed position: ${position.question.slice(0, 40)} | ` +
            `PnL: ${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${((pnl / position.costBasis) * 100).toFixed(1)}%)`
        );

        return pnl;
    }

    /**
     * Get all open positions
     */
    getPositions(): TrackedPosition[] {
        return Array.from(this.positions.values());
    }

    /**
     * Get positions for a specific strategy
     */
    getStrategyPositions(strategyName: string): TrackedPosition[] {
        return Array.from(this.positions.values()).filter(
            (p) => p.strategyName === strategyName
        );
    }

    /**
     * Get total portfolio value (bankroll + open positions)
     */
    getTotalValue(): number {
        const positionValue = Array.from(this.positions.values()).reduce(
            (sum, p) => sum + p.currentValue,
            0
        );
        return this.bankroll + positionValue;
    }

    /**
     * Get current bankroll (available cash)
     */
    getBankroll(): number {
        return this.bankroll;
    }

    /**
     * Get current drawdown percentage from peak
     */
    getDrawdown(): number {
        const totalValue = this.getTotalValue();
        if (this.peakBankroll === 0) return 0;
        return ((this.peakBankroll - totalValue) / this.peakBankroll) * 100;
    }

    /**
     * Get performance metrics for a strategy
     */
    getStrategyMetrics(strategyName: string): StrategyMetrics {
        const trades = this.tradeHistory.filter((t) => t.strategyName === strategyName);
        const wins = trades.filter((t) => t.pnl > 0);
        const losses = trades.filter((t) => t.pnl <= 0);
        const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

        // Calculate max drawdown for this strategy
        let peak = 0;
        let maxDrawdown = 0;
        let runningPnl = 0;
        for (const trade of trades) {
            runningPnl += trade.pnl;
            if (runningPnl > peak) peak = runningPnl;
            const dd = peak - runningPnl;
            if (dd > maxDrawdown) maxDrawdown = dd;
        }

        // Calculate Sharpe ratio (simplified: mean return / std dev of returns)
        const returns = trades.map((t) => t.pnl);
        const meanReturn = returns.length > 0 ? totalPnl / returns.length : 0;
        const variance = returns.length > 1
            ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1)
            : 0;
        const stdDev = Math.sqrt(variance);
        const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

        return {
            strategyName,
            totalTrades: trades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
            totalPnl,
            avgPnlPerTrade: trades.length > 0 ? totalPnl / trades.length : 0,
            maxDrawdown,
            sharpeRatio,
        };
    }

    /**
     * Get all strategy metrics
     */
    getAllMetrics(): StrategyMetrics[] {
        const strategyNames = [...new Set(this.tradeHistory.map((t) => t.strategyName))];
        return strategyNames.map((name) => this.getStrategyMetrics(name));
    }

    /**
     * Check if we can open a new position (within limits)
     */
    canOpenPosition(amountUSD: number): boolean {
        return amountUSD <= this.bankroll && amountUSD > 0;
    }

    /**
     * Get number of open positions for a strategy
     */
    getOpenPositionCount(strategyName: string): number {
        return this.getStrategyPositions(strategyName).length;
    }
}
