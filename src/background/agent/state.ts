import type { ChatMessage } from "../llm-client.ts"
import type { ToolResult } from "./types.ts"

export interface AgentToolCall {
  stepId: string
  toolName: string
  args: Record<string, unknown>
  sourceUserText?: string
}

export interface AgentRuntimeSession {
  lang: "zh" | "en"
  userText: string
  sourceUserText: string
  conversationHistory: ChatMessage[]
  scratchpad: string[]
  completedSteps: Map<string, ToolResult>
  nextStepIndex: number
  executedToolCount: number
  maxSteps: number
  pendingToolCall: AgentToolCall | null
  latestTxPayload: Record<string, unknown> | null
  createdAt: number
}

let pendingAgentSession: AgentRuntimeSession | null = null

export function createAgentRuntimeSession(input: {
  lang: "zh" | "en"
  userText: string
  conversationHistory: ChatMessage[]
  maxSteps: number
}): AgentRuntimeSession {
  return {
    lang: input.lang,
    userText: input.userText,
    sourceUserText: input.userText,
    conversationHistory: [...input.conversationHistory],
    scratchpad: [],
    completedSteps: new Map<string, ToolResult>(),
    nextStepIndex: 1,
    executedToolCount: 0,
    maxSteps: input.maxSteps,
    pendingToolCall: null,
    latestTxPayload: null,
    createdAt: Date.now(),
  }
}

export function getPendingAgentSession(): AgentRuntimeSession | null {
  return pendingAgentSession
}

export function setPendingAgentSession(session: AgentRuntimeSession | null): void {
  pendingAgentSession = session
}

export function clearPendingAgentSession(): void {
  pendingAgentSession = null
}
