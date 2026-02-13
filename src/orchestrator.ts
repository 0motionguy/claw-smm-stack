import { ClobClient } from '@polymarket/clob-client';
import * as fs from 'fs';
import * as path from 'path';
import Logger from './utils/logger';

// Core
import { GammaClient } from './core/gamma-client';
import { PaperEngine } from './core/paper-engine';
import { WebSocketFeed } from './core/ws-feed';

// Execution
import { RiskManager } from './execution/risk-manager';
import { GasOptimizer } from './execution/gas-optimizer';
import { Executor } from './execution/executor';

// Strategies
import { BaseStrategy, StrategySignal } from './strategies/base-strategy';
import { HighProbBondsStrategy } from './strategies/high-prob-bonds';
import { NegRiskArbStrategy } from './strategies/negrisk-arb';
import { SpreadCaptureStrategy } from './strategies/spread-capture';
import { WeatherEdgeStrategy } from './strategies/weather-edge';
import { CopyWhaleStrategy } from './strategies/copy-whale';
import { NewsCatalystStrategy } from './strategies/news-catalyst';
import { LiquiditySnipeStrategy } from './strategies/liquidity-snipe';
import { CryptoMomentumStrategy } from './strategies/crypto-momentum';
import { CrossPlatformStrategy } from './strategies/cross-platform';
import { DisputeEdgeStrategy } from './strategies/dispute-edge';
import { BinanceLagStrategy } from './strategies/binance-lag';
import { CombinatorialArbStrategy } from './strategies/combinatorial-arb';

// Signals
import { NewsFeed } from './signals/news-feed';
import { BinanceFeed } from './signals/binance-feed';

/**
 * Strategy orchestrator config (loaded from strategies.json)
 */
interface OrchestratorConfig {
    paperMode: boolean;
    initialBankroll: number;
    reportIntervalMinutes: number;
    strategies: Record<string, any>;
    risk: any;
    execution: any;
    gas: any;
    whaleWallets: string[];
    whaleBaskets?: any[];
    tomorrowApiKey: string;
}

/**
 * Strategy Orchestrator v2
 *
 * Manages all 12 trading strategies, schedules scans, routes signals
 * through risk management, and executes via paper or live engine.
 *
 * v2 additions:
 * - BinanceFeed for real-time spot prices
 * - Dedicated 2-second scan loop for binance-lag strategy
 * - BinanceLagStrategy + CombinatorialArbStrategy
 */
export class Orchestrator {
    private readonly config: OrchestratorConfig;
    private readonly gamma: GammaClient;
    private readonly paperEngine: PaperEngine;
    private readonly riskManager: RiskManager;
    private readonly gasOptimizer: GasOptimizer;
    private readonly executor: Executor;
    private readonly wsFeed: WebSocketFeed;
    private readonly newsFeed: NewsFeed;
    private readonly binanceFeed: BinanceFeed;
    private readonly strategies: BaseStrategy[] = [];
    private readonly clobClient: ClobClient;

    // Binance lag strategy reference (for dedicated 2s loop)
    private binanceLagStrategy: BinanceLagStrategy | null = null;

    private scanInterval: ReturnType<typeof setInterval> | null = null;
    private lagScanInterval: ReturnType<typeof setInterval> | null = null;
    private reportInterval: ReturnType<typeof setInterval> | null = null;
    private dailyResetInterval: ReturnType<typeof setInterval> | null = null;
    private isRunning: boolean = false;

    constructor(clobClient: ClobClient, configPath?: string) {
        this.clobClient = clobClient;

        // Load config
        const cfgPath = configPath || path.join(__dirname, 'config', 'strategies.json');
        this.config = this.loadConfig(cfgPath);

        // Initialize core components
        this.gamma = new GammaClient();
        this.paperEngine = new PaperEngine(this.config.initialBankroll);
        this.riskManager = new RiskManager(
            this.paperEngine.getPortfolio(),
            this.config.risk
        );
        this.gasOptimizer = new GasOptimizer(this.config.gas);
        this.executor = new Executor(clobClient, this.config.execution);
        this.wsFeed = new WebSocketFeed();
        this.newsFeed = new NewsFeed();

        // Initialize Binance feed with crypto symbols
        const lagConfig = this.config.strategies['binance-lag'];
        const symbols = lagConfig?.symbols || ['btcusdt', 'ethusdt', 'solusdt'];
        this.binanceFeed = new BinanceFeed(symbols);

        // Initialize strategies
        this.initStrategies();
    }

    /**
     * Start the orchestrator
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            Logger.warning('[Orchestrator] Already running');
            return;
        }

        this.isRunning = true;

        // Safety check for live mode
        if (!this.config.paperMode && !process.env.LIVE_TRADING_CONFIRMED) {
            Logger.error('[Orchestrator] LIVE MODE requires LIVE_TRADING_CONFIRMED=true env var');
            Logger.error('[Orchestrator] This prevents accidental live trading. Set paperMode: true or export LIVE_TRADING_CONFIRMED=true');
            return;
        }

        Logger.header('POLYCLAW PRO v2 — STRATEGY ORCHESTRATOR');
        Logger.info(`Mode: ${this.config.paperMode ? 'PAPER' : 'LIVE'}`);
        Logger.info(`Initial Bankroll: $${this.config.initialBankroll}`);
        Logger.info(`Active Strategies: ${this.strategies.filter((s) => s.getConfig().enabled).length}/${this.strategies.length}`);
        Logger.separator();

        // Log enabled strategies
        for (const strategy of this.strategies) {
            const status = strategy.getConfig().enabled ? 'ENABLED' : 'disabled';
            Logger.info(`  ${strategy.name}: ${status} — ${strategy.getDescription()}`);
        }

        Logger.separator();

        // Connect WebSocket feeds
        this.wsFeed.connect();
        this.binanceFeed.connect();
        Logger.info('[Orchestrator] Binance feed connected — tracking spot prices');

        // Load economic calendar
        await this.newsFeed.fetchEconomicCalendar();

        // Start main scan loop (10 seconds — for all strategies except binance-lag)
        this.scanInterval = setInterval(() => {
            this.runScanCycle().catch((err) => {
                Logger.error(`[Orchestrator] Scan cycle error: ${err}`);
            });
        }, 10000);

        // Start dedicated 2-second scan loop for binance-lag (high-frequency)
        if (this.binanceLagStrategy && this.binanceLagStrategy.getConfig().enabled) {
            this.lagScanInterval = setInterval(() => {
                this.runLagScanCycle().catch((err) => {
                    Logger.error(`[Orchestrator] Lag scan error: ${err}`);
                });
            }, 2000);
            Logger.info('[Orchestrator] Binance lag scanner active — 2s interval');
        }

        // Start report interval
        this.reportInterval = setInterval(() => {
            this.paperEngine.logReport();
        }, this.config.reportIntervalMinutes * 60 * 1000);

        // Daily reset at midnight UTC
        this.scheduleDailyReset();

        // Run first scan immediately
        await this.runScanCycle();

        Logger.success('[Orchestrator] Started successfully — 12 strategies active');
    }

    /**
     * Stop the orchestrator
     */
    stop(): void {
        this.isRunning = false;

        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
        if (this.lagScanInterval) {
            clearInterval(this.lagScanInterval);
            this.lagScanInterval = null;
        }
        if (this.reportInterval) {
            clearInterval(this.reportInterval);
            this.reportInterval = null;
        }
        if (this.dailyResetInterval) {
            clearInterval(this.dailyResetInterval);
            this.dailyResetInterval = null;
        }

        this.wsFeed.disconnect();
        this.binanceFeed.disconnect();
        this.gasOptimizer.destroy();

        // Final report
        this.paperEngine.logReport();

        Logger.info('[Orchestrator] Stopped');
    }

    /**
     * Run one scan cycle across all strategies (except binance-lag which has its own loop)
     */
    private async runScanCycle(): Promise<void> {
        const allSignals: StrategySignal[] = [];

        // Run each strategy's analyze() in parallel (skip binance-lag — it has its own loop)
        const results = await Promise.allSettled(
            this.strategies
                .filter((s) =>
                    s.getConfig().enabled &&
                    s.canTrade() &&
                    s.shouldScan() &&
                    s.name !== 'binance-lag'
                )
                .map((strategy) =>
                    strategy.analyze().then((signals) => ({ strategy, signals }))
                )
        );

        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.signals.length > 0) {
                allSignals.push(...result.value.signals);
            } else if (result.status === 'rejected') {
                Logger.error(`[Orchestrator] Strategy error: ${result.reason}`);
            }
        }

        if (allSignals.length === 0) return;

        // Sort signals by confidence (highest first)
        allSignals.sort((a, b) => b.confidence - a.confidence);

        Logger.info(`[Orchestrator] Processing ${allSignals.length} signal(s)`);

        // Process each signal through risk management
        for (const signal of allSignals) {
            await this.processSignal(signal);
        }
    }

    /**
     * Dedicated 2-second scan loop for binance-lag strategy
     * Separate from main loop because lag exploit requires low latency
     */
    private async runLagScanCycle(): Promise<void> {
        if (!this.binanceLagStrategy || !this.binanceLagStrategy.getConfig().enabled) {
            return;
        }

        if (!this.binanceLagStrategy.canTrade() || !this.binanceLagStrategy.shouldScan()) {
            return;
        }

        try {
            const signals = await this.binanceLagStrategy.analyze();

            for (const signal of signals) {
                await this.processSignal(signal);
            }
        } catch (error) {
            Logger.error(`[Orchestrator] Lag scan error: ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * Process a single trading signal
     */
    private async processSignal(signal: StrategySignal): Promise<void> {
        // Step 1: Risk check
        const riskCheck = this.riskManager.checkTrade(signal);
        if (!riskCheck.allowed) {
            Logger.warning(`[Risk] Blocked ${signal.strategyName}: ${riskCheck.reason}`);
            return;
        }

        // Step 2: Gas optimization check
        if (!this.gasOptimizer.isGasEfficient(signal.amountUSD)) {
            Logger.warning(`[Gas] Trade too small: $${signal.amountUSD.toFixed(2)}`);
            return;
        }

        // Step 3: Execute
        if (this.config.paperMode) {
            // Paper mode — simulate
            const trade = this.paperEngine.executeTrade(signal);
            if (trade) {
                this.riskManager.trackPosition(signal.marketId, signal.marketQuestion);
                const strategy = this.strategies.find((s) => s.name === signal.strategyName);
                if (strategy) {
                    strategy.recordTrade();
                }
            }
        } else {
            // Live mode — real CLOB execution
            if (!process.env.LIVE_TRADING_CONFIRMED) {
                Logger.error('[Orchestrator] LIVE_TRADING_CONFIRMED env var not set — refusing to trade. Set LIVE_TRADING_CONFIRMED=true to enable.');
                return;
            }

            const result = signal.strategyName === 'binance-lag'
                ? await this.executor.executeFAK(signal)
                : await this.executor.execute(signal);

            if (result.success) {
                this.riskManager.trackPosition(signal.marketId, signal.marketQuestion);
                const strategy = this.strategies.find((s) => s.name === signal.strategyName);
                if (strategy) {
                    strategy.recordTrade();
                }
                Logger.success(
                    `[Live] ${signal.action.toUpperCase()} | ${signal.strategyName} | ` +
                    `$${result.fillAmountUSD?.toFixed(2)} @ ${result.fillPrice?.toFixed(4)} | ` +
                    `${signal.marketQuestion.slice(0, 45)}...`
                );
            } else {
                Logger.warning(`[Live] Order failed: ${result.error}`);
            }
        }
    }

    /**
     * Initialize all 12 strategies
     */
    private initStrategies(): void {
        const portfolio = this.paperEngine.getPortfolio();
        const cfg = this.config.strategies;

        // v1 strategies (10)
        this.strategies.push(
            new HighProbBondsStrategy(this.gamma, portfolio, cfg['high-prob-bonds']),
            new NegRiskArbStrategy(this.gamma, portfolio, cfg['negrisk-arb']),
            new SpreadCaptureStrategy(this.gamma, this.clobClient, portfolio, cfg['spread-capture']),
            new WeatherEdgeStrategy(this.gamma, portfolio, this.config.tomorrowApiKey, cfg['weather-edge']),
            new CopyWhaleStrategy(this.gamma, portfolio, this.config.whaleWallets, cfg['copy-whale']),
            new NewsCatalystStrategy(this.gamma, portfolio, cfg['news-catalyst']),
            new LiquiditySnipeStrategy(this.gamma, this.clobClient, portfolio, cfg['liquidity-snipe']),
            new CryptoMomentumStrategy(this.gamma, portfolio, cfg['crypto-momentum']),
            new CrossPlatformStrategy(this.gamma, portfolio, cfg['cross-platform']),
            new DisputeEdgeStrategy(this.gamma, portfolio, cfg['dispute-edge'])
        );

        // v2 strategies (2) — highest alpha
        this.binanceLagStrategy = new BinanceLagStrategy(
            this.gamma,
            portfolio,
            this.binanceFeed,
            cfg['binance-lag']
        );
        this.strategies.push(this.binanceLagStrategy);

        this.strategies.push(
            new CombinatorialArbStrategy(this.gamma, portfolio, cfg['combinatorial-arb'])
        );
    }

    /**
     * Load config from JSON file
     */
    private loadConfig(configPath: string): OrchestratorConfig {
        try {
            const raw = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(raw);
            Logger.info(`[Orchestrator] Loaded config from ${configPath}`);
            return config;
        } catch {
            Logger.warning('[Orchestrator] Config not found, using defaults');
            return {
                paperMode: true,
                initialBankroll: 1000,
                reportIntervalMinutes: 60,
                strategies: {},
                risk: {},
                execution: {},
                gas: {},
                whaleWallets: [],
                whaleBaskets: [],
                tomorrowApiKey: '',
            };
        }
    }

    /**
     * Schedule daily strategy reset at midnight UTC
     */
    private scheduleDailyReset(): void {
        const now = new Date();
        const midnight = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1,
            0, 0, 0, 0
        ));
        const msUntilMidnight = midnight.getTime() - now.getTime();

        setTimeout(() => {
            this.resetDaily();
            // Then repeat every 24 hours
            this.dailyResetInterval = setInterval(() => {
                this.resetDaily();
            }, 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
    }

    /**
     * Reset daily counters for all strategies
     */
    private resetDaily(): void {
        Logger.info('[Orchestrator] Daily reset — resetting all strategy counters');
        for (const strategy of this.strategies) {
            strategy.resetDaily();
        }
    }

    /**
     * Get current status of all strategies
     */
    getStatus(): any {
        return {
            running: this.isRunning,
            mode: this.config.paperMode ? 'paper' : 'live',
            portfolio: {
                totalValue: this.paperEngine.getPortfolio().getTotalValue(),
                bankroll: this.paperEngine.getPortfolio().getBankroll(),
                drawdown: this.paperEngine.getPortfolio().getDrawdown(),
                openPositions: this.paperEngine.getPositions().length,
            },
            strategies: this.strategies.map((s) => s.getStatus()),
            risk: this.riskManager.getStatus(),
            gas: this.gasOptimizer.getStatus(),
            wsFeed: this.wsFeed.getStatus(),
            binanceFeed: this.binanceFeed.getStatus(),
        };
    }
}

/**
 * Start the orchestrator in paper mode
 * Usage: npx ts-node src/orchestrator.ts
 */
if (require.main === module) {
    (async () => {
        try {
            // Import createClobClient from existing codebase
            const { default: createClobClient } = await import('./utils/createClobClient');
            const clobClient = await createClobClient();

            const orchestrator = new Orchestrator(clobClient);
            await orchestrator.start();

            // Graceful shutdown
            const shutdown = () => {
                Logger.info('Shutting down orchestrator...');
                orchestrator.stop();
                process.exit(0);
            };

            process.on('SIGTERM', shutdown);
            process.on('SIGINT', shutdown);
        } catch (error) {
            Logger.error(`Failed to start orchestrator: ${error}`);
            process.exit(1);
        }
    })();
}
