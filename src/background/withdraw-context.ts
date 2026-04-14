import type { Vault } from "~types"

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * Returns true only for well-formed 42-char hex EVM addresses.
 * Rejects placeholder patterns like "0x...", short strings, and non-hex.
 */
export function isValidEvmAddress(addr: unknown): addr is string {
  if (typeof addr !== "string") return false
  return EVM_ADDRESS_RE.test(addr)
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

/**
 * Returns true if a vault candidate has a real, non-zero EVM address.
 * Filters out zero-address, placeholder, and malformed entries from search results.
 */
export function isValidVaultCandidate(vault: Vault | null | undefined): boolean {
  if (!vault || !vault.address) return false
  if (!isValidEvmAddress(vault.address)) return false
  if (vault.address.toLowerCase() === ZERO_ADDRESS) return false
  return true
}

export function needsVaultDetailRefresh(vault: Vault | null | undefined): boolean {
  if (!vault || !vault.address || !vault.chainId) return false
  return (
    typeof vault.isRedeemable === "undefined" ||
    !Array.isArray(vault.underlyingTokens) ||
    vault.underlyingTokens.length === 0
  )
}

export function isKnownNotRedeemable(vault: Vault | null | undefined): boolean {
  return vault?.isRedeemable === false
}

export type VaultSource =
  | "protocol-search"
  | "position-disambiguation"
  | "compare-list"
  | "explicit-detail"
  | "refreshed-detail"
  | "context-detail"

const FORCE_REFRESH_SOURCES: Set<VaultSource> = new Set([
  "protocol-search",
  "position-disambiguation",
  "compare-list",
])

/**
 * Source-based decision: should we force a fetchVaultDetail call?
 * Search/compare/disambiguation results are never trusted for redeemability —
 * even if the lightweight object happens to carry isRedeemable, it may be stale or wrong.
 */
export function shouldForceDetailRefresh(source: VaultSource): boolean {
  return FORCE_REFRESH_SOURCES.has(source)
}

export function requiresWalletForProtocolWithdraw(params: {
  vaultChainId?: number
  vaultAddress?: string
  selectionProtocol?: string
}, walletAddress?: string | null): boolean {
  if (walletAddress) return false
  if (!params.selectionProtocol || !params.vaultChainId) return false
  if (isValidEvmAddress(params.vaultAddress)) return false
  return true
}

export interface VaultProtocolMatch {
  vault: Vault | null
  candidates: Vault[]
  ambiguous: boolean
}

/**
 * Filter a list of vaults by protocol keyword.
 * Returns a single match, multiple (ambiguous), or none.
 */
export function matchVaultsByProtocol(
  vaults: Vault[],
  protocolKeyword: string,
): VaultProtocolMatch {
  const kw = protocolKeyword.toLowerCase()

  // Exact or prefix match on protocol name
  let matches = vaults.filter((v) => {
    const pn = String(v.protocol?.name || "").toLowerCase()
    return pn === kw || pn.startsWith(`${kw}-`) || pn.startsWith(`${kw} `)
  })

  // Substring fallback
  if (matches.length === 0 && kw.length >= 2) {
    matches = vaults.filter((v) =>
      String(v.protocol?.name || "").toLowerCase().includes(kw),
    )
  }

  // Also try vault name
  if (matches.length === 0 && kw.length >= 2) {
    matches = vaults.filter((v) =>
      String(v.name || "").toLowerCase().includes(kw),
    )
  }

  if (matches.length === 1) {
    return { vault: matches[0], candidates: matches, ambiguous: false }
  }
  if (matches.length > 1) {
    return { vault: null, candidates: matches, ambiguous: true }
  }
  return { vault: null, candidates: [], ambiguous: false }
}

/**
 * Given ambiguous vault candidates and a map of address -> hasPosition,
 * narrow down to vaults where the wallet has a share balance.
 *
 * Returns:
 * - single vault with position → { vault, ambiguous: false }
 * - multiple with positions → { vault: null, candidates: [...], ambiguous: true }
 * - none with positions → { vault: null, candidates: originalCandidates, ambiguous: true }
 *   (fall back so caller can still show the full list)
 */
export function disambiguateByPositions(
  candidates: Vault[],
  positionMap: Map<string, boolean>,
): VaultProtocolMatch {
  const withPosition = candidates.filter(
    (v) => positionMap.get(v.address?.toLowerCase()) === true,
  )

  if (withPosition.length === 1) {
    return { vault: withPosition[0], candidates: withPosition, ambiguous: false }
  }
  if (withPosition.length > 1) {
    return { vault: null, candidates: withPosition, ambiguous: true }
  }
  // No positions detected — return original candidates
  return { vault: null, candidates, ambiguous: true }
}
