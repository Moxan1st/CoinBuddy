import { normalizeExecutionPlan, validateExecutionPlan, type PlanStep } from "~planner"
import { CoinBuddyBrain } from "../brain"
import type { IntentResult } from "~types"
import type { HandlerContext } from "./types"

async function handlePlannedDeposit(step: PlanStep, ctx: HandlerContext) {
  const asset = String(step.params.searchAsset || "USDC").toUpperCase()
  const toChainConfig = Array.isArray(step.params.toChainConfig) && step.params.toChainConfig.length > 0
    ? step.params.toChainConfig
    : [8453, 42161, 10, 1]

  ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🏦 正在搜索最优金库..." : "🏦 Searching for the best vault...")
  const vault = await CoinBuddyBrain.fetchOptimalVault(toChainConfig, asset)
  if (!vault) {
    return {
      reply: ctx.lang === "zh"
        ? "喵…本猫没找到合适的稳定币金库，先换条链或换个资产试试？"
        : "Meow... I couldn't find a suitable stablecoin vault. Try another chain or asset?",
      transactionPayload: null,
    }
  }

  const amount = String(step.params.amount || "")
  const amountDecimals = String(step.params.amountDecimals || "")
  const fromChain = Number(step.params.fromChain || step.params.chainId || 0)
  const hasExactInput = amount.length > 0 && fromChain > 0

  ctx.pendingDepositDraft.selectedVault = vault
  ctx.pendingDepositDraft.walletAddress = ctx.walletAddress || null
  ctx.pendingDepositDraft.vaultChoices = [vault]

  if (hasExactInput) {
    ctx.pendingDepositDraft.investParams = {
      amount,
      amountDecimals,
      fromChain,
      toChainConfig,
      searchAsset: asset,
    }
  }

  let transactionPayload = null
  if (ctx.walletAddress && hasExactInput) {
    ctx.sendProgress(ctx.tabId, ctx.lang === "zh" ? "🔧 正在构建最短路径交易..." : "🔧 Building the shortest-path transaction...")
    const depositResult = await CoinBuddyBrain.buildDepositTransaction(
      fromChain,
      vault,
      ctx.walletAddress,
      amount + amountDecimals,
    )
    transactionPayload = depositResult?.txPayload || null
  }

  const vaultReply = await CoinBuddyBrain.generateBotReply(
    vault,
    ctx.lang,
    ctx.lang === "zh" ? "告诉我金额，我就帮你存进去。" : "Tell me the amount and I'll deposit it.",
  )
  const routeNote = ctx.lang === "zh"
    ? "\n\n喵～我已经把路径压成最少步骤了，这次不需要多余的兑换/跨链动作。"
    : "\n\nMeow~ I compressed the route to the minimum number of steps, so no extra swap/bridge step is needed."

  return {
    reply: vaultReply + routeNote,
    transactionPayload,
  }
}

export async function handleComposite(intent: IntentResult, ctx: HandlerContext): Promise<boolean> {
  if (intent.type !== "composite") return false

  ctx.pushHistory("user", ctx.userText)
  const rawSteps = (intent.compositeSteps || []) as PlanStep[]
  const plan = normalizeExecutionPlan(rawSteps)
  const planValidation = validateExecutionPlan(plan)
  const steps = plan.steps

  if (!planValidation.ok) {
    const reply = ctx.lang === "zh"
      ? `喵…我把计划压缩检查了一遍，但它还是不合法：${planValidation.reason || "缺少必要参数"}。你再明确一下资产、金额和链，我就能重新规划。`
      : `Meow... I normalized the plan, but it's still invalid: ${planValidation.reason || "missing required parameters"}. Tell me the asset, amount, and chain more explicitly and I'll re-plan it.`
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  if (steps.length === 1 && steps[0]?.action === "deposit") {
    const result = await handlePlannedDeposit(steps[0], ctx)
    ctx.pushHistory("model", result.reply)
    ctx.sendResponse({
      status: "success",
      petState: "idle",
      reply: result.reply,
      transactionPayload: result.transactionPayload,
    })
    return true
  }

  if (steps.length < 2) {
    const reply = ctx.lang === "zh"
      ? "喵？这个操作只有一步，不需要组合执行呀～"
      : "Meow? This only has one step, no need for batch execution~"
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  if (!ctx.walletAddress) {
    const reply = ctx.lang === "zh"
      ? "喵～这是个多步动作，但你还没连钱包呢！本猫帮你弹出来～"
      : "Meow~ This is a multi-step operation, but you haven't connected a wallet! Let me open it for you~"
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
    return true
  }

  for (let i = 0; i < steps.length; i++) {
    const stepName = steps[i].action === "swap" ? "swap" : steps[i].action === "deposit" ? "deposit" : steps[i].action
    ctx.sendProgress(
      ctx.tabId,
      ctx.lang === "zh"
        ? `⚡ Step ${i + 1}/${steps.length}: 正在构建 ${stepName} 交易...`
        : `⚡ Step ${i + 1}/${steps.length}: Building ${stepName} transaction...`,
    )
  }

  const result = await CoinBuddyBrain.buildComposableBatch(steps, ctx.walletAddress, ctx.lang)
  if (!result) {
    const normalizationNote = plan.normalized && plan.reasons.length > 0
      ? (ctx.lang === "zh" ? `\n本猫已经先自动修正过计划：${plan.reasons.join("；")}` : `\nI already auto-corrected the plan first: ${plan.reasons.join("; ")}`)
      : ""
    const reply = (ctx.lang === "zh"
      ? "喵…组合交易构建失败了，可能某个步骤的代币对不可用。试试分开执行？"
      : "Meow... batch build failed. A token pair in one of the steps might not be available. Try executing them separately?") + normalizationNote
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  const batchFooter = ctx.lang === "zh"
    ? "\n\n🐾 ERC-8211 Composable Encoding | EIP-5792 Atomic Execution\n一键签名即可原子执行以上所有步骤！"
    : "\n\n🐾 ERC-8211 Composable Encoding | EIP-5792 Atomic Execution\nSign once to atomically execute all steps!"
  const reply = result.preview + batchFooter
  ctx.pushHistory("model", reply)
  ctx.sendResponse({
    status: "success",
    petState: "idle",
    reply,
    transactionPayload: {
      isBatch: true,
      calls: result.calls,
      chainId: steps[0]?.params?.chainId || 8453,
      erc8211: result.erc8211Data,
      display: result.display,
    },
  })
  return true
}
