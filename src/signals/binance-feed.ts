import WebSocket from 'ws';
import { EventEmitter } from 'events';
import Logger from '../utils/logger';

/**
 * Real-time Binance spot price data
 */
export interface BinancePrice {
    symbol: string;         // e.g., 'BTCUSDT'
    price: number;          // current spot price
    timestamp: number;      // exchange timestamp
    localTimestamp: number;  // local receipt time
}

/**
 * Threshold configuration for crossing detection
 */
export interface ThresholdConfig {
    symbol: string;      // e.g., 'BTCUSDT'
    threshold: number;   // e.g., 100000 for BTC $100K
    direction: 'above' | 'below';
}

/**
 * Price threshold crossing event — emitted when price crosses and stays
 */
export interface PriceThresholdCrossing {
    symbol: string;
    threshold: number;
    direction: 'above' | 'below';
    currentPrice: number;
    confirmedAt: number;      // when crossing was confirmed (after hold period)
    distancePercent: number;  // how far past threshold (e.g., 0.5% past)
}

/**
 * Binance WebSocket Feed
 *
 * Real-time spot price feed from Binance via combined streams.
 * Foundation for the Binance-Polymarket lag exploit strategy.
 *
 * Connects to: wss://stream.binance.com:9443/stream
 * Uses single connection with combined streams (limit: 5 connections/IP).
 * Latency: ~50ms from Binance exchange to local.
 *
 * Events:
 * - 'price' (BinancePrice) — every trade update
 * - 'threshold_crossed' (PriceThresholdCrossing) — confirmed threshold crossing
 */
export class BinanceFeed extends EventEmitter {
    private ws: WebSocket | null = null;
    private readonly symbols: string[];
    private readonly prices: Map<string, BinancePrice> = new Map();
    private readonly baseUrl: string = 'wss://stream.binance.com:9443/stream';

    // Threshold crossing tracking
    private thresholds: ThresholdConfig[] = [];
    private pendingCrossings: Map<string, { crossedAt: number; price: number; config: ThresholdConfig }> = new Map();
    private confirmedCrossings: Set<string> = new Set(); // Avoid re-emitting
    private readonly confirmationWindowMs: number;

    // Connection management
    private reconnectAttempts: number = 0;
    private readonly maxReconnectAttempts: number = 15;
    private readonly baseReconnectDelay: number = 1000;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private thresholdCheckTimer: ReturnType<typeof setInterval> | null = null;
    private isConnected: boolean = false;
    private isStopped: boolean = false;

    constructor(
        symbols: string[] = ['btcusdt', 'ethusdt', 'solusdt', 'dogeusdt', 'maticusdt'],
        confirmationWindowMs: number = 5000
    ) {
        super();
        this.symbols = symbols.map((s) => s.toLowerCase());
        this.confirmationWindowMs = confirmationWindowMs;
    }

    /**
     * Connect to Binance combined streams
     */
    connect(): void {
        if (this.isStopped) return;

        const streams = this.symbols.map((s) => `${s}@trade`).join('/');
        const wsUrl = `${this.baseUrl}?streams=${streams}`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                Logger.success(`[Binance] Connected — tracking ${this.symbols.length} symbol(s)`);
                this.startPing();
                this.startThresholdChecker();
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.handleMessage(msg);
                } catch {
                    // Ignore malformed
                }
            });

            this.ws.on('close', (code: number) => {
                this.isConnected = false;
                this.stopPing();
                this.stopThresholdChecker();
                Logger.warning(`[Binance] Connection closed (code: ${code})`);
                this.scheduleReconnect();
            });

            this.ws.on('error', (error: Error) => {
                Logger.error(`[Binance] Error: ${error.message}`);
            });
        } catch (error) {
            Logger.error(`[Binance] Failed to connect: ${error}`);
            this.scheduleReconnect();
        }
    }

    /**
     * Disconnect and clean up
     */
    disconnect(): void {
        this.isStopped = true;
        this.stopPing();
        this.stopThresholdChecker();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.removeAllListeners();
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            this.ws = null;
        }

        this.isConnected = false;
        Logger.info('[Binance] Disconnected');
    }

    /**
     * Get latest price for a symbol
     */
    getPrice(symbol: string): BinancePrice | null {
        return this.prices.get(symbol.toLowerCase()) || null;
    }

    /**
     * Get all tracked prices
     */
    getAllPrices(): Map<string, BinancePrice> {
        return new Map(this.prices);
    }

    /**
     * Set thresholds to monitor for crossing events
     */
    setThresholds(thresholds: ThresholdConfig[]): void {
        this.thresholds = thresholds;
        this.pendingCrossings.clear();
        this.confirmedCrossings.clear();
    }

    /**
     * Add a single threshold to monitor
     */
    addThreshold(config: ThresholdConfig): void {
        this.thresholds.push(config);
    }

    /**
     * Clear all thresholds
     */
    clearThresholds(): void {
        this.thresholds = [];
        this.pendingCrossings.clear();
        this.confirmedCrossings.clear();
    }

    /**
     * Check thresholds against current prices (called on timer)
     */
    checkThresholdCrossings(): PriceThresholdCrossing[] {
        const crossings: PriceThresholdCrossing[] = [];
        const now = Date.now();

        for (const config of this.thresholds) {
            const key = `${config.symbol}:${config.threshold}:${config.direction}`;

            // Skip already confirmed crossings
            if (this.confirmedCrossings.has(key)) continue;

            const priceData = this.prices.get(config.symbol.toLowerCase());
            if (!priceData) continue;

            const isCrossed =
                config.direction === 'above'
                    ? priceData.price > config.threshold
                    : priceData.price < config.threshold;

            if (isCrossed) {
                const pending = this.pendingCrossings.get(key);

                if (!pending) {
                    // Start tracking this crossing
                    this.pendingCrossings.set(key, {
                        crossedAt: now,
                        price: priceData.price,
                        config,
                    });
                } else if (now - pending.crossedAt >= this.confirmationWindowMs) {
                    // Crossing confirmed — price held for confirmation window
                    const distancePercent = Math.abs(
                        (priceData.price - config.threshold) / config.threshold
                    ) * 100;

                    const crossing: PriceThresholdCrossing = {
                        symbol: config.symbol,
                        threshold: config.threshold,
                        direction: config.direction,
                        currentPrice: priceData.price,
                        confirmedAt: now,
                        distancePercent,
                    };

                    crossings.push(crossing);
                    this.confirmedCrossings.add(key);
                    this.pendingCrossings.delete(key);

                    this.emit('threshold_crossed', crossing);

                    Logger.success(
                        `[Binance] THRESHOLD CROSSED: ${config.symbol} ${config.direction} $${config.threshold.toLocaleString()} | ` +
                        `Current: $${priceData.price.toLocaleString()} (${distancePercent.toFixed(2)}% past)`
                    );
                }
            } else {
                // Price reverted — remove pending crossing
                this.pendingCrossings.delete(key);
            }
        }

        return crossings;
    }

    /**
     * Get connection status
     */
    getStatus(): {
        connected: boolean;
        trackedSymbols: number;
        activeThresholds: number;
        confirmedCrossings: number;
        reconnectAttempts: number;
        lastPrices: Record<string, number>;
    } {
        const lastPrices: Record<string, number> = {};
        for (const [symbol, data] of this.prices) {
            lastPrices[symbol] = data.price;
        }

        return {
            connected: this.isConnected,
            trackedSymbols: this.symbols.length,
            activeThresholds: this.thresholds.length,
            confirmedCrossings: this.confirmedCrossings.size,
            reconnectAttempts: this.reconnectAttempts,
            lastPrices,
        };
    }

    /**
     * Handle incoming Binance WebSocket message
     */
    private handleMessage(msg: any): void {
        // Combined stream format: { stream: "btcusdt@trade", data: { ... } }
        const data = msg.data || msg;
        if (!data || data.e !== 'trade') return;

        const symbol = (data.s || '').toLowerCase(); // e.g., 'btcusdt'
        const price = parseFloat(data.p || '0');
        const timestamp = data.T || Date.now();

        if (!symbol || price <= 0) return;

        const binancePrice: BinancePrice = {
            symbol,
            price,
            timestamp,
            localTimestamp: Date.now(),
        };

        this.prices.set(symbol, binancePrice);
        this.emit('price', binancePrice);
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    private scheduleReconnect(): void {
        if (this.isStopped) return;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            Logger.error(`[Binance] Max reconnect attempts reached. Giving up.`);
            this.emit('disconnected');
            return;
        }

        const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
        const jitter = Math.random() * 1000;
        const totalDelay = delay + jitter;

        this.reconnectAttempts++;
        Logger.info(
            `[Binance] Reconnecting in ${(totalDelay / 1000).toFixed(1)}s ` +
            `(attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        );

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, totalDelay);
    }

    /**
     * Start ping keepalive
     */
    private startPing(): void {
        this.stopPing();
        this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30000);
    }

    private stopPing(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    /**
     * Start threshold checking on 100ms interval
     */
    private startThresholdChecker(): void {
        this.stopThresholdChecker();
        this.thresholdCheckTimer = setInterval(() => {
            if (this.thresholds.length > 0) {
                this.checkThresholdCrossings();
            }
        }, 100); // Check every 100ms for low latency
    }

    private stopThresholdChecker(): void {
        if (this.thresholdCheckTimer) {
            clearInterval(this.thresholdCheckTimer);
            this.thresholdCheckTimer = null;
        }
    }
}
