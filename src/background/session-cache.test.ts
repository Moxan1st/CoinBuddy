import test from "node:test"
import assert from "node:assert/strict"

import {
  clearPortfolioSnapshot,
  clearWalletSession,
  getPortfolioSnapshot,
  getWalletSession,
  isPortfolioFresh,
  setPortfolioSnapshot,
  setWalletSession,
} from "./session-cache.ts"

test("wallet session can be set and read", () => {
  clearWalletSession()
  setWalletSession("0x1234567890abcdef1234567890abcdef12345678")
  const wallet = getWalletSession()
  assert.equal(wallet.walletAddress, "0x1234567890abcdef1234567890abcdef12345678")
  assert.equal(typeof wallet.updatedAt, "number")
})

test("portfolio snapshot can be set and read", () => {
  clearWalletSession()
  setPortfolioSnapshot("0x1234567890abcdef1234567890abcdef12345678", [
    {
      vaultAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      vaultChainId: 8453,
      protocolName: "yo-protocol",
      assetSymbol: "USDC",
      balanceUsd: 1,
      raw: {},
    },
  ])
  const snapshot = getPortfolioSnapshot()
  assert.equal(snapshot.walletAddress, "0x1234567890abcdef1234567890abcdef12345678")
  assert.equal(snapshot.positions.length, 1)
  assert.equal(snapshot.positions[0].protocolName, "yo-protocol")
})

test("portfolio freshness depends on wallet match and fetchedAt", () => {
  clearWalletSession()
  clearPortfolioSnapshot()
  setPortfolioSnapshot("0x1234567890abcdef1234567890abcdef12345678", [])
  assert.equal(isPortfolioFresh("0x1234567890abcdef1234567890abcdef12345678", 1_000), true)
  assert.equal(isPortfolioFresh("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", 1_000), false)
})

test("changing wallet clears previous portfolio snapshot", () => {
  clearWalletSession()
  clearPortfolioSnapshot()
  setPortfolioSnapshot("0x1234567890abcdef1234567890abcdef12345678", [
    {
      vaultAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      vaultChainId: 8453,
      protocolName: "yo-protocol",
      assetSymbol: "USDC",
      balanceUsd: 1,
      raw: {},
    },
  ])
  setWalletSession("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
  const snapshot = getPortfolioSnapshot()
  assert.equal(snapshot.walletAddress, null)
  assert.equal(snapshot.positions.length, 0)
})
