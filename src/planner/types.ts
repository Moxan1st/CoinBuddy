export type PlanStepType = "deposit" | "swap" | "bridge"

export interface PlanStep {
  action: PlanStepType
  params: Record<string, any>
}

export interface ExecutionPlan {
  steps: PlanStep[]
  reasons: string[]
  normalized: boolean
}

export interface PlanValidationResult {
  ok: boolean
  reason?: string
}
