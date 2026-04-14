/**
 * Strategy Module — Type Definitions
 *
 * Minimal strategy model for automated spot execution + post-action deposit.
 */

// ─── Strategy Status (fine-grained failure states per user requirement) ───

export type StrategyStatus =
  | "armed"              // waiting for trigger
  | "triggered"          // price condition met, about to execute
  | "step1_executing"    // swap tx submitted
  | "step1_done"         // swap confirmed, balance delta recorded
  | "step2_executing"    // deposit tx submitted
  | "executed"           // full pipeline complete
  // Fine-grained failure states
  | "failed_quote"       // LI.FI quote returned no route
  | "failed_balance"     // insufficient spend token or gas
  | "failed_step1_tx"    // swap tx reverted or rejected
  | "failed_step2_tx"    // deposit tx reverted or rejected
  | "failed_vault"       // vault unavailable or misconfigured
  | "failed_price_stale" // price data too old to act on
  | "failed_timeout"     // execution exceeded maxExecutionDelayMs

export type TriggerCondition = "lte" | "gte"

// ─── Post-Action Config ───

export interface PostActionConfig {
  type: "vault_deposit" | "none"
  vaultAddress: string   // explicit vault contract address (no auto-search in MVP); empty when type="none"
  vaultChainId: number
  /** Optional protocol name for logging/display */
  protocol?: string
}

// ─── Execution Result ───

export interface ExecutionResult {
  step1?: {
    txHash: string
    balanceBefore: string   // raw bigint string
    balanceAfter: string    // raw bigint string
    balanceDelta: string    // actual amount received (after - before)
    timestamp: number
  }
  step2?: {
    txHash: string
    depositAmount: string   // the delta used for deposit
    timestamp: number
  }
  error?: string
  failedAt?: "step1" | "step2" | "pre_check" | "quote" | "timeout"
}

// ─── Strategy Model ───

export interface Strategy {
  id: string

  // Trigger config
  triggerSymbol: string         // e.g. "BTC"
  triggerCondition: TriggerCondition
  triggerThreshold: number      // e.g. 70000

  // Spend config
  spendToken: string            // e.g. "USDT"
  spendAmount: string           // human-readable, e.g. "20000"
  spendChainId: number          // e.g. 8453 (Base)

  // Buy config
  buyToken: string              // e.g. "cbBTC" or "WBTC"
  targetChainId: number         // e.g. 8453

  // Post-action
  postAction: PostActionConfig

  // Execution control
  consecutiveHits: number       // current consecutive price matches
  requiredHits: number          // min consecutive hits before trigger (anti-spike)
  cooldownMs: number            // min time between executions (e.g. 24h = 86400000)
  maxExecutionDelayMs: number   // max time from trigger to completion before timeout

  // State
  status: StrategyStatus
  triggeredAt: number | null    // timestamp when status changed to 'triggered'
  lastExecutionResult: ExecutionResult | null
  executionLockUntil: number | null  // timestamp, null = unlocked

  createdAt: number
  updatedAt: number
}

// ─── Price Source Types ───

export interface PriceData {
  symbol: string
  priceUsd: number
  timestamp: number
  source: string
}

export interface PriceSource {
  name: string
  fetchPrice(symbol: string): Promise<PriceData>
}

// ─── Agent Wallet Types ───

export interface AgentWallet {
  readonly address: string
  signAndSendTransaction(tx: {
    to: string
    data: string
    value: string
    chainId: number
    gasLimit?: string
  }): Promise<string>  // returns txHash
  waitForReceipt(txHash: string, chainId: number): Promise<{ status: "success" | "reverted" }>
  getErc20Balance(tokenAddress: string, chainId: number): Promise<bigint>
  getNativeBalance(chainId: number): Promise<bigint>
}

// ─── Wallet Adapter (pluggable wallet backends) ───

export interface WalletAdapter {
  type: string  // e.g. "private_key", "hardware", "mpc"
  createWallet(config: Record<string, unknown>): AgentWallet
}
