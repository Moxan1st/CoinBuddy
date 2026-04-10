import Lottie from "lottie-react"
import { useRef, useCallback } from "react"
import type { PetState } from "~lib/pet-state"
import idleAnimation from "~assets/coinbuddy-idle.json"

interface PetAvatarProps {
  state: PetState
  onSingleClick: () => void
  onDoubleClick: () => void
  onDragMove?: (dx: number, dy: number) => void
}

export default function PetAvatar({ state, onSingleClick, onDoubleClick, onDragMove }: PetAvatarProps) {
  const lottieRef = useRef(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragState = useRef<{ dragging: boolean; startX: number; startY: number; moved: boolean }>({
    dragging: false, startX: 0, startY: 0, moved: false
  })

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragState.current = { dragging: true, startX: e.clientX, startY: e.clientY, moved: false }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.dragging) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragState.current.moved = true
    }
    if (dragState.current.moved && onDragMove) {
      onDragMove(dx, dy)
      dragState.current.startX = e.clientX
      dragState.current.startY = e.clientY
    }
  }, [onDragMove])

  const handlePointerUp = useCallback(() => {
    const wasDragging = dragState.current.moved
    dragState.current = { dragging: false, startX: 0, startY: 0, moved: false }
    if (wasDragging) return // 拖动结束，不触发点击

    // 点击逻辑
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

  return (
    <div
      className={`cb-pet-wrapper cb-pet--${state}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title="单击=语音 | 双击=聊天 | 拖动=移动">
      {state === "alert" && <div className="cb-alert-badge">❗</div>}

      {state === "thinking" && (
        <div className="cb-thinking-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </div>
      )}

      <div className="cb-lottie-container">
        <Lottie
          lottieRef={lottieRef}
          animationData={idleAnimation}
          loop={true}
          autoplay={true}
          style={{ width: 100, height: 100 }}
        />
      </div>
    </div>
  )
}
