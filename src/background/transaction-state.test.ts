import test from "node:test"
import assert from "node:assert/strict"

import {
  clearPendingTransactionPayload,
  getPendingTransactionPayload,
  getPendingTransactionPayloadFromStorage,
  setPendingTransactionPayload,
} from "./transaction-state.ts"

test("pending transaction payload can be cached and cleared", () => {
  clearPendingTransactionPayload()

  const stored = setPendingTransactionPayload(
    { to: "0xabc", data: "0x123" },
    "让我签名啊",
  )

  assert.ok(stored)
  assert.deepEqual(getPendingTransactionPayload()?.transactionPayload, { to: "0xabc", data: "0x123" })
  assert.equal(getPendingTransactionPayload()?.sourceText, "让我签名啊")

  clearPendingTransactionPayload()
  assert.equal(getPendingTransactionPayload(), null)
})

test("pending transaction payload can be hydrated from storage", async () => {
  const stored = await getPendingTransactionPayloadFromStorage({
    get: async () => ({
      coinbuddy_pending_tx: { to: "0xdef", data: "0x456" },
    }),
  })

  assert.ok(stored)
  assert.deepEqual(stored?.transactionPayload, { to: "0xdef", data: "0x456" })
  assert.equal(stored?.sourceText, "chrome.storage.local.coinbuddy_pending_tx")
})
