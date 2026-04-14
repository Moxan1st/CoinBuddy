import { generateText, type ChatMessage } from "../llm-client.ts"
import { createLogger } from "../../lib/logger.ts"
import type {
  ActionType,
  AgentExecutionPlan,
  ConditionOp,
  PlanCondition,
  PlanStep,
} from "../../types/index.ts"

const logger = createLogger("AgentPlanner")

const ALLOWED_ACTIONS: ActionType[] = [
  "search_vaults",
  "compare_vaults",
  "get_vault_detail",
  "check_balance",
  "check_balance_on_chains",
  "build_deposit",
  "build_swap",
  "build_bridge",
  "build_withdraw",
  "fetch_price",
  "fetch_portfolio",
  "reply_user",
]

const ALLOWED_CONDITION_FIELDS = [
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
] as const

const ALLOWED_CONDITION_OPS: ConditionOp[] = ["gt", "lt", "gte", "lte", "eq", "exists"]
const FUNDING_ACTIONS = new Set<ActionType>([
  "build_deposit",
  "build_swap",
  "build_bridge",
  "build_withdraw",
])

const PLANNER_SYSTEM_PROMPT = `You are CoinBuddy's execution planner. The user made a complex request that needs multiple steps.
Break it down into an ordered execution plan using ONLY the actions listed below.

## Available Actions
- search_vaults: Search for the best vault. Params: {chainIds: number[], asset: string}
  Output fields: vault, vaultAddress, vaultChainId, apy, protocol
- compare_vaults: Compare/rank vaults. Params: {chainId?: number, asset?: string, sortBy?: string, limit?: number}
  Output fields: vaults, vaultCount, bestApy, bestVault
- get_vault_detail: Get vault details. Params: {chainId: number, address: string}
  Output fields: vault, isRedeemable, apy, protocol
- check_balance: Check token balance on a single chain. Params: {chainId: number, token: string}
  Output fields: sufficient, balance, nativeBalance
- check_balance_on_chains: Check token balance across multiple chains to find where user holds the asset. Params: {asset: string, chainIds?: number[]}
  Output fields: bestChainId, bestBalance, bestValueUsd, allBalances
- build_deposit: Build deposit tx. Params: {vaultAddress?: string, vaultChainId?: number, amount: string, amountDecimals: string, fromChain: number, asset: string}
  Output fields: txPayload, quoteSummary
- build_swap: Build swap tx. Params: {fromToken: string, toToken: string, amount: string, amountDecimals: string, chainId: number}
  Output fields: txPayload
- build_bridge: Build bridge tx. Params: {token: string, amount: string, amountDecimals: string, fromChain: number, toChain: number}
  Output fields: txPayload, quoteSummary
- build_withdraw: Build withdraw tx. Params: {vaultAddress: string, vaultChainId: number}
  Output fields: txPayload, quoteSummary
- fetch_price: Get token price. Params: {symbol: string, chainId?: number}
  Output fields: price, symbol, priceUsd
- fetch_portfolio: Get user positions. Params: {}
  Output fields: positions, count
- reply_user: Generate a natural language reply. Params: {context: string}
  Output fields: reply

## Rules
1. Reference previous step outputs with "$step_id.field" syntax in params.
   Example: step_2 uses "$step_1.vaultAddress" to reference step_1's output.
2. Use "condition" for conditional execution. Only numeric comparisons and "exists" are supported.
   condition.field must be one of: bestApy, vaultCount, price, balance, sufficient, isRedeemable, apy, count, priceUsd
3. Steps that spend user funds (build_deposit, build_swap, build_bridge, build_withdraw) MUST set requiresConfirm: true.
4. Maximum 6 steps. If the request is too complex, use reply_user to ask for clarification.
5. Do NOT guess amounts, tokens, or chains. If information is missing, use reply_user to ask.
6. amountDecimals: USDC/USDT/DAI = "000000", ETH/WETH = "000000000000000000", WBTC = "00000000"
7. Default chain IDs: Ethereum=1, Base=8453, Arbitrum=42161, Optimism=10, Polygon=137, BSC=56

## Output Format (strict JSON)
{"steps": [...], "summary": "plan summary in user's language", "lang": "zh"|"en"}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isConditionField(field: string): field is typeof ALLOWED_CONDITION_FIELDS[number] {
  return (ALLOWED_CONDITION_FIELDS as readonly string[]).includes(field)
}

function isConditionOp(op: string): op is ConditionOp {
  return (ALLOWED_CONDITION_OPS as readonly string[]).includes(op)
}

function normalizeCondition(raw: unknown): PlanCondition | null {
  if (!isRecord(raw)) return null
  const field = typeof raw.field === "string" ? raw.field : null
  const op = typeof raw.op === "string" ? raw.op : null
  if (!field || !op) return null
  if (!isConditionField(field) || !isConditionOp(op)) return null

  return {
    field,
    op,
    value: raw.value,
  }
}

export function validatePlan(raw: unknown): { ok: boolean; plan?: AgentExecutionPlan; error?: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "plan_must_be_object" }
  }

  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 6) {
    return { ok: false, error: "steps_must_be_array_length_1_to_6" }
  }

  if (typeof raw.summary !== "string" || !raw.summary.trim()) {
    return { ok: false, error: "missing_summary" }
  }

  if (raw.lang !== "zh" && raw.lang !== "en") {
    return { ok: false, error: "missing_or_invalid_lang" }
  }

  const steps: PlanStep[] = []
  const seenIds = new Set<string>()

  for (const rawStep of raw.steps) {
    if (!isRecord(rawStep)) {
      return { ok: false, error: "step_must_be_object" }
    }

    const id = typeof rawStep.id === "string" ? rawStep.id.trim() : ""
    if (!id) return { ok: false, error: "step_missing_id" }
    if (seenIds.has(id)) return { ok: false, error: `duplicate_step_id:${id}` }

    const action = rawStep.action
    if (typeof action !== "string" || !(ALLOWED_ACTIONS as readonly string[]).includes(action)) {
      return { ok: false, error: `invalid_action:${String(action)}` }
    }

    if (!isRecord(rawStep.params)) {
      return { ok: false, error: `step_params_must_be_object:${id}` }
    }

    const dependsOn = typeof rawStep.dependsOn === "string" ? rawStep.dependsOn : undefined
    if (dependsOn && !seenIds.has(dependsOn)) {
      return { ok: false, error: `dependsOn_must_reference_prior_step:${id}` }
    }

    let condition: PlanCondition | undefined
    if (typeof rawStep.condition !== "undefined") {
      const normalized = normalizeCondition(rawStep.condition)
      if (!normalized) {
        return { ok: false, error: `invalid_condition:${id}` }
      }
      condition = normalized
    }

    const step: PlanStep = {
      id,
      action: action as ActionType,
      params: rawStep.params as Record<string, unknown>,
      dependsOn,
      condition,
      requiresConfirm: rawStep.requiresConfirm === true,
    }

    if (FUNDING_ACTIONS.has(step.action)) {
      step.requiresConfirm = true
    }

    steps.push(step)
    seenIds.add(id)
  }

  return {
    ok: true,
    plan: {
      steps,
      summary: raw.summary.trim(),
      lang: raw.lang,
    },
  }
}

export async function generatePlan(
  userText: string,
  history: ChatMessage[],
  lang: "zh" | "en",
): Promise<AgentExecutionPlan> {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [
    { role: "user", parts: [{ text: PLANNER_SYSTEM_PROMPT }] },
    { role: "model", parts: [{ text: '{"steps":[],"summary":"ack","lang":"en"}' }] },
    ...history.map((msg) => ({ role: msg.role, parts: [{ text: msg.text }] })),
    { role: "user", parts: [{ text: userText }] },
  ]

  logger.info("Generating agent plan", { lang, history: history.length, preview: userText.slice(0, 80) })

  const raw = await generateText(contents, true)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("planner_parse_failed")
  }

  const validated = validatePlan(parsed)
  if (!validated.ok || !validated.plan) {
    logger.warn("Planner validation failed", { error: validated.error })
    throw new Error(validated.error || "planner_validation_failed")
  }

  if (validated.plan.lang !== lang) {
    validated.plan.lang = lang
  }

  return validated.plan
}
