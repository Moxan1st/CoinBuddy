import type { ExecutionPlan, PlanStep } from "./types.ts"

function cloneStep(step: PlanStep): PlanStep {
  return {
    action: step.action,
    params: { ...step.params },
  }
}

function normalizeToken(token: unknown): string {
  return String(token || "").trim().toUpperCase()
}

function normalizeChainId(chainId: unknown): number | null {
  const n = Number(chainId)
  return Number.isFinite(n) && n > 0 ? n : null
}

function isNoOpSwap(step: PlanStep): boolean {
  if (step.action !== "swap") return false
  const fromToken = normalizeToken(step.params.fromToken)
  const toToken = normalizeToken(step.params.toToken)
  const chainId = normalizeChainId(step.params.chainId)
  return !!fromToken && fromToken === toToken && !!chainId
}

function isNoOpBridge(step: PlanStep): boolean {
  if (step.action !== "bridge") return false
  const fromToken = normalizeToken(step.params.token || step.params.fromToken)
  const toToken = normalizeToken(step.params.token || step.params.toToken)
  const fromChain = normalizeChainId(step.params.fromChain)
  const toChain = normalizeChainId(step.params.toChain)
  return !!fromChain && fromChain === toChain && (!!fromToken ? fromToken === toToken : true)
}

function promotePreviousOutput(nextStep: PlanStep | undefined, removedStep: PlanStep) {
  if (!nextStep || nextStep.action !== "deposit") return
  if (nextStep.params.amount !== "ALL_FROM_PREV") return

  if (removedStep.action === "swap") {
    nextStep.params.amount = removedStep.params.amount
    nextStep.params.amountDecimals = removedStep.params.amountDecimals || ""
    nextStep.params.fromChain = removedStep.params.chainId
  } else if (removedStep.action === "bridge") {
    nextStep.params.amount = removedStep.params.amount
    nextStep.params.amountDecimals = removedStep.params.amountDecimals || ""
    nextStep.params.fromChain = removedStep.params.fromChain
  }
}

export function normalizeExecutionPlan(steps: PlanStep[]): ExecutionPlan {
  const normalizedSteps = steps.map(cloneStep)
  const reasons: string[] = []
  let normalized = false

  for (let i = 0; i < normalizedSteps.length; i++) {
    const step = normalizedSteps[i]
    const nextStep = normalizedSteps[i + 1]

    if (isNoOpSwap(step)) {
      promotePreviousOutput(nextStep, step)
      normalizedSteps.splice(i, 1)
      reasons.push("Removed no-op swap because source and destination token are identical.")
      normalized = true
      i--
      continue
    }

    if (isNoOpBridge(step)) {
      promotePreviousOutput(nextStep, step)
      normalizedSteps.splice(i, 1)
      reasons.push("Removed no-op bridge because source and destination chain are identical.")
      normalized = true
      i--
    }
  }

  return { steps: normalizedSteps, reasons, normalized }
}
