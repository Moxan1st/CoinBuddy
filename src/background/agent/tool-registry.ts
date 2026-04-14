import { CoinBuddyBrain } from "../brain.ts"
import type { Vault } from "../../types/index.ts"
import type {
  AgentTool,
  CheckBalanceData,
  JsonSchemaObject,
  NormalizedVault,
  PortfolioData,
  PriceData,
  SearchVaultsData,
  TransactionData,
  ToolCallContext,
  ToolResult,
  VaultDetailData,
} from "./types.ts"

type ToolInput = Record<string, unknown>
const DEFAULT_SEARCH_CHAIN_IDS = [8453, 42161, 10, 1]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function nowIso(): string {
  return new Date().toISOString()
}

function success<TData>(toolName: string, data: TData, startedAt: number): ToolResult<TData> {
  return {
    ok: true,
    toolName,
    data,
    error: null,
    meta: {
      durationMs: Date.now() - startedAt,
      timestamp: nowIso(),
    },
  }
}

function failure<TData = unknown>(toolName: string, code: string, message: string, startedAt: number, details?: Record<string, unknown>): ToolResult<TData> {
  return {
    ok: false,
    toolName,
    data: null,
    error: {
      code,
      message,
      details,
    },
    meta: {
      durationMs: Date.now() - startedAt,
      timestamp: nowIso(),
    },
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function getNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map(getNumber).filter((item): item is number => typeof item === "number")
  return items.length > 0 ? items : undefined
}

function getAmountInput(input: ToolInput): string | undefined {
  const rawAmount = getString(input.rawAmount)
  if (rawAmount) return rawAmount

  const amount = getString(input.amount) ?? (typeof input.amount === "number" && Number.isFinite(input.amount) ? String(input.amount) : undefined)
  if (!amount) return undefined

  const decimals = getString(input.amountDecimals) ?? (typeof input.amountDecimals === "number" && Number.isFinite(input.amountDecimals) ? String(input.amountDecimals) : undefined)
  return decimals ? `${amount}${decimals}` : amount
}

function extractAmountFromText(text: string): string | undefined {
  const match = text.match(/(\d+(?:\.\d+)?)/)
  return match?.[1]
}

function extractAssetFromText(text: string): string | undefined {
  const match = text.match(/\b(USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i)
  return match?.[1]?.toUpperCase()
}

function resolveKnownTokenDecimals(symbol: string | undefined): number | null {
  switch ((symbol || "").toUpperCase()) {
    case "USDC":
    case "USDT":
    case "DAI":
    case "USDBC":
      return 6
    case "ETH":
    case "WETH":
      return 18
    case "WBTC":
    case "CBBTC":
    case "BTC":
      return 8
    default:
      return null
  }
}

function decimalAmountToRawAmount(amount: string, decimals: number): string | undefined {
  const match = amount.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return undefined

  const whole = match[1]
  const fraction = (match[2] || "").padEnd(decimals, "0").slice(0, Math.max(0, decimals))
  const raw = `${whole}${fraction}`.replace(/^0+(?=\d)/, "")
  return raw.length > 0 ? raw : "0"
}

function getVaultDecimals(vault: Vault | null): number | null {
  const decimals = vault?.underlyingTokens?.[0]?.decimals
  return typeof decimals === "number" && Number.isFinite(decimals) ? decimals : null
}

function asAddress(input: unknown): string | undefined {
  const value = getString(input)
  if (!value) return undefined
  return value.startsWith("0x") && value.length >= 42 ? value : undefined
}

function normalizeTvl(value: Vault["analytics"]["tvl"]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (isRecord(value)) {
    const usd = value.usd
    if (typeof usd === "string" || typeof usd === "number") {
      const parsed = Number(usd)
      return Number.isFinite(parsed) ? parsed : null
    }
  }
  return null
}

function normalizeVault(vault: Vault): NormalizedVault {
  return {
    address: vault.address,
    chainId: vault.chainId,
    name: vault.name,
    network: vault.network ?? null,
    protocol: {
      name: vault.protocol?.name || "unknown",
      url: vault.protocol?.url ?? null,
    },
    apy: {
      base: vault.analytics?.apy?.base ?? 0,
      reward: vault.analytics?.apy?.reward ?? 0,
      total: vault.analytics?.apy?.total ?? 0,
    },
    tvlUsd: normalizeTvl(vault.analytics?.tvl ?? null),
    tags: Array.isArray(vault.tags) ? [...vault.tags] : [],
    isTransactional: vault.isTransactional === true,
    isRedeemable: vault.isRedeemable === true,
    underlyingTokens: Array.isArray(vault.underlyingTokens)
      ? vault.underlyingTokens.map((token) => ({
          address: token.address,
          symbol: token.symbol,
          decimals: typeof token.decimals === "number" && Number.isFinite(token.decimals) ? token.decimals : null,
        }))
      : [],
    raw: vault,
  }
}

function vaultsByBestFirst(vaults: Vault[]): Vault[] {
  return [...vaults].sort((a, b) => {
    const apyDiff = (b.analytics?.apy?.total ?? 0) - (a.analytics?.apy?.total ?? 0)
    if (apyDiff !== 0) return apyDiff

    const tvlDiff = (normalizeTvl(b.analytics?.tvl ?? null) ?? 0) - (normalizeTvl(a.analytics?.tvl ?? null) ?? 0)
    if (tvlDiff !== 0) return tvlDiff

    const protocolDiff = (a.protocol?.name || "").localeCompare(b.protocol?.name || "")
    if (protocolDiff !== 0) return protocolDiff

    return a.address.localeCompare(b.address)
  })
}

async function resolveVault(input: ToolInput): Promise<Vault | null> {
  if (isRecord(input.vault)) {
    const vault = input.vault as Record<string, unknown>
    if (isRecord(vault.raw)) return vault.raw as unknown as Vault
    if (typeof vault.address === "string" && typeof vault.chainId === "number" && Array.isArray(vault.underlyingTokens)) {
      return vault as unknown as Vault
    }
    if (typeof vault.address === "string" && typeof vault.chainId === "number") {
      const detail = await CoinBuddyBrain.fetchVaultDetail(vault.chainId, vault.address)
      if (detail) return detail
    }
  }

  const address = asAddress(input.vaultAddress)
  const chainId = getNumber(input.vaultChainId)
  if (!address || !chainId) return null

  return CoinBuddyBrain.fetchVaultDetail(chainId, address)
}

async function runSearchVaults(input: ToolInput, _context: ToolCallContext): Promise<ToolResult<SearchVaultsData>> {
  const startedAt = Date.now()
  const asset = getString(input.asset)
  const chainIds = getNumberArray(input.chainIds)
  const chainId = getNumber(input.chainId)
  const sortBy = getString(input.sortBy) || "apy"
  const limit = Math.max(1, Math.min(50, getNumber(input.limit) ?? 10))

  const preferredChainIds = chainIds?.length ? chainIds : chainId ? [chainId] : DEFAULT_SEARCH_CHAIN_IDS

  const vaultGroups = await Promise.all(
    preferredChainIds.map((preferredChainId) =>
      CoinBuddyBrain.fetchVaultComparison({
        chainId: preferredChainId,
        asset,
        sortBy,
        limit,
      }),
    ),
  )

  const rankedVaults = vaultsByBestFirst(vaultGroups.flat()).map(normalizeVault)
  const vaults = rankedVaults.slice(0, limit)
  return success<SearchVaultsData>(
    "search_vaults",
    {
      vaults,
      count: rankedVaults.length,
      bestVault: vaults[0] ?? null,
      query: {
        chainId: chainId ?? null,
        chainIds: preferredChainIds,
        asset: asset ? asset.toUpperCase() : null,
        sortBy,
        limit,
      },
    },
    startedAt,
  )
}

async function runGetVaultDetail(input: ToolInput): Promise<ToolResult<VaultDetailData>> {
  const startedAt = Date.now()
  const address = asAddress(input.address) || asAddress(input.vaultAddress)
  const chainId = getNumber(input.chainId) || getNumber(input.vaultChainId)
  if (!address || !chainId) {
    return failure("get_vault_detail", "missing_chain_or_address", "get_vault_detail requires `chainId` and `address`.", startedAt, {
      chainId,
      address,
    })
  }

  const vault = await CoinBuddyBrain.fetchVaultDetail(chainId, address)
  if (!vault) {
    return failure("get_vault_detail", "vault_not_found", "The requested vault could not be found.", startedAt, {
      chainId,
      address,
    })
  }
  return success<VaultDetailData>(
    "get_vault_detail",
    {
      vault: normalizeVault(vault),
    },
    startedAt,
  )
}

async function runCheckBalance(input: ToolInput, context: ToolCallContext): Promise<ToolResult<CheckBalanceData>> {
  const startedAt = Date.now()
  const chainId = getNumber(input.chainId)
  const requiredAmount = getString(input.requiredAmount)
  const estimatedGasWei = getString(input.estimatedGasWei)
  const tokenSymbol = getString(input.token) || getString(input.symbol)
  const tokenAddress = asAddress(input.tokenAddress) || (tokenSymbol && chainId ? CoinBuddyBrain.resolveTokenAddress(tokenSymbol, chainId) : undefined)
  const walletAddress = context.walletAddress || undefined

  if (!walletAddress) {
    return failure("check_balance", "wallet_missing", "check_balance requires a connected wallet.", startedAt)
  }
  if (!chainId || !tokenAddress) {
    return failure("check_balance", "missing_chain_or_token", "check_balance requires `chainId` and either `tokenAddress` or a resolvable `token` symbol.", startedAt, {
      chainId,
      tokenAddress,
      tokenSymbol,
    })
  }

  const balance = await CoinBuddyBrain.checkBalance(chainId, walletAddress, tokenAddress, requiredAmount ?? "0", estimatedGasWei)
  if (!balance) {
    return failure("check_balance", "balance_check_failed", "Unable to read token or native balance.", startedAt)
  }

  return success<CheckBalanceData>(
    "check_balance",
    {
      walletAddress,
      chainId,
      tokenAddress,
      tokenSymbol: tokenSymbol ?? null,
      requiredAmount: requiredAmount ?? null,
      estimatedGasWei: balance.estimatedGasWei.toString(),
      sufficient: balance.sufficient,
      tokenBalance: balance.tokenBalance.toString(),
      nativeBalance: balance.nativeBalance.toString(),
    },
    startedAt,
  )
}

async function runBuildDeposit(input: ToolInput, context: ToolCallContext): Promise<ToolResult<TransactionData>> {
  console.log("[DEBUG-1] runBuildDeposit RAW INPUT:", JSON.stringify(input));

  const startedAt = Date.now()
  const walletAddress = context.walletAddress || undefined
  const vault = await resolveVault(input)
  
  // 链纠偏逻辑：如果检测到跨链需求，来源链强制设为 Base (8453)，除非另有说明
  let fromChain = getNumber(input.fromChain) || getNumber(input.chainId) || 8453;
  const toChain = vault?.chainId || fromChain;


  if (!walletAddress) {
    return failure("build_deposit", "wallet_missing", "build_deposit requires a connected wallet.", startedAt)
  }

  const assetSymbol = getString(input.asset) || getString(input.symbol) || extractAssetFromText(context.userText) || vault?.underlyingTokens?.[0]?.symbol

  // ULTIMATE FIX: Never trust rawAmount from upstream if we can re-calculate it
  const sourceAmount = getString(input.amount) || (typeof input.amount === "number" ? String(input.amount) : undefined)
  const inferredAmount = sourceAmount || extractAmountFromText(context.userText)
  const decimals = resolveKnownTokenDecimals(assetSymbol) ?? getVaultDecimals(vault) ?? 18

  let rawAmount: string | undefined = undefined
  if (inferredAmount && decimals) {
      rawAmount = decimalAmountToRawAmount(inferredAmount, decimals) || undefined
  }
  
  // Only if re-calc fails, fall back to input
  if (!rawAmount) {
      rawAmount = getString(input.rawAmount) || undefined
  }

  // Guard: reject dust amounts that will inevitably fail on-chain or at LI.FI
  if (rawAmount) {
    try {
      const raw = BigInt(rawAmount)
      // Use resolved decimals or fallback to 18
      const decimals = resolveKnownTokenDecimals(assetSymbol) ?? getVaultDecimals(vault) ?? 18
      // Lower threshold: 10^(decimals-4) -> e.g., 0.0001 for 6-decimal, 0.00000000000001 for 18-decimal
      const minRaw = BigInt(10) ** BigInt(Math.max(0, decimals - 4))
      
      if (raw > 0n && raw < minRaw) {
        const minHuman = decimals > 4 ? `0.${"0".repeat(3)}1` : "0.0001"
        return failure("build_deposit", "amount_too_small",
          `Amount is too small (dust). The minimum deposit is roughly ${minHuman} ${assetSymbol || "tokens"}. Please use a larger amount.`, startedAt)
      }
    } catch { /* non-numeric rawAmount, let downstream handle it */ }
  }

  if (!fromChain || !rawAmount || !vault) {
    return failure("build_deposit", "missing_inputs", "build_deposit requires `fromChain`, `rawAmount` (or amount fields), and a vault reference.", startedAt, {
      fromChain,
      rawAmount,
      hasVault: !!vault,
    })
  }

    console.log("[DEBUG] runBuildDeposit:", { fromChain, assetSymbol, rawAmount, walletAddress: walletAddress?.slice(0,10) });
  const result = await CoinBuddyBrain.buildDepositTransaction(fromChain, vault, walletAddress, rawAmount, assetSymbol)
  if (!result) {
    return failure("build_deposit", "build_failed", "Unable to build deposit transaction.", startedAt)
  }

  return success<TransactionData>(
    "build_deposit",
    {
      txPayload: result.txPayload,
      vault: normalizeVault(vault),
      quoteSummary: result.quoteSummary as Record<string, unknown>,
    },
    startedAt,
  )
}

async function runBuildWithdraw(input: ToolInput, context: ToolCallContext): Promise<ToolResult<TransactionData>> {
  const startedAt = Date.now()
  const walletAddress = context.walletAddress || undefined
  const rawAmount = getAmountInput(input)
  const vault = await resolveVault(input)

  if (!walletAddress) {
    return failure("build_withdraw", "wallet_missing", "build_withdraw requires a connected wallet.", startedAt)
  }
  if (!vault) {
    return failure("build_withdraw", "missing_vault", "build_withdraw requires a vault reference.", startedAt)
  }

  const txPayload = await CoinBuddyBrain.buildWithdrawTransaction(vault, walletAddress, rawAmount)
  if (!txPayload) {
    return failure("build_withdraw", "build_failed", "Unable to build withdraw transaction.", startedAt)
  }

  return success<TransactionData>(
    "build_withdraw",
    {
      txPayload: txPayload.txPayload,
      vault: normalizeVault(vault),
      quoteSummary: txPayload.quoteSummary as unknown as Record<string, unknown>,
    },
    startedAt,
  )
}


async function runBuildSwap(input: ToolInput, context: ToolCallContext): Promise<ToolResult<TransactionData>> {
  const startedAt = Date.now()
  const walletAddress = context.walletAddress || undefined
  const fromToken = getString(input.fromToken)
  const toToken = getString(input.toToken)
  const chainId = getNumber(input.chainId) ?? getNumber(input.fromChain) ?? getNumber(input.chain)
  let rawAmount = getString(input.rawAmount)

  if (!walletAddress) {
    return failure("build_swap", "wallet_missing", "build_swap requires a connected wallet.", startedAt)
  }

  if (!rawAmount) {
    const sourceAmount = getString(input.amount) || (typeof input.amount === "number" && Number.isFinite(input.amount) ? String(input.amount) : undefined)
    const inferredAmount = sourceAmount || extractAmountFromText(context.userText)
    const assetSymbol = fromToken || extractAssetFromText(context.userText)
    const decimals = resolveKnownTokenDecimals(assetSymbol)
    const amountDecimals = getString(input.amountDecimals) || (typeof input.amountDecimals === "number" && Number.isFinite(input.amountDecimals) ? String(input.amountDecimals) : undefined)
    
    if (inferredAmount && amountDecimals !== undefined) {
      rawAmount = `${inferredAmount}${amountDecimals}`
    } else if (inferredAmount && decimals !== null) {
      rawAmount = decimalAmountToRawAmount(inferredAmount, decimals) || undefined
    }
  }

  if (!fromToken || !toToken || !chainId || !rawAmount) {
    return failure("build_swap", "missing_inputs", `build_swap requires fromToken, toToken, chainId, and rawAmount. Got: fromToken=${fromToken}, toToken=${toToken}, chainId=${chainId}, rawAmount=${rawAmount}`, startedAt)
  }

  const result = await CoinBuddyBrain.buildSwapTransaction(fromToken, toToken, chainId, walletAddress, rawAmount)
  if (!result) {
    return failure("build_swap", "build_failed", "Unable to build swap transaction.", startedAt)
  }

  return success<TransactionData>(
    "build_swap",
    {
      txPayload: result.txPayload,
      quoteSummary: result.quoteSummary as Record<string, unknown>,
    },
    startedAt,
  )
}

async function runBuildBridge(input: ToolInput, context: ToolCallContext): Promise<ToolResult<TransactionData>> {
  const startedAt = Date.now()
  const walletAddress = context.walletAddress || undefined
  const token = getString(input.token) || getString(input.symbol)
  const fromChain = getNumber(input.fromChain)
  const toChain = getNumber(input.toChain)
  const rawAmount = getAmountInput(input)

  if (!walletAddress) {
    return failure("build_bridge", "wallet_missing", "build_bridge requires a connected wallet.", startedAt)
  }
  if (!token || !fromChain || !toChain || !rawAmount) {
    return failure("build_bridge", "missing_inputs", "build_bridge requires `token`, `fromChain`, `toChain`, and `rawAmount` (or amount fields).", startedAt, {
      token,
      fromChain,
      toChain,
      rawAmount,
    })
  }

  const result = await CoinBuddyBrain.buildBridgeTransaction(token, fromChain, toChain, walletAddress, rawAmount)
  if (!result) {
    return failure("build_bridge", "build_failed", "Unable to build bridge transaction.", startedAt)
  }

  return success<TransactionData>(
    "build_bridge",
    {
      txPayload: result.txPayload,
      quoteSummary: result.quoteSummary as unknown as Record<string, unknown>,
    },
    startedAt,
  )
}

async function runFetchPortfolio(_input: ToolInput, context: ToolCallContext): Promise<ToolResult<PortfolioData>> {
  const startedAt = Date.now()
  const walletAddress = context.walletAddress || undefined
  if (!walletAddress) {
    return failure("fetch_portfolio", "wallet_missing", "fetch_portfolio requires a connected wallet.", startedAt)
  }

  const portfolio = await CoinBuddyBrain.fetchPortfolio(walletAddress)
  if (!portfolio.ok) {
    return failure("fetch_portfolio", "portfolio_fetch_failed", "Unable to load portfolio positions.", startedAt, {
      error: portfolio.error,
    })
  }

  return success<PortfolioData>(
    "fetch_portfolio",
    {
      walletAddress,
      count: portfolio.positions.length,
      positions: portfolio.positions,
      raw: {
        ok: portfolio.ok,
        error: portfolio.error,
      },
    },
    startedAt,
  )
}

async function runFetchPrice(input: ToolInput): Promise<ToolResult<PriceData>> {
  const startedAt = Date.now()
  const symbol = getString(input.symbol) || getString(input.token)
  const chainId = getNumber(input.chainId) ?? 1
  if (!symbol) {
    return failure("fetch_price", "missing_symbol", "fetch_price requires a token symbol.", startedAt)
  }

  const price = await CoinBuddyBrain.fetchTokenPrice(symbol, chainId)
  if (!price) {
    return failure("fetch_price", "price_not_found", "Unable to fetch token price.", startedAt, {
      symbol,
      chainId,
    })
  }

  const priceUsd = typeof price.priceUSD === "number"
    ? price.priceUSD
    : typeof price.priceUsd === "number"
      ? price.priceUsd
      : typeof price.price === "number"
        ? price.price
        : null

  return success<PriceData>(
    "fetch_price",
    {
      symbol: getString(price.symbol) || symbol.toUpperCase(),
      chainId,
      priceUsd,
      raw: price,
    },
    startedAt,
  )
}

function buildTool<TInput extends ToolInput, TData>(
  name: string,
  description: string,
  inputSchema: JsonSchemaObject,
  safety: AgentTool["safety"],
  run: (input: TInput, context: ToolCallContext) => Promise<ToolResult<TData>>,
): AgentTool<TInput, TData> {
  return {
    name,
    description,
    inputSchema,
    safety,
    run,
  }
}

const searchVaultsTool = buildTool(
  "search_vaults",
  "Search vault candidates for an asset on one or more chains and return the ranked vault list plus the best match.",
  {
    type: "object",
    properties: {
      asset: {
        type: "string",
        description: "Optional asset symbol to search for, for example USDC. Omit it for broad vault exploration.",
      },
      chainId: {
        type: "integer",
        description: "Primary chain id to search.",
      },
      chainIds: {
        type: "array",
        description: "Optional list of chain ids to search.",
        items: { type: "integer" },
      },
      sortBy: {
        type: "string",
        description: "Sort field passed through to the vault API.",
        default: "apy",
      },
      limit: {
        type: "integer",
        description: "Maximum number of vaults to return.",
        default: 10,
      },
    },
    required: [],
    additionalProperties: true,
  },
  {
    readOnly: true,
  },
  runSearchVaults,
)

const getVaultDetailTool = buildTool(
  "get_vault_detail",
  "Fetch a single vault by chain id and address and return a normalized vault record.",
  {
    type: "object",
    properties: {
      chainId: { type: "integer", description: "Vault chain id." },
      address: { type: "string", description: "Vault contract address." },
      vaultChainId: { type: "integer", description: "Alias for chainId." },
      vaultAddress: { type: "string", description: "Alias for address." },
    },
    required: [],
    additionalProperties: true,
  },
  {
    readOnly: true,
  },
  runGetVaultDetail,
)

const checkBalanceTool = buildTool(
  "check_balance",
  "Check token and native balance for the connected wallet, optionally against a required amount.",
  {
    type: "object",
    properties: {
      chainId: { type: "integer", description: "Chain id to check." },
      tokenAddress: { type: "string", description: "Token contract address." },
      token: { type: "string", description: "Token symbol that can be resolved to an address." },
      symbol: { type: "string", description: "Alias for token." },
      requiredAmount: { type: "string", description: "Optional raw amount to compare against." },
      estimatedGasWei: { type: "string", description: "Optional estimated gas requirement in wei." },
    },
    required: ["chainId"],
    additionalProperties: true,
  },
  {
    readOnly: true,
    requiresWallet: true,
  },
  runCheckBalance,
)

const buildDepositTool = buildTool(
  "build_deposit",
  "Build a deposit transaction payload for a target vault. If depositing a different asset (e.g. USDT) into a USDC vault, just set the 'asset' parameter to USDT. DO NOT use build_swap before this; this tool handles composable swap+deposit automatically.",
  {
    type: "object",
    properties: {
      fromChain: { type: "integer", description: "Source chain id." },
      rawAmount: { type: "string", description: "Raw token amount in base units." },
      amount: { type: "string", description: "Human-readable amount prefix used with amountDecimals." },
      amountDecimals: { type: "string", description: "Decimal suffix used with amount." },
      asset: { type: "string", description: "Source token symbol (e.g. USDT) to deposit from. If different from vault underlying token, a swap will be generated automatically." },
      vault: { type: "object", description: "Normalized vault object from search_vaults or get_vault_detail.", properties: {}, additionalProperties: true },
      vaultAddress: { type: "string", description: "Vault address." },
      vaultChainId: { type: "integer", description: "Vault chain id." },
    },
    required: ["fromChain"],
    additionalProperties: true,
  },
  {
    readOnly: false,
    requiresWallet: true,
    buildsTransaction: true,
    requiresConfirm: true,
  },
  runBuildDeposit,
)

const buildWithdrawTool = buildTool(
  "build_withdraw",
  "Build a withdraw transaction payload for a vault position.",
  {
    type: "object",
    properties: {
      rawAmount: { type: "string", description: "Raw vault share amount in base units." },
      amount: { type: "string", description: "Human-readable amount prefix used with amountDecimals." },
      amountDecimals: { type: "string", description: "Decimal suffix used with amount." },
      vault: { type: "object", description: "Normalized vault object from search_vaults or get_vault_detail.", properties: {}, additionalProperties: true },
      vaultAddress: { type: "string", description: "Vault address." },
      vaultChainId: { type: "integer", description: "Vault chain id." },
    },
    required: [],
    additionalProperties: true,
  },
  {
    readOnly: false,
    requiresWallet: true,
    buildsTransaction: true,
    requiresConfirm: true,
  },
  runBuildWithdraw,
)


const buildSwapTool = buildTool(
  "build_swap",
  "Build a swap transaction payload for a given token pair on a chain.",
  {
    type: "object",
    properties: {
      fromToken: { type: "string", description: "Source token symbol." },
      toToken: { type: "string", description: "Target token symbol." },
      chainId: { type: "integer", description: "Chain id." },
      rawAmount: { type: "string", description: "Raw token amount in base units." },
      amount: { type: "string", description: "Human-readable amount prefix used with amountDecimals. REQUIRED." },
      amountDecimals: { type: "string", description: "Decimal suffix used with amount." },
    },
    required: ["fromToken", "toToken", "chainId", "amount"],
    additionalProperties: true,
  },
  {
    readOnly: false,
    requiresWallet: true,
    buildsTransaction: true,
    requiresConfirm: true,
  },
  runBuildSwap,
)

const buildBridgeTool = buildTool(
  "build_bridge",
  "Build a bridge transaction payload between two chains.",
  {
    type: "object",
    properties: {
      token: { type: "string", description: "Token symbol to bridge." },
      symbol: { type: "string", description: "Alias for token." },
      fromChain: { type: "integer", description: "Source chain id." },
      toChain: { type: "integer", description: "Destination chain id." },
      rawAmount: { type: "string", description: "Raw token amount in base units." },
      amount: { type: "string", description: "Human-readable amount prefix used with amountDecimals." },
      amountDecimals: { type: "string", description: "Decimal suffix used with amount." },
    },
    required: ["token", "fromChain", "toChain"],
    additionalProperties: true,
  },
  {
    readOnly: false,
    requiresWallet: true,
    buildsTransaction: true,
    requiresConfirm: true,
  },
  runBuildBridge,
)

const fetchPortfolioTool = buildTool(
  "fetch_portfolio",
  "Fetch the connected wallet portfolio and return a stable position summary.",
  {
    type: "object",
    properties: {},
    additionalProperties: true,
  },
  {
    readOnly: true,
    requiresWallet: true,
  },
  runFetchPortfolio,
)

const fetchPriceTool = buildTool(
  "fetch_price",
  "Fetch the USD price for a token symbol on a chain.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Token symbol." },
      token: { type: "string", description: "Alias for symbol." },
      chainId: { type: "integer", description: "Chain id used for token lookup.", default: 1 },
    },
    required: ["symbol"],
    additionalProperties: true,
  },
  {
    readOnly: true,
  },
  runFetchPrice,
)

const tools = [
  searchVaultsTool,
  getVaultDetailTool,
  checkBalanceTool,
  buildDepositTool,
  buildSwapTool,
  buildWithdrawTool,
  buildBridgeTool,
  fetchPortfolioTool,
  fetchPriceTool,
] as const

const toolMap = new Map<string, AgentTool>(tools.map((tool) => [tool.name, tool]))

export function getTool(name: string): AgentTool | undefined {
  return toolMap.get(name)
}

export function getAvailableTools(): AgentTool[] {
  return [...tools]
}
