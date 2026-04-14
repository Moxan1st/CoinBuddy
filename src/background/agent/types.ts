import type { Vault } from "../../types/index.ts"

export type ToolJsonPrimitive = string | number | boolean | null

export type ToolJsonValue =
  | ToolJsonPrimitive
  | ToolJsonValue[]
  | { [key: string]: ToolJsonValue }

export interface JsonSchemaBase {
  description?: string
  default?: ToolJsonValue
  enum?: readonly ToolJsonPrimitive[]
}

export interface JsonSchemaObject extends JsonSchemaBase {
  type: "object"
  properties: Record<string, JsonSchema>
  required?: readonly string[]
  additionalProperties?: boolean
}

export interface JsonSchemaArray extends JsonSchemaBase {
  type: "array"
  items: JsonSchema
}

export interface JsonSchemaScalar extends JsonSchemaBase {
  type: "string" | "number" | "integer" | "boolean" | "null"
}

export type JsonSchema = JsonSchemaObject | JsonSchemaArray | JsonSchemaScalar

export interface AgentToolSafety {
  requiresWallet?: boolean
  buildsTransaction?: boolean
  requiresConfirm?: boolean
  readOnly?: boolean
}

export interface ToolCallContext {
  lang: "zh" | "en"
  userText: string
  walletAddress?: string | null
  tabId?: number
}

export interface ToolError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface ToolResultMeta {
  durationMs: number
  timestamp: string
}

export interface ToolResultOk<TData = unknown> {
  ok: true
  toolName: string
  data: TData
  error: null
  meta: ToolResultMeta
}

export interface ToolResultFail {
  ok: false
  toolName: string
  data: null
  error: ToolError
  meta: ToolResultMeta
}

export type ToolResult<TData = unknown> = ToolResultOk<TData> | ToolResultFail

export interface AgentTool<TInput extends Record<string, unknown> = Record<string, unknown>, TData = unknown> {
  name: string
  description: string
  inputSchema: JsonSchemaObject
  safety: AgentToolSafety
  run: (input: TInput, context: ToolCallContext) => Promise<ToolResult<TData>>
}

export interface NormalizedVault {
  address: string
  chainId: number
  name: string
  network: string | null
  protocol: {
    name: string
    url: string | null
  }
  apy: {
    base: number
    reward: number
    total: number
  }
  tvlUsd: number | null
  tags: string[]
  isTransactional: boolean
  isRedeemable: boolean
  underlyingTokens: Array<{
    address: string
    symbol: string
    decimals: number | null
  }>
  raw: Vault
}

export interface SearchVaultsData {
  vaults: NormalizedVault[]
  count: number
  bestVault: NormalizedVault | null
  query: {
    chainId: number | null
    chainIds: number[]
    asset: string | null
    sortBy: string
    limit: number
  }
}

export interface VaultDetailData {
  vault: NormalizedVault | null
}

export interface CheckBalanceData {
  walletAddress: string
  chainId: number
  tokenAddress: string
  tokenSymbol: string | null
  requiredAmount: string | null
  estimatedGasWei: string
  sufficient: boolean
  tokenBalance: string
  nativeBalance: string
}

export interface TransactionData {
  txPayload: Record<string, unknown>
  vault?: NormalizedVault | null
  quoteSummary?: Record<string, unknown> | null
}

export interface PortfolioData {
  walletAddress: string
  count: number
  positions: unknown[]
  raw: {
    ok: boolean
    error?: string
  }
}

export interface PriceData {
  symbol: string
  chainId: number
  priceUsd: number | null
  raw: unknown
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
