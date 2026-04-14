import { CHAIN_NAMES } from "../../lib/chain-config.ts"
import { createLogger } from "../../lib/logger.ts"
import type {
  AgentExecutionPlan,
  PlanCondition,
  PlanExecutionState,
  StepOutput,
} from "../../types/index.ts"
import type { HandlerContext } from "../handlers/types.ts"
import { getAction } from "./action-registry.ts"

const logger = createLogger("StepExecutor")

const ALLOWED_CONDITION_FIELDS = new Set([
  "bestApy",
  "vaultCount",
  "price",
  "balance",
  "sufficient",
  "isRedeemable",
  "apy",
  "count",
  "priceUsd",
  "bestChainId",
  "bestBalance",
  "bestValueUsd",
])

let pendingPlanExecution: PlanExecutionState | null = null

function getDepField(completedSteps: Map<string, StepOutput>, stepId: string, fieldName: string): unknown {
  return completedSteps.get(stepId)?.data?.[fieldName]
}

function resolveParamValue(
  value: unknown,
  completedSteps: Map<string, StepOutput>,
  depth = 0,
): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\$(\w+)\.(\w+)$/)
    if (match) {
      const resolved = getDepField(completedSteps, match[1], match[2])
      return typeof resolved === "undefined" ? value : resolved
    }
    return value
  }

  if (depth >= 2) return value

  if (Array.isArray(value)) {
    return value.map((item) => resolveParamValue(item, completedSteps, depth + 1))
  }

  if (typeof value === "object" && value !== null) {
    const resolved: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      resolved[key] = resolveParamValue(nested, completedSteps, depth + 1)
    }
    return resolved
  }

  return value
}

export function resolveParams(
  params: Record<string, unknown>,
  completedSteps: Map<string, StepOutput>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = resolveParamValue(value, completedSteps)
  }
  return resolved
}

export function evaluateCondition(cond: PlanCondition, stepOutput: StepOutput): boolean {
  if (!ALLOWED_CONDITION_FIELDS.has(cond.field)) return false

  try {
    const actual = stepOutput.data?.[cond.field]
    if (cond.op === "exists") {
      return actual !== null && typeof actual !== "undefined"
    }

    if (cond.op === "eq") {
      const actualNum = Number(actual)
      const expectedNum = Number(cond.value)
      if (Number.isFinite(actualNum) && Number.isFinite(expectedNum)) {
        return actualNum === expectedNum
      }
      return actual === cond.value
    }

    const actualNum = Number(actual)
    const expectedNum = Number(cond.value)
    if (!Number.isFinite(actualNum) || !Number.isFinite(expectedNum)) return false

    switch (cond.op) {
      case "gt":
        return actualNum > expectedNum
      case "lt":
        return actualNum < expectedNum
      case "gte":
        return actualNum >= expectedNum
      case "lte":
        return actualNum <= expectedNum
      default:
        return false
    }
  } catch {
    return false
  }
}

function previewForStep(
  stepIndex: number,
  totalSteps: number,
  stepAction: string,
  params: Record<string, unknown>,
  lang: "zh" | "en",
): string {
  const chainName = (chainId: unknown) => {
    const id = Number(chainId)
    return Number.isFinite(id) ? (CHAIN_NAMES[id] || `Chain ${id}`) : "unknown"
  }

  if (stepAction === "build_deposit") {
    return lang === "zh"
      ? `喵～计划第 ${stepIndex}/${totalSteps} 步要为你构建存款交易：从 ${chainName(params.fromChain)} 存入 ${String(params.asset || "资产")}。回复「确认」继续。`
      : `Meow~ Step ${stepIndex}/${totalSteps} will build a deposit transaction for ${String(params.asset || "your asset")} from ${chainName(params.fromChain)}. Reply "confirm" to continue.`
  }
  if (stepAction === "build_swap") {
    return lang === "zh"
      ? `喵～计划第 ${stepIndex}/${totalSteps} 步要为你构建兑换交易：${String(params.fromToken || "?")} -> ${String(params.toToken || "?")}。回复「确认」继续。`
      : `Meow~ Step ${stepIndex}/${totalSteps} will build a swap transaction: ${String(params.fromToken || "?")} -> ${String(params.toToken || "?")}. Reply "confirm" to continue.`
  }
  if (stepAction === "build_bridge") {
    return lang === "zh"
      ? `喵～计划第 ${stepIndex}/${totalSteps} 步要为你构建跨链交易：${String(params.token || "?")} 从 ${chainName(params.fromChain)} 到 ${chainName(params.toChain)}。回复「确认」继续。`
      : `Meow~ Step ${stepIndex}/${totalSteps} will build a bridge transaction for ${String(params.token || "?")} from ${chainName(params.fromChain)} to ${chainName(params.toChain)}. Reply "confirm" to continue.`
  }
  if (stepAction === "build_withdraw") {
    return lang === "zh"
      ? `喵～计划第 ${stepIndex}/${totalSteps} 步要为你构建取款交易。回复「确认」继续。`
      : `Meow~ Step ${stepIndex}/${totalSteps} will build a withdraw transaction. Reply "confirm" to continue.`
  }

  return lang === "zh"
    ? `喵～计划第 ${stepIndex}/${totalSteps} 步需要确认：${stepAction}。回复「确认」继续。`
    : `Meow~ Step ${stepIndex}/${totalSteps} needs confirmation: ${stepAction}. Reply "confirm" to continue.`
}

function actionProgress(stepIndex: number, totalSteps: number, action: string, lang: "zh" | "en") {
  return lang === "zh"
    ? `⚡ Step ${stepIndex}/${totalSteps}: ${action}...`
    : `⚡ Step ${stepIndex}/${totalSteps}: ${action}...`
}

function failureReply(action: string, error: string, lang: "zh" | "en") {
  return lang === "zh"
    ? `喵…执行步骤 ${action} 失败了：${error}`
    : `Meow... step ${action} failed: ${error}`
}

export function getPendingPlanExecution(): PlanExecutionState | null {
  return pendingPlanExecution
}

export function clearPendingPlanExecution(): void {
  pendingPlanExecution = null
}

export async function executePlan(
  plan: AgentExecutionPlan,
  ctx: HandlerContext,
  resumeState?: { completedSteps: Map<string, StepOutput>; confirmedStepId: string },
): Promise<void> {
  const completedSteps = resumeState?.completedSteps ?? new Map<string, StepOutput>()
  const isResume = !!resumeState

  if (!isResume) {
    ctx.sendProgress(ctx.tabId, `🧠 ${plan.summary}`)
  }

  const replyParts: string[] = []
  const txPayloads: Record<string, unknown>[] = []

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]

    if (completedSteps.has(step.id)) continue

    if (step.dependsOn) {
      const dep = completedSteps.get(step.dependsOn)
      if (!dep || dep.ok === false) {
        logger.warn("Skipping step due to missing or failed dependency", { stepId: step.id, dependsOn: step.dependsOn })
        continue
      }
      if (step.condition && !evaluateCondition(step.condition, dep)) {
        logger.info("Skipping step because condition evaluated false", { stepId: step.id, field: step.condition.field, op: step.condition.op })
        continue
      }
    } else if (step.condition) {
      logger.warn("Skipping condition on step without dependency", { stepId: step.id })
      continue
    }

    const resolvedParams = resolveParams(step.params, completedSteps)

    if (step.requiresConfirm && step.id !== resumeState?.confirmedStepId) {
      pendingPlanExecution = {
        plan,
        completedSteps,
        pendingConfirmStepId: step.id,
      }
      const preview = previewForStep(index + 1, plan.steps.length, step.action, resolvedParams, plan.lang)
      ctx.pushHistory("model", preview)
      ctx.sendResponse({ status: "success", petState: "idle", reply: preview, transactionPayload: null })
      return
    }

    ctx.sendProgress(ctx.tabId, actionProgress(index + 1, plan.steps.length, step.action, plan.lang))
    const action = getAction(step.action)
    if (!action) {
      const reply = failureReply(step.action, "unknown_action", plan.lang)
      clearPendingPlanExecution()
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return
    }

    const result = await action(resolvedParams, ctx, completedSteps)
    completedSteps.set(step.id, result)

    if (!result.ok) {
      const reply = failureReply(step.action, result.error || "unknown_error", plan.lang)
      clearPendingPlanExecution()
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return
    }

    if (step.action === "reply_user" && typeof result.data.reply === "string") {
      replyParts.push(result.data.reply)
    }

    if (
      (step.action === "build_deposit" ||
        step.action === "build_swap" ||
        step.action === "build_bridge" ||
        step.action === "build_withdraw") &&
      result.data.txPayload &&
      typeof result.data.txPayload === "object"
    ) {
      txPayloads.push(result.data.txPayload as Record<string, unknown>)
    }
  }

  clearPendingPlanExecution()

  const reply = replyParts.join("\n\n").trim()
    || (plan.lang === "zh" ? "喵～计划执行完成。" : "Meow~ Plan execution completed.")
  const transactionPayload = txPayloads.length > 0 ? txPayloads[txPayloads.length - 1] : null

  ctx.pushHistory("model", reply)
  ctx.sendResponse({
    status: "success",
    petState: "idle",
    reply,
    transactionPayload,
  })
}
