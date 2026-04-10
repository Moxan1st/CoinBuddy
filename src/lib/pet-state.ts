/** CoinBuddy pet animation states */
export type PetState = "idle" | "alert" | "thinking" | "done"

export interface ChatMessage {
  role: "bot" | "user"
  text: string
  txPayload?: Record<string, unknown>
}
