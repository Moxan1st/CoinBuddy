/**
 * Strategy Module — Constants & Default Configuration
 */

export {
  CHAIN_NAMES,
  CHAIN_RPC,
  TOKEN_ADDRESSES,
  TOKEN_DECIMALS,
  resolveTokenAddress,
  getTokenDecimals,
} from "~lib/chain-config"

// ─── LI.FI API ───

export const LIFI_API_BASE = `${process.env.PLASMO_PUBLIC_API_BASE || ""}/api/lifi`
export const PROXY_TOKEN = process.env.PLASMO_PUBLIC_PROXY_TOKEN || ""

// ─── Price Watcher Defaults ───

export const PRICE_POLL_INTERVAL_MS = 30_000 // 30 seconds
export const PRICE_STALE_THRESHOLD_MS = 120_000 // 2 minutes — price older than this is "stale"

// ─── Strategy Defaults ───

export const DEFAULT_REQUIRED_HITS = 3
export const DEFAULT_COOLDOWN_MS = 86_400_000 // 24 hours
export const DEFAULT_MAX_EXECUTION_DELAY_MS = 300_000 // 5 minutes

export function toRawAmount(humanAmount: string, decimals: number): string {
  // Handle integer and decimal amounts safely
  const parts = humanAmount.split(".")
  const whole = parts[0] || "0"
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals)
  const raw = whole + frac
  // Remove leading zeros but keep at least "0"
  return raw.replace(/^0+/, "") || "0"
}
