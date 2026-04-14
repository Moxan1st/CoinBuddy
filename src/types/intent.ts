export interface Intent {
  amount: string
  amountDecimals: string
  fromChain: number
  toChainConfig: number[]
  searchAsset: string
  protocol?: string
}

export interface IntentResult {
  type:
    | "chat"
    | "invest"
    | "execute"
    | "confirm"
    | "cancel"
    | "compare"
    | "vault_detail"
    | "portfolio"
    | "chains"
    | "protocols"
    | "stablecoin"
    | "cross_deposit"
    | "token_price"
    | "swap"
    | "composite"
    | "bridge"
    | "withdraw"
    | "withdraw_bridge"
    | "strategy_create"
    | "strategy_list"
    | "needs_plan"
    | "connect_wallet"
  chatReply?: string
  rawIntent?: string
  investParams?: Intent
  compareParams?: { chainId?: number; asset?: string; sortBy?: string; limit?: number; protocol?: string }
  portfolioParams?: { protocol?: string; asset?: string; chainId?: number }
  vaultParams?: { chainId: number; address: string }
  tokenParams?: { symbol: string; chainId?: number }
  swapParams?: { fromToken: string; toToken: string; amount: string; amountDecimals: string; chainId: number }
  bridgeParams?: { token: string; amount: string; amountDecimals: string; fromChain: number; toChain: number }
  withdrawParams?: { vaultChainId?: number; vaultAddress?: string; amount?: string; amountDecimals?: string; useContext?: boolean }
  withdrawBridgeParams?: { vaultChainId?: number; vaultAddress?: string; useContext?: boolean; toChain: number }
  selectionIndex?: number
  selectionProtocol?: string
  compositeSteps?: Array<{
    action: "swap" | "deposit" | "bridge"
    params: Record<string, unknown>
  }>
  strategyParams?: {
    triggerSymbol: string
    triggerCondition: "lte" | "gte"
    triggerThreshold: number
    spendToken: string
    spendAmount: string
    spendChainId?: number
    buyToken?: string
    targetChainId?: number
    postAction?: "none" | "vault_deposit"
    vaultAddress?: string
    vaultChainId?: number
    protocol?: string
  }
}
