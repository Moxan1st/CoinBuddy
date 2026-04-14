import type { ChatMessage } from "./pet-state.ts"

const SIGN_INTENT_RE = /(签名|确认签名|帮我签|让我签(?:名)?|please\s+sign(?:\s+this)?|sign(?:\s+it|\s+this)?|approve(?:\s+it|\s+this)?|confirm(?:\s+it|\s+this)?)/i
const ACCEPT_INTENT_RE = /(确认|可以|好的|好|行|行吧|ok|okay|yes|sure|走吧|来吧|同意)/i

export function isSignIntent(text: unknown): boolean {
  if (typeof text !== "string") return false
  const normalized = text.trim()
  if (!normalized) return false
  return SIGN_INTENT_RE.test(normalized)
}

export function isTxAcceptanceIntent(text: unknown): boolean {
  if (typeof text !== "string") return false
  const normalized = text.trim()
  if (!normalized) return false
  return ACCEPT_INTENT_RE.test(normalized)
}

export function getLatestPendingTxPayload(
  messages: ChatMessage[],
): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "bot") continue
    if (!msg.txPayload || msg.txCompleted) continue
    return msg.txPayload
  }
  return null
}

export function getReusablePendingTxPayloadForText(
  text: unknown,
  messages: ChatMessage[],
  pendingTxPayload?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const maybePayload = pendingTxPayload || getLatestPendingTxPayload(messages)
  if (!maybePayload) return null
  return isSignIntent(text) ? maybePayload : null
}
