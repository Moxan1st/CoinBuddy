export type WalletGateReason =
  | "portfolio"
  | "confirm"
  | "execute"
  | "swap"
  | "bridge"
  | "withdraw"
  | "withdraw_bridge"
  | "composite"

export interface WalletGateAnalysisLike {
  type?: string
  swapParams?: unknown
  bridgeParams?: unknown
  compositeSteps?: Array<{ action?: string }>
}

export interface WalletGateContext {
  hasPendingStrategyDraft?: boolean
  hasPendingBridgeAfterWithdraw?: boolean
  canConfirmDeposit?: boolean
  hasPendingTransactionPayload?: boolean
}

export function getWalletGateReason(
  analysis: WalletGateAnalysisLike,
  context: WalletGateContext = {},
): WalletGateReason | null {
  switch (analysis.type) {
    case "portfolio":
    case "connect_wallet":
      return "portfolio"

    case "confirm":
      if (context.hasPendingTransactionPayload) return "execute"
      if (context.hasPendingStrategyDraft) return null
      if (context.hasPendingBridgeAfterWithdraw || context.canConfirmDeposit) {
        return "confirm"
      }
      return null

    case "execute":
      return context.hasPendingTransactionPayload ? "execute" : null

    case "swap":
      return analysis.swapParams ? "swap" : null

    case "bridge":
      return analysis.bridgeParams ? "bridge" : null

    case "withdraw":
      return "withdraw"

    case "withdraw_bridge":
      return "withdraw_bridge"

    case "composite": {
      const steps = Array.isArray(analysis.compositeSteps) ? analysis.compositeSteps : []
      if (steps.length === 1 && steps[0]?.action === "deposit") return null
      return steps.length > 0 ? "composite" : null
    }

    case "needs_plan":
      return null

    default:
      return null
  }
}
