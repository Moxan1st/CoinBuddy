import test from "node:test"
import assert from "node:assert/strict"

import {
  getTokenDecimals,
  resolveChainId,
  resolveTokenAddress,
} from "./chain-config.ts"

test("resolveChainId handles aliases and casing", () => {
  assert.equal(resolveChainId(" Base "), 8453)
  assert.equal(resolveChainId("arb"), 42161)
  assert.equal(resolveChainId("unknown"), undefined)
})

test("resolveTokenAddress returns address by symbol and chain", () => {
  assert.equal(
    resolveTokenAddress("usdc", 8453),
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  )
  assert.equal(resolveTokenAddress("USDC", 999999), null)
})

test("getTokenDecimals falls back to 18 for unknown tokens", () => {
  assert.equal(getTokenDecimals("USDC"), 6)
  assert.equal(getTokenDecimals("mystery"), 18)
})
