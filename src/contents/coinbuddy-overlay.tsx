import type { PlasmoCSConfig, PlasmoGetShadowHostId, PlasmoGetStyle } from "plasmo"
import { useState, useEffect, useCallback, useRef } from "react"
import confetti from "canvas-confetti"

import PetAvatar from "~components/PetAvatar"
import ChatBubble from "~components/ChatBubble"
import WalletExecutor from "~components/WalletExecutor"
import { startSniffer } from "~lib/sniffer"
import type { PetState, ChatMessage } from "~lib/pet-state"
import { COINBUDDY_STYLES } from "~components/styles"
import { getUserLang, L } from "~lib/i18n"

// Plasmo content script config - inject on all pages
export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false
}

// Give our shadow host a unique ID
export const getShadowHostId: PlasmoGetShadowHostId = () => "coinbuddy-host"

// Inject styles into shadow DOM
export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = COINBUDDY_STYLES
  return style
}

/** Fire confetti burst at the pet's screen position */
function fireCelebration() {
  const el = document.getElementById("coinbuddy-host")
  if (!el) return
  const rect = el.getBoundingClientRect()
  const x = (rect.left + rect.width / 2) / window.innerWidth
  const y = (rect.top + rect.height / 2) / window.innerHeight

  confetti({
    particleCount: 80,
    spread: 70,
    origin: { x, y },
    colors: ["#FFD700", "#FFA500", "#FFEC8B", "#7c3aed"],
    shapes: ["circle", "square"],
    gravity: 0.8,
    scalar: 1.2
  })
  setTimeout(() => {
    confetti({
      particleCount: 40,
      spread: 100,
      origin: { x, y: y - 0.05 },
      colors: ["#10b981", "#6d28d9", "#FFD700"]
    })
  }, 200)
}

/** Outer shell: provides WagmiProvider + QueryClient context */
function CoinBuddyApp() {
  return <CoinBuddyInner />
}

/** Inner component */
function CoinBuddyInner() {
  // Wallet state from chrome.storage (synced by popup)
  const [walletAddress, setWalletAddress] = useState<string | undefined>()
  const [petState, setPetState] = useState<PetState>("idle")
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [petPos, setPetPos] = useState<{ right: number; bottom: number }>({ right: 24, bottom: 24 })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Read wallet from chrome.storage and listen for changes
  useEffect(() => {
    chrome.storage.local.get("coinbuddy_wallet", (data) => {
      if (data.coinbuddy_wallet) setWalletAddress(data.coinbuddy_wallet)
    })

    const listener = (changes: any) => {
      if (changes.coinbuddy_wallet) {
        setWalletAddress(changes.coinbuddy_wallet.newValue || undefined)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  // Auto-revert alert/done states
  useEffect(() => {
    if (petState === "done") {
      fireCelebration()
      const t = setTimeout(() => setPetState("idle"), 4000)
      return () => clearTimeout(t)
    }
    if (petState === "alert") {
      const t = setTimeout(() => {
        if (!chatOpen) setPetState("idle")
      }, 8000)
      return () => clearTimeout(t)
    }
  }, [petState, chatOpen])

  // Initialize DOM sniffer
  useEffect(() => {
    const cleanup = startSniffer((keywords, contextText) => {
      chrome.runtime.sendMessage(
        { action: "SNIFF_MATCH", payload: { keywords, contextText } },
        (response) => {
          if (response?.status === "success") {
            setPetState("alert")
            if (response.suggestedReply) {
              setMessages((prev) => [...prev, { role: "bot", text: response.suggestedReply }])
              setChatOpen(true)
            }
          }
        }
      )
      setPetState("alert")
    })
    return cleanup
  }, [])

  // Listen for messages from background
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg.action === "PET_STATE") {
        setPetState(msg.state)
      }
      if (msg.action === "BOT_REPLY") {
        setMessages((prev) => [
          ...prev,
          { role: "bot", text: msg.reply, txPayload: msg.txPayload }
        ])
        setChatOpen(true)
        if (msg.txPayload) setPetState("idle")
      }
      // 实时进度反馈：替换最后一条 "思考中" 消息或追加进度
      if (msg.action === "PROGRESS") {
        setMessages((prev) => {
          const updated = [...prev]
          // 查找最后一条进度消息（以特定 emoji 开头的 bot 消息）
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "bot" && /^🤔/.test(updated[i].text)) {
              updated[i] = { role: "bot", text: msg.text }
              return updated
            }
            if (updated[i].role === "bot" && /^[🔍📊🔎💼🔗🏛️🪙💰🏦✍️🔧⚡🔄]/.test(updated[i].text)) {
              updated[i] = { role: "bot", text: msg.text }
              return updated
            }
          }
          // 没找到现有进度消息，追加一条
          return [...prev, { role: "bot", text: msg.text }]
        })
        setChatOpen(true)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  // Send recorded audio: Step 1 transcribe → show text → Step 2 ask AI
  const sendAudioToGemini = useCallback((blob: Blob) => {
    const lang = getUserLang(messages)
    setPetState("thinking")
    setMessages((prev) => [...prev, { role: "user", text: L(lang, "🎤 识别中...", "🎤 Listening...") }])
    setChatOpen(true)

    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(",")[1]
      const mime = dataUrl.split(";base64,")[0].split(":")[1]

      // Step 1: 语音转文字
      chrome.runtime.sendMessage(
        { action: "VOICE_TRANSCRIBE", payload: { audioBase64: base64, mimeType: mime } },
        (transcribeRes) => {
          const transcript = transcribeRes?.transcript || ""

          if (!transcript) {
            // 识别失败
            setMessages((prev) => {
              const updated = [...prev]
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].role === "user" && /^🎤/.test(updated[i].text)) {
                  updated[i] = { role: "user", text: L(lang, "🎤 [没听清]", "🎤 [unclear]") }
                  break
                }
              }
              return updated
            })
            setPetState("idle")
            setMessages((prev) => [...prev, { role: "bot", text: L(lang, "喵…没听清你说什么，再说一遍？", "Meow... I didn't catch that, could you say it again?") }])
            return
          }

          // 显示识别结果 + 思考中
          setMessages((prev) => {
            const updated = [...prev]
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === "user" && /^🎤/.test(updated[i].text)) {
                updated[i] = { role: "user", text: transcript }
                break
              }
            }
            return [...updated, { role: "bot", text: L(lang, "🤔 思考中...", "🤔 Thinking...") }]
          })

          // Step 2: 用文字走正常对话流程
          chrome.runtime.sendMessage(
            { action: "USER_ASK", payload: { text: transcript, walletAddress } },
            (response) => {
              setMessages((prev) => {
                const updated = [...prev]
                for (let i = updated.length - 1; i >= 0; i--) {
                  if (updated[i].role === "bot" && (
                    /^🤔/.test(updated[i].text) ||
                    /^[🔍📊🔎💼🔗🏛️🪙💰🏦✍️🔧⚡🔄]/.test(updated[i].text)
                  )) {
                    if (response?.status === "success") {
                      updated[i] = { role: "bot", text: response.reply, txPayload: response.transactionPayload }
                    } else {
                      updated[i] = { role: "bot", text: L(lang, "喵…出了点小问题，再试一次？", "Meow... Something went wrong, try again?") }
                    }
                    break
                  }
                }
                return updated
              })
              setPetState("idle")
              if (response?.openWallet) {
                chrome.runtime.sendMessage({ action: "OPEN_POPUP" })
              }
            }
          )
        }
      )
    }
    reader.readAsDataURL(blob)
  }, [walletAddress, messages])

  // Voice input: directly use MediaRecorder in content script
  const handleVoiceInput = useCallback(async () => {
    // Stop recording
    if (isRecording && recorderRef.current) {
      recorderRef.current.stop()
      return
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"

      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setIsRecording(false)
        recorderRef.current = null

        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          chunksRef.current = []
          sendAudioToGemini(blob)
        }
      }

      recorder.start()
      setIsRecording(true)
    } catch (err: any) {
      console.error("[CoinBuddy] Mic error:", err)
      const lang = getUserLang(messages)
      setIsRecording(false)
      setChatOpen(true)
      setMessages((prev) => [...prev, {
        role: "bot",
        text: err.name === "NotAllowedError"
          ? L(lang, "喵～需要麦克风权限才能语音输入哦！请在浏览器地址栏左边允许麦克风。", "Meow~ I need microphone permission for voice input! Please allow it in the browser address bar.")
          : L(lang, "喵～录音出了问题，双击我用键盘聊吧！", "Meow~ Recording had an issue, double-click me to type instead!")
      }])
    }
  }, [isRecording, sendAudioToGemini, messages])

  // Drag pet
  const handleDragMove = useCallback((dx: number, dy: number) => {
    setPetPos((prev) => ({
      right: Math.max(0, Math.min(window.innerWidth - 100, prev.right - dx)),
      bottom: Math.max(0, Math.min(window.innerHeight - 100, prev.bottom - dy))
    }))
  }, [])

  // Double-click pet: toggle chat
  const handleToggleChat = useCallback(() => {
    setChatOpen((prev) => !prev)
    if (petState === "alert") setPetState("idle")
  }, [petState])

  const handleSend = useCallback((text: string) => {
    const lang = getUserLang([...messages, { role: "user", text }])
    setMessages((prev) => [...prev, { role: "user", text }, { role: "bot", text: L(lang, "🤔 思考中...", "🤔 Thinking...") }])
    setPetState("thinking")

    chrome.runtime.sendMessage(
      { action: "USER_ASK", payload: { text, walletAddress } },
      (response) => {
        // 替换进度消息为最终回复
        setMessages((prev) => {
          const updated = [...prev]
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "bot" && (
              /^🤔/.test(updated[i].text) ||
              /^[🔍📊🔎💼🔗🏛️🪙💰🏦✍️🔧⚡🔄]/.test(updated[i].text)
            )) {
              if (response?.status === "success") {
                updated[i] = { role: "bot", text: response.reply, txPayload: response.transactionPayload }
              } else {
                updated[i] = { role: "bot", text: L(lang, "喵…出了点小问题，再试一次？", "Meow... Something went wrong, try again?") }
              }
              return updated
            }
          }
          if (response?.status === "success") {
            return [...prev, { role: "bot", text: response.reply, txPayload: response.transactionPayload }]
          }
          return [...prev, { role: "bot", text: L(lang, "喵…出了点小问题，再试一次？", "Meow... Something went wrong, try again?") }]
        })
        setPetState("idle")
        if (response?.openWallet) {
          chrome.runtime.sendMessage({ action: "OPEN_POPUP" })
        }
      }
    )
  }, [walletAddress, messages])

  const handleConfirmTx = useCallback((payload: Record<string, unknown>) => {
    const lang = getUserLang(messages)
    if (!walletAddress) {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: L(lang, "喵～你还没连接钱包呢！先帮你打开钱包连接窗口～", "Meow~ You haven't connected a wallet! Let me open it for you~") }
      ])
      chrome.runtime.sendMessage({ action: "OPEN_POPUP" })
      return
    }
    setPetState("thinking")
    setMessages((prev) => [
      ...prev,
      { role: "bot", text: L(lang, "正在准备交易…请在钱包中确认～", "Preparing transaction... Please confirm in your wallet~") }
    ])
    window.dispatchEvent(
      new CustomEvent("coinbuddy:execute-tx", { detail: payload })
    )
  }, [walletAddress, messages])

  // Listen for tx completion
  useEffect(() => {
    const onTxDone = ((e: CustomEvent) => {
      const lang = getUserLang(messages)
      if (e.detail.success) {
        setPetState("done")
        setMessages((prev) => {
          const updated = [...prev]
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].txPayload && !updated[i].txCompleted) {
              updated[i] = { ...updated[i], txCompleted: true }
              break
            }
          }
          return [...updated, {
            role: "bot",
            text: L(lang, `交易确认啦！Hash: ${e.detail.hash?.slice(0, 10)}...`, `Transaction confirmed! Hash: ${e.detail.hash?.slice(0, 10)}...`)
          }]
        })
      } else {
        setPetState("idle")
        setMessages((prev) => {
          const updated = [...prev]
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].txPayload && !updated[i].txCompleted) {
              updated[i] = { ...updated[i], txCompleted: true }
              break
            }
          }
          return [...updated, {
            role: "bot",
            text: L(lang, `交易失败了：${e.detail.error}`, `Transaction failed: ${e.detail.error}`)
          }]
        })
      }
    }) as EventListener
    window.addEventListener("coinbuddy:tx-result", onTxDone)
    return () => window.removeEventListener("coinbuddy:tx-result", onTxDone)
  }, [messages])

  return (
    <div className="cb-root" style={{ right: petPos.right, bottom: petPos.bottom }}>
      <ChatBubble
        messages={messages}
        visible={chatOpen}
        onSend={handleSend}
        onConfirmTx={handleConfirmTx}
        onClose={() => setChatOpen(false)}
      />
      <PetAvatar
        state={isRecording ? "thinking" : petState}
        onSingleClick={handleVoiceInput}
        onDoubleClick={handleToggleChat}
        onDragMove={handleDragMove}
      />
      {isRecording && <div className="cb-recording-indicator">{L(getUserLang(messages), "🎤 听你说...", "🎤 Listening...")}</div>}
      <WalletExecutor />
    </div>
  )
}

export default CoinBuddyApp
