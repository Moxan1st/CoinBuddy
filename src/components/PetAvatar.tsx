import { useRef, useCallback, useEffect, useState } from "react"
import type { PetState } from "~lib/pet-state"

// ── Asset imports (8 distinct cat poses) ──
import imgIdle from "data-base64:~assets/coinbuddy-idle-lying.png"
import imgAttentive from "data-base64:~assets/coinbuddy-attentive-tablet.png"
import imgThinking from "data-base64:~assets/coinbuddy-thinking-upright.png"
import imgExcited from "data-base64:~assets/coinbuddy-excited-jump.png"
import imgExecuting from "data-base64:~assets/coinbuddy-executing-walk.png"
import imgWarning from "data-base64:~assets/coinbuddy-alert-puffed.png"
import imgSuccess from "data-base64:~assets/coinbuddy-done-luckycat.png"
import imgWaiting from "data-base64:~assets/coinbuddy-waiting-curled.png"

/**
 * State → Sprite mapping
 * Each state uses a unique cat image for instant visual distinction.
 */
const POSE_MAP: Record<PetState, string> = {
  idle:      imgIdle,       // 躺着 — relaxed lying down
  attentive: imgAttentive,  // 玩平板 — looking at screen
  thinking:  imgThinking,   // 站立呼吸 — upright, pondering
  excited:   imgExcited,    // 跳跃 — leaping with joy
  executing: imgExecuting,  // 行走 — walking steadily
  warning:   imgWarning,    // 炸毛 — puffed up, alert
  success:   imgSuccess,    // 招财猫 — lucky cat wave
  waiting:   imgWaiting,    // 蜷缩睡觉 — curled up dozing
}

const IDLE_MICRO = ["cb-micro-tilt", "cb-micro-lean", "cb-micro-twitch", ""] as const

// ── Transition direction logic ──
function getTransitionClass(from: PetState, to: PetState): string {
  // Rise: lying/curled → standing poses
  if ((from === "idle" || from === "waiting") &&
      (to === "thinking" || to === "attentive" || to === "executing"))
    return "cb-tr-rise"

  // Tense: → warning (sudden alert)
  if (to === "warning") return "cb-tr-tense"

  // Pop: → success or excited (celebratory burst)
  if (to === "success" || to === "excited") return "cb-tr-pop"

  // Settle: → idle or waiting (relaxing down)
  if (to === "idle" || to === "waiting") return "cb-tr-settle"

  // Shift: lateral transition between standing poses
  return "cb-tr-shift"
}

const TR_DURATION = 180 // ms per phase (exit/enter)

interface PetAvatarProps {
  state: PetState
  onSingleClick: () => void
  onDoubleClick: () => void
  onDragMove?: (dx: number, dy: number) => void
}

export default function PetAvatar({ state, onSingleClick, onDoubleClick, onDragMove }: PetAvatarProps) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, moved: false })

  const [microAction, setMicroAction] = useState("")
  const [successSparkle, setSuccessSparkle] = useState(false)

  // ── Transition layer ──
  const [displayState, setDisplayState] = useState<PetState>(state)
  const [trClass, setTrClass] = useState("")
  const prev = useRef<PetState>(state)

  useEffect(() => {
    if (state === prev.current) return
    const cls = getTransitionClass(prev.current, state)
    setTrClass(cls + "-out")
    const t1 = setTimeout(() => {
      setDisplayState(state)
      setTrClass(cls + "-in")
      const t2 = setTimeout(() => setTrClass(""), TR_DURATION)
      return () => clearTimeout(t2)
    }, TR_DURATION)
    prev.current = state
    return () => clearTimeout(t1)
  }, [state])

  // ── Idle micro-actions (3-6s random cycle) ──
  useEffect(() => {
    if (state !== "idle") { setMicroAction(""); return }
    const tick = () => {
      setMicroAction(IDLE_MICRO[Math.floor(Math.random() * IDLE_MICRO.length)])
    }
    tick()
    const id = setInterval(tick, 3000 + Math.random() * 3000)
    return () => clearInterval(id)
  }, [state])

  // ── Success sparkle burst ──
  useEffect(() => {
    if (state !== "success") { setSuccessSparkle(false); return }
    setSuccessSparkle(true)
    const id = setTimeout(() => setSuccessSparkle(false), 900)
    return () => clearTimeout(id)
  }, [state])

  // ── Pointer handlers (unchanged interaction logic) ──
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragState.current = { dragging: true, startX: e.clientX, startY: e.clientY, moved: false }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.dragging) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragState.current.moved = true
    if (dragState.current.moved && onDragMove) {
      onDragMove(dx, dy)
      dragState.current.startX = e.clientX
      dragState.current.startY = e.clientY
    }
  }, [onDragMove])

  const handlePointerUp = useCallback(() => {
    const wasDragging = dragState.current.moved
    dragState.current = { dragging: false, startX: 0, startY: 0, moved: false }
    if (wasDragging) return
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      onDoubleClick()
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        onSingleClick()
      }, 280)
    }
  }, [onSingleClick, onDoubleClick])

  // ── Render ──
  const cls = [
    "cb-pet-wrapper",
    `cb-pet--${displayState}`,
    trClass,
    displayState === "idle" && !trClass && microAction ? microAction : "",
  ].filter(Boolean).join(" ")

  return (
    <div
      className={cls}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title="单击=语音 | 双击=聊天 | 拖动=移动">

      {state === "warning" && <div className="cb-alert-badge">❗</div>}

      {state === "thinking" && (
        <div className="cb-thinking-dots">
          <span>.</span><span>.</span><span>.</span>
        </div>
      )}

      {state === "executing" && <div className="cb-exec-progress" />}

      {successSparkle && (
        <div className="cb-sparkle-burst">
          <span className="cb-sparkle cb-sparkle-1">✦</span>
          <span className="cb-sparkle cb-sparkle-2">✧</span>
          <span className="cb-sparkle cb-sparkle-3">✦</span>
          <span className="cb-sparkle cb-sparkle-4">✧</span>
        </div>
      )}

      <div className="cb-pose-container">
        <img
          src={POSE_MAP[displayState]}
          alt={`CoinBuddy ${displayState}`}
          className="cb-pose-img"
          draggable={false}
        />
      </div>
    </div>
  )
}
