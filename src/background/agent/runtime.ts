import type { ChatMessage } from "../llm-client.ts"
import { generateText } from "../llm-client.ts"
import { createLogger } from "../../lib/logger.ts"
import type { HandlerContext } from "../handlers/types.ts"
import { getAvailableTools, getTool } from "./tool-registry.ts"
import {
  clearPendingAgentSession,
  createAgentRuntimeSession,
  getPendingAgentSession,
  setPendingAgentSession,
  type AgentRuntimeSession,
} from "./state.ts"
import { buildAgentPrompt, parseAgentDecision, type AgentDecision, type AgentToolDescriptor } from "./prompts.ts"
import type { AgentTool, ToolResult } from "./types.ts"

const logger = createLogger("AgentRuntime")

export interface AgentRuntimeDependencies {
  callModel?: (prompt: string) => Promise<string>
  toolRegistry?: {
    getTool: (name: string) => AgentTool | undefined
    listTools: () => AgentToolDescriptor[]
  }
  maxSteps?: number
}

function buildDefaultToolRegistry(): AgentRuntimeDependencies["toolRegistry"] {
  return {
    getTool,
    listTools: () => getAvailableTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      requiresConfirm: tool.safety.requiresConfirm === true,
      inputSchema: tool.inputSchema,
    })),
  }
}

function stringifyObservation(result: ToolResult): string {
  try {
    return JSON.stringify(result)
  } catch {
    return String(result.ok)
  }
}

function resolveReferenceValue(value: unknown, completedSteps: Map<string, ToolResult>): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\$(\w+)\.(\w+)$/)
    if (match) {
      return completedSteps.get(match[1])?.data?.[match[2]]
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveReferenceValue(item, completedSteps))
  }

  if (typeof value === "object" && value !== null) {
    const resolved: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      resolved[key] = resolveReferenceValue(nested, completedSteps)
    }
    return resolved
  }

  return value
}

function resolveArgs(args: Record<string, unknown>, completedSteps: Map<string, ToolResult>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, resolveReferenceValue(value, completedSteps)]),
  )
}

function enrichArgsFromPendingDraft(
  toolName: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
): Record<string, unknown> {
  const draft = ctx.pendingDepositDraft
  const investParams = draft.investParams
  const selectedVault = draft.selectedVault || (draft.vaultChoices.length === 1 ? draft.vaultChoices[0] : null)
  const enriched = { ...args }

  if (toolName === "build_swap") {
    if (enriched.chainId === undefined && investParams?.fromChain) {
      enriched.chainId = investParams.fromChain
    }
    if (enriched.chainId === undefined && selectedVault?.chainId) {
      enriched.chainId = selectedVault.chainId
    }
    if (enriched.fromToken === undefined && investParams?.searchAsset) {
      enriched.fromToken = investParams.searchAsset
    }
    if (enriched.toToken === undefined && Array.isArray(selectedVault?.underlyingTokens) && typeof selectedVault.underlyingTokens[0]?.symbol === "string") {
      enriched.toToken = selectedVault.underlyingTokens[0].symbol
    }
    if (enriched.rawAmount === undefined && investParams?.amount) {
      /* removed pollution */
    }
    if (enriched.amount === undefined && investParams?.amount) {
      enriched.amount = investParams.amount
    }
    if (enriched.amountDecimals === undefined && investParams?.amountDecimals) {
      enriched.amountDecimals = investParams.amountDecimals
    }
    return enriched
  }

  if (toolName !== "build_deposit") return args

  if (enriched.fromChain === undefined && investParams?.fromChain) {
    enriched.fromChain = investParams.fromChain
  }

  if (enriched.amount === undefined && investParams?.amount) {
    enriched.amount = investParams.amount
  }
  if (enriched.amountDecimals === undefined && investParams?.amountDecimals) {
    enriched.amountDecimals = investParams.amountDecimals
  }

  if (enriched.amount === undefined && investParams?.amount) {
    enriched.amount = investParams.amount
  }

  if (enriched.amountDecimals === undefined && investParams?.amountDecimals) {
    enriched.amountDecimals = investParams.amountDecimals
  }

  if (enriched.vault === undefined && selectedVault) {
    enriched.vault = selectedVault
  }

  if (enriched.vaultAddress === undefined && selectedVault?.address) {
    enriched.vaultAddress = selectedVault.address
  }

  if (enriched.vaultChainId === undefined && selectedVault?.chainId) {
    enriched.vaultChainId = selectedVault.chainId
  }

  return enriched
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isVaultLike(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.address === "string" && typeof value.chainId === "number"
}

function extractVaultCandidateFromResult(result: ToolResult): Record<string, unknown> | null {
  if (!result.ok || !isRecord(result.data)) return null

  const data = result.data as Record<string, unknown>
  const candidates = [data.vault, data.bestVault, data.selectedVault]
  for (const candidate of candidates) {
    if (isVaultLike(candidate)) return candidate
  }

  if (Array.isArray(data.vaults)) {
    for (const candidate of data.vaults) {
      if (isVaultLike(candidate)) return candidate
    }
  }

  return null
}

function extractLatestVaultCandidate(completedSteps: Map<string, ToolResult>): Record<string, unknown> | null {
  const entries = Array.from(completedSteps.values()).reverse()
  for (const result of entries) {
    const candidate = extractVaultCandidateFromResult(result)
    if (candidate) return candidate
  }
  return null
}

function extractAmountFromText(text: string): string | null {
  const match = text.match(/(\d+(?:\.\d+)?)/)
  return match?.[1] ?? null
}

function extractAssetFromText(text: string): string | null {
  const match = text.match(/\b(USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i)
  return match?.[1]?.toUpperCase() ?? null
}

function resolveKnownTokenDecimals(symbol: string | null | undefined): number | null {
  switch ((symbol || "").toUpperCase()) {
    case "USDC":
    case "USDT":
    case "DAI":
    case "USDBC":
      return 6
    case "ETH":
    case "WETH":
      return 18
    case "WBTC":
    case "CBBTC":
    case "BTC":
      return 8
    default:
      return null
  }
}

function decimalAmountToRawAmount(amount: string, decimals: number): string | null {
  const match = amount.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return null

  const whole = match[1]
  const fraction = (match[2] || "").padEnd(decimals, "0").slice(0, Math.max(0, decimals))
  const raw = `${whole}${fraction}`.replace(/^0+(?=\d)/, "")
  return raw.length > 0 ? raw : "0"
}

function hydrateBuildDepositArgs(
  session: AgentRuntimeSession,
  toolName: string,
  toolArgs: Record<string, unknown>,
  sourceUserText?: string,
): Record<string, unknown> {
  if (toolName !== "build_deposit") return { ...toolArgs }

  const resolved = { ...toolArgs }
  const vault = isVaultLike(resolved.vault)
    ? resolved.vault
    : extractLatestVaultCandidate(session.completedSteps)

  if (vault) {
    if (!isVaultLike(resolved.vault)) resolved.vault = vault
    if (!resolved.vaultAddress && typeof vault.address === "string") resolved.vaultAddress = vault.address
    if (!resolved.vaultChainId && typeof vault.chainId === "number") resolved.vaultChainId = vault.chainId
    if (!resolved.asset && Array.isArray(vault.underlyingTokens) && typeof vault.underlyingTokens[0]?.symbol === "string") {
      resolved.asset = vault.underlyingTokens[0].symbol
    }
  }

  if (!resolved.asset && sourceUserText) {
    const assetFromText = extractAssetFromText(sourceUserText)
    if (assetFromText) resolved.asset = assetFromText
  }

  if (!resolved.fromChain && typeof resolved.vaultChainId === "number") {
    resolved.fromChain = resolved.vaultChainId
  }
  if (!resolved.fromChain && isVaultLike(vault)) {
    resolved.fromChain = vault.chainId
  }

  if (!resolved.rawAmount) {
    const amountValue = typeof resolved.amount === "number"
      ? String(resolved.amount)
      : typeof resolved.amount === "string"
        ? resolved.amount
        : null
    const amountDecimalsValue = typeof resolved.amountDecimals === "number"
      ? resolved.amountDecimals
      : typeof resolved.amountDecimals === "string" && resolved.amountDecimals.trim()
        ? Number(resolved.amountDecimals)
        : undefined
    const sourceAmount = amountValue || (sourceUserText ? extractAmountFromText(sourceUserText) : null)
    const vaultDecimals = isVaultLike(vault)
      && Array.isArray(vault.underlyingTokens)
      && typeof vault.underlyingTokens[0]?.decimals === "number"
        ? vault.underlyingTokens[0].decimals
        : null
    const fallbackDecimals = resolveKnownTokenDecimals(
      typeof resolved.asset === "string" ? resolved.asset : sourceUserText ? extractAssetFromText(sourceUserText) : null,
    )

    if (sourceAmount) {
      if (amountDecimalsValue !== undefined && Number.isFinite(amountDecimalsValue)) {
        resolved.rawAmount = `${sourceAmount}${"0".repeat(Math.max(0, amountDecimalsValue))}`
      } else if (vaultDecimals !== null || fallbackDecimals !== null) {
        const rawAmount = decimalAmountToRawAmount(sourceAmount, vaultDecimals ?? fallbackDecimals ?? 0)
        if (rawAmount) resolved.rawAmount = rawAmount
      }
    }
  }

  return resolved
}

function resolvePendingToolArgs(
  session: AgentRuntimeSession,
  toolName: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
  sourceUserText?: string,
): Record<string, unknown> {
  return enrichArgsFromPendingDraft(
    toolName,
    hydrateBuildDepositArgs(session, toolName, args, sourceUserText),
    ctx,
  )
}

function isConfirmRequired(tool: AgentTool): boolean {
  return tool.safety.requiresConfirm === true
}

function extractTxPayload(result: ToolResult): Record<string, unknown> | null {
  if (!result.ok || !result.data || typeof result.data !== "object" || !("txPayload" in result.data)) {
    return null
  }

  const txPayload = result.data.txPayload
  return txPayload && typeof txPayload === "object" ? txPayload as Record<string, unknown> : null
}

function storePendingToolCall(
  session: AgentRuntimeSession,
  toolName: string,
  args: Record<string, unknown>,
  sourceUserText?: string,
): void {
  session.pendingToolCall = {
    stepId: `step_${session.nextStepIndex}`,
    toolName,
    args,
    sourceUserText,
  }
}

function previewForToolCall(toolName: string, args: Record<string, unknown>, lang: "zh" | "en"): string {
  const line = lang === "zh" ? "本猫要先确认一下" : "I need your confirmation first"
  switch (toolName) {
    case "build_deposit":
      return lang === "zh"
        ? `喵～${line}，这一步会构建真实存款交易：${String(args.amount || args.rawAmount || "?")} ${String(args.asset || "asset")}。回复「确认」继续。`
        : `Meow~ ${line}. This step will build a real deposit transaction for ${String(args.amount || args.rawAmount || "?")} ${String(args.asset || "asset")}. Reply "confirm" to continue.`
    case "build_swap":
      return lang === "zh"
        ? `喵～${line}，这一步会构建真实兑换交易：${String(args.fromToken || "?")} -> ${String(args.toToken || "?")}。回复「确认」继续。`
        : `Meow~ ${line}. This step will build a real swap transaction: ${String(args.fromToken || "?")} -> ${String(args.toToken || "?")}. Reply "confirm" to continue.`
    case "build_bridge":
      return lang === "zh"
        ? `喵～${line}，这一步会构建真实跨链交易：${String(args.token || "?")} 从 ${String(args.fromChain || "?")} 到 ${String(args.toChain || "?")}。回复「确认」继续。`
        : `Meow~ ${line}. This step will build a real bridge transaction for ${String(args.token || "?")} from ${String(args.fromChain || "?")} to ${String(args.toChain || "?")}. Reply "confirm" to continue.`
    case "build_withdraw":
      return lang === "zh"
        ? `喵～${line}，这一步会构建真实取款交易。回复「确认」继续。`
        : `Meow~ ${line}. This step will build a real withdraw transaction. Reply "confirm" to continue.`
    default:
      return lang === "zh"
        ? `喵～${line}，这一步需要你确认后才能继续。回复「确认」继续。`
        : `Meow~ ${line}. This step needs your confirmation before continuing. Reply "confirm" to continue.`
  }
}

function fallbackErrorReply(lang: "zh" | "en", message: string): string {
  return lang === "zh"
    ? `喵…ReAct 运行失败：${message}`
    : `Meow... ReAct runtime failed: ${message}`
}

async function callModel(prompt: string, deps: AgentRuntimeDependencies): Promise<string> {
  if (deps.callModel) return deps.callModel(prompt)
  return await generateText([{ role: "user", parts: [{ text: prompt }] }], true)
}

async function executeToolCall(
  session: AgentRuntimeSession,
  decision: Extract<AgentDecision, { type: "tool_call" }>,
  ctx: HandlerContext,
  deps: AgentRuntimeDependencies,
): Promise<{ handled: boolean; reply?: string }> {
  const registry = deps.toolRegistry ?? buildDefaultToolRegistry()
  const tool = registry.getTool(decision.tool)

  if (!tool) {
    clearPendingAgentSession()
    const reply = ctx.lang === "zh"
      ? `喵…我找不到这个工具：${decision.tool}`
      : `Meow... I can't find that tool: ${decision.tool}`
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return { handled: true, reply }
  }

  const resolvedArgs = enrichArgsFromPendingDraft(
    tool.name,
    resolveArgs(decision.args || {}, session.completedSteps),
    ctx,
  )
  const stepId = `step_${session.nextStepIndex}`

  if (isConfirmRequired(tool)) {
    const hydratedArgs = resolvePendingToolArgs(session, tool.name, resolvedArgs, ctx, session.sourceUserText)
    session.pendingToolCall = {
      stepId,
      toolName: tool.name,
      args: hydratedArgs,
      sourceUserText: session.sourceUserText,
    }
    session.scratchpad.push(`assistant: ${JSON.stringify({ type: "tool_call", tool: tool.name, args: hydratedArgs })}`)
    setPendingAgentSession(session)

    const reply = previewForToolCall(tool.name, hydratedArgs, session.lang)
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return { handled: true, reply }
  }

  session.nextStepIndex += 1
  session.executedToolCount += 1
  session.scratchpad.push(`assistant: ${JSON.stringify({ type: "tool_call", tool: tool.name, args: resolvedArgs })}`)

  const result = await tool.run(resolvedArgs, {
    lang: ctx.lang,
    userText: ctx.userText,
    walletAddress: ctx.walletAddress,
    tabId: ctx.tabId,
  })
  session.completedSteps.set(stepId, result)
  session.scratchpad.push(`observation ${stepId}: ${stringifyObservation(result)}`)

  const txPayload = extractTxPayload(result)
  if (txPayload) session.latestTxPayload = txPayload

  if (!result.ok) {
    clearPendingAgentSession()
    const reply = fallbackErrorReply(session.lang, result.error?.message || result.error?.code || "tool_failed")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return { handled: true, reply }
  }

  return { handled: false }
}

async function executeStoredPendingToolCall(
  session: AgentRuntimeSession,
  ctx: HandlerContext,
  deps: AgentRuntimeDependencies,
): Promise<boolean> {
  const registry = deps.toolRegistry ?? buildDefaultToolRegistry()

  if (!session.pendingToolCall) return false

  const pending = session.pendingToolCall
  session.pendingToolCall = null
  session.nextStepIndex = Math.max(session.nextStepIndex, Number(pending.stepId.replace(/^step_/, "")) + 1)
  session.executedToolCount += 1

  const tool = registry.getTool(pending.toolName)
  if (!tool) {
    clearPendingAgentSession()
    const reply = ctx.lang === "zh"
      ? `喵…我找不到这个工具：${pending.toolName}`
      : `Meow... I can't find that tool: ${pending.toolName}`
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  const resolvedArgs = resolvePendingToolArgs(
    session,
    pending.toolName,
    resolveArgs(pending.args || {}, session.completedSteps),
    ctx,
    pending.sourceUserText || session.sourceUserText,
  )
  pending.args = resolvedArgs
  const result = await tool.run(resolvedArgs, {
    lang: ctx.lang,
    userText: pending.sourceUserText || session.sourceUserText || ctx.userText,
    walletAddress: ctx.walletAddress,
    tabId: ctx.tabId,
  })
  session.completedSteps.set(pending.stepId, result)
  session.scratchpad.push(`observation ${pending.stepId}: ${stringifyObservation(result)}`)

  const txPayload = extractTxPayload(result)
  if (txPayload) session.latestTxPayload = txPayload

  if (!result.ok) {
    clearPendingAgentSession()
    const reply = fallbackErrorReply(session.lang, result.error?.message || result.error?.code || "tool_failed")
    ctx.pushHistory("model", reply)
    ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return true
  }

  return false
}

async function runSessionLoop(
  session: AgentRuntimeSession,
  ctx: HandlerContext,
  deps: AgentRuntimeDependencies,
): Promise<boolean> {
  const registry = deps.toolRegistry ?? buildDefaultToolRegistry()
  const maxSteps = deps.maxSteps ?? session.maxSteps ?? 6

  while (session.executedToolCount < maxSteps) {
    if (session.pendingToolCall) {
      const handledPending = await executeStoredPendingToolCall(session, ctx, deps)
      if (handledPending) return true

      if (session.executedToolCount >= maxSteps) {
        clearPendingAgentSession()
        const reply = session.lang === "zh"
          ? "喵…ReAct 步数用完了，但这个步骤已经执行完了。后续如果还要继续，你可以再发一句让我接着走。"
          : "Meow... the ReAct step budget is exhausted, but the pending step has been executed. Send another message if you want me to continue."
        ctx.pushHistory("model", reply)
        ctx.sendResponse({
          status: "success",
          petState: "idle",
          reply,
          transactionPayload: session.latestTxPayload,
        })
        return true
      }
    }

    const prompt = buildAgentPrompt({
      lang: session.lang,
      userText: session.userText,
      history: session.conversationHistory,
      scratchpad: session.scratchpad,
      tools: registry.listTools(),
      maxSteps,
      stepCount: session.executedToolCount,
    })

    const raw = await callModel(prompt, deps)
    const decision = parseAgentDecision(raw)

    if (!decision) {
      clearPendingAgentSession()
      const reply = fallbackErrorReply(session.lang, "could_not_parse_agent_response")
      ctx.pushHistory("model", reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return true
    }

    if (decision.type === "ask_user") {
      const hasPendingContinuation = !!decision.pendingToolCall?.tool
      if (hasPendingContinuation) {
        const registryForPending = deps.toolRegistry ?? buildDefaultToolRegistry()
        const pendingTool = registryForPending.getTool(decision.pendingToolCall.tool)
        if (!pendingTool) {
          clearPendingAgentSession()
          const reply = ctx.lang === "zh"
            ? `喵…我找不到这个工具：${decision.pendingToolCall.tool}`
            : `Meow... I can't find that tool: ${decision.pendingToolCall.tool}`
          ctx.pushHistory("model", reply)
          ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
          return true
        }

        const resolvedArgs = resolvePendingToolArgs(
          session,
          pendingTool.name,
          resolveArgs(decision.pendingToolCall.args || {}, session.completedSteps),
          ctx,
          session.sourceUserText,
        )
        storePendingToolCall(session, pendingTool.name, resolvedArgs, session.sourceUserText)
        session.scratchpad.push(`assistant: ${JSON.stringify({ type: decision.type, reply: decision.reply, keepSession: true, pendingToolCall: { tool: pendingTool.name, args: resolvedArgs } })}`)
        setPendingAgentSession(session)
        ctx.pushHistory("model", decision.reply)
        ctx.sendResponse({ status: "success", petState: "idle", reply: decision.reply, transactionPayload: null })
        return true
      }

      clearPendingAgentSession()
      ctx.pushHistory("model", decision.reply)
      ctx.sendResponse({ status: "success", petState: "idle", reply: decision.reply, transactionPayload: session.latestTxPayload })
      return true
    }

    if (decision.type === "final_answer") {
      const hasPendingContinuation = !!decision.pendingToolCall?.tool
      if (hasPendingContinuation) {
        const registryForPending = deps.toolRegistry ?? buildDefaultToolRegistry()
        const pendingTool = registryForPending.getTool(decision.pendingToolCall.tool)
        if (!pendingTool) {
          clearPendingAgentSession()
          const reply = ctx.lang === "zh"
            ? `喵…我找不到这个工具：${decision.pendingToolCall.tool}`
            : `Meow... I can't find that tool: ${decision.pendingToolCall.tool}`
          ctx.pushHistory("model", reply)
          ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
          return true
        }

        const resolvedArgs = resolvePendingToolArgs(
          session,
          pendingTool.name,
          resolveArgs(decision.pendingToolCall.args || {}, session.completedSteps),
          ctx,
          session.sourceUserText,
        )
        storePendingToolCall(session, pendingTool.name, resolvedArgs, session.sourceUserText)
        session.scratchpad.push(`assistant: ${JSON.stringify({ type: decision.type, reply: decision.reply, keepSession: true, pendingToolCall: { tool: pendingTool.name, args: resolvedArgs } })}`)
        setPendingAgentSession(session)
        ctx.pushHistory("model", decision.reply)
        ctx.sendResponse({
          status: "success",
          petState: "idle",
          reply: decision.reply,
          transactionPayload: null,
        })
        return true
      }

      clearPendingAgentSession()
      ctx.pushHistory("model", decision.reply)
      ctx.sendResponse({
        status: "success",
        petState: "idle",
        reply: decision.reply,
        transactionPayload: session.latestTxPayload,
      })
      return true
    }

    const stepResult = await executeToolCall(session, decision, ctx, deps)
    if (stepResult.handled) return true
  }

  clearPendingAgentSession()
  const reply = session.lang === "zh"
    ? "喵…ReAct 步数用完了，本猫先停在这里。你可以把需求拆小一点再试。"
    : "Meow... the ReAct step budget is exhausted, so I have to stop here. Try splitting the request into smaller parts."
  ctx.pushHistory("model", reply)
  ctx.sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
  return true
}

export async function runReActRuntime(
  input: {
    userText: string
    lang: "zh" | "en"
    conversationHistory: ChatMessage[]
    ctx: HandlerContext
  },
  deps: AgentRuntimeDependencies = {},
): Promise<boolean> {
  const session = createAgentRuntimeSession({
    lang: input.lang,
    userText: input.userText,
    conversationHistory: input.conversationHistory,
    maxSteps: deps.maxSteps ?? 6,
  })

  input.ctx.pushHistory("user", input.userText)
  const handled = await runSessionLoop(session, input.ctx, deps)
  if (!handled) {
    clearPendingAgentSession()
  }
  return handled
}

export async function resumePendingReActRuntime(
  input: {
    userText: string
    lang: "zh" | "en"
    conversationHistory: ChatMessage[]
    ctx: HandlerContext
  },
  deps: AgentRuntimeDependencies = {},
): Promise<boolean> {
  const session = getPendingAgentSession()
  if (!session) return false

  session.userText = input.userText
  session.lang = input.lang
  session.conversationHistory = [...input.conversationHistory]
  input.ctx.pushHistory("user", input.userText)
  return await runSessionLoop(session, input.ctx, deps)
}
