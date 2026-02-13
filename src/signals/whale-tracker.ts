import axios from 'axios';
import Logger from '../utils/logger';

/**
 * Whale trade event from on-chain data
 */
export interface WhaleTradeEvent {
    wallet: string;
    tokenId: string;
    side: 'buy' | 'sell';
    sizeUSD: number;
    price: number;
    timestamp: number;
    txHash: string;
}

/**
 * Whale wallet profile
 */
export interface WhaleProfile {
    wallet: string;
    totalVolume: number;
    winRate: number;
    pnl: number;
    tradeCount: number;
    lastActive: number;
}

/**
 * Goldsky GraphQL Whale Tracker
 *
 * 100% FREE — indexed Polygon chain data via Goldsky subgraphs.
 * Tracks large orders, position changes, and wallet PnL.
 *
 * Used by:
 * - copy-whale strategy (primary data source)
 * - Other strategies as supplementary whale sentiment signal
 */
export class WhaleTracker {
    private readonly goldSkyUrl: string =
        'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201fgq5bqj2/subgraphs/polymarket-orderbook-resync/gn';
    private readonly minTradeSize: number = 1000; // Track trades > $1K
    private knownWhales: Map<string, WhaleProfile> = new Map();
    private recentTrades: WhaleTradeEvent[] = [];
    private readonly maxRecentTrades: number = 200;

    /**
     * Fetch recent large trades from Goldsky
     */
    async fetchRecentLargeTrades(sinceTimestamp?: number): Promise<WhaleTradeEvent[]> {
        const since = sinceTimestamp || Math.floor(Date.now() / 1000) - 3600; // Last hour

        const query = `{
            orderFilledEvents(
                first: 100,
                orderBy: timestamp,
                orderDirection: desc,
                where: { timestamp_gt: "${since}" }
            ) {
                id
                maker
                taker
                makerAssetId
                takerAssetId
                makerAmountFilled
                takerAmountFilled
                timestamp
                transactionHash
            }
        }`;

        try {
            const response = await axios.post(
                this.goldSkyUrl,
                { query },
                { timeout: 15000 }
            );

            const events = response.data?.data?.orderFilledEvents;
            if (!events || !Array.isArray(events)) return [];

            const trades: WhaleTradeEvent[] = [];

            for (const event of events) {
                const makerAmount = parseFloat(event.makerAmountFilled || '0') / 1e6;
                const takerAmount = parseFloat(event.takerAmountFilled || '0') / 1e6;
                const sizeUSD = Math.max(makerAmount, takerAmount);

                // Only track large trades
                if (sizeUSD < this.minTradeSize) continue;

                trades.push({
                    wallet: event.maker,
                    tokenId: event.makerAssetId || event.takerAssetId,
                    side: 'buy', // Simplified — would need more context to determine
                    sizeUSD,
                    price: takerAmount > 0 && makerAmount > 0 ? makerAmount / takerAmount : 0,
                    timestamp: parseInt(event.timestamp, 10),
                    txHash: event.transactionHash || '',
                });
            }

            // Update recent trades cache
            this.recentTrades = [...trades, ...this.recentTrades].slice(0, this.maxRecentTrades);

            return trades;
        } catch (error) {
            Logger.warning(`[WhaleTracker] Goldsky query failed: ${error instanceof Error ? error.message : error}`);
            return [];
        }
    }

    /**
     * Get whale activity for a specific token
     */
    async getTokenWhaleActivity(tokenId: string): Promise<WhaleTradeEvent[]> {
        const query = `{
            orderFilledEvents(
                first: 50,
                orderBy: timestamp,
                orderDirection: desc,
                where: {
                    makerAssetId: "${tokenId}"
                }
            ) {
                id
                maker
                taker
                makerAmountFilled
                takerAmountFilled
                timestamp
                transactionHash
            }
        }`;

        try {
            const response = await axios.post(
                this.goldSkyUrl,
                { query },
                { timeout: 15000 }
            );

            const events = response.data?.data?.orderFilledEvents;
            if (!events || !Array.isArray(events)) return [];

            return events
                .map((event: any): WhaleTradeEvent => ({
                    wallet: event.maker,
                    tokenId,
                    side: 'buy',
                    sizeUSD: parseFloat(event.makerAmountFilled || '0') / 1e6,
                    price: 0,
                    timestamp: parseInt(event.timestamp, 10),
                    txHash: event.transactionHash || '',
                }))
                .filter((t: WhaleTradeEvent) => t.sizeUSD >= this.minTradeSize);
        } catch (error) {
            Logger.warning(`[WhaleTracker] Token query failed: ${error instanceof Error ? error.message : error}`);
            return [];
        }
    }

    /**
     * Get whale sentiment for a token (bullish/bearish based on recent large trades)
     */
    getWhaleSentiment(tokenId: string): { sentiment: 'bullish' | 'bearish' | 'neutral'; buyVolume: number; sellVolume: number } {
        const tokenTrades = this.recentTrades.filter((t) => t.tokenId === tokenId);

        const buyVolume = tokenTrades
            .filter((t) => t.side === 'buy')
            .reduce((sum, t) => sum + t.sizeUSD, 0);

        const sellVolume = tokenTrades
            .filter((t) => t.side === 'sell')
            .reduce((sum, t) => sum + t.sizeUSD, 0);

        const total = buyVolume + sellVolume;
        if (total === 0) return { sentiment: 'neutral', buyVolume: 0, sellVolume: 0 };

        const buyRatio = buyVolume / total;

        let sentiment: 'bullish' | 'bearish' | 'neutral';
        if (buyRatio > 0.65) sentiment = 'bullish';
        else if (buyRatio < 0.35) sentiment = 'bearish';
        else sentiment = 'neutral';

        return { sentiment, buyVolume, sellVolume };
    }

    /**
     * Add a known whale profile
     */
    addWhaleProfile(profile: WhaleProfile): void {
        this.knownWhales.set(profile.wallet.toLowerCase(), profile);
    }

    /**
     * Get all known whale profiles
     */
    getWhaleProfiles(): WhaleProfile[] {
        return Array.from(this.knownWhales.values());
    }

    /**
     * Get recent trades
     */
    getRecentTrades(): WhaleTradeEvent[] {
        return [...this.recentTrades];
    }
}
