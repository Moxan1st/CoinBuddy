import test, { mock } from "node:test"
import assert from "node:assert/strict"

import { analyzeIntent, resetLlmClientTestState } from "./llm-client.ts"

test("analyzeIntent parses a valid JSON intent response", async () => {
  resetLlmClientTestState()
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ type: "portfolio" }) }],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )

  try {
    const result = await analyzeIntent("show my positions")

    assert.equal(fetchMock.mock.calls.length, 1)
    assert.deepEqual(result, { type: "portfolio" })
  } finally {
    fetchMock.mock.restore()
  }
})

test("analyzeIntent maps 429 responses to rate limit guidance", async () => {
  resetLlmClientTestState()
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      error: { message: "Too many requests" },
    }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    }),
  )

  try {
    const result = await analyzeIntent("帮我看看 APY")

    assert.ok(fetchMock.mock.calls.length >= 1)
    assert.equal(result.type, "chat")
    assert.match(result.chatReply || "", /限流|秒/)
  } finally {
    fetchMock.mock.restore()
  }
})

test("analyzeIntent maps malformed 200 responses to parse error guidance", async () => {
  resetLlmClientTestState()
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response("{not-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )

  try {
    const result = await analyzeIntent("check my portfolio")

    assert.ok(fetchMock.mock.calls.length >= 1)
    assert.equal(result.type, "chat")
    assert.match(result.chatReply || "", /malformed output|坏掉的结果/)
  } finally {
    fetchMock.mock.restore()
  }
})

test("analyzeIntent promotes compare-then-act requests to needs_plan when LLM returns invest without params", async () => {
  resetLlmClientTestState()
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ type: "invest" }) }],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )

  try {
    const result = await analyzeIntent("find the best vault in the Base chain and I want to put 1 USDC in it")

    assert.ok(fetchMock.mock.calls.length >= 1)
    assert.equal(result.type, "needs_plan")
    assert.match(result.rawIntent || "", /best vault/i)
  } finally {
    fetchMock.mock.restore()
  }
})

test("analyzeIntent promotes compare-then-act requests to needs_plan when LLM returns compare", async () => {
  resetLlmClientTestState()
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ type: "compare" }) }],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )

  try {
    const result = await analyzeIntent("find the best vault in the Base chain and I want to put 1 USDC in it")

    assert.ok(fetchMock.mock.calls.length >= 1)
    assert.equal(result.type, "needs_plan")
  } finally {
    fetchMock.mock.restore()
  }
})

test("analyzeIntent still falls back to compare for exploration-only requests without invest params", async () => {
  resetLlmClientTestState()
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ type: "invest" }) }],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )

  try {
    const result = await analyzeIntent("find the best vault on Base")

    assert.ok(fetchMock.mock.calls.length >= 1)
    assert.equal(result.type, "compare")
    assert.equal(result.compareParams?.chainId, 8453)
  } finally {
    fetchMock.mock.restore()
  }
})

test("analyzeIntent promotes sign follow-up requests to execute", async () => {
  resetLlmClientTestState()
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ type: "confirm" }) }],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )

  try {
    const result = await analyzeIntent("让我签名啊")

    assert.ok(fetchMock.mock.calls.length >= 1)
    assert.equal(result.type, "execute")
  } finally {
    fetchMock.mock.restore()
  }
})

test("analyzeIntent rescues incomplete bridge params from user text", async () => {
  resetLlmClientTestState()
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ type: "bridge", bridgeParams: { amount: "2", fromChain: 8453, toChain: 10 } }) }],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )

  try {
    const result = await analyzeIntent("我有 2 个 USDT 在 Base，bridge Optimism")

    assert.ok(fetchMock.mock.calls.length >= 1)
    assert.equal(result.type, "bridge")
    assert.equal(result.bridgeParams?.token, "USDT")
    assert.equal(result.bridgeParams?.amount, "2")
    assert.equal(result.bridgeParams?.fromChain, 8453)
    assert.equal(result.bridgeParams?.toChain, 10)
    assert.equal(result.bridgeParams?.amountDecimals, "000000")
  } finally {
    fetchMock.mock.restore()
  }
})
