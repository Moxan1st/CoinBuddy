import test from "node:test"
import assert from "node:assert/strict"

import {
  disambiguateByPositions,
  isKnownNotRedeemable,
  isValidEvmAddress,
  isValidVaultCandidate,
  matchVaultsByProtocol,
  needsVaultDetailRefresh,
  requiresWalletForProtocolWithdraw,
  shouldForceDetailRefresh,
} from "./withdraw-context.ts"
import type { Vault } from "~types"

// ── isValidEvmAddress ──

test("valid 42-char hex address is accepted", () => {
  assert.equal(isValidEvmAddress("0x1234567890abcdef1234567890abcdef12345678"), true)
  assert.equal(isValidEvmAddress("0xABCDEF1234567890ABCDEF1234567890ABCDEF12"), true)
})

test("placeholder 0x... is rejected", () => {
  assert.equal(isValidEvmAddress("0x..."), false)
})

test("too short address is rejected", () => {
  assert.equal(isValidEvmAddress("0x1234"), false)
})

test("too long address is rejected", () => {
  assert.equal(isValidEvmAddress("0x1234567890abcdef1234567890abcdef123456789"), false)
})

test("non-hex characters are rejected", () => {
  assert.equal(isValidEvmAddress("0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"), false)
})

test("non-string values are rejected", () => {
  assert.equal(isValidEvmAddress(undefined), false)
  assert.equal(isValidEvmAddress(null), false)
  assert.equal(isValidEvmAddress(42), false)
  assert.equal(isValidEvmAddress(""), false)
})

// ── matchVaultsByProtocol ──

let vaultCounter = 1
function makeVault(name: string, protocolName: string) {
  const hex = (vaultCounter++).toString(16).padStart(40, "0")
  return {
    address: `0x${hex}`,
    chainId: 8453,
    name,
    protocol: { name: protocolName },
    analytics: { apy: { base: 0, reward: 0, total: 0 } },
    underlyingTokens: [{ address: "0x0000000000000000000000000000000000000000", symbol: "USDC", decimals: 6 }],
  } satisfies Vault
}

test("exact protocol match returns single vault", () => {
  const vaults = [makeVault("v1", "yo"), makeVault("v2", "morpho-blue")]
  const result = matchVaultsByProtocol(vaults, "yo")
  assert.equal(result.vault?.name, "v1")
  assert.equal(result.ambiguous, false)
})

test("prefix match works (yo matches yo-protocol)", () => {
  const vaults = [makeVault("v1", "yo-protocol"), makeVault("v2", "aave-v3")]
  const result = matchVaultsByProtocol(vaults, "yo")
  assert.equal(result.vault?.name, "v1")
  assert.equal(result.ambiguous, false)
})

test("multiple protocol matches returns ambiguous", () => {
  const vaults = [
    makeVault("v1", "morpho-blue"),
    makeVault("v2", "morpho-v1"),
    makeVault("v3", "aave-v3"),
  ]
  const result = matchVaultsByProtocol(vaults, "morpho")
  assert.equal(result.vault, null)
  assert.equal(result.ambiguous, true)
  assert.equal(result.candidates.length, 2)
})

test("no match returns empty non-ambiguous", () => {
  const vaults = [makeVault("v1", "aave-v3")]
  const result = matchVaultsByProtocol(vaults, "yo")
  assert.equal(result.vault, null)
  assert.equal(result.ambiguous, false)
  assert.equal(result.candidates.length, 0)
})

test("substring fallback on vault name", () => {
  const vaults = [makeVault("Yo USDC Vault", "some-protocol")]
  const result = matchVaultsByProtocol(vaults, "yo")
  assert.equal(result.vault?.name, "Yo USDC Vault")
  assert.equal(result.ambiguous, false)
})

// ── needsVaultDetailRefresh (regression) ──

test("needs detail refresh for lightweight recommended vault objects", () => {
  const vault = {
    ...makeVault("yo-usdc", "yo-protocol"),
    isRedeemable: undefined,
    underlyingTokens: [],
  }

  assert.equal(needsVaultDetailRefresh(vault), true)
})

test("detail refresh is not needed for full vault detail object", () => {
  const vault = {
    ...makeVault("yo-usdc", "yo-protocol"),
    isRedeemable: true,
  }

  assert.equal(needsVaultDetailRefresh(vault), false)
})

// ── isKnownNotRedeemable (regression) ──

test("only explicit false is treated as non-redeemable", () => {
  assert.equal(isKnownNotRedeemable({ ...makeVault("yo-usdc", "yo-protocol"), isRedeemable: false }), true)
  assert.equal(isKnownNotRedeemable({ ...makeVault("yo-usdc", "yo-protocol"), isRedeemable: true }), false)
  assert.equal(isKnownNotRedeemable(makeVault("yo-usdc", "yo-protocol")), false)
  assert.equal(isKnownNotRedeemable(null), false)
})

// ── disambiguateByPositions ──

test("single vault with position is auto-selected", () => {
  const v1 = makeVault("v1", "yo-usdc")
  const v2 = makeVault("v2", "yo-eth")
  const positionMap = new Map([
    [v1.address.toLowerCase(), true],
    [v2.address.toLowerCase(), false],
  ])

  const result = disambiguateByPositions([v1, v2], positionMap)
  assert.equal(result.vault?.name, "v1")
  assert.equal(result.ambiguous, false)
})

test("multiple vaults with positions returns ambiguous subset", () => {
  const v1 = makeVault("v1", "yo-usdc")
  const v2 = makeVault("v2", "yo-eth")
  const v3 = makeVault("v3", "yo-dai")
  const positionMap = new Map([
    [v1.address.toLowerCase(), true],
    [v2.address.toLowerCase(), true],
    [v3.address.toLowerCase(), false],
  ])

  const result = disambiguateByPositions([v1, v2, v3], positionMap)
  assert.equal(result.vault, null)
  assert.equal(result.ambiguous, true)
  assert.equal(result.candidates.length, 2)
})

test("no vaults with positions falls back to full candidate list", () => {
  const v1 = makeVault("v1", "yo-usdc")
  const v2 = makeVault("v2", "yo-eth")
  const positionMap = new Map([
    [v1.address.toLowerCase(), false],
    [v2.address.toLowerCase(), false],
  ])

  const result = disambiguateByPositions([v1, v2], positionMap)
  assert.equal(result.vault, null)
  assert.equal(result.ambiguous, true)
  assert.equal(result.candidates.length, 2)
  // Returns the original candidates, not an empty list
  assert.equal(result.candidates[0].name, "v1")
})

// ── shouldForceDetailRefresh: source-based refresh decision ──

test("position-disambiguation source always forces refresh", () => {
  assert.equal(shouldForceDetailRefresh("position-disambiguation"), true)
})

test("protocol-search source always forces refresh", () => {
  assert.equal(shouldForceDetailRefresh("protocol-search"), true)
})

test("compare-list source always forces refresh", () => {
  assert.equal(shouldForceDetailRefresh("compare-list"), true)
})

test("explicit-detail source does NOT force refresh", () => {
  assert.equal(shouldForceDetailRefresh("explicit-detail"), false)
})

test("refreshed-detail source does NOT force refresh", () => {
  assert.equal(shouldForceDetailRefresh("refreshed-detail"), false)
})

test("context-detail source does NOT force refresh", () => {
  assert.equal(shouldForceDetailRefresh("context-detail"), false)
})

test("lightweight object with isRedeemable=false from search source must still refresh", () => {
  // This is the exact bug scenario: fetchVaultComparison returned a vault
  // that happens to carry isRedeemable=false. The old needsVaultDetailRefresh
  // would see all fields present and skip refresh, leading to a false block.
  const searchVault = {
    ...makeVault("yo-usdc", "yo-protocol"),
    isRedeemable: false,
  }
  // Old field-based check would say "no refresh needed" — that's the bug
  assert.equal(needsVaultDetailRefresh(searchVault), false)
  // Source-based check correctly says "must refresh" for search results
  assert.equal(shouldForceDetailRefresh("protocol-search"), true)
  assert.equal(shouldForceDetailRefresh("position-disambiguation"), true)
})

// ── isKnownNotRedeemable: only after trusted detail ──

test("detail object with isRedeemable false is correctly blocked", () => {
  const detailedVault = {
    ...makeVault("yo-usdc", "yo-protocol"),
    isRedeemable: false,
    underlyingTokens: [{ address: "0x456", symbol: "USDC", decimals: 6 }],
  }
  assert.equal(isKnownNotRedeemable(detailedVault), true)
})

test("detail object with isRedeemable true passes through to withdraw", () => {
  const detailedVault = {
    ...makeVault("yo-usdc", "yo-protocol"),
    isRedeemable: true,
    underlyingTokens: [{ address: "0x456", symbol: "USDC", decimals: 6 }],
  }
  assert.equal(isKnownNotRedeemable(detailedVault), false)
})

test("context vault with full detail does not need refresh (regression)", () => {
  const contextVault = {
    ...makeVault("context-vault", "aave-v3"),
    isRedeemable: true,
    underlyingTokens: [{ address: "0xabc", symbol: "USDC", decimals: 6 }],
  }
  // Field-based check: full detail, no refresh
  assert.equal(needsVaultDetailRefresh(contextVault), false)
  // Source-based check: context-detail, no refresh
  assert.equal(shouldForceDetailRefresh("context-detail"), false)
  assert.equal(isKnownNotRedeemable(contextVault), false)
})

// ── isValidVaultCandidate ──

test("valid vault candidate passes", () => {
  const v = makeVault("v1", "yo-protocol")
  assert.equal(isValidVaultCandidate(v), true)
})

test("zero address vault candidate is rejected", () => {
  const v = { ...makeVault("v1", "yo"), address: "0x0000000000000000000000000000000000000000" }
  assert.equal(isValidVaultCandidate(v), false)
})

test("short address vault candidate is rejected", () => {
  const v = { ...makeVault("v1", "yo"), address: "0x123" }
  assert.equal(isValidVaultCandidate(v), false)
})

test("missing address vault candidate is rejected", () => {
  assert.equal(isValidVaultCandidate({ chainId: 8453 } as unknown as Vault), false)
  assert.equal(isValidVaultCandidate(null), false)
})

// ── disambiguateByPositions with noPositionsFound signal ──

test("walletAddress missing -> no disambiguation, candidates returned as-is", () => {
  // This tests the caller logic: when walletAddress is null,
  // disambiguateByPositions is never called — just candidates returned.
  // We verify disambiguateByPositions itself still works correctly.
  const v1 = makeVault("v1", "yo-usdc")
  const v2 = makeVault("v2", "yo-eth")
  // Without a position map, we can't disambiguate — this is the expected state
  // when wallet is not connected. The caller should return ambiguousCandidates directly.
  const emptyMap = new Map<string, boolean>()
  const result = disambiguateByPositions([v1, v2], emptyMap)
  assert.equal(result.vault, null)
  assert.equal(result.ambiguous, true)
  assert.equal(result.candidates.length, 2)
})

test("walletAddress present, one vault has balance -> auto-select", () => {
  const v1 = makeVault("v1", "yo-usdc")
  const v2 = makeVault("v2", "yo-eth")
  const positionMap = new Map([
    [v1.address.toLowerCase(), true],
    [v2.address.toLowerCase(), false],
  ])
  const result = disambiguateByPositions([v1, v2], positionMap)
  assert.equal(result.vault?.name, "v1")
  assert.equal(result.ambiguous, false)
})

test("walletAddress present, multiple vaults have balance -> ambiguous subset", () => {
  const v1 = makeVault("v1", "yo-usdc")
  const v2 = makeVault("v2", "yo-eth")
  const positionMap = new Map([
    [v1.address.toLowerCase(), true],
    [v2.address.toLowerCase(), true],
  ])
  const result = disambiguateByPositions([v1, v2], positionMap)
  assert.equal(result.vault, null)
  assert.equal(result.ambiguous, true)
  assert.equal(result.candidates.length, 2)
})

test("walletAddress present, all balances zero -> fall back to full candidates", () => {
  const v1 = makeVault("v1", "yo-usdc")
  const v2 = makeVault("v2", "yo-eth")
  const positionMap = new Map([
    [v1.address.toLowerCase(), false],
    [v2.address.toLowerCase(), false],
  ])
  const result = disambiguateByPositions([v1, v2], positionMap)
  assert.equal(result.vault, null)
  assert.equal(result.ambiguous, true)
  // Returns original candidates so caller can still list them
  assert.equal(result.candidates.length, 2)
  // Caller should detect noPositionsFound = true because
  // no entry in positionMap is true
  const anyPosition = [...positionMap.values()].some(Boolean)
  assert.equal(anyPosition, false)
})

// ── requiresWalletForProtocolWithdraw ──

test("protocol withdraw without wallet requires wallet gating", () => {
  assert.equal(
    requiresWalletForProtocolWithdraw(
      { selectionProtocol: "yo", vaultChainId: 8453 },
      null,
    ),
    true,
  )
})

test("protocol withdraw with wallet does not require wallet gating", () => {
  assert.equal(
    requiresWalletForProtocolWithdraw(
      { selectionProtocol: "yo", vaultChainId: 8453 },
      "0x1234567890abcdef1234567890abcdef12345678",
    ),
    false,
  )
})

test("explicit vault address bypasses wallet gating", () => {
  assert.equal(
    requiresWalletForProtocolWithdraw(
      {
        selectionProtocol: "yo",
        vaultChainId: 8453,
        vaultAddress: "0x1234567890abcdef1234567890abcdef12345678",
      },
      null,
    ),
    false,
  )
})

test("non-protocol withdraw does not require wallet gating", () => {
  assert.equal(
    requiresWalletForProtocolWithdraw(
      { vaultChainId: 8453 },
      null,
    ),
    false,
  )
})
