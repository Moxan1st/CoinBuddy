/**
 * Strategy Module — Entry Point
 *
 * Bootstraps the strategy engine in the background service worker.
 * Registers message handlers for strategy management (STRATEGY_* actions).
 * Does NOT modify existing CoinBuddy message handlers.
 *
 * SECURITY: Agent wallet private key is loaded from chrome.storage.local
 * at runtime (background-only). It is NEVER in env vars or the JS bundle.
 * Set it once via STRATEGY_SETUP_WALLET from the background console.
 */

import { StrategyEngine } from "./strategy-engine"
import { PriceWatcher } from "./price-watcher"
import { createLogger } from "~lib/logger"
import {
  loadAgentWalletFromStorage,
  storeAgentWalletKey,
  clearAgentWalletKey,
  getStoredWalletAddress,
} from "./agent-wallet"
import type { Strategy } from "./types"
import {
  DEFAULT_REQUIRED_HITS,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_MAX_EXECUTION_DELAY_MS,
} from "./config"
const logger = createLogger("Strategy")

// ─── Singleton instances ───

let engine: StrategyEngine | null = null
let started = false

// ─── Bootstrap ───

/**
 * Initialize and start the strategy engine.
 * Call this from background/index.ts.
 * Safe to call multiple times — only initializes once.
 */
export async function startStrategyEngine(): Promise<void> {
  if (started) return
  started = true

  // ── Startup security diagnostics ──
  logger.info("Startup diagnostics begin")

  const walletAddress = await getStoredWalletAddress()
  if (walletAddress) {
    logger.info("Wallet configured", { walletAddress })
    logger.warn("Wallet storage is plaintext chrome.storage.local", { environment: "dev_test_only" })
    logger.warn("Do not use this wallet for production or significant funds")
  } else {
    logger.info("Wallet configured", { walletAddress: null })
    logger.info("Use STRATEGY_SETUP_WALLET from background console to configure")
  }

  try {
    const wallet = await loadAgentWalletFromStorage()
    if (!wallet) {
      // Engine created but without wallet — can accept config, won't execute until wallet is set
      engine = new StrategyEngine(new PriceWatcher())
      await engine.init(null)
      logger.info("Engine created awaiting wallet setup")
      logger.info("Startup diagnostics end")
      return
    }

    const priceWatcher = new PriceWatcher()
    engine = new StrategyEngine(priceWatcher)
    await engine.init(wallet)

    // Auto-start watching BTC if there are armed strategies
    const strategies = engine.getStrategies()
    const armed = strategies.filter(s => s.status === "armed")
    const armedBtc = armed.some(s => s.triggerSymbol.toUpperCase() === "BTC")

    logger.info("Engine enabled", { strategies: strategies.length, armed: armed.length })

    if (armedBtc) {
      engine.startWatching("BTC")
      logger.info("Price watcher active", { symbol: "BTC" })
    } else {
      logger.info("Price watcher idle", { reason: "no_armed_btc_strategies" })
    }

    logger.info("Startup diagnostics end")
  } catch (err: any) {
    logger.error("Engine startup failed", { message: err.message })
    logger.info("Startup diagnostics end")
    started = false
  }
}

/**
 * Re-initialize engine with a newly stored wallet.
 * Called after STRATEGY_SETUP_WALLET sets the key.
 */
async function reinitWithWallet(): Promise<void> {
  const wallet = await loadAgentWalletFromStorage()
  if (!wallet) return

  // If engine exists, just set the wallet; otherwise full init
  if (engine) {
    await engine.init(wallet)
    // Start watching if armed strategies exist
    const strategies = engine.getStrategies()
    const armedBtc = strategies.some(
      s => s.status === "armed" && s.triggerSymbol.toUpperCase() === "BTC"
    )
    if (armedBtc) {
      engine.startWatching("BTC")
    }
    logger.info("Engine re-initialized with wallet")
  } else {
    started = false
    await startStrategyEngine()
  }
}

// ─── Message Handlers ───

/**
 * Register STRATEGY_* message handlers on the chrome.runtime.onMessage bus.
 * Call this from background/index.ts alongside existing handlers.
 *
 * SECURITY NOTE: STRATEGY_SETUP_WALLET only accepts messages from the
 * extension itself (no tab sender = background/popup context).
 * The private key is stored in chrome.storage.local which is sandboxed
 * to the extension and not accessible from web page content scripts.
 */
export function registerStrategyHandlers(): void {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request.action?.startsWith("STRATEGY_")) return false

    const handle = async () => {
      try {
        switch (request.action) {

          // ── Wallet setup (background-only, one-time) ──
          case "STRATEGY_SETUP_WALLET": {
            // Security: reject if message comes from a content script (has a tab)
            if (sender.tab) {
              sendResponse({ status: "error", error: "Wallet setup rejected: not allowed from content scripts" })
              break
            }
            const pk = request.payload?.privateKey as string
            if (!pk) {
              sendResponse({ status: "error", error: "privateKey is required in payload" })
              break
            }
            try {
              // storeAgentWalletKey performs all validation:
              // format, hex content, address derivation, duplicate detection
              const address = await storeAgentWalletKey(pk)
              await reinitWithWallet()
              sendResponse({
                status: "success",
                data: {
                  address,
                  warning: "DEV/TEST ONLY — key stored as plaintext in chrome.storage.local. Not for production or real funds.",
                },
              })
            } catch (err: any) {
              sendResponse({ status: "error", error: err.message })
            }
            break
          }

          case "STRATEGY_CLEAR_WALLET": {
            if (sender.tab) {
              sendResponse({ status: "error", error: "Not allowed from content scripts" })
              break
            }
            await clearAgentWalletKey()
            engine?.stop()
            sendResponse({ status: "success" })
            break
          }

          case "STRATEGY_STATUS": {
            const addr = await getStoredWalletAddress()
            sendResponse({
              status: "success",
              data: {
                engineReady: !!engine,
                walletConfigured: !!addr,
                walletAddress: addr, // address only, never the key
                storageWarning: addr ? "DEV/TEST ONLY — plaintext storage" : undefined,
                strategies: engine?.getStrategies() ?? [],
              },
            })
            break
          }

          case "STRATEGY_ADD": {
            if (!engine) {
              sendResponse({ status: "error", error: "Strategy engine not initialized" })
              break
            }
            const p = request.payload
            if (!p?.vaultAddress) {
              sendResponse({ status: "error", error: "vaultAddress is required" })
              break
            }
            const strategy = await engine.addStrategy({
              triggerSymbol: p.triggerSymbol || "BTC",
              triggerCondition: p.triggerCondition || "lte",
              triggerThreshold: Number(p.triggerThreshold),
              spendToken: p.spendToken || "USDT",
              spendAmount: String(p.spendAmount),
              spendChainId: Number(p.spendChainId) || 8453,
              buyToken: p.buyToken || "cbBTC",
              targetChainId: Number(p.targetChainId) || 8453,
              postAction: {
                type: "vault_deposit",
                vaultAddress: p.vaultAddress,
                vaultChainId: Number(p.vaultChainId) || Number(p.targetChainId) || 8453,
                protocol: p.protocol,
              },
              requiredHits: Number(p.requiredHits) || DEFAULT_REQUIRED_HITS,
              cooldownMs: Number(p.cooldownMs) || DEFAULT_COOLDOWN_MS,
              maxExecutionDelayMs: Number(p.maxExecutionDelayMs) || DEFAULT_MAX_EXECUTION_DELAY_MS,
            })

            // Start watching if not already
            engine.startWatching(strategy.triggerSymbol.toUpperCase())

            sendResponse({ status: "success", data: strategy })
            break
          }

          case "STRATEGY_REMOVE": {
            if (!engine) {
              sendResponse({ status: "error", error: "Strategy engine not initialized" })
              break
            }
            const removed = await engine.removeStrategy(request.payload?.id)
            sendResponse({ status: removed ? "success" : "error", error: removed ? undefined : "Strategy not found" })
            break
          }

          case "STRATEGY_RESET": {
            if (!engine) {
              sendResponse({ status: "error", error: "Strategy engine not initialized" })
              break
            }
            const reset = await engine.resetStrategy(request.payload?.id)
            sendResponse({ status: reset ? "success" : "error", error: reset ? undefined : "Strategy not found" })
            break
          }

          case "STRATEGY_RETRY_STEP2": {
            if (!engine) {
              sendResponse({ status: "error", error: "Strategy engine not initialized" })
              break
            }
            const result = await engine.retryStep2(request.payload?.id)
            if (result) {
              sendResponse({ status: "success", data: result })
            } else {
              sendResponse({ status: "error", error: "Cannot retry — check strategy status" })
            }
            break
          }

          default:
            sendResponse({ status: "error", error: `Unknown strategy action: ${request.action}` })
        }
      } catch (err: any) {
        logger.error("Handler error", { message: err?.message || String(err) })
        sendResponse({ status: "error", error: err.message })
      }
    }

    handle()
    return true // async sendResponse
  })

  logger.info("Message handlers registered")
}

// ─── Direct access for background/index.ts (avoids message roundtrip) ───

export function getEngine(): StrategyEngine | null {
  return engine
}

// ─── Re-exports ───

export { StrategyEngine } from "./strategy-engine"
export { PriceWatcher } from "./price-watcher"
export { loadAgentWalletFromStorage, storeAgentWalletKey, clearAgentWalletKey, getStoredWalletAddress, registerWalletAdapter, getWalletAdapter } from "./agent-wallet"
export type { Strategy, AgentWallet, PriceData, PriceSource, WalletAdapter } from "./types"
