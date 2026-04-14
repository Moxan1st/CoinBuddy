import test from "node:test"
import assert from "node:assert/strict"

import {
  canFallbackToSequentialBatch,
  describePendingPopupTransaction,
  describePopupCall,
  formatPopupWalletError,
  normalizePendingPopupTransaction,
  selectPreferredPopupConnector,
  splitSequentialBatchCalls,
  shouldFallbackToSingleSend,
} from "./popup-transaction.ts"

test("normalizePendingPopupTransaction normalizes batch and single payloads", () => {
  const batch = normalizePendingPopupTransaction({
    isBatch: true,
    chainId: "8453",
    calls: [{ to: "0x0000000000000000000000000000000000000001", data: "0x1234", value: "0" }],
  })
  assert.equal(batch?.kind, "batch")
  assert.equal(batch?.chainId, 8453)
  assert.equal(batch?.calls.length, 1)
  assert.equal(batch?.calls[0].to, "0x0000000000000000000000000000000000000001")

  const single = normalizePendingPopupTransaction({
    chainId: 8453,
    to: "0x0000000000000000000000000000000000000002",
    data: "0x",
    value: "1000",
  })
  assert.equal(single?.kind, "single")
  assert.equal(single?.calls.length, 1)
})

test("shouldFallbackToSingleSend only enables one-call batches", () => {
  const batch = normalizePendingPopupTransaction({
    isBatch: true,
    calls: [{ to: "0x0000000000000000000000000000000000000001", data: "0x", value: "0" }],
  })
  assert.equal(batch ? shouldFallbackToSingleSend(batch) : false, true)
})

test("formatPopupWalletError flags rejected errors as non-retryable", () => {
  const error = formatPopupWalletError(
    { shortMessage: "User rejected the request" },
    { isBatch: true, callCount: 2 },
  )
  assert.equal(error.retryable, false)
  assert.equal(error.code, "batch_send_failed")
})

test("selectPreferredPopupConnector prefers current connector then injected", () => {
  const connectors = [
    { id: "coinbaseWalletSDK", name: "Coinbase Smart Wallet" },
    { id: "injected", name: "MetaMask" },
    { id: "walletConnect", name: "WalletConnect" },
  ]

  assert.equal(selectPreferredPopupConnector(connectors, connectors[2])?.id, "walletConnect")
  assert.equal(selectPreferredPopupConnector(connectors)?.id, "injected")
})

test("batch fallback helpers recognize two-step approve/deposit flows", () => {
  const batch = normalizePendingPopupTransaction({
    isBatch: true,
    calls: [
      { to: "0x0000000000000000000000000000000000000001", data: "0x095ea7b3000000000000000000000000000000000000000000000000000000000000000001", value: "0" },
      { to: "0x0000000000000000000000000000000000000002", data: "0xabcdef", value: "0" },
    ],
  })
  assert.equal(batch ? canFallbackToSequentialBatch(batch) : false, true)
  assert.equal(batch ? describePopupCall(batch.calls[0], 0, batch.calls.length) : "", "Step 1/2: approve token")
  assert.equal(batch ? describePopupCall(batch.calls[1], 1, batch.calls.length) : "", "Step 2/2: deposit")
  assert.equal(batch ? splitSequentialBatchCalls(batch).length : 0, 2)
})

test("describePendingPopupTransaction prefers display metadata", () => {
  const normalized = normalizePendingPopupTransaction({
    isBatch: true,
    chainId: 8453,
    calls: [
      { to: "0x0000000000000000000000000000000000000001", data: "0x095ea7b3", value: "0" },
      { to: "0x0000000000000000000000000000000000000002", data: "0xabcdef", value: "0" },
    ],
    display: {
      title: "Deposit 1 USDC into yo-protocol USDC vault",
      subtitle: "Vault chain: Base | Source chain: Base",
      chainId: 8453,
      chainName: "Base",
      vaultName: "USDC vault",
      protocolName: "yo-protocol",
      vaultAddress: "0x0000000000000000000000000000000000000002",
      asset: "USDC",
      amount: "1",
      steps: ["1. Approve USDC for yo-protocol", "2. Deposit into yo-protocol vault"],
      note: "Approve + deposit will be sent as a two-step batch",
    },
  })
  const summary = normalized ? describePendingPopupTransaction(normalized) : null
  assert.equal(summary?.title, "Deposit 1 USDC into yo-protocol USDC vault")
  assert.equal(summary?.vaultLabel, "yo-protocol • USDC vault")
  assert.equal(summary?.chainLabel, "Base")
  assert.equal(summary?.steps[0], "1. Approve USDC for yo-protocol")
  assert.equal(summary?.amount, "1")
})

test("describePendingPopupTransaction shows bridge display metadata", () => {
  const normalized = normalizePendingPopupTransaction({
    isBatch: true,
    chainId: 8453,
    calls: [
      { to: "0x0000000000000000000000000000000000000001", data: "0x095ea7b3", value: "0" },
      { to: "0x0000000000000000000000000000000000000002", data: "0xabcdef", value: "0" },
    ],
    display: {
      title: "Bridge 2 USDT to Optimism",
      subtitle: "Base -> Optimism",
      chainId: 8453,
      chainName: "Base",
      sourceChainId: 8453,
      sourceChainName: "Base",
      asset: "USDT",
      amount: "2",
      steps: ["1. Approve USDT for bridge router", "2. Bridge to Optimism"],
      note: "Approve + bridge will be sent as a two-step batch",
    },
  })
  const summary = normalized ? describePendingPopupTransaction(normalized) : null
  assert.equal(summary?.title, "Bridge 2 USDT to Optimism")
  assert.equal(summary?.chainLabel, "Base")
  assert.equal(summary?.steps[1], "2. Bridge to Optimism")
  assert.equal(summary?.amount, "2")
})
