import { CoinBuddyBrain } from "../brain"
import type { IntentResult } from "~types"
import type { HandlerContext, ResolveVaultResult } from "./types"
import { CHAIN_NAMES } from "~lib/chain-config"

export async function handleWithdraw(intent: IntentResult, ctx: HandlerContext): Promise<boolean> {
  const handleAmbiguous = (candidates: NonNullable<ResolveVaultResult["ambiguousCandidates"]>) => {
    const names = candidates.slice(0, 5).map((vault, index) => `${index + 1}. ${vault.protocol?.name || vault.name} (${vault.address.slice(0, 6)}...)`).join("\n")
    const reply = ctx.lang === "zh"
      ? `喵？我检测到多个你可能有份额的匹配金库，告诉本猫你要哪个：\n${names}`
      : `Meow? I detected multiple matching vaults where you may have a position. Which one do you mean?\n${names}`
    ctx.cacheVaultChoices(ctx.pendingDepositDraft, candidates)
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
  }

  if (intent.type === "withdraw_bridge") {
    ctx.pushHistory("user", ctx.userText)
    const params: Partial<NonNullable<IntentResult["withdrawBridgeParams"]>> = intent.withdrawBridgeParams || {}
    const resolveResult = await ctx.resolveVaultForWithdraw(
      { ...params, selectionProtocol: intent.selectionProtocol },
      ctx.lang,
      ctx.tabId,
      ctx.walletAddress,
    )
    if (resolveResult.noPositionsFound) {
      const reply = ctx.lang === "zh"
        ? "喵～我找到了多个匹配的金库，但没法从你的钱包持仓确认你到底在哪一个里有份额，所以现在不能安全地帮你取出。你可以告诉我具体的金库地址，或者换一个明确的金库再试。"
        : "Meow~ I found multiple matching vaults, but I couldn't confirm which one actually holds your position from your wallet balances, so I can't safely withdraw for you right now. You can tell me the exact vault address, or try again with a more specific vault."
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }
    if (resolveResult.ambiguousCandidates && resolveResult.ambiguousCandidates.length > 1) {
      handleAmbiguous(resolveResult.ambiguousCandidates)
      return true
    }
    if (resolveResult.detailRefreshFailed) {
      const reply = ctx.lang === "zh" ? "喵～已定位到你的金库，但暂时无法补全详情，请稍后重试～" : "Meow~ Found your vault but couldn't fetch its details right now. Please try again shortly~"
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }
    if (resolveResult.portfolioUnavailable) {
      const reply = ctx.lang === "zh" ? "喵～我暂时拿不到你的持仓信息，没法安全地定位要取出的金库。稍后再试一次？" : "Meow~ I can't retrieve your portfolio positions right now, so I can't safely locate the vault to withdraw from. Please try again shortly?"
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }

    const vault = resolveResult.vault
    if (!vault) {
      const reply = ctx.lang === "zh"
        ? "喵？你想从哪个金库取出来？先让本猫帮你搜一个金库，或者告诉我具体的金库信息！"
        : "Meow? Which vault do you want to withdraw from? Let me search for a vault first, or tell me the details!"
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }
    if (vault.isRedeemable !== true) {
      const reply = CoinBuddyBrain.generateWithdrawReply(null, vault, ctx.lang, "not_redeemable")
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }
    if (!ctx.walletAddress) {
      const reply = ctx.lang === "zh" ? "喵～你还没连接钱包呢！本猫帮你弹出来，连好后再跟我说一遍～" : "Meow~ You haven't connected a wallet! Let me open it for you - try again after connecting~"
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
      return true
    }

    ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🏦 正在构建取款交易（Step 1/2）..." : "🏦 Building withdraw transaction (Step 1/2)...")
    const withdrawResult = await CoinBuddyBrain.buildWithdrawTransaction(vault, ctx.walletAddress)
    if (!withdrawResult) {
      const reply = ctx.lang === "zh"
        ? "喵…取款交易构建失败了，可能是你在这个金库没有持仓，或者网络波动。再试一次？"
        : "Meow... withdraw build failed. You may not have a position in this vault, or it could be a network hiccup. Try again?"
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }
    const toChain = params.toChain ?? 0
    const toChainName = CHAIN_NAMES[toChain] || `Chain ${toChain}`
    const underlyingSymbol = vault.underlyingTokens?.[0]?.symbol || "USDC"
    ctx.setPendingBridgeAfterWithdraw({ token: underlyingSymbol, fromChain: vault.chainId, toChain })
    const reply = CoinBuddyBrain.generateWithdrawBridgePlan(withdrawResult.quoteSummary, vault, toChainName, ctx.lang)
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: withdrawResult.txPayload })
    return true
  }

  if (intent.type !== "withdraw") return false

  ctx.pushHistory("user", ctx.userText)
  const params: Partial<NonNullable<IntentResult["withdrawParams"]>> = intent.withdrawParams || {}
  const resolveResult = await ctx.resolveVaultForWithdraw(
    { ...params, selectionProtocol: intent.selectionProtocol },
    ctx.lang,
    ctx.tabId,
    ctx.walletAddress,
  )
  if (resolveResult.noPositionsFound) {
    const reply = ctx.lang === "zh"
      ? "喵～我找到了多个匹配的金库，但没法从你的钱包持仓确认你到底在哪一个里有份额，所以现在不能安全地帮你取出。你可以告诉我具体的金库地址，或者换一个明确的金库再试。"
      : "Meow~ I found multiple matching vaults, but I couldn't confirm which one actually holds your position from your wallet balances, so I can't safely withdraw for you right now. You can tell me the exact vault address, or try again with a more specific vault."
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }
  if (resolveResult.ambiguousCandidates && resolveResult.ambiguousCandidates.length > 1) {
    handleAmbiguous(resolveResult.ambiguousCandidates)
    return true
  }
  if (resolveResult.detailRefreshFailed) {
    const reply = ctx.lang === "zh" ? "喵～已定位到你的金库，但暂时无法补全详情，请稍后重试～" : "Meow~ Found your vault but couldn't fetch its details right now. Please try again shortly~"
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }
  if (resolveResult.portfolioUnavailable) {
    const reply = ctx.lang === "zh" ? "喵～我暂时拿不到你的持仓信息，没法安全地定位要取出的金库。稍后再试一次？" : "Meow~ I can't retrieve your portfolio positions right now, so I can't safely locate the vault to withdraw from. Please try again shortly?"
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }
  const vault = resolveResult.vault
  if (!vault) {
    const reply = CoinBuddyBrain.generateWithdrawReply(null, null, ctx.lang, "no_vault")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }
  if (vault.isRedeemable !== true) {
    const reply = CoinBuddyBrain.generateWithdrawReply(null, vault, ctx.lang, "not_redeemable")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }
  if (!ctx.walletAddress) {
    const reply = CoinBuddyBrain.generateWithdrawReply(null, vault, ctx.lang, "no_wallet")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
    return true
  }
  if (params.amount && params.amount !== "0") {
    const underlyingSymbol = vault.underlyingTokens?.[0]?.symbol || "tokens"
    const reply = ctx.lang === "zh"
      ? `喵～本猫目前只支持全额取出，还不能部分提取 ${params.amount} ${underlyingSymbol} 喵。\n要帮你把这个金库里的全部资产取出来吗？跟我说「全部取出」或「确认」就行！`
      : `Meow~ Partial withdrawal of ${params.amount} ${underlyingSymbol} isn't supported yet.\nWant me to withdraw ALL your funds from this vault instead? Just say "withdraw all" or "confirm"!`
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🏦 正在构建取款交易..." : "🏦 Building withdraw transaction...")
  const result = await CoinBuddyBrain.buildWithdrawTransaction(vault, ctx.walletAddress)
  const reply = result ? CoinBuddyBrain.generateWithdrawReply(result.quoteSummary, vault, ctx.lang) : CoinBuddyBrain.generateWithdrawReply(null, vault, ctx.lang)
  ctx.pushHistory("model", reply)
  ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: result?.txPayload || null })
  return true
}
