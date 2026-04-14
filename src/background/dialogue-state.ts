import type { Intent, Vault } from "~types"

export interface PendingInvestParams {
  amount: Intent["amount"]
  amountDecimals: Intent["amountDecimals"]
  fromChain: Intent["fromChain"]
  toChainConfig: Intent["toChainConfig"]
  searchAsset: Intent["searchAsset"]
  protocol?: Intent["protocol"]
}

export type PendingVaultRef = Vault

export interface PendingDepositDraft {
  investParams: PendingInvestParams | null
  selectedVault: PendingVaultRef | null
  vaultChoices: PendingVaultRef[]
  walletAddress: string | null
}

export interface VaultSelectionInput {
  selectionIndex?: number
  selectionProtocol?: string
}

export interface VaultSelectionResult {
  selectedVault: PendingVaultRef | null
  ambiguous: boolean
}

export interface PendingDepositRecommendation {
  investParams?: PendingInvestParams | null
  selectedVault?: PendingVaultRef | null
  vaultChoices?: PendingVaultRef[]
  walletAddress?: string | null
}

export function hydrateBuildDepositArgs(
  args: Record<string, unknown>,
  draft: PendingDepositDraft,
  walletAddress?: string | null,
): Record<string, unknown> {
  const hydrated: Record<string, unknown> = { ...args }
  const investParams = draft.investParams
  const selectedVault = draft.selectedVault

  if (investParams) {
    if (hydrated.fromChain === undefined || hydrated.fromChain === null) {
      hydrated.fromChain = investParams.fromChain
    }
    if (hydrated.asset === undefined || hydrated.asset === null) {
      hydrated.asset = investParams.searchAsset
    }
    if (hydrated.rawAmount === undefined || hydrated.rawAmount === null) {
      if (investParams.amount) {
        hydrated.rawAmount = `${investParams.amount}${investParams.amountDecimals || ""}`
      }
    }
    if (hydrated.amount === undefined || hydrated.amount === null) {
      hydrated.amount = investParams.amount
    }
    if (hydrated.amountDecimals === undefined || hydrated.amountDecimals === null) {
      hydrated.amountDecimals = investParams.amountDecimals
    }
  }

  const vault = selectedVault || (draft.vaultChoices.length === 1 ? draft.vaultChoices[0] : null)
  if (vault) {
    if (hydrated.vault === undefined || hydrated.vault === null) {
      hydrated.vault = vault
    }
    if (hydrated.vaultAddress === undefined || hydrated.vaultAddress === null) {
      hydrated.vaultAddress = vault.address
    }
    if (hydrated.vaultChainId === undefined || hydrated.vaultChainId === null) {
      hydrated.vaultChainId = vault.chainId
    }
  }

  if (walletAddress && (hydrated.walletAddress === undefined || hydrated.walletAddress === null)) {
    hydrated.walletAddress = walletAddress
  }

  return hydrated
}

export function createPendingDepositDraft(): PendingDepositDraft {
  return {
    investParams: null,
    selectedVault: null,
    vaultChoices: [],
    walletAddress: null,
  }
}

export function clearPendingDepositDraft(draft: PendingDepositDraft): PendingDepositDraft {
  draft.investParams = null
  draft.selectedVault = null
  draft.vaultChoices = []
  draft.walletAddress = null
  return draft
}

export function cacheInvestRecommendation(
  draft: PendingDepositDraft,
  investParams: PendingInvestParams,
  selectedVault: PendingVaultRef | null,
  walletAddress?: string | null,
): PendingDepositDraft {
  draft.investParams = investParams
  draft.selectedVault = selectedVault
  draft.walletAddress = walletAddress || null
  if (selectedVault) {
    draft.vaultChoices = [selectedVault]
  }
  return draft
}

export function cachePendingDepositRecommendation(
  draft: PendingDepositDraft,
  recommendation: PendingDepositRecommendation,
): PendingDepositDraft {
  if (recommendation.investParams !== undefined) {
    draft.investParams = recommendation.investParams
  }
  if (recommendation.selectedVault !== undefined) {
    draft.selectedVault = recommendation.selectedVault
  }
  if (recommendation.vaultChoices !== undefined) {
    draft.vaultChoices = recommendation.vaultChoices.slice(0, 5)
  }
  if (recommendation.walletAddress !== undefined) {
    draft.walletAddress = recommendation.walletAddress || null
  }
  return draft
}

export function cacheVaultChoices(
  draft: PendingDepositDraft,
  vaultChoices: PendingVaultRef[],
  walletAddress?: string | null,
): PendingDepositDraft {
  draft.vaultChoices = vaultChoices.slice(0, 5)
  if (walletAddress) {
    draft.walletAddress = walletAddress
  }
  return draft
}

export function cacheSelectedVault(
  draft: PendingDepositDraft,
  selectedVault: PendingVaultRef | null,
  walletAddress?: string | null,
): PendingDepositDraft {
  draft.selectedVault = selectedVault
  if (selectedVault) {
    draft.vaultChoices = [selectedVault]
  }
  if (walletAddress) {
    draft.walletAddress = walletAddress
  }
  return draft
}

export function promoteSingleVaultChoice(
  draft: PendingDepositDraft,
  walletAddress?: string | null,
): PendingVaultRef | null {
  if (!draft.selectedVault && draft.vaultChoices.length === 1) {
    draft.selectedVault = draft.vaultChoices[0]
  }
  if (walletAddress !== undefined) {
    draft.walletAddress = walletAddress || null
  }
  return draft.selectedVault
}

export function applyVaultSelection(
  draft: PendingDepositDraft,
  selection: VaultSelectionInput,
  walletAddress?: string | null,
): VaultSelectionResult {
  const vaultChoices = draft.vaultChoices
  let selectedVault: PendingVaultRef | null = null
  let ambiguous = false

  if (selection.selectionIndex) {
    const idx = selection.selectionIndex - 1
    if (idx >= 0 && idx < vaultChoices.length) {
      selectedVault = vaultChoices[idx]
    }
  }

  if (!selectedVault && selection.selectionProtocol) {
    const keyword = selection.selectionProtocol.toLowerCase()

    let matches = vaultChoices.filter((vault) => {
      const protocolName = String(vault.protocol?.name || "").toLowerCase()
      return (
        protocolName === keyword ||
        protocolName.startsWith(`${keyword}-`) ||
        protocolName.startsWith(`${keyword} `)
      )
    })

    if (matches.length === 0 && keyword.length >= 3) {
      matches = vaultChoices.filter((vault) =>
        String(vault.protocol?.name || "").toLowerCase().includes(keyword),
      )
    }

    if (matches.length === 0 && keyword.length >= 3) {
      matches = vaultChoices.filter((vault) =>
        String(vault.name || "").toLowerCase().includes(keyword),
      )
    }

    if (matches.length === 1) {
      selectedVault = matches[0]
    } else if (matches.length > 1) {
      ambiguous = true
    }
  }

  if (selectedVault) {
    draft.selectedVault = selectedVault
    if (walletAddress) {
      draft.walletAddress = walletAddress
    }
  }

  return { selectedVault, ambiguous }
}

export function getDepositConfirmability(draft: PendingDepositDraft): {
  canConfirm: boolean
  missing: Array<"vault" | "intent">
} {
  const missing: Array<"vault" | "intent"> = []
  if (!draft.selectedVault) missing.push("vault")
  if (!draft.investParams) missing.push("intent")
  return { canConfirm: missing.length === 0, missing }
}
