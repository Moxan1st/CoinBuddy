import { CHAIN_NAMES, CHAIN_RPC, TOKEN_ADDRESSES, resolveTokenAddress as resolveSharedTokenAddress, getTokenDecimals } from "../lib/chain-config.ts"
import { createLogger } from "../lib/logger.ts"
import { buildBatchDisplay, buildBridgeDisplay, buildDepositDisplay, buildSwapDisplay, buildWithdrawDisplay } from "../lib/transaction-display.ts"
import type { PortfolioFetchResult, QuoteSummary, Vault } from "../types/index.ts"
import { encodeFunctionData } from "viem"
import { extractQuoteSummary } from "./quote-formatter.ts"

const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const

const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
const EARN_API = "https://earn.li.fi"
const API_BASE = process.env.PLASMO_PUBLIC_API_BASE || ""
const PROXY_TOKEN = process.env.PLASMO_PUBLIC_PROXY_TOKEN || ""
const COMPOSER_API = `${API_BASE}/api/lifi`
const BALANCE_OF_SELECTOR = "0x70a08231"
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const DEFAULT_SLIPPAGE = "0.005"
const INTEGRATOR = "coinbuddy"
const logger = createLogger("LifiClient")

function shortAddress(value?: string | null): string | null {
  return value ? `${value.slice(0, 10)}...${value.slice(-4)}` : null
}

function summarizePayload(payload: Record<string, any> | null | undefined) {
  if (!payload) return null
  const calls = Array.isArray(payload.calls) ? payload.calls : []
  return {
    isBatch: payload.isBatch === true,
    callCount: calls.length || undefined,
    chainId: payload.chainId ?? null,
    to: shortAddress(typeof payload.to === "string" ? payload.to : null),
    firstCallTo: shortAddress(typeof calls[0]?.to === "string" ? calls[0].to : null),
    secondCallTo: shortAddress(typeof calls[1]?.to === "string" ? calls[1].to : null),
    displayTitle: typeof payload.display?.title === "string" ? payload.display.title : null,
    quoteAction: typeof payload.quoteSummary?.action === "string" ? payload.quoteSummary.action : null,
  }
}

export interface BalanceCheck {
  sufficient: boolean
  tokenBalance: bigint
  nativeBalance: bigint
  requiredAmount: bigint
  estimatedGasWei: bigint
}

interface VaultCacheEntry {
  data: Vault[]
  timestamp: number
}

const vaultCache = new Map<number, VaultCacheEntry>()
const CACHE_TTL = 5 * 60 * 1000

async function loadComposableHelpers() {
  return import("../lib/composable.ts")
}

function getCachedVaults(chainId: number): Vault[] | null {
  const entry = vaultCache.get(chainId)
  return entry && Date.now() - entry.timestamp < CACHE_TTL ? entry.data : null
}

/**
 * 核心：直接调用 LI.FI API 根据符号解析代币地址
 */
export async function resolveTokenAddressViaApi(chainId: number, symbol: string): Promise<string | null> {
  try {
    const res = await fetch(`${COMPOSER_API}/token?chain=${chainId}&token=${symbol.toUpperCase()}`, {
      headers: PROXY_TOKEN ? { "x-cb-token": PROXY_TOKEN } : {},
    });
    if (res.ok) {
      const data = await res.json();
      return data.address;
    }
  } catch (e) {
    console.error("LI.FI Token resolution failed", e);
  }
  return null;
}

export async function checkBalance(chainId: number, wallet: string, tokenAddress: string, requiredAmount: string, estimatedGasWei?: string): Promise<BalanceCheck | null> {
  const rpc = CHAIN_RPC[chainId]
  if (!rpc) return null

  const call = async (method: string, params: unknown[]) => {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    return data.result as string
  }

  try {
    const isNative = tokenAddress === ZERO_ADDRESS
    const nativeBalance = BigInt(await call("eth_getBalance", [wallet, "latest"]) || "0x0")
    const tokenBalance = isNative
      ? nativeBalance
      : BigInt(await call("eth_call", [{ to: tokenAddress, data: BALANCE_OF_SELECTOR + wallet.replace("0x", "").padStart(64, "0") }, "latest"]) || "0x0")
    const required = BigInt(requiredAmount)
    const gasNeeded = BigInt(estimatedGasWei || "0")
    return {
      sufficient: isNative ? nativeBalance >= required + gasNeeded : tokenBalance >= required && nativeBalance >= gasNeeded,
      tokenBalance,
      nativeBalance,
      requiredAmount: required,
      estimatedGasWei: gasNeeded,
    }
  } catch (error: any) {
    logger.warn("Balance check failed", { message: error.message, chainId })
    return null
  }
}

export async function fetchOptimalVault(preferredChains: number[], assetSymbol: string, protocol?: string): Promise<Vault | null> {
  const asset = assetSymbol.toUpperCase()
  logger.info("Searching optimal vault", { asset, chains: preferredChains.join(","), protocol: protocol || "any" })

  const fetchChain = async (chainId: number): Promise<Vault[]> => {
    const cached = getCachedVaults(chainId)
    if (cached) return cached
    try {
      const res = await fetch(`${EARN_API}/v1/earn/vaults?chainId=${chainId}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return []
      const { data } = await res.json()
      vaultCache.set(chainId, { data, timestamp: Date.now() })
      return data
    } catch {
      return []
    }
  }

  const assetMatched: Vault[] = []
  const protocolMatched: Vault[] = []
  const results = await Promise.all(preferredChains.map(fetchChain))
  const protocolLower = protocol?.toLowerCase()
  for (const vault of results.flat()) {
    if (!vault.tags?.includes("single") || vault.isTransactional !== true || (vault.analytics?.apy?.total || 0) <= 0) continue
    // Protocol filter: case-insensitive partial match (e.g. "morpho" matches "Morpho Blue")
    if (protocolLower && !vault.protocol?.name?.toLowerCase().includes(protocolLower)) continue
    // When no protocol specified, strict asset match required
    if (!protocolLower) {
      const hasAsset = vault.underlyingTokens?.some((token) => token.symbol?.toUpperCase() === asset)
      if (!hasAsset) continue
    }

    const vaultAsset = vault.underlyingTokens?.[0]?.symbol?.toUpperCase()
    const hasExactAsset = vaultAsset === asset
    if (hasExactAsset) {
      assetMatched.push(vault)
    } else if (protocolLower) {
      // Only include non-matching-asset vaults when protocol is specified (Composer can auto-swap)
      protocolMatched.push(vault)
    }
  }

  // Prefer vaults matching user's asset; fallback to any vault under that protocol
  const allValid = assetMatched.length > 0 ? assetMatched : protocolMatched

  if (allValid.length === 0) {
    if (protocolLower) logger.warn("No vault found matching protocol filter", { protocol, asset, chains: preferredChains.join(",") })
    return null
  }

  logger.info("Vault candidates", { assetMatched: assetMatched.length, protocolFallback: protocolMatched.length, using: assetMatched.length > 0 ? "asset-matched" : "protocol-fallback" })

  const getTvlNum = (tvl: Vault["analytics"]["tvl"]): number => typeof tvl === "object" ? Number(tvl?.usd || 0) : (tvl || 0)
  // When using protocol fallback (different asset), boost mainstream tokens for better Composer route availability
  const isProtocolFallback = assetMatched.length === 0 && protocolLower
  const MAINSTREAM_TOKENS = new Set(["USDC", "USDT", "DAI", "WETH", "ETH"])
  allValid.sort((a, b) => {
    const tvlScore = (tvl: number) => (tvl > 1_000_000 ? 1 : tvl > 100_000 ? 0.5 : 0.1)
    let scoreA = (a.analytics?.apy?.total || 0) * 0.6 + tvlScore(getTvlNum(a.analytics?.tvl)) * 20 * 0.4
    let scoreB = (b.analytics?.apy?.total || 0) * 0.6 + tvlScore(getTvlNum(b.analytics?.tvl)) * 20 * 0.4
    // In fallback mode, heavily boost mainstream tokens (Composer routes are reliable for USDC/USDT/WETH)
    if (isProtocolFallback) {
      const aMainstream = MAINSTREAM_TOKENS.has(a.underlyingTokens?.[0]?.symbol?.toUpperCase() || "")
      const bMainstream = MAINSTREAM_TOKENS.has(b.underlyingTokens?.[0]?.symbol?.toUpperCase() || "")
      if (aMainstream && !bMainstream) scoreA += 50
      if (bMainstream && !aMainstream) scoreB += 50
    }
    return scoreB - scoreA
  })

  return allValid[0]
}

/**
 * 核心功能：构建原子化的存款交易（包含必要的兑换逻辑）
 */
export async function buildDepositTransaction(fromChain: number, vault: Vault, userWallet: string, rawAmount: string, fromTokenSymbol?: string): Promise<{ txPayload: Record<string, any>; quoteSummary: QuoteSummary } | null> {
  if (!userWallet || userWallet === "WALLET_FROM_FRONTEND") return null;
  const underlyingToken = vault.underlyingTokens[0];
  const symbolToResolve = fromTokenSymbol || underlyingToken?.symbol || "USDC";
  logger.info("Build deposit start", {
    fromChain,
    toChain: vault.chainId,
    assetSymbol: symbolToResolve,
    rawAmount,
    vaultAddress: vault.address,
    protocol: vault.protocol?.name,
    wallet: shortAddress(userWallet),
  })

  // 1. 解析地址
  let fromToken = await resolveTokenAddressViaApi(fromChain, symbolToResolve);
  if (!fromToken) {
    fromToken = TOKEN_ADDRESSES[symbolToResolve.toUpperCase()]?.[fromChain] || ZERO_ADDRESS;
  }

  const params = new URLSearchParams({
    fromChain: String(fromChain),
    toChain: String(vault.chainId),
    fromToken,
    toToken: vault.address,
    fromAddress: userWallet,
    toAddress: userWallet,
    fromAmount: rawAmount,
    slippage: DEFAULT_SLIPPAGE,
    integrator: INTEGRATOR,
  });
  // 跨链时启用兑换和目标链调用
  if (fromChain !== vault.chainId) {
    params.set("allowDestinationCall", "true")
  }

  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (PROXY_TOKEN) headers["x-cb-token"] = PROXY_TOKEN;

    logger.info("Build deposit quote request", { url: `${COMPOSER_API}/quote?${params.toString()}`, hasProxyToken: !!PROXY_TOKEN })
    const res = await fetch(`${COMPOSER_API}/quote?${params.toString()}`, {
      headers,
      signal: AbortSignal.timeout(30000)
    });
    const data = await res.json();
    if (!data.transactionRequest || data.message || data.error) {
      logger.warn("Build deposit failed", {
        status: res.status,
        message: data.message,
        error: data.error,
        params: params.toString()
      });
      return null;
    }

    const quoteSummary = extractQuoteSummary(data, "deposit", {
      fromChain,
      toChain: vault.chainId,
      fromToken: symbolToResolve,
      toToken: vault.protocol?.name || vault.name || "Vault",
      fromAmount: rawAmount,
    });

    // 强制修正，避免预估金额变成 e-13
    const fromDecimals = getTokenDecimals(symbolToResolve);
    quoteSummary.fromAmount = Number(rawAmount) / Math.pow(10, fromDecimals);
    quoteSummary.toAmountMin = 0;

    const hasApproval = fromToken !== ZERO_ADDRESS
    const display = buildDepositDisplay({
      amountRaw: rawAmount,
      decimals: fromDecimals,
      asset: symbolToResolve,
      vaultName: vault.name,
      protocolName: vault.protocol?.name || vault.name,
      vaultAddress: vault.address,
      sourceChainId: fromChain,
      targetChainId: Number(data.transactionRequest.chainId || fromChain),
      isBatch: hasApproval,
      hasApproval,
    });

    const spender = quoteSummary.approvalAddress || data.transactionRequest.to
    const calls: Array<{ to: string; data: string; value: string }> = []
    if (hasApproval) {
      calls.push({
        to: fromToken,
        data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender as `0x${string}`, BigInt(MAX_UINT256)] }),
        value: "0",
      })
    }
    calls.push({
      to: data.transactionRequest.to,
      data: data.transactionRequest.data,
      value: data.transactionRequest.value ? BigInt(data.transactionRequest.value).toString() : "0",
    })

    const txPayload = { isBatch: true, chainId: data.transactionRequest.chainId, calls, display, quoteSummary }
    logger.info("Build deposit success", {
      fromChain,
      toChain: vault.chainId,
      assetSymbol: symbolToResolve,
      rawAmount,
      payload: summarizePayload(txPayload),
    })
    return { txPayload, quoteSummary };
  } catch (error: any) {
    logger.error("Build deposit exception", { message: error?.message || String(error), fromChain, toChain: vault.chainId, assetSymbol: symbolToResolve, rawAmount })
    return null;
  }
}

export async function buildSwapTransaction(fromSymbol: string, toSymbol: string, chainId: number, userWallet: string, rawAmount: string): Promise<{ txPayload: Record<string, any>; quoteSummary: QuoteSummary } | null> {
  if (!userWallet || userWallet === "WALLET_FROM_FRONTEND") return null
  const fromToken = TOKEN_ADDRESSES[fromSymbol.toUpperCase()]?.[chainId]
  const toToken = TOKEN_ADDRESSES[toSymbol.toUpperCase()]?.[chainId]
  if (!fromToken || !toToken) return null
  const params = new URLSearchParams({
    fromChain: String(chainId),
    toChain: String(chainId),
    fromToken,
    toToken,
    fromAddress: userWallet,
    toAddress: userWallet,
    fromAmount: rawAmount,
    slippage: DEFAULT_SLIPPAGE,
    integrator: INTEGRATOR,
  })
  const headers: Record<string, string> = { accept: "application/json" }
  if (PROXY_TOKEN) headers["x-cb-token"] = PROXY_TOKEN
  try {
    logger.info("Build swap start", { chainId, fromSymbol, toSymbol, rawAmount, wallet: shortAddress(userWallet) })
    const res = await fetch(`${COMPOSER_API}/quote?${params}`, { headers, signal: AbortSignal.timeout(30000) })
    const data = await res.json()
    if (data.message || data.error || !data.transactionRequest) {
      logger.warn("Build swap failed", { chainId, fromSymbol, toSymbol, rawAmount, status: res.status, message: data.message, error: data.error })
      return null
    }

    const quoteSummary = extractQuoteSummary(data, "swap", {
      fromChain: chainId,
      toChain: chainId,
      fromToken: fromSymbol,
      toToken: toSymbol,
      fromAmount: rawAmount,
    })

    const hasApproval = fromToken !== ZERO_ADDRESS
    const decimals = getTokenDecimals(fromSymbol)
    const display = buildSwapDisplay({
      amountRaw: rawAmount,
      decimals,
      fromAsset: fromSymbol.toUpperCase(),
      toAsset: toSymbol.toUpperCase(),
      chainId,
      hasApproval,
      note: hasApproval ? "Approve + swap will be sent as a two-step batch" : "Single-step native asset swap",
    })

    const spender = quoteSummary.approvalAddress || data.transactionRequest.to
    const calls: Array<{ to: string; data: string; value: string }> = []
    if (hasApproval) {
      calls.push({
        to: fromToken,
        data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender as `0x${string}`, BigInt(MAX_UINT256)] }),
        value: "0",
      })
    }
    calls.push({
      to: data.transactionRequest.to,
      data: data.transactionRequest.data,
      value: data.transactionRequest.value ? BigInt(data.transactionRequest.value).toString() : "0",
    })

    const txPayload = { isBatch: true, chainId: data.transactionRequest.chainId, calls, display, quoteSummary }
    logger.info("Build swap success", { chainId, fromSymbol, toSymbol, rawAmount, payload: summarizePayload(txPayload) })
    return { txPayload, quoteSummary }
  } catch (error: any) {
    logger.error("Build swap exception", { message: error?.message || String(error), chainId, fromSymbol, toSymbol, rawAmount })
    return null
  }
}

export async function buildBridgeTransaction(token: string, fromChain: number, toChain: number, userWallet: string, rawAmount: string): Promise<{ txPayload: Record<string, any>; quoteSummary: QuoteSummary } | null> {
  if (!userWallet || userWallet === "WALLET_FROM_FRONTEND") return null
  const fromToken = TOKEN_ADDRESSES[token.toUpperCase()]?.[fromChain]
  const toToken = TOKEN_ADDRESSES[token.toUpperCase()]?.[toChain]
  if (!fromToken || !toToken) return null
  const params = new URLSearchParams({
    fromChain: String(fromChain),
    toChain: String(toChain),
    fromToken,
    toToken,
    fromAddress: userWallet,
    toAddress: userWallet,
    fromAmount: rawAmount,
    slippage: DEFAULT_SLIPPAGE,
    integrator: INTEGRATOR,
  })
  const headers: Record<string, string> = { accept: "application/json" }
  if (PROXY_TOKEN) headers["x-cb-token"] = PROXY_TOKEN
  try {
    logger.info("Build bridge start", { token, fromChain, toChain, rawAmount, wallet: shortAddress(userWallet) })
    const res = await fetch(`${COMPOSER_API}/quote?${params}`, { headers, signal: AbortSignal.timeout(30000) })
    const data = await res.json()
    if (!data.transactionRequest || data.message || data.error) {
      logger.warn("Build bridge failed", { token, fromChain, toChain, rawAmount, status: res.status, message: data.message, error: data.error })
      return null
    }
    const quoteSummary = extractQuoteSummary(data, "bridge", { fromChain, toChain, fromToken: token.toUpperCase(), toToken: token.toUpperCase(), fromAmount: rawAmount })
    const tokenDecimals = getTokenDecimals(token)
    quoteSummary.fromAmount = Number(rawAmount) / Math.pow(10, tokenDecimals)
    const toTokenDecimals = data.estimate?.toToken?.decimals || tokenDecimals
    if (data.estimate?.toAmount) quoteSummary.toAmount = Number(data.estimate.toAmount) / Math.pow(10, toTokenDecimals)
    if (data.estimate?.toAmountMin) quoteSummary.toAmountMin = Number(data.estimate.toAmountMin) / Math.pow(10, toTokenDecimals)
    const spender = quoteSummary.approvalAddress || data.transactionRequest.to
    const calls: Array<{ to: string; data: string; value: string }> = []
    if (fromToken !== ZERO_ADDRESS) {
      calls.push({
        to: fromToken,
        data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender as `0x${string}`, BigInt(MAX_UINT256)] }),
        value: "0",
      })
    }
    calls.push({ to: data.transactionRequest.to, data: data.transactionRequest.data, value: data.transactionRequest.value ? BigInt(data.transactionRequest.value).toString() : "0" })
    const display = buildBridgeDisplay({
      amountRaw: rawAmount,
      decimals: tokenDecimals,
      asset: token.toUpperCase(),
      sourceChainId: fromChain,
      targetChainId: toChain,
      hasApproval: fromToken !== ZERO_ADDRESS,
      note: fromToken !== ZERO_ADDRESS ? "Approve + bridge will be sent as a two-step batch" : "Single-step native asset bridge",
    })
    const txPayload = { isBatch: true, chainId: data.transactionRequest.chainId, calls, display, quoteSummary }
    logger.info("Build bridge success", { token, fromChain, toChain, rawAmount, payload: summarizePayload(txPayload) })
    return { txPayload, quoteSummary }
  } catch (error: any) {
    logger.error("Build bridge exception", { message: error?.message || String(error), token, fromChain, toChain, rawAmount })
    return null
  }
}

export async function getERC20Balance(chainId: number, tokenAddress: string, wallet: string): Promise<bigint | null> {
  const rpc = CHAIN_RPC[chainId]
  if (!rpc) return null
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: tokenAddress, data: BALANCE_OF_SELECTOR + wallet.replace("0x", "").padStart(64, "0") }, "latest"],
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    return BigInt(data.result || "0x0")
  } catch {
    return null
  }
}

export async function buildWithdrawTransaction(vault: Vault, userWallet: string, rawAmount?: string): Promise<{ txPayload: Record<string, any>; quoteSummary: QuoteSummary } | null> {
  if (vault.isRedeemable !== true || !userWallet || userWallet === "WALLET_FROM_FRONTEND") return null
  const underlyingToken = vault.underlyingTokens[0]
  if (!underlyingToken?.address) return null
  const withdrawAmount = rawAmount || (await getERC20Balance(vault.chainId, vault.address, userWallet))?.toString()
  if (!withdrawAmount) return null

  const params = new URLSearchParams({
    fromChain: String(vault.chainId),
    toChain: String(vault.chainId),
    fromToken: vault.address,
    toToken: underlyingToken.address,
    fromAddress: userWallet,
    toAddress: userWallet,
    fromAmount: withdrawAmount,
    slippage: DEFAULT_SLIPPAGE,
    integrator: INTEGRATOR,
  })
  const headers: Record<string, string> = { accept: "application/json" }
  if (PROXY_TOKEN) headers["x-cb-token"] = PROXY_TOKEN

  try {
    logger.info("Build withdraw start", {
      chainId: vault.chainId,
      vaultAddress: vault.address,
      protocol: vault.protocol?.name,
      rawAmount: withdrawAmount,
      wallet: shortAddress(userWallet),
    })
    const res = await fetch(`${COMPOSER_API}/quote?${params}`, { headers, signal: AbortSignal.timeout(30000) })
    const data = await res.json()
    if (!data.transactionRequest || data.message || data.error) {
      logger.warn("Build withdraw failed", {
        chainId: vault.chainId,
        vaultAddress: vault.address,
        rawAmount: withdrawAmount,
        status: res.status,
        message: data.message,
        error: data.error,
      })
      return null
    }

    const quoteSummary = extractQuoteSummary(data, "withdraw", {
      fromChain: vault.chainId,
      toChain: vault.chainId,
      fromToken: vault.name || "Vault Shares",
      toToken: underlyingToken.symbol,
      fromAmount: withdrawAmount,
    })
    const underlyingDecimals = underlyingToken.decimals || 6
    const est = data.estimate || {}
    quoteSummary.fromAmount = Number(withdrawAmount) / 1e18
    quoteSummary.toAmount = est.toAmount ? Number(est.toAmount) / Math.pow(10, underlyingDecimals) : 0
    quoteSummary.toAmountMin = est.toAmountMin ? Number(est.toAmountMin) / Math.pow(10, underlyingDecimals) : 0

    const spender = quoteSummary.approvalAddress || data.transactionRequest.to
    const calls = [
      {
        to: vault.address,
        data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender as `0x${string}`, BigInt(MAX_UINT256)] }),
        value: "0",
      },
      {
        to: data.transactionRequest.to,
        data: data.transactionRequest.data,
        value: data.transactionRequest.value ? BigInt(data.transactionRequest.value).toString() : "0",
      },
    ]
    const txPayload = {
      isBatch: true,
      chainId: data.transactionRequest.chainId,
      calls,
      display: buildWithdrawDisplay({
        amountRaw: withdrawAmount,
        decimals: underlyingDecimals,
        asset: underlyingToken.symbol,
        vaultName: vault.name,
        protocolName: vault.protocol?.name || vault.name,
        vaultAddress: vault.address,
        chainId: vault.chainId,
        note: "Approve vault shares + withdraw will be sent as a two-step batch",
      }),
      quoteSummary,
    }
    logger.info("Build withdraw success", {
      chainId: vault.chainId,
      vaultAddress: vault.address,
      rawAmount: withdrawAmount,
      payload: summarizePayload(txPayload),
    })
    return { txPayload, quoteSummary }
  } catch (error: any) {
    logger.error("Build withdraw exception", { message: error?.message || String(error), chainId: vault.chainId, vaultAddress: vault.address, rawAmount: withdrawAmount })
    return null
  }
}

export async function fetchVaultComparison(params: { chainId?: number; asset?: string; sortBy?: string; limit?: number; tags?: string; protocol?: string }): Promise<Vault[]> {
  const qs = new URLSearchParams()
  if (params.chainId) qs.set("chainId", String(params.chainId))
  if (params.asset) qs.set("asset", params.asset)
  // When filtering by protocol, fetch max results sorted by TVL (protocol vaults may not rank high by APY)
  // then re-sort client-side by the user's preferred sort
  if (params.protocol) {
    qs.set("sortBy", "tvl")
    qs.set("limit", "100")
  } else {
    if (params.sortBy) qs.set("sortBy", params.sortBy)
    if (params.limit) qs.set("limit", String(params.limit))
  }
  if (params.tags) qs.set("tags", params.tags)
  try {
    const res = await fetch(`${EARN_API}/v1/earn/vaults?${qs}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const { data } = await res.json()
    let results = (data || []).filter((vault: any) => vault.isTransactional && (vault.analytics?.apy?.total || 0) > 0)
    // Client-side protocol filter (case-insensitive partial match)
    if (params.protocol) {
      const protocolLower = params.protocol.toLowerCase()
      results = results.filter((vault: any) => vault.protocol?.name?.toLowerCase().includes(protocolLower))
      // Re-sort by user's preferred sort (default: apy descending)
      const sortBy = params.sortBy || "apy"
      if (sortBy === "apy") {
        results.sort((a: any, b: any) => (b.analytics?.apy?.total || 0) - (a.analytics?.apy?.total || 0))
      }
    }
    // Apply final limit
    const finalLimit = params.limit || 5
    if (results.length > finalLimit) {
      results = results.slice(0, finalLimit)
    }
    return results
  } catch {
    return []
  }
}

export async function fetchVaultDetail(chainId: number, address: string): Promise<Vault | null> {
  try {
    const res = await fetch(`${EARN_API}/v1/earn/vaults/${chainId}/${address}`, { signal: AbortSignal.timeout(10000) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export async function fetchPortfolio(walletAddress: string): Promise<PortfolioFetchResult> {
  try {
    const res = await fetch(`${EARN_API}/v1/earn/portfolio/${walletAddress}/positions`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return { ok: false, positions: [], error: `http_${res.status}` }
    const data = await res.json()
    return { ok: true, positions: data.positions || [] }
  } catch (error: any) {
    return { ok: false, positions: [], error: error.message }
  }
}

export async function fetchSupportedChains(): Promise<any[]> {
  try {
    const res = await fetch(`${EARN_API}/v1/earn/chains`, { signal: AbortSignal.timeout(10000) })
    return res.ok ? await res.json() : []
  } catch {
    return []
  }
}

export async function fetchSupportedProtocols(): Promise<any[]> {
  try {
    const res = await fetch(`${EARN_API}/v1/earn/protocols`, { signal: AbortSignal.timeout(10000) })
    return res.ok ? await res.json() : []
  } catch {
    return []
  }
}

export async function fetchTokenPrice(symbol: string, chainId = 1): Promise<any | null> {
  const query = ({ BTC: "WBTC", BITCOIN: "WBTC" } as Record<string, string>)[symbol.toUpperCase()] || symbol.toUpperCase()
  try {
    const res = await fetch(`${COMPOSER_API}/token?chain=${chainId}&token=${query}`, {
      headers: PROXY_TOKEN ? { "x-cb-token": PROXY_TOKEN } : {},
      signal: AbortSignal.timeout(10000),
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export async function buildComposableBatch(steps: Array<{ action: string; params: Record<string, any> }>, userWallet: string, lang: "zh" | "en" = "en"): Promise<{ calls: Array<{ to: string; data: string; value: string }>; preview: string; erc8211Data?: any; display?: Record<string, any> } | null> {
  const {
    describeBatch,
    txToComposableExecution,
    buildSwapThenDepositComposable,
    encodeExecuteComposable,
  } = await loadComposableHelpers()
  const calls: Array<{ to: string; data: string; value: string }> = []
  const stepDescriptions: Array<{ action: string; description: string }> = []
  let prevOutputEstimate: string | null = null
  let batchChainId: number | null = null
  logger.info("Build composable batch start", {
    stepCount: steps.length,
    actions: steps.map((step) => step.action),
    wallet: shortAddress(userWallet),
  })

  for (const step of steps) {
    if (step.action === "swap") {
      const { fromToken, toToken, amount, amountDecimals, chainId } = step.params
      const rawAmount = amount + (amountDecimals || "")
      const fromAddr = TOKEN_ADDRESSES[fromToken?.toUpperCase()]?.[chainId]
      const toAddr = TOKEN_ADDRESSES[toToken?.toUpperCase()]?.[chainId]
      if (!fromAddr || !toAddr) return null
      const params = new URLSearchParams({
        fromChain: String(chainId),
        toChain: String(chainId),
        fromToken: fromAddr,
        toToken: toAddr,
        fromAddress: userWallet,
        toAddress: userWallet,
        fromAmount: rawAmount,
        slippage: DEFAULT_SLIPPAGE,
        integrator: INTEGRATOR,
        allowDestinationCall: "true",
      })
      const headers: Record<string, string> = { accept: "application/json" }
      if (PROXY_TOKEN) headers["x-cb-token"] = PROXY_TOKEN
      const res = await fetch(`${COMPOSER_API}/quote?${params}`, { headers, signal: AbortSignal.timeout(30000) })
      const data = await res.json()
      if (!data.transactionRequest) {
        logger.warn("Build composable batch swap step failed", { params: params.toString(), status: res.status, message: data.message, error: data.error })
        return null
      }
      const spender = data.estimate?.approvalAddress || data.transactionRequest.to
      if (fromAddr !== ZERO_ADDRESS && spender) {
        calls.push({
          to: fromAddr,
          data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender as `0x${string}`, BigInt(MAX_UINT256)] }),
          value: "0",
        })
      }
      calls.push({ to: data.transactionRequest.to, data: data.transactionRequest.data || "0x", value: data.transactionRequest.value || "0" })
      batchChainId = chainId
      const estimateRaw = data.estimate?.toAmountMin || data.estimate?.toAmount || rawAmount
      prevOutputEstimate = ((BigInt(estimateRaw) * 995n) / 1000n).toString()
      const minReceived = data.estimate?.toAmountMin ? `${(Number(data.estimate.toAmountMin) / Math.pow(10, data.estimate?.toToken?.decimals || 6)).toFixed(4)}` : "?"
      stepDescriptions.push({ action: "swap", description: `Swap ${amount} ${fromToken} -> ${toToken} (${CHAIN_NAMES[chainId] || `Chain ${chainId}`}, min ${minReceived})` })
    } else if (step.action === "deposit") {
      const asset = step.params.searchAsset?.toUpperCase() || "USDC"
      let vault = batchChainId ? await fetchOptimalVault([batchChainId], asset) : null
      let isCrossChain = false
      if (!vault) {
        const allChains = step.params.toChainConfig?.length ? step.params.toChainConfig : [8453, 42161, 10, 1]
        vault = await fetchOptimalVault(allChains, asset)
        isCrossChain = !!vault && vault.chainId !== batchChainId
      }
      if (!vault) return null
      const depositRawAmount = step.params.amount === "ALL_FROM_PREV" && prevOutputEstimate
        ? prevOutputEstimate
        : `${step.params.amount || ""}${step.params.amountDecimals || "000000"}`
      if (!depositRawAmount) return null
      const fromChain = batchChainId || step.params.fromChain || vault.chainId
      const underlyingSymbol = vault.underlyingTokens[0]?.symbol || ""
      const fromToken = resolveSharedTokenAddress(underlyingSymbol, fromChain) || vault.underlyingTokens[0]?.address
      const params = new URLSearchParams({
        fromChain: String(fromChain),
        toChain: String(vault.chainId),
        fromToken,
        toToken: vault.address,
        fromAddress: userWallet,
        toAddress: userWallet,
        fromAmount: depositRawAmount,
        slippage: DEFAULT_SLIPPAGE,
        integrator: INTEGRATOR,
        allowDestinationCall: "true",
      })
      const headers: Record<string, string> = { accept: "application/json" }
      if (PROXY_TOKEN) headers["x-cb-token"] = PROXY_TOKEN
      const res = await fetch(`${COMPOSER_API}/quote?${params}`, { headers, signal: AbortSignal.timeout(30000) })
      const data = await res.json()
      if (!data.transactionRequest) {
        logger.warn("Build composable batch deposit step failed", { params: params.toString(), status: res.status, message: data.message, error: data.error })
        return null
      }
      const depositSpender = data.estimate?.approvalAddress || data.transactionRequest.to
      if (fromToken !== ZERO_ADDRESS && depositSpender) {
        calls.push({
          to: fromToken,
          data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [depositSpender as `0x${string}`, BigInt(MAX_UINT256)] }),
          value: "0",
        })
      }
      calls.push({ to: data.transactionRequest.to, data: data.transactionRequest.data || "0x", value: data.transactionRequest.value || "0" })
      stepDescriptions.push({ action: "deposit", description: `Deposit -> ${vault.protocol.name} (${CHAIN_NAMES[vault.chainId] || `Chain ${vault.chainId}`}, APY ${vault.analytics?.apy?.total?.toFixed(2) || "?"}%)${isCrossChain ? " [cross-chain]" : ""}` })
    }
  }

  if (calls.length === 0) return null
  const preview = describeBatch(stepDescriptions, lang)
  const display = buildBatchDisplay({
    title: lang === "zh" ? "组合交易已就绪" : "Composable transaction ready",
    subtitle: stepDescriptions.length > 0
      ? (lang === "zh"
        ? `包含 ${stepDescriptions.length} 个步骤`
        : `Includes ${stepDescriptions.length} steps`)
      : undefined,
    chainId: batchChainId,
    steps: stepDescriptions.map((step, index) => `${index + 1}. ${step.description}`),
    note: lang === "zh"
      ? "将由钱包按顺序执行这些步骤"
      : "Your wallet will execute these steps in order",
  })
  let erc8211Data: any = null
  try {
    if (calls.length === 2 && steps[0]?.action === "swap" && steps[1]?.action === "deposit") {
      const minOutput = prevOutputEstimate ? BigInt(prevOutputEstimate) * 95n / 100n : 0n
      erc8211Data = { calldata: encodeExecuteComposable(buildSwapThenDepositComposable(calls[0], calls[1], minOutput)), note: "ERC-8211 encoded — ready for executeComposable() when wallets support it" }
    } else {
      erc8211Data = { calldata: encodeExecuteComposable(calls.map((call) => txToComposableExecution(call))), note: "ERC-8211 simple batch encoding" }
    }
  } catch {}
  const batchPayload = { isBatch: true, chainId: batchChainId, calls, display }
  logger.info("Build composable batch success", {
    stepCount: steps.length,
    actions: steps.map((step) => step.action),
    payload: summarizePayload(batchPayload),
    preview,
  })
  return { calls, preview, erc8211Data, display }
}

export function resolveTokenAddress(symbol: string, chainId: number): string | null {
  return resolveSharedTokenAddress(symbol, chainId)
}

export function clearCache() {
  vaultCache.clear()
}



export async function fetchWalletBalances(walletAddress: string, chainIds: number[]): Promise<any[]> {
  logger.info("Fetching wallet balances from LI.FI", { wallet: walletAddress, chains: chainIds });
  try {
    // LI.FI v1/balances 已废弃(404)，使用新的 /v1/wallets/{address}/balances 端点
    const params = new URLSearchParams({
      extended: "true",
      chainIds: chainIds.join(","),
    });
    const headers: Record<string, string> = { accept: "application/json" };
    if (PROXY_TOKEN) headers["x-cb-token"] = PROXY_TOKEN;

    const res = await fetch(`${COMPOSER_API}/balances/${walletAddress}?${params.toString()}`, { headers });
    if (!res.ok) {
      logger.warn("LI.FI Balances API error", { status: res.status });
      return [];
    }
    const data = await res.json();

    const allBalances: any[] = [];
    // 新端点返回 { walletAddress, balances: { chainId: [...tokens] }, limit }
    const balancesByChain = data.balances || {};
    for (const chainKey in balancesByChain) {
      const tokens = balancesByChain[chainKey];
      if (Array.isArray(tokens)) {
        tokens.forEach((t: any) => {
          // amount 现在是原始 wei 值，需要用 decimals 转换
          const rawAmount = parseFloat(t.amount || "0");
          const decimals = t.decimals || 18;
          const amount = rawAmount / Math.pow(10, decimals);
          const price = parseFloat(t.priceUSD || "0"); // 注意：新端点字段名为 priceUSD (大写)
          if (amount > 0 && (amount * price > 0.05)) { // 只记录价值超过 0.05 刀的
            allBalances.push({
              chainId: parseInt(chainKey),
              symbol: t.symbol,
              amount: amount.toString(),
              priceUsd: price,
              valueUsd: amount * price,
            });
          }
        });
      }
    }
    logger.info("Resolved wallet balances", { count: allBalances.length });
    return allBalances;
  } catch (e) {
    logger.error("LI.FI Balances fetch failed", e);
    return [];
  }
}

/**
 * 跨链交易状态轮询
 * 官方建议 5-10 秒间隔，直到 status 为 DONE 或 FAILED
 */
export interface BridgeStatusResult {
  status: "PENDING" | "DONE" | "FAILED" | "NOT_FOUND" | "INVALID"
  substatus?: string
  substatusMessage?: string
  sendingTxHash?: string
  sendingTxLink?: string
  receivingTxHash?: string
  receivingTxLink?: string
  lifiExplorerLink?: string
  receivingAmount?: string
  receivingAmountUSD?: string
  tool?: string
}

export async function pollBridgeStatus(
  txHash: string,
  fromChain: number,
  toChain: number,
  onUpdate?: (result: BridgeStatusResult) => void,
  maxAttempts = 60,
  intervalMs = 10000,
): Promise<BridgeStatusResult> {
  const headers: Record<string, string> = { accept: "application/json" }
  if (PROXY_TOKEN) headers["x-cb-token"] = PROXY_TOKEN

  const params = new URLSearchParams({
    txHash,
    fromChain: String(fromChain),
    toChain: String(toChain),
  })

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${COMPOSER_API}/status?${params}`, { headers, signal: AbortSignal.timeout(15000) })
      const data = await res.json()

      const result: BridgeStatusResult = {
        status: data.status || "NOT_FOUND",
        substatus: data.substatus,
        substatusMessage: data.substatusMessage,
        sendingTxHash: data.sending?.txHash,
        sendingTxLink: data.sending?.txLink,
        receivingTxHash: data.receiving?.txHash,
        receivingTxLink: data.receiving?.txLink,
        lifiExplorerLink: data.lifiExplorerLink,
        receivingAmount: data.receiving?.amount,
        receivingAmountUSD: data.receiving?.amountUSD,
        tool: data.tool,
      }

      onUpdate?.(result)
      logger.info("Bridge status poll", { attempt: i + 1, status: result.status, substatus: result.substatus })

      if (result.status === "DONE" || result.status === "FAILED") {
        return result
      }
    } catch (err) {
      logger.warn("Bridge status poll error", { attempt: i + 1, error: err instanceof Error ? err.message : String(err) })
    }

    await new Promise(r => setTimeout(r, intervalMs))
  }

  logger.warn("Bridge status poll timeout", { txHash, fromChain, toChain, maxAttempts })
  return { status: "PENDING", substatusMessage: "Polling timeout - check explorer for status" }
}
