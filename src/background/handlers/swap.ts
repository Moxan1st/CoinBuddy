import { CoinBuddyBrain } from "../brain"
import type { IntentResult } from "~types"
import type { HandlerContext } from "./types"
import { CHAIN_NAMES } from "~lib/chain-config"

export async function handleSwap(intent: IntentResult, ctx: HandlerContext): Promise<boolean> {
  if (intent.type !== "swap") return false

  ctx.pushHistory("user", ctx.userText)
  const params = intent.swapParams
  if (!params) {
    const reply = ctx.lang === "zh"
      ? "喵？你想换什么币？告诉本猫数量和币种，比如「swap 1 USDT to USDC」"
      : "Meow? What do you want to swap? Tell me the amount and tokens, like 'swap 1 USDT to USDC'"
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  const chainName = CHAIN_NAMES[params.chainId] || `Chain ${params.chainId}`
  const preview = ctx.lang === "zh"
    ? `喵～本猫帮你兑换：${params.amount} ${params.fromToken} → ${params.toToken}（${chainName}）`
    : `Meow~ Swapping for you: ${params.amount} ${params.fromToken} → ${params.toToken} (${chainName})`

  if (!ctx.walletAddress) {
    const reply = preview + "\n" + (ctx.lang === "zh" ? "但你还没连钱包呢！本猫帮你弹出来～" : "But you haven't connected a wallet! Let me open it for you~")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
    return true
  }

  ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🔄 正在构建兑换交易..." : "🔄 Building swap transaction...")
  const result = await CoinBuddyBrain.buildSwapTransaction(
    params.fromToken,
    params.toToken,
    params.chainId,
    ctx.walletAddress,
    params.amount + params.amountDecimals,
  )
  const reply = result
    ? preview + "\n" + (ctx.lang === "zh" ? "交易已就绪～点击下方按钮签名即可！" : "Transaction ready~ Click the button below to sign!")
    : preview + "\n" + (ctx.lang === "zh" ? "喵…交易构建失败了，可能是该链上没有这个交易对，试试其他链？" : "Meow... swap build failed. This pair might not be available on this chain. Try another chain?")
  ctx.pushHistory("model", reply)
  ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: result?.txPayload || null })
  return true
}
