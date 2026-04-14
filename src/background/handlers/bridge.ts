import { CoinBuddyBrain } from "../brain"
import type { IntentResult } from "~types"
import type { HandlerContext } from "./types"
import { CHAIN_NAMES } from "~lib/chain-config"
import { createLogger } from "~lib/logger"

const logger = createLogger("BridgeHandler")

export async function handleBridge(intent: IntentResult, ctx: HandlerContext): Promise<boolean> {
  if (intent.type !== "bridge") return false

  const pending = ctx.getPendingBridgeAfterWithdraw()
  const isContinuationKeyword = /^(继续|继续桥接|跨链|continue|continue bridge)$/i.test(ctx.userText.trim())
  const isBridgeContinue = !intent.bridgeParams
  if (pending && (isBridgeContinue || isContinuationKeyword)) {
    ctx.pushHistory("user", ctx.userText)
    if (!ctx.walletAddress) {
      const reply = ctx.lang === "zh"
        ? "喵～你还没连接钱包呢！本猫帮你弹出来，连好后再跟我说「继续桥接」～"
        : "Meow~ You haven't connected a wallet! Let me open it for you - say 'continue bridge' after connecting~"
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
      return true
    }

    ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🌉 正在构建桥接交易（Step 2/2）..." : "🌉 Building bridge transaction (Step 2/2)...")
    const tokenAddr = CoinBuddyBrain.resolveTokenAddress(pending.token, pending.fromChain)
    let bridgeAmount: string | null = null
    if (tokenAddr) {
      const balance = await CoinBuddyBrain.getERC20Balance(pending.fromChain, tokenAddr, ctx.walletAddress)
      if (balance && balance > 0n) bridgeAmount = balance.toString()
    }
    if (!bridgeAmount) {
      const reply = ctx.lang === "zh"
        ? `喵…本猫在 ${pending.token} 余额里没找到取款到账的资产。可能取款还没到账，稍等一下再跟我说「继续桥接」？`
        : `Meow... I couldn't find the withdrawn ${pending.token} in your balance. The withdrawal may still be settling — wait a moment and say "continue bridge" again?`
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }

    const result = await CoinBuddyBrain.buildBridgeTransaction(pending.token, pending.fromChain, pending.toChain, ctx.walletAddress, bridgeAmount)
    ctx.setPendingBridgeAfterWithdraw(null)
    const toChainName = CHAIN_NAMES[pending.toChain] || `Chain ${pending.toChain}`
    const header = ctx.lang === "zh" ? `喵～Step 2/2：桥接到 ${toChainName}！\n` : `Meow~ Step 2/2: Bridge to ${toChainName}!\n`
    const reply = result
      ? header + CoinBuddyBrain.generateBridgeReply(result.quoteSummary, ctx.lang)
      : CoinBuddyBrain.generateBridgeReply(null, ctx.lang, "no_route")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: result?.txPayload || null })
    return true
  }

  ctx.pushHistory("user", ctx.userText)
  const params = intent.bridgeParams
  if (!params) {
    const reply = ctx.lang === "zh"
      ? "喵？你想跨链什么币？告诉本猫代币、数量、来源链和目标链，比如「bridge 100 USDC from Base to Arbitrum」"
      : "Meow? What do you want to bridge? Tell me the token, amount, source and destination chain, like 'bridge 100 USDC from Base to Arbitrum'"
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  if (!params.token || !params.amount || !params.fromChain || !params.toChain) {
    const reply = ctx.lang === "zh"
      ? "喵？你想跨链什么币、从哪条链到哪条链？比如「把 2 USDT 从 Base 跨到 Optimism」"
      : "Meow? Which token do you want to bridge, and from which chain to which chain? For example: 'bridge 2 USDT from Base to Optimism'"
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  const fromChainName = CHAIN_NAMES[params.fromChain] || `Chain ${params.fromChain}`
  const toChainName = CHAIN_NAMES[params.toChain] || `Chain ${params.toChain}`
  if (!ctx.walletAddress) {
    const preview = ctx.lang === "zh"
      ? `喵～本猫帮你跨链：${params.amount} ${params.token} (${fromChainName}) → ${toChainName}`
      : `Meow~ Bridging for you: ${params.amount} ${params.token} (${fromChainName}) → ${toChainName}`
    const reply = preview + "\n" + (ctx.lang === "zh" ? "但你还没连钱包呢！本猫帮你弹出来～" : "But you haven't connected a wallet! Let me open it for you~")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
    return true
  }

  ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🌉 正在构建跨链交易..." : "🌉 Building bridge transaction...")
    let rawAmount = params.amount + params.amountDecimals;
  
  // 核心功能：处理 "all" 关键字
  if (params.amount.toLowerCase() === "all" && ctx.walletAddress) {
    ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🔍 正在读取您的钱包余额以跨链全部资产..." : "🔍 Reading balance to bridge all funds...");
    const tokenAddr = CoinBuddyBrain.resolveTokenAddress(params.token, params.fromChain);
    if (tokenAddr) {
      const balance = await CoinBuddyBrain.getERC20Balance(params.fromChain, tokenAddr, ctx.walletAddress);
      if (balance && balance > 0n) {
        rawAmount = balance.toString();
        logger.info("Automatically resolved ALL amount to", rawAmount);
      } else {
        const reply = ctx.lang === "zh" ? `喵…本猫发现你的钱包里好像没有 ${params.token}，没法全部跨链哦。` : `Meow... I found 0 ${params.token} in your wallet, so I cant bridge everything.`;
        ctx.pushHistory("model", reply);
        ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null });
        return true;
      }
    }
  }
  const tokenAddr = CoinBuddyBrain.resolveTokenAddress(params.token, params.fromChain)
  if (tokenAddr) {
    const bal = await CoinBuddyBrain.checkBalance(params.fromChain, ctx.walletAddress, tokenAddr, rawAmount)
    if (bal && !bal.sufficient) {
      const isNative = tokenAddr === "0x0000000000000000000000000000000000000000"
      const reply = isNative
        ? (ctx.lang === "zh" ? `喵…你的 ${params.token} 余额不足（含 Gas），请先充值后再试～` : `Meow... insufficient ${params.token} balance (including gas). Please top up first~`)
        : bal.nativeBalance === 0n
          ? (ctx.lang === "zh" ? "喵…你的钱包没有原生代币支付 Gas，请先充值 ETH/原生代币～" : "Meow... no native token for gas fees. Please add ETH/native token first~")
          : (ctx.lang === "zh" ? `喵…你的 ${params.token} 余额不足，请先充值后再试～` : `Meow... insufficient ${params.token} balance. Please top up first~`)
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }
  }

  const result = await CoinBuddyBrain.buildBridgeTransaction(params.token, params.fromChain, params.toChain, ctx.walletAddress, rawAmount)
  const reply = result ? CoinBuddyBrain.generateBridgeReply(result.quoteSummary, ctx.lang) : CoinBuddyBrain.generateBridgeReply(null, ctx.lang, "no_route")
  ctx.pushHistory("model", reply)
  ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: result?.txPayload || null })
  return true
}
