import Logger from '../utils/logger';
import { Portfolio, TrackedPosition, StrategyMetrics } from './portfolio';
import { StrategySignal } from '../strategies/base-strategy';

/**
 * Paper trade record
 */
export interface PaperTrade {
    id: string;
    signal: StrategySignal;
    executedAt: number;
    fillPrice: number;
    fillSize: number; // shares
    fillAmountUSD: number;
    fees: number; // simulated 2% winner fee
    status: 'open' | 'closed' | 'expired';
    closedAt?: number;
    closePrice?: number;
    pnl?: number;
}

/**
 * Paper trading engine - simulates order execution against real market data
 * All strategies start in paper mode
 */
export class PaperEngine {
    private readonly portfolio: Portfolio;
    private trades: PaperTrade[] = [];
    private tradeCounter: number = 0;
    private startTime: number;

    constructor(initialBankroll: number = 1000) {
        this.portfolio = new Portfolio(initialBankroll);
        this.startTime = Date.now();
        Logger.info(`[Paper] Engine started with $${initialBankroll.toFixed(2)} simulated capital`);
    }

    /**
     * Execute a paper trade from a strategy signal
     * Simulates fill at signal price with small slippage
     */
    executeTrade(signal: StrategySignal): PaperTrade | null {
        if (signal.action === 'hold') {
            return null;
        }

        // Check if we have enough paper bankroll
        if (signal.action === 'buy' && !this.portfolio.canOpenPosition(signal.amountUSD)) {
            Logger.warning(
                `[Paper] Insufficient funds for ${signal.strategyName}: ` +
                `needs $${signal.amountUSD.toFixed(2)}, has $${this.portfolio.getBankroll().toFixed(2)}`
            );
            return null;
        }

        // Simulate small slippage (0.1-0.5%)
        const slippagePct = 0.001 + Math.random() * 0.004;
        const slippageDir = signal.action === 'buy' ? 1 : -1;
        const fillPrice = signal.price * (1 + slippageDir * slippagePct);

        // Calculate fill size (shares)
        const fillSize = signal.amountUSD / fillPrice;

        // Simulated fees (Polymarket charges 2% on winning outcomes)
        const fees = signal.amountUSD * 0.02;

        const trade: PaperTrade = {
            id: `paper-${++this.tradeCounter}`,
            signal,
            executedAt: Date.now(),
            fillPrice,
            fillSize,
            fillAmountUSD: signal.amountUSD,
            fees,
            status: 'open',
        };

        this.trades.push(trade);

        if (signal.action === 'buy') {
            // Add position to portfolio
            this.portfolio.addPosition({
                marketId: signal.marketId,
                tokenId: signal.tokenId,
                question: signal.marketQuestion,
                outcome: signal.action,
                side: 'buy',
                entryPrice: fillPrice,
                currentPrice: fillPrice,
                size: fillSize,
                costBasis: signal.amountUSD,
                strategyName: signal.strategyName,
                entryTime: Date.now(),
                isPaper: true,
            });
        }

        Logger.success(
            `[Paper] ${signal.action.toUpperCase()} executed | ` +
            `${signal.strategyName} | $${signal.amountUSD.toFixed(2)} @ ${fillPrice.toFixed(4)} | ` +
            `${signal.marketQuestion.slice(0, 45)}... | ` +
            `Confidence: ${(signal.confidence * 100).toFixed(0)}%`
        );

        return trade;
    }

    /**
     * Close a paper position when price hits target or stop
     */
    closeTrade(tokenId: string, strategyName: string, closePrice: number): PaperTrade | null {
        const trade = this.trades.find(
            (t) =>
                t.signal.tokenId === tokenId &&
                t.signal.strategyName === strategyName &&
                t.status === 'open'
        );

        if (!trade) return null;

        trade.status = 'closed';
        trade.closedAt = Date.now();
        trade.closePrice = closePrice;

        const pnl = this.portfolio.closePosition(tokenId, strategyName, closePrice);
        trade.pnl = pnl - trade.fees; // Subtract simulated fees

        Logger.info(
            `[Paper] Position closed | ${strategyName} | ` +
            `PnL: ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)} (after fees)`
        );

        return trade;
    }

    /**
     * Update prices for all open positions
     */
    updatePrices(priceUpdates: Map<string, number>): void {
        for (const [tokenId, price] of priceUpdates) {
            // Update all positions with this token
            for (const trade of this.trades) {
                if (trade.signal.tokenId === tokenId && trade.status === 'open') {
                    this.portfolio.updatePrice(tokenId, trade.signal.strategyName, price);
                }
            }
        }
    }

    /**
     * Get all open paper trades
     */
    getOpenTrades(): PaperTrade[] {
        return this.trades.filter((t) => t.status === 'open');
    }

    /**
     * Get all closed paper trades
     */
    getClosedTrades(): PaperTrade[] {
        return this.trades.filter((t) => t.status === 'closed');
    }

    /**
     * Get portfolio reference
     */
    getPortfolio(): Portfolio {
        return this.portfolio;
    }

    /**
     * Get strategy metrics from portfolio
     */
    getStrategyMetrics(strategyName: string): StrategyMetrics {
        return this.portfolio.getStrategyMetrics(strategyName);
    }

    /**
     * Get all strategy metrics
     */
    getAllMetrics(): StrategyMetrics[] {
        return this.portfolio.getAllMetrics();
    }

    /**
     * Get open positions
     */
    getPositions(): TrackedPosition[] {
        return this.portfolio.getPositions();
    }

    /**
     * Get daily report
     */
    getDailyReport(): {
        totalValue: number;
        bankroll: number;
        drawdown: number;
        openPositions: number;
        totalTrades: number;
        todayTrades: number;
        todayPnl: number;
        strategyBreakdown: StrategyMetrics[];
        uptime: string;
    } {
        const now = Date.now();
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const dayStartMs = dayStart.getTime();

        const todayTrades = this.trades.filter((t) => t.executedAt >= dayStartMs);
        const todayPnl = todayTrades
            .filter((t) => t.status === 'closed' && t.pnl !== undefined)
            .reduce((sum, t) => sum + (t.pnl ?? 0), 0);

        const uptimeMs = now - this.startTime;
        const hours = Math.floor(uptimeMs / 3600000);
        const minutes = Math.floor((uptimeMs % 3600000) / 60000);
        const uptime = `${hours}h ${minutes}m`;

        return {
            totalValue: this.portfolio.getTotalValue(),
            bankroll: this.portfolio.getBankroll(),
            drawdown: this.portfolio.getDrawdown(),
            openPositions: this.getOpenTrades().length,
            totalTrades: this.trades.length,
            todayTrades: todayTrades.length,
            todayPnl,
            strategyBreakdown: this.portfolio.getAllMetrics(),
            uptime,
        };
    }

    /**
     * Log a formatted daily report to console
     */
    logReport(): void {
        const report = this.getDailyReport();

        Logger.header('PAPER TRADING REPORT');
        Logger.info(`Uptime: ${report.uptime}`);
        Logger.info(`Total Portfolio Value: $${report.totalValue.toFixed(2)}`);
        Logger.info(`Available Cash: $${report.bankroll.toFixed(2)}`);
        Logger.info(`Drawdown: ${report.drawdown.toFixed(1)}%`);
        Logger.info(`Open Positions: ${report.openPositions}`);
        Logger.info(`Total Trades: ${report.totalTrades}`);
        Logger.info(`Today's Trades: ${report.todayTrades}`);
        Logger.info(`Today's PnL: ${report.todayPnl >= 0 ? '+' : ''}$${report.todayPnl.toFixed(2)}`);

        if (report.strategyBreakdown.length > 0) {
            Logger.separator();
            Logger.info('Strategy Breakdown:');
            for (const metrics of report.strategyBreakdown) {
                const pnlSign = metrics.totalPnl >= 0 ? '+' : '';
                Logger.info(
                    `  ${metrics.strategyName}: ${metrics.totalTrades} trades | ` +
                    `Win rate: ${metrics.winRate.toFixed(0)}% | ` +
                    `PnL: ${pnlSign}$${metrics.totalPnl.toFixed(2)} | ` +
                    `Sharpe: ${metrics.sharpeRatio.toFixed(2)}`
                );
            }
        }

        Logger.separator();
    }
}
