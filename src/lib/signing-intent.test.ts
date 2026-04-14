import test from "node:test"
import assert from "node:assert/strict"

import { getLatestPendingTxPayload, getReusablePendingTxPayloadForText, isSignIntent, isTxAcceptanceIntent } from "./signing-intent.ts"
import type { ChatMessage } from "./pet-state.ts"

test("isSignIntent matches common signing follow-ups", () => {
  assert.equal(isSignIntent("让我签名啊"), true)
  assert.equal(isSignIntent("确认签名"), true)
  assert.equal(isSignIntent("please sign this"), true)
  assert.equal(isSignIntent("sign it"), true)
  assert.equal(isSignIntent("确认"), false)
  assert.equal(isSignIntent("可以"), false)
  assert.equal(isSignIntent("好的"), false)
  assert.equal(isSignIntent("继续看看"), false)
})

test("isTxAcceptanceIntent matches common confirmation replies", () => {
  assert.equal(isTxAcceptanceIntent("确认"), true)
  assert.equal(isTxAcceptanceIntent("可以"), true)
  assert.equal(isTxAcceptanceIntent("好的"), true)
  assert.equal(isTxAcceptanceIntent("行吧"), true)
  assert.equal(isTxAcceptanceIntent("ok"), true)
  assert.equal(isTxAcceptanceIntent("我再想想"), false)
})

test("getLatestPendingTxPayload returns the latest unfinished tx payload", () => {
  const messages: ChatMessage[] = [
    { role: "bot", text: "foo", txPayload: { to: "0x1" }, txCompleted: true },
    { role: "bot", text: "bar", txPayload: { to: "0x2" } },
    { role: "bot", text: "baz", txPayload: { to: "0x3" } },
  ]

  assert.deepEqual(getLatestPendingTxPayload(messages), { to: "0x3" })
})

test("getReusablePendingTxPayloadForText reuses the latest payload only for explicit signing replies", () => {
  const messages: ChatMessage[] = [
    { role: "bot", text: "tx", txPayload: { to: "0x123" } },
  ]

  assert.deepEqual(getReusablePendingTxPayloadForText("确认签名", messages), { to: "0x123" })
  assert.deepEqual(getReusablePendingTxPayloadForText("sign it", messages), { to: "0x123" })
  assert.equal(getReusablePendingTxPayloadForText("确认", messages), null)
  assert.equal(getReusablePendingTxPayloadForText("可以", messages), null)
  assert.equal(getReusablePendingTxPayloadForText("好的", messages), null)
  assert.equal(getReusablePendingTxPayloadForText("再说别的", messages), null)
})

test("getReusablePendingTxPayloadForText prefers explicit pending payload cache", () => {
  const messages: ChatMessage[] = []
  const cached = { to: "0xabc" }

  assert.deepEqual(getReusablePendingTxPayloadForText("让我签名", messages, cached), cached)
  assert.equal(getReusablePendingTxPayloadForText("确认", messages, cached), null)
  assert.equal(getReusablePendingTxPayloadForText("我再想想", messages, cached), null)
})
