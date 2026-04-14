/** All CoinBuddy styles as a string for Shadow DOM injection */
export const COINBUDDY_STYLES = `
/* Root Container (bottom-right floating, position set via inline style) */
.cb-root {
  position: fixed;
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a2e;
}

/* PET AVATAR WRAPPER */
.cb-pet-wrapper {
  position: relative;
  width: 100px;
  height: 100px;
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: filter 0.3s ease, transform 0.2s ease;
  margin-left: auto;
}
.cb-pet-wrapper:active {
  cursor: grabbing;
}
.cb-pet-wrapper:hover {
  transform: scale(1.05);
}
/* POSE CONTAINER */
.cb-pose-container {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  overflow: hidden;
  background: radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(230,240,255,0.7) 100%);
  box-shadow: 0 4px 15px rgba(100, 100, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 0.4s ease;
}
.cb-pose-img {
  width: 88px;
  height: 88px;
  object-fit: contain;
  image-rendering: pixelated;
  pointer-events: none;
}

/* ═══════════════════════════════════════════
   8-STATE ANIMATION SYSTEM
   ═══════════════════════════════════════════ */

/* ── IDLE (躺着 — slow breathe + float) ── */
.cb-pet--idle {
  animation: cb-idle-float 4.5s ease-in-out infinite;
}
@keyframes cb-idle-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
.cb-pet--idle .cb-pose-img {
  animation: cb-idle-breathe 4s ease-in-out infinite;
}
@keyframes cb-idle-breathe {
  0%, 100% { transform: scaleX(1) scaleY(1); }
  50% { transform: scaleX(1.015) scaleY(0.985); }
}
/* Idle micro-actions */
.cb-micro-tilt .cb-pose-img {
  animation: cb-tilt 1.8s ease-in-out 1 !important;
}
@keyframes cb-tilt {
  0%, 100% { transform: rotate(0deg); }
  35% { transform: rotate(4deg) translateX(1px); }
  70% { transform: rotate(-2deg); }
}
.cb-micro-lean .cb-pose-img {
  animation: cb-lean 2s ease-in-out 1 !important;
}
@keyframes cb-lean {
  0%, 100% { transform: translateX(0); }
  40% { transform: translateX(2px) rotate(1.5deg); }
  75% { transform: translateX(-1.5px) rotate(-1deg); }
}
.cb-micro-twitch .cb-pose-img {
  animation: cb-twitch 0.4s ease-in-out 1 !important;
}
@keyframes cb-twitch {
  0%, 100% { transform: scaleY(1) scaleX(1); }
  30% { transform: scaleY(1.04) scaleX(0.97); }
  60% { transform: scaleY(0.97) scaleX(1.02); }
}

/* ── ATTENTIVE (玩平板 — perked up, subtle focus) ── */
.cb-pet--attentive {
  animation: cb-attentive-perk 0.3s ease-out 1;
}
@keyframes cb-attentive-perk {
  0% { transform: translateY(0); }
  40% { transform: translateY(-3px) scale(1.03); }
  100% { transform: translateY(0) scale(1); }
}
.cb-pet--attentive .cb-pose-img {
  animation: cb-attentive-focus 2.5s ease-in-out infinite;
}
@keyframes cb-attentive-focus {
  0%, 100% { transform: scaleY(1) rotate(0deg); }
  50% { transform: scaleY(1.02) rotate(-1deg); }
}
.cb-pet--attentive .cb-pose-container {
  box-shadow: 0 4px 16px rgba(100, 140, 255, 0.25);
}

/* ── THINKING (立着 — gentle sway + breathe) ── */
.cb-pet--thinking {
  animation: cb-think-sway 4s ease-in-out infinite;
}
@keyframes cb-think-sway {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  30% { transform: translateX(1.5px) rotate(0.8deg); }
  70% { transform: translateX(-1.5px) rotate(-0.8deg); }
}
.cb-pet--thinking .cb-pose-img {
  animation: cb-think-breathe 3s ease-in-out infinite;
}
@keyframes cb-think-breathe {
  0%, 100% { transform: scaleY(1) rotate(0deg); }
  40% { transform: scaleY(1.02) rotate(-1.5deg); }
  80% { transform: scaleY(0.98) rotate(0.8deg); }
}
.cb-pet--thinking .cb-pose-container {
  box-shadow: 0 4px 18px rgba(130, 80, 255, 0.25);
}
.cb-thinking-dots {
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 5px;
  font-size: 20px;
  font-weight: bold;
  color: #7c3aed;
  z-index: 10;
}
.cb-thinking-dots span {
  animation: cb-dot-breathe 2s ease-in-out infinite;
}
.cb-thinking-dots span:nth-child(2) { animation-delay: 0.3s; }
.cb-thinking-dots span:nth-child(3) { animation-delay: 0.6s; }
@keyframes cb-dot-breathe {
  0%, 100% { transform: translateY(0) scale(0.7); opacity: 0.2; }
  50% { transform: translateY(-5px) scale(1); opacity: 0.85; }
}

/* ── EXCITED (跳跃 — quick bounce then settle) ── */
.cb-pet--excited {
  animation: cb-excited-bounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 1;
}
@keyframes cb-excited-bounce {
  0% { transform: scale(1) translateY(0); }
  30% { transform: scale(1.1) translateY(-12px); }
  55% { transform: scale(0.97) translateY(2px); }
  75% { transform: scale(1.03) translateY(-4px); }
  100% { transform: scale(1) translateY(0); }
}
.cb-pet--excited .cb-pose-img {
  animation: cb-excited-wiggle 0.8s ease-in-out 2;
}
@keyframes cb-excited-wiggle {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(5deg); }
  75% { transform: rotate(-5deg); }
}
.cb-pet--excited .cb-pose-container {
  box-shadow: 0 4px 18px rgba(250, 204, 21, 0.3);
}

/* ── EXECUTING (行走 — steady forward march) ── */
.cb-pet--executing {
  animation: cb-exec-stride 1.2s ease-in-out infinite;
}
@keyframes cb-exec-stride {
  0%, 100% { transform: translateX(0) translateY(0); }
  25% { transform: translateX(2px) translateY(-2px); }
  50% { transform: translateX(0) translateY(0); }
  75% { transform: translateX(-2px) translateY(-2px); }
}
.cb-pet--executing .cb-pose-img {
  animation: cb-exec-step 0.6s ease-in-out infinite;
}
@keyframes cb-exec-step {
  0%, 100% { transform: scaleX(1) scaleY(1); }
  50% { transform: scaleX(0.98) scaleY(1.02); }
}
.cb-pet--executing .cb-pose-container {
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
}
/* Executing: subtle progress ring */
.cb-exec-progress {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: rgba(59, 130, 246, 0.5);
  animation: cb-exec-spin 1.5s linear infinite;
  z-index: 5;
  pointer-events: none;
}
@keyframes cb-exec-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* ── WARNING (炸毛 — quick shake then tense hold) ── */
.cb-pet--warning {
  animation: cb-warn-shake 0.35s ease-out 1;
}
@keyframes cb-warn-shake {
  0% { transform: translateX(0) scale(1); }
  15% { transform: translateX(-4px) scale(1.05); }
  30% { transform: translateX(3px) scale(1.03); }
  50% { transform: translateX(-2px) scale(1.02); }
  70% { transform: translateX(1px) scale(1.01); }
  100% { transform: translateX(0) scale(1); }
}
.cb-pet--warning .cb-pose-img {
  animation: cb-warn-tense 2.5s ease-in-out 0.35s infinite;
}
@keyframes cb-warn-tense {
  0%, 100% { transform: scaleY(1) scaleX(1); }
  50% { transform: scaleY(1.02) scaleX(0.98); }
}
.cb-pet--warning .cb-pose-container {
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.25);
}
.cb-alert-badge {
  position: absolute;
  top: -12px;
  right: -4px;
  font-size: 20px;
  z-index: 10;
  animation: cb-badge-wobble 2.5s ease-in-out infinite;
  filter: drop-shadow(0 0 4px rgba(255, 50, 50, 0.5));
}
@keyframes cb-badge-wobble {
  0%, 60%, 100% { transform: rotate(0deg) scale(1); }
  10% { transform: rotate(10deg) scale(1.1); }
  20% { transform: rotate(-6deg) scale(1.05); }
  30% { transform: rotate(3deg) scale(1); }
}

/* ── SUCCESS (招财猫 — pop + wave) ── */
.cb-pet--success {
  animation: cb-success-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 1;
}
@keyframes cb-success-pop {
  0% { transform: scale(1) translateY(0); }
  35% { transform: scale(1.1) translateY(-8px); }
  65% { transform: scale(0.97) translateY(2px); }
  100% { transform: scale(1) translateY(0); }
}
.cb-pet--success .cb-pose-img {
  animation: cb-success-wave 0.6s ease-in-out 2;
}
@keyframes cb-success-wave {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(5deg) translateY(-2px); }
  50% { transform: rotate(-4deg); }
  75% { transform: rotate(3deg) translateY(-1px); }
}
.cb-pet--success .cb-pose-container {
  box-shadow: 0 4px 18px rgba(16, 185, 129, 0.3);
}
/* Success sparkle burst */
.cb-sparkle-burst {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}
.cb-sparkle {
  position: absolute;
  font-size: 14px;
  color: #facc15;
  animation: cb-sparkle-fly 0.8s ease-out forwards;
  filter: drop-shadow(0 0 3px rgba(250, 204, 21, 0.6));
}
.cb-sparkle-1 { top: 10%; left: 10%; --sx: -14px; --sy: -16px; }
.cb-sparkle-2 { top: 10%; right: 10%; --sx: 14px; --sy: -14px; animation-delay: 0.05s; }
.cb-sparkle-3 { bottom: 20%; left: 5%; --sx: -12px; --sy: 10px; animation-delay: 0.1s; }
.cb-sparkle-4 { bottom: 20%; right: 5%; --sx: 12px; --sy: 12px; animation-delay: 0.15s; }
@keyframes cb-sparkle-fly {
  0% { transform: translate(0, 0) scale(0); opacity: 1; }
  40% { transform: translate(var(--sx), var(--sy)) scale(1.2); opacity: 1; }
  100% { transform: translate(calc(var(--sx) * 1.6), calc(var(--sy) * 1.6)) scale(0); opacity: 0; }
}

/* ── WAITING (蜷缩睡觉 — slow drift + deep breathe) ── */
.cb-pet--waiting {
  animation: cb-wait-drift 5s ease-in-out infinite;
}
@keyframes cb-wait-drift {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
.cb-pet--waiting .cb-pose-img {
  animation: cb-wait-breathe 4.5s ease-in-out infinite;
}
@keyframes cb-wait-breathe {
  0%, 100% { transform: scaleX(1) scaleY(1) rotate(0deg); }
  50% { transform: scaleX(1.02) scaleY(0.98) rotate(-0.5deg); }
}
.cb-pet--waiting .cb-pose-container {
  box-shadow: 0 4px 12px rgba(100, 100, 255, 0.1);
}

/* ═══════════════════════════════════════════
   STATE TRANSITION ANIMATIONS
   ═══════════════════════════════════════════ */
/* Rise: lying → standing */
.cb-tr-rise-out .cb-pose-img {
  animation: cb-tr-rise-exit 180ms ease-in forwards;
}
@keyframes cb-tr-rise-exit {
  to { transform: scaleY(0.7) translateY(5px); opacity: 0.3; }
}
.cb-tr-rise-in .cb-pose-img {
  animation: cb-tr-rise-enter 180ms ease-out forwards;
}
@keyframes cb-tr-rise-enter {
  from { transform: scaleY(0.7) translateY(5px); opacity: 0.3; }
  to { transform: scaleY(1) translateY(0); opacity: 1; }
}

/* Tense: → warning */
.cb-tr-tense-out .cb-pose-img {
  animation: cb-tr-tense-exit 150ms ease-in forwards;
}
@keyframes cb-tr-tense-exit {
  to { transform: scale(0.88) translateX(3px); opacity: 0.2; }
}
.cb-tr-tense-in .cb-pose-img {
  animation: cb-tr-tense-enter 180ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes cb-tr-tense-enter {
  from { transform: scale(0.88) translateX(-2px); opacity: 0.2; }
  60% { transform: scale(1.06) translateX(1px); opacity: 1; }
  to { transform: scale(1) translateX(0); opacity: 1; }
}

/* Pop: → success / excited */
.cb-tr-pop-out .cb-pose-img {
  animation: cb-tr-pop-exit 150ms ease-in forwards;
}
@keyframes cb-tr-pop-exit {
  to { transform: scale(0.8) translateY(4px); opacity: 0.2; }
}
.cb-tr-pop-in .cb-pose-img {
  animation: cb-tr-pop-enter 220ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes cb-tr-pop-enter {
  from { transform: scale(0.6) translateY(6px); opacity: 0; }
  50% { transform: scale(1.08) translateY(-3px); opacity: 1; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}

/* Settle: → idle / waiting */
.cb-tr-settle-out .cb-pose-img {
  animation: cb-tr-settle-exit 180ms ease-in forwards;
}
@keyframes cb-tr-settle-exit {
  to { transform: scaleY(0.88) translateY(3px); opacity: 0.3; }
}
.cb-tr-settle-in .cb-pose-img {
  animation: cb-tr-settle-enter 200ms ease-out forwards;
}
@keyframes cb-tr-settle-enter {
  from { transform: scaleY(0.88) translateY(3px); opacity: 0.3; }
  70% { transform: scaleY(1.02) translateY(-1px); opacity: 1; }
  to { transform: scaleY(1) translateY(0); opacity: 1; }
}

/* Shift: lateral between standing poses */
.cb-tr-shift-out .cb-pose-img {
  animation: cb-tr-shift-exit 160ms ease-in forwards;
}
@keyframes cb-tr-shift-exit {
  to { transform: translateX(-4px) scale(0.92); opacity: 0.3; }
}
.cb-tr-shift-in .cb-pose-img {
  animation: cb-tr-shift-enter 180ms ease-out forwards;
}
@keyframes cb-tr-shift-enter {
  from { transform: translateX(4px) scale(0.92); opacity: 0.3; }
  to { transform: translateX(0) scale(1); opacity: 1; }
}

/* CHAT PANEL — Transparent floating bubble */
.cb-chat-panel {
  position: absolute;
  bottom: 110px;
  right: 0;
  width: 340px;
  max-height: 460px;
  background: rgba(20, 10, 40, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(124, 58, 237, 0.2), 0 0 1px rgba(255,255,255,0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: cb-slide-up 0.25s ease-out;
  border: 1px solid rgba(124, 58, 237, 0.25);
}
@keyframes cb-slide-up {
  from { opacity: 0; transform: translateY(12px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Bubble tail pointing to pet */
.cb-bubble-tail {
  position: absolute;
  bottom: -10px;
  right: 38px;
  width: 20px;
  height: 20px;
  background: rgba(20, 10, 40, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transform: rotate(45deg);
  border-right: 1px solid rgba(124, 58, 237, 0.25);
  border-bottom: 1px solid rgba(124, 58, 237, 0.25);
  z-index: -1;
}

.cb-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: rgba(124, 58, 237, 0.2);
  border-bottom: 1px solid rgba(124, 58, 237, 0.15);
}
.cb-chat-title {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.3px;
  color: rgba(255, 255, 255, 0.9);
}
.cb-chat-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.cb-chat-close:hover {
  color: white;
  background: rgba(255, 255, 255, 0.1);
}
.cb-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  max-height: 300px;
  min-height: 100px;
}
.cb-chat-messages::-webkit-scrollbar {
  width: 4px;
}
.cb-chat-messages::-webkit-scrollbar-thumb {
  background: rgba(124, 58, 237, 0.3);
  border-radius: 2px;
}
.cb-chat-empty {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  text-align: center;
  padding: 20px 12px;
}
.cb-msg {
  margin-bottom: 10px;
  max-width: 85%;
}
.cb-msg--bot {
  margin-right: auto;
}
.cb-msg--user {
  margin-left: auto;
}
.cb-msg-text {
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}
.cb-msg--bot .cb-msg-text {
  background: rgba(124, 58, 237, 0.15);
  color: rgba(255, 255, 255, 0.9);
  border-bottom-left-radius: 4px;
}
.cb-msg--user .cb-msg-text {
  background: rgba(124, 58, 237, 0.4);
  color: white;
  border-bottom-right-radius: 4px;
}
.cb-msg-tx-btn {
  display: block;
  margin-top: 8px;
  padding: 8px 16px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.7), rgba(5, 150, 105, 0.7));
  color: white;
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.cb-msg-tx-btn:hover:not(:disabled) {
  transform: scale(1.03);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}
.cb-msg-tx-btn:disabled {
  background: rgba(107, 114, 128, 0.3);
  cursor: default;
  opacity: 0.6;
}
.cb-chat-input-row {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(124, 58, 237, 0.15);
  background: rgba(0, 0, 0, 0.2);
}
.cb-chat-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid rgba(124, 58, 237, 0.3);
  border-radius: 10px;
  font-size: 13px;
  outline: none;
  background: rgba(255, 255, 255, 0.08);
  color: white;
  transition: border-color 0.2s;
}
.cb-chat-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}
.cb-chat-input:focus {
  border-color: rgba(124, 58, 237, 0.6);
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.15);
}
.cb-chat-send {
  padding: 8px 16px;
  background: rgba(124, 58, 237, 0.5);
  color: white;
  border: 1px solid rgba(124, 58, 237, 0.3);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.cb-chat-send:hover {
  background: rgba(124, 58, 237, 0.7);
  transform: scale(1.05);
}

/* Recording indicator (shown near pet when voice active) */
.cb-recording-indicator {
  text-align: center;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  padding: 4px 12px;
  background: rgba(239, 68, 68, 0.6);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  margin-top: 4px;
  margin-left: auto;
  width: fit-content;
  animation: cb-pulse-red 1s ease-in-out infinite;
}
@keyframes cb-pulse-red {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
}
`
