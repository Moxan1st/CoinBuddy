import type { Strategy } from "~strategy"
import type { IntentResult } from "~types"
import type { HandlerContext } from "./types"

export async function handleStrategy(intent: IntentResult, ctx: HandlerContext): Promise<boolean> {
  if (intent.type === "strategy_create") {
    ctx.pushHistory("user", ctx.userText)
    const sp = intent.strategyParams
    if (!sp || !sp.triggerThreshold || !sp.spendAmount || !sp.spendToken) {
      const reply = ctx.lang === "zh"
        ? "喵？本猫需要更多信息才能设定策略：\n- 触发价格（比如 BTC <= 70000）\n- 花多少钱买（比如 20000 USDT）\n告诉本猫完整条件吧～"
        : "Meow? I need more details to create a strategy:\n- Trigger price (e.g. BTC <= 70000)\n- How much to spend (e.g. 20000 USDT)\nGive me the full conditions~"
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }

    const triggerSymbol = (sp.triggerSymbol || "BTC").toUpperCase()
    const triggerCondition = sp.triggerCondition || "lte"
    const spendChainId = sp.spendChainId || 8453
    const targetChainId = sp.targetChainId || spendChainId
    const buyToken = sp.buyToken || (triggerSymbol === "BTC" ? "cbBTC" : triggerSymbol)
    const postAction = sp.postAction || "none"
    let effectivePostAction = postAction
    let postActionDowngraded = false
    if (postAction === "vault_deposit" && !sp.vaultAddress) {
      effectivePostAction = "none"
      postActionDowngraded = true
    }

    ctx.setPendingStrategyDraft({
      triggerSymbol,
      triggerCondition,
      triggerThreshold: sp.triggerThreshold,
      spendToken: sp.spendToken,
      spendAmount: sp.spendAmount,
      spendChainId,
      buyToken,
      targetChainId,
      postAction: effectivePostAction,
      vaultAddress: sp.vaultAddress,
      vaultChainId: sp.vaultChainId || targetChainId,
      protocol: sp.protocol,
    })

    const chainName = ({ 1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 10: "Optimism" } as Record<number, string>)[targetChainId] || `Chain ${targetChainId}`
    const condStr = triggerCondition === "lte" ? "<=" : ">="
    const btcNote = triggerSymbol === "BTC" && !sp.buyToken
      ? (ctx.lang === "zh" ? `\n（BTC 在 EVM 上将使用 ${buyToken} 作为包装资产）` : `\n(BTC on EVM will use ${buyToken} as the wrapped asset)`)
      : ""
    const downgradeNote = postActionDowngraded
      ? (ctx.lang === "zh"
        ? `\n⚠️ 你提到了${sp.protocol || "vault"}但没有提供 vault 地址，本次策略将仅执行买入。如需自动存入，请提供完整 vault 地址后重新创建。`
        : `\n⚠️ You mentioned ${sp.protocol || "vault"} but didn't provide a vault address. This strategy will buy only. To auto-deposit, recreate with a full vault address.`)
      : ""
    const postActionDesc = effectivePostAction === "vault_deposit" && sp.vaultAddress
      ? (ctx.lang === "zh"
        ? `买入后自动存入 ${sp.protocol || ""} (${sp.vaultAddress.slice(0, 6)}...${sp.vaultAddress.slice(-4)}) vault`
        : `After buying, auto-deposit into ${sp.protocol || ""} (${sp.vaultAddress.slice(0, 6)}...${sp.vaultAddress.slice(-4)}) vault`)
      : (ctx.lang === "zh" ? "仅买入，不做后续操作" : "Buy only, no post-action")
    const reply = ctx.lang === "zh"
      ? `喵～本猫理解你的策略如下：\n▶ 触发条件：${triggerSymbol} ${condStr} $${sp.triggerThreshold.toLocaleString()}\n▶ 买入：用 ${sp.spendAmount} ${sp.spendToken} 买入 ${buyToken}\n▶ 链：${chainName}\n▶ 后续动作：${postActionDesc}${btcNote}${downgradeNote}\n\n确认创建这个策略吗？跟我说「确认」或「取消」～`
      : `Meow~ Here's what I understood:\n▶ Trigger: ${triggerSymbol} ${condStr} $${sp.triggerThreshold.toLocaleString()}\n▶ Buy: ${sp.spendAmount} ${sp.spendToken} → ${buyToken}\n▶ Chain: ${chainName}\n▶ Post-action: ${postActionDesc}${btcNote}${downgradeNote}\n\nShall I create this strategy? Say "confirm" or "cancel"~`
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  if (intent.type === "strategy_list") {
    ctx.pushHistory("user", ctx.userText)
    const engine = ctx.getEngine()
    if (!engine) {
      const reply = ctx.lang === "zh"
        ? "喵…策略引擎还没初始化，可能是还没配置执行钱包。"
        : "Meow... Strategy engine isn't initialized yet. The agent wallet may not be configured."
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }

    const strategies = engine.getStrategies()
    if (strategies.length === 0) {
      const reply = ctx.lang === "zh"
        ? "喵～你还没有任何策略。跟本猫说比如「BTC 到 7 万时用 2 万 USDT 买入」就能创建一个！"
        : "Meow~ You don't have any strategies yet. Tell me something like 'buy 20000 USDT of cbBTC when BTC drops to 70000' to create one!"
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }

    const chainNames: Record<number, string> = { 1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 10: "Optimism" }
    const statusLabels: Record<string, { zh: string; en: string }> = {
      armed: { zh: "待触发", en: "Armed" },
      triggered: { zh: "已触发", en: "Triggered" },
      step1_executing: { zh: "买入中", en: "Buying" },
      step1_done: { zh: "买入完成", en: "Buy done" },
      step2_executing: { zh: "存入中", en: "Depositing" },
      executed: { zh: "已完成", en: "Completed" },
      failed_quote: { zh: "失败(无路由)", en: "Failed(no route)" },
      failed_balance: { zh: "失败(余额不足)", en: "Failed(balance)" },
      failed_step1_tx: { zh: "失败(买入)", en: "Failed(buy tx)" },
      failed_step2_tx: { zh: "失败(存入)", en: "Failed(deposit tx)" },
      failed_vault: { zh: "失败(vault)", en: "Failed(vault)" },
      failed_price_stale: { zh: "失败(价格过期)", en: "Failed(stale price)" },
      failed_timeout: { zh: "失败(超时)", en: "Failed(timeout)" },
    }

    const lines = strategies.map((strategy: Strategy, index: number) => {
      const cond = strategy.triggerCondition === "lte" ? "<=" : ">="
      const chain = chainNames[strategy.targetChainId] || `Chain ${strategy.targetChainId}`
      const statusLabel = statusLabels[strategy.status] || { zh: strategy.status, en: strategy.status }
      const st = ctx.lang === "zh" ? statusLabel.zh : statusLabel.en
      const post = strategy.postAction?.type === "vault_deposit"
        ? (strategy.postAction.protocol ? ` → ${strategy.postAction.protocol}` : " → vault")
        : ""
      return `${index + 1}. ${strategy.triggerSymbol} ${cond} $${strategy.triggerThreshold.toLocaleString()} | ${strategy.spendAmount} ${strategy.spendToken} → ${strategy.buyToken}${post} (${chain}) [${st}]`
    })

    const reply = (ctx.lang === "zh"
      ? `喵～你有 ${strategies.length} 个策略：\n`
      : `Meow~ You have ${strategies.length} strateg${strategies.length > 1 ? "ies" : "y"}:\n`) + lines.join("\n")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  if (intent.type === "confirm" && ctx.getPendingStrategyDraft()) {
    ctx.pushHistory("user", ctx.userText)
    const draft = ctx.getPendingStrategyDraft()
    ctx.setPendingStrategyDraft(null)
    const engine = ctx.getEngine()
    if (!engine || !draft) {
      const reply = ctx.lang === "zh"
        ? "喵…策略引擎还没准备好，可能是还没配置执行钱包。先用 STRATEGY_SETUP_WALLET 配置钱包后再试～"
        : "Meow... Strategy engine isn't ready. Configure the agent wallet first, then try again~"
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }

    try {
      const strategy = await engine.addStrategy({
        triggerSymbol: draft.triggerSymbol,
        triggerCondition: draft.triggerCondition,
        triggerThreshold: draft.triggerThreshold,
        spendToken: draft.spendToken,
        spendAmount: draft.spendAmount,
        spendChainId: draft.spendChainId,
        buyToken: draft.buyToken,
        targetChainId: draft.targetChainId,
        postAction: {
          type: draft.postAction,
          vaultAddress: draft.vaultAddress || "",
          vaultChainId: draft.vaultChainId || draft.targetChainId,
          protocol: draft.protocol,
        },
        requiredHits: 3,
        cooldownMs: 86_400_000,
        maxExecutionDelayMs: 300_000,
      })
      engine.startWatching(draft.triggerSymbol)
      const cond = draft.triggerCondition === "lte" ? "<=" : ">="
      const reply = ctx.lang === "zh"
        ? `喵！策略已创建并开始监控！\n▶ ID: ${strategy.id}\n▶ ${draft.triggerSymbol} ${cond} $${draft.triggerThreshold.toLocaleString()} → 用 ${draft.spendAmount} ${draft.spendToken} 买 ${draft.buyToken}\n▶ 状态：待触发（需连续命中 3 次价格条件）\n本猫会一直盯着行情的～`
        : `Meow! Strategy created and monitoring started!\n▶ ID: ${strategy.id}\n▶ ${draft.triggerSymbol} ${cond} $${draft.triggerThreshold.toLocaleString()} → Buy ${draft.buyToken} with ${draft.spendAmount} ${draft.spendToken}\n▶ Status: Armed (needs 3 consecutive price hits)\nI'll keep watching the market~`
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    } catch (error: any) {
      const reply = ctx.lang === "zh" ? `喵…策略创建失败了：${error.message}` : `Meow... Strategy creation failed: ${error.message}`
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    }
    return true
  }

  return false
}
