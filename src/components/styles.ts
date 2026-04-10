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
.cb-lottie-container {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  overflow: hidden;
  background: radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(230,240,255,0.7) 100%);
  box-shadow: 0 4px 20px rgba(100, 100, 255, 0.25);
}

/* STATE: IDLE */
.cb-pet--idle {
  animation: cb-float 3s ease-in-out infinite;
}
@keyframes cb-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

/* STATE: ALERT */
.cb-pet--alert {
  animation: cb-bounce 0.4s ease-in-out infinite;
}
@keyframes cb-bounce {
  0%, 100% { transform: translateY(0) scale(1); }
  25% { transform: translateY(-18px) scale(1.1); }
  50% { transform: translateY(0) scale(0.95); }
  75% { transform: translateY(-10px) scale(1.05); }
}
.cb-alert-badge {
  position: absolute;
  top: -12px;
  right: -4px;
  font-size: 24px;
  z-index: 10;
  animation: cb-flash 0.5s ease-in-out infinite alternate;
  filter: drop-shadow(0 0 6px rgba(255, 50, 50, 0.8));
}
@keyframes cb-flash {
  0% { opacity: 0.4; transform: scale(0.8); }
  100% { opacity: 1; transform: scale(1.2); }
}

/* STATE: THINKING */
.cb-pet--thinking .cb-lottie-container {
  animation: cb-glow 1.2s ease-in-out infinite alternate;
}
@keyframes cb-glow {
  0% {
    filter: blur(0px) brightness(1);
    box-shadow: 0 4px 20px rgba(100, 100, 255, 0.25);
  }
  100% {
    filter: blur(1.5px) brightness(1.3);
    box-shadow: 0 4px 30px rgba(130, 80, 255, 0.6), 0 0 40px rgba(130, 80, 255, 0.3);
  }
}
.cb-thinking-dots {
  position: absolute;
  top: -20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  font-size: 28px;
  font-weight: bold;
  color: #7c3aed;
  z-index: 10;
}
.cb-thinking-dots span {
  animation: cb-dot-bounce 1.4s ease-in-out infinite;
}
.cb-thinking-dots span:nth-child(2) {
  animation-delay: 0.2s;
}
.cb-thinking-dots span:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes cb-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
  40% { transform: translateY(-10px); opacity: 1; }
}

/* STATE: DONE */
.cb-pet--done {
  animation: cb-celebrate 0.8s ease-in-out 3;
}
@keyframes cb-celebrate {
  0% { transform: rotate(0deg) scale(1); }
  25% { transform: rotate(10deg) scale(1.15); }
  50% { transform: rotate(-10deg) scale(1.15); }
  75% { transform: rotate(5deg) scale(1.1); }
  100% { transform: rotate(0deg) scale(1); }
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
.cb-msg-tx-btn:hover {
  transform: scale(1.03);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
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
