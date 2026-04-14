import test from "node:test"
import assert from "node:assert/strict"

import { validatePlan } from "./agent-planner.ts"

test("validatePlan accepts a valid plan with dependency and condition", () => {
  const result = validatePlan({
    steps: [
      {
        id: "step_1",
        action: "compare_vaults",
        params: { asset: "USDC", limit: 3 },
      },
      {
        id: "step_2",
        action: "reply_user",
        params: { context: "best vault found" },
        dependsOn: "step_1",
        condition: { field: "vaultCount", op: "gt", value: 0 },
      },
    ],
    summary: "compare then reply",
    lang: "en",
  })

  assert.equal(result.ok, true)
  assert.equal(result.plan?.steps.length, 2)
  assert.equal(result.plan?.steps[1]?.dependsOn, "step_1")
  assert.deepEqual(result.plan?.steps[1]?.condition, {
    field: "vaultCount",
    op: "gt",
    value: 0,
  })
})

test("validatePlan rejects empty steps", () => {
  const result = validatePlan({
    steps: [],
    summary: "empty",
    lang: "en",
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, "steps_must_be_array_length_1_to_6")
})

test("validatePlan rejects more than six steps", () => {
  const result = validatePlan({
    steps: Array.from({ length: 7 }, (_, index) => ({
      id: `step_${index + 1}`,
      action: "reply_user",
      params: { context: `step ${index + 1}` },
    })),
    summary: "too many",
    lang: "en",
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, "steps_must_be_array_length_1_to_6")
})

test("validatePlan rejects unknown action types", () => {
  const result = validatePlan({
    steps: [
      {
        id: "step_1",
        action: "unknown_action",
        params: {},
      },
    ],
    summary: "bad action",
    lang: "en",
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, "invalid_action:unknown_action")
})

test("validatePlan rejects dependsOn references to non-prior steps", () => {
  const result = validatePlan({
    steps: [
      {
        id: "step_1",
        action: "reply_user",
        params: { context: "hello" },
        dependsOn: "missing_step",
      },
    ],
    summary: "bad dep",
    lang: "en",
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, "dependsOn_must_reference_prior_step:step_1")
})

test("validatePlan rejects condition fields outside whitelist", () => {
  const result = validatePlan({
    steps: [
      {
        id: "step_1",
        action: "reply_user",
        params: { context: "hello" },
        condition: { field: "walletAddress", op: "exists", value: true },
      },
    ],
    summary: "bad field",
    lang: "en",
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, "invalid_condition:step_1")
})

test("validatePlan rejects invalid condition ops", () => {
  const result = validatePlan({
    steps: [
      {
        id: "step_1",
        action: "reply_user",
        params: { context: "hello" },
        condition: { field: "vaultCount", op: "contains", value: 1 },
      },
    ],
    summary: "bad op",
    lang: "en",
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, "invalid_condition:step_1")
})

test("validatePlan forces requiresConfirm for funding actions", () => {
  const result = validatePlan({
    steps: [
      {
        id: "step_1",
        action: "build_deposit",
        params: { amount: "1", amountDecimals: "000000", fromChain: 1, asset: "USDC" },
        requiresConfirm: false,
      },
    ],
    summary: "deposit",
    lang: "en",
  })

  assert.equal(result.ok, true)
  assert.equal(result.plan?.steps[0]?.requiresConfirm, true)
})

test("validatePlan rejects missing summary", () => {
  const result = validatePlan({
    steps: [
      {
        id: "step_1",
        action: "reply_user",
        params: { context: "hello" },
      },
    ],
    summary: "   ",
    lang: "en",
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, "missing_summary")
})

test("validatePlan rejects duplicate step ids", () => {
  const result = validatePlan({
    steps: [
      {
        id: "step_1",
        action: "reply_user",
        params: { context: "hello" },
      },
      {
        id: "step_1",
        action: "reply_user",
        params: { context: "world" },
      },
    ],
    summary: "duplicate",
    lang: "en",
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, "duplicate_step_id:step_1")
})
