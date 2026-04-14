import type { ChatMessage } from "../llm-client.ts"
import type { JsonSchemaObject } from "./types.ts"

export interface AgentToolDescriptor {
  name: string
  description: string
  requiresConfirm?: boolean
  inputSchema?: JsonSchemaObject
}

export type AgentDecision =
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | {
      type: "final_answer"
      reply: string
      keepSession?: boolean
      pendingToolCall?: {
        tool: string
        args: Record<string, unknown>
      }
    }
  | {
      type: "ask_user"
      reply: string
      keepSession?: boolean
      pendingToolCall?: {
        tool: string
        args: Record<string, unknown>
      }
    }

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatHistory(history: ChatMessage[]): string {
  if (history.length === 0) return "(empty)"
  return history
    .map((msg, index) => `${index + 1}. ${msg.role}: ${msg.text}`)
    .join("\n")
}

function formatScratchpad(scratchpad: string[]): string {
  if (scratchpad.length === 0) return "(empty)"
  return scratchpad.map((entry, index) => `${index + 1}. ${entry}`).join("\n")
}

function formatTools(tools: AgentToolDescriptor[]): string {
  if (tools.length === 0) return "(none)"
  return tools
    .map((tool) => `- ${tool.name}${tool.requiresConfirm ? " (requires_confirm)" : ""}: ${tool.description}`)
    .join("\n")
}

export function buildAgentPrompt(input: {
  lang: "zh" | "en"
  userText: string
  history: ChatMessage[]
  scratchpad: string[]
  tools: AgentToolDescriptor[]
  maxSteps: number
  stepCount: number
}): string {
  const replyLang = input.lang === "zh" ? "Chinese" : "English"

  return [
    "You are CoinBuddy's ReAct runtime.",
    `Reply in ${replyLang}.`,
    "You must output STRICT JSON only. No markdown, no commentary, no code fences.",
    "Each turn must be exactly one of these shapes:",
    stringifyJson({ type: "tool_call", tool: "search_vaults", args: { chainIds: [8453], asset: "USDC" } }),
    stringifyJson({ type: "final_answer", reply: "...", keep_session: true, pending_tool_call: { tool: "build_deposit", args: { vaultAddress: "0x...", vaultChainId: 8453, fromChain: 8453, amount: "1", amountDecimals: "000000", asset: "USDC" } } }),
    stringifyJson({ type: "ask_user", reply: "...", keep_session: true, pending_tool_call: { tool: "build_deposit", args: { vaultAddress: "0x...", vaultChainId: 8453, fromChain: 8453, amount: "1", amountDecimals: "000000", asset: "USDC" } } }),
    "Rules:",
    "1. Use tool_call when you need to act.",
    "2. Use ask_user when the request is missing information or needs clarification.",
    "3. Use final_answer when you can answer the user directly.",
    "4. Only choose tools from the allowed tool list.",
    "5. One tool_call per turn. The runtime will execute the tool and feed the observation back to you.",
    "6. If a tool result suggests another step, continue with another tool_call on the next turn.",
    "7. Tool parameters may reference prior step outputs with the syntax $step_1.field.",
    `8. The maximum number of executed tool steps is ${input.maxSteps}. Current executed tool count is ${input.stepCount}.`,
    "9. If you already have enough information to recommend a concrete action and you want the user to confirm it, return final_answer or ask_user with keep_session=true and pending_tool_call set to the exact next tool and args. The runtime will preserve the session and execute that pending tool after the user says confirm.",
    "9a. For build_deposit, pending_tool_call must include fromChain, a vault reference (vault or vaultAddress + vaultChainId), and either rawAmount or amount + amountDecimals.",
    "9b. If the user wants to swap a token AND deposit it, DO NOT use build_swap. Use build_deposit directly and set the 'asset' parameter to the source token. The system will build a composable swap+deposit transaction automatically.",
    "10. If the last observation contains a successful txPayload (e.g. from build_deposit), the transaction is READY to sign. You MUST return final_answer WITHOUT pending_tool_call to trigger the wallet popup. DO NOT return pending_tool_call again for the same step.",
    "11. If you only need clarification that is not a simple confirm/continue, do not set pending_tool_call.",
    "",
    "User request:",
    input.userText,
    "",
    "Conversation history:",
    formatHistory(input.history),
    "",
    "Observed runtime scratchpad:",
    formatScratchpad(input.scratchpad),
    "",
    "Allowed tools:",
    formatTools(input.tools),
  ].join("\n")
}

export function parseAgentDecision(raw: string): AgentDecision | null {
  const trimmed = raw.trim()
  const candidates = [trimmed]

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1].trim())

  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (!parsed || typeof parsed !== "object") continue

      const type = typeof (parsed as any).type === "string" ? (parsed as any).type : ""
      if (type === "tool_call") {
        const tool = typeof (parsed as any).tool === "string"
          ? (parsed as any).tool
          : typeof (parsed as any).toolName === "string"
            ? (parsed as any).toolName
            : ""
        const args = (parsed as any).args && typeof (parsed as any).args === "object"
          ? (parsed as any).args
          : {}
        if (!tool) return null
        return { type: "tool_call", tool, args: args as Record<string, unknown> }
      }

      if (type === "final_answer" || type === "ask_user") {
        const reply = typeof (parsed as any).reply === "string"
          ? (parsed as any).reply
          : typeof (parsed as any).chatReply === "string"
            ? (parsed as any).chatReply
            : typeof (parsed as any).text === "string"
              ? (parsed as any).text
              : ""
        if (!reply) return null
        const keepSession = (parsed as any).keep_session === true || (parsed as any).keepSession === true
        const pendingToolCallRaw = (parsed as any).pending_tool_call ?? (parsed as any).pendingToolCall
        const pendingToolCall = pendingToolCallRaw && typeof pendingToolCallRaw === "object"
          ? {
              tool: typeof (pendingToolCallRaw as any).tool === "string"
                ? (pendingToolCallRaw as any).tool
                : typeof (pendingToolCallRaw as any).toolName === "string"
                  ? (pendingToolCallRaw as any).toolName
                  : "",
              args: (pendingToolCallRaw as any).args && typeof (pendingToolCallRaw as any).args === "object"
                ? (pendingToolCallRaw as any).args
                : {},
            }
          : undefined
        const decision: AgentDecision = { type, reply }
        if (keepSession) (decision as any).keepSession = true
        if (pendingToolCall?.tool) (decision as any).pendingToolCall = pendingToolCall
        return decision
      }
    } catch {
      continue
    }
  }

  return null
}
