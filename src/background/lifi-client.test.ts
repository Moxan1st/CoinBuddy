import test, { mock } from "node:test"
import assert from "node:assert/strict"

import { buildBridgeTransaction, buildDepositTransaction } from "./lifi-client.ts"
import type { Vault } from "~types"

function makeVault(overrides: Partial<Vault> = {}): Vault {
  return {
    address: "0xvault000000000000000000000000000000000000",
    chainId: 8453,
    name: "ETH Vault",
    protocol: { name: "TestProtocol" },
    analytics: { apy: { base: 1, reward: 0, total: 1 }, tvl: { usd: "1000000" } },
    underlyingTokens: [
      { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", decimals: 18 },
    ],
    tags: ["single"],
    isTransactional: true,
    isRedeemable: true,
    ...overrides,
  }
}

test("buildDepositTransaction returns a single tx payload for native ETH vaults", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get("fromToken"), "0x0000000000000000000000000000000000000000")
    assert.equal(url.searchParams.get("fromChain"), "8453")
    assert.equal(url.searchParams.get("toChain"), "8453")
    return new Response(JSON.stringify({
      transactionRequest: {
        to: "0xrouter000000000000000000000000000000000000",
        data: "0x1234",
        value: "0xde0b6b3a7640000",
        chainId: 8453,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })

  try {
    const tx = await buildDepositTransaction(8453, makeVault(), "0xabc0000000000000000000000000000000000000", "1000000000000000000")
    assert.ok(tx)
    assert.equal(tx?.isBatch, undefined)
    assert.equal(tx?.chainId, 8453)
    assert.equal(tx?.to, "0xrouter000000000000000000000000000000000000")
    assert.equal(tx?.data, "0x1234")
    assert.equal(tx?.value, "1000000000000000000")
    assert.equal(tx?.quoteSummary?.action, "deposit")
    assert.equal(tx?.quoteSummary?.fromChain, 8453)
    assert.equal(tx?.display?.title, "Deposit 1 ETH into TestProtocol • ETH Vault")
    assert.equal(tx?.display?.chainName, "Base")
    assert.equal(tx?.display?.steps?.[0], "1. Deposit into TestProtocol vault")
  } finally {
    fetchMock.mock.restore()
  }
})

test("buildDepositTransaction prefers the vault token address when present and batches approval", async () => {
  const wethAddress = "0x4200000000000000000000000000000000000006"
  const fetchMock = mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get("fromToken"), wethAddress)
    assert.equal(url.searchParams.get("fromChain"), "8453")
    assert.equal(url.searchParams.get("toChain"), "8453")
    return new Response(JSON.stringify({
      transactionRequest: {
        to: "0xrouter000000000000000000000000000000000000",
        data: "0x1234",
        value: "0x0",
        chainId: 8453,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })

  try {
    const tx = await buildDepositTransaction(8453, makeVault({
      underlyingTokens: [{ address: wethAddress, symbol: "ETH", decimals: 18 }],
    }), "0xabc0000000000000000000000000000000000000", "1000000000000000000")

    assert.ok(tx)
    assert.equal(tx?.isBatch, true)
    assert.equal(tx?.chainId, 8453)
    assert.equal(tx?.calls?.length, 2)
    assert.equal(tx?.calls?.[0]?.to, wethAddress)
    assert.equal(tx?.calls?.[1]?.to, "0xrouter000000000000000000000000000000000000")
    assert.equal(tx?.quoteSummary?.action, "deposit")
    assert.equal(tx?.quoteSummary?.fromToken, "ETH")
    assert.equal(tx?.display?.title, "Deposit 1 ETH into TestProtocol • ETH Vault")
    assert.equal(tx?.display?.steps?.[0], "1. Approve ETH for TestProtocol")
    assert.equal(tx?.display?.steps?.[1], "2. Deposit into TestProtocol vault")
  } finally {
    fetchMock.mock.restore()
  }
})

test("buildDepositTransaction enables destination calls for vault deposits", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get("allowDestinationCall"), "true")
    assert.equal(url.searchParams.get("integrator"), "coinbuddy")
    assert.equal(url.searchParams.get("slippage"), "0.005")
    return new Response(JSON.stringify({
      transactionRequest: {
        to: "0xrouter000000000000000000000000000000000000",
        data: "0x1234",
        value: "0x0",
        chainId: 8453,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })

  try {
    const tx = await buildDepositTransaction(
      8453,
      makeVault({
        underlyingTokens: [{ address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 }],
      }),
      "0xabc0000000000000000000000000000000000000",
      "1000000",
      "USDC",
    )
    assert.ok(tx)
  } finally {
    fetchMock.mock.restore()
  }
})

test("buildDepositTransaction uses the caller asset symbol for composable swap-plus-deposit", async () => {
  const usdcAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
  const usdtAddress = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"
  const fetchMock = mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get("fromToken")?.toLowerCase(), usdtAddress.toLowerCase())
    assert.equal(url.searchParams.get("toToken"), "0xvault000000000000000000000000000000000000")
    return new Response(JSON.stringify({
      transactionRequest: {
        to: "0xrouter000000000000000000000000000000000000",
        data: "0x1234",
        value: "0x0",
        chainId: 8453,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })

  try {
    const tx = await buildDepositTransaction(
      8453,
      makeVault({
        name: "USDC Vault",
        underlyingTokens: [{ address: usdcAddress, symbol: "USDC", decimals: 6 }],
      }),
      "0xabc0000000000000000000000000000000000000",
      "2000000",
      "USDT",
    )
    assert.ok(tx)
    assert.equal(tx?.isBatch, true)
    assert.equal(tx?.calls?.[0]?.to.toLowerCase(), usdtAddress.toLowerCase())
    assert.equal(tx?.display?.title, "Deposit 2 USDT into TestProtocol • USDC Vault")
  } finally {
    fetchMock.mock.restore()
  }
})

test("buildBridgeTransaction returns display metadata for bridge flows", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      transactionRequest: {
        to: "0xrouter000000000000000000000000000000000000",
        data: "0x1234",
        value: "0x0",
        chainId: 8453,
      },
      estimate: {
        toAmount: "1990000",
        toAmountMin: "1980000",
        toToken: { decimals: 6 },
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )

  try {
    const result = await buildBridgeTransaction(
      "USDT",
      8453,
      10,
      "0xabc0000000000000000000000000000000000000",
      "2000000",
    )
    assert.ok(result)
    assert.equal(result?.txPayload.display?.title, "Bridge 2 USDT to Optimism")
    assert.equal(result?.txPayload.display?.subtitle, "Base -> Optimism")
    assert.equal(result?.txPayload.display?.steps?.[1], "2. Bridge to Optimism")
  } finally {
    fetchMock.mock.restore()
  }
})
