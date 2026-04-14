export interface QuoteSummary {
  action: "deposit" | "swap" | "bridge" | "withdraw"
  fromChain: number
  toChain: number
  fromChainName: string
  toChainName: string
  fromToken: string
  toToken: string
  fromAmount: number
  toAmount: number
  toAmountMin: number
  gasCostUSD: number
  feeCostUSD: number
  toolName: string
  executionDuration: number
  approvalAddress: string
}

export interface PortfolioFetchResult {
  ok: boolean
  positions: unknown[]
  error?: string
}
