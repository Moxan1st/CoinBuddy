/**
 * CoinBuddy Pet State Machine
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  State        │ Sprite              │ Trigger                      │
 * ├───────────────┼─────────────────────┼──────────────────────────────┤
 * │  idle         │ 躺着                │ Default / timeout fallback   │
 * │  attentive    │ 玩平板              │ Input focus, sniff match     │
 * │  thinking     │ thinking-upright    │ AI processing user query     │
 * │  excited      │ 跳跃                │ Found result / opportunity   │
 * │  executing    │ 行走                │ TX submitted, pending        │
 * │  warning      │ alert-puffed        │ Risk detected, error         │
 * │  success      │ done-luckycat       │ TX confirmed                 │
 * │  waiting      │ 蜷缩睡觉            │ Timeout / no result yet      │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Auto-revert rules (handled in overlay):
 *   success  → idle    after 4s
 *   excited  → idle    after 5s
 *   warning  → idle    after 8s (if chat closed)
 *   waiting  → idle    after 12s
 */

export type PetState =
  | "idle"
  | "attentive"
  | "thinking"
  | "excited"
  | "executing"
  | "warning"
  | "success"
  | "waiting"

/** Auto-revert config: state → [target, delayMs] */
export const PET_AUTO_REVERT: Partial<Record<PetState, { to: PetState; delay: number }>> = {
  success:  { to: "idle", delay: 4000 },
  excited:  { to: "idle", delay: 5000 },
  warning:  { to: "idle", delay: 8000 },
  waiting:  { to: "idle", delay: 12000 },
}

/** Message source and lifecycle tracking */
export type MessageSource = "text" | "voice-preview" | "voice-committed" | "system"
export type MessageStatus = "draft" | "committed" | "handled"

export interface ChatMessage {
  role: "bot" | "user"
  text: string
  messageId?: string
  source?: MessageSource
  status?: MessageStatus
  txPayload?: Record<string, unknown> & { isBatch?: boolean; calls?: any[] }
  txCompleted?: boolean
}

/** Generate a unique message ID */
let _msgSeq = 0
export function generateMessageId(): string {
  return `msg_${Date.now()}_${++_msgSeq}`
}

/**
 * Input validation guard — must pass before any text reaches the agent.
 * Used in both frontend (commitAndSend) and background (handleUserAsk).
 */
const SYSTEM_PREFIXES = /^(🎤|🤔|🔍|📊|🔎|💼|🔗|🏛️|🪙|💰|🏦|✍️|🔧|⚡|🔄)/
export function isValidUserInput(text: unknown): text is string {
  if (typeof text !== "string") return false
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (SYSTEM_PREFIXES.test(trimmed)) return false
  return true
}
