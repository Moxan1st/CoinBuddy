import { CoinBuddyBrain } from "../brain.ts"
import { detectLang, generateText } from "../llm-client.ts"
import { CHAIN_NAMES } from "../../lib/chain-config.ts"
import { createLogger } from "../../lib/logger.ts"
import type { ActionType, StepOutput, Vault } from "../../types/index.ts"
import type { HandlerContext } from "../handlers/types.ts"

const logger = createLogger("ActionRegistry")

type ActionFn = (
  params: Record<string, unknown>,
  ctx: HandlerContext,
  depOutputs: Map<string, StepOutput>,
) => Promise<StepOutput>

function ok(data: Record<string, unknown>): StepOutput {
  return { ok: true, data }
}

function fail(error: string): StepOutput {
  return { ok: false, data: {}, error }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  return items.length > 0 ? items : undefined
}

function getNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .map(getNumber)
    .filter((item): item is number => typeof item === "number")
  return items.length > 0 ? items : undefined
}

function getDepField(depOutputs: Map<string, StepOutput>, stepId: string, fieldName: string): unknown {
  const step = depOutputs.get(stepId)
  return step?.data?.[fieldName]
}

function resolveParamValue(value: unknown, depOutputs: Map<string, StepOutput>): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\$(\w+)\.(\w+)$/)
    if (match) {
      return getDepField(depOutputs, match[1], match[2])
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveParamValue(item, depOutputs))
  }

  if (typeof value === "object" && value !== null) {
    const resolved: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      resolved[key] = resolveParamValue(nested, depOutputs)
    }
    return resolved
  }

  return value
}

export function resolveParams(
  params: Record<string, unknown>,
  depOutputs: Map<string, StepOutput>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = resolveParamValue(value, depOutputs)
  }
  return resolved
}

function vaultFromResolvedParams(params: Record<string, unknown>, depOutputs: Map<string, StepOutput>): Vault | null {
  const directVault = getRecord(params.vault) as unknown as Vault | null
  if (directVault?.address && directVault.chainId) return directVault

  const vaultAddress = getString(params.vaultAddress)
  const vaultChainId = getNumber(params.vaultChainId)
  const protocol = getString(params.protocol)
  const apy = getNumber(params.apy)
  const asset = getString(params.asset)

  if (vaultAddress && vaultChainId) {
    return {
      address: vaultAddress,
      chainId: vaultChainId,
      name: asset || "Vault",
      protocol: { name: protocol || "unknown" },
      analytics: { apy: { base: 0, reward: 0, total: apy || 0 } },
      underlyingTokens: asset ? [{ address: "", symbol: asset }] : [],
    }
  }

  for (const output of depOutputs.values()) {
    const candidate = getRecord(output.data.vault) as unknown as Vault | null
    if (candidate?.address && candidate.chainId) return candidate
  }

  return null
}

const searchVaults: ActionFn = async (params, _ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const chainIds = getNumberArray(resolved.chainIds)
  const asset = getString(resolved.asset)
  if (!chainIds?.length || !asset) return fail("missing_chainIds_or_asset")

  const vault = await CoinBuddyBrain.fetchOptimalVault(chainIds, asset)
  if (!vault) return fail("vault_not_found")

  return ok({
    vault,
    vaultAddress: vault.address,
    vaultChainId: vault.chainId,
    apy: vault.analytics?.apy?.total ?? 0,
    protocol: vault.protocol?.name || "unknown",
  })
}

const compareVaults: ActionFn = async (params, _ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const chainId = getNumber(resolved.chainId)
  const asset = getString(resolved.asset)
  const sortBy = getString(resolved.sortBy)
  const limit = getNumber(resolved.limit)
  const tags = getString(resolved.tags)

  const vaults = await CoinBuddyBrain.fetchVaultComparison({ chainId, asset, sortBy, limit, tags })
  const best = vaults[0]

  return ok({
    vaults,
    vaultCount: vaults.length,
    bestApy: best?.analytics?.apy?.total ?? 0,
    bestVault: best
      ? {
          address: best.address,
          chainId: best.chainId,
          protocol: best.protocol?.name || "unknown",
        }
      : null,
  })
}

const getVaultDetail: ActionFn = async (params, _ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const chainId = getNumber(resolved.chainId)
  const address = getString(resolved.address)
  if (!chainId || !address) return fail("missing_chainId_or_address")

  const vault = await CoinBuddyBrain.fetchVaultDetail(chainId, address)
  if (!vault) return fail("vault_detail_not_found")

  return ok({
    vault,
    isRedeemable: vault.isRedeemable === true,
    apy: vault.analytics?.apy?.total ?? 0,
    protocol: vault.protocol?.name || "unknown",
  })
}

const checkBalanceAction: ActionFn = async (params, ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const wallet = ctx.walletAddress
  const chainId = getNumber(resolved.chainId)
  const tokenAddress = getString(resolved.tokenAddress) || getString(resolved.token)
  if (!wallet) return fail("wallet_not_connected")
  if (!chainId || !tokenAddress) return fail("missing_chainId_or_tokenAddress")

  const balance = await CoinBuddyBrain.checkBalance(chainId, wallet, tokenAddress, "0")
  if (!balance) return fail("balance_check_failed")

  return ok({
    sufficient: balance.sufficient,
    balance: balance.tokenBalance.toString(),
    nativeBalance: balance.nativeBalance.toString(),
  })
}

const buildDeposit: ActionFn = async (params, ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const wallet = ctx.walletAddress
  const fromChain = getNumber(resolved.fromChain)
  const rawAmount = getString(resolved.rawAmount)
    || (() => {
      const amount = getString(resolved.amount)
      const amountDecimals = getString(resolved.amountDecimals)
      return amount && typeof amountDecimals === "string" ? `${amount}${amountDecimals}` : undefined
    })()
  const vault = vaultFromResolvedParams(resolved, depOutputs)

  if (!wallet) return fail("wallet_not_connected")
  if (!fromChain || !rawAmount || !vault) return fail("missing_deposit_inputs")

  const result = await CoinBuddyBrain.buildDepositTransaction(fromChain, vault, wallet, rawAmount)
  if (!result) return fail("build_deposit_failed")

  return ok({ txPayload: result.txPayload })
}

const buildSwap: ActionFn = async (params, ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const wallet = ctx.walletAddress
  const fromToken = getString(resolved.fromToken)
  const toToken = getString(resolved.toToken)
  const chainId = getNumber(resolved.chainId)
  const rawAmount = getString(resolved.rawAmount)
    || (() => {
      const amount = getString(resolved.amount)
      const amountDecimals = getString(resolved.amountDecimals)
      return amount && typeof amountDecimals === "string" ? `${amount}${amountDecimals}` : undefined
    })()

  if (!wallet) return fail("wallet_not_connected")
  if (!fromToken || !toToken || !chainId || !rawAmount) return fail("missing_swap_inputs")

  const result = await CoinBuddyBrain.buildSwapTransaction(fromToken, toToken, chainId, wallet, rawAmount)
  if (!result) return fail("build_swap_failed")

  return ok({ txPayload: result.txPayload })
}

const buildBridge: ActionFn = async (params, ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const wallet = ctx.walletAddress
  const token = getString(resolved.token)
  const fromChain = getNumber(resolved.fromChain)
  const toChain = getNumber(resolved.toChain)
  const rawAmount = getString(resolved.rawAmount)
    || (() => {
      const amount = getString(resolved.amount)
      const amountDecimals = getString(resolved.amountDecimals)
      return amount && typeof amountDecimals === "string" ? `${amount}${amountDecimals}` : undefined
    })()

  if (!wallet) return fail("wallet_not_connected")
  if (!token || !fromChain || !toChain || !rawAmount) return fail("missing_bridge_inputs")

  const result = await CoinBuddyBrain.buildBridgeTransaction(token, fromChain, toChain, wallet, rawAmount)
  if (!result) return fail("build_bridge_failed")

  return ok({
    txPayload: result.txPayload,
    quoteSummary: result.quoteSummary,
  })
}

const buildWithdraw: ActionFn = async (params, ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const wallet = ctx.walletAddress
  const rawAmount = getString(resolved.rawAmount)
  let vault = vaultFromResolvedParams(resolved, depOutputs)

  const chainId = getNumber(resolved.vaultChainId) || vault?.chainId
  const address = getString(resolved.vaultAddress) || vault?.address
  if ((!vault || vault.protocol?.name === "unknown") && chainId && address) {
    vault = await CoinBuddyBrain.fetchVaultDetail(chainId, address)
  }

  if (!wallet) return fail("wallet_not_connected")
  if (!vault) return fail("missing_withdraw_vault")

  const result = await CoinBuddyBrain.buildWithdrawTransaction(vault, wallet, rawAmount)
  if (!result) return fail("build_withdraw_failed")

  return ok({
    txPayload: result.txPayload,
    quoteSummary: result.quoteSummary,
  })
}

const fetchPrice: ActionFn = async (params, _ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const symbol = getString(resolved.symbol)
  const chainId = getNumber(resolved.chainId) || 1
  if (!symbol) return fail("missing_symbol")

  const token = await CoinBuddyBrain.fetchTokenPrice(symbol, chainId)
  if (!token) return fail("price_not_found")

  return ok({
    price: token.priceUSD,
    symbol: token.symbol || symbol.toUpperCase(),
    priceUsd: token.priceUSD,
  })
}

const fetchPortfolio: ActionFn = async (_params, ctx) => {
  const wallet = ctx.walletAddress
  if (!wallet) return fail("wallet_not_connected")

  const positions = await ctx.ensurePortfolioSnapshot(wallet)
  return ok({ positions, count: positions.length })
}

const replyUser: ActionFn = async (params, ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const context = getString(resolved.context)
  if (!context) return fail("missing_context")

  const lang = detectLang(ctx.userText || context)
  const chainNames = Object.entries(CHAIN_NAMES)
    .map(([id, name]) => `${id}: ${name}`)
    .join(", ")

  try {
    const reply = await generateText([
      {
        role: "user",
        parts: [{
          text: [
            "You are CoinBuddy.",
            `Reply in ${lang === "zh" ? "Chinese" : "English"}.`,
            "Write a concise user-facing response based on the context below.",
            `Known chains: ${chainNames}`,
            `Context: ${context}`,
          ].join("\n"),
        }],
      },
    ])
    return ok({ reply })
  } catch (error) {
    logger.error("reply_user failed", { error: error instanceof Error ? error.message : String(error) })
    return fail("reply_user_failed")
  }
}

const checkBalanceOnChains: ActionFn = async (params, ctx, depOutputs) => {
  const resolved = resolveParams(params, depOutputs)
  const wallet = ctx.walletAddress
  const asset = getString(resolved.asset)
  if (!wallet) return fail("wallet_not_connected")
  if (!asset) return fail("missing_asset")

  const chainIds = getNumberArray(resolved.chainIds) || [1, 8453, 42161, 10, 137, 56]
  const balances = await CoinBuddyBrain.fetchWalletBalances(wallet, chainIds)
  const assetBalances = balances
    .filter((b: any) => b.symbol?.toUpperCase() === asset.toUpperCase())
    .sort((a: any, b: any) => (b.valueUsd || 0) - (a.valueUsd || 0))

  if (assetBalances.length === 0) return fail(`no_${asset}_balance_found`)

  const best = assetBalances[0]
  return ok({
    bestChainId: best.chainId,
    bestBalance: best.amount,
    bestValueUsd: best.valueUsd,
    allBalances: assetBalances,
  })
}

export const actionRegistry = new Map<ActionType, ActionFn>([
  ["search_vaults", searchVaults],
  ["compare_vaults", compareVaults],
  ["get_vault_detail", getVaultDetail],
  ["check_balance", checkBalanceAction],
  ["check_balance_on_chains", checkBalanceOnChains],
  ["build_deposit", buildDeposit],
  ["build_swap", buildSwap],
  ["build_bridge", buildBridge],
  ["build_withdraw", buildWithdraw],
  ["fetch_price", fetchPrice],
  ["fetch_portfolio", fetchPortfolio],
  ["reply_user", replyUser],
])

export function getAction(type: ActionType): ActionFn | undefined {
  return actionRegistry.get(type)
}

export function getAvailableActions(): ActionType[] {
  return Array.from(actionRegistry.keys())
}
