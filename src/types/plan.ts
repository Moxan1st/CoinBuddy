/**
 * Agent Planner 类型定义
 *
 * ActionType 是 LLM 可选的动作白名单，与 action-registry.ts 中的执行函数一一对应。
 * PlanStep 描述计划中的一个步骤，支持依赖引用、条件执行和确认暂停。
 */

export type ActionType =
  | "search_vaults"
  | "compare_vaults"
  | "get_vault_detail"
  | "check_balance"
  | "check_balance_on_chains"
  | "build_deposit"
  | "build_swap"
  | "build_bridge"
  | "build_withdraw"
  | "fetch_price"
  | "fetch_portfolio"
  | "reply_user"

export type ConditionOp = "gt" | "lt" | "gte" | "lte" | "eq" | "exists"

export interface PlanCondition {
  /** 前置步骤输出中要检查的字段名（必须在 ALLOWED_CONDITION_FIELDS 白名单中） */
  field: string
  op: ConditionOp
  value: unknown
}

export interface PlanStep {
  id: string
  action: ActionType
  params: Record<string, unknown>
  /** 引用前置步骤的 id，当前步骤可以使用该步骤的输出 */
  dependsOn?: string
  /** 条件执行：仅当条件满足时才运行此步骤 */
  condition?: PlanCondition
  /** 为 true 时，执行器在运行此步骤前会暂停并向用户展示预览，等待确认 */
  requiresConfirm?: boolean
}

export interface AgentExecutionPlan {
  steps: PlanStep[]
  /** 给用户看的计划摘要（用用户的语言） */
  summary: string
  lang: "zh" | "en"
}

export interface StepOutput {
  ok: boolean
  data: Record<string, unknown>
  /** 如果步骤失败，包含错误描述 */
  error?: string
}

/** 步骤执行器暂停时返回的状态，用于持久化和恢复 */
export interface PlanExecutionState {
  plan: AgentExecutionPlan
  completedSteps: Map<string, StepOutput>
  /** 当前等待用户确认的步骤 id */
  pendingConfirmStepId: string | null
}
