import { useState, useRef, useEffect } from "react"
import type { ChatMessage } from "~lib/pet-state"
import { getUserLang, L } from "~lib/i18n"

interface ChatBubbleProps {
  messages: ChatMessage[]
  visible: boolean
  onSend: (text: string) => void
  onConfirmTx: (payload: Record<string, unknown>) => void
  onClose: () => void
}

export default function ChatBubble({
  messages, visible, onSend, onConfirmTx, onClose
}: ChatBubbleProps) {
  const [input, setInput] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const lang = getUserLang(messages)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  if (!visible) return null

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    onSend(trimmed)
    setInput("")
  }

  return (
    <div className="cb-chat-panel">
      {/* Header */}
      <div className="cb-chat-header">
        <span className="cb-chat-title">CoinBuddy</span>
        <button className="cb-chat-close" onClick={onClose}>✕</button>
      </div>

      {/* Bubble tail */}
      <div className="cb-bubble-tail" />

      {/* Messages */}
      <div className="cb-chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="cb-chat-empty">
            {L(lang, "喵～单击我说话，双击我打字！", "Meow~ Click me to talk, double-click to type!")}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`cb-msg cb-msg--${msg.role}`}>
            <div className="cb-msg-text" style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>
            {msg.role === "bot" && msg.txPayload && (
              msg.txCompleted ? (
                <button className="cb-msg-tx-btn" disabled>
                  {(msg.txPayload as any)?.isBatch
                    ? `✓ ${(msg.txPayload as any)?.calls?.length || 2} Steps Completed`
                    : "✓ Transaction Submitted"}
                </button>
              ) : (
                <button
                  className="cb-msg-tx-btn"
                  onClick={() => onConfirmTx(msg.txPayload!)}>
                  {(msg.txPayload as any)?.isBatch
                    ? `Confirm ${(msg.txPayload as any)?.calls?.length || 2} Steps & Sign`
                    : "Confirm & Sign"}
                </button>
              )
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="cb-chat-input-row">
        <input
          className="cb-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={L(lang, "跟 CoinBuddy 聊天...", "Chat with CoinBuddy...")}
        />
        <button className="cb-chat-send" onClick={handleSubmit}>
          Send
        </button>
      </div>
    </div>
  )
}
