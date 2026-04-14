import test from "node:test"
import assert from "node:assert/strict"

import { CoinBuddyBrain } from "../brain.ts"
import type { SearchVaultsData } from "./types.ts"
import { getAvailableTools, getTool } from "./tool-registry.ts"

function makeVault(address: string, apy: number, chainId = 8453) {
  return {
    address,
    chainId,
    name: `Vault ${address.slice(-4)}`,
    network: "Base",
    protocol: { name: "TestProtocol", url: "https://example.com" },
    analytics: {
      apy: { base: apy - 0.5, reward: 0.5, total: apy },
      tvl: { usd: String(1_000_000 + apy * 10_000) },
      updatedAt: "2026-01-01T00:00:00Z",
    },
    underlyingTokens: [{ address: "0x0000000000000000000000000000000000000001", symbol: "USDC", decimals: 6 }],
    tags: ["single"],
    isTransactional: true,
    isRedeemable: true,
  }
}

test("getAvailableTools exposes the expected registry surface", () => {
  const tools = getAvailableTools()
  const names = tools.map((tool) => tool.name)

  assert.deepEqual(names, [
    "search_vaults",
    "get_vault_detail",
    "check_balance",
    "build_deposit",
    "build_withdraw",
    "build_bridge",
    "fetch_portfolio",
    "fetch_price",
  ])

  const buildDeposit = getTool("build_deposit")
  assert.ok(buildDeposit)
  assert.equal(buildDeposit?.inputSchema.type, "object")
  assert.equal(buildDeposit?.safety.requiresWallet, true)
  assert.equal(buildDeposit?.safety.buildsTransaction, true)
  assert.equal(buildDeposit?.safety.requiresConfirm, true)
})

test("getTool returns undefined for unknown tools", () => {
  assert.equal(getTool("unknown_tool"), undefined)
})

test("search_vaults returns ranked vaults with count and bestVault", async () => {
  const original = CoinBuddyBrain.fetchVaultComparison
  CoinBuddyBrain.fetchVaultComparison = async () => [
    makeVault("0x2222222222222222222222222222222222222222", 4.1),
    makeVault("0x1111111111111111111111111111111111111111", 5.2),
  ]

  try {
    const tool = getTool("search_vaults")
    assert.ok(tool)

    const result = await tool.run(
      { chainId: 8453, asset: "USDC", limit: 10 },
      { lang: "en", userText: "put 1 USDC in best vault on Base" },
    )

    assert.equal(result.ok, true)
    if (!result.ok) return
    const data = result.data as SearchVaultsData

    assert.equal(result.toolName, "search_vaults")
    assert.equal(data.count, 2)
    assert.equal(data.vaults.length, 2)
    assert.equal(data.bestVault?.address, "0x1111111111111111111111111111111111111111")
    assert.equal(data.bestVault?.apy.total, 5.2)
    assert.equal(data.query.asset, "USDC")
    assert.equal(data.query.chainId, 8453)
    assert.equal(result.meta.durationMs >= 0, true)
  } finally {
    CoinBuddyBrain.fetchVaultComparison = original
  }
})

test("check_balance schema supports optional requiredAmount", () => {
  const tool = getTool("check_balance")
  assert.ok(tool)
  assert.equal(tool?.inputSchema.properties.requiredAmount.type, "string")
  assert.equal(tool?.inputSchema.properties.chainId.type, "integer")
  assert.equal(tool?.safety.requiresWallet, true)
  assert.equal(tool?.safety.readOnly, true)
})

test("search_vaults supports broad exploration without an asset filter", async () => {
  const original = CoinBuddyBrain.fetchVaultComparison
  const seen: Array<{ chainId?: number; asset?: string }> = []
  CoinBuddyBrain.fetchVaultComparison = async (params) => {
    seen.push({ chainId: params.chainId, asset: params.asset })
    return [
      makeVault("0x3333333333333333333333333333333333333333", 6.1, params.chainId || 8453),
    ]
  }

  try {
    const tool = getTool("search_vaults")
    assert.ok(tool)

    const result = await tool.run(
      { chainId: 8453, limit: 5 },
      { lang: "en", userText: "find the best vault on Base" },
    )

    assert.equal(result.ok, true)
    if (!result.ok) return

    const data = result.data as SearchVaultsData
    assert.equal(data.query.asset, null)
    assert.equal(data.query.chainIds[0], 8453)
    assert.equal(data.bestVault?.chainId, 8453)
    assert.equal(seen[0]?.asset, undefined)
  } finally {
    CoinBuddyBrain.fetchVaultComparison = original
  }
})

test("build_deposit infers missing chain and amount fields from the vault and user text", async () => {
  const original = CoinBuddyBrain.buildDepositTransaction
  let captured: { fromChain: number; rawAmount: string } | null = null
  CoinBuddyBrain.buildDepositTransaction = async (fromChain, vault, _walletAddress, rawAmount) => {
    captured = { fromChain, rawAmount }
    assert.equal(vault.address, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    return { to: "0xdeposit", data: "0x123" }
  }

  try {
    const tool = getTool("build_deposit")
    assert.ok(tool)

    const result = await tool.run(
      {
        vault: {
          address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chainId: 8453,
          underlyingTokens: [{ address: "0x1", symbol: "USDC", decimals: 6 }],
        },
      },
      {
        lang: "en",
        userText: "find the best vault on Base and put 1 USDC in it",
        walletAddress: "0xabc",
      },
    )

    assert.equal(result.ok, true)
    assert.deepEqual(captured, { fromChain: 8453, rawAmount: "1000000" })
  } finally {
    CoinBuddyBrain.buildDepositTransaction = original
  }
})
