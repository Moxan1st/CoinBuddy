/**
 * Strategy Engine — State machine + trigger logic + idempotency
 *
 * Manages strategy lifecycle: armed → triggered → executing → executed/failed
 * Integrates PriceWatcher for trigger evaluation and Executor for trade execution.
 */

import type { Strategy, StrategyStatus, PriceData, AgentWallet, ExecutionResult } from "./types"
import { PriceWatcher } from "./price-watcher"
import { executeTwoStep } from "./executor"
import { createLogger } from "~lib/logger"
import {
  PRICE_STALE_THRESHOLD_MS,
  DEFAULT_REQUIRED_HITS,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_MAX_EXECUTION_DELAY_MS,
} from "./config"

// ─── Strategy Storage (chrome.storage.local for persistence across SW restarts) ───

const STORAGE_KEY = "coinbuddy_strategies"
const logger = createLogger("StrategyEngine")

async function loadStrategies(): Promise<Strategy[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    return result[STORAGE_KEY] || []
  } catch {
    return []
  }
}

async function saveStrategies(strategies: Strategy[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: strategies })
  } catch (err: any) {
    logger.error("Failed to persist strategies", { error: err?.message || String(err) })
  }
}

// ─── Strategy Engine ───

export class StrategyEngine {
  private strategies: Strategy[] = []
  private priceWatcher: PriceWatcher
  private wallet: AgentWallet | null = null
  private executing = false // global lock to prevent concurrent executions
  private initialized = false

  constructor(priceWatcher?: PriceWatcher) {
    this.priceWatcher = priceWatcher ?? new PriceWatcher()
  }

  /** Initialize: load persisted strategies, wire up price watcher.
   *  Wallet can be null initially — engine will load strategies but won't execute until wallet is set.
   */
  async init(wallet: AgentWallet | null): Promise<void> {
    this.wallet = wallet
    if (!this.initialized) {
      this.strategies = await loadStrategies()
      logger.info("Loaded strategies", { count: this.strategies.length })
      // Wire price updates to evaluation
      this.priceWatcher.onPrice((price) => this.evaluate(price))
      this.initialized = true
    } else if (wallet) {
      // Re-init with a new wallet (called after STRATEGY_SETUP_WALLET)
      logger.info("Wallet updated", { address: wallet.address })
    }
  }

  /** Start watching prices for the given symbol */
  startWatching(symbol: string): void {
    this.priceWatcher.start(symbol)
  }

  /** Stop everything */
  stop(): void {
    this.priceWatcher.stop()
  }

  // ─── CRUD ───

  async addStrategy(partial: Omit<Strategy, "id" | "consecutiveHits" | "status" | "triggeredAt" | "lastExecutionResult" | "executionLockUntil" | "createdAt" | "updatedAt">): Promise<Strategy> {
    const now = Date.now()
    const strategy: Strategy = {
      ...partial,
      id: `strat_${now}_${Math.random().toString(36).slice(2, 8)}`,
      consecutiveHits: 0,
      requiredHits: partial.requiredHits ?? DEFAULT_REQUIRED_HITS,
      cooldownMs: partial.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      maxExecutionDelayMs: partial.maxExecutionDelayMs ?? DEFAULT_MAX_EXECUTION_DELAY_MS,
      status: "armed",
      triggeredAt: null,
      lastExecutionResult: null,
      executionLockUntil: null,
      createdAt: now,
      updatedAt: now,
    }
    this.strategies.push(strategy)
    await saveStrategies(this.strategies)
    logger.info("Added strategy", {
      strategyId: strategy.id,
      triggerSymbol: strategy.triggerSymbol,
      triggerCondition: strategy.triggerCondition,
      triggerThreshold: strategy.triggerThreshold,
    })
    return strategy
  }

  async removeStrategy(id: string): Promise<boolean> {
    const idx = this.strategies.findIndex(s => s.id === id)
    if (idx === -1) return false
    this.strategies.splice(idx, 1)
    await saveStrategies(this.strategies)
    logger.info("Removed strategy", { strategyId: id })
    return true
  }

  getStrategies(): Strategy[] {
    return [...this.strategies]
  }

  getStrategy(id: string): Strategy | undefined {
    return this.strategies.find(s => s.id === id)
  }

  /** Reset a failed strategy back to armed so it can trigger again */
  async resetStrategy(id: string): Promise<boolean> {
    const s = this.strategies.find(s => s.id === id)
    if (!s) return false
    s.status = "armed"
    s.consecutiveHits = 0
    s.triggeredAt = null
    s.executionLockUntil = null
    s.lastExecutionResult = null
    s.updatedAt = Date.now()
    await saveStrategies(this.strategies)
    logger.info("Reset strategy to armed", { strategyId: id })
    return true
  }

  // ─── Core Evaluation (called on each price tick) ───

  private async evaluate(price: PriceData): Promise<void> {
    if (this.executing) {
      logger.debug("Skipping evaluation during active execution")
      return
    }

    const now = Date.now()

    for (const strategy of this.strategies) {
      // Only evaluate armed strategies
      if (strategy.status !== "armed") continue

      // Check if this strategy watches the reported symbol
      if (strategy.triggerSymbol.toUpperCase() !== price.symbol.toUpperCase()) continue

      // Check price staleness
      if (now - price.timestamp > PRICE_STALE_THRESHOLD_MS) {
        logger.warn("Skipping stale price data", {
          strategyId: strategy.id,
          symbol: price.symbol,
          ageMs: now - price.timestamp,
        })
        continue
      }

      // Evaluate trigger condition
      const triggered = this.checkCondition(price.priceUsd, strategy.triggerCondition, strategy.triggerThreshold)

      if (triggered) {
        strategy.consecutiveHits++
        logger.info("Trigger condition hit", {
          strategyId: strategy.id,
          symbol: price.symbol,
          priceUsd: price.priceUsd,
          triggerCondition: strategy.triggerCondition,
          triggerThreshold: strategy.triggerThreshold,
          consecutiveHits: strategy.consecutiveHits,
          requiredHits: strategy.requiredHits,
        })

        if (strategy.consecutiveHits >= strategy.requiredHits) {
          // Check cooldown (idempotency)
          if (strategy.executionLockUntil && now < strategy.executionLockUntil) {
            logger.info("Strategy still in cooldown", {
              strategyId: strategy.id,
              cooldownUntil: new Date(strategy.executionLockUntil).toISOString(),
            })
            continue
          }

          // TRIGGER!
          logger.info("Triggering strategy execution", { strategyId: strategy.id })
          await this.executeStrategy(strategy)
        }
      } else {
        // Reset consecutive hits on miss
        if (strategy.consecutiveHits > 0) {
          logger.info("Resetting consecutive hits after miss", {
            strategyId: strategy.id,
            previousHits: strategy.consecutiveHits,
          })
          strategy.consecutiveHits = 0
          strategy.updatedAt = now
          await saveStrategies(this.strategies)
        }
      }
    }
  }

  private checkCondition(price: number, condition: string, threshold: number): boolean {
    switch (condition) {
      case "lte": return price <= threshold
      case "gte": return price >= threshold
      default: return false
    }
  }

  // ─── Execute Strategy ───

  private async executeStrategy(strategy: Strategy): Promise<void> {
    if (!this.wallet) {
      logger.error("No wallet configured for execution", { strategyId: strategy.id })
      return
    }

    this.executing = true
    const now = Date.now()

    try {
      // Transition: armed → triggered
      strategy.status = "triggered"
      strategy.triggeredAt = now
      strategy.updatedAt = now
      await saveStrategies(this.strategies)

      // Transition: triggered → step1_executing
      strategy.status = "step1_executing"
      strategy.updatedAt = Date.now()
      await saveStrategies(this.strategies)

      // Execute two-step flow
      const result = await executeTwoStep(strategy, this.wallet)

      // Determine final status from result
      const finalStatus = this.resultToStatus(result, strategy)
      strategy.status = finalStatus
      strategy.lastExecutionResult = result
      strategy.updatedAt = Date.now()

      // Set cooldown lock regardless of success/failure
      strategy.executionLockUntil = Date.now() + strategy.cooldownMs

      // If step1 succeeded but step2 failed explicitly, override to specific failure
      if (result.step1 && !result.step2 && result.failedAt === "step2") {
        strategy.status = "failed_step2_tx"
      }
      // Buy-only: step1 done, no step2, no error — already handled by resultToStatus

      await saveStrategies(this.strategies)

      if (finalStatus === "executed") {
        logger.info("Strategy executed successfully", { strategyId: strategy.id })
      } else {
        logger.error("Strategy execution failed", {
          strategyId: strategy.id,
          finalStatus,
          error: result.error || "unknown_error",
        })
      }

    } catch (err: any) {
      strategy.status = "failed_step1_tx"
      strategy.lastExecutionResult = { error: `Unexpected error: ${err.message}`, failedAt: "step1" }
      strategy.executionLockUntil = Date.now() + strategy.cooldownMs
      strategy.updatedAt = Date.now()
      await saveStrategies(this.strategies)
      logger.error("Unexpected error during strategy execution", {
        strategyId: strategy.id,
        error: err?.message || String(err),
      })
    } finally {
      this.executing = false
    }
  }

  private resultToStatus(result: ExecutionResult, strategy: Strategy): StrategyStatus {
    // Full success: both steps done, or buy-only strategy with step1 done
    if (!result.error && result.step1 && result.step2) {
      return "executed"
    }
    if (!result.error && result.step1 && !result.failedAt) {
      // Buy-only strategy (postAction "none") — step1 success with no step2 and no error
      return "executed"
    }

    // Check execution timeout
    if (strategy.triggeredAt) {
      const elapsed = Date.now() - strategy.triggeredAt
      if (elapsed > strategy.maxExecutionDelayMs) {
        return "failed_timeout"
      }
    }

    switch (result.failedAt) {
      case "pre_check":
        if (result.error?.includes("Insufficient")) return "failed_balance"
        return "failed_quote"
      case "quote":
        return "failed_quote"
      case "step1":
        return "failed_step1_tx"
      case "step2":
        if (result.error?.includes("vault") || result.error?.includes("Vault")) return "failed_vault"
        return "failed_step2_tx"
      case "timeout":
        return "failed_timeout"
      default:
        return "failed_step1_tx"
    }
  }

  /** Manually retry Step 2 for a strategy stuck in step1_done or failed_step2_tx */
  async retryStep2(id: string): Promise<ExecutionResult | null> {
    const strategy = this.strategies.find(s => s.id === id)
    if (!strategy || !this.wallet) return null

    if (strategy.status !== "step1_done" && strategy.status !== "failed_step2_tx") {
      logger.warn("Cannot retry step2 from current status", {
        strategyId: id,
        status: strategy.status,
      })
      return null
    }

    const step1 = strategy.lastExecutionResult?.step1
    if (!step1 || BigInt(step1.balanceDelta) <= 0n) {
      logger.warn("Missing valid step1 delta for retry", { strategyId: id })
      return null
    }

    this.executing = true
    strategy.status = "step2_executing"
    strategy.updatedAt = Date.now()
    await saveStrategies(this.strategies)

    try {
      // Re-run only step 2 with the recorded delta
      const result = await executeTwoStep(strategy, this.wallet)

      if (result.step2 && !result.error) {
        strategy.status = "executed"
        strategy.lastExecutionResult = {
          ...strategy.lastExecutionResult,
          step2: result.step2,
        }
      } else {
        strategy.status = "failed_step2_tx"
        strategy.lastExecutionResult = {
          ...strategy.lastExecutionResult,
          error: result.error,
          failedAt: "step2",
        }
      }

      strategy.updatedAt = Date.now()
      await saveStrategies(this.strategies)
      return result
    } catch (err: any) {
      strategy.status = "failed_step2_tx"
      strategy.updatedAt = Date.now()
      await saveStrategies(this.strategies)
      return { error: err.message, failedAt: "step2" }
    } finally {
      this.executing = false
    }
  }
}
