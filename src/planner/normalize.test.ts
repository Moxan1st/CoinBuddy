import test from "node:test"
import assert from "node:assert/strict"

import { normalizeExecutionPlan, validateExecutionPlan } from "./index.ts"

test("normalizer removes no-op USDC->USDC swap and promotes amount into deposit", () => {
  const plan = normalizeExecutionPlan([
    {
      action: "swap",
      params: {
        fromToken: "USDC",
        toToken: "USDC",
        amount: "2",
        amountDecimals: "000000",
        chainId: 1,
      },
    },
    {
      action: "deposit",
      params: {
        searchAsset: "USDC",
        toChainConfig: [8453],
        amount: "ALL_FROM_PREV",
      },
    },
  ])

  assert.equal(plan.normalized, true)
  assert.equal(plan.steps.length, 1)
  assert.equal(plan.steps[0].action, "deposit")
  assert.equal(plan.steps[0].params.amount, "2")
  assert.equal(plan.steps[0].params.amountDecimals, "000000")
  assert.equal(plan.steps[0].params.fromChain, 1)
  assert.equal(validateExecutionPlan(plan).ok, true)
})

test("normalizer removes same-chain bridge and keeps deposit valid", () => {
  const plan = normalizeExecutionPlan([
    {
      action: "bridge",
      params: {
        token: "USDC",
        amount: "10",
        amountDecimals: "000000",
        fromChain: 8453,
        toChain: 8453,
      },
    },
    {
      action: "deposit",
      params: {
        searchAsset: "USDC",
        toChainConfig: [8453],
        amount: "ALL_FROM_PREV",
      },
    },
  ])

  assert.equal(plan.steps.length, 1)
  assert.equal(plan.steps[0].action, "deposit")
  assert.equal(plan.steps[0].params.amount, "10")
  assert.equal(plan.steps[0].params.fromChain, 8453)
})

test("validator rejects an empty plan after normalization", () => {
  const plan = normalizeExecutionPlan([
    {
      action: "swap",
      params: {
        fromToken: "USDC",
        toToken: "USDC",
        amount: "2",
        amountDecimals: "000000",
        chainId: 1,
      },
    },
  ])

  const result = validateExecutionPlan(plan)
  assert.equal(result.ok, false)
  assert.match(result.reason || "", /no steps/i)
})
