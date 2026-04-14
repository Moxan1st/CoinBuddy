import test from "node:test"
import assert from "node:assert/strict"

import { hydrateInvestParamsWithDraft } from "./invest.ts"
import type { HandlerContext } from "./types.ts"
import type { IntentResult, Vault } from "~types"

function makeVault(overrides: Partial<Vault> = {}): Vault {
  return {
    address: "0x0000000f2eb9f69274678c76222b35eec7588a65",
    chainId: 8453,
    name: "USDC",
    protocol: { name: "yo-protocol" },
    analytics: { apy: { base: 1, reward: 0, total: 1 } },
    underlyingTokens: [
      { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 },
    ],
    ...overrides,
  }
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    lang: "zh",
    userText: "",
    walletAddress: null,
    tabId: undefined,
    pushHistory: () => {},
    sendProgress: () => {},
    sendResponse: () => {},
    pendingDepositDraft: {
      investParams: null,
      selectedVault: null,
      vaultChoices: [],
      walletAddress: null,
    },
    ensurePortfolioSnapshot: async () => [],
    cacheVaultChoices: () => {},
    resolveVaultForWithdraw: async () => ({ vault: null }),
    getPendingBridgeAfterWithdraw: () => null,
    setPendingBridgeAfterWithdraw: () => {},
    getPendingStrategyDraft: () => null,
    setPendingStrategyDraft: () => {},
    getEngine: () => null,
    clearPending: () => {},
    legacy: async () => false,
    ...overrides,
  }
}

test("hydrateInvestParamsWithDraft fills missing asset and decimals from selected vault", () => {
  const ctx = makeCtx()
  ctx.pendingDepositDraft.selectedVault = makeVault()

  const params: NonNullable<IntentResult["investParams"]> = {
    amount: "1",
    amountDecimals: "",
    fromChain: 8453,
    toChainConfig: [],
    searchAsset: "",
  }

  const result = hydrateInvestParamsWithDraft(params, ctx)

  assert.equal(result.amount, "1")
  assert.equal(result.searchAsset, "USDC")
  assert.equal(result.amountDecimals, "000000")
  assert.deepEqual(result.toChainConfig, [8453])
})

test("hydrateInvestParamsWithDraft preserves draft source chain and asset for amount-only follow-up", () => {
  const ctx = makeCtx()
  ctx.pendingDepositDraft.selectedVault = makeVault()
  ctx.pendingDepositDraft.investParams = {
    amount: "",
    amountDecimals: "",
    fromChain: 1,
    toChainConfig: [8453],
    searchAsset: "USDC",
  }

  const params: NonNullable<IntentResult["investParams"]> = {
    amount: "1",
    amountDecimals: "",
    fromChain: 8453,
    toChainConfig: [],
    searchAsset: "",
  }

  const result = hydrateInvestParamsWithDraft(params, ctx)

  assert.equal(result.searchAsset, "USDC")
  assert.equal(result.fromChain, 8453)
  assert.equal(result.amountDecimals, "000000")
  assert.deepEqual(result.toChainConfig, [8453])
})

test("hydrateInvestParamsWithDraft keeps selected vault asset for human amount follow-up", () => {
  const ctx = makeCtx()
  ctx.pendingDepositDraft.selectedVault = makeVault()

  const params: NonNullable<IntentResult["investParams"]> = {
    amount: "1",
    amountDecimals: "",
    fromChain: 8453,
    toChainConfig: [],
    searchAsset: "",
  }

  const result = hydrateInvestParamsWithDraft(params, ctx)

  assert.equal(result.searchAsset, "USDC")
  assert.equal(result.amountDecimals, "000000")
})
