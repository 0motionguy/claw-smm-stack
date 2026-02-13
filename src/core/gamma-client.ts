import axios, { AxiosInstance } from 'axios';
import Logger from '../utils/logger';

/**
 * Market data from Gamma API
 */
export interface GammaMarket {
    id: string;
    question: string;
    conditionId: string;
    slug: string;
    resolutionSource: string;
    endDate: string;
    liquidity: string;
    volume: string;
    clobTokenIds: string[];
    outcomePrices: string; // JSON array like "[0.55, 0.45]"
    outcomes: string; // JSON array like '["Yes","No"]'
    active: boolean;
    closed: boolean;
    marketType?: string;
    description?: string;
}

/**
 * Filters for querying markets
 */
export interface MarketFilters {
    closed?: boolean;
    active?: boolean;
    limit?: number;
    offset?: number;
    order?: 'volume' | 'liquidity';
    ascending?: boolean;
}

/**
 * Cached market data
 */
interface CachedMarket {
    data: GammaMarket | GammaMarket[];
    timestamp: number;
}

/**
 * Gamma API client - FREE market discovery API (no auth required)
 * Endpoint: https://gamma-api.polymarket.com
 */
export class GammaClient {
    private readonly baseUrl: string = 'https://gamma-api.polymarket.com';
    private readonly client: AxiosInstance;
    private readonly cache: Map<string, CachedMarket> = new Map();
    private readonly cacheTtlMs: number = 5000; // 5 seconds
    private requestTimestamps: number[] = [];
    private readonly rateLimit: number = 100; // requests per minute
    private readonly rateLimitWindow: number = 60000; // 1 minute in ms

    constructor() {
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'User-Agent': 'PolyClaw-Pro/1.0',
            },
        });
    }

    /**
     * Simple rate limiter - delays if approaching 100 req/min
     */
    private async enforceRateLimit(): Promise<void> {
        const now = Date.now();
        // Remove timestamps older than 1 minute
        this.requestTimestamps = this.requestTimestamps.filter(
            (ts) => now - ts < this.rateLimitWindow
        );

        if (this.requestTimestamps.length >= this.rateLimit - 5) {
            const oldestTimestamp = this.requestTimestamps[0]!;
            const timeToWait = this.rateLimitWindow - (now - oldestTimestamp) + 100;
            if (timeToWait > 0) {
                Logger.warning(`Rate limit approaching, waiting ${timeToWait}ms...`);
                await new Promise((resolve) => setTimeout(resolve, timeToWait));
            }
        }

        this.requestTimestamps.push(Date.now());
    }

    /**
     * Get cache key for market queries
     */
    private getCacheKey(endpoint: string, params?: Record<string, any>): string {
        const paramStr = params ? JSON.stringify(params) : '';
        return `${endpoint}:${paramStr}`;
    }

    /**
     * Get from cache if available and not expired
     */
    private getFromCache<T>(key: string): T | null {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }

        const age = Date.now() - cached.timestamp;
        if (age > this.cacheTtlMs) {
            this.cache.delete(key);
            return null;
        }

        return cached.data as T;
    }

    /**
     * Store in cache
     */
    private setCache(key: string, data: GammaMarket | GammaMarket[]): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
        });
    }

    /**
     * Get list of markets with optional filters
     */
    async getMarkets(filters?: MarketFilters): Promise<GammaMarket[]> {
        const cacheKey = this.getCacheKey('markets', filters);
        const cached = this.getFromCache<GammaMarket[]>(cacheKey);
        if (cached) {
            return cached;
        }

        await this.enforceRateLimit();

        const params: Record<string, any> = {};
        if (filters?.closed !== undefined) params.closed = filters.closed;
        if (filters?.active !== undefined) params.active = filters.active;
        if (filters?.limit) params.limit = filters.limit;
        if (filters?.offset) params.offset = filters.offset;
        if (filters?.order) params.order = filters.order;
        if (filters?.ascending !== undefined) params.ascending = filters.ascending;

        const response = await this.client.get<GammaMarket[]>('/markets', { params });
        this.setCache(cacheKey, response.data);
        return response.data;
    }

    /**
     * Get single market by ID
     */
    async getMarket(id: string): Promise<GammaMarket> {
        const cacheKey = this.getCacheKey(`market:${id}`);
        const cached = this.getFromCache<GammaMarket>(cacheKey);
        if (cached) {
            return cached;
        }

        await this.enforceRateLimit();

        const response = await this.client.get<GammaMarket>(`/markets/${id}`);
        this.setCache(cacheKey, response.data);
        return response.data;
    }

    /**
     * Get active markets (shorthand)
     */
    async getActiveMarkets(limit?: number): Promise<GammaMarket[]> {
        return this.getMarkets({ active: true, closed: false, limit });
    }

    /**
     * Get markets ending within specified hours (for high-prob bonds strategy)
     */
    async getMarketsByEndDate(maxHoursFromNow: number): Promise<GammaMarket[]> {
        const allMarkets = await this.getActiveMarkets();
        const now = Date.now();
        const maxEndTime = now + maxHoursFromNow * 60 * 60 * 1000;

        return allMarkets.filter((market) => {
            const endTime = new Date(market.endDate).getTime();
            return endTime <= maxEndTime && endTime > now;
        });
    }

    /**
     * Get newly created markets (for liquidity-snipe strategy)
     */
    async getNewMarkets(maxHoursOld: number): Promise<GammaMarket[]> {
        const allMarkets = await this.getActiveMarkets();
        const now = Date.now();
        const minCreationTime = now - maxHoursOld * 60 * 60 * 1000;

        // Note: Gamma API doesn't expose creation time, so we filter by low volume as proxy
        // Markets with volume < $1000 are likely newly created
        return allMarkets.filter((market) => {
            const volume = parseFloat(market.volume);
            return volume < 1000;
        });
    }

    /**
     * Parse outcome prices from string to array
     */
    parseOutcomePrices(market: GammaMarket): number[] {
        try {
            return JSON.parse(market.outcomePrices);
        } catch {
            return [];
        }
    }

    /**
     * Parse outcomes from string to array
     */
    parseOutcomes(market: GammaMarket): string[] {
        try {
            return JSON.parse(market.outcomes);
        } catch {
            return [];
        }
    }

    /**
     * Clear cache (useful for testing)
     */
    clearCache(): void {
        this.cache.clear();
    }
}
