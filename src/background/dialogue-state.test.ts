import test from "node:test"
import assert from "node:assert/strict"

import {
  applyVaultSelection,
  cacheInvestRecommendation,
  cacheSelectedVault,
  cacheVaultChoices,
  clearPendingDepositDraft,
  createPendingDepositDraft,
  hydrateBuildDepositArgs,
  getDepositConfirmability,
  type PendingInvestParams,
} from "./dialogue-state.ts"
import type { Vault } from "~types"

function makeVault(name: string, protocolName: string, chainId = 8453): Vault {
  return {
    address: `0x${name.padEnd(40, "0").slice(0, 40)}`,
    chainId,
    name,
    analytics: { apy: { base: 0, reward: 0, total: 0 } },
    protocol: { name: protocolName },
    underlyingTokens: [],
  }
}

const investParams: PendingInvestParams = {
  amount: "500",
  amountDecimals: "000000",
  fromChain: 1,
  toChainConfig: [8453],
  searchAsset: "USDC",
}

test("compare selection preserves existing invest params for confirm", () => {
  const draft = createPendingDepositDraft()
  const initialVault = makeVault("vaulta", "aave-v3")
  const nextVault = makeVault("vaultb", "morpho-v1")

  cacheInvestRecommendation(draft, investParams, initialVault, "0xabc")
  cacheVaultChoices(draft, [initialVault, nextVault])

  const result = applyVaultSelection(draft, { selectionIndex: 2 })

  assert.equal(result.ambiguous, false)
  assert.equal(result.selectedVault?.address, nextVault.address)
  assert.deepEqual(draft.investParams, investParams)
  assert.equal(getDepositConfirmability(draft).canConfirm, true)
})

test("selection without invest params requires follow-up details instead of fake confirmability", () => {
  const draft = createPendingDepositDraft()
  const vault = makeVault("vaultc", "morpho-blue")

  cacheVaultChoices(draft, [vault])
  const result = applyVaultSelection(draft, { selectionProtocol: "morpho" })

  assert.equal(result.selectedVault?.address, vault.address)
  assert.deepEqual(getDepositConfirmability(draft), {
    canConfirm: false,
    missing: ["intent"],
  })
})

test("recommended vault is remembered even before invest params are complete", () => {
  const draft = createPendingDepositDraft()
  const vault = makeVault("vaulth", "yo-protocol")

  cacheSelectedVault(draft, vault, "0xabc")

  assert.equal(draft.selectedVault?.address, vault.address)
  assert.equal(draft.walletAddress, "0xabc")
  assert.deepEqual(getDepositConfirmability(draft), {
    canConfirm: false,
    missing: ["intent"],
  })
})

test("ambiguous protocol selection is detected", () => {
  const draft = createPendingDepositDraft()
  const vaults = [
    makeVault("vaultd", "morpho-v1"),
    makeVault("vaulte", "morpho-blue"),
  ]

  cacheVaultChoices(draft, vaults)
  const result = applyVaultSelection(draft, { selectionProtocol: "morpho" })

  assert.equal(result.selectedVault, null)
  assert.equal(result.ambiguous, true)
  assert.equal(draft.selectedVault, null)
})

test("clear resets all pending deposit state", () => {
  const draft = createPendingDepositDraft()
  cacheInvestRecommendation(draft, investParams, makeVault("vaultf", "aave-v3"), "0xabc")
  cacheVaultChoices(draft, [makeVault("vaultg", "spark")], "0xdef")

  clearPendingDepositDraft(draft)

  assert.deepEqual(draft, {
    investParams: null,
    selectedVault: null,
    vaultChoices: [],
    walletAddress: null,
  })
})

test("hydrateBuildDepositArgs fills missing deposit fields from the draft", () => {
  const draft = createPendingDepositDraft()
  const vault = makeVault("vaulth", "yo-protocol")
  cacheInvestRecommendation(draft, investParams, vault, "0xabc")

  const hydrated = hydrateBuildDepositArgs(
    { asset: "USDC" },
    draft,
    "0xabc",
  )

  assert.equal(hydrated.fromChain, investParams.fromChain)
  assert.equal(hydrated.rawAmount, `${investParams.amount}${investParams.amountDecimals}`)
  assert.equal(hydrated.vaultAddress, vault.address)
  assert.equal(hydrated.vaultChainId, vault.chainId)
  assert.equal(hydrated.walletAddress, "0xabc")
})
