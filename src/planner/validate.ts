import type { ExecutionPlan, PlanValidationResult, PlanStep } from "./types.ts"

function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0
}

function isPositiveChainId(v: unknown): boolean {
  const n = Number(v)
  return Number.isFinite(n) && n > 0
}

function validateSwap(step: PlanStep): PlanValidationResult {
  if (!hasText(step.params.fromToken) || !hasText(step.params.toToken)) {
    return { ok: false, reason: "Swap step is missing token information." }
  }
  if (!hasText(step.params.amount)) {
    return { ok: false, reason: "Swap step is missing an amount." }
  }
  if (!isPositiveChainId(step.params.chainId)) {
    return { ok: false, reason: "Swap step is missing a valid chainId." }
  }
  return { ok: true }
}

function validateBridge(step: PlanStep): PlanValidationResult {
  if (!hasText(step.params.token) && !hasText(step.params.fromToken)) {
    return { ok: false, reason: "Bridge step is missing token information." }
  }
  if (!hasText(step.params.amount)) {
    return { ok: false, reason: "Bridge step is missing an amount." }
  }
  if (!isPositiveChainId(step.params.fromChain) || !isPositiveChainId(step.params.toChain)) {
    return { ok: false, reason: "Bridge step is missing valid chain information." }
  }
  return { ok: true }
}

function validateDeposit(step: PlanStep): PlanValidationResult {
  if (!hasText(step.params.searchAsset)) {
    return { ok: false, reason: "Deposit step is missing a target asset." }
  }
  if (!Array.isArray(step.params.toChainConfig) || step.params.toChainConfig.length === 0) {
    return { ok: false, reason: "Deposit step is missing target chain candidates." }
  }
  if (step.params.amount !== "ALL_FROM_PREV" && !hasText(step.params.amount)) {
    return { ok: false, reason: "Deposit step is missing an amount." }
  }
  return { ok: true }
}

export function validateExecutionPlan(plan: ExecutionPlan): PlanValidationResult {
  if (plan.steps.length === 0) {
    return { ok: false, reason: "Execution plan has no steps after normalization." }
  }

  for (const step of plan.steps) {
    let result: PlanValidationResult
    if (step.action === "swap") {
      result = validateSwap(step)
    } else if (step.action === "bridge") {
      result = validateBridge(step)
    } else if (step.action === "deposit") {
      result = validateDeposit(step)
    } else {
      result = { ok: false, reason: `Unsupported step type: ${String(step.action)}` }
    }

    if (!result.ok) return result
  }

  return { ok: true }
}
