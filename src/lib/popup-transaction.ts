import type { ToolJsonPrimitive } from "../background/agent/types.ts"
import { CHAIN_NAMES } from "./chain-config.ts"
import type { TransactionDisplay } from "./transaction-display.ts"

export interface PopupBatchCall {
  to: string
  data?: string
  value?: string | number | bigint
}

export interface PendingPopupTransactionPayload {
  isBatch?: boolean
  calls?: PopupBatchCall[]
  chainId?: number | string | null
  to?: string
  data?: string
  value?: string | number | bigint
  gasLimit?: string | number | bigint
  erc8211?: unknown
  display?: TransactionDisplay | null
}

export interface NormalizedPopupTransaction {
  kind: "batch" | "single"
  chainId: number | null
  calls: Array<{ to: `0x${string}`; data: `0x${string}`; value: bigint }>
  raw: PendingPopupTransactionPayload
}

export interface PopupWalletError {
  code: string
  message: string
  retryable: boolean
  details?: Record<string, ToolJsonPrimitive | ToolJsonPrimitive[] | null>
}

export interface PopupTransactionSummary {
  title: string
  subtitle?: string | null
  chainLabel?: string | null
  vaultLabel?: string | null
  asset?: string | null
  amount?: string | null
  steps: string[]
  note?: string | null
  isBatch: boolean
  callCount: number
}

export interface PopupConnectorLike {
  id: string
  name: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asAddress(value: unknown): `0x${string}` | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as `0x${string}` : null
}

function asChainId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return null
}

function asRawValue(value: unknown): bigint {
  if (typeof value === "bigint") return value
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value === "string" && value.trim()) return BigInt(value)
  return 0n
}

function formatChainLabel(chainId: number | null): string | null {
  if (!chainId) return null
  return CHAIN_NAMES[chainId] || `Chain ${chainId}`
}

function normalizeCall(input: unknown): { to: `0x${string}`; data: `0x${string}`; value: bigint } | null {
  if (!isRecord(input)) return null
  const to = asAddress(input.to)
  if (!to) return null
  const data = typeof input.data === "string" && input.data.startsWith("0x") ? (input.data as `0x${string}`) : "0x"
  return {
    to,
    data,
    value: asRawValue(input.value),
  }
}

export function normalizePendingPopupTransaction(
  payload: unknown,
): NormalizedPopupTransaction | null {
  if (!isRecord(payload)) return null
  const chainId = asChainId(payload.chainId)
  if (payload.isBatch === true) {
    const calls = Array.isArray(payload.calls)
      ? payload.calls.map(normalizeCall).filter((call): call is NonNullable<typeof call> => !!call)
      : []
    if (calls.length === 0) return null
    return {
      kind: "batch",
      chainId,
      calls,
      raw: payload as PendingPopupTransactionPayload,
    }
  }

  const single = normalizeCall({
    to: payload.to,
    data: payload.data,
    value: payload.value,
  })
  if (!single) return null
  return {
    kind: "single",
    chainId,
    calls: [single],
    raw: payload as PendingPopupTransactionPayload,
  }
}

function normalizeDisplay(raw: PendingPopupTransactionPayload): TransactionDisplay | null {
  if (!raw.display || typeof raw.display !== "object") return null
  const display = raw.display as TransactionDisplay
  if (!Array.isArray(display.steps)) return null
  return display
}

export function describePendingPopupTransaction(normalized: NormalizedPopupTransaction): PopupTransactionSummary {
  const display = normalizeDisplay(normalized.raw)
  const chainLabel = display?.chainName || formatChainLabel(display?.chainId ?? normalized.chainId)
  const title = display?.title || (normalized.kind === "batch"
    ? `Smart Batch (${normalized.calls.length} steps)`
    : "Pending Transaction")
  const steps = display?.steps?.length
    ? display.steps
    : normalized.kind === "batch"
      ? normalized.calls.map((call, index) => describePopupCall(call, index, normalized.calls.length))
      : [describePopupCall(normalized.calls[0], 0, 1)]

  return {
    title,
    subtitle: display?.subtitle || null,
    chainLabel,
    vaultLabel: display?.vaultName && display?.protocolName ? `${display.protocolName} • ${display.vaultName}` : display?.vaultName || null,
    asset: display?.asset || null,
    amount: display?.amount || null,
    steps,
    note: display?.note || null,
    isBatch: normalized.kind === "batch",
    callCount: normalized.calls.length,
  }
}

export function shouldFallbackToSingleSend(normalized: NormalizedPopupTransaction): boolean {
  return normalized.kind === "batch" && normalized.calls.length === 1
}

function containsRejected(text: string): boolean {
  return /(rejected|denied|declined|cancelled|canceled|user rejected|user denied)/i.test(text)
}

function isApproveSelector(data: string): boolean {
  return data.slice(0, 10).toLowerCase() === "0x095ea7b3"
}

export function selectPreferredPopupConnector<T extends PopupConnectorLike>(
  connectors: ReadonlyArray<T>,
  currentConnector?: { id: string } | null,
): T | undefined {
  // 1. 如果当前已经连接，保持现状
  const current = currentConnector
    ? connectors.find((connector) => connector.id === currentConnector.id)
    : undefined
  if (current) return current

  // 2. 优先选择 Coinbase Smart Wallet (项目核心功能)
  const cb = connectors.find((c) => c.id === "coinbaseWalletSDK" || /coinbase/i.test(c.id))
  if (cb) return cb

  // 3. 其次选择注入式钱包 (如 MetaMask)
  const injected = connectors.find((connector) => connector.id === "injected")
  if (injected) return injected

  return connectors[0]
}

export function describePopupCall(
  call: { to: `0x${string}`; data: `0x${string}`; value: bigint },
  index: number,
  total: number,
): string {
  const prefix = total > 1 ? `Step ${index + 1}/${total}: ` : ""
  if (isApproveSelector(call.data)) {
    return `${prefix}approve token`
  }
  return `${prefix}deposit`
}

export function canFallbackToSequentialBatch(normalized: NormalizedPopupTransaction): boolean {
  return normalized.kind === "batch" && normalized.calls.length === 2
}

export function splitSequentialBatchCalls(normalized: NormalizedPopupTransaction): Array<{ to: `0x${string}`; data: `0x${string}`; value: bigint }> {
  return normalized.kind === "batch" ? normalized.calls.slice(0, 2) : normalized.calls.slice(0, 1)
}

export function formatPopupWalletError(error: unknown, context: { isBatch: boolean; callCount: number }): PopupWalletError {
  const details = isRecord(error) ? error : null
  const shortMessage =
    typeof details?.shortMessage === "string"
      ? details.shortMessage
      : typeof details?.message === "string"
        ? details.message
        : "Transaction failed"
  const lower = shortMessage.toLowerCase()
  const retryable = !containsRejected(lower)
  const code =
    typeof details?.code === "string"
      ? details.code
      : context.isBatch && context.callCount > 1
        ? "batch_send_failed"
        : "send_failed"

  return {
    code,
    message: shortMessage,
    retryable,
    details: isRecord(details?.details) ? (details.details as Record<string, ToolJsonPrimitive | ToolJsonPrimitive[] | null>) : undefined,
  }
}
