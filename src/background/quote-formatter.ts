import { CHAIN_NAMES } from "../lib/chain-config.ts"
import type { QuoteSummary, Vault } from "../types/index.ts"
import { generateBotReply as generateBotReplyWithLlm } from "./llm-client.ts"

export function buildVaultProceedPrompt(vault: Vault, lang: "zh" | "en"): string {
  if (vault.isRedeemable === true) {
    return lang === "zh"
      ? "确认的话告诉我金额，我可以继续帮你存进去。"
      : "If you want to continue, tell me the amount and I can deposit for you."
  }

  return lang === "zh"
    ? "不过这个金库目前没法通过 CoinBuddy 取出。你还要继续存进去吗？"
    : "But this vault can't be withdrawn through CoinBuddy right now. Do you still want to continue?"
}

export function extractQuoteSummary(
  data: any,
  action: QuoteSummary["action"],
  overrides?: { fromChain?: number; toChain?: number; fromToken?: string; toToken?: string; fromAmount?: string },
): QuoteSummary {
  const est = data.estimate || {}
  const fromDecimals = est.fromToken?.decimals ?? est.fromAmount ? 18 : 18
  const toDecimals = est.toToken?.decimals ?? 18
  const actualFromDecimals = est.fromToken?.decimals ?? fromDecimals
  const actualToDecimals = est.toToken?.decimals ?? toDecimals
  const fromChainId = overrides?.fromChain ?? data.action?.fromChainId ?? est.fromToken?.chainId ?? 0
  const toChainId = overrides?.toChain ?? data.action?.toChainId ?? est.toToken?.chainId ?? 0

  return {
    action,
    fromChain: fromChainId,
    toChain: toChainId,
    fromChainName: CHAIN_NAMES[fromChainId] || `Chain ${fromChainId}`,
    toChainName: CHAIN_NAMES[toChainId] || `Chain ${toChainId}`,
    fromToken: overrides?.fromToken ?? est.fromToken?.symbol ?? "?",
    toToken: overrides?.toToken ?? est.toToken?.symbol ?? "?",
    fromAmount: overrides?.fromAmount
      ? Number(overrides.fromAmount) / Math.pow(10, actualFromDecimals)
      : est.fromAmount ? Number(est.fromAmount) / Math.pow(10, actualFromDecimals) : 0,
    toAmount: est.toAmount ? Number(est.toAmount) / Math.pow(10, actualToDecimals) : 0,
    toAmountMin: est.toAmountMin ? Number(est.toAmountMin) / Math.pow(10, actualToDecimals) : 0,
    gasCostUSD: Array.isArray(est.gasCosts) ? est.gasCosts.reduce((sum: number, gas: any) => sum + Number(gas.amountUSD || 0), 0) : 0,
    feeCostUSD: Array.isArray(est.feeCosts) ? est.feeCosts.reduce((sum: number, fee: any) => sum + Number(fee.amountUSD || 0), 0) : 0,
    toolName: data.toolDetails?.name || data.tool || "",
    executionDuration: est.executionDuration || 0,
    approvalAddress: est.approvalAddress || data.transactionRequest?.to || "",
  }
}

export function formatQuoteSummary(summary: QuoteSummary, lang: "zh" | "en"): string {
  const fmtAmt = (value: number) => value > 0 ? value.toFixed(6) : "—"
  const fmtUsd = (value: number) => value > 0 ? `~$${value.toFixed(2)}` : "—"
  const totalFee = summary.gasCostUSD + summary.feeCostUSD
  const totalFeeStr = totalFee > 0 ? `~$${totalFee.toFixed(2)}` : "—"
  const durationMin = summary.executionDuration > 0 ? Math.ceil(summary.executionDuration / 60) : 0
  const durationStr = durationMin > 0
    ? (lang === "zh" ? `约 ${durationMin} 分钟` : `~${durationMin} min`)
    : (lang === "zh" ? "预估中" : "estimating")

  const lines = [
    `▶ ${summary.fromAmount} ${summary.fromToken} (${summary.fromChainName}) → ${summary.toToken} (${summary.toChainName})`,
  ]

  if (lang === "zh") {
    lines.push(`▶ 预计到账: ${fmtAmt(summary.toAmount)} ${summary.toToken}`)
    lines.push(`▶ 最少到账: ${fmtAmt(summary.toAmountMin)} ${summary.toToken}`)
    lines.push(`▶ Gas 费用: ${fmtUsd(summary.gasCostUSD)}`)
    lines.push(`▶ 手续费: ${fmtUsd(summary.feeCostUSD)} (总计 ${totalFeeStr})`)
    lines.push(`▶ 预计耗时: ${durationStr}`)
    if (summary.toolName) lines.push(`▶ 路由: ${summary.toolName}`)
  } else {
    lines.push(`▶ Expected: ${fmtAmt(summary.toAmount)} ${summary.toToken}`)
    lines.push(`▶ Minimum: ${fmtAmt(summary.toAmountMin)} ${summary.toToken}`)
    lines.push(`▶ Gas cost: ${fmtUsd(summary.gasCostUSD)}`)
    lines.push(`▶ Fee: ${fmtUsd(summary.feeCostUSD)} (total ${totalFeeStr})`)
    lines.push(`▶ Est. time: ${durationStr}`)
    if (summary.toolName) lines.push(`▶ Route: ${summary.toolName}`)
  }

  return lines.join("\n")
}

export async function generateBotReply(vault: Vault | null, lang: "zh" | "en" = "zh"): Promise<string> {
  return generateBotReplyWithLlm(vault, lang, vault ? buildVaultProceedPrompt(vault, lang) : "")
}

export function generateBridgeReply(summary: QuoteSummary | null, lang: "zh" | "en" = "zh", error?: string): string {
  if (error) {
    if (error === "unsupported_token") return lang === "zh" ? "喵…这个代币本猫暂时不支持跨链，目前只支持 USDC、USDT、ETH、WETH 喵！" : "Meow... this token isn't supported for bridging yet. Currently supports USDC, USDT, ETH, WETH only!"
    if (error === "unsupported_chain") return lang === "zh" ? "喵…这条链本猫还不认识呢，目前支持 Ethereum、Base、Arbitrum、Optimism、Polygon、BSC、Avalanche 喵！" : "Meow... I don't recognize that chain. Currently supports Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche!"
    if (error === "no_route") return lang === "zh" ? "喵…LI.FI 没找到这条跨链路由，换条链或换个代币试试？" : "Meow... LI.FI couldn't find a route for this bridge. Try a different chain or token?"
    if (error === "no_wallet") return lang === "zh" ? "喵～你还没连接钱包呢！本猫帮你弹出来，连好后再跟我说「确认」～" : "Meow~ You haven't connected a wallet! Let me open it for you - say 'confirm' after connecting~"
    return lang === "zh" ? `喵…跨链出了点问题：${error}` : `Meow... bridge error: ${error}`
  }
  if (!summary) return lang === "zh" ? "喵…跨链交易构建失败了，可能是网络波动，再试一次？" : "Meow... bridge transaction build failed. Could be a network hiccup - try again?"
  const header = lang === "zh" ? "喵～本猫帮你跨链：" : "Meow~ Bridging for you:"
  const footer = lang === "zh" ? "交易已就绪～点击下方按钮签名即可！" : "Transaction ready~ Click the button below to sign!"
  return `${header}\n\n${formatQuoteSummary(summary, lang)}\n\n${footer}`
}

export function generateWithdrawReply(summary: QuoteSummary | null, vault: Vault | null, lang: "zh" | "en" = "zh", error?: string): string {
  if (error) {
    if (error === "not_redeemable") return lang === "zh" ? `喵…${vault ? `${vault.protocol.name} (${vault.name})` : ""} 这个金库暂不支持赎回，可能有锁定期或其他限制喵！` : `Meow... ${vault ? `${vault.protocol.name} (${vault.name})` : ""} doesn't support redemption. It may have a lock-up period or other restrictions!`
    if (error === "no_vault") return lang === "zh" ? "喵？你想从哪个金库取款？先让本猫帮你搜一个金库，或者告诉我协议和链的信息！" : "Meow? Which vault do you want to withdraw from? Let me search for a vault first, or tell me the protocol and chain!"
    if (error === "no_balance") return lang === "zh" ? "喵…你在这个金库里没有持仓呢，确认一下钱包地址对不对？" : "Meow... you don't have any position in this vault. Double-check your wallet address?"
    if (error === "no_wallet") return lang === "zh" ? "喵～你还没连接钱包呢！本猫帮你弹出来，连好后再跟我说「取款」～" : "Meow~ You haven't connected a wallet! Let me open it for you - say 'withdraw' after connecting~"
    return lang === "zh" ? `喵…取款出了点问题：${error}` : `Meow... withdraw error: ${error}`
  }
  if (!summary || !vault) return lang === "zh" ? "喵…取款交易构建失败了，可能是网络波动，再试一次？" : "Meow... withdraw transaction build failed. Could be a network hiccup - try again?"
  const chainName = CHAIN_NAMES[vault.chainId] || `Chain ${vault.chainId}`
  const header = lang === "zh" ? `喵～本猫帮你从 ${vault.protocol.name} (${chainName}) 取款：` : `Meow~ Withdrawing from ${vault.protocol.name} (${chainName}):`
  const footer = lang === "zh" ? "交易已就绪～点击下方按钮签名即可！" : "Transaction ready~ Click the button below to sign!"
  return `${header}\n\n${formatQuoteSummary(summary, lang)}\n\n${footer}`
}

export function generateWithdrawBridgePlan(withdrawSummary: QuoteSummary, vault: Vault, toChainName: string, lang: "zh" | "en" = "zh"): string {
  const vaultChainName = CHAIN_NAMES[vault.chainId] || `Chain ${vault.chainId}`
  const underlyingSymbol = vault.underlyingTokens?.[0]?.symbol || "?"
  const withdrawDetails = formatQuoteSummary(withdrawSummary, lang)

  if (lang === "zh") {
    return `喵～这是一个两步操作，本猫帮你拆解：\n\n📋 **执行计划**\n┌ Step 1️⃣ 从 ${vault.protocol.name} (${vaultChainName}) 取出 ${underlyingSymbol}\n└ Step 2️⃣ 将 ${underlyingSymbol} 从 ${vaultChainName} 桥接到 ${toChainName}\n\n⚠️ 由于跨链桥接无法和取款原子化执行，本猫会分两次签名完成。\n\n━━ Step 1：取款详情 ━━\n${withdrawDetails}\n\n点击下方按钮签名完成取款，取款到账后跟我说「继续桥接」或「bridge」，本猫立刻帮你跨链！`
  }
  return `Meow~ This is a two-step operation, here's the plan:\n\n📋 **Execution Plan**\n┌ Step 1️⃣ Withdraw ${underlyingSymbol} from ${vault.protocol.name} (${vaultChainName})\n└ Step 2️⃣ Bridge ${underlyingSymbol} from ${vaultChainName} to ${toChainName}\n\n⚠️ Cross-chain bridge cannot be atomically batched with withdrawal — this requires two separate signatures.\n\n━━ Step 1: Withdraw Details ━━\n${withdrawDetails}\n\nClick the button below to sign the withdrawal. After it settles, say "continue bridge" or "bridge" and I'll handle the cross-chain transfer!`
}

export function generateCompareReply(vaults: Vault[], lang: "zh" | "en" = "zh"): string {
  if (vaults.length === 0) return "Meow... no vaults found matching your criteria. Try a different asset or chain?"
  const lines = vaults.slice(0, 5).map((vault, index) => {
    const apy = vault.analytics?.apy
    const tvlRaw = typeof vault.analytics?.tvl === "object" ? Number((vault.analytics.tvl as any).usd) : (vault.analytics?.tvl || 0)
    const tvlStr = tvlRaw > 1e6 ? `$${(tvlRaw / 1e6).toFixed(1)}M` : tvlRaw > 1e3 ? `$${(tvlRaw / 1e3).toFixed(0)}K` : `$${tvlRaw}`
    const chain = CHAIN_NAMES[vault.chainId] || vault.network || `Chain${vault.chainId}`
    const reward = apy?.reward ? (lang === "zh" ? ` (+${apy.reward.toFixed(1)}% boost)` : ` (+${apy.reward.toFixed(1)}% reward)`) : ""
    const tags = vault.tags?.includes("stablecoin") ? " [stablecoin]" : ""
    const tokens = vault.underlyingTokens?.map((t) => t.symbol).join("/") || "?"
    return `${index + 1}. ${vault.protocol.name} (${chain}) [${tokens}] - APY ${apy?.total?.toFixed(2) || "?"}%${reward}, TVL ${tvlStr}${tags}`
  })
  const count = Math.min(5, vaults.length)
  const header = lang === "zh" ? `喵～本猫帮你找了 ${vaults.length} 个金库，Top ${count}：` : `Meow~ Found ${vaults.length} vaults, here's the Top ${count}:`
  const footer = lang === "zh" ? "\n\n想存哪个？告诉本猫金额，我帮你一键搞定！" : "\n\nWhich one? Tell me the amount and I'll handle it in one click!"
  return `${header}\n${lines.join("\n")}${footer}`
}

export function generateVaultDetailReply(vault: Vault, lang: "zh" | "en" = "zh"): string {
  const apy = vault.analytics?.apy
  const chain = CHAIN_NAMES[vault.chainId] || vault.network || `Chain${vault.chainId}`
  const tvlRaw = typeof vault.analytics?.tvl === "object" ? Number((vault.analytics.tvl as any).usd) : (vault.analytics?.tvl || 0)
  const tvlStr = tvlRaw > 1e6 ? `$${(tvlRaw / 1e6).toFixed(1)}M` : `$${(tvlRaw / 1e3).toFixed(0)}K`
  const apy1d = vault.analytics?.apy1d != null ? `${vault.analytics.apy1d.toFixed(2)}%` : "N/A"
  const apy7d = vault.analytics?.apy7d != null ? `${vault.analytics.apy7d.toFixed(2)}%` : "N/A"
  const apy30d = vault.analytics?.apy30d != null ? `${vault.analytics.apy30d.toFixed(2)}%` : "N/A"
  const tokens = vault.underlyingTokens?.map((token) => token.symbol).join(", ") || "?"
  const tags = vault.tags?.join(", ") || (lang === "zh" ? "无" : "none")
  const canWithdraw = vault.isRedeemable ? (lang === "zh" ? "支持" : "Yes") : (lang === "zh" ? "不支持" : "No")
  const warnZh = apy?.reward && apy.reward > apy.base ? "\n⚠ 注意：补贴收益超过基础收益，可能是临时激励喵！" : ""
  const warnEn = apy?.reward && apy.reward > apy.base ? "\n⚠ Warning: reward yield exceeds base yield - may be temporary incentive!" : ""

  if (lang === "zh") {
    return `喵～本猫给你谈谈这个金库：\n\n▶ ${vault.name} (${vault.protocol.name})\n▶ Chain: ${chain}\n▶ Asset: ${tokens}\n▶ APY: ${apy?.total?.toFixed(2) || "?"}% (base ${apy?.base?.toFixed(2) || 0}% + reward ${apy?.reward?.toFixed(2) || 0}%)\n▶ APY Trend: 1d ${apy1d} | 7d ${apy7d} | 30d ${apy30d}\n▶ TVL: ${tvlStr}\n▶ Tags: ${tags}\n▶ Redeemable: ${canWithdraw}${warnZh}\n\n想存进去的话告诉本猫金额！`
  }
  return `Meow~ Here's the deep dive on this vault:\n\n▶ ${vault.name} (${vault.protocol.name})\n▶ Chain: ${chain}\n▶ Asset: ${tokens}\n▶ APY: ${apy?.total?.toFixed(2) || "?"}% (base ${apy?.base?.toFixed(2) || 0}% + reward ${apy?.reward?.toFixed(2) || 0}%)\n▶ APY Trend: 1d ${apy1d} | 7d ${apy7d} | 30d ${apy30d}\n▶ TVL: ${tvlStr}\n▶ Tags: ${tags}\n▶ Redeemable: ${canWithdraw}${warnEn}\n\nTell me the amount and I'll deposit for you!`
}

export function generatePortfolioReply(positions: any[], lang: "zh" | "en" = "zh"): string {
  if (positions.length === 0) return lang === "zh" ? "喵～你目前还没有 Earn 持仓呢！要不要让本猫帮你找个好池子？" : "Meow~ You don't have any Earn positions yet! Want me to find a good pool for you?"
  const lines = positions.map((position: any) => {
    const chainId = position.vaultChainId || position.chainId
    const chain = CHAIN_NAMES[chainId] || `Chain${chainId}`
    const symbol = position.assetSymbol || position.asset?.symbol || position.symbol || "?"
    const protocolLabel = position.protocolName || (lang === "zh" ? "DeFi" : "Protocol unconfirmed")
    return `• ${protocolLabel} (${chain}) - ${symbol}: $${Number(position.balanceUsd || 0).toFixed(2)}`
  })
  const total = positions.reduce((sum: number, position: any) => sum + Number(position.balanceUsd || 0), 0)
  const header = lang === "zh" ? `喵～主人的 Earn 持仓一览（共 $${total.toFixed(2)}）：` : `Meow~ Your Earn positions (total $${total.toFixed(2)}):`
  const footer = lang === "zh" ? "\n\n要查看某个池子的详情吗？" : "\n\nWant details on any of these?"
  return `${header}\n${lines.join("\n")}${footer}`
}

export function generateChainsReply(chains: any[], lang: "zh" | "en" = "zh"): string {
  if (chains.length === 0) return lang === "zh" ? "喵…获取链信息失败了" : "Meow... failed to fetch chain info."
  const names = chains.map((chain: any) => chain.name).join(lang === "zh" ? "、" : ", ")
  return lang === "zh"
    ? `喵～LIFI Earn 目前支持 ${chains.length} 条链：${names}。\n\n想在哪条链上找金库？告诉本猫！`
    : `Meow~ LI.FI Earn supports ${chains.length} chains: ${names}.\n\nWhich chain do you want to explore?`
}

export function generateProtocolsReply(protocols: any[], lang: "zh" | "en" = "zh"): string {
  if (protocols.length === 0) return lang === "zh" ? "喵…获取协议信息失败了" : "Meow... failed to fetch protocol info."
  const names = protocols.map((protocol: any) => protocol.name).join(lang === "zh" ? "、" : ", ")
  return lang === "zh"
    ? `喵～LIFI Earn 接入了 ${protocols.length} 个协议：${names}。\n\n覆盖 Aave、Morpho、Euler、Pendle 等主流平台，想在哪个协议上存？`
    : `Meow~ LI.FI Earn integrates ${protocols.length} protocols: ${names}.\n\nCovers Aave, Morpho, Euler, Pendle and more. Which protocol interests you?`
}

export function generateTokenPriceReply(token: any, originalSymbol: string, lang: "zh" | "en" = "zh"): string {
  if (!token || !token.priceUSD) return lang === "zh" ? `喵…没找到 ${originalSymbol} 的价格信息，可能这个代币不在 LI.FI 支持范围内` : `Meow... couldn't find price info for ${originalSymbol}. It may not be supported by LI.FI.`
  const price = Number(token.priceUSD)
  const priceStr = price >= 1 ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${price.toPrecision(4)}`
  const mcap = token.marketCapUSD ? `$${(Number(token.marketCapUSD) / 1e9).toFixed(2)}B` : "N/A"
  const vol24h = token.volumeUSD24H ? `$${(Number(token.volumeUSD24H) / 1e6).toFixed(1)}M` : "N/A"
  const displaySymbol = originalSymbol.toUpperCase() === "BTC" ? "BTC (WBTC)" : token.symbol
  const vol = Number(token.volumeUSD24H || 0)

  if (lang === "zh") {
    const volHint = vol > 1e8 ? "(成交活跃)" : vol > 1e7 ? "(中等活跃)" : "(偏冷清)"
    return `喵～${displaySymbol} 当前行情：\n\n▶ 价格: ${priceStr}\n▶ 市值: ${mcap}\n▶ 24h 成交量: ${vol24h} ${volHint}\n\n⚠ 本猫的数据来自 LI.FI，暂不支持历史K线图。\n想看 ${token.symbol} 相关金库的 APY 趋势，可以跟我说「看看 ${token.symbol} 的金库详情」～`
  }
  const volHint = vol > 1e8 ? "(active)" : vol > 1e7 ? "(moderate)" : "(low)"
  return `Meow~ ${displaySymbol} market snapshot:\n\n▶ Price: ${priceStr}\n▶ Market Cap: ${mcap}\n▶ 24h Volume: ${vol24h} ${volHint}\n\n⚠ Data from LI.FI - historical charts not available.\nTo see ${token.symbol} vault APY trends (1d/7d/30d), just ask "show me ${token.symbol} vault details"!`
}
