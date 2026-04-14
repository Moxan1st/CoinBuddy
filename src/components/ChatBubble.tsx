import { useState, useRef, useEffect } from "react"
import type { ChatMessage } from "~lib/pet-state"
import { getUserLang, L } from "~lib/i18n"

interface ChatBubbleProps {
  messages: ChatMessage[]
  visible: boolean
  onSend: (text: string) => void
  onConfirmTx: (payload: Record<string, unknown>) => void
  onClose: () => void
  /** Voice transcript preview — shown in input box, user must confirm to send */
  voicePreview?: string
  onClearVoicePreview?: () => void
  isTranscribing?: boolean
}

export default function ChatBubble({
  messages, visible, onSend, onConfirmTx, onClose,
  voicePreview, onClearVoicePreview, isTranscribing
}: ChatBubbleProps) {
  const [input, setInput] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const lang = getUserLang(messages)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  // When a voice preview arrives, put it into the input box (but do NOT send)
  useEffect(() => {
    if (voicePreview) {
      setInput(voicePreview)
    }
  }, [voicePreview])

  // When chat closes, clear draft input
  useEffect(() => {
    if (!visible) {
      setInput("")
    }
  }, [visible])

  if (!visible) return null

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    onSend(trimmed)
    setInput("")
    onClearVoicePreview?.()
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
    // If user edits the voice preview, it's now a text draft — clear voice flag
    if (voicePreview && e.target.value !== voicePreview) {
      onClearVoicePreview?.()
    }
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
                    ? L(lang, `✓ ${(msg.txPayload as any)?.calls?.length || 2} 步已完成`, `✓ ${(msg.txPayload as any)?.calls?.length || 2} Steps Completed`)
                    : L(lang, "✓ 交易已提交", "✓ Transaction Submitted")}
                </button>
              ) : (
                <button
                  className="cb-msg-tx-btn"
                  onClick={() => onConfirmTx(msg.txPayload!)}>
                  {(msg.txPayload as any)?.isBatch
                    ? L(lang, `确认 ${(msg.txPayload as any)?.calls?.length || 2} 步并签名`, `Confirm ${(msg.txPayload as any)?.calls?.length || 2} Steps & Sign`)
                    : L(lang, "确认并签名", "Confirm & Sign")}
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
          onChange={handleInputChange}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={
            isTranscribing
              ? L(lang, "✍️ 识别中...", "✍️ Transcribing...")
              : voicePreview
                ? L(lang, "按 Enter 发送，或编辑后发送", "Press Enter to send, or edit first")
                : L(lang, "跟 CoinBuddy 聊天...", "Chat with CoinBuddy...")
          }
          disabled={isTranscribing}
        />
        <button className="cb-chat-send" onClick={handleSubmit} disabled={isTranscribing}>
          {L(lang, "发送", "Send")}
        </button>
      </div>
    </div>
  )
}
