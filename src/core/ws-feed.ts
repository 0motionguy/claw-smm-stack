import WebSocket from 'ws';
import { EventEmitter } from 'events';
import Logger from '../utils/logger';
import { ENV } from '../config/env';

/**
 * Price update event
 */
export interface PriceUpdate {
    tokenId: string;
    price: number;
    timestamp: number;
}

/**
 * WebSocket price feed - subscribes to real-time price updates
 * Endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/market
 * Falls back to polling if WebSocket fails
 */
export class WebSocketFeed extends EventEmitter {
    private ws: WebSocket | null = null;
    private readonly wsUrl: string;
    private subscribedTokens: Set<string> = new Set();
    private reconnectAttempts: number = 0;
    private readonly maxReconnectAttempts: number = 10;
    private readonly baseReconnectDelay: number = 1000; // 1 second
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private isConnected: boolean = false;
    private isStopped: boolean = false;

    constructor(wsUrl?: string) {
        super();
        this.wsUrl = wsUrl || ENV.CLOB_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
    }

    /**
     * Connect to WebSocket feed
     */
    connect(): void {
        if (this.isStopped) return;

        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.on('open', () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                Logger.success('[WS] Connected to price feed');

                // Resubscribe to all tokens
                for (const tokenId of this.subscribedTokens) {
                    this.sendSubscribe(tokenId);
                }

                // Start ping to keep connection alive
                this.startPing();
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message);
                } catch {
                    // Ignore malformed messages
                }
            });

            this.ws.on('close', (code: number) => {
                this.isConnected = false;
                this.stopPing();
                Logger.warning(`[WS] Connection closed (code: ${code})`);
                this.scheduleReconnect();
            });

            this.ws.on('error', (error: Error) => {
                Logger.error(`[WS] Error: ${error.message}`);
                // Will trigger close event, which handles reconnection
            });
        } catch (error) {
            Logger.error(`[WS] Failed to create connection: ${error}`);
            this.scheduleReconnect();
        }
    }

    /**
     * Subscribe to price updates for a token
     */
    subscribe(tokenId: string): void {
        this.subscribedTokens.add(tokenId);
        if (this.isConnected) {
            this.sendSubscribe(tokenId);
        }
    }

    /**
     * Subscribe to multiple tokens
     */
    subscribeMany(tokenIds: string[]): void {
        for (const tokenId of tokenIds) {
            this.subscribe(tokenId);
        }
    }

    /**
     * Unsubscribe from a token
     */
    unsubscribe(tokenId: string): void {
        this.subscribedTokens.delete(tokenId);
        if (this.isConnected && this.ws) {
            this.ws.send(JSON.stringify({
                type: 'unsubscribe',
                assets_ids: [tokenId],
            }));
        }
    }

    /**
     * Disconnect and clean up
     */
    disconnect(): void {
        this.isStopped = true;
        this.stopPing();

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
        Logger.info('[WS] Disconnected from price feed');
    }

    /**
     * Get connection status
     */
    getStatus(): { connected: boolean; subscribedTokens: number; reconnectAttempts: number } {
        return {
            connected: this.isConnected,
            subscribedTokens: this.subscribedTokens.size,
            reconnectAttempts: this.reconnectAttempts,
        };
    }

    /**
     * Send subscribe message to WebSocket
     */
    private sendSubscribe(tokenId: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: 'subscribe',
            assets_ids: [tokenId],
        }));
    }

    /**
     * Handle incoming WebSocket message
     */
    private handleMessage(message: any): void {
        // Polymarket WS sends price updates in various formats
        // Handle book/price change events
        if (message.event_type === 'price_change' || message.type === 'price_change') {
            const update: PriceUpdate = {
                tokenId: message.asset_id || message.token_id || '',
                price: parseFloat(message.price || '0'),
                timestamp: Date.now(),
            };

            if (update.tokenId && update.price > 0) {
                this.emit('price', update);
            }
        }

        // Handle book updates (bid/ask changes)
        if (message.event_type === 'book' || message.type === 'book') {
            this.emit('book', message);
        }

        // Handle trade events
        if (message.event_type === 'trade' || message.type === 'last_trade_price') {
            const update: PriceUpdate = {
                tokenId: message.asset_id || message.token_id || '',
                price: parseFloat(message.price || message.last_trade_price || '0'),
                timestamp: Date.now(),
            };

            if (update.tokenId && update.price > 0) {
                this.emit('trade', update);
                this.emit('price', update); // Also emit as price update
            }
        }
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    private scheduleReconnect(): void {
        if (this.isStopped) return;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            Logger.error(`[WS] Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
            this.emit('disconnected');
            return;
        }

        const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
        const jitter = Math.random() * 1000;
        const totalDelay = delay + jitter;

        this.reconnectAttempts++;
        Logger.info(`[WS] Reconnecting in ${(totalDelay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, totalDelay);
    }

    /**
     * Start ping interval to keep connection alive
     */
    private startPing(): void {
        this.stopPing();
        this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30000); // Ping every 30 seconds
    }

    /**
     * Stop ping interval
     */
    private stopPing(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }
}
