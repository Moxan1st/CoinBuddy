import test from "node:test"
import assert from "node:assert/strict"

import { getWalletGateReason } from "./wallet-gate.ts"

test("portfolio requires wallet", () => {
  assert.equal(getWalletGateReason({ type: "portfolio" }), "portfolio")
})

test("swap without params does not require wallet yet", () => {
  assert.equal(getWalletGateReason({ type: "swap" }), null)
})

test("swap with params requires wallet", () => {
  assert.equal(
    getWalletGateReason({
      type: "swap",
      swapParams: { fromToken: "USDC", toToken: "USDT", amount: "1" },
    }),
    "swap",
  )
})

test("bridge without params does not require wallet yet", () => {
  assert.equal(getWalletGateReason({ type: "bridge" }), null)
})

test("bridge with params requires wallet", () => {
  assert.equal(
    getWalletGateReason({
      type: "bridge",
      bridgeParams: { token: "USDC", amount: "1", fromChain: 8453, toChain: 42161 },
    }),
    "bridge",
  )
})

test("confirm with pending strategy draft does not require wallet", () => {
  assert.equal(
    getWalletGateReason(
      { type: "confirm" },
      { hasPendingStrategyDraft: true, canConfirmDeposit: true },
    ),
    null,
  )
})

test("confirm with executable deposit requires wallet", () => {
  assert.equal(
    getWalletGateReason(
      { type: "confirm" },
      { canConfirmDeposit: true },
    ),
    "confirm",
  )
})

test("confirm without executable context does not require wallet", () => {
  assert.equal(
    getWalletGateReason(
      { type: "confirm" },
      { canConfirmDeposit: false, hasPendingBridgeAfterWithdraw: false },
    ),
    null,
  )
})

test("confirm with pending transaction payload takes execute path", () => {
  assert.equal(
    getWalletGateReason(
      { type: "confirm" },
      { canConfirmDeposit: true, hasPendingTransactionPayload: true },
    ),
    "execute",
  )
})

test("execute with pending transaction requires wallet", () => {
  assert.equal(
    getWalletGateReason(
      { type: "execute" },
      { hasPendingTransactionPayload: true },
    ),
    "execute",
  )
})

test("execute without pending transaction does not require wallet", () => {
  assert.equal(
    getWalletGateReason(
      { type: "execute" },
      { hasPendingTransactionPayload: false },
    ),
    null,
  )
})

test("withdraw always requires wallet", () => {
  assert.equal(getWalletGateReason({ type: "withdraw" }), "withdraw")
})

test("withdraw_bridge always requires wallet", () => {
  assert.equal(getWalletGateReason({ type: "withdraw_bridge" }), "withdraw_bridge")
})

test("single deposit composite does not require wallet before planning", () => {
  assert.equal(
    getWalletGateReason({
      type: "composite",
      compositeSteps: [{ action: "deposit" }],
    }),
    null,
  )
})

test("multi-step composite requires wallet", () => {
  assert.equal(
    getWalletGateReason({
      type: "composite",
      compositeSteps: [{ action: "bridge" }, { action: "deposit" }],
    }),
    "composite",
  )
})
