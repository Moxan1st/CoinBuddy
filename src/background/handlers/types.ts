import type { IntentResult, Vault } from "~types"
import type { PendingDepositDraft } from "../dialogue-state"
import type { PortfolioPositionSummary } from "../session-cache"

export interface ResolveVaultResult {
  vault: Vault | null
  ambiguousCandidates?: Vault[]
  detailRefreshFailed?: boolean
  noPositionsFound?: boolean
  portfolioUnavailable?: boolean
}

export interface HandlerContext {
  lang: "zh" | "en"
  tabId?: number
  userText: string
  walletAddress?: string | null
  pushHistory: (role: "user" | "model", text: string) => void
  sendProgress: (tabId: number | undefined, text: string) => void
  sendResponse: (payload: any) => void
  pendingDepositDraft: PendingDepositDraft
  ensurePortfolioSnapshot: (walletAddress: string) => Promise<PortfolioPositionSummary[]>
  cacheVaultChoices: (draft: PendingDepositDraft, vaults: Vault[], walletAddress?: string | null) => void
  resolveVaultForWithdraw: (params: { vaultChainId?: number; vaultAddress?: string; useContext?: boolean; selectionProtocol?: string }, lang: "zh" | "en", tabId?: number, walletAddress?: string | null) => Promise<ResolveVaultResult>
  getPendingBridgeAfterWithdraw: () => { token: string; fromChain: number; toChain: number } | null
  setPendingBridgeAfterWithdraw: (value: { token: string; fromChain: number; toChain: number } | null) => void
  getPendingStrategyDraft: () => {
    triggerSymbol: string
    triggerCondition: "lte" | "gte"
    triggerThreshold: number
    spendToken: string
    spendAmount: string
    spendChainId: number
    buyToken: string
    targetChainId: number
    postAction: "none" | "vault_deposit"
    vaultAddress?: string
    vaultChainId?: number
    protocol?: string
  } | null
  setPendingStrategyDraft: (value: {
    triggerSymbol: string
    triggerCondition: "lte" | "gte"
    triggerThreshold: number
    spendToken: string
    spendAmount: string
    spendChainId: number
    buyToken: string
    targetChainId: number
    postAction: "none" | "vault_deposit"
    vaultAddress?: string
    vaultChainId?: number
    protocol?: string
  } | null) => void
  getEngine: () => any
  clearPending: () => void
  legacy: (group: "invest" | "swap" | "bridge" | "withdraw" | "strategy", intent: IntentResult) => Promise<boolean>
}
