import test from "node:test"
import assert from "node:assert/strict"

import { normalizePortfolioPosition, normalizePortfolioPositions } from "./portfolio-normalize.ts"

test("normalizePortfolioPosition extracts direct fields", () => {
  const summary = normalizePortfolioPosition({
    vaultAddress: "0x1234567890abcdef1234567890abcdef12345678",
    chainId: 8453,
    protocolName: "yo-protocol",
    asset: { symbol: "USDC" },
    balanceUsd: "1.23",
  })

  assert.equal(summary.vaultAddress, "0x1234567890abcdef1234567890abcdef12345678")
  assert.equal(summary.vaultChainId, 8453)
  assert.equal(summary.protocolName, "yo-protocol")
  assert.equal(summary.assetSymbol, "USDC")
  assert.equal(summary.balanceUsd, 1.23)
})

test("normalizePortfolioPosition extracts nested vault/protocol fields", () => {
  const summary = normalizePortfolioPosition({
    vault: {
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      chainId: 42161,
      protocol: { name: "morpho-blue" },
      underlyingTokens: [{ symbol: "USDT" }],
    },
    valueUsd: 42,
  })

  assert.equal(summary.vaultAddress, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
  assert.equal(summary.vaultChainId, 42161)
  assert.equal(summary.protocolName, "morpho-blue")
  assert.equal(summary.assetSymbol, "USDT")
  assert.equal(summary.balanceUsd, 42)
})

test("normalizePortfolioPosition extracts wrapped portfolio schema fields", () => {
  const summary = normalizePortfolioPosition({
    portfolioPosition: {
      chain: { id: "8453" },
      vault: {
        address: "0x1111111111111111111111111111111111111111",
        protocol: { name: "moonwell" },
        underlyingTokens: [{ symbol: "USDC" }],
      },
      valuation: { usd: "99.5" },
    },
  })

  assert.equal(summary.vaultAddress, "0x1111111111111111111111111111111111111111")
  assert.equal(summary.vaultChainId, 8453)
  assert.equal(summary.protocolName, "moonwell")
  assert.equal(summary.assetSymbol, "USDC")
  assert.equal(summary.balanceUsd, 99.5)
})

test("normalizePortfolioPosition does not treat asset address as vault address or trust top-level protocol without vault ref", () => {
  const summary = normalizePortfolioPosition({
    chainId: 8453,
    protocolName: "morpho-v1",
    asset: {
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      name: "USDC",
      symbol: "USDC",
      decimals: 6,
    },
    balanceUsd: "0.9625440318572291",
    balanceNative: "0.96241",
  })

  assert.equal(summary.vaultAddress, null)
  assert.equal(summary.vaultChainId, 8453)
  assert.equal(summary.protocolName, null)
  assert.equal(summary.assetSymbol, "USDC")
  assert.equal(summary.balanceUsd, 0.9625440318572291)
})

test("normalizePortfolioPosition keeps top-level protocol when a reliable vault address exists", () => {
  const summary = normalizePortfolioPosition({
    vaultAddress: "0x1234567890abcdef1234567890abcdef12345678",
    chainId: 8453,
    protocolName: "yo-protocol",
    asset: { symbol: "USDC" },
    balanceUsd: "0.96",
  })

  assert.equal(summary.vaultAddress, "0x1234567890abcdef1234567890abcdef12345678")
  assert.equal(summary.protocolName, "yo-protocol")
})

test("normalizePortfolioPosition keeps raw when extraction fails", () => {
  const raw = { weird: true }
  const summary = normalizePortfolioPosition(raw)

  assert.equal(summary.vaultAddress, null)
  assert.equal(summary.vaultChainId, null)
  assert.equal(summary.protocolName, null)
  assert.equal(summary.assetSymbol, null)
  assert.equal(summary.balanceUsd, null)
  assert.equal(summary.raw, raw)
})

test("normalizePortfolioPositions handles non-array input", () => {
  assert.deepEqual(normalizePortfolioPositions(null as any), [])
})
