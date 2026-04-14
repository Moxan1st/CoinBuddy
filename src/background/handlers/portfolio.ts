import { CoinBuddyBrain } from "../brain"
import type { IntentResult } from "~types"
import type { HandlerContext } from "./types"
import type { Vault } from "~types"
import { CHAIN_NAMES } from "~lib/chain-config"

function buildVaultChoicesFromPositions(positions: Array<{
  vaultAddress: string | null
  vaultChainId: number | null
  protocolName: string | null
  assetSymbol: string | null
}>): Vault[] {
  const seen = new Set<string>()
  const vaults: Vault[] = []

  for (const position of positions) {
    if (!position.vaultAddress || !position.vaultChainId) continue

    const key = `${position.vaultChainId}:${position.vaultAddress.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    vaults.push({
      address: position.vaultAddress,
      chainId: position.vaultChainId,
      name: position.assetSymbol || "Unknown Vault",
      protocol: { name: position.protocolName || "DeFi" },
      analytics: { apy: { base: 0, reward: 0, total: 0 } },
      underlyingTokens: position.assetSymbol
        ? [{ address: "0x0000000000000000000000000000000000000000", symbol: position.assetSymbol, decimals: 18 }]
        : [],
    })
  }

  return vaults
}

async function enrichPortfolioPositionsWithVaultDetails(positions: Array<{
  vaultAddress: string | null
  vaultChainId: number | null
  protocolName: string | null
  assetSymbol: string | null
  balanceUsd?: number | null
}>) {
  return await Promise.all(
    positions.map(async (position) => {
      if (!position.vaultAddress || !position.vaultChainId) {
        return { ...position, protocolName: position.protocolName || "DeFi" }
      }

      const detailedVault = await CoinBuddyBrain.fetchVaultDetail(position.vaultChainId, position.vaultAddress)
      if (!detailedVault) {
        return { ...position, protocolName: position.protocolName || "DeFi" }
      }

      return {
        ...position,
        protocolName: detailedVault.protocol?.name || position.protocolName || "DeFi",
        assetSymbol: detailedVault.underlyingTokens?.[0]?.symbol || position.assetSymbol,
      }
    }),
  )
}

function filterPortfolioPositions(
  positions: Array<{
    vaultAddress: string | null
    vaultChainId: number | null
    protocolName: string | null
    assetSymbol: string | null
    balanceUsd?: number | null
  }>,
  filters?: IntentResult["portfolioParams"],
) {
  if (!filters?.protocol && !filters?.asset && !filters?.chainId) {
    return positions
  }

  return positions.filter((position) => {
    if (filters.chainId && position.vaultChainId !== filters.chainId) return false
    if (filters.asset) {
      const assetSymbol = (position.assetSymbol || "").toUpperCase()
      if (assetSymbol !== filters.asset.toUpperCase()) return false
    }
    if (filters.protocol) {
      const protocolName = (position.protocolName || "").toLowerCase()
      const keyword = filters.protocol.toLowerCase()
      if (
        protocolName !== keyword &&
        !protocolName.startsWith(`${keyword}-`) &&
        !protocolName.startsWith(`${keyword} `) &&
        !protocolName.includes(keyword)
      ) {
        return false
      }
    }
    return true
  })
}

export async function handlePortfolio(intent: IntentResult, ctx: HandlerContext): Promise<boolean> {
  if (intent.type !== "portfolio") return false

  ctx.pushHistory("user", ctx.userText)
  if (!ctx.walletAddress) {
    const reply = ctx.lang === "zh" ? "喵～先连钱包，本猫才能查资产！" : "Meow~ Connect wallet first!"
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
    return true
  }

  ctx.sendProgress(ctx.tabId, "🔍 " + (ctx.lang === "zh" ? "正在同步 Earn 持仓与钱包余额..." : "Syncing Earn and wallet balances..."))

  try {
    const walletAddr = ctx.walletAddress
    const [positions, walletBalances] = await Promise.all([
      ctx.ensurePortfolioSnapshot(walletAddr),
      CoinBuddyBrain.fetchWalletBalances(walletAddr, [8453, 42161, 10, 1]),
    ])

    const verifiedPositions = await enrichPortfolioPositionsWithVaultDetails(positions)
    const filteredPositions = filterPortfolioPositions(verifiedPositions, intent.portfolioParams)
    const vaultChoices = buildVaultChoicesFromPositions(filteredPositions)

    if (vaultChoices.length > 0) {
      ctx.cacheVaultChoices(ctx.pendingDepositDraft, vaultChoices, ctx.walletAddress)
      ctx.pendingDepositDraft.selectedVault = vaultChoices.length === 1 ? vaultChoices[0] : null
    } else {
      ctx.pendingDepositDraft.selectedVault = null
      ctx.pendingDepositDraft.vaultChoices = []
    }

    const earnReply = CoinBuddyBrain.generatePortfolioReply(filteredPositions, ctx.lang)

    let walletText = ""
    if (walletBalances && walletBalances.length > 0) {
      const title = ctx.lang === "zh" ? "\n\n👛 **钱包可用余额**:" : "\n\n👛 **Wallet Balances**:"
      const items = walletBalances
        .sort((a: any, b: any) => b.valueUsd - a.valueUsd)
        .map((b: any) => `• ${b.symbol} (${CHAIN_NAMES[b.chainId] || b.chainId}): ${parseFloat(b.amount).toFixed(4)} ($${b.valueUsd.toFixed(2)})`)
        .join("\n")
      walletText = title + "\n" + items
    }

    const reply = earnReply.split("\n\n")[0] + walletText + "\n\n要存入资产或查看详情吗？"
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  } catch (e) {
    const reply = ctx.lang === "zh" ? "喵…查询失败了，请稍后再试。" : "Meow... fetch failed, try again later."
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }
}
