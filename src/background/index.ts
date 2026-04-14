// CoinBuddy Background Service Worker
// 消息路由 + 对话记忆 + 待确认状态管理

import { CoinBuddyBrain, detectLang, type ChatMessage } from "./brain"
import {
  applyVaultSelection,
  cacheVaultChoices,
  cachePendingDepositRecommendation,
  clearPendingDepositDraft,
  createPendingDepositDraft,
  getDepositConfirmability,
  promoteSingleVaultChoice,
  type PendingDepositDraft,
  type PendingInvestParams,
} from "./dialogue-state"
import { disambiguateByPositions, isKnownNotRedeemable, isValidEvmAddress, isValidVaultCandidate, matchVaultsByProtocol, needsVaultDetailRefresh, shouldForceDetailRefresh, type VaultSource } from "./withdraw-context"
import { getWalletGateReason, type WalletGateReason } from "./wallet-gate"
import { getEffectiveWalletAddress } from "./wallet-resolve"
import { normalizePortfolioPositions } from "./portfolio-normalize"
import {
  clearWalletSession,
  getPortfolioSnapshot,
  isPortfolioFresh,
  setPortfolioSnapshot,
  setWalletSession,
  type PortfolioPositionSummary,
} from "./session-cache"
import { startStrategyEngine, registerStrategyHandlers, getEngine } from "~strategy"
import type { Vault } from "~types"
import { routeIntent } from "./handlers"
import type { HandlerContext } from "./handlers/types"
import { createLogger } from "~lib/logger"
import { CHAIN_NAMES, getTokenDecimals, resolveChainId } from "~lib/chain-config"
import { generatePlan, executePlan, getPendingPlanExecution, clearPendingPlanExecution } from "./planner"
import { clearPendingAgentSession, getPendingAgentSession } from "./agent/state"
import { getAvailableTools, getTool } from "./agent/tool-registry"
import { resumePendingReActRuntime, runReActRuntime } from "./agent/runtime"
import {
  clearPendingTransactionPayload,
  getPendingTransactionPayload,
  getPendingTransactionPayloadFromStorage,
  setPendingTransactionPayload,
} from "./transaction-state"
import { extractInvestParamsFromText } from "./llm-client"

// 会话记忆（Service Worker 生命周期内持久化，最多 20 条）
let conversationHistory: ChatMessage[] = []
const MAX_HISTORY = 20

// 待确认状态缓存：用户确认时直接复用，无需重新搜索
let pendingDepositDraft = createPendingDepositDraft()

// Withdraw+Bridge 两步流程状态：withdraw 完成后等待用户触发 bridge
let pendingBridgeAfterWithdraw: {
  token: string       // underlying token symbol from withdraw
  fromChain: number   // vault chain (where tokens land after withdraw)
  toChain: number     // user's target bridge chain
} | null = null

// 策略创建草稿：用户确认后才落库
let pendingStrategyDraft: {
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
} | null = null

function isExecuteFollowupRequest(text: string): boolean {
  return /(?:让我签名|签名|签一下|execute|submit|broadcast|send it|发起交易|提交交易|执行交易)/i.test(text)
}

function cacheTransactionPayload(transactionPayload: Record<string, unknown> | null, sourceText: string): void {
  if (!transactionPayload) return
  setPendingTransactionPayload(transactionPayload, sourceText)
}

const logger = createLogger("Background")

function shortWallet(address?: string | null) {
  return address ? `${address.slice(0, 10)}...` : "NONE"
}

function inferAmountDecimals(symbol: string): string {
  return "0".repeat(getTokenDecimals(symbol || "ETH"))
}

function extractPendingInvestParamsFromText(userText: string): PendingInvestParams | null {
  const trimmed = userText.trim()
  if (!trimmed) return null

  const assetMatch = trimmed.match(/\b(USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i)
  const searchAsset = assetMatch?.[1]?.toUpperCase() || ""

  const amountMatch =
    trimmed.match(/(\d+(?:\.\d+)?)\s*(?:USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i) ||
    trimmed.match(/(?:put|deposit|invest|存)\s*(\d+(?:\.\d+)?)/i)
  const amount = amountMatch?.[1] || ""

  const chainCandidates = [
    "ethereum",
    "eth",
    "base",
    "arbitrum",
    "arb",
    "optimism",
    "op",
    "polygon",
    "matic",
    "avalanche",
    "avax",
    "bsc",
    "bnb",
  ]
  let chainId: number | undefined
  for (const candidate of chainCandidates) {
    if (new RegExp(`\\b${candidate}\\b`, "i").test(trimmed)) {
      chainId = resolveChainId(candidate)
      break
    }
  }

  // Extract protocol name
  const protocolCandidates = [
    "morpho", "aave", "compound", "lido", "yearn", "yo",
    "moonwell", "seamless", "venus", "benqi", "spark",
    "fluid", "euler", "silo", "radiant", "ionic",
  ]
  let protocol: string | undefined
  for (const p of protocolCandidates) {
    if (new RegExp(p, "i").test(trimmed)) {
      protocol = p.toLowerCase()
      break
    }
  }

  if (!searchAsset && !amount && !chainId && !protocol) return null

  return {
    amount,
    amountDecimals: amount ? inferAmountDecimals(searchAsset || "ETH") : "",
    searchAsset,
    fromChain: chainId || 8453,
    toChainConfig: chainId ? [chainId] : [8453, 42161, 10],
    protocol,
  }
}

function recoverPendingInvestParamsFromHistory(history: ChatMessage[]): PendingInvestParams | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]
    if (entry.role !== "user") continue
    const recovered = extractInvestParamsFromText(entry.text)
    if (recovered) return recovered
  }
  return null
}

function extractVaultsFromToolData(data: unknown): Vault[] {
  if (!data || typeof data !== "object") return []
  const record = data as Record<string, any>
  const candidates: Vault[] = []

  const pushVault = (vault: unknown) => {
    if (!vault || typeof vault !== "object") return
    const candidate = vault as Record<string, any>
    if (typeof candidate.address === "string" && typeof candidate.chainId === "number") {
      candidates.push(candidate as Vault)
    } else if (candidate.raw && typeof candidate.raw === "object") {
      const raw = candidate.raw as Record<string, any>
      if (typeof raw.address === "string" && typeof raw.chainId === "number") {
        candidates.push(raw as Vault)
      }
    }
  }

  if (Array.isArray(record.vaults)) {
    for (const vault of record.vaults) pushVault(vault)
  }
  if (record.bestVault) pushVault(record.bestVault)
  if (record.vault) pushVault(record.vault)

  return candidates
}

function createReActToolRegistry(
  draft: PendingDepositDraft,
  walletAddress: string | null,
  seededInvestParams: PendingInvestParams | null,
) {
  return {
    getTool: (name: string) => {
      const tool = getTool(name)
      if (!tool) return undefined

      if (name !== "search_vaults" && name !== "get_vault_detail" && name !== "build_deposit") {
        return tool
      }

      return {
        ...tool,
        run: async (input: Record<string, unknown>, context: Parameters<typeof tool.run>[1]) => {
          const result = await tool.run(input, context)
          if (!result.ok) return result

          const vaults = extractVaultsFromToolData(result.data)
          if (vaults.length > 0) {
            const selectedVault = vaults[0]
            cachePendingDepositRecommendation(draft, {
              investParams: seededInvestParams ?? undefined,
              selectedVault,
              vaultChoices: name === "search_vaults" ? vaults : undefined,
              walletAddress: walletAddress ?? undefined,
            })
          }

          return result
        },
      }
    },
    listTools: () => getAvailableTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      requiresConfirm: tool.safety.requiresConfirm === true,
      inputSchema: tool.inputSchema,
    })),
  }
}

function parseCompareSelectionRequest(text: string): { left: number; right: number } | null {
  const normalized = text.trim().toLowerCase()

  const digitMatch = normalized.match(/(\d+)\s*(?:池子|个|vault)?\s*(?:和|跟|vs|对比|比较)\s*(\d+)/i)
  if (digitMatch) {
    return { left: Number(digitMatch[1]), right: Number(digitMatch[2]) }
  }

  const zhNumberMap: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
  }
  const zhMatch = normalized.match(/第([一二两三四五])(?:个)?(?:池子)?\s*(?:和|跟|vs|对比|比较)\s*第([一二两三四五])/)
  if (zhMatch) {
    return { left: zhNumberMap[zhMatch[1]], right: zhNumberMap[zhMatch[2]] }
  }

  return null
}

function isVaultDetailFollowup(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return /detail|details|info|information|tell me more|more about|详情|介绍|信息|展开说说/.test(normalized)
}

function isSelectionOnlyRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return /^(第?[一二两三四五六七八九十\d]+个?|first|second|third|fourth|fifth|top\s*\d+)$/i.test(normalized)
}

function formatVaultComparisonReply(vaultA: Vault, vaultB: Vault, lang: "zh" | "en"): string {
  const apyA = vaultA.analytics?.apy?.total ?? 0
  const apyB = vaultB.analytics?.apy?.total ?? 0
  const tvlA = typeof vaultA.analytics?.tvl === "object" ? Number((vaultA.analytics.tvl as any)?.usd || 0) : Number(vaultA.analytics?.tvl || 0)
  const tvlB = typeof vaultB.analytics?.tvl === "object" ? Number((vaultB.analytics.tvl as any)?.usd || 0) : Number(vaultB.analytics?.tvl || 0)
  const fmtTvl = (value: number) => value > 1e6 ? `$${(value / 1e6).toFixed(1)}M` : value > 1e3 ? `$${(value / 1e3).toFixed(0)}K` : `$${value.toFixed(0)}`
  const chainA = CHAIN_NAMES[vaultA.chainId] || `Chain ${vaultA.chainId}`
  const chainB = CHAIN_NAMES[vaultB.chainId] || `Chain ${vaultB.chainId}`
  const assetsA = vaultA.underlyingTokens?.map((t) => t.symbol).filter(Boolean).join(", ") || "?"
  const assetsB = vaultB.underlyingTokens?.map((t) => t.symbol).filter(Boolean).join(", ") || "?"

  if (lang === "zh") {
    const winner = apyA === apyB ? "两个池子的 APY 差不多。" : apyA > apyB
      ? "第1个池子的收益更高。"
      : "第2个池子的收益更高。"
    return [
      "喵～这两个池子的区别我给你拆开说：",
      `1号: ${vaultA.protocol.name} (${chainA})，资产 ${assetsA}，APY ${apyA.toFixed(2)}%，TVL ${fmtTvl(tvlA)}`,
      `2号: ${vaultB.protocol.name} (${chainB})，资产 ${assetsB}，APY ${apyB.toFixed(2)}%，TVL ${fmtTvl(tvlB)}`,
      winner,
      "如果你要，我下一句可以继续帮你展开风险、激励收益占比和可赎回性。",
    ].join("\n")
  }

  const winner = apyA === apyB ? "Their APYs are roughly the same." : apyA > apyB
    ? "Vault 1 has the higher yield."
    : "Vault 2 has the higher yield."
  return [
    "Meow~ Here's the difference between those two vaults:",
    `1: ${vaultA.protocol.name} (${chainA}), asset ${assetsA}, APY ${apyA.toFixed(2)}%, TVL ${fmtTvl(tvlA)}`,
    `2: ${vaultB.protocol.name} (${chainB}), asset ${assetsB}, APY ${apyB.toFixed(2)}%, TVL ${fmtTvl(tvlB)}`,
    winner,
    "If you want, I can also break down risk, reward-yield mix, and redeemability next.",
  ].join("\n")
}

function pushHistory(role: "user" | "model", text: string) {
  conversationHistory.push({ role, text })
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY)
  }
}

function clearPending() {
  clearPendingDepositDraft(pendingDepositDraft)
  pendingBridgeAfterWithdraw = null
  pendingStrategyDraft = null
  clearPendingTransactionPayload()
  clearPendingPlanExecution()
  clearPendingAgentSession()
}

// 双语固定回复
const L = (lang: "zh" | "en", zh: string, en: string) => lang === "zh" ? zh : en

function buildWalletGateReply(reason: WalletGateReason, lang: "zh" | "en") {
  switch (reason) {
    case "portfolio":
      return L(lang,
        "喵～查你的持仓前，本猫得先确认你连上了钱包。先连钱包，我再把资产和金库仓位翻给你看～",
        "Meow~ I need your wallet connected before I can inspect your positions. Connect it first and I'll show your assets and vault holdings~")
    case "confirm":
      return L(lang,
        "喵～这一步要真正构建交易，本猫得先确认你连上了钱包。先连钱包，再跟我说「确认」～",
        "Meow~ This step builds a real transaction, so I need your wallet connected first. Connect it, then say 'confirm' again~")
    case "execute":
      return L(lang,
        "喵～要签名这笔已构建好的交易，本猫得先确认你连上了钱包。先连钱包，然后再说「签名」～",
        "Meow~ I need your wallet connected before I can let you sign the built transaction. Connect it first, then say 'sign'~")
    case "swap":
      return L(lang,
        "喵～兑换前，本猫得先确认你连上了钱包。先连钱包，我再继续帮你换币～",
        "Meow~ I need your wallet connected before I can build the swap. Connect it first and I'll keep going~")
    case "bridge":
      return L(lang,
        "喵～跨链前，本猫得先确认你连上了钱包。先连钱包，我再继续帮你桥过去～",
        "Meow~ I need your wallet connected before I can build the bridge. Connect it first and I'll continue the transfer~")
    case "withdraw":
      return L(lang,
        "喵～取款前，本猫得先确认你连上了钱包，才能识别你在哪个金库里有份额。先连钱包，我再帮你全部取出来～",
        "Meow~ I need your wallet connected before I can withdraw, so I can detect which vault actually holds your position. Connect it first and I'll withdraw everything~")
    case "withdraw_bridge":
      return L(lang,
        "喵～这笔操作要先取款再跨链，本猫得先确认你连上了钱包。先连钱包，我再继续整条路径～",
        "Meow~ This flow withdraws first and then bridges, so I need your wallet connected before I continue. Connect it first and I'll handle the whole route~")
    case "composite":
      return L(lang,
        "喵～这是多步动作，本猫得先确认你连上了钱包，才能继续构建整条路径～",
        "Meow~ This is a multi-step action, so I need your wallet connected before I can build the whole route~")
  }
}

// 向发送消息的 tab 推送进度更新
function sendProgress(tabId: number | undefined, text: string) {
  if (!tabId) return
  chrome.tabs.sendMessage(tabId, { action: "PROGRESS", text }).catch(() => {})
}

const PORTFOLIO_CACHE_TTL_MS = 20_000
let portfolioRefreshPromise: Promise<PortfolioPositionSummary[]> | null = null

interface ResolveVaultResult {
  vault: Vault | null
  ambiguousCandidates?: Vault[]
  detailRefreshFailed?: boolean
  /** true when wallet was connected but no candidates had share balance > 0 */
  noPositionsFound?: boolean
  portfolioUnavailable?: boolean
}

async function buildPositionMap(
  vaults: Vault[],
  fallbackChainId: number | undefined,
  walletAddress: string,
): Promise<Map<string, boolean>> {
  const entries = await Promise.all(
    vaults.map(async (v) => {
      const chainId = v.chainId || fallbackChainId
      if (!chainId) return [v.address?.toLowerCase(), false] as const
      const bal = await CoinBuddyBrain.getERC20Balance(chainId, v.address, walletAddress)
      return [v.address?.toLowerCase(), bal !== null && bal > 0n] as const
    }),
  )
  return new Map(entries)
}

async function refreshPortfolioSnapshot(walletAddress: string): Promise<PortfolioPositionSummary[]> {
  if (portfolioRefreshPromise) return portfolioRefreshPromise

  portfolioRefreshPromise = (async () => {
    const result = await CoinBuddyBrain.fetchPortfolio(walletAddress)
    if (!result.ok) {
      const snapshot = getPortfolioSnapshot()
      logger.warn("Portfolio refresh failed; preserving cached snapshot", {
        error: result.error || "unknown_error",
        positions: snapshot.positions.length,
      })
      throw new Error(result.error || "portfolio_refresh_failed")
    }
    const normalized = normalizePortfolioPositions(result.positions)
    setPortfolioSnapshot(walletAddress, normalized)
    logger.info("Portfolio snapshot refreshed", {
      positions: normalized.length,
      wallet: shortWallet(walletAddress),
    })
    return normalized
  })()

  try {
    return await portfolioRefreshPromise
  } finally {
    portfolioRefreshPromise = null
  }
}

async function ensurePortfolioSnapshot(
  walletAddress: string,
  force = false,
): Promise<PortfolioPositionSummary[]> {
  if (!force && isPortfolioFresh(walletAddress, PORTFOLIO_CACHE_TTL_MS)) {
    const snapshot = getPortfolioSnapshot()
    logger.debug("Using fresh portfolio cache", { positions: snapshot.positions.length })
    return snapshot.positions
  }
  return await refreshPortfolioSnapshot(walletAddress)
}

function getWithdrawPortfolioCandidates(
  positions: PortfolioPositionSummary[],
  vaultChainId?: number,
): PortfolioPositionSummary[] {
  return positions.filter((position) => {
    if (!position.vaultAddress || !position.vaultChainId) return false
    if (vaultChainId && position.vaultChainId !== vaultChainId) return false
    return true
  })
}

function getWithdrawPortfolioProtocolHints(
  positions: PortfolioPositionSummary[],
  vaultChainId?: number,
): PortfolioPositionSummary[] {
  const seen = new Set<string>()
  return positions.filter((position) => {
    if (position.vaultAddress) return false
    if (!position.protocolName || !position.vaultChainId) return false
    if (vaultChainId && position.vaultChainId !== vaultChainId) return false

    const key = [
      position.vaultChainId,
      position.protocolName.toLowerCase(),
      (position.assetSymbol || "")?.toUpperCase() || "",
    ].join(":")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function resolveVaultForWithdraw(
  params: { vaultChainId?: number; vaultAddress?: string; useContext?: boolean; selectionProtocol?: string },
  lang: "zh" | "en",
  tabId?: number,
  walletAddress?: string | null,
): Promise<ResolveVaultResult> {
  // 1. If both chain and address are provided AND address is valid, fetch directly
  if (params.vaultChainId && params.vaultAddress && isValidEvmAddress(params.vaultAddress)) {
    sendProgress(tabId, L(lang, "🔍 正在查询金库信息...", "🔍 Fetching vault info..."))
    const vault = await CoinBuddyBrain.fetchVaultDetail(params.vaultChainId, params.vaultAddress)
    return { vault }
  }

  // 2. If address was provided but is invalid (e.g. "0x..."), log and fall through to protocol search
  if (params.vaultAddress && !isValidEvmAddress(params.vaultAddress)) {
    logger.warn("Ignoring invalid vault address from LLM", { vaultAddress: params.vaultAddress })
  }

  // 2.5 If wallet is connected and user did not specify address/protocol,
  // try to resolve from cached portfolio positions first.
  if (!params.selectionProtocol && !isValidEvmAddress(params.vaultAddress) && walletAddress) {
    let positions: PortfolioPositionSummary[]
    try {
      positions = await ensurePortfolioSnapshot(walletAddress)
    } catch {
      return { vault: null, portfolioUnavailable: true }
    }
    const candidates = getWithdrawPortfolioCandidates(positions, params.vaultChainId)
    logger.info("Resolved withdraw portfolio candidates", {
      candidates: candidates.length,
      wallet: shortWallet(walletAddress),
    })

    if (candidates.length === 1) {
      sendProgress(tabId, L(lang, "🔍 正在从持仓定位金库...", "🔍 Resolving vault from your positions..."))
      const position = candidates[0]
      const vault = await CoinBuddyBrain.fetchVaultDetail(position.vaultChainId!, position.vaultAddress!)
      if (vault) return { vault }
      return { vault: null, detailRefreshFailed: true }
    }

    if (candidates.length > 1) {
      return {
        vault: null,
        ambiguousCandidates: candidates.map((position) => ({
          address: position.vaultAddress,
          chainId: position.vaultChainId,
          protocol: { name: position.protocolName || "unknown" },
          name: position.assetSymbol || "unknown",
        })) as Vault[],
      }
    }

    const protocolHints = getWithdrawPortfolioProtocolHints(positions, params.vaultChainId)
    logger.info("Resolved withdraw protocol hints", {
      protocolHints: protocolHints.length,
      wallet: shortWallet(walletAddress),
    })

    if (protocolHints.length === 1) {
      const hint = protocolHints[0]
      logger.info("Falling back to protocol search from portfolio hint", {
        protocol: hint.protocolName || "unknown",
        chainId: hint.vaultChainId,
        assetSymbol: hint.assetSymbol || "unknown",
      })
      return await resolveVaultForWithdraw(
        {
          vaultChainId: hint.vaultChainId || params.vaultChainId,
          selectionProtocol: hint.protocolName || undefined,
        },
        lang,
        tabId,
        walletAddress,
      )
    }
  }

  // 2.75 Protocol-only search: when we have a protocol keyword but no chain,
  // search across supported chains and then disambiguate using wallet share balances.
  if (params.selectionProtocol && !params.vaultChainId) {
    sendProgress(tabId, L(lang, "🔍 正在跨链搜索协议金库...", "🔍 Searching protocol vaults across chains..."))

    const supportedChains = await CoinBuddyBrain.fetchSupportedChains()
    const chainIds = supportedChains
      .map((chain: { chainId?: number; id?: number }) => Number(chain?.chainId ?? chain?.id))
      .filter((chainId: number) => Number.isFinite(chainId) && chainId > 0)

    const uniqueChainIds = Array.from(new Set(chainIds))
    logger.info("Searching protocol vaults across chains", {
      protocol: params.selectionProtocol,
      chainIds: uniqueChainIds,
    })

    const matchesPerChain = await Promise.all(
      uniqueChainIds.map(async (chainId) => {
        const vaults = await CoinBuddyBrain.fetchVaultComparison({ chainId, limit: 50 })
        const match = matchVaultsByProtocol(vaults, params.selectionProtocol!)
        if (match.vault) return [match.vault]
        if (match.ambiguous) return match.candidates
        return []
      }),
    )

    const validCandidates = matchesPerChain
      .flat()
      .filter(isValidVaultCandidate)

    logger.info("Filtered valid protocol candidates across chains", {
      validCandidates: validCandidates.length,
    })

    if (validCandidates.length === 1) {
      const candidate = validCandidates[0]
      return await resolveVaultForWithdraw(
        {
          vaultChainId: candidate.chainId,
          vaultAddress: candidate.address,
          selectionProtocol: params.selectionProtocol,
        },
        lang,
        tabId,
        walletAddress,
      )
    }

    if (validCandidates.length > 1 && walletAddress) {
      sendProgress(tabId, L(lang, "🔍 正在检查你的跨链持仓...", "🔍 Checking your positions across chains..."))
      const positionMap = await buildPositionMap(validCandidates, undefined, walletAddress)
      positionMap.forEach((hasPos, addr) => {
        logger.debug("Checked cross-chain vault balance", { vaultAddress: addr, hasPosition: hasPos })
      })

      const narrowed = disambiguateByPositions(validCandidates, positionMap)
      if (narrowed.vault) {
        return await resolveVaultForWithdraw(
          {
            vaultChainId: narrowed.vault.chainId,
            vaultAddress: narrowed.vault.address,
            selectionProtocol: params.selectionProtocol,
          },
          lang,
          tabId,
          walletAddress,
        )
      }

      const anyPosition = [...positionMap.values()].some(Boolean)
      if (anyPosition) {
        return { vault: null, ambiguousCandidates: narrowed.candidates }
      }

      return { vault: null, ambiguousCandidates: validCandidates, noPositionsFound: true }
    }

    if (validCandidates.length > 1) {
      return { vault: null, ambiguousCandidates: validCandidates }
    }
  }

  // 3. Protocol + chain search: when we have a protocol keyword and a chain but no valid address
  if (params.selectionProtocol && params.vaultChainId) {
    sendProgress(tabId, L(lang, "🔍 正在搜索协议金库...", "🔍 Searching protocol vaults..."))
    const vaults = await CoinBuddyBrain.fetchVaultComparison({ chainId: params.vaultChainId, limit: 50 })
    const match = matchVaultsByProtocol(vaults, params.selectionProtocol)

    // Helper: fetch full detail based on vault source.
    // Search/compare/disambiguation sources ALWAYS fetch — lightweight objects may carry
    // stale isRedeemable values that must not be trusted for withdraw decisions.
    const ensureDetail = async (lightweight: Vault, source: VaultSource): Promise<ResolveVaultResult> => {
      const addr = lightweight.address
      const chain = lightweight.chainId
      const forceRefresh = shouldForceDetailRefresh(source)
      logger.debug("Evaluating vault detail refresh", {
        vaultAddress: addr,
        chainId: chain,
        source,
        forceRefresh,
        isRedeemable: lightweight.isRedeemable,
      })

      if (!forceRefresh) {
        logger.debug("Skipping vault detail refresh for trusted source", {
          vaultAddress: addr,
          source,
          isRedeemable: lightweight.isRedeemable,
        })
        return { vault: lightweight }
      }

      logger.info("Refreshing vault details before withdraw decision", {
        vaultAddress: addr,
        chainId: chain,
        source,
      })
      sendProgress(tabId, L(lang, "🔍 正在补全金库详情...", "🔍 Refreshing vault details..."))
      const detailed = await CoinBuddyBrain.fetchVaultDetail(chain, addr)
      const detailIsNull = detailed === null
      logger.debug("Vault detail refresh completed", {
        vaultAddress: addr,
        detailIsNull,
        isRedeemable: detailed?.isRedeemable,
      })

      if (!detailed) {
        logger.warn("Vault detail refresh failed; rejecting lightweight redeemability", {
          vaultAddress: addr,
        })
        return { vault: null, detailRefreshFailed: true }
      }

      return { vault: detailed }
    }

    if (match.ambiguous) {
      // Filter out zero-address / invalid candidates before anything else
      const validCandidates = match.candidates.filter(isValidVaultCandidate)
      logger.info("Filtered ambiguous withdraw candidates", {
        rawCandidates: match.candidates.length,
        validCandidates: validCandidates.length,
      })
      if (match.candidates.length !== validCandidates.length) {
        const removed = match.candidates.filter((v) => !isValidVaultCandidate(v))
        removed.forEach((v) => logger.debug("Removed invalid withdraw candidate", { vaultAddress: v.address }))
      }
      validCandidates.forEach((v, i: number) => {
        logger.debug("Withdraw candidate", {
          index: i,
          vaultAddress: v.address,
          protocol: v.protocol?.name,
          name: v.name,
        })
      })

      // If filtering reduced to 1, treat as single match
      if (validCandidates.length === 1) {
        logger.info("Reduced ambiguous withdraw candidates to one", {
          vaultAddress: validCandidates[0].address,
        })
        return await ensureDetail(validCandidates[0], "protocol-search")
      }
      if (validCandidates.length === 0) {
        logger.info("All ambiguous withdraw candidates filtered out")
        return { vault: null }
      }

      // Attempt wallet-based disambiguation
      logger.info("Attempting withdraw disambiguation by positions", {
        wallet: shortWallet(walletAddress),
        candidates: validCandidates.length,
      })
      if (walletAddress) {
        sendProgress(tabId, L(lang, "🔍 正在检查你的持仓...", "🔍 Checking your positions..."))
        logger.debug("Building withdraw position map", { candidates: validCandidates.length })
        const positionMap = await buildPositionMap(validCandidates, params.vaultChainId, walletAddress)
        positionMap.forEach((hasPos, addr) => {
          logger.debug("Checked withdraw vault balance", { vaultAddress: addr, hasPosition: hasPos })
        })
        const narrowed = disambiguateByPositions(validCandidates, positionMap)

        if (narrowed.vault) {
          logger.info("Disambiguated withdraw vault by positions", {
            vaultAddress: narrowed.vault.address,
          })
          return await ensureDetail(narrowed.vault, "position-disambiguation")
        }
        // Check: did ANY vault have a position?
        const anyPosition = [...positionMap.values()].some(Boolean)
        if (anyPosition) {
          // Multiple vaults with positions — return that subset
          logger.info("Multiple withdraw candidates still have positions", {
            candidates: narrowed.candidates.length,
          })
          return { vault: null, ambiguousCandidates: narrowed.candidates }
        }
        // No positions found at all
        logger.info("No withdraw candidate has share balance", { wallet: shortWallet(walletAddress) })
        return { vault: null, ambiguousCandidates: validCandidates, noPositionsFound: true }
      }

      // No wallet — return candidates as-is
      return { vault: null, ambiguousCandidates: validCandidates }
    }
    if (match.vault) {
      return await ensureDetail(match.vault, "protocol-search")
    }
    // No match on this chain — return null, caller will show "no vault"
    return { vault: null }
  }

  // 4. Context-based fallback (useContext or no params at all)
  if (params.useContext || (!params.vaultChainId && !isValidEvmAddress(params.vaultAddress))) {
    const contextVault = pendingDepositDraft.selectedVault
    if (contextVault && needsVaultDetailRefresh(contextVault)) {
      sendProgress(tabId, L(lang, "🔍 正在补全金库详情...", "🔍 Refreshing vault details..."))
      const detailedVault = await CoinBuddyBrain.fetchVaultDetail(contextVault.chainId, contextVault.address)
      if (detailedVault) {
        pendingDepositDraft.selectedVault = detailedVault
        return { vault: detailedVault }
      }
    }
    return { vault: contextVault }
  }

  return { vault: null }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab?.id
  const handleRequest = async () => {
    try {
      switch (request.action) {
        case "SNIFF_MATCH":
          await handleSniffMatch(request.payload, sendResponse)
          break
        case "USER_ASK":
          await handleUserAsk(request.payload, sendResponse, tabId)
          break
        case "VOICE_ASK":
          await handleVoiceAsk(request.payload, sendResponse)
          break
        case "VOICE_TRANSCRIBE":
          await handleVoiceTranscribe(request.payload, sendResponse)
          break
        case "BUILD_TRANSACTION":
          await handleBuildTransaction(request.payload, sendResponse)
          break
        case "SYNC_WALLET_SESSION":
          await handleSyncWalletSession(request.payload, sendResponse)
          break
        case "OPEN_POPUP":
          chrome.windows.create({
            url: chrome.runtime.getURL("popup.html"),
            type: "popup",
            width: 380,
            height: 320
          }, () => {
            if (chrome.runtime.lastError) {
              logger.error("Failed to open popup", {
                error: chrome.runtime.lastError.message,
              })
            }
          })
          sendResponse({ status: "success" })
          break
        case "CLEAR_HISTORY":
          conversationHistory = []
          clearPending()
          CoinBuddyBrain.clearCache()
          sendResponse({ status: "success" })
          break
        default:
          sendResponse({ status: "error", error: "UNKNOWN_ACTION" })
      }
    } catch (error: any) {
      logger.error("Unhandled background request error", {
        error: error?.message || String(error),
      })
      sendResponse({ status: "error", error: error.message })
    }
  }

  handleRequest()
  return true // async sendResponse
})

// ── 嗅探命中 ──
async function handleSniffMatch(payload: any, sendResponse: (r: any) => void) {
  const keywords = payload.keywords || []
  const contextText = payload.contextText || ""
  logger.info("Sniff match received", { keywords })

  const suggestedReply = await CoinBuddyBrain.analyzeSniff(keywords, contextText)

  sendResponse({
    status: "success",
    petState: "attentive",
    suggestedReply
  })
}

// ── 语音转文字（仅 STT，快速返回 transcript）──
async function handleVoiceTranscribe(payload: any, sendResponse: (r: any) => void) {
  const { audioBase64, mimeType } = payload
  try {
    const { transcript } = await CoinBuddyBrain.analyzeVoice(audioBase64, mimeType, conversationHistory)
    logger.info("Voice transcribed", { transcript })
    sendResponse({ transcript })
  } catch (e: any) {
    logger.error("Voice transcription failed", { error: e?.message || String(e) })
    sendResponse({ transcript: "" })
  }
}

// ── System text patterns that must never reach the agent ──
const SYSTEM_TEXT_RE = /^(🎤|🤔|🔍|📊|🔎|💼|🔗|🏛️|🪙|💰|🏦|✍️|🔧|⚡|🔄)/

// ── 语音对话：Gemini 多模态 音频→意图 一步到位 ──
async function handleVoiceAsk(payload: any, sendResponse: (r: any) => void) {
  const { audioBase64, mimeType, walletAddress } = payload

  const { transcript, intent: analysis } = await CoinBuddyBrain.analyzeVoice(
    audioBase64, mimeType, conversationHistory
  )

  logger.info("Voice intent analyzed", { transcript, intentType: analysis.type })

  // Guard: only proceed if transcript is a non-empty, non-system string
  if (transcript && transcript.trim().length > 0 && !SYSTEM_TEXT_RE.test(transcript.trim())) {
    await handleUserAsk({ text: transcript, walletAddress, _fromVoice: true, _voiceIntent: analysis }, sendResponse)
  } else {
    // Gemini couldn't hear anything
    const reply = analysis.chatReply || "Meow... couldn't hear that, say again?"
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, transcript: "" })
  }
}

// ── 用户对话：路由到 chat / invest / confirm / cancel ──
async function handleUserAsk(payload: any, rawSendResponse: (r: any) => void, tabId?: number) {
  const userText = payload.text

  // Unified wallet resolution: payload > storage > draft cache
  const walletAddress = await getEffectiveWalletAddress(
    payload.walletAddress,
    pendingDepositDraft.walletAddress,
  )
  logger.info("Resolved effective wallet address", {
    wallet: shortWallet(walletAddress),
    payloadWalletProvided: !!payload.walletAddress,
  })

  if (walletAddress) {
    setWalletSession(walletAddress)
    if (!isPortfolioFresh(walletAddress, PORTFOLIO_CACHE_TTL_MS)) {
      void refreshPortfolioSnapshot(walletAddress).catch((error: any) => {
        logger.warn("Background portfolio refresh failed", {
          error: error?.message || String(error),
        })
      })
    }
  } else {
    clearWalletSession()
  }

  // ══ BACKGROUND GUARD: last line of defense against phantom input ══
  if (typeof userText !== "string" || userText.trim().length === 0) {
    logger.warn("Blocked empty user input")
    rawSendResponse({ status: "error", error: "EMPTY_INPUT" })
    return
  }
  if (SYSTEM_TEXT_RE.test(userText.trim())) {
    logger.warn("Blocked system placeholder input")
    rawSendResponse({ status: "error", error: "SYSTEM_TEXT" })
    return
  }

  const lang = detectLang(userText)

  // Wrap sendResponse to always include transcript (needed for voice flow)
  const sendResponse = (r: any) => {
    if (r && r.transactionPayload) {
      cacheTransactionPayload(r.transactionPayload, userText)
    }
    rawSendResponse({ ...r, transcript: userText })
  }

  sendProgress(tabId, L(lang, "\uD83D\uDD0D \u6B63\u5728\u5206\u6790\u4F60\u7684\u610F\u56FE...", "\uD83D\uDD0D Analyzing your intent..."))

  // 如果从语音流过来，直接用已分析的意图；否则重新分析
  let analysis = payload._voiceIntent
    ? payload._voiceIntent
    : await CoinBuddyBrain.analyzeIntent(userText, conversationHistory)
  if (
    pendingDepositDraft.vaultChoices.length > 0 &&
    (analysis.selectionIndex || analysis.selectionProtocol) &&
    (isVaultDetailFollowup(userText) || isSelectionOnlyRequest(userText))
  ) {
    analysis.type = "vault_detail"
  }
  logger.info("Intent analyzed", { intentType: analysis.type })

  if (
    analysis.type !== "confirm" &&
    analysis.type !== "execute" &&
    analysis.type !== "cancel" &&
    getPendingTransactionPayload()
  ) {
    logger.info("Clearing stale pending transaction payload after intent switch", {
      nextIntentType: analysis.type,
    })
    clearPendingTransactionPayload()
  }

  // ── 当用户切换到新意图时，清除残留的策略草稿 ──
  // 只有 confirm（用于确认草稿）和 cancel（用于取消草稿）保留 draft
  if (pendingStrategyDraft && analysis.type !== "confirm" && analysis.type !== "cancel") {
    logger.info("Clearing stale strategy draft after intent switch", {
      nextIntentType: analysis.type,
    })
    pendingStrategyDraft = null
  }

  // NOTE: Do NOT clear pendingAgentSession here based on intent type.
  // The ReAct session handles its own lifecycle — user follow-ups like "直接存入"
  // get misclassified by the intent classifier (e.g. as "composite") but should
  // still resume the pending ReAct loop. Session resumption is handled below,
  // before intent routing.

  if (getPendingPlanExecution() && analysis.type !== "confirm" && analysis.type !== "cancel") {
    logger.info("Clearing stale pending plan execution (user switched intent)")
    clearPendingPlanExecution()
  }

  // ── Vault 选择解析：selectionIndex / selectionProtocol 只是辅助信息，
  //    不能覆盖更具体的主意图（例如 vault_detail）。
  if (pendingDepositDraft.vaultChoices.length > 0 && (analysis.selectionIndex || analysis.selectionProtocol)) {
    const { selectedVault: resolved, ambiguous } = applyVaultSelection(
      pendingDepositDraft,
      {
        selectionIndex: analysis.selectionIndex,
        selectionProtocol: analysis.selectionProtocol,
      },
      walletAddress,
    )

    if (ambiguous) {
      pushHistory("user", userText)
      const reply = L(lang,
        "喵？匹配到多个金库，告诉本猫序号吧！比如「第1个」「第2个」～",
        "Meow? Multiple vaults match that name. Tell me the number, like 'first' or 'second'~")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return
    }

    if (resolved) {
      logger.info("Set pending vault from selection", {
        protocol: resolved.protocol?.name,
        vaultAddress: resolved.address,
      })
      if (!pendingDepositDraft.investParams) {
        const recovered = recoverPendingInvestParamsFromHistory(conversationHistory)
        if (recovered) {
          cachePendingDepositRecommendation(pendingDepositDraft, {
            investParams: recovered,
            selectedVault: resolved,
            walletAddress: walletAddress ?? null,
          })
          logger.info("Recovered invest params from conversation history for selection follow-up", {
            amount: recovered.amount,
            asset: recovered.searchAsset,
            chain: recovered.fromChain,
          })
        }
      }
      const selectionRequiresDepositFollowup =
        analysis.type === "invest" ||
        analysis.type === "confirm" ||
        analysis.type === "cancel" ||
        analysis.type === "compare" ||
        analysis.type === "stablecoin" ||
        analysis.type === "needs_plan" ||
        (analysis.type === "vault_detail" && isSelectionOnlyRequest(userText))

      if (selectionRequiresDepositFollowup && !pendingDepositDraft.investParams) {
        pushHistory("user", userText)
        const reply = L(lang,
          `喵～我记住你选的是 ${resolved.protocol?.name || resolved.name || "这个金库"} 了。\n现在再告诉本猫你想从哪条链、存多少资产，比如「从 Ethereum 存 500 USDC」；说完我就能继续准备交易～`,
          `Meow~ I saved your choice: ${resolved.protocol?.name || resolved.name || "that vault"}.\nNow tell me the source chain and amount, like "deposit 500 USDC from Ethereum", and I'll prepare the transaction~`)
        pushHistory("model", reply)
        sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
        return
      }

      if (selectionRequiresDepositFollowup && pendingDepositDraft.investParams) {
        analysis.type = "confirm"
      }

      logger.debug("Selection resolved and kept for downstream intent handling", {
        intentType: analysis.type,
      })
    }
    // If neither resolved nor ambiguous, fall through — intent handlers will use the existing draft
  }

  const seededInvestParams = analysis.type === "needs_plan"
    ? extractPendingInvestParamsFromText(userText)
    : null

  if (analysis.type === "needs_plan") {
    cachePendingDepositRecommendation(pendingDepositDraft, {
      investParams: seededInvestParams,
      selectedVault: null,
      vaultChoices: [],
      walletAddress: walletAddress ?? null,
    })
  }

  if (analysis.type === "confirm") {
    promoteSingleVaultChoice(pendingDepositDraft, walletAddress)
  }

  const canConfirmDepositNow = getDepositConfirmability(pendingDepositDraft).canConfirm

  let pendingTransaction = getPendingTransactionPayload()
  if (!pendingTransaction?.transactionPayload) {
    const storedPendingTransaction = await getPendingTransactionPayloadFromStorage()
    if (storedPendingTransaction?.transactionPayload) {
      pendingTransaction = storedPendingTransaction
      setPendingTransactionPayload(storedPendingTransaction.transactionPayload, storedPendingTransaction.sourceText)
    }
  }
  const shouldExecutePendingTransaction =
    !!pendingTransaction?.transactionPayload &&
    (analysis.type === "execute" || isExecuteFollowupRequest(userText))

  if (analysis.type === "confirm" && pendingTransaction?.transactionPayload && !canConfirmDepositNow) {
    pushHistory("user", userText)
    const reply = L(
      lang,
      "喵！这笔交易已经准备好了，点击下方按钮签名即可继续～",
      "Meow! This transaction is already ready. Click the button below to sign and continue~",
    )
    pushHistory("model", reply)
    sendResponse({
      status: "success",
      petState: "idle",
      reply,
      transactionPayload: pendingTransaction.transactionPayload,
    })
    return
  }

  const compareSelection = parseCompareSelectionRequest(userText)
  if (compareSelection && pendingDepositDraft.vaultChoices.length >= Math.max(compareSelection.left, compareSelection.right)) {
    const leftVault = pendingDepositDraft.vaultChoices[compareSelection.left - 1]
    const rightVault = pendingDepositDraft.vaultChoices[compareSelection.right - 1]

    if (leftVault && rightVault) {
      pushHistory("user", userText)
      const reply = formatVaultComparisonReply(leftVault, rightVault, lang)
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return
    }
  }

  // ── Withdraw+Bridge Step 2 拦截：用户确认继续桥接 ──
  if (pendingBridgeAfterWithdraw) {
    // Determine if user is triggering step 2 vs changing topic
    // Step 2 triggers: confirm, or bridge with no specific bridgeParams (meaning "continue"),
    // or explicit continuation keywords
    const isContinuationKeyword = /^(继续|继续桥接|跨链|continue|continue bridge)$/i.test(userText.trim())
    const isConfirm = analysis.type === "confirm"
    // bridge intent WITHOUT specific params = user saying "bridge" to continue
    const isBridgeContinue = analysis.type === "bridge" && !analysis.bridgeParams
    const isStep2Trigger = isConfirm || isBridgeContinue || isContinuationKeyword

    if (analysis.type === "cancel") {
      // User explicitly cancels — clear pending and handle normally (falls through to cancel handler below)
      pendingBridgeAfterWithdraw = null
    } else if (isStep2Trigger) {
      pushHistory("user", userText)
      const pb = pendingBridgeAfterWithdraw
      const effectiveWallet = walletAddress

      if (!effectiveWallet) {
        const reply = L(lang,
          "喵～你还没连接钱包呢！本猫帮你弹出来，连好后再跟我说「继续桥接」～",
          "Meow~ You haven't connected a wallet! Let me open it for you - say 'continue bridge' after connecting~")
        pushHistory("model", reply)
        sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
        return
      }

      sendProgress(tabId, L(lang, "🌉 正在构建桥接交易（Step 2/2）...", "🌉 Building bridge transaction (Step 2/2)..."))

      // Query actual token balance on vault chain (withdraw output may differ from estimate)
      const tokenAddr = CoinBuddyBrain.resolveTokenAddress(pb.token, pb.fromChain)
      let bridgeAmount: string | null = null
      if (tokenAddr) {
        const balance = await CoinBuddyBrain.getERC20Balance(pb.fromChain, tokenAddr, effectiveWallet)
        if (balance && balance > 0n) {
          bridgeAmount = balance.toString()
          logger.info("Using actual token balance for bridge step 2", {
            token: pb.token,
            fromChain: pb.fromChain,
            amount: bridgeAmount,
          })
        }
      }

      if (!bridgeAmount) {
        // Don't clear pending — user can retry after funds arrive
        const reply = L(lang,
          `喵…本猫在 ${pb.token} 余额里没找到取款到账的资产。可能取款还没到账，稍等一下再跟我说「继续桥接」？`,
          `Meow... I couldn't find the withdrawn ${pb.token} in your balance. The withdrawal may still be settling — wait a moment and say "continue bridge" again?`)
        pushHistory("model", reply)
        sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
        return
      }

      const result = await CoinBuddyBrain.buildBridgeTransaction(
        pb.token, pb.fromChain, pb.toChain, effectiveWallet, bridgeAmount
      )

      // Clear pending bridge state after successful build attempt (success or failure)
      pendingBridgeAfterWithdraw = null

      if (!result) {
        const reply = CoinBuddyBrain.generateBridgeReply(null, lang, "no_route")
        pushHistory("model", reply)
        sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
        return
      }

      const toChainNames: Record<number, string> = { 1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 10: "Optimism", 137: "Polygon", 56: "BSC" }
      const toChainName = toChainNames[pb.toChain] || `Chain ${pb.toChain}`
      const details = CoinBuddyBrain.generateBridgeReply(result.quoteSummary, lang)
      const header = L(lang,
        `喵～Step 2/2：桥接到 ${toChainName}！\n`,
        `Meow~ Step 2/2: Bridge to ${toChainName}!\n`)
      const reply = header + details

      pushHistory("model", reply)
      sendResponse({
        status: "success",
        petState: "idle",
        reply,
        transactionPayload: result.txPayload
      })
      return
    } else {
      // User changed topic — clear stale pending state and fall through to normal routing
      logger.info("Clearing pending bridge-after-withdraw after topic switch")
      pendingBridgeAfterWithdraw = null
    }
  }

  const walletGateReason = !walletAddress
    ? getWalletGateReason(analysis, {
        hasPendingStrategyDraft: !!pendingStrategyDraft,
        hasPendingBridgeAfterWithdraw: !!pendingBridgeAfterWithdraw,
        canConfirmDeposit: getDepositConfirmability(pendingDepositDraft).canConfirm,
        hasPendingTransactionPayload: !!pendingTransaction?.transactionPayload,
      })
    : null

  if (walletGateReason) {
    const reply = buildWalletGateReply(walletGateReason, lang)
    pushHistory("user", userText)
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
    return
  }

const handlerCtx: HandlerContext = {
    lang,
    tabId,
    userText,
    walletAddress,
    pushHistory,
    sendProgress,
    sendResponse,
    pendingDepositDraft,
    ensurePortfolioSnapshot,
    cacheVaultChoices,
    resolveVaultForWithdraw,
    getPendingBridgeAfterWithdraw: () => pendingBridgeAfterWithdraw,
    setPendingBridgeAfterWithdraw: (value) => {
      pendingBridgeAfterWithdraw = value
    },
    getPendingStrategyDraft: () => pendingStrategyDraft,
    setPendingStrategyDraft: (value) => {
      pendingStrategyDraft = value
    },
    getEngine,
    clearPending,
    legacy: async () => false,
  }

  const reactToolRegistry = createReActToolRegistry(
    pendingDepositDraft,
    walletAddress,
    seededInvestParams,
  )

  // ── ReAct session resumption: if a pending ReAct session exists, any user
  //    follow-up should resume it regardless of how the classifier re-classified
  //    the message. Only an explicit "cancel" clears the session.
  if (getPendingAgentSession() && analysis.type !== "cancel") {
    logger.info("Resuming pending ReAct agent session", { classifiedAs: analysis.type })
    sendProgress(tabId, L(lang, "🧠 继续 ReAct 代理...", "🧠 Resuming ReAct agent..."))

    try {
      const handled = await resumePendingReActRuntime(
        {
          userText,
          lang,
          conversationHistory,
          ctx: handlerCtx,
        },
        {
          maxSteps: 6,
          toolRegistry: reactToolRegistry,
        },
      )
      if (handled) return
    } catch (err: any) {
      logger.warn("ReAct session resume failed, falling through to normal routing", { error: err?.message })
      clearPendingAgentSession()
    }
  }

  
  if (shouldExecutePendingTransaction) {
    pushHistory("user", userText)
    const reply = L(
      lang,
      "喵！交易已经准备好了，点击下方按钮签名即可继续～",
      "Meow! The transaction is ready. Click the button below to sign and continue~",
    )
    pushHistory("model", reply)
    sendResponse({
      status: "success",
      petState: "idle",
      reply,
      transactionPayload: pendingTransaction?.transactionPayload || null,
    })
    return
  }

  if (analysis.type === "execute") {
    pushHistory("user", userText)
    const reply = L(
      lang,
      "喵…本猫现在还没有可签名的交易。先让我把交易构建出来，再说「签名」～",
      "Meow... I don't have a transaction ready to sign yet. Let me build it first, then say 'sign'~",
    )
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  
  // If user explicitly cancels, clear the ReAct session
  if (analysis.type === "cancel" && getPendingAgentSession()) {
    logger.info("User cancelled pending ReAct agent session")
    clearPendingAgentSession()
  }

  if (analysis.type === "needs_plan") {
    sendProgress(tabId, L(lang, "🧠 正在运行 ReAct 代理...", "🧠 Running ReAct agent..."))

    try {
      const handled = await runReActRuntime(
        {
          userText,
          lang,
          conversationHistory,
          ctx: handlerCtx,
        },
        {
          maxSteps: 6,
          toolRegistry: reactToolRegistry,
        },
      )

      if (!handled) {
        sendProgress(tabId, L(lang, "🧠 ReAct 暂不可用，回退到旧规划器...", "🧠 ReAct is unavailable, falling back to the old planner..."))
        const plan = await generatePlan(userText, conversationHistory, lang)
        pushHistory("model", plan.summary)
        await executePlan(plan, handlerCtx)
      }
    } catch (err: any) {
      const reply = L(
        lang,
        `喵…规划失败了：${err?.message || "未知错误"}。你可以把需求拆开一步步告诉本猫～`,
        `Meow... planning failed: ${err?.message || "unknown error"}. Try breaking your request into simpler steps~`,
      )
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    }
    return
  }

  if (analysis.type === "confirm") {
    // ReAct session resumption is already handled above for all intent types.

    const pendingPlan = getPendingPlanExecution()
    if (pendingPlan && pendingPlan.pendingConfirmStepId) {
      pushHistory("user", userText)
      clearPendingPlanExecution()
      await executePlan(pendingPlan.plan, handlerCtx, {
        completedSteps: pendingPlan.completedSteps,
        confirmedStepId: pendingPlan.pendingConfirmStepId,
      })
      return
    }
  }

  if (await routeIntent(analysis, handlerCtx)) {
    return
  }

  // ── 闲聊 ──
  if (analysis.type === "chat") {
    const botReply = analysis.chatReply || L(lang, "喵？", "Meow?")
    pushHistory("user", userText)
    pushHistory("model", botReply)

    const walletKeywords = /连.{0,2}钱包|connect.*wallet|链接钱包|绑定钱包/i
    const wantsWallet = walletKeywords.test(userText) && !walletAddress

    sendResponse({
      status: "success",
      petState: "idle",
      reply: wantsWallet
        ? L(lang, "喵～正在帮你弹出钱包连接窗口！稍等一下～", "Meow~ Opening wallet connection window! One moment~")
        : botReply,
      transactionPayload: null,
      openWallet: wantsWallet
    })
    return
  }

  if (analysis.type === "token_price") {
    pushHistory("user", userText)
    const symbol = analysis.tokenParams?.symbol || userText.match(/\b([A-Za-z]{2,10})\b/)?.[1] || "BTC"
    const tokenData = await CoinBuddyBrain.fetchTokenPrice(symbol, analysis.tokenParams?.chainId || 1)
    let reply: string
    if (tokenData?.priceUSD) {
      const price = Number(tokenData.priceUSD).toLocaleString(undefined, { maximumFractionDigits: 2 })
      reply = L(lang,
        `喵～${tokenData.symbol || symbol.toUpperCase()} 当前价格约 $${price} USD。`,
        `Meow~ ${tokenData.symbol || symbol.toUpperCase()} is currently around $${price} USD.`)
    } else {
      reply = L(lang,
        `喵…本猫暂时查不到 ${symbol.toUpperCase()} 的价格，换个代币名试试？`,
        `Meow... I couldn't find the price for ${symbol.toUpperCase()} right now. Try a different token name?`)
    }
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  if (analysis.type === "connect_wallet") {
    pushHistory("user", userText)
    const botReply = analysis.chatReply || L(lang, "喵～正在为您连接钱包…请确认弹窗授权，本猫等您信号！", "Meow~ Connecting your wallet... Please confirm in the popup!")
    pushHistory("model", botReply)
    sendResponse({
      status: "success",
      petState: "idle",
      reply: botReply,
      transactionPayload: null,
      openWallet: true
    })
    return
  }

  if (analysis.type !== "composite") {
    const reply = L(
      lang,
      "喵…本猫这次没完全听懂你的意图，所以先不执行任何动作。换一种说法，再明确一点金额、资产和链试试？",
      "Meow... I couldn't classify that request confidently, so I won't execute anything yet. Try again with the amount, asset, and chain spelled out?"
    )
    pushHistory("user", userText)
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

}

// ── 独立交易构建请求 ──
async function handleBuildTransaction(payload: any, sendResponse: (r: any) => void) {
  const { walletAddress } = payload

  const { investParams, selectedVault } = pendingDepositDraft
  if (!selectedVault || !investParams) {
    sendResponse({ status: "error", error: "No pending vault to build transaction for" })
    return
  }

  const depositResult = await CoinBuddyBrain.buildDepositTransaction(
    investParams.fromChain,
    selectedVault,
    walletAddress,
    investParams.amount + investParams.amountDecimals
  )
  const txPayload = depositResult?.txPayload || null

  sendResponse({
    status: "ready",
    txData: txPayload
  })
  if (txPayload) {
    cacheTransactionPayload(txPayload, payload?.text || payload?.userText || "")
  }
}

async function handleSyncWalletSession(payload: any, sendResponse: (r: any) => void) {
  const walletAddress = await getEffectiveWalletAddress(payload?.walletAddress)

  if (!walletAddress) {
    clearWalletSession()
    sendResponse({ status: "success", walletAddress: null })
    return
  }

  setWalletSession(walletAddress)
  void refreshPortfolioSnapshot(walletAddress).catch((error: any) => {
    logger.warn("Sync wallet session portfolio refresh failed", {
      error: error?.message || String(error),
    })
  })
  sendResponse({ status: "success", walletAddress })
}

// ── Strategy Engine (independent module, does not affect existing handlers) ──
registerStrategyHandlers()
startStrategyEngine().catch(err => {
  logger.warn("Strategy engine disabled", { error: err?.message || String(err) })
})

// ── Cross-chain Transaction Status Polling ──
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return
  const txResult = changes.coinbuddy_tx_result?.newValue
  if (!txResult?.success || !txResult.hash) return

  // 从缓存的 transactionPayload 读取链信息
  const cached = getPendingTransactionPayload()
  const payload = cached?.transactionPayload
  if (!payload) return

  const quoteSummary = payload.quoteSummary as Record<string, unknown> | undefined
  const fromChain = Number(quoteSummary?.fromChain || payload.fromChain || 0)
  const toChain = Number(quoteSummary?.toChain || payload.toChain || 0)

  // 仅跨链交易需要轮询
  if (!fromChain || !toChain || fromChain === toChain) return

  logger.info("Cross-chain tx detected, starting status polling", { hash: txResult.hash, fromChain, toChain })
  chrome.storage.local.set({
    coinbuddy_cross_chain_status: {
      txHash: txResult.hash,
      fromChain,
      toChain,
      status: "PENDING",
      updatedAt: Date.now(),
    }
  })

  CoinBuddyBrain.pollBridgeStatus(txResult.hash, fromChain, toChain, (result) => {
    chrome.storage.local.set({
      coinbuddy_cross_chain_status: {
        txHash: txResult.hash,
        fromChain,
        toChain,
        ...result,
        updatedAt: Date.now(),
      }
    })
  }).catch(err => {
    logger.error("Cross-chain status polling failed", { error: err?.message || String(err) })
  })
})

logger.info("Service worker activated")
