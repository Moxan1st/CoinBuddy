import { CHAIN_NAMES } from "./chain-config.ts"

export interface TransactionDisplay {
  title: string
  subtitle?: string
  chainId?: number | null
  chainName?: string | null
  sourceChainId?: number | null
  sourceChainName?: string | null
  vaultName?: string | null
  protocolName?: string | null
  vaultAddress?: string | null
  asset?: string | null
  amount?: string | null
  steps: string[]
  note?: string | null
}

function chainName(chainId?: number | null): string | null {
  if (!chainId) return null
  return CHAIN_NAMES[chainId] || `Chain ${chainId}`
}

function formatRawAmount(rawAmount: string | undefined, decimals: number | null | undefined): string | null {
  if (!rawAmount) return null
  if (decimals == null || !Number.isFinite(decimals) || decimals <= 0) return rawAmount
  const normalized = rawAmount.replace(/^0+(?=\d)/, "") || "0"
  const padded = normalized.padStart(decimals + 1, "0")
  const whole = padded.slice(0, -decimals) || "0"
  const fraction = padded.slice(-decimals).replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole
}

export function buildDepositDisplay(input: {
  amountRaw?: string
  decimals?: number | null
  asset?: string | null
  vaultName: string
  protocolName: string
  vaultAddress: string
  sourceChainId: number
  targetChainId: number
  isBatch: boolean
  hasApproval: boolean
  note?: string | null
}): TransactionDisplay {
  const amount = formatRawAmount(input.amountRaw, input.decimals)
  const sourceChainName = chainName(input.sourceChainId)
  const targetChainName = chainName(input.targetChainId)
  const asset = input.asset || null
  const vaultSummary = `${input.protocolName} • ${input.vaultName}`
  const title = amount && asset
    ? `Deposit ${amount} ${asset} into ${vaultSummary}`
    : `Deposit into ${vaultSummary}`
  const steps = input.hasApproval
    ? [
        `1. Approve ${asset || "token"} for ${input.protocolName}`,
        `2. Deposit into ${input.protocolName} vault`,
      ]
    : [
        `1. Deposit into ${input.protocolName} vault`,
      ]

  return {
    title,
    subtitle: targetChainName
      ? `Vault chain: ${targetChainName}${sourceChainName && sourceChainName !== targetChainName ? ` | Source chain: ${sourceChainName}` : ""}`
      : (sourceChainName ? `Source chain: ${sourceChainName}` : undefined),
    chainId: input.targetChainId,
    chainName: targetChainName,
    sourceChainId: input.sourceChainId,
    sourceChainName,
    vaultName: input.vaultName,
    protocolName: input.protocolName,
    vaultAddress: input.vaultAddress,
    asset,
    amount,
    steps,
    note: input.note || null,
  }
}

export function buildBatchDisplay(input: {
  title: string
  subtitle?: string | null
  chainId?: number | null
  steps: string[]
  note?: string | null
}): TransactionDisplay {
  return {
    title: input.title,
    subtitle: input.subtitle || undefined,
    chainId: input.chainId ?? null,
    chainName: chainName(input.chainId ?? null),
    steps: input.steps,
    note: input.note || null,
  }
}

export function buildBridgeDisplay(input: {
  amountRaw?: string
  decimals?: number | null
  asset?: string | null
  sourceChainId: number
  targetChainId: number
  hasApproval: boolean
  note?: string | null
}): TransactionDisplay {
  const amount = formatRawAmount(input.amountRaw, input.decimals)
  const sourceChainName = chainName(input.sourceChainId)
  const targetChainName = chainName(input.targetChainId)
  const asset = input.asset || null
  const title = amount && asset
    ? `Bridge ${amount} ${asset} to ${targetChainName || "target chain"}`
    : `Bridge to ${targetChainName || "target chain"}`
  const steps = input.hasApproval
    ? [
        `1. Approve ${asset || "token"} for bridge router`,
        `2. Bridge to ${targetChainName || "target chain"}`,
      ]
    : [
        `1. Bridge to ${targetChainName || "target chain"}`,
      ]

  return {
    title,
    subtitle: sourceChainName && targetChainName
      ? `${sourceChainName} -> ${targetChainName}`
      : targetChainName || sourceChainName || undefined,
    chainId: input.sourceChainId,
    chainName: sourceChainName,
    sourceChainId: input.sourceChainId,
    sourceChainName,
    asset,
    amount,
    steps,
    note: input.note || null,
  }
}

export function buildSwapDisplay(input: {
  amountRaw?: string
  decimals?: number | null
  fromAsset?: string | null
  toAsset?: string | null
  chainId: number
  hasApproval: boolean
  note?: string | null
}): TransactionDisplay {
  const amount = formatRawAmount(input.amountRaw, input.decimals)
  const chain = chainName(input.chainId)
  const fromAsset = input.fromAsset || "token"
  const toAsset = input.toAsset || "token"
  const title = amount
    ? `Swap ${amount} ${fromAsset} to ${toAsset}`
    : `Swap ${fromAsset} to ${toAsset}`
  const steps = input.hasApproval
    ? [
        `1. Approve ${fromAsset} for swap router`,
        `2. Swap ${fromAsset} to ${toAsset}`,
      ]
    : [
        `1. Swap ${fromAsset} to ${toAsset}`,
      ]

  return {
    title,
    subtitle: chain ? `Chain: ${chain}` : undefined,
    chainId: input.chainId,
    chainName: chain,
    asset: fromAsset,
    amount,
    steps,
    note: input.note || null,
  }
}

export function buildWithdrawDisplay(input: {
  amountRaw?: string
  decimals?: number | null
  asset?: string | null
  vaultName: string
  protocolName: string
  vaultAddress: string
  chainId: number
  note?: string | null
}): TransactionDisplay {
  const amount = formatRawAmount(input.amountRaw, input.decimals)
  const chain = chainName(input.chainId)
  const asset = input.asset || null
  const vaultSummary = `${input.protocolName} • ${input.vaultName}`
  const title = amount && asset
    ? `Withdraw ${amount} ${asset} from ${vaultSummary}`
    : `Withdraw from ${vaultSummary}`

  return {
    title,
    subtitle: chain ? `Vault chain: ${chain}` : undefined,
    chainId: input.chainId,
    chainName: chain,
    vaultName: input.vaultName,
    protocolName: input.protocolName,
    vaultAddress: input.vaultAddress,
    asset,
    amount,
    steps: [
      `1. Approve vault shares for ${input.protocolName}`,
      `2. Withdraw from ${input.protocolName} vault`,
    ],
    note: input.note || null,
  }
}
