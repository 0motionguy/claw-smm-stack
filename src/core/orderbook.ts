import { ClobClient } from '@polymarket/clob-client';

/**
 * Order book analysis result
 */
export interface OrderBookAnalysis {
    bestBid: number;
    bestAsk: number;
    spread: number;
    spreadPercent: number;
    midPrice: number;
    bidDepth: number; // Total USD value on bid side
    askDepth: number; // Total USD value on ask side
    imbalance: number; // (bidDepth - askDepth) / (bidDepth + askDepth), range -1 to 1
}

/**
 * Order from CLOB order book
 */
interface Order {
    price: string;
    size: string;
}

/**
 * CLOB order book response
 */
interface OrderBook {
    bids: Order[];
    asks: Order[];
}

/**
 * Analyze order book for a given token
 */
export async function analyzeOrderBook(
    tokenId: string,
    clobClient: ClobClient
): Promise<OrderBookAnalysis> {
    const orderBook = await clobClient.getOrderBook(tokenId);

    const bids = (orderBook.bids || []) as Order[];
    const asks = (orderBook.asks || []) as Order[];

    // Get best bid and ask
    const bestBid = bids.length > 0 ? parseFloat(bids[0]!.price) : 0;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0]!.price) : 0;

    // Calculate spread
    const spread = bestAsk - bestBid;
    const spreadPercent = bestAsk > 0 ? (spread / bestAsk) * 100 : 0;

    // Calculate mid price
    const midPrice = (bestBid + bestAsk) / 2;

    // Calculate depth (total USD value on each side)
    const bidDepth = bids.reduce((sum, order) => {
        const price = parseFloat(order.price);
        const size = parseFloat(order.size);
        return sum + price * size;
    }, 0);

    const askDepth = asks.reduce((sum, order) => {
        const price = parseFloat(order.price);
        const size = parseFloat(order.size);
        return sum + price * size;
    }, 0);

    // Calculate imbalance (-1 to 1, positive means more bid depth)
    const totalDepth = bidDepth + askDepth;
    const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;

    return {
        bestBid,
        bestAsk,
        spread,
        spreadPercent,
        midPrice,
        bidDepth,
        askDepth,
        imbalance,
    };
}

/**
 * Calculate slippage for a market order
 */
export async function calculateSlippage(
    tokenId: string,
    side: 'buy' | 'sell',
    amount: number,
    clobClient: ClobClient
): Promise<number> {
    const orderBook = await clobClient.getOrderBook(tokenId);

    const orders = (side === 'buy' ? orderBook.asks : orderBook.bids) || [];
    if (orders.length === 0) {
        return Infinity; // No liquidity
    }

    const ordersTyped = orders as Order[];
    let remainingAmount = amount;
    let totalCost = 0;
    let totalSize = 0;

    for (const order of ordersTyped) {
        const price = parseFloat(order.price);
        const size = parseFloat(order.size);
        const orderValue = price * size;

        if (remainingAmount <= orderValue) {
            // This order can fill the remaining amount
            const fillSize = remainingAmount / price;
            totalCost += remainingAmount;
            totalSize += fillSize;
            remainingAmount = 0;
            break;
        } else {
            // Take entire order
            totalCost += orderValue;
            totalSize += size;
            remainingAmount -= orderValue;
        }
    }

    if (remainingAmount > 0) {
        // Not enough liquidity to fill the order
        return Infinity;
    }

    // Calculate average execution price
    const avgPrice = totalSize > 0 ? totalCost / totalSize : 0;

    // Get mid price for slippage calculation
    const bids = (orderBook.bids || []) as Order[];
    const asks = (orderBook.asks || []) as Order[];
    const bestBid = bids.length > 0 ? parseFloat(bids[0]!.price) : 0;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0]!.price) : 0;
    const midPrice = (bestBid + bestAsk) / 2;

    if (midPrice === 0) {
        return Infinity;
    }

    // Slippage as percentage from mid price
    const slippage = Math.abs((avgPrice - midPrice) / midPrice) * 100;

    return slippage;
}

/**
 * Check if a market has sufficient liquidity
 */
export async function isLiquid(
    tokenId: string,
    minDepthUSD: number,
    clobClient: ClobClient
): Promise<boolean> {
    const analysis = await analyzeOrderBook(tokenId, clobClient);
    const totalDepth = analysis.bidDepth + analysis.askDepth;
    return totalDepth >= minDepthUSD;
}
