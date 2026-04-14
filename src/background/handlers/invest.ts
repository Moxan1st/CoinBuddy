import { CoinBuddyBrain } from "../brain.ts"
import { promoteSingleVaultChoice } from "../dialogue-state.ts"
import { matchVaultsByProtocol } from "../withdraw-context.ts"
import { getTokenDecimals } from "../../lib/chain-config.ts"
import { createLogger } from "../../lib/logger.ts"
import type { IntentResult } from "~types"
import type { HandlerContext } from "./types.ts"

const logger = createLogger("InvestHandler")

function fillAmountDecimals(asset: string | undefined, amount: string | undefined, amountDecimals: string | undefined): string {
  if (!amount) return amountDecimals || ""
  if (amountDecimals) return amountDecimals
  return "0".repeat(getTokenDecimals(asset || "ETH"))
}

function normalizeRawDepositAmount(amount: string | undefined, amountDecimals: string | undefined): string | null {
  const trimmedAmount = String(amount || "").trim()
  const decimalSuffix = String(amountDecimals || "")
  const decimals = decimalSuffix.length
  if (!trimmedAmount) return null

  const numericMatch = trimmedAmount.match(/(\d+(?:\.\d+)?)/)
  const numeric = numericMatch?.[1]
  if (!numeric) return null

  if (/^\d+$/.test(numeric)) {
    return `${numeric}${decimalSuffix}`
  }

  const decimalMatch = numeric.match(/^(\d+)\.(\d+)$/)
  if (!decimalMatch) return null

  const whole = decimalMatch[1]
  const fraction = decimalMatch[2].padEnd(decimals, "0").slice(0, Math.max(0, decimals))
  const raw = `${whole}${fraction}`.replace(/^0+(?=\d)/, "")
  return raw || "0"
}

function normalizeRawDepositAmountFromText(text: string, decimals: number): string | null {
  const numericMatch = text.match(/(\d+(?:\.\d+)?)/)
  const numeric = numericMatch?.[1]
  if (!numeric) return null

  if (/^\d+$/.test(numeric)) {
    return `${numeric}${"0".repeat(decimals)}`
  }

  const decimalMatch = numeric.match(/^(\d+)\.(\d+)$/)
  if (!decimalMatch) return null

  const whole = decimalMatch[1]
  const fraction = decimalMatch[2].padEnd(decimals, "0").slice(0, Math.max(0, decimals))
  const raw = `${whole}${fraction}`.replace(/^0+(?=\d)/, "")
  return raw || "0"
}

function resolveDepositRawAmount(
  amount: string | undefined,
  amountDecimals: string | undefined,
  userText: string,
  asset: string | undefined,
): string | null {
  const direct = normalizeRawDepositAmount(amount, amountDecimals)
  if (direct) return direct
  return normalizeRawDepositAmountFromText(userText, getTokenDecimals(asset || "ETH"))
}

export function hydrateInvestParamsWithDraft(
  intentParams: NonNullable<IntentResult["investParams"]>,
  ctx: HandlerContext,
): NonNullable<IntentResult["investParams"]> {
  const draftParams = ctx.pendingDepositDraft.investParams
  const selectedVault = ctx.pendingDepositDraft.selectedVault
  const draftAsset = draftParams?.searchAsset || selectedVault?.underlyingTokens?.[0]?.symbol || ""
  const searchAsset = intentParams.searchAsset || draftAsset
  const toChainConfig = intentParams.toChainConfig?.length
    ? intentParams.toChainConfig
    : selectedVault?.chainId
      ? [selectedVault.chainId]
      : draftParams?.toChainConfig || [8453, 42161, 10]

  return {
    amount: intentParams.amount || draftParams?.amount || "",
    amountDecimals: fillAmountDecimals(searchAsset, intentParams.amount || draftParams?.amount, intentParams.amountDecimals || draftParams?.amountDecimals),
    fromChain: intentParams.fromChain || draftParams?.fromChain || selectedVault?.chainId || 8453,
    toChainConfig,
    searchAsset,
    protocol: intentParams.protocol || draftParams?.protocol,
  }
}

export async function handleInvest(intent: IntentResult, ctx: HandlerContext): Promise<boolean> {
  const walletKeywords = /连.{0,2}钱包|connect.*wallet|链接钱包|绑定钱包/i

  if (intent.type === "compare") {
    ctx.pushHistory("user", ctx.userText)
    ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "📊 正在对比金库数据..." : "📊 Comparing vault data...")
    const params = intent.compareParams || {}
    // Fallback: if user text mentions stablecoin but LLM routed to compare, add stablecoin tag
    const isStablecoinRequest = /stablecoin|稳定币|stable.?pool|stable.?vault/i.test(ctx.userText)
    const vaults = await CoinBuddyBrain.fetchVaultComparison({
      chainId: params.chainId,
      asset: params.asset,
      sortBy: params.sortBy || "apy",
      limit: params.limit || 5,
      protocol: params.protocol,
      ...(isStablecoinRequest ? { tags: "stablecoin" } : {}),
    })
    ctx.cacheVaultChoices(ctx.pendingDepositDraft, vaults, ctx.walletAddress)
    const reply = CoinBuddyBrain.generateCompareReply(vaults, ctx.lang)
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  if (intent.type === "stablecoin") {
    ctx.pushHistory("user", ctx.userText)
    ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🪙 正在搜索稳定币池..." : "🪙 Searching stablecoin pools...")
    const params = intent.compareParams || {}
    const vaults = await CoinBuddyBrain.fetchVaultComparison({
      sortBy: params.sortBy || "apy",
      limit: params.limit || 5,
      tags: "stablecoin",
    })
    ctx.cacheVaultChoices(ctx.pendingDepositDraft, vaults, ctx.walletAddress)
    const reply = CoinBuddyBrain.generateCompareReply(vaults, ctx.lang)
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  if (intent.type === "vault_detail") {
    ctx.pushHistory("user", ctx.userText)
    ctx.sendProgress(ctx.tabId, "🔎 " + (ctx.lang === "zh" ? "正在查询金库详情..." : "Fetching vault details..."))
    let vault = null
    if (intent.vaultParams?.chainId && intent.vaultParams?.address) {
      vault = await CoinBuddyBrain.fetchVaultDetail(intent.vaultParams.chainId, intent.vaultParams.address)
    } else if (ctx.pendingDepositDraft.selectedVault) {
      const selected = ctx.pendingDepositDraft.selectedVault
      if (selected.chainId && selected.address) {
        vault = await CoinBuddyBrain.fetchVaultDetail(selected.chainId, selected.address)
      }
    }

    if (!vault && ctx.walletAddress) {
      const positions = await ctx.ensurePortfolioSnapshot(ctx.walletAddress).catch(() => [])
      if (positions.length === 1) {
        const position = positions[0]

        if (position.vaultChainId && position.vaultAddress) {
          vault = await CoinBuddyBrain.fetchVaultDetail(position.vaultChainId, position.vaultAddress)
        } else if (position.vaultChainId && position.protocolName) {
          const vaults = await CoinBuddyBrain.fetchVaultComparison({
            chainId: position.vaultChainId,
            asset: position.assetSymbol || undefined,
            limit: 20,
          })
          const match = matchVaultsByProtocol(vaults, position.protocolName)
          if (match.vault?.chainId && match.vault.address) {
            vault = await CoinBuddyBrain.fetchVaultDetail(match.vault.chainId, match.vault.address)
          }
        }
      }
    }
    const reply = vault
      ? CoinBuddyBrain.generateVaultDetailReply(vault, ctx.lang)
      : (ctx.lang === "zh"
        ? "喵？你想看哪个金库的详情？先让本猫帮你搜索一下吧！"
        : "Meow? Which vault do you want details on? Let me search first!")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  if (intent.type === "invest" || intent.type === "confirm" || intent.type === "cancel") {
    if (intent.type === "confirm") {
      ctx.pushHistory("user", ctx.userText)
      promoteSingleVaultChoice(ctx.pendingDepositDraft, ctx.walletAddress)
      const wantsWallet = walletKeywords.test(ctx.userText) && !ctx.walletAddress
      if (wantsWallet) {
        const reply = ctx.lang === "zh" ? "喵～正在帮你弹出钱包连接窗口！稍等一下～" : "Meow~ Opening wallet connection window! One moment~"
        ctx.pushHistory("model", reply)
        ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
        return true
      }

      const confirmability = {
        canConfirm: !!ctx.pendingDepositDraft.selectedVault && !!ctx.pendingDepositDraft.investParams,
        missing: [
          ...(ctx.pendingDepositDraft.selectedVault ? [] : ["vault"]),
          ...(ctx.pendingDepositDraft.investParams ? [] : ["intent"]),
        ],
      }
      if (!confirmability.canConfirm) {
        const reply = confirmability.missing.includes("vault")
          ? (ctx.lang === "zh"
            ? "喵？你还没选好金库呢！先让本猫帮你推荐，或者从列表里选一个吧～"
            : "Meow? You haven't chosen a vault yet. Let me recommend one, or pick one from the list first~")
          : (ctx.lang === "zh"
            ? "喵～金库我记住了，但你还没说要存多少、从哪条链存呢。告诉我例如「从 Ethereum 存 500 USDC」就行～"
            : "Meow~ I remember the vault, but you still haven't told me the amount and source chain. Say something like 'deposit 500 USDC from Ethereum' and I'll continue~")
        ctx.pushHistory("model", reply)
        ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
        return true
      }
      if (!ctx.walletAddress) {
        const reply = ctx.lang === "zh"
          ? "喵～你还没连接钱包呢！本猫帮你弹出来，连好后再跟我说「确认」～"
          : "Meow~ You haven't connected a wallet yet! Let me open it for you - say 'confirm' after connecting~"
        ctx.pushHistory("model", reply)
        ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
        return true
      }

      ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🔧 正在构建交易..." : "🔧 Building transaction...")
      const rawAmount = resolveDepositRawAmount(
        ctx.pendingDepositDraft.investParams!.amount,
        ctx.pendingDepositDraft.investParams!.amountDecimals,
        ctx.userText,
        ctx.pendingDepositDraft.investParams!.searchAsset || ctx.pendingDepositDraft.selectedVault?.underlyingTokens?.[0]?.symbol,
      )
      if (!rawAmount) {
        const reply = ctx.lang === "zh"
          ? "喵…这次金额格式我没解析对。请直接说类似「存 1 USDC」或「存 1.5 USDC」～"
          : "Meow... I couldn't parse that amount format. Say something like 'deposit 1 USDC' or 'deposit 1.5 USDC'~"
        ctx.pushHistory("model", reply)
        ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
        return true
      }
      const depositResult = await CoinBuddyBrain.buildDepositTransaction(
        ctx.pendingDepositDraft.investParams!.fromChain,
        ctx.pendingDepositDraft.selectedVault!,
        ctx.walletAddress,
        rawAmount,
      )
      const reply = depositResult
        ? (ctx.lang === "zh" ? "喵！交易已就绪～点击下方按钮签名就能一键存入啦！" : "Meow! Transaction ready~ Click the button below to sign and deposit!")
        : (ctx.lang === "zh" ? "喵…交易构建失败了，可能是网络波动，再试一次？" : "Meow... transaction build failed. Could be a network hiccup - try again?")
      ctx.pushHistory("model", reply)
      if (depositResult) ctx.clearPending()
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: depositResult?.txPayload || null })
      return true
    }

    if (intent.type === "cancel") {
      ctx.clearPending()
      const reply = intent.chatReply || (ctx.lang === "zh" ? "喵，好吧～有需要再叫本猫！" : "Meow, alright~ Call me when you need anything!")
      ctx.pushHistory("user", ctx.userText)
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }

    const investParams = intent.investParams
    if (!investParams) {
      const reply = ctx.lang === "zh"
        ? "喵？我需要更完整的存款信息，比如「从 Ethereum 存 500 USDC 到 Base」。"
        : "Meow? I need a fuller deposit request, like 'deposit 500 USDC from Ethereum to Base'."
      ctx.pushHistory("user", ctx.userText)
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }

    const effectiveInvestParams = hydrateInvestParamsWithDraft(investParams, ctx)
    const selectedVault = ctx.pendingDepositDraft.selectedVault
    const shouldReuseSelectedVault = !!selectedVault && !!effectiveInvestParams.amount

    // ── Step 1: 查资产余额，确定 fromChain ──
    // 当用户未显式指定链时，先查钱包余额确定资产在哪条链上
    const userExplicitChain = investParams.fromChain && investParams.fromChain !== 1 // 排除 LLM 默认值 1
    const userExplicitToChain = investParams.toChainConfig?.length === 1 // 用户指定了目标链
    if (!userExplicitChain && ctx.walletAddress && !shouldReuseSelectedVault) {
      const asset = effectiveInvestParams.searchAsset || "USDC"
      ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🔍 正在检测资产所在链..." : "🔍 Detecting asset chain...")
      const balances = await CoinBuddyBrain.fetchWalletBalances(ctx.walletAddress, [1, 8453, 42161, 10, 137, 56])
      const assetBalances = balances
        .filter((b: any) => b.symbol?.toUpperCase() === asset.toUpperCase())
        .sort((a: any, b: any) => (b.valueUsd || 0) - (a.valueUsd || 0))
      if (assetBalances.length > 0) {
        effectiveInvestParams.fromChain = assetBalances[0].chainId
        logger.info("Auto-detected fromChain from wallet balance", {
          asset,
          fromChain: assetBalances[0].chainId,
          valueUsd: assetBalances[0].valueUsd,
        })
        // When protocol is specified but user didn't set a target chain,
        // narrow vault search to chains where user has the asset
        if (effectiveInvestParams.protocol && !userExplicitToChain) {
          const chainsWithAsset = [...new Set(assetBalances.map((b: any) => b.chainId as number))]
          effectiveInvestParams.toChainConfig = chainsWithAsset
          logger.info("Narrowed vault search to chains with asset", { chains: chainsWithAsset })
        }
      }
    }

    // ── Step 2: 搜索金库 ──
    if (!shouldReuseSelectedVault) {
      ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🏦 正在搜索最优金库..." : "🏦 Searching for the best vault...")
    }
    const vault = shouldReuseSelectedVault
      ? selectedVault
      : await CoinBuddyBrain.fetchOptimalVault(effectiveInvestParams.toChainConfig, effectiveInvestParams.searchAsset, effectiveInvestParams.protocol)

    // ── Step 3: 确定最终 fromChain ──
    if (vault && !userExplicitChain) {
      // Default fromChain to vault's chain for same-chain deposit
      if (!effectiveInvestParams.fromChain || effectiveInvestParams.fromChain === 1) {
        effectiveInvestParams.fromChain = vault.chainId
        logger.info("Set fromChain to vault chain", { fromChain: vault.chainId })
      }
    }

    ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "✍️ 正在生成推荐..." : "✍️ Generating recommendation...")
    const reply = await CoinBuddyBrain.generateBotReply(
      vault,
      ctx.lang,
      ctx.lang === "zh" ? "告诉我金额，我就帮你存进去。" : "Tell me the amount and I'll deposit it.",
    )
    ctx.pushHistory("user", ctx.userText)
    ctx.pushHistory("model", reply)
    if (vault) {
      ctx.pendingDepositDraft.investParams = effectiveInvestParams
      ctx.pendingDepositDraft.selectedVault = vault
      ctx.pendingDepositDraft.walletAddress = ctx.walletAddress || null
      ctx.pendingDepositDraft.vaultChoices = [vault]
    }

    let txPayload = null
    if (vault && ctx.walletAddress && effectiveInvestParams.amount) {
      ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🔧 正在构建交易..." : "🔧 Building transaction...")
      const rawAmount = resolveDepositRawAmount(
        effectiveInvestParams.amount,
        effectiveInvestParams.amountDecimals,
        ctx.userText,
        effectiveInvestParams.searchAsset || vault.underlyingTokens?.[0]?.symbol,
      )
      if (!rawAmount) {
        const reply = ctx.lang === "zh"
          ? "喵…这次金额格式我没解析对。请直接说类似「存 1 USDC」或「存 1.5 USDC」～"
          : "Meow... I couldn't parse that amount format. Say something like 'deposit 1 USDC' or 'deposit 1.5 USDC'~"
        ctx.pushHistory("model", reply)
        ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
        return true
      }
      // Pass user's asset as fromToken (e.g. USDT) — Composer auto-swaps to vault's underlying if different
      const fromTokenSymbol = effectiveInvestParams.searchAsset || undefined
      const depositResult = await CoinBuddyBrain.buildDepositTransaction(
        effectiveInvestParams.fromChain,
        vault,
        ctx.walletAddress,
        rawAmount,
        fromTokenSymbol,
      )
      txPayload = depositResult?.txPayload || null
    }

    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: txPayload })
    return true
  }

  if (intent.type === "cross_deposit") {
    return handleInvest({ ...intent, type: "invest" }, ctx)
  }

  return false
}
