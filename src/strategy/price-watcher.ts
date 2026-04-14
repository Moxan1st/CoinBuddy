/**
 * Price Watcher — Multi-source price polling with fallback
 *
 * Architecture: PriceSource abstraction with priority-ordered sources.
 * On each tick, try sources in order until one succeeds.
 */

import type { PriceData, PriceSource } from "./types"
import { PRICE_POLL_INTERVAL_MS } from "./config"
import { createLogger } from "~lib/logger"

// ─── Price Source: Binance (primary — free, no key, high reliability) ───

const BinanceSource: PriceSource = {
  name: "binance",
  async fetchPrice(symbol: string): Promise<PriceData> {
    // Binance uses pairs like BTCUSDT
    const pair = `${symbol.toUpperCase()}USDT`
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`)
    const data = await res.json()
    const price = parseFloat(data.price)
    if (!price || isNaN(price)) throw new Error("Binance returned invalid price")
    return {
      symbol: symbol.toUpperCase(),
      priceUsd: price,
      timestamp: Date.now(),
      source: "binance",
    }
  },
}

// ─── Price Source: CoinGecko (backup — free tier, rate limited) ───

const COINGECKO_ID_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  WBTC: "wrapped-bitcoin",
}

const CoinGeckoSource: PriceSource = {
  name: "coingecko",
  async fetchPrice(symbol: string): Promise<PriceData> {
    const id = COINGECKO_ID_MAP[symbol.toUpperCase()]
    if (!id) throw new Error(`CoinGecko: unknown symbol ${symbol}`)
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    const data = await res.json()
    const price = data[id]?.usd
    if (!price || typeof price !== "number") throw new Error("CoinGecko returned invalid price")
    return {
      symbol: symbol.toUpperCase(),
      priceUsd: price,
      timestamp: Date.now(),
      source: "coingecko",
    }
  },
}

// ─── Price Watcher ───

export type PriceCallback = (price: PriceData) => void
const logger = createLogger("PriceWatcher")

export class PriceWatcher {
  private sources: PriceSource[]
  private intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private lastPrice: PriceData | null = null
  private listeners: PriceCallback[] = []
  private running = false

  constructor(
    sources?: PriceSource[],
    intervalMs?: number,
  ) {
    // Default: Binance primary, CoinGecko backup
    this.sources = sources ?? [BinanceSource, CoinGeckoSource]
    this.intervalMs = intervalMs ?? PRICE_POLL_INTERVAL_MS
  }

  /** Register a listener for price updates */
  onPrice(cb: PriceCallback): void {
    this.listeners.push(cb)
  }

  /** Remove a listener */
  offPrice(cb: PriceCallback): void {
    this.listeners = this.listeners.filter(l => l !== cb)
  }

  /** Get the most recent price without polling */
  getLastPrice(): PriceData | null {
    return this.lastPrice
  }

  /** Start polling */
  start(symbol: string): void {
    if (this.running) return
    this.running = true
    logger.info("Starting price polling", { symbol, intervalMs: this.intervalMs })

    // Immediate first fetch
    this.poll(symbol)

    this.timer = setInterval(() => {
      this.poll(symbol)
    }, this.intervalMs)
  }

  /** Stop polling */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.running = false
    logger.info("Stopped price polling")
  }

  isRunning(): boolean {
    return this.running
  }

  /** Try each source in priority order */
  private async poll(symbol: string): Promise<void> {
    for (const source of this.sources) {
      try {
        const price = await source.fetchPrice(symbol)
        this.lastPrice = price
        for (const cb of this.listeners) {
          try { cb(price) } catch (e) {
            logger.error("Listener callback failed", { error: e instanceof Error ? e.message : String(e) })
          }
        }
        return // success, done
      } catch (err: any) {
        logger.warn("Price source failed", {
          source: source.name,
          symbol,
          error: err?.message || String(err),
        })
        // fall through to next source
      }
    }
    // All sources failed — keep lastPrice, don't notify (no data = no action)
    logger.error("All price sources failed; keeping last price", { symbol })
  }
}
