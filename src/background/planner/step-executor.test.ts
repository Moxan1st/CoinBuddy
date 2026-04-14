import test from "node:test"
import assert from "node:assert/strict"

import { evaluateCondition, resolveParams } from "./step-executor.ts"
import type { PlanCondition, StepOutput } from "../../types/index.ts"

function stepOutput(data: Record<string, unknown>): StepOutput {
  return { ok: true, data }
}

test("evaluateCondition supports numeric gt true", () => {
  const condition: PlanCondition = { field: "bestApy", op: "gt", value: 5 }
  assert.equal(evaluateCondition(condition, stepOutput({ bestApy: 10 })), true)
})

test("evaluateCondition supports numeric gt false", () => {
  const condition: PlanCondition = { field: "bestApy", op: "gt", value: 10 }
  assert.equal(evaluateCondition(condition, stepOutput({ bestApy: 5 })), false)
})

test("evaluateCondition supports lte", () => {
  const condition: PlanCondition = { field: "price", op: "lte", value: 10 }
  assert.equal(evaluateCondition(condition, stepOutput({ price: 5 })), true)
})

test("evaluateCondition supports eq for strings", () => {
  const condition: PlanCondition = { field: "sufficient", op: "eq", value: "abc" }
  assert.equal(evaluateCondition(condition, stepOutput({ sufficient: "abc" })), true)
})

test("evaluateCondition supports exists for non-null values", () => {
  const condition: PlanCondition = { field: "count", op: "exists", value: true }
  assert.equal(evaluateCondition(condition, stepOutput({ count: 0 })), true)
})

test("evaluateCondition returns false for null with exists", () => {
  const condition: PlanCondition = { field: "count", op: "exists", value: true }
  assert.equal(evaluateCondition(condition, stepOutput({ count: null })), false)
})

test("evaluateCondition rejects fields outside whitelist", () => {
  const condition = { field: "wallet", op: "exists", value: true } as PlanCondition
  assert.equal(evaluateCondition(condition, stepOutput({ wallet: "0xabc" })), false)
})

test("evaluateCondition returns false for NaN comparisons", () => {
  const condition: PlanCondition = { field: "bestApy", op: "gt", value: 1 }
  assert.equal(evaluateCondition(condition, stepOutput({ bestApy: "not-a-number" })), false)
})

test("resolveParams returns params unchanged when there are no references", () => {
  const completedSteps = new Map<string, StepOutput>()
  const params = { asset: "USDC", chainId: 8453 }

  assert.deepEqual(resolveParams(params, completedSteps), params)
})

test("resolveParams resolves simple step references", () => {
  const completedSteps = new Map<string, StepOutput>([
    ["step_1", stepOutput({ bestApy: 12.34 })],
  ])

  assert.deepEqual(resolveParams({ apy: "$step_1.bestApy" }, completedSteps), { apy: 12.34 })
})

test("resolveParams preserves unresolved references", () => {
  const completedSteps = new Map<string, StepOutput>()

  assert.deepEqual(
    resolveParams({ apy: "$step_9.bestApy" }, completedSteps),
    { apy: "$step_9.bestApy" },
  )
})

test("resolveParams resolves nested object references", () => {
  const completedSteps = new Map<string, StepOutput>([
    ["step_1", stepOutput({ vaultAddress: "0xvault", vaultChainId: 8453 })],
  ])

  assert.deepEqual(
    resolveParams({
      deposit: {
        vaultAddress: "$step_1.vaultAddress",
        vaultChainId: "$step_1.vaultChainId",
      },
    }, completedSteps),
    {
      deposit: {
        vaultAddress: "0xvault",
        vaultChainId: 8453,
      },
    },
  )
})
