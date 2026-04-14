import type { PlasmoCSConfig, PlasmoGetShadowHostId, PlasmoGetStyle } from "plasmo"
import { useState, useEffect, useCallback, useRef } from "react"
import confetti from "canvas-confetti"

import PetAvatar from "~components/PetAvatar"
import ChatBubble from "~components/ChatBubble"
import WalletExecutor from "~components/WalletExecutor"
import { startSniffer } from "~lib/sniffer"
import type { PetState, ChatMessage } from "~lib/pet-state"
import { PET_AUTO_REVERT, generateMessageId, isValidUserInput } from "~lib/pet-state"
import { getReusablePendingTxPayloadForText, isSignIntent, isTxAcceptanceIntent } from "~lib/signing-intent"
import { COINBUDDY_STYLES } from "~components/styles"
import { getUserLang, L } from "~lib/i18n"

// Plasmo content script config - inject on all pages
export const config: PlasmoCSConfig = {
  matches: ["https://*/*"],
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

/** Outer shell */
function CoinBuddyApp() {
  return <CoinBuddyInner />
}

/** Inner component */
function CoinBuddyInner() {
  const VOICE_RMS_THRESHOLD = 0.02
  const VOICE_MIN_SPEECH_MS = 450
  const VOICE_MAX_INITIAL_SILENCE_MS = 2500
  const VOICE_END_SILENCE_MS = 1400

  // ── Core state ──
  const [walletAddress, setWalletAddress] = useState<string | undefined>()
  const [petState, setPetState] = useState<PetState>("idle")
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [petPos, setPetPos] = useState<{ right: number; bottom: number }>({ right: 24, bottom: 24 })

  // ── Voice state (two-phase: record → preview → user confirms) ──
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [voicePreview, setVoicePreview] = useState("")  // transcript waiting for user confirmation
  const [pendingTxPayload, setPendingTxPayload] = useState<Record<string, unknown> | null>(null)
  const pendingTxPayloadRef = useRef<Record<string, unknown> | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const monitorFrameRef = useRef<number | null>(null)
  const recordingStartedAtRef = useRef(0)
  const lastMonitorAtRef = useRef(0)
  const lastSpeechAtRef = useRef(0)
  const speechAccumulatedMsRef = useRef(0)
  const stopReasonRef = useRef<"manual" | "silence" | "no_speech">("manual")

  // ── Anti-duplicate: track handled message IDs ──
  const handledIds = useRef(new Set<string>())

  // ── Unmount guard: prevent async callbacks from setting state after teardown ──
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Ref to track chatOpen for sniffer suppression ──
  const chatOpenRef = useRef(chatOpen)
  useEffect(() => { chatOpenRef.current = chatOpen }, [chatOpen])

  const cleanupVoiceMonitor = useCallback(() => {
    if (monitorFrameRef.current !== null) {
      cancelAnimationFrame(monitorFrameRef.current)
      monitorFrameRef.current = null
    }

    try { sourceNodeRef.current?.disconnect() } catch {}
    try { analyserRef.current?.disconnect() } catch {}
    sourceNodeRef.current = null
    analyserRef.current = null

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
  }, [])

  const setPendingTxPayloadSync = useCallback((payload: Record<string, unknown> | null) => {
    pendingTxPayloadRef.current = payload
    setPendingTxPayload(payload)
  }, [])

  const isLikelyFalsePositiveTranscript = useCallback((transcript: string) => {
    const normalized = transcript.trim().toLowerCase()
    if (!normalized) return true

    const commonHallucinations = new Set([
      "你好",
      "您好",
      "hello",
      "hi",
      "hey",
      "喂",
      "喂喂",
    ])

    return commonHallucinations.has(normalized) && speechAccumulatedMsRef.current < 800
  }, [])

  // ═══════════════════════════════════════════
  //  UNIFIED SEND GATE — every user message
  //  enters the agent ONLY through this function.
  // ═══════════════════════════════════════════
  const commitAndSend = useCallback((text: string, source: "text" | "voice-committed" = "text") => {
    // ── Guard: validate input ──
    if (!isValidUserInput(text)) return

    // ── Guard: generate ID, check for duplicate dispatch ──
    const msgId = generateMessageId()
    if (handledIds.current.has(msgId)) return // structurally impossible, but belt-and-suspenders
    handledIds.current.add(msgId)

    // ── Trim old handled IDs to prevent unbounded growth ──
    if (handledIds.current.size > 200) {
      const arr = Array.from(handledIds.current)
      handledIds.current = new Set(arr.slice(-100))
    }

    const trimmed = text.trim()
    const lang = getUserLang([...messages, { role: "user", text: trimmed }])

    // ── Add user message + thinking placeholder to chat ──
    setMessages((prev) => [
      ...prev,
      { role: "user", text: trimmed, messageId: msgId, source, status: "committed" },
      { role: "bot", text: L(lang, "🤔 思考中...", "🤔 Thinking..."), source: "system", status: "draft" }
    ])
    setPetState("thinking")

    // ── Clear voice preview after successful commit ──
    setVoicePreview("")

    // ── Dispatch to background ──
    chrome.runtime.sendMessage(
      { action: "USER_ASK", payload: { text: trimmed, walletAddress, messageId: msgId } },
      (response) => {
        if (!mountedRef.current) return // component unmounted, discard

        // Replace progress placeholder with final reply
        setMessages((prev) => {
          const updated = [...prev]
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "bot" && (
              /^🤔/.test(updated[i].text) ||
              /^[🔍📊🔎💼🔗🏛️🪙💰🏦✍️🔧⚡🔄]/.test(updated[i].text)
            )) {
              if (response?.status === "success") {
                updated[i] = { role: "bot", text: response.reply, txPayload: response.transactionPayload, source: "system", status: "handled" }
                if (response.transactionPayload) {
                  setPendingTxPayloadSync(response.transactionPayload)
                }
              } else {
                updated[i] = { role: "bot", text: L(lang, "喵…出了点小问题，再试一次？", "Meow... Something went wrong, try again?"), source: "system", status: "handled" }
              }
              return updated
            }
          }
          // Fallback: no placeholder found, append
          if (response?.status === "success") {
            if (response.transactionPayload) setPendingTxPayloadSync(response.transactionPayload)
            return [...prev, { role: "bot", text: response.reply, txPayload: response.transactionPayload, source: "system", status: "handled" }]
          }
          return [...prev, { role: "bot", text: L(lang, "喵…出了点小问题，再试一次？", "Meow... Something went wrong, try again?"), source: "system", status: "handled" }]
        })
        if (response?.status === "success" && response.transactionPayload) setPendingTxPayloadSync(response.transactionPayload)
        setPetState(response?.status === "success" ? "excited" : "warning")
        if (response?.openWallet) {
          chrome.runtime.sendMessage({ action: "OPEN_POPUP" })
        }
      }
    )
  }, [walletAddress, messages])

  // ═══════════════════════════════════════════
  //  WALLET
  // ═══════════════════════════════════════════
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

  useEffect(() => {
    chrome.runtime.sendMessage({
      action: "SYNC_WALLET_SESSION",
      payload: { walletAddress: walletAddress || null },
    }, () => {
      void chrome.runtime.lastError
    })
  }, [walletAddress])

  useEffect(() => {
    chrome.storage.local.get("coinbuddy_pending_tx", (data) => {
      if (!mountedRef.current) return
      const stored = data.coinbuddy_pending_tx
      if (stored && typeof stored === "object") {
        setPendingTxPayload(stored as Record<string, unknown>)
      }
    })

    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return
      const change = changes.coinbuddy_pending_tx
      if (!change) return
      const nextValue = change.newValue
      setPendingTxPayload(nextValue && typeof nextValue === "object" ? nextValue as Record<string, unknown> : null)
    }

    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => chrome.storage.onChanged.removeListener(onStorageChanged)
  }, [])

  // ═══════════════════════════════════════════
  //  AUTO-REVERT PET STATE
  // ═══════════════════════════════════════════
  useEffect(() => {
    if (petState === "success") fireCelebration()
    const rule = PET_AUTO_REVERT[petState]
    if (!rule) return
    const t = setTimeout(() => {
      if (petState === "warning" && chatOpen) return
      setPetState(rule.to)
    }, rule.delay)
    return () => clearTimeout(t)
  }, [petState, chatOpen])

  // ═══════════════════════════════════════════
  //  DOM SNIFFER (does NOT send user messages)
  // ═══════════════════════════════════════════
  useEffect(() => {
    const cleanup = startSniffer((keywords, contextText) => {
      // Always show attentive state when DeFi content detected
      setPetState("attentive")

      // Only inject sniff message when chat is closed (don't interrupt active conversation)
      if (chatOpenRef.current) return false  // Don't consume cooldown — retry later

      chrome.runtime.sendMessage(
        { action: "SNIFF_MATCH", payload: { keywords, contextText } },
        (response) => {
          if (!mountedRef.current) return
          if (chatOpenRef.current) return
          if (response?.status === "success") {
            setPetState("attentive")
            if (response.suggestedReply) {
              setMessages((prev) => [...prev, { role: "bot", text: response.suggestedReply, source: "system" }])
              setChatOpen(true)
            }
          }
        }
      )
      return true  // Handled — consume cooldown
    })
    return cleanup
  }, [])

  // ═══════════════════════════════════════════
  //  BACKGROUND MESSAGE LISTENER
  // ═══════════════════════════════════════════
  useEffect(() => {
    const handler = (msg: any) => {
      if (!mountedRef.current) return

      if (msg.action === "PET_STATE") {
        setPetState(msg.state)
      }
      if (msg.action === "BOT_REPLY") {
        setMessages((prev) => [
          ...prev,
          { role: "bot", text: msg.reply, txPayload: msg.txPayload, source: "system" }
        ])
        setChatOpen(true)
        setPetState("excited")
      }
      if (msg.action === "PROGRESS") {
        setMessages((prev) => {
          const updated = [...prev]
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "bot" && /^🤔/.test(updated[i].text)) {
              updated[i] = { role: "bot", text: msg.text, source: "system" }
              return updated
            }
            if (updated[i].role === "bot" && /^[🔍📊🔎💼🔗🏛️🪙💰🏦✍️🔧⚡🔄]/.test(updated[i].text)) {
              updated[i] = { role: "bot", text: msg.text, source: "system" }
              return updated
            }
          }
          return [...prev, { role: "bot", text: msg.text, source: "system" }]
        })
        setChatOpen(true)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  // ═══════════════════════════════════════════
  //  VOICE INPUT — auto-stop on silence, auto-send after transcription
  // ═══════════════════════════════════════════
  const handleVoiceInput = useCallback(async () => {
    // ── Stop recording ──
    if (isRecording && recorderRef.current) {
      stopReasonRef.current = "manual"
      recorderRef.current.stop()
      return
    }

    // ── Start recording ──
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      setVoicePreview("")
      speechAccumulatedMsRef.current = 0
      recordingStartedAtRef.current = performance.now()
      lastMonitorAtRef.current = recordingStartedAtRef.current
      lastSpeechAtRef.current = 0
      stopReasonRef.current = "manual"

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"

      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder

      const audioContext = new AudioContext()
      const sourceNode = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      sourceNode.connect(analyser)
      audioContextRef.current = audioContext
      sourceNodeRef.current = sourceNode
      analyserRef.current = analyser

      const monitorVoice = () => {
        if (!mountedRef.current || !recorderRef.current || recorderRef.current.state === "inactive" || !analyserRef.current) {
          return
        }

        const now = performance.now()
        const deltaMs = Math.max(0, now - lastMonitorAtRef.current)
        lastMonitorAtRef.current = now

        const buffer = new Uint8Array(analyserRef.current.fftSize)
        analyserRef.current.getByteTimeDomainData(buffer)
        let sum = 0
        for (const sample of buffer) {
          const centered = sample / 128 - 1
          sum += centered * centered
        }
        const rms = Math.sqrt(sum / buffer.length)
        const speaking = rms >= VOICE_RMS_THRESHOLD

        if (speaking) {
          speechAccumulatedMsRef.current += deltaMs
          lastSpeechAtRef.current = now
        } else if (
          speechAccumulatedMsRef.current >= VOICE_MIN_SPEECH_MS &&
          lastSpeechAtRef.current > 0 &&
          now - lastSpeechAtRef.current >= VOICE_END_SILENCE_MS
        ) {
          stopReasonRef.current = "silence"
          recorderRef.current.stop()
          return
        }

        if (
          speechAccumulatedMsRef.current < VOICE_MIN_SPEECH_MS &&
          now - recordingStartedAtRef.current >= VOICE_MAX_INITIAL_SILENCE_MS
        ) {
          stopReasonRef.current = "no_speech"
          recorderRef.current.stop()
          return
        }

        monitorFrameRef.current = requestAnimationFrame(monitorVoice)
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        recorderRef.current = null
        cleanupVoiceMonitor()

        // ── Guard: if component unmounted while recording, discard everything ──
        if (!mountedRef.current) {
          chunksRef.current = []
          return
        }

        setIsRecording(false)

        if (stopReasonRef.current === "no_speech" || speechAccumulatedMsRef.current < VOICE_MIN_SPEECH_MS || chunksRef.current.length === 0) {
          chunksRef.current = []
          const lang = getUserLang(messages)
          setMessages((prev) => [...prev, {
            role: "bot",
            text: L(lang, "喵…没听到你开口，再说一句试试？", "Meow... I didn't hear you start speaking. Try again?"),
            source: "system"
          }])
          setPetState("waiting")
          return
        }

        const blob = new Blob(chunksRef.current, { type: mimeType })
        chunksRef.current = []

        // ── Auto transcribe and send ──
        setIsTranscribing(true)
        setChatOpen(true)

        const reader = new FileReader()
        reader.onloadend = () => {
          if (!mountedRef.current) { setIsTranscribing(false); return }

          const dataUrl = reader.result as string
          const base64 = dataUrl.split(",")[1]
          const mime = dataUrl.split(";base64,")[0].split(":")[1]

          chrome.runtime.sendMessage(
            { action: "VOICE_TRANSCRIBE", payload: { audioBase64: base64, mimeType: mime } },
            (transcribeRes) => {
              if (!mountedRef.current) return
              setIsTranscribing(false)

              const transcript = transcribeRes?.transcript?.trim() || ""

              if (!transcript || isLikelyFalsePositiveTranscript(transcript)) {
                const lang = getUserLang(messages)
                setMessages((prev) => [...prev, {
                  role: "bot",
                  text: L(lang, "喵…这段录音里没有识别到有效内容，再说一遍？", "Meow... I couldn't detect valid speech in that recording. Try again?"),
                  source: "system"
                }])
                setPetState("waiting")
                return
              }

              commitAndSend(transcript, "voice-committed")
            }
          )
        }
        reader.readAsDataURL(blob)
      }

      recorder.start()
      setIsRecording(true)
      monitorFrameRef.current = requestAnimationFrame(monitorVoice)
    } catch (err: any) {
      console.error("[CoinBuddy] Mic error:", err)
      cleanupVoiceMonitor()
      if (!mountedRef.current) return
      const lang = getUserLang(messages)
      setIsRecording(false)
      setIsTranscribing(false)
      setChatOpen(true)
      setMessages((prev) => [...prev, {
        role: "bot",
        text: err.name === "NotAllowedError"
          ? L(lang, "喵～需要麦克风权限才能语音输入哦！请在浏览器地址栏左边允许麦克风。", "Meow~ I need microphone permission for voice input! Please allow it in the browser address bar.")
          : L(lang, "喵～录音出了问题，双击我用键盘聊吧！", "Meow~ Recording had an issue, double-click me to type instead!"),
        source: "system"
      }])
    }
  }, [cleanupVoiceMonitor, commitAndSend, isLikelyFalsePositiveTranscript, isRecording, messages])

  // ═══════════════════════════════════════════
  //  CHAT BUBBLE HANDLERS
  // ═══════════════════════════════════════════

  const handleConfirmTx = useCallback((payload: Record<string, unknown>) => {
    const lang = getUserLang(messages)
    setPendingTxPayloadSync(payload)
    setPetState("executing")
    setMessages((prev) => [
      ...prev,
      {
        role: "bot",
        text: walletAddress
          ? L(lang, "正在准备交易…请在钱包中确认～", "Preparing transaction... Please confirm in your wallet~")
          : L(lang, "喵～本猫先帮你打开钱包签名窗口，连好后会自动签名～", "Meow~ I'll open the wallet signing window first, then sign automatically after you connect~"),
        source: "system",
      }
    ])
    window.dispatchEvent(
      new CustomEvent("coinbuddy:execute-tx", { detail: payload })
    )
  }, [walletAddress, messages])

  // handleSend: called by ChatBubble when user clicks Send / presses Enter
  // This is the ONLY path from UI text input to agent dispatch.
  const handleSend = useCallback((text: string) => {
    const trimmed = text.trim()
    const commitAsUserMessage = (source: "text" | "voice-committed") => {
      setMessages((prev) => [
        ...prev,
        { role: "user", text: trimmed, source, status: "committed" }
      ])
      return true
    }

    const reusable = getReusablePendingTxPayloadForText(trimmed, messages, pendingTxPayloadRef.current)
    if (reusable) {
      commitAsUserMessage("text")
      handleConfirmTx(reusable)
      return
    }

    if (!isSignIntent(trimmed) && !isTxAcceptanceIntent(trimmed)) {
      commitAndSend(text, voicePreview ? "voice-committed" : "text")
      return
    }

    chrome.storage.local.get("coinbuddy_pending_tx", (data) => {
      if (!mountedRef.current) return
      const storedPendingTx = data.coinbuddy_pending_tx
      const latestTxPayload = getReusablePendingTxPayloadForText(
        trimmed,
        messages,
        storedPendingTx && typeof storedPendingTx === "object"
          ? storedPendingTx as Record<string, unknown>
          : pendingTxPayloadRef.current,
      )
      if (latestTxPayload) {
        commitAsUserMessage("text")
        handleConfirmTx(latestTxPayload)
        return
      }

      commitAndSend(text, voicePreview ? "voice-committed" : "text")
    })
  }, [commitAndSend, handleConfirmTx, messages, voicePreview, setPendingTxPayloadSync])

  // ═══════════════════════════════════════════
  //  CLEANUP: discard voicePreview on chat close
  // ═══════════════════════════════════════════
  const handleCloseChat = useCallback(() => {
    setChatOpen(false)
    setVoicePreview("")  // un-submitted transcript is discarded
  }, [])

  // ── Drag pet ──
  const handleDragMove = useCallback((dx: number, dy: number) => {
    setPetPos((prev) => ({
      right: Math.max(0, Math.min(window.innerWidth - 100, prev.right - dx)),
      bottom: Math.max(0, Math.min(window.innerHeight - 100, prev.bottom - dy))
    }))
  }, [])

  // ── Double-click pet: toggle chat ──
  const handleToggleChat = useCallback(() => {
    setChatOpen((prev) => {
      if (prev) setVoicePreview("")  // closing chat discards pending preview
      return !prev
    })
    if (petState === "attentive" || petState === "warning") setPetState("idle")
  }, [petState])

  // ═══════════════════════════════════════════
  //  TX RESULT LISTENER
  // ═══════════════════════════════════════════
  useEffect(() => {
    const onTxDone = ((e: CustomEvent) => {
      if (!mountedRef.current) return
      const lang = getUserLang(messages)
      if (e.detail.success) {
        setPetState("success")
        setPendingTxPayloadSync(null)
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
            text: L(lang, `交易确认啦！Hash: ${e.detail.hash?.slice(0, 10)}...`, `Transaction confirmed! Hash: ${e.detail.hash?.slice(0, 10)}...`),
            source: "system"
          }]
        })
      } else {
        setPetState("warning")
        if (e.detail.retryable === false) {
          setPendingTxPayloadSync(null)
        }
        setMessages((prev) => {
          const updated = [...prev]
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].txPayload && !updated[i].txCompleted) {
              if (e.detail.retryable === false) {
                updated[i] = { ...updated[i], txCompleted: true }
              }
              break
            }
          }
          return [...updated, {
            role: "bot",
            text: L(
              lang,
              `交易失败了：${e.detail.error}${e.detail.code ? `（${e.detail.code}）` : ""}${e.detail.retryable ? "，你可以再试一次。" : ""}`,
              `Transaction failed: ${e.detail.error}${e.detail.code ? ` (${e.detail.code})` : ""}${e.detail.retryable ? ". You can try again." : ""}`,
            ),
            source: "system"
          }]
        })
      }
    }) as EventListener
    window.addEventListener("coinbuddy:tx-result", onTxDone)
    return () => window.removeEventListener("coinbuddy:tx-result", onTxDone)
  }, [messages])

  // ═══════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════
  return (
    <div className="cb-root" style={{ right: petPos.right, bottom: petPos.bottom }}>
      <ChatBubble
        messages={messages}
        visible={chatOpen}
        onSend={handleSend}
        onConfirmTx={handleConfirmTx}
        onClose={handleCloseChat}
        voicePreview={voicePreview}
        onClearVoicePreview={() => setVoicePreview("")}
        isTranscribing={isTranscribing}
      />
      <PetAvatar
        state={isRecording ? "attentive" : petState}
        onSingleClick={handleVoiceInput}
        onDoubleClick={handleToggleChat}
        onDragMove={handleDragMove}
      />
      {isRecording && <div className="cb-recording-indicator">{L(getUserLang(messages), "🎤 听你说...", "🎤 Listening...")}</div>}
      {isTranscribing && <div className="cb-recording-indicator">{L(getUserLang(messages), "✍️ 识别中...", "✍️ Transcribing...")}</div>}
      <WalletExecutor />
    </div>
  )
}

export default CoinBuddyApp
